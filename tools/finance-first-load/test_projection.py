import unittest
from decimal import Decimal
from projection import build
from synthetic_support import fixture,SNAPSHOT,CUSTOMER,new_customer_matches
from reconciliation import exact_total,groups

class ProjectionTests(unittest.TestCase):
    def setUp(self): self.rows,self.m=fixture()
    def project(self): return build(self.rows,self.m,'synthetic','synthetic:'+SNAPSHOT)
    def row(self,table): return next(r for t,r in self.rows if t==table)
    def test_all_fifteen_projection_sources_and_relationships(self):
        result=self.project(); self.assertEqual(len(result['rows']),15); self.assertTrue(result['relationships'])
    def test_history_status_precision_and_no_bank_fields(self):
        self.row('shares')['pix_key']='synthetic-private'; self.row('shares')['maturity_date']='2027-01-01'
        row=next(r for r in self.project()['rows'] if r['tabela_origem']=='shares')
        self.assertEqual(row['valor_preservado'],'10.250000000001'); self.assertEqual(row['status'],'synthetic-original-status')
        self.assertEqual(row['detalhes']['maturity_date'],'2027-01-01'); self.assertNotIn('pix_key',row['detalhes'])
    def test_remittance_is_not_converted_to_payment(self):
        rows=self.project()['rows']; self.assertEqual(sum(r['tipo']=='recebimentos' for r in rows),1)
        self.assertEqual(sum(r['tipo']=='remessas' for r in rows),2)
    def test_customer_hold_preserves_dependency_reason(self):
        for r in self.m['clients']: r.update(decision='hold',reason='synthetic-review')
        result=self.project(); self.assertGreater(len(result['held']),2); self.assertEqual(len(result['new_customers']),0)
    def test_every_origin_customer_requires_decision(self):
        self.m['clients']=self.m['clients'][:1]
        with self.assertRaises(ValueError): self.project()
    def test_cross_table_customer_conflict_blocks(self):
        self.m['clients'][1]['destination_cliente_id_global']='00000000-0000-0000-0000-000000000004'
        with self.assertRaisesRegex(ValueError,'explicit_cross_table_identity_conflict'): self.project()
    def test_product_mapping_missing_blocks(self):
        self.m['products']={}
        with self.assertRaises(ValueError): self.project()
    def test_calculation_relationship_conflict_blocks(self):
        self.row('monthly_calculation_items')['client_id']=999
        with self.assertRaises(ValueError): self.project()
    def test_payment_loan_conflict_blocks(self):
        self.row('private_loan_payments')['loan_id']=999
        with self.assertRaises(ValueError): self.project()
    def test_no_automatic_individual_CRM_position_link(self):
        self.m['share_links']={'1':'synthetic-position'}
        with self.assertRaises(ValueError): self.project()
    def test_group_totals_are_exact_and_not_header_plus_items(self):
        value=exact_total([Decimal('123456789012345678901234567890.01'),Decimal('0.02')])
        self.assertEqual(str(value),'123456789012345678901234567890.03')
        self.assertIsNone(exact_total([]))
        self.assertEqual(len([g for g in groups(self.project()['rows']) if g['group'][2].startswith('bank_remittance')]),2)
    def test_unapproved_customer_blocks(self):
        self.m['clients'][0]['approved']=False
        with self.assertRaises(ValueError): self.project()
    def test_new_customer_minimal_seed_and_no_auth_account(self):
        self.m=new_customer_matches(self.m)
        r=self.project(); self.assertEqual(len(r['new_customers']),1)
        self.assertEqual(set(r['new_customers'][0]),{'cliente_id_global','nome_preferencial','cpf_cnpj_normalizado','tipo_pessoa'})
    def test_invalid_new_document_checksum_blocks(self):
        self.m=new_customer_matches(self.m)
        s=self.m['clients'][0]['seed']; s['cpf_cnpj_normalizado']=s['cpf_cnpj_normalizado'][:-1]+str((int(s['cpf_cnpj_normalizado'][-1])+1)%10)
        with self.assertRaisesRegex(ValueError,'invalid_new_customer_document'): self.project()
    def test_invalid_destination_UUID_blocks(self):
        self.m['empresa_id']='not-a-UUID'
        with self.assertRaisesRegex(ValueError,'invalid_destination_UUID'): self.project()

if __name__=='__main__': unittest.main()
