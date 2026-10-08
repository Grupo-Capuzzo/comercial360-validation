"""Fail-closed approval gates. Operational and disposable-local connections are distinct."""
import hashlib
import os
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

PROJECT='umvldqzzliqmgkvoedyd'
PROJECT_NAME='servopa-integrations'
VALIDATED_SHA='dd36dc50e6fc6937ebf8f53ffcc4370875bd1586'
REPO=Path(__file__).resolve().parents[2]

def canonical(value):
    if isinstance(value,float): raise ValueError('binary_float_not_allowed')
    if isinstance(value,(int,Decimal)) and not isinstance(value,bool):
        n=Decimal(value)
        if not n.is_finite(): raise ValueError('nonfinite_number')
        s=format(n,'f'); s=s.rstrip('0').rstrip('.') if '.' in s else s
        return ['number','0' if n==0 else s]
    if isinstance(value,(date,datetime)): return canonical(value.isoformat())
    if isinstance(value,dict): return {str(k):canonical(v) for k,v in sorted(value.items())}
    if isinstance(value,(tuple,list)): return [canonical(v) for v in value]
    if value is None or isinstance(value,(str,bool)): return value
    raise ValueError('unsupported_canonical_type')

def fingerprint(value):
    return hashlib.sha256(json.dumps(canonical(value),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def file_hash(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def closed_snapshot(path):
    # Main-file SHA cannot approve unaccounted SQLite WAL frames.
    wal=Path(str(path)+'-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('nonempty_WAL_requires_approved_closed_snapshot')

def private_path(path):
    p=Path(path).resolve()
    if p.is_relative_to(REPO) or any((parent/'.git').exists() for parent in (p,*p.parents)):
        raise ValueError('private_file_inside_repository')
    return p

def validate_endpoint(dsn):
    """No keyword DSN, multi-host, pooler, URL query host override or plaintext TLS."""
    url=urlsplit(dsn)
    if any(k.startswith('PG') for k in os.environ): raise ValueError('libpq_environment_not_allowed')
    options=parse_qs(url.query,strict_parsing=True)
    if (url.fragment or url.scheme!='postgresql' or url.hostname!=f'db.{PROJECT}.supabase.co'
        or url.port not in (None,5432) or url.path!='/postgres' or url.username!='postgres'
        or not url.password or options.get('sslmode')!=['verify-full']
        or set(options)-{'sslmode','sslrootcert','connect_timeout','application_name'}
        or any(len(v)!=1 for v in options.values()) or not options.get('sslrootcert')):
        raise ValueError('approved_direct_TLS_endpoint_required')
    if not Path(options['sslrootcert'][0]).is_file(): raise ValueError('TLS_root_certificate_required')
    return dict(host=url.hostname,dbname='postgres',user='postgres')

def verify_evidence(evidence):
    for name in ('backup','restore_test','effects_review','simulation','reconciliation'):
        item=evidence.get(name,{})
        if item.get('approved') is not True or not item.get('path') or not item.get('sha256'):
            raise ValueError('missing_approved_evidence_'+name)
        if file_hash(private_path(item['path']))!=item['sha256']:
            raise ValueError('changed_evidence_'+name)

def validate_approval(approval,matches,matches_file_hash,source_sha,schema_hashes):
    if approval.get('version')!=1 or approval.get('project_ref')!=PROJECT or approval.get('environment')!='operational':
        raise ValueError('wrong_approval_destination')
    identity=approval.get('identity',{})
    if identity.get('ref')!=PROJECT or identity.get('name')!=PROJECT_NAME or identity.get('host')!=f'db.{PROJECT}.supabase.co' or identity.get('status')!='ACTIVE_HEALTHY':
        raise ValueError('confirmed_project_identity_required')
    if approval.get('approved') is not True or not approval.get('approval_reference'):
        raise ValueError('explicit_execution_approval_required')
    roles={a.get('role') for a in approval.get('reviewers',[]) if a.get('approved') is True and a.get('name')}
    if not {'owner','financial_reviewer'}<=roles: raise ValueError('owner_and_financial_review_required')
    if len(source_sha)!=64 or any(c not in '0123456789abcdef' for c in source_sha) or approval.get('source_sha256')!=source_sha:
        raise ValueError('unapproved_source_hash')
    source=approval.get('source_system')
    if not source or approval.get('batch_id')!=source+':'+source_sha: raise ValueError('batch_snapshot_mismatch')
    if not approval.get('reference_at') or approval.get('matches_sha256')!=matches_file_hash:
        raise ValueError('matches_or_reference_not_approved')
    if matches.get('approved') is not True or matches.get('project_ref')!=PROJECT or matches.get('source_sha256')!=source_sha:
        raise ValueError('matches_approval_identity_mismatch')
    if approval.get('schema_hashes')!=schema_hashes: raise ValueError('DDL_review_hash_mismatch')
    if not approval.get('plan_sha256') or len(approval['plan_sha256'])!=64 or not approval.get('expected_conditions_sha256') or not isinstance(approval.get('expected_changes'),dict):
        raise ValueError('destination_and_change_plan_required')
    verify_evidence(approval.get('evidence',{}))
    return fingerprint(approval)

def check_confirmation(approval_digest,confirmation):
    if confirmation!='APPLY:'+approval_digest: raise ValueError('explicit_digest_confirmation_required')
