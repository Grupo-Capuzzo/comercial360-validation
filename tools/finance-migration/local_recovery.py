"""Selective recovery executable ONLY on the marked disposable local database.

Atomic fail-closed: any edited row or later inbound FK prevents all deletes.
Batch and observation metadata are retained as audit evidence.
"""
from engine import SPEC, key
from local_connection import connect_local
from recovery import recovery_plan


def recover(dsn,lote_id,execute=False):
    from psycopg import sql
    with connect_local(dsn) as db:
        batch=db.execute('SELECT source_system FROM financeiro_origem.lotes WHERE id=%s',(lote_id,)).fetchone()
        if not batch: raise ValueError('unknown_batch')
        source=batch[0]
        db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',(source,))
        # Catalog driven inbound FKs: includes operational links added after import.
        fks=list(db.execute("""SELECT ns.nspname, child.relname, parent.relname,
          array_agg(ca.attname ORDER BY k.ord),array_agg(pa.attname ORDER BY k.ord)
          FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid
          JOIN pg_namespace ns ON ns.oid=child.relnamespace
          JOIN pg_class parent ON parent.oid=f.confrelid
          JOIN pg_namespace pn ON pn.oid=parent.relnamespace
          CROSS JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY k(cid,pid,ord)
          JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=k.cid
          JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=k.pid
          WHERE f.contype='f' AND pn.nspname='financeiro_origem'
          GROUP BY f.oid,ns.nspname,child.relname,parent.relname"""))
        locks={('financeiro_origem',t) for t in SPEC}
        locks.update((ns,child) for ns,child,parent,cc,pc in fks if parent in SPEC)
        for ns,t in sorted(locks):
            db.execute(sql.SQL('LOCK TABLE {}.{} IN SHARE ROW EXCLUSIVE MODE').format(sql.Identifier(ns),sql.Identifier(t)))
        records=[]
        for table,spec in SPEC.items():
            names=[c['name'] for c in spec['columns']]
            query=sql.SQL('SELECT {},source_fingerprint FROM financeiro_origem.{} WHERE source_system=%s AND lote_id=%s').format(sql.SQL(',').join(map(sql.Identifier,names)),sql.Identifier(table))
            for raw in db.execute(query,(source,lote_id)):
                row=dict(zip(names,raw[:-1])); later=False
                for ns,child,parent,cc,pc in fks:
                    if parent!=table: continue
                    values=[source if c=='source_system' else row[c] for c in pc]
                    predicates=[sql.SQL('{}=%s').format(sql.Identifier(c)) for c in cc]
                    if ns=='financeiro_origem' and child in SPEC:
                        predicates.append(sql.SQL('lote_id<>%s')); values.append(lote_id)
                    found=db.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE {} LIMIT 1').format(sql.Identifier(ns),sql.Identifier(child),sql.SQL(' AND ').join(predicates)),values).fetchone()
                    later=later or bool(found)
                records.append(dict(key=key(table,row,source),created_by_lote=lote_id,imported_fingerprint=raw[-1],current_source_fields=row,has_later_references=later))
        result=recovery_plan(records,lote_id)
        result['executable']=not result['blocked']
        if execute:
            if result['blocked']: raise ValueError('recovery_blocked')
            db.execute('SET CONSTRAINTS ALL DEFERRED')
            # All internal dependencies are deferred; no cascades into another lot.
            for table in reversed(list(SPEC)):
                db.execute(sql.SQL('DELETE FROM financeiro_origem.{} WHERE source_system=%s AND lote_id=%s').format(sql.Identifier(table)),(source,lote_id))
            db.execute('SET CONSTRAINTS ALL IMMEDIATE')
        return {'eligible_count':len(result['eligible']),'blocked_count':len(result['blocked']),'executed':execute}
