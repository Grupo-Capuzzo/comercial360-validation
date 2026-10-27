"""Synthetic fixtures only, outside the repository when executed."""
import sqlite3
from contextlib import closing
from source import quote
from engine import SPEC


def create(path, drift=False):
    with closing(sqlite3.connect(path)) as db, db:
        for table,spec in SPEC.items():
            columns = [quote(c['name'])+' '+('TEXT' if drift else c['type'])+(' NOT NULL' if c['not_null'] else '') for c in spec['columns']]
            pk = sorted((c for c in spec['columns'] if c['pk_order']),key=lambda c:c['pk_order'])
            columns.append('PRIMARY KEY ('+','.join(quote(c['name']) for c in pk)+')')
            groups = {}
            for fk in spec['foreign_keys']:
                groups.setdefault(fk[0],[]).append(fk)
            for group in groups.values():
                group.sort(key=lambda f:f[1])
                columns.append('FOREIGN KEY ('+','.join(quote(f[3]) for f in group)+') REFERENCES '+quote(group[0][2])+' ('+','.join(quote(f[4]) for f in group)+')')
            db.execute('CREATE TABLE '+quote(table)+' ('+','.join(columns)+')')
    db.close()


def client(path):
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("INSERT INTO clients (id,full_name,cpf,status,created_at,updated_at) VALUES (1,'Synthetic fixture','000001','active','2026-01-01','2026-01-01')")
    db.close()


def loan(path):
    with closing(sqlite3.connect(path)) as db, db:
        for table in ['private_loan_clients','private_loans']:
            row={}
            for c in SPEC[table]['columns']:
                if c['pk_order'] or c['not_null']:
                    row[c['name']]=1 if c['type']=='INTEGER' else 10.25 if c['type']=='REAL' else 'synthetic'
            row['id']=1
            columns=list(row)
            db.execute('INSERT INTO '+quote(table)+' ('+','.join(map(quote,columns))+') VALUES ('+','.join('?' for _ in columns)+')',list(row.values()))
