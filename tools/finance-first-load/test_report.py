import unittest
from report_matches import enrich
from render_review import render,draft

class ReportTests(unittest.TestCase):
    def report(self):
        previous=dict(project_ref='umvldqzzliqmgkvoedyd',origin_snapshot='2026-01-01',records=[
            dict(table=t,source_id=1,status='duplicate_source_document',candidate_cliente_id_global=None)
            for t in ('clients','private_loan_clients')])
        source=[dict(table=t,source_id=1,document='synthetic-group',linked_client_id=1 if t=='private_loan_clients' else None)
                for t in ('clients','private_loan_clients')]
        result=enrich(previous,source,dict(clients=[])); result['investment_review']=dict(records=[],known_jobs=[])
        return result
    def test_records_not_people_and_overlap_not_added(self):
        r=self.report(); self.assertEqual(r['counts']['source_records'],2)
        self.assertEqual(r['counts']['explicit_cross_table_links'],1)
        self.assertEqual(r['counts']['duplicated_document_groups'],1)
        self.assertEqual(r['counts']['confirmed'],0)
    def test_report_does_not_expose_source_document(self):
        r=self.report(); self.assertNotIn('synthetic-group',str(r))
        self.assertIn('suspender a primeira carga integral',render(r))
    def test_draft_does_not_approve_or_apply_candidates(self):
        r=draft(self.report(),'a'*64); self.assertFalse(r['approved'])
        self.assertTrue(all(m['approved'] is False and m['decision'] is None for m in r['clients']))

if __name__=='__main__': unittest.main()
