"""First operational read slice; explicit reviewed bindings, local fixtures only."""
from local_connection import connect_local


def project_titles(dsn,source_system,bindings):
    """bindings maps original loan ID to (empresa UUID,cliente UUID,produto UUID).

    Never infer these IDs from a person's name, category or condominium.
    Conflict aborts the entire transaction; no update or upsert overwrite.
    """
    inserted=0
    with connect_local(dsn) as db:
        db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',(source_system,))
        db.execute('LOCK TABLE financeiro.vinculos_titulos IN SHARE ROW EXCLUSIVE MODE')
        for origin_id,(empresa,cliente,produto) in bindings.items():
            belongs=db.execute('SELECT 1 FROM comercial_360.produtos WHERE produto_id=%s AND empresa_id=%s',(produto,empresa)).fetchone()
            if not belongs: raise ValueError('product_company_binding_invalid')
            row=db.execute('SELECT lote_id,original_amount,contracted_amount,status,loan_number FROM financeiro_origem.private_loans WHERE source_system=%s AND id=%s',(source_system,origin_id)).fetchone()
            if not row: raise ValueError('missing_original_title')
            desired=(empresa,cliente,produto,*row)
            old=db.execute('SELECT empresa_id::text,cliente_id_global::text,produto_id::text,lote_id,original_amount,contracted_amount,status,loan_number FROM financeiro.vinculos_titulos WHERE source_system=%s AND origem_id=%s',(source_system,origin_id)).fetchone()
            if old is not None:
                if tuple(old)!=desired: raise ValueError('operational_projection_conflict')
                continue
            db.execute('INSERT INTO financeiro.vinculos_titulos VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(source_system,origin_id,*desired))
            inserted+=1
    return {'inserted':inserted}
