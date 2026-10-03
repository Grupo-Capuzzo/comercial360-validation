import copy
import concurrent.futures
import unittest
from executor import prepare_items,preview,apply,recover
from policy import fingerprint
from synthetic_support import *

class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.rows,self.matches=fixture(); self.store=MemoryStore(); self.digest='synthetic-approval'
        self.intent=prepare_items(self.rows,self.matches,'synthetic',SNAPSHOT,'2026-01-01')
        self.approval=dict(plan_sha256=fingerprint(self.intent),expected_conditions_sha256=fingerprint(self.store.conditions(self.intent)),expected_changes=preview(self.store,self.intent)['summary'])
    def load(self): return apply(self.store,self.intent,self.approval,self.digest,'APPLY:'+self.digest)
    def recovery(self): return recover(self.store,self.intent['batch_id'],self.digest,'RECOVER:'+self.digest+':'+self.intent['batch_id'])
    def test_atomic_first_load_and_reconciliation(self):
        r=self.load(); self.assertFalse(r['already_applied']); self.assertEqual(len(self.store.runs),1)
    def test_idempotent_repeat_without_duplication(self):
        self.load(); before=copy.deepcopy(self.store.data); self.assertTrue(self.load()['already_applied']); self.assertEqual(before,self.store.data)
    def test_destination_drift_blocks(self):
        self.store.initialized=True
        with self.assertRaises(ValueError): self.load()
    def test_wrong_change_count_blocks(self):
        self.approval['expected_changes']['insert']+=1
        with self.assertRaises(ValueError): self.load()
    def test_conflict_cannot_be_overwritten(self):
        entry=self.intent['items'][2]; self.store.data[(entry['entity'],fingerprint(entry['key']))]={'status':'unexpected'}
        self.approval['expected_conditions_sha256']=fingerprint(self.store.conditions(self.intent)); self.approval['expected_changes']=preview(self.store,self.intent)['summary']
        with self.assertRaises(ValueError): self.load()
    def test_extras_prevent_confirmation(self):
        self.store.data[('financeiro_origem.clients','synthetic-extra')]=dict(source_system='synthetic')
        self.approval['expected_conditions_sha256']=fingerprint(self.store.conditions(self.intent)); self.approval['expected_changes']=preview(self.store,self.intent)['summary']
        with self.assertRaises(ValueError): self.load()
    def test_mid_load_failure_rolls_back_everything(self):
        before=copy.deepcopy(self.store.data); self.store.fail_after=6
        with self.assertRaises(ValueError): self.load()
        self.assertEqual(self.store.data,before); self.assertFalse(self.store.runs); self.assertFalse(self.store.initialized)
    def test_selective_recovery_preserves_CRM_and_batch_metadata(self):
        existing=copy.deepcopy(self.store.data); self.load(); self.recovery()
        for k,v in existing.items(): self.assertEqual(v,self.store.data[k])
        self.assertEqual(self.store.runs[self.intent['batch_id']]['status'],'recovered')
        self.assertEqual(len(self.store.data),len(existing)+1)
    def test_changed_line_blocks_entire_recovery(self):
        self.load(); entry=next(i for i in self.intent['items'] if i['kind']=='projection'); self.store.data[(entry['entity'],fingerprint(entry['key']))]['status']='later-edit'
        before=copy.deepcopy(self.store.data)
        with self.assertRaises(ValueError): self.recovery()
        self.assertEqual(before,self.store.data)
    def test_later_reference_blocks_recovery(self):
        self.load(); e=next(i for i in self.intent['items'] if i['kind']=='origin'); self.store.references.add((e['entity'],fingerprint(e['key'])))
        with self.assertRaises(ValueError): self.recovery()
    def test_concurrent_coordinators_same_origin(self):
        with concurrent.futures.ThreadPoolExecutor(2) as pool: results=list(pool.map(lambda _:self.load(),range(2)))
        self.assertEqual(sum(r['already_applied'] for r in results),1)
    def test_recovered_batch_not_silently_reimported(self):
        self.load(); self.recovery()
        with self.assertRaises(ValueError): self.load()
    def test_confirmation_missing_blocks(self):
        with self.assertRaises(ValueError): apply(self.store,self.intent,self.approval,self.digest,'')
    def test_source_changed_before_commit_rolls_back(self):
        before=copy.deepcopy(self.store.data)
        def changed(): raise ValueError('source_changed_before_commit')
        with self.assertRaisesRegex(ValueError,'source_changed_before_commit'):
            apply(self.store,self.intent,self.approval,self.digest,'APPLY:'+self.digest,before_commit=changed)
        self.assertEqual(before,self.store.data); self.assertFalse(self.store.runs)
    def test_original_principal_interest_and_paid_measures_reconciled(self):
        from reconciliation import verify_origin_totals
        self.load(); report=verify_origin_totals(self.store,self.intent)
        self.assertGreater(report['measures_checked'],10)
        e=next(i for i in self.intent['items'] if i['entity']=='financeiro_origem.private_loan_installments')
        self.store.data[(e['entity'],fingerprint(e['key']))]['paid_amount']=99
        with self.assertRaisesRegex(ValueError,'original_numeric_totals_reconciliation_failed'):
            verify_origin_totals(self.store,self.intent)
    def test_unapproved_desired_values_block_even_if_counts_unchanged(self):
        self.intent['items'][0]['values']['reference_at']='synthetic-unapproved-reference'
        with self.assertRaisesRegex(ValueError,'unapproved_desired_plan'): self.load()
        self.assertFalse(self.store.runs)

if __name__=='__main__': unittest.main()
