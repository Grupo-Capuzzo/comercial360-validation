import unittest
from prepare_load import validate

class ProposalTests(unittest.TestCase):
    def config(self):
        return dict(project_ref='umvldqzzliqmgkvoedyd', environment='operational',
                    approved_sha256='a'*64, batch_id='synthetic-only', source_reference='synthetic',
                    approval_reference='synthetic', affected_structures=['synthetic'],
                    approved_matches=['synthetic'], dry_run_evidence='synthetic',
                    reconciliation_evidence='synthetic', backup_evidence='synthetic',
                    restore_rehearsal_evidence='synthetic', effects_inventory=['synthetic'],
                    effects_reviewed=True, changes={k:[] for k in ('create','link','unchanged','blocked')})
    def test_proposal_is_not_execution(self):
        self.assertEqual(validate(self.config())['mode'], 'proposal_only_no_remote_write')
    def test_wrong_destination_rejected(self):
        c=self.config(); c['project_ref']='other'
        with self.assertRaises(ValueError): validate(c)
    def test_conflict_and_missing_backup_rejected(self):
        c=self.config(); c['conflicts']=['synthetic']
        with self.assertRaises(ValueError): validate(c)
        c=self.config(); del c['backup_evidence']
        with self.assertRaises(ValueError): validate(c)

if __name__ == '__main__': unittest.main()
