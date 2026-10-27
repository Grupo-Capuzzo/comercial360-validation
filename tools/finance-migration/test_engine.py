import unittest
from engine import plan, fingerprint, key, local_rehearsal
from recovery import recovery_plan


class MigrationTests(unittest.TestCase):
    def test_repeated_snapshot_and_new_batch_do_not_duplicate(self):
        row={'id':1,'cpf':'000001','full_name':'Synthetic','email':None}
        rows=[('clients',row)]
        first=plan(rows,{},'synthetic-source')
        self.assertEqual(first[0][4],'insert')
        existing={first[0][2]:{'row':row, 'fingerprint':first[0][3]}}
        self.assertEqual(plan(rows,existing,'synthetic-source')[0][4],'unchanged')

    def test_changed_history_is_conflict(self):
        row={'id':1,'income_value':10.25}
        old={key('monthly_calculation_items',row,'s'):fingerprint(row)}
        self.assertEqual(plan([('monthly_calculation_items',dict(row,income_value=11))],old,'s')[0][4],'conflict')

    def test_null_and_empty_are_distinct(self):
        self.assertNotEqual(fingerprint({'value':None}),fingerprint({'value':''}))

    def test_blank_loan_number_does_not_merge(self):
        actions=plan([('private_loans',{'id':1,'loan_number':''}),('private_loans',{'id':2,'loan_number':''})],{},'s')
        self.assertEqual(len({a[2] for a in actions}),2)

    def test_duplicate_source_key_rejected(self):
        with self.assertRaises(ValueError):
            plan([('clients',{'id':1}),('clients',{'id':1})],{},'s')

    def test_remote_write_rejected_before_connect(self):
        with self.assertRaises(ValueError):
            local_rehearsal('unused','postgresql://example.com/db','s','unused')

    def test_source_identity_not_snapshot_is_part_of_key(self):
        self.assertNotEqual(key('clients',{'id':1},'origin-a'),key('clients',{'id':1},'origin-b'))

    def test_leading_zero_and_input_are_preserved(self):
        row={'id':1,'cpf':'000001','pix_key':''}
        action=plan([('clients',row)],{},'s')[0]
        self.assertEqual(action[1]['cpf'],'000001')
        self.assertEqual(row,{'id':1,'cpf':'000001','pix_key':''})

    def test_zero_not_missing(self):
        self.assertNotEqual(fingerprint({'amount':0}),fingerprint({'amount':None}))

    def test_missing_key_is_rejected(self):
        with self.assertRaises(KeyError):
            plan([('clients',{'full_name':'Synthetic'})],{},'s')

    def test_recovery_preserves_later_work_and_other_batches(self):
        base={'key':('s','clients',1),'created_by_lote':'batch-a',
              'imported_fingerprint':fingerprint({'id':1,'name':'Synthetic'}),
              'current_source_fields':{'id':1,'name':'Synthetic'},'has_later_references':False}
        self.assertEqual(len(recovery_plan([base],'batch-a')['eligible']),1)
        self.assertFalse(recovery_plan([base],'batch-b')['eligible'])
        changed=dict(base,current_source_fields={'id':1,'name':'Later synthetic edit'})
        self.assertEqual(recovery_plan([changed],'batch-a')['blocked'][0][1],'modified_after_import')
        linked=dict(base,has_later_references=True)
        self.assertEqual(recovery_plan([linked],'batch-a')['blocked'][0][1],'later_references')


if __name__=='__main__':
    unittest.main()
