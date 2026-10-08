"""Read-only source inspection. Never prints row values."""
import argparse
import collections
import csv
import hashlib
import json
import sqlite3
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect(path):
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, factory=ClosingConnection)
    db.execute('PRAGMA query_only=ON')
    return db


def inspect(path, manifest, csv_dir):
    before = digest(path)
    with connect(path) as db:
        db.execute('BEGIN')
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        report = {'sha256': before, 'hash_matches': before == manifest['sha256_sqlite'],
                  'integrity': list(db.execute('PRAGMA integrity_check')),
                  'foreign_key_violations': len(list(db.execute('PRAGMA foreign_key_check'))), 'tables': {}}
        for table in tables:
            columns = list(db.execute('PRAGMA table_info(' + quote(table) + ')'))
            rows = list(db.execute('SELECT * FROM ' + quote(table)))
            with (Path(csv_dir) / (table + '.csv')).open(encoding='utf-8-sig', newline='') as f:
                reader = csv.reader(f)
                header = next(reader)
                csv_rows = collections.Counter(tuple(r) for r in reader)
            serialized = collections.Counter(tuple('' if v is None else str(v) for v in row) for row in rows)
            report['tables'][table] = {
                'count': len(rows), 'count_matches': len(rows) == manifest['contagem_por_tabela'].get(table),
                'csv_matches': header == [c[1] for c in columns] and csv_rows == serialized,
                'columns': [{'name': c[1], 'type': c[2], 'not_null': bool(c[3]), 'pk_order': c[5]} for c in columns],
                'foreign_keys': [list(r) for r in db.execute('PRAGMA foreign_key_list(' + quote(table) + ')')]}
        report['total_rows'] = sum(t['count'] for t in report['tables'].values())
        report['table_set_matches'] = set(tables) == set(manifest['contagem_por_tabela'])
    report['hash_unchanged'] = digest(path) == before
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sqlite', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--csv-dir', required=True)
    args = parser.parse_args()
    result = inspect(args.sqlite, json.loads(Path(args.manifest).read_text(encoding='utf-8')), args.csv_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    valid = (result['hash_matches'] and result['hash_unchanged'] and result['table_set_matches']
             and result['integrity'] == [('ok',)] and result['foreign_key_violations'] == 0
             and all(t['count_matches'] and t['csv_matches'] for t in result['tables'].values()))
    raise SystemExit(0 if valid else 1)
