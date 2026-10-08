"""Prepared PostgreSQL 17 rehearsal. Synthetic SQL sessions, NOT Supabase JWT/SSR.

Requires a FRESH, explicitly marked capuzzo_test_* database. Never falls back
to operational connection; never skips when the driver/database is unavailable.
"""
import concurrent.futures
import copy
import json
import os
import unittest
from decimal import Decimal
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parents[1]/'finance-migration'))
from local_connection import connect_local
from postgres_store import PostgresStore
from executor import prepare_items,preview,apply,recover,reconcile
from policy import fingerprint
from synthetic_support import fixture,new_customer_matches,COMPANY,CUSTOMER,PRODUCT,SNAPSHOT

DSN=os.environ.get('FIRST_LOAD_LOCAL_POSTGRES_DSN','')
USER='00000000-0000-0000-0000-000000000010'
SESSION='00000000-0000-0000-0000-000000000011'
OTHER_COMPANY='00000000-0000-0000-0000-000000000020'

class FirstLoadPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect_local(DSN) as db:
            if int(db.execute('SHOW server_version_num').fetchone()[0])//10000!=17:
                raise ValueError('PostgreSQL_17_required')
            print(json.dumps({'postgresql_version':db.execute('SHOW server_version').fetchone()[0],'auth':'SQL synthetic, NOT JWT'}))
            if db.execute("SELECT count(*) FROM pg_namespace WHERE nspname IN ('comercial_360','financeiro','financeiro_origem','financeiro_controle','portal_acesso','auth')").fetchone()[0]:
                raise ValueError('fresh_disposable_database_required')
            db.execute("""DO $$ BEGIN
              IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOSUPERUSER NOBYPASSRLS; END IF;
              IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOSUPERUSER NOBYPASSRLS; END IF;
              END $$;
              CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
              CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users);
              CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
              CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true)) $$;
              GRANT USAGE ON SCHEMA auth TO authenticated;
              GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated;
              CREATE SCHEMA comercial_360;
              CREATE TABLE comercial_360.empresas(empresa_id uuid PRIMARY KEY);
              CREATE TABLE comercial_360.clientes(cliente_id_global uuid PRIMARY KEY,tipo_pessoa text NOT NULL DEFAULT 'NA',cpf_cnpj_normalizado text,nome_preferencial text NOT NULL,status_cliente text NOT NULL DEFAULT 'em_validacao',qualidade_cadastro text NOT NULL DEFAULT 'D',tem_conflito boolean NOT NULL DEFAULT false,criado_em timestamptz NOT NULL DEFAULT now(),atualizado_em timestamptz NOT NULL DEFAULT now());
              CREATE TABLE comercial_360.produtos(produto_id uuid PRIMARY KEY,empresa_id uuid NOT NULL REFERENCES comercial_360.empresas,ativo boolean NOT NULL DEFAULT true);
              CREATE TABLE comercial_360.investimento_posicoes(posicao_id uuid PRIMARY KEY);
            """)
            db.execute('INSERT INTO comercial_360.empresas VALUES (%s),(%s)',(COMPANY,OTHER_COMPANY))
            db.execute('INSERT INTO comercial_360.produtos VALUES (%s,%s,true)',(PRODUCT,COMPANY))
            db.execute("INSERT INTO comercial_360.clientes(cliente_id_global,nome_preferencial) VALUES (%s,'Synthetic retained customer')",(CUSTOMER,))
            db.execute('INSERT INTO auth.users VALUES (%s)',(USER,))
            db.execute('INSERT INTO auth.sessions VALUES (%s,%s)',(SESSION,USER))

    def make(self,source=None):
        rows,matches=fixture()
        return prepare_items(rows,matches,source or self._testMethodName,SNAPSHOT,'2026-01-01')
    def store(self): return PostgresStore(connect_local(DSN))
    def approved(self,store,intent):
        with store.read_only():
            return dict(plan_sha256=fingerprint(intent),expected_conditions_sha256=fingerprint(store.conditions(intent)),expected_changes=preview(store,intent)['summary'])
    def load(self,intent,store=None,approval=None,callback=None):
        own=store is None; store=store or self.store()
        try:
            a=approval or self.approved(store,intent)
            return apply(store,intent,a,'synthetic-approval','APPLY:synthetic-approval',before_commit=callback)
        finally:
            if own: store.close()
    def recovery(self,store,intent):
        return recover(store,intent['batch_id'],'synthetic-approval','RECOVER:synthetic-approval:'+intent['batch_id'])

    def test_00_DDL_and_data_rollback(self):
        intent=self.make()
        def changed(): raise ValueError('synthetic_before_commit_failure')
        with self.assertRaisesRegex(ValueError,'synthetic_before_commit_failure'): self.load(intent,callback=changed)
        with connect_local(DSN) as db:
            self.assertIsNone(db.execute("SELECT to_regnamespace('financeiro_controle')").fetchone()[0])
            self.assertEqual(db.execute('SELECT count(*) FROM comercial_360.clientes').fetchone()[0],1)
        self.load(intent)

    def test_first_load_full_reconciliation(self):
        intent=self.make(); self.load(intent)
        s=self.store()
        try:
            with s.read_only(): self.assertTrue(reconcile(s,intent))
        finally: s.close()

    def test_repeat_no_duplication(self):
        intent=self.make(); self.load(intent)
        self.assertTrue(self.load(intent)['already_applied'])
        with connect_local(DSN) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM financeiro_origem.shares WHERE source_system=%s',(intent['source_system'],)).fetchone()[0],1)

    def test_decimal_and_original_status(self):
        intent=self.make(); self.load(intent)
        with connect_local(DSN) as db:
            value,status=db.execute("SELECT valor_preservado,status FROM financeiro.registros_consulta WHERE source_system=%s AND tabela_origem='shares'",(intent['source_system'],)).fetchone()
            self.assertEqual(value,Decimal('10.250000000001')); self.assertEqual(status,'synthetic-original-status')

    def test_source_batch_origin_trigger(self):
        import psycopg
        intent=self.make(); self.load(intent)
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro.registros_consulta SET origem_id='999' WHERE source_system=%s AND tabela_origem='shares'",(intent['source_system'],))

    def test_product_company_constraint(self):
        import psycopg
        intent=self.make(); self.load(intent)
        with self.assertRaises(psycopg.errors.CheckViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro.registros_consulta SET empresa_id=%s WHERE source_system=%s AND tabela_origem='shares'",(OTHER_COMPANY,intent['source_system']))

    def test_origin_cannot_change_while_projected(self):
        import psycopg
        intent=self.make(); self.load(intent)
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            with connect_local(DSN) as db:
                db.execute("UPDATE financeiro_origem.shares SET status='edited' WHERE source_system=%s",(intent['source_system'],))

    def test_selective_recovery_preserves_CRM(self):
        intent=self.make(); self.load(intent); s=self.store()
        try: self.assertGreater(self.recovery(s,intent)['recovered'],0)
        finally: s.close()
        with connect_local(DSN) as db:
            self.assertEqual(db.execute('SELECT nome_preferencial FROM comercial_360.clientes WHERE cliente_id_global=%s',(CUSTOMER,)).fetchone()[0],'Synthetic retained customer')
            self.assertEqual(db.execute('SELECT status FROM financeiro_controle.execucoes WHERE lote_id=%s',(intent['batch_id'],)).fetchone()[0],'recovered')
            self.assertEqual(db.execute('SELECT count(*) FROM financeiro_origem.shares WHERE source_system=%s',(intent['source_system'],)).fetchone()[0],0)

    def test_recovery_changed_row_blocks(self):
        intent=self.make(); self.load(intent)
        with connect_local(DSN) as db:
            db.execute("UPDATE financeiro.registros_consulta SET descricao='later edit' WHERE source_system=%s AND tabela_origem='shares'",(intent['source_system'],))
        s=self.store()
        try:
            with self.assertRaises(ValueError): self.recovery(s,intent)
        finally: s.close()

    def test_recovery_later_reference_blocks(self):
        intent=self.make(); self.load(intent)
        with connect_local(DSN) as db:
            db.execute('CREATE TABLE public.synthetic_later_reference(source_system text,id bigint,FOREIGN KEY(source_system,id) REFERENCES financeiro_origem.shares(source_system,id))')
            db.execute('INSERT INTO public.synthetic_later_reference VALUES (%s,1)',(intent['source_system'],))
        s=self.store()
        try:
            with self.assertRaises(ValueError): self.recovery(s,intent)
        finally: s.close()

    def test_destination_conditions_drift_blocks(self):
        intent=self.make(); s=self.store()
        try:
            approval=self.approved(s,intent)
            with connect_local(DSN) as db: db.execute("UPDATE comercial_360.clientes SET nome_preferencial='Synthetic drift' WHERE cliente_id_global=%s",(CUSTOMER,))
            with self.assertRaisesRegex(ValueError,'destination_changed_since_approval'): self.load(intent,s,approval)
        finally:
            s.close()
            with connect_local(DSN) as db: db.execute("UPDATE comercial_360.clientes SET nome_preferencial='Synthetic retained customer' WHERE cliente_id_global=%s",(CUSTOMER,))

    def test_concurrent_same_origin(self):
        intent=self.make(); s=self.store()
        try: approval=self.approved(s,intent)
        finally: s.close()
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _:self.load(intent,approval=approval),range(2)))
        self.assertEqual(sum(r['already_applied'] for r in results),1)

    def test_conflict_and_extras_not_confirmed(self):
        intent=self.make(); self.load(intent)
        with connect_local(DSN) as db:
            db.execute("UPDATE financeiro.registros_consulta SET descricao='conflict' WHERE source_system=%s AND tabela_origem='shares'",(intent['source_system'],))
        with self.assertRaises(ValueError): self.load(intent)
        extra=self.make(self._testMethodName+'_extra'); self.load(extra)
        with connect_local(DSN) as db:
            db.execute("INSERT INTO financeiro_origem.backups(source_system,lote_id,source_fingerprint,id,file_name,file_path,created_at) SELECT %s,%s,repeat('b',64),999,'synthetic','synthetic','2026-01-01'",(extra['source_system'],extra['batch_id']))
        with self.assertRaises(ValueError): self.load(extra)

    def test_permissions_effective_role_company_module_session(self):
        import psycopg
        intent=self.make(); self.load(intent)
        with connect_local(DSN) as db:
            db.execute("INSERT INTO portal_acesso.permissoes VALUES (%s,%s,'financeiro',true,false)",(USER,COMPANY))
        def count(company=COMPANY,session=SESSION):
            with connect_local(DSN) as db:
                db.execute('SET LOCAL ROLE authenticated')
                self.assertEqual(db.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone(),('authenticated',False,False))
                self.assertEqual(db.execute("SELECT count(*) FROM pg_tables WHERE schemaname IN ('financeiro','financeiro_origem','financeiro_controle','portal_acesso') AND tableowner=current_user").fetchone()[0],0)
                db.execute("SELECT set_config('request.jwt.claim.sub',%s,true),set_config('request.jwt.claim.session_id',%s,true)",(USER,session))
                return db.execute('SELECT count(*) FROM financeiro.registros_consulta WHERE source_system=%s AND empresa_id=%s',(intent['source_system'],company)).fetchone()[0]
        self.assertEqual(count(),15); self.assertEqual(count(OTHER_COMPANY),0); self.assertEqual(count(session=''),0)
        # A denied company must contain rows: querying an empty company is insufficient.
        with connect_local(DSN) as db: db.execute('UPDATE portal_acesso.permissoes SET empresa_id=%s WHERE usuario_id=%s',(OTHER_COMPANY,USER))
        self.assertEqual(count(COMPANY),0)
        with connect_local(DSN) as db: db.execute('UPDATE portal_acesso.permissoes SET empresa_id=%s WHERE usuario_id=%s',(COMPANY,USER))
        self.assertEqual(count(),15)
        with connect_local(DSN) as db: db.execute("UPDATE portal_acesso.permissoes SET modulo='comercial' WHERE usuario_id=%s",(USER,))
        self.assertEqual(count(),0)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with connect_local(DSN) as db:
                db.execute('SET LOCAL ROLE authenticated'); db.execute('SELECT * FROM financeiro_controle.journal')
    def test_new_customer_and_recovery_without_auth_creation(self):
        rows,matches=fixture(); matches=new_customer_matches(matches)
        intent=prepare_items(rows,matches,self._testMethodName,SNAPSHOT,'2026-01-01')
        self.load(intent)
        with connect_local(DSN) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM auth.users').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM comercial_360.clientes WHERE cliente_id_global=%s',(matches['clients'][0]['destination_cliente_id_global'],)).fetchone()[0],1)
        s=self.store()
        try: self.recovery(s,intent)
        finally: s.close()
        with connect_local(DSN) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM comercial_360.clientes WHERE cliente_id_global=%s',(matches['clients'][0]['destination_cliente_id_global'],)).fetchone()[0],0)

if __name__=='__main__': unittest.main(verbosity=2)
