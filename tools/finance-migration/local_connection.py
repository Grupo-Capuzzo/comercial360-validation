"""Fail-closed connection to an explicitly marked disposable database only."""
import os
from urllib.parse import urlsplit, unquote


def parameters(dsn):
    if any(k.startswith('PG') for k in os.environ):
        raise ValueError('libpq_environment_not_allowed')
    u = urlsplit(dsn)
    if (u.scheme not in ('postgres', 'postgresql') or u.query or u.fragment
            or u.hostname not in ('127.0.0.1', 'localhost', '::1')
            or not u.username or not u.password):
        raise ValueError('explicit_local_connection_required')
    name = unquote(u.path.removeprefix('/'))
    if not name.startswith('capuzzo_test_') or not name.replace('_', '').isalnum():
        raise ValueError('disposable_database_name_required')
    return dict(host='::1' if u.hostname == '::1' else '127.0.0.1',
                hostaddr='::1' if u.hostname == '::1' else '127.0.0.1',
                port=u.port or 5432, dbname=name, user=unquote(u.username),
                password=unquote(u.password), sslmode='disable', connect_timeout=5,
                application_name='capuzzo_synthetic_rehearsal')


def connect_local(dsn):
    params = parameters(dsn)
    import psycopg
    db = psycopg.connect(**params)
    try:
        identity = db.execute("SELECT current_database(), current_setting('capuzzo.disposable', true), inet_server_addr()::text").fetchone()
        # Docker port forwarding changes the server's own address; database marker
        # and exclusive credentials are mandatory, not the server's NIC address.
        if identity[:2] != (params['dbname'], 'synthetic-only') or identity[2] is None:
            raise ValueError('disposable_identity_mismatch')
        db.commit()
        return db
    except BaseException:
        db.close()
        raise
