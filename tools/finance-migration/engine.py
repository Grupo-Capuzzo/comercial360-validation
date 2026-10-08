"""Offline planning and LOCAL Postgres rehearsal only. No remote write mode."""
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from source import connect, quote, digest
from local_connection import connect_local, parameters

SPEC = json.loads(Path(__file__).with_name('schema.json').read_text())


def fingerprint(row, table=None):
    types = {c['name']: c['type'] for c in SPEC[table]['columns']} if table else {}
    normalized = {}
    for name, value in row.items():
        if value is None:
            normalized[name] = ['null']
        elif types.get(name) == 'INTEGER' and (not isinstance(value,int) or isinstance(value,bool)):
            raise ValueError('integer_type_mismatch')
        elif types.get(name) == 'REAL' and (not isinstance(value,(int,float,Decimal)) or isinstance(value,bool)):
            raise ValueError('numeric_type_mismatch')
        elif types.get(name) == 'TEXT' or isinstance(value, str):
            if not isinstance(value, str):
                raise ValueError('text_type_mismatch')
            normalized[name] = ['text', value]
        elif isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
            n = Decimal(str(value))
            if not n.is_finite():
                raise ValueError('nonfinite_number')
            # format without Decimal.normalize(): that method can round to context precision.
            text = format(n, 'f')
            if '.' in text:
                text = text.rstrip('0').rstrip('.')
            normalized[name] = ['number', '0' if n == 0 else text]
        else:
            raise ValueError('unsupported_field_type')
    return hashlib.sha256(json.dumps(normalized, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def key(table, row, source_system):
    cols = sorted((c for c in SPEC[table]['columns'] if c['pk_order']), key=lambda c: c['pk_order'])
    values = tuple(row[c['name']] for c in cols)
    if not source_system or not values or any(v is None for v in values):
        raise ValueError('null_or_missing_primary_key')
    return (source_system, table, values)


def plan(rows, existing, source_system):
    """existing maps stable keys to actual rows + stored fingerprints.

    Hash-only callers cannot classify unchanged; changes/extras need resolution.
    """
    actions = []
    seen = set()
    for table, row in rows:
        stable = key(table, row, source_system)
        if stable in seen:
            raise ValueError('duplicate_source_key:' + table)
        seen.add(stable)
        old = existing.get(stable)
        fp = fingerprint(row, table)
        intact = (isinstance(old, dict) and old.get('fingerprint') == fp
                  and fingerprint(old['row'], table) == fp)
        actions.append((table, row, stable, fp, 'insert' if old is None else 'unchanged' if intact else 'conflict'))
    for stable in set(existing) - seen:
        actions.append((stable[1], None, stable, None, 'extra'))
    return actions


def target_state(db, source_system):
    from psycopg import sql
    existing = {}
    for table, spec in SPEC.items():
        names = [c['name'] for c in spec['columns']]
        statement = sql.SQL('SELECT {},source_fingerprint FROM financeiro_origem.{} WHERE source_system=%s').format(
            sql.SQL(',').join(map(sql.Identifier,names)), sql.Identifier(table))
        for record in db.execute(statement,(source_system,)):
            row = dict(zip(names,record[:-1]))
            existing[key(table,row,source_system)] = {'row':row,'fingerprint':record[-1]}
    return existing


def source_rows(path):
    before = digest(path)
    with connect(path) as db:
        db.execute('BEGIN')
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('source_integrity_failed')
        actual_tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        if actual_tables != set(SPEC):
            raise ValueError('source_table_set_mismatch')
        for table, spec in SPEC.items():
            columns = [c['name'] for c in spec['columns']]
            actual = [{'name':c[1], 'type':c[2], 'not_null':bool(c[3]), 'pk_order':c[5]} for c in db.execute('PRAGMA table_info(' + quote(table) + ')')]
            fks = [list(r) for r in db.execute('PRAGMA foreign_key_list(' + quote(table) + ')')]
            # SQLite FK IDs depend on declaration order, not relational semantics.
            if actual != spec['columns'] or sorted(f[1:] for f in fks) != sorted(f[1:] for f in spec['foreign_keys']):
                raise ValueError('schema_mismatch:' + table)
            records = db.execute('SELECT * FROM ' + quote(table))
            if not spec['import']:
                if records.fetchone() is not None:
                    raise ValueError('legacy_access_must_be_empty:' + table)
                continue
            for row in records:
                yield table, dict(zip(columns, row))
    if digest(path) != before:
        raise ValueError('source_changed_during_read')


def local_rehearsal(sqlite_path, dsn, source_system, reference_at, approved_sha256=None):
    """Explicit local-only, all-or-nothing transaction; never applies DDL."""
    parameters(dsn)
    if not approved_sha256 or digest(sqlite_path) != approved_sha256:
        raise ValueError('approved_source_hash_required')
    import psycopg
    from psycopg import sql
    rows = list(source_rows(sqlite_path))
    snapshot = digest(sqlite_path)
    if snapshot != approved_sha256:
        raise ValueError('approved_source_changed')
    lote = source_system + ':' + snapshot
    with connect_local(dsn) as db:
        db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (source_system,))
        for table in SPEC:
            db.execute(sql.SQL('LOCK TABLE financeiro_origem.{} IN SHARE ROW EXCLUSIVE MODE').format(sql.Identifier(table)))
        existing = target_state(db, source_system)
        actions = plan(rows, existing, source_system)
        conflicts = sum(a[4] in ('conflict', 'extra') for a in actions)
        if conflicts:
            raise ValueError('conflicts_require_resolution:' + str(conflicts))
        db.execute('INSERT INTO financeiro_origem.lotes VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                   (lote, source_system, snapshot, reference_at))
        batch = db.execute('SELECT source_system,snapshot_sha256,reference_at FROM financeiro_origem.lotes WHERE id=%s',(lote,)).fetchone()
        if batch != (source_system,snapshot,reference_at):
            raise ValueError('batch_metadata_conflict')
        for table, row, stable, fp, action in actions:
            if action != 'insert':
                continue
            cols = ['source_system', 'lote_id', 'source_fingerprint'] + list(row)
            values = [source_system, lote, fp] + [Decimal(str(v)) if isinstance(v, float) else v for v in row.values()]
            db.execute(sql.SQL('INSERT INTO financeiro_origem.{} ({}) VALUES ({})').format(
                sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, cols)),
                sql.SQL(',').join(sql.Placeholder() for _ in cols)), values)
        db.execute('SET CONSTRAINTS ALL IMMEDIATE')
        final = plan(rows,target_state(db,source_system),source_system)
        if any(a[4] != 'unchanged' for a in final):
            raise ValueError('transactional_reconciliation_failed')
        for table,row,stable,fp,action in final:
            db.execute('INSERT INTO financeiro_origem.ocorrencias(lote_id,source_system,tabela,chave,fingerprint) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                       (lote, source_system,table,json.dumps(stable[2]),fp))
        if digest(sqlite_path) != approved_sha256:
            raise ValueError('source_changed_before_commit')
        return {'insert': sum(a[4] == 'insert' for a in actions), 'unchanged': sum(a[4] == 'unchanged' for a in actions)}
