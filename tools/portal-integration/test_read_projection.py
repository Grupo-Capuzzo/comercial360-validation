from decimal import Decimal
import unittest
from read_projection import project, classify

class ProjectionTests(unittest.TestCase):
    def binding(self): return dict(approved=True,empresa_id='synthetic-a',cliente_id_global='synthetic-client',posicao_crm_id='existing-synthetic')
    def test_precision_and_no_bank_exposure(self):
        row=project('shares',dict(id=1,share_value=Decimal('10.250000000001'),pix_key='synthetic-sensitive',status='withdrawn',withdrawal_date='2026-01-01'),self.binding(),'synthetic','batch')
        self.assertEqual(row['valor_preservado'],'10.250000000001')
        self.assertEqual(row['status'],'withdrawn')
        self.assertNotIn('pix_key',row['detalhes'])
        self.assertEqual(row['posicao_crm_id'],'existing-synthetic')
    def test_approval_and_float_required(self):
        binding=self.binding(); binding['approved']=False
        with self.assertRaises(ValueError): project('clients',{'id':1},binding,'synthetic','batch')
        with self.assertRaises(ValueError): project('shares',{'id':1,'share_value':0.1},self.binding(),'synthetic','batch')
    def test_current_fields_are_compared(self):
        self.assertEqual(classify({'status':'old'},{'status':'new'}),'blocked')
        self.assertEqual(classify({'status':'same'},{'status':'same'}),'unchanged')

if __name__ == '__main__': unittest.main()
