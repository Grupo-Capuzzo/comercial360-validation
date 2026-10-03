"""Prepared CI-only row/schema comparison after isolated synthetic pg_restore."""
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'finance-migration'))
from local_connection import connect_local,parameters
from policy import fingerprint

def snapshot(db):
    tables=db.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('comercial_360','financeiro','financeiro_origem','financeiro_controle','portal_acesso','auth','public') ORDER BY schemaname,tablename").fetchall()
    from psycopg import sql
    from psycopg.types.json import set_json_loads
    import json
    from decimal import Decimal
    set_json_loads(lambda s:json.loads(s,parse_float=Decimal),context=db)
    results={}
    for schema,table in tables:
        rows=[r[0] for r in db.execute(sql.SQL('SELECT to_jsonb(t) FROM {} t').format(sql.Identifier(schema,table)))]
        results[schema+'.'+table]=dict(count=len(rows),hash=fingerprint(sorted(fingerprint(r) for r in rows)))
    definitions=db.execute("""SELECT n.nspname,c.relname,c.relrowsecurity,c.relowner::regrole::text,
      (SELECT array_agg(pg_get_constraintdef(f.oid) ORDER BY f.conname) FROM pg_constraint f WHERE f.conrelid=c.oid),
      (SELECT array_agg(pg_get_expr(p.polqual,p.polrelid) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname IN ('comercial_360','financeiro','financeiro_origem','financeiro_controle','portal_acesso','auth','public') ORDER BY n.nspname,c.relname""").fetchall()
    return dict(tables=results,definitions=fingerprint(definitions))

def main():
    dsn=os.environ.get('FIRST_LOAD_LOCAL_POSTGRES_DSN','')
    params=parameters(dsn)
    if params['dbname']!='capuzzo_test_first_load': raise ValueError('specific_synthetic_source_database_required')
    restore=dsn.rsplit('/',1)[0]+'/capuzzo_test_restore'
    with connect_local(dsn) as original,connect_local(restore) as restored:
        before=snapshot(original); after=snapshot(restored)
        if before!=after or not before['tables'] or not before['tables'].get('financeiro_controle.execucoes',{}).get('count'):
            raise ValueError('synthetic_restore_does_not_match')
    print('synthetic_backup_restore_verified; NOT production backup or production restore')

if __name__=='__main__': main()
