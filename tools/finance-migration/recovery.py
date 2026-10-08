"""Plan selective recovery; never deletes or updates records."""
from engine import fingerprint


def recovery_plan(records, lote_id):
    """records: stable key, creation batch, imported fingerprint, current row, external references.

    Caller must collect records from an approved private destination. Return keys only,
    not personal values. Execution/reverse dependency ordering remains a separate review.
    """
    eligible, blocked = [], []
    for record in records:
        if record['created_by_lote'] != lote_id:
            continue
        if record['has_later_references']:
            blocked.append((record['key'], 'later_references'))
        elif fingerprint(record['current_source_fields'], record['key'][1]) != record['imported_fingerprint']:
            blocked.append((record['key'], 'modified_after_import'))
        else:
            eligible.append(record['key'])
    return {'eligible': eligible, 'blocked': blocked, 'executable': False}
