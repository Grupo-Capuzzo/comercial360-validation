"""Full-field comparison against a LOCAL rehearsal Postgres. Aggregate output only."""
import argparse
import json
import os
from decimal import Decimal
from engine import SPEC, source_rows, key
from local_connection import connect_local


def normalize(row, spec):
    return {c['name']: Decimal(str(row[c['name']])) if c['type']=='REAL' and row[c['name']] is not None else row[c['name']] for c in spec['columns']}


def reconcile(sqlite_path, dsn, source_system):
    import psycopg
    from psycopg import sql
    source={key(t,r,source_system):normalize(r,SPEC[t]) for t,r in source_rows(sqlite_path)}
    result={}
    with connect_local(dsn) as db:
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        for table,spec in SPEC.items():
            if not spec['import']:
                continue
            cols=[c['name'] for c in spec['columns']]
            target={}
            for record in db.execute(sql.SQL('SELECT {} FROM financeiro_origem.{} WHERE source_system=%s').format(
                sql.SQL(',').join(map(sql.Identifier,cols)),sql.Identifier(table)),(source_system,)):
                row=dict(zip(cols,record))
                target[key(table,row,source_system)]=normalize(row,spec)
            expected={k:v for k,v in source.items() if k[1]==table}
            missing=set(expected)-set(target)
            extra=set(target)-set(expected)
            different=sum(target[k]!=expected[k] for k in set(target)&set(expected))
            result[table]={'source_count':len(expected),'target_count':len(target),'missing':len(missing),'extra':len(extra),'changed':different}
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--sqlite',required=True)
    p.add_argument('--source-system',required=True)
    a=p.parse_args()
    try:
        result=reconcile(a.sqlite,os.environ['FINANCE_LOCAL_POSTGRES_DSN'],a.source_system)
    except Exception as error:
        print(json.dumps({'failed':True,'error_type':type(error).__name__}))
        raise SystemExit(1)
    print(json.dumps(result))
    raise SystemExit(1 if any(v['missing'] or v['extra'] or v['changed'] for v in result.values()) else 0)
