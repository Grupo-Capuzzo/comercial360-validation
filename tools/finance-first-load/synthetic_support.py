"""Synthetic unit-test adapter. NOT PostgreSQL, NOT Auth, NEVER connects remotely."""
import copy
import threading
from contextlib import contextmanager
from decimal import Decimal
from policy import fingerprint
from executor import SPEC

COMPANY='00000000-0000-0000-0000-000000000001'
CUSTOMER='00000000-0000-0000-0000-000000000002'
PRODUCT='00000000-0000-0000-0000-000000000003'
SNAPSHOT='a'*64

def new_customer_matches(matches):
    matches=copy.deepcopy(matches)
    customer='00000000-0000-0000-0000-000000000004'
    # Clearly fabricated input built locally, never sourced from a real record.
    body='0'*8+'1'
    for weights in (range(10,1,-1),range(11,1,-1)):
        remainder=sum(int(c)*w for c,w in zip(body,weights))%11
        body+=str(0 if remainder<2 else 11-remainder)
    for m in matches['clients']: m['destination_cliente_id_global']=customer
    matches['clients'][0].update(decision='create',seed=dict(cliente_id_global=customer,nome_preferencial='Synthetic new customer',cpf_cnpj_normalizado=body,tipo_pessoa='PF'))
    return matches

def fixture():
    tables=['clients','condominiums','shares','monthly_calculations','monthly_calculation_items',
        'private_loan_clients','private_loans','private_loan_installments','private_loan_payments',
        'private_loan_amortizations','private_loan_extensions','bank_remittance_files','bank_remittance_items',
        'central_tarefas','central_etapas','central_subetapas']
    rows=[]
    for table in tables:
        row={}
        for c in SPEC[table]['columns']:
            row[c['name']]=(1 if c['type']=='INTEGER' else Decimal('10.250000000001') if c['type']=='REAL' else 'synthetic') if c['not_null'] or c['pk_order'] else None
        types={c['name']:c['type'] for c in SPEC[table]['columns']}
        row['id']=1 if types['id']=='INTEGER' else '1'
        for name in row:
            if name in ('client_id','condominium_id','monthly_calculation_id','share_id','private_client_id','loan_id','installment_id','remittance_file_id','calculation_item_id','calculation_id','tarefa_id','etapa_id','linked_client_id'): row[name]=1 if types[name]=='INTEGER' else '1'
            if name.endswith('_date') or name in ('created_at','updated_at','period_start','period_end'): row[name]='2026-01-01'
        if 'status' in row: row['status']='synthetic-original-status'
        rows.append((table,row))
    matches=dict(approved=True,empresa_id=COMPANY,portal_name='Synthetic company',products={'1':PRODUCT},loan_product_id=PRODUCT,
        clients=[dict(table=t,source_id=1,destination_cliente_id_global=CUSTOMER,decision='link',approved=True,evidence_reference='synthetic-reviewed') for t in ('clients','private_loan_clients')],
        investment_policy=dict(approved=True,mode='historical_only',dashboard_authority='existing_crm'))
    return rows,matches

class MemoryStore:
    def __init__(self):
        self.data={}; self.runs={}; self.entries=[]; self.initialized=False
        self.references=set(); self.fail_after=None; self.writes=0; self.mutex=threading.RLock()
        self.data[('comercial_360.clientes',fingerprint({'cliente_id_global':CUSTOMER}))]=dict(cliente_id_global=CUSTOMER,nome_preferencial='Synthetic unchanged customer')
    @contextmanager
    def transaction(self):
        with self.mutex:
            before=copy.deepcopy((self.data,self.runs,self.entries,self.initialized))
            try: yield
            except BaseException:
                self.data,self.runs,self.entries,self.initialized=before
                raise
    def get(self,entity,key,lock=False): return copy.deepcopy(self.data.get((entity,fingerprint(key))))
    def conditions(self,intent): return dict(initialized=self.initialized,current=sorted([(e,k,v) for (e,k),v in self.data.items()]))
    def extras(self,source,expected):
        return [(e,k) for (e,k),v in self.data.items() if v.get('source_system')==source and (e,k) not in expected]
    def lock_source(self,source): pass
    def lock_reviewed_references(self,intent): pass
    def lock_migration_tables(self): pass
    def initialize_reviewed_schema(self): self.initialized=True
    def execution(self,batch): return copy.deepcopy(self.runs.get(batch))
    def write(self,entry,action):
        self.writes+=1
        if self.fail_after==self.writes: raise ValueError('synthetic_injected_load_failure')
        k=(entry['entity'],fingerprint(entry['key']))
        if action=='insert' and k in self.data: raise ValueError('duplicate_insert')
        self.data[k]=copy.deepcopy(entry['values'])
    def journal(self,batch,entry,action,before,after_hash):
        self.entries.append(dict(lote_id=batch,entity=entry['entity'],item_key=copy.deepcopy(entry['key']),
            operation=action,before_row=before,after_sha256=after_hash))
    def read_journal(self,batch): return copy.deepcopy([j for j in self.entries if j['lote_id']==batch])
    def check_journal_unchanged(self,batch):
        for j in self.read_journal(batch):
            if fingerprint(self.get(j['entity'],j['item_key']))!=j['after_sha256']: raise ValueError('created_or_changed_row_no_longer_intact')
    def record_execution(self,batch,approval_hash,plan_hash,summary):
        self.runs[batch]=dict(status='completed',approval_sha256=approval_hash,plan_sha256=plan_hash,summary=summary)
    def external_references(self,entity,key,owned): return (entity,fingerprint(key)) in self.references
    def undo(self,row):
        k=(row['entity'],fingerprint(row['item_key']))
        if row['operation']=='insert': del self.data[k]
        else: self.data[k]=copy.deepcopy(row['before_row'])
    def mark_recovered(self,batch): self.runs[batch]['status']='recovered'
    def constraints_immediate(self): pass
    def constraints_deferred(self): pass
