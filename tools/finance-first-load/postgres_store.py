"""PostgreSQL adapter. No credentials, remote connections, DDL or imports on module load."""
import json
from contextlib import contextmanager
from pathlib import Path
from decimal import Decimal
from policy import fingerprint,file_hash,validate_endpoint

ROOT=Path(__file__).parent
DDL_FILES=[ROOT.parent/'finance-migration'/'migrations'/f'{name}.review.sql' for name in
           ('financeiro_origem','portal_acesso','financeiro_operacional','portal_consulta')]+[ROOT/'control.review.sql']
SCHEMAS=('financeiro_origem','portal_acesso','financeiro','financeiro_controle')

def schema_hashes(): return {p.name:file_hash(p) for p in DDL_FILES}

def atomic_ddl(path):
    # Approved reviewed files have outer BEGIN/COMMIT. Do not let them commit the load.
    lines=path.read_text(encoding='utf-8').splitlines()
    return '\n'.join(line for line in lines if line.strip() not in ('BEGIN;','COMMIT;'))

def json_dumps(value):
    def convert(v):
        if isinstance(v,Decimal): return str(v)
        if hasattr(v,'isoformat'): return v.isoformat()
        raise TypeError('unsupported_json_value')
    return json.dumps(value,default=convert,sort_keys=True,ensure_ascii=False)

def connect_operational(dsn):
    """Future use only after explicit authorization. No service_role or pooler shortcut."""
    expected=validate_endpoint(dsn)
    import psycopg
    from psycopg.types.json import set_json_loads
    db=psycopg.connect(dsn,autocommit=False,connect_timeout=10)
    set_json_loads(lambda value:json.loads(value,parse_float=Decimal),context=db)
    try:
        if not db.pgconn.ssl_in_use or db.info.host!=expected['host'] or db.info.dbname!='postgres' or db.info.user!='postgres':
            raise ValueError('actual_connection_identity_mismatch')
        actual=db.execute('SELECT current_database(),current_user,current_setting(\'server_version_num\')').fetchone()
        if actual[0:2]!=('postgres','postgres') or int(actual[2])//10000!=17:
            raise ValueError('actual_database_role_version_mismatch')
        db.rollback()
        return PostgresStore(db)
    except BaseException:
        db.close(); raise

class PostgresStore:
    def __init__(self,db):
        from psycopg import sql
        from psycopg.types.json import Jsonb,set_json_loads
        self.db=db; self.sql=sql; self.Jsonb=Jsonb; self.cache={}; self.presence={}; self.extra_rows=[]
        set_json_loads(lambda value:json.loads(value,parse_float=Decimal),context=db)
    def close(self): self.db.close()
    def relation(self,entity):
        schema,table=entity.split('.')
        allowed=set(SCHEMAS)|{'comercial_360'}
        if schema not in allowed or (schema=='comercial_360' and table not in ('clientes','produtos','empresas','investimento_posicoes')):
            raise ValueError('entity_outside_reviewed_scope')
        return self.sql.Identifier(schema,table)
    def exists(self,entity):
        if entity not in self.presence: self.presence[entity]=self.db.execute('SELECT to_regclass(%s)',(entity,)).fetchone()[0] is not None
        return self.presence[entity]
    def predicates(self,key):
        if not key: raise ValueError('empty_identity_not_allowed')
        return self.sql.SQL(' AND ').join(self.sql.SQL('{}=%s').format(self.sql.Identifier(k)) for k in key),list(key.values())
    def get(self,entity,key,lock=False):
        identity=(entity,fingerprint(key))
        if not lock and identity in self.cache: return self.cache[identity]
        if not self.exists(entity): return None
        where,params=self.predicates(key)
        q=self.sql.SQL('SELECT to_jsonb(t) FROM {} t WHERE {}{}').format(self.relation(entity),where,self.sql.SQL(' FOR UPDATE' if lock else ''))
        rows=self.db.execute(q,params).fetchall()
        if len(rows)>1: raise ValueError('nonunique_destination_identity')
        result=rows[0][0] if rows else None
        self.cache[identity]=result
        return result
    def prepare_snapshot(self,intent):
        from engine import SPEC
        self.cache={}; self.extra_rows=[]
        entities={}
        for i in intent['items']: entities.setdefault(i['entity'],[]).append(i)
        # Include empty source tables too, so unexpected extra rows cannot be hidden.
        for table in SPEC: entities.setdefault('financeiro_origem.'+table,[])
        fixed_keys={'financeiro.registros_consulta':['source_system','tabela_origem','origem_id'],
                    'financeiro.vinculos_titulos':['source_system','origem_id'],
                    'financeiro.relacoes_consulta':['source_system','parent_table','parent_id','child_table','child_id'],
                    'financeiro_controle.correspondencias':['source_system','tabela_origem','origem_id']}
        for entity in fixed_keys: entities.setdefault(entity,[])
        source=intent['source_system']
        for entity,items in entities.items():
            columns=list(items[0]['key']) if items else fixed_keys.get(entity,['source_system','id'])
            expected={fingerprint(i['key']) for i in items}
            rows=[]
            if self.exists(entity):
                if 'source_system' in columns:
                    rows=[r[0] for r in self.db.execute(self.sql.SQL('SELECT to_jsonb(t) FROM {} t WHERE source_system=%s').format(self.relation(entity)),(source,))]
                else:
                    for i in items:
                        where,params=self.predicates(i['key'])
                        found=self.db.execute(self.sql.SQL('SELECT to_jsonb(t) FROM {} t WHERE {}').format(self.relation(entity),where),params).fetchall()
                        if len(found)>1: raise ValueError('nonunique_destination_identity')
                        rows.extend(r[0] for r in found)
            for row in rows:
                key={c:row[c] for c in columns}; digest=fingerprint(key)
                self.cache[(entity,digest)]=row
                if 'source_system' in columns and digest not in expected: self.extra_rows.append((entity,key))
            for i in items: self.cache.setdefault((entity,fingerprint(i['key'])),None)
    @contextmanager
    def transaction(self):
        if self.db.info.transaction_status.value!=0: raise ValueError('unexpected_open_transaction')
        with self.db.transaction():
            self.cache={}; self.presence={}
            self.db.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL transaction_timeout='120s'")
            yield
    @contextmanager
    def read_only(self):
        if self.db.info.transaction_status.value!=0: raise ValueError('unexpected_open_transaction')
        with self.db.transaction():
            self.db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            yield
    def lock_source(self,source): self.db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',(source,))
    def lock_reviewed_references(self,intent):
        # Short maintenance transaction, not a global CRM data rewrite.
        self.db.execute('LOCK TABLE comercial_360.clientes IN SHARE ROW EXCLUSIVE MODE')
        self.validate_references(intent,lock=True)
    def validate_references(self,intent,lock=False):
        seeds={i['key']['cliente_id_global']:i['values'] for i in intent['items'] if i['kind']=='new_customer'}
        for seed in seeds.values():
            found=self.db.execute('SELECT cliente_id_global FROM comercial_360.clientes WHERE cpf_cnpj_normalizado=%s',(seed['cpf_cnpj_normalizado'],)).fetchall()
            if found and any(str(r[0])!=seed['cliente_id_global'] for r in found): raise ValueError('new_customer_document_already_exists')
        seen=set()
        for i in intent['items']:
            if i['kind']!='projection': continue
            row=i['values']; customer=row['cliente_id_global']; product=row['produto_id']
            identity=(customer,product,row['empresa_id'])
            if identity in seen: continue
            seen.add(identity)
            if customer and customer not in seeds and self.get('comercial_360.clientes',{'cliente_id_global':customer},lock) is None:
                raise ValueError('approved_customer_missing_now')
            if product:
                p=self.get('comercial_360.produtos',{'produto_id':product},lock)
                if not p or str(p['empresa_id'])!=row['empresa_id'] or p.get('ativo') is False:
                    raise ValueError('approved_product_company_changed')
            if self.get('comercial_360.empresas',{'empresa_id':row['empresa_id']},lock) is None:
                raise ValueError('approved_company_missing_now')
    def conditions(self,intent):
        self.prepare_snapshot(intent)
        metadata=self.db.execute("""SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
          'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
          'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
          'constraints',(SELECT jsonb_agg(pg_get_constraintdef(f.oid) ORDER BY f.conname) FROM pg_constraint f WHERE f.conrelid=c.oid),
          'policies',(SELECT jsonb_agg(jsonb_build_object('name',p.polname,'roles',p.polroles::text,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
          'triggers',(SELECT jsonb_agg(md5(pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY n.nspname,c.relname),'[]')
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v')
          AND (n.nspname=ANY(%s) OR (n.nspname='comercial_360' AND c.relname IN ('clientes','produtos','empresas','investimento_posicoes')))""",(list(SCHEMAS),)).fetchone()[0]
        jobs=[]
        if self.exists('cron.job'):
            jobs=[dict(zip(('jobid','schedule','active','command_sha256'),r)) for r in self.db.execute("SELECT jobid,schedule,active,encode(sha256(convert_to(command,'UTF8')),'hex') FROM cron.job ORDER BY jobid")]
        references=[]
        unique=set()
        for i in intent['items']:
            if i['kind']=='projection':
                for entity,column in [('comercial_360.clientes','cliente_id_global'),('comercial_360.produtos','produto_id'),('comercial_360.empresas','empresa_id')]:
                    value=i['values'][column]
                    if value and (entity,value) not in unique:
                        unique.add((entity,value)); references.append(dict(entity=entity,id=value,row_sha256=fingerprint(self.get(entity,{column:value}))))
        current=[dict(entity=i['entity'],key=i['key'],sha256=fingerprint(self.get(i['entity'],i['key']))) for i in intent['items']]
        functions=self.db.execute("""SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'identity',p.oid::regprocedure::text,'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY(%s) AND p.prokind IN ('f','p')""",(list(SCHEMAS),)).fetchone()[0]
        api_schemas=self.db.execute("SELECT split_part(setting,'=',2) FROM pg_roles r CROSS JOIN LATERAL unnest(r.rolconfig) setting WHERE r.rolname='authenticator' AND setting LIKE 'pgrst.db_schemas=%'").fetchall()
        return dict(metadata=metadata,functions=functions,jobs=jobs,references=references,current=current,api_exposed_schemas=[r[0] for r in api_schemas])
    def initialize_reviewed_schema(self):
        present=[bool(self.db.execute('SELECT to_regnamespace(%s)',(s,)).fetchone()[0]) for s in SCHEMAS]
        if not any(present):
            for path in DDL_FILES: self.db.execute(atomic_ddl(path))
            self.presence={}; self.cache={}
        elif all(present): return
        else: raise ValueError('partial_schema_requires_separate_review_not_auto_repair')
    def lock_migration_tables(self):
        rows=self.db.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname=ANY(%s) ORDER BY schemaname,tablename",(list(SCHEMAS),))
        for schema,table in rows:
            self.db.execute(self.sql.SQL('LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE').format(self.sql.Identifier(schema,table)))
    def extras(self,source,expected):
        return self.extra_rows
    def adapt(self,value): return self.Jsonb(value,dumps=json_dumps) if isinstance(value,(dict,list)) else value
    def write(self,entry,action):
        columns=list(entry['values']); values=[self.adapt(entry['values'][k]) for k in columns]
        if action=='insert':
            q=self.sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(self.relation(entry['entity']),self.sql.SQL(',').join(map(self.sql.Identifier,columns)),self.sql.SQL(',').join(self.sql.Placeholder() for _ in columns))
        elif action=='update' and entry['entity']=='financeiro.estado_carga':
            where,params=self.predicates(entry['key']); values+=params
            q=self.sql.SQL('UPDATE {} SET {} WHERE {}').format(self.relation(entry['entity']),self.sql.SQL(',').join(self.sql.SQL('{}=%s').format(self.sql.Identifier(k)) for k in columns),where)
        else: raise ValueError('overwrite_not_allowed')
        self.db.execute(q,values)
    def journal(self,batch,entry,action,before,after_hash):
        self.db.execute('INSERT INTO financeiro_controle.journal(lote_id,entity,item_key,operation,before_row,after_sha256) VALUES (%s,%s,%s,%s,%s,%s)',
                        (batch,entry['entity'],self.Jsonb(entry['key']),action,self.Jsonb(before,dumps=json_dumps),after_hash))
    def write_many(self,actions):
        groups={}
        for action in actions:
            e=action['entry']
            if action['action']=='update': self.write(e,'update'); continue
            groups.setdefault((e['entity'],tuple(e['values'])),[]).append(e)
        for (entity,columns),entries in groups.items():
            q=self.sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(self.relation(entity),self.sql.SQL(',').join(map(self.sql.Identifier,columns)),self.sql.SQL(',').join(self.sql.Placeholder() for _ in columns))
            with self.db.cursor() as cursor:
                cursor.executemany(q,[[self.adapt(e['values'][k]) for k in columns] for e in entries])
        self.cache={}
    def journal_many(self,batch,entries):
        values=[(batch,e['entity'],self.Jsonb(e['key']),action,self.Jsonb(before,dumps=json_dumps),after_hash) for e,action,before,after_hash in entries]
        with self.db.cursor() as cursor:
            cursor.executemany('INSERT INTO financeiro_controle.journal(lote_id,entity,item_key,operation,before_row,after_sha256) VALUES (%s,%s,%s,%s,%s,%s)',values)
    def execution(self,batch):
        return self.get('financeiro_controle.execucoes',{'lote_id':batch})
    def record_execution(self,batch,approval_hash,plan_hash,summary):
        self.db.execute("INSERT INTO financeiro_controle.execucoes(lote_id,approval_sha256,plan_sha256,status,summary) VALUES (%s,%s,%s,'completed',%s)",(batch,approval_hash,plan_hash,self.Jsonb(summary)))
    def read_journal(self,batch):
        return [r[0] for r in self.db.execute('SELECT to_jsonb(j) FROM financeiro_controle.journal j WHERE lote_id=%s ORDER BY sequence_no',(batch,))]
    def check_journal_unchanged(self,batch):
        for row in self.read_journal(batch):
            current=self.get(row['entity'],row['item_key'],lock=True)
            if current is None or fingerprint(current)!=row['after_sha256']: raise ValueError('created_or_changed_row_no_longer_intact')
    def external_references(self,entity,key,owned):
        refs=self.db.execute("""SELECT ns.nspname,c.relname,array_agg(ca.attname ORDER BY k.ord),array_agg(pa.attname ORDER BY k.ord)
        FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
        CROSS JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY k(cid,pid,ord)
        JOIN pg_attribute ca ON ca.attrelid=c.oid AND ca.attnum=k.cid
        JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.pid
        WHERE f.contype='f' AND f.confrelid=to_regclass(%s) GROUP BY f.oid,ns.nspname,c.relname""",(entity,)).fetchall()
        parent=self.get(entity,key)
        for schema,table,child_columns,parent_columns in refs:
            child=schema+'.'+table
            if child in ('financeiro_controle.journal','financeiro_controle.execucoes') and entity=='financeiro_origem.lotes': continue
            where=self.sql.SQL(' AND ').join(self.sql.SQL('{}=%s').format(self.sql.Identifier(c)) for c in child_columns)
            rows=self.db.execute(self.sql.SQL('SELECT to_jsonb(c) FROM {} c WHERE {}').format(self.sql.Identifier(schema,table),where),[parent[c] for c in parent_columns]).fetchall()
            pk=[r[0] for r in self.db.execute("SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=to_regclass(%s) AND i.indisprimary ORDER BY a.attnum",(child,))]
            for raw in rows:
                if not pk or (child,fingerprint({c:raw[0][c] for c in pk})) not in owned: return True
        return False
    def undo(self,row):
        entity=row['entity']; where,params=self.predicates(row['item_key'])
        if row['operation']=='insert': self.db.execute(self.sql.SQL('DELETE FROM {} WHERE {}').format(self.relation(entity),where),params)
        elif entity=='financeiro.estado_carga': self.write(dict(entity=entity,key=row['item_key'],values=row['before_row']),'update')
        else: raise ValueError('unsupported_recovery_update')
    def mark_recovered(self,batch): self.db.execute("UPDATE financeiro_controle.execucoes SET status='recovered' WHERE lote_id=%s",(batch,))
    def constraints_immediate(self): self.db.execute('SET CONSTRAINTS ALL IMMEDIATE')
    def constraints_deferred(self): self.db.execute('SET CONSTRAINTS ALL DEFERRED')
