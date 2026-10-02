"""Generate a private first-load proposal only. No database driver or remote writes."""
import argparse
import hashlib
import json
from pathlib import Path

PROJECT = 'umvldqzzliqmgkvoedyd'

def validate(config):
    if config.get('project_ref') != PROJECT or config.get('environment') != 'operational':
        raise ValueError('explicit_expected_destination_required')
    digest = config.get('approved_sha256', '')
    if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('approved_sha256_required')
    for field in ('batch_id', 'source_reference', 'approval_reference', 'affected_structures',
                  'approved_matches', 'dry_run_evidence', 'reconciliation_evidence',
                  'backup_evidence', 'restore_rehearsal_evidence', 'effects_inventory'):
        if not config.get(field):
            raise ValueError('required_' + field)
    if config.get('conflicts') or config.get('unapproved_matches'):
        raise ValueError('unresolved_conflicts_or_matches')
    if config.get('effects_reviewed') is not True:
        raise ValueError('effects_review_not_approved')
    for category in ('create', 'link', 'unchanged', 'blocked'):
        rows = config.get('changes', {}).get(category)
        if not isinstance(rows, list):
            raise ValueError('explicit_change_list_' + category)
    if config['changes']['blocked']:
        raise ValueError('blocked_records_require_resolution_or_explicit_new_batch')
    return {'mode': 'proposal_only_no_remote_write', 'project_ref': PROJECT,
            'configuration_digest': hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
            'proposal': config}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_configuration', type=Path)
    parser.add_argument('private_output', type=Path)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    if args.private_output.resolve().is_relative_to(repository):
        raise ValueError('identifiable_proposal_must_stay_outside_repository')
    result = validate(json.loads(args.private_configuration.read_text(encoding='utf-8')))
    with args.private_output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print('Private proposal generated; no database connection or execution performed.')
