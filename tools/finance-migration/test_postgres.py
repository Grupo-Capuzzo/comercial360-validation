"""REAL PostgreSQL suite: fails rather than skips when local DSN is unavailable.

Uses only synthetic fixtures. Requires a fresh PostgreSQL 17 marked database.
Auth helper below emulates auth.uid; it does NOT validate Supabase JWTs or E2E.
"""
import concurrent.futures
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from decimal import Decimal
import json
from contextlib import closing
from unittest.mock import patch
from engine import local_rehearsal
from local_connection import connect_local
from local_recovery import recover
from source import digest
from synthetic import create,client,loan
from local_projection import project_titles
from target_reconcile import reconcile

ROOT=Path(__file__).parent
DSN=os.environ.get('FINANCE_LOCAL_POSTGRES_DSN','')


class PostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.path=Path(cls.temp.name)/'synthetic.sqlite'
        create(cls.path); client(cls.path)
        with connect_local(DSN) as db:
            version=db.execute('SHOW server_version').fetchone()[0]
            if int(db.execute('SHOW server_version_num').fetchone()[0])//10000!=17:
                raise ValueError('PostgreSQL_17_required')
            print(json.dumps({'postgresql_version':version,'auth_model':'synthetic SQL roles, not JWT'}))
            db.execute("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated")
            db.execute('CREATE SCHEMA comercial_360; CREATE TABLE comercial_360.empresas(empresa_id uuid PRIMARY KEY); CREATE TABLE comercial_360.clientes(cliente_id_global uuid PRIMARY KEY); CREATE TABLE comercial_360.produtos(produto_id uuid PRIMARY KEY,empresa_id uuid REFERENCES comercial_360.empresas)')
        for name in ['financeiro_origem','portal_acesso','financeiro_operacional']:
            with connect_local(DSN) as db:
                db.execute((ROOT/'migrations'/f'{name}.review.sql').read_text())

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def load(self,source):
        return local_rehearsal(self.path,DSN,source,'synthetic-reference',digest(self.path))

    def assume(self,db,role):
        from psycopg import sql
        db.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
        actual=db.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
        self.assertEqual(actual,(role,False,False))
        owners=db.execute("SELECT count(*) FROM pg_tables WHERE schemaname IN ('financeiro','portal_acesso','financeiro_origem') AND tableowner=current_user").fetchone()[0]
        self.assertEqual(owners,0)

    def test_repeat_and_selective_recovery(self):
        self.assertEqual(self.load('repeat')['insert'],1)
        self.assertEqual(self.load('repeat')['insert'],0)
        checks=reconcile(self.path,DSN,'repeat')
        self.assertTrue(all(not (r['missing'] or r['extra'] or r['changed']) for r in checks.values()))
        lote='repeat:'+digest(self.path)
        with connect_local(DSN) as db:
            db.execute("UPDATE financeiro_origem.clients SET full_name='Edited synthetic' WHERE source_system='repeat'")
        with self.assertRaises(ValueError): self.load('repeat')
        self.assertEqual(recover(DSN,lote)['blocked_count'],1)
        with self.assertRaises(ValueError): recover(DSN,lote,execute=True)
        with connect_local(DSN) as db:
            db.execute("UPDATE financeiro_origem.clients SET full_name='Synthetic fixture' WHERE source_system='repeat'")
        self.assertTrue(recover(DSN,lote,execute=True)['executed'])
        with connect_local(DSN) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.clients WHERE source_system='repeat'").fetchone()[0],0)

    def test_transaction_failure_no_partial_load(self):
        # Raise after INSERT during the mandatory post-insert reconciliation.
        import engine
        original=engine.target_state
        calls=[]
        def fail_after_insert(db,source):
            calls.append(source)
            if len(calls)==2: raise ValueError('synthetic_failure')
            return original(db,source)
        with patch.object(engine,'target_state',side_effect=fail_after_insert),self.assertRaises(ValueError): self.load('rollback')
        with connect_local(DSN) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.clients WHERE source_system='rollback'").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.lotes WHERE source_system='rollback'").fetchone()[0],0)

    def test_concurrent_imports(self):
        with concurrent.futures.ThreadPoolExecutor(2) as executor:
            results=list(executor.map(lambda _:self.load('concurrent'),range(2)))
        self.assertEqual(sum(r['insert'] for r in results),1)

    def test_batch_origin_fk(self):
        self.load('coherent')
        self.load('other-coherent')
        import psycopg
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro_origem.clients SET lote_id=%s WHERE source_system='coherent'",('other-coherent:'+digest(self.path),))
                db.execute('SET CONSTRAINTS ALL IMMEDIATE')

    def test_authorization_sql_roles_not_jwt_validation(self):
        a='00000000-0000-0000-0000-000000000001'; b='00000000-0000-0000-0000-000000000002'
        c='00000000-0000-0000-0000-000000000003'
        with connect_local(DSN) as db:
            db.execute('INSERT INTO auth.users VALUES (%s),(%s),(%s)',(a,b,c))
            db.execute('INSERT INTO comercial_360.empresas VALUES (%s),(%s)',(a,b))
            db.execute('INSERT INTO comercial_360.clientes VALUES (%s)',(a,))
            db.execute('INSERT INTO comercial_360.produtos VALUES (%s,%s)',(a,a))
            db.execute("INSERT INTO portal_acesso.permissoes VALUES (%s,%s,'financeiro',true,false),(%s,%s,'financeiro',true,false),(%s,%s,'comercial',true,false)",(a,a,b,b,c,a))
        path=Path(self.temp.name)/'loans.sqlite'; create(path); loan(path)
        local_rehearsal(path,DSN,'authslice','synthetic',digest(path))
        self.assertEqual(project_titles(DSN,'authslice',{1:(a,a,a)})['inserted'],1)
        self.assertEqual(project_titles(DSN,'authslice',{1:(a,a,a)})['inserted'],0)
        self.assertEqual(recover(DSN,'authslice:'+digest(path))['blocked_count'],1)
        for user,expected,titles in [(a,1,1),(b,1,0),(c,1,0),('',0,0)]:
            with connect_local(DSN) as db:
                self.assume(db,'authenticated')
                db.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(user,))
                self.assertEqual(db.execute('SELECT count(*) FROM portal_acesso.permissoes').fetchone()[0],expected)
                self.assertEqual(db.execute('SELECT count(*) FROM financeiro.vinculos_titulos').fetchone()[0],titles)
        with connect_local(DSN) as db:
            db.execute('UPDATE portal_acesso.permissoes SET pode_ler=false WHERE usuario_id=%s',(a,))
        with connect_local(DSN) as db:
            self.assume(db,'authenticated')
            db.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(a,))
            self.assertEqual(db.execute('SELECT count(*) FROM financeiro.vinculos_titulos').fetchone()[0],0)
        import psycopg
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with connect_local(DSN) as db:
                self.assume(db,'authenticated')
                db.execute('UPDATE portal_acesso.permissoes SET pode_ler=true')
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with connect_local(DSN) as db:
                self.assume(db,'anon')
                db.execute('SELECT * FROM financeiro.vinculos_titulos')

    def test_decimal_recovery_from_postgres(self):
        path=Path(self.temp.name)/'numeric.sqlite'; create(path); loan(path)
        local_rehearsal(path,DSN,'numeric','synthetic',digest(path))
        self.assertEqual(recover(DSN,'numeric:'+digest(path))['blocked_count'],0)
        self.assertTrue(recover(DSN,'numeric:'+digest(path),execute=True)['executed'])

    def test_target_extra_prevents_success(self):
        self.load('extras')
        with connect_local(DSN) as db:
            db.execute("INSERT INTO financeiro_origem.clients(source_system,lote_id,source_fingerprint,id,full_name,cpf,status,created_at,updated_at) SELECT source_system,lote_id,source_fingerprint,2,'Extra synthetic','000002',status,created_at,updated_at FROM financeiro_origem.clients WHERE source_system='extras'")
        with self.assertRaises(ValueError): self.load('extras')

    def test_missing_fields_and_types_constraints(self):
        import psycopg
        self.load('constraints')
        with self.assertRaises(psycopg.errors.NotNullViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro_origem.clients SET id=NULL WHERE source_system='constraints'")
        with self.assertRaises(psycopg.errors.NotNullViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro_origem.clients SET full_name=NULL WHERE source_system='constraints'")
        with connect_local(DSN) as db:
            dtype=db.execute("SELECT data_type FROM information_schema.columns WHERE table_schema='financeiro_origem' AND table_name='private_loans' AND column_name='original_amount'").fetchone()[0]
            self.assertEqual(dtype,'numeric')
            precise=Decimal('12345678901234567890123456789.123456789')
            self.assertEqual(db.execute('SELECT %s::numeric',(precise,)).fetchone()[0],precise)

    def test_snapshot_occurrences_and_metadata(self):
        self.load('snapshots')
        next_path=Path(self.temp.name)/'snapshot-two.sqlite'; create(next_path); client(next_path)
        with closing(sqlite3.connect(next_path)) as db,db:
            db.execute("INSERT INTO clients(id,full_name,cpf,status,created_at,updated_at) VALUES (2,'Synthetic second','000002','active','2026-01-01','2026-01-01')")
        h=digest(next_path)
        self.assertEqual(local_rehearsal(next_path,DSN,'snapshots','synthetic-reference',h),{'insert':1,'unchanged':1})
        with connect_local(DSN) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.lotes WHERE source_system='snapshots'").fetchone()[0],2)
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.ocorrencias WHERE source_system='snapshots'").fetchone()[0],3)
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.clients WHERE source_system='snapshots'").fetchone()[0],2)
        # Missing snapshot rows are extras, never implicitly removed.
        with self.assertRaises(ValueError): self.load('snapshots')
        with self.assertRaises(ValueError): local_rehearsal(next_path,DSN,'snapshots','changed-reference',h)

    def test_fk_orphan_rejected_and_transaction_preserved(self):
        import psycopg
        path=Path(self.temp.name)/'fk.sqlite'; create(path); loan(path)
        local_rehearsal(path,DSN,'fk','synthetic',digest(path))
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro_origem.private_loans SET private_client_id=999 WHERE source_system='fk'")
                db.execute('SET CONSTRAINTS ALL IMMEDIATE')
        with connect_local(DSN) as db:
            self.assertEqual(db.execute("SELECT private_client_id FROM financeiro_origem.private_loans WHERE source_system='fk'").fetchone()[0],1)

    def test_recovery_preserves_other_batches(self):
        self.load('preserve-original')
        self.load('preserve-other')
        recover(DSN,'preserve-original:'+digest(self.path),execute=True)
        with connect_local(DSN) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM financeiro_origem.clients WHERE source_system='preserve-other'").fetchone()[0],1)

    def test_decimal_changed_recovery_blocked(self):
        path=Path(self.temp.name)/'edited-numeric.sqlite'; create(path); loan(path)
        local_rehearsal(path,DSN,'edited-numeric','synthetic',digest(path))
        with connect_local(DSN) as db:
            db.execute("UPDATE financeiro_origem.private_loans SET original_amount=10.250000000001 WHERE source_system='edited-numeric'")
        self.assertEqual(recover(DSN,'edited-numeric:'+digest(path))['blocked_count'],1)
        with self.assertRaises(ValueError): recover(DSN,'edited-numeric:'+digest(path),execute=True)

    def test_missing_target_reconciliation(self):
        self.load('missing')
        with connect_local(DSN) as db:
            db.execute("DELETE FROM financeiro_origem.clients WHERE source_system='missing'")
        checks=reconcile(self.path,DSN,'missing')
        self.assertEqual(checks['clients']['missing'],1)
        self.assertEqual(self.load('missing')['insert'],1)


if __name__=='__main__': unittest.main()
