import copy
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from policy import *
from postgres_store import schema_hashes,atomic_ddl,DDL_FILES

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.cert=Path(self.temp.name)/'synthetic-ca.pem'
        self.cert.write_text('synthetic-only-not-a-real-certificate')
        self.url=f'postgresql://postgres:synthetic@db.{PROJECT}.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert={self.cert.as_posix()}'
        self.a=dict(version=1,project_ref=PROJECT,environment='operational',approved=True,approval_reference='synthetic',
            identity=dict(ref=PROJECT,name=PROJECT_NAME,host=f'db.{PROJECT}.supabase.co',status='ACTIVE_HEALTHY'),
            reviewers=[dict(role=r,name='synthetic',approved=True) for r in ('owner','financial_reviewer')],
            source_system='synthetic',source_sha256='a'*64,batch_id='synthetic:'+'a'*64,reference_at='synthetic',
            matches_sha256='b'*64,plan_sha256='d'*64,schema_hashes=schema_hashes(),expected_conditions_sha256='c'*64,expected_changes={'insert':1},evidence={})
        self.m=dict(approved=True,project_ref=PROJECT,source_sha256='a'*64)
    def tearDown(self): self.temp.cleanup()
    def validate(self):
        with patch('policy.verify_evidence'):
            return validate_approval(self.a,self.m,'b'*64,'a'*64,schema_hashes())
    def test_exact_direct_endpoint(self): self.assertEqual(validate_endpoint(self.url)['dbname'],'postgres')
    def test_host_override_and_pooler_rejected(self):
        for url in (self.url+'&host=evil.test',self.url.replace('db.'+PROJECT+'.supabase.co','pooler.supabase.com')):
            with self.assertRaises(ValueError): validate_endpoint(url)
    def test_tls_plain_or_missing_ca_rejected(self):
        for url in (self.url.replace('verify-full','require'),self.url.split('&sslrootcert')[0]):
            with self.assertRaises(ValueError): validate_endpoint(url)
    def test_valid_approval_and_explicit_confirmation(self):
        digest=self.validate(); check_confirmation(digest,'APPLY:'+digest)
        with self.assertRaises(ValueError): check_confirmation(digest,'yes')
    def test_identity_mismatch(self):
        self.a['identity']['name']='wrong'
        with self.assertRaises(ValueError): self.validate()
    def test_source_batch_mismatch(self):
        self.a['batch_id']='wrong'
        with self.assertRaises(ValueError): self.validate()
    def test_unapproved_match_or_changed_DDL(self):
        self.m['approved']=False
        with self.assertRaises(ValueError): self.validate()
        self.m['approved']=True; self.a['schema_hashes']={}
        with self.assertRaises(ValueError): self.validate()
    def test_two_reviews_and_evidence_required(self):
        self.a['reviewers']=self.a['reviewers'][:1]
        with self.assertRaises(ValueError): self.validate()
        with self.assertRaises(ValueError): verify_evidence({})
    def test_changed_backup_evidence_rejected(self):
        evidence={k:dict(path=str(self.cert),approved=True,sha256='0'*64) for k in ('backup','restore_test','effects_review','simulation','reconciliation')}
        with self.assertRaises(ValueError): verify_evidence(evidence)
    def test_decimal_fingerprint_no_context_rounding(self):
        self.assertEqual(fingerprint(Decimal('10.2500')),fingerprint(Decimal('10.25')))
        self.assertNotEqual(fingerprint(Decimal('123456789012345678901234567890.01')),fingerprint(Decimal('123456789012345678901234567890.02')))
        with self.assertRaises(ValueError): fingerprint(0.1)
    def test_outer_DDL_does_not_commit_load(self):
        for file in DDL_FILES:
            self.assertNotIn('\nCOMMIT;',atomic_ddl(file))
            self.assertNotIn('\nBEGIN;',atomic_ddl(file))
    def test_libpq_environment_cannot_override_destination(self):
        with patch.dict(os.environ,{'PGHOST':'synthetic-override'}),self.assertRaisesRegex(ValueError,'libpq_environment_not_allowed'):
            validate_endpoint(self.url)
    def test_unapproved_WAL_frames_block(self):
        p=Path(self.temp.name)/'synthetic.sqlite'
        Path(str(p)+'-wal').write_bytes(b'synthetic-unapproved-frames')
        with self.assertRaisesRegex(ValueError,'nonempty_WAL'): closed_snapshot(p)

if __name__=='__main__': unittest.main()
