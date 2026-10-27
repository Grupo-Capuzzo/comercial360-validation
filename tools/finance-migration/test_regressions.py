import csv
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch
from engine import SPEC, fingerprint, key, plan, source_rows, local_rehearsal
from local_connection import parameters
from recovery import recovery_plan
from source import connect, digest
from reconcile import cents, aggregate_cents, verify
from synthetic import create, client, loan


class Regressions(unittest.TestCase):
    def test_full_synthetic_schema_and_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'synthetic.sqlite'; create(path); client(path); loan(path)
            self.assertEqual(len(list(source_rows(path))),3)

    def test_unapproved_snapshot_rejected_before_driver(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'synthetic.sqlite'; create(path)
            with patch.dict(os.environ,{},clear=True),self.assertRaises(ValueError):
                local_rehearsal(path,'postgresql://u:p@localhost/capuzzo_test_ci','s','synthetic','0'*64)

    def test_legacy_access_stays_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'synthetic.sqlite'; create(path)
            from source import quote
            from contextlib import closing
            spec=SPEC['portal_usuarios']; row={}
            for c in spec['columns']:
                if c['not_null'] or c['pk_order']:
                    row[c['name']]=1 if c['type']=='INTEGER' else 'synthetic'
            with closing(sqlite3.connect(path)) as db,db:
                db.execute('INSERT INTO portal_usuarios ('+','.join(map(quote,row))+') VALUES ('+','.join('?' for _ in row)+')',list(row.values()))
            with self.assertRaises(ValueError): list(source_rows(path))
    def test_uri_overrides_rejected_before_driver(self):
        for dsn in ['postgresql://localhost/review_db?host=example.invalid',
                    'postgresql://127.0.0.1/review_db?hostaddr=192.0.2.10',
                    'postgresql://u:p@localhost/capuzzo_test_ci?service=prod',
                    'postgresql://u:p@localhost,example.invalid/capuzzo_test_ci',
                    'postgresql://u:p@localhost/production']:
            with self.subTest(dsn=dsn), patch.dict(os.environ,{},clear=True), self.assertRaises(ValueError):
                parameters(dsn)

    def test_environment_rejected(self):
        with patch.dict(os.environ,{'PGSERVICE':'production'},clear=True), self.assertRaises(ValueError):
            parameters('postgresql://u:p@localhost/capuzzo_test_ci')

    def test_only_constructed_parameters(self):
        with patch.dict(os.environ,{},clear=True):
            p=parameters('postgresql://u:p@localhost:5433/capuzzo_test_ci')
        self.assertEqual(p['hostaddr'],'127.0.0.1')
        self.assertEqual(p['port'],5433)

    def test_decimal_recovery(self):
        row={'id':1,'amount':10.25}
        record={'key':key('private_loan_payments',row,'synthetic'),'created_by_lote':'a',
                'imported_fingerprint':fingerprint(row,'private_loan_payments'),
                'current_source_fields':{'id':1,'amount':Decimal('10.2500')},'has_later_references':False}
        self.assertEqual(len(recovery_plan([record],'a')['eligible']),1)
        record['current_source_fields']['amount']=Decimal('10.25001')
        self.assertEqual(len(recovery_plan([record],'a')['blocked']),1)

    def test_precision_and_types(self):
        n=Decimal('12345678901234567890123456789.123456789')
        self.assertNotEqual(fingerprint({'amount':n}),fingerprint({'amount':str(n)}))
        self.assertNotEqual(fingerprint({'amount':n}),fingerprint({'amount':n+1}))
        self.assertEqual(fingerprint({'amount':10.25}),fingerprint({'amount':Decimal('10.250')}))
        self.assertNotEqual(fingerprint({'cpf':'00001'}),fingerprint({'cpf':'1'}))

    def test_stale_hash_and_hash_only_conflict(self):
        row={'id':1,'amount':10.25}; k=key('private_loan_payments',row,'s'); fp=fingerprint(row,'private_loan_payments')
        for old in [fp,{'fingerprint':fp,'row':dict(row,amount=Decimal('999'))}]:
            self.assertEqual(plan([('private_loan_payments',row)],{k:old},'s')[0][4],'conflict')

    def test_extra_classified_not_deleted(self):
        row={'id':1,'amount':10.25}; k=key('private_loan_payments',row,'s')
        extra=key('private_loan_payments',{'id':2},'s')
        old={k:{'row':row,'fingerprint':fingerprint(row,'private_loan_payments')},extra:{'row':{'id':2},'fingerprint':'x'}}
        self.assertEqual([a[4] for a in plan([('private_loan_payments',row)],old,'s')],['unchanged','extra'])

    def test_null_pk_rejected(self):
        with self.assertRaises(ValueError):
            plan([('clients',{'id':None})],{},'s')

    def test_wrong_hash_fails_all_optimization_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); db=root/'synthetic.sqlite'; create(db)
            folder=root/'csv'; folder.mkdir()
            for table,spec in SPEC.items():
                with (folder/(table+'.csv')).open('w',newline='') as f:
                    csv.writer(f).writerow(c['name'] for c in spec['columns'])
            mf=root/'manifest.json'; mf.write_text(json.dumps({'sha256_sqlite':'0'*64,'contagem_por_tabela':{t:0 for t in SPEC}}))
            args=[str(Path(__file__).with_name('source.py')),'--sqlite',str(db),'--manifest',str(mf),'--csv-dir',str(folder)]
            for flags,opt in [([],''),(['-O'],''),(['-OO'],''),([],'2')]:
                env=dict(os.environ,PYTHONOPTIMIZE=opt)
                p=subprocess.run([sys.executable,*flags,*args],env=env,capture_output=True,timeout=20)
                self.assertNotEqual(p.returncode,0)

    def test_schema_drift_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'synthetic.sqlite'; create(path,drift=True)
            with self.assertRaises(ValueError): list(source_rows(path))

    def test_sqlite_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'synthetic.sqlite'; create(path)
            db=connect(path)
            with db: db.execute('SELECT 1')
            with self.assertRaises(sqlite3.ProgrammingError): db.execute('SELECT 1')

    def test_empty_sum_not_missing_value(self):
        self.assertEqual(aggregate_cents(None,0),Decimal('0.00'))
        with self.assertRaises(ValueError): aggregate_cents(None,1)
        with self.assertRaises(ValueError): cents(None)

    def test_empty_remittance(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'synthetic.sqlite'; create(path)
            with sqlite3.connect(path) as db:
                db.execute("INSERT INTO bank_remittance_files (id,condominium_code,bank_name,payment_date,total_payments,total_amount,status,created_at) VALUES (1,'synthetic','SYNTHETIC','2026-01-01',0,0,'generated','2026-01-01')")
            db.close()
            header=dict(id=1,condominium_code='synthetic',bank_name='SYNTHETIC',payment_date='2026-01-01',total_payments=0,total_amount=0,status='generated')
            totals={k:[] for k in ['clientes_por_status','cotas_por_condominio_e_status','apuracoes_mensais','remessas_bancarias','titulos_privados']}
            totals['remessas_bancarias']=[header]
            self.assertTrue(all(verify(path,{'totais_para_conferencia':totals}).values()))


if __name__=='__main__': unittest.main()
