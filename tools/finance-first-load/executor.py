"""Transaction coordinator shared with synthetic tests, not a production connection guard."""
import sys
from pathlib import Path
from collections import Counter
from decimal import Decimal
from policy import fingerprint, check_confirmation
from projection import build, normalize_row
sys.path.insert(0,str(Path(__file__).parents[1]/'finance-migration'))
from engine import fingerprint as origin_fingerprint, SPEC

def item(entity,key,values,kind='preserve',update_allowed=False):
    return dict(entity=entity,key=key,values=values,kind=kind,update_allowed=update_allowed)

def prepare_items(rows,matches,source,snapshot,reference):
    rows=[(t,normalize_row(r)) for t,r in rows]; batch=source+':'+snapshot
    projection=build(rows,matches,source,batch)
    items=[item('financeiro_origem.lotes',{'id':batch},dict(id=batch,source_system=source,snapshot_sha256=snapshot,reference_at=reference),'batch')]
    for customer in projection['new_customers']:
        items.append(item('comercial_360.clientes',{'cliente_id_global':customer['cliente_id_global']},customer,'new_customer'))
    for table,row in rows:
        if table not in SPEC or not SPEC[table]['import']: raise ValueError('unapproved_origin_table')
        if any(c['pk_order'] for c in SPEC[table]['columns'] if c['name']!='id'): raise ValueError('unsupported_original_primary_key')
        values=dict(source_system=source,lote_id=batch,source_fingerprint=origin_fingerprint(row,table),**row)
        items.append(item('financeiro_origem.'+table,dict(source_system=source,id=row['id']),values,'origin'))
    for match in matches['clients']:
        if match['decision']=='hold': continue
        value=dict(source_system=source,tabela_origem=match['table'],origem_id=str(match['source_id']),
                   cliente_id_global=match['destination_cliente_id_global'],lote_id=batch,
                   criterio=match['decision'],evidence_reference=match['evidence_reference'])
        items.append(item('financeiro_controle.correspondencias',{k:value[k] for k in ('source_system','tabela_origem','origem_id')},value,'customer_link'))
    for row in projection['rows']:
        if row['valor_preservado'] is not None: row['valor_preservado']=Decimal(row['valor_preservado'])
        items.append(item('financeiro.registros_consulta',{k:row[k] for k in ('source_system','tabela_origem','origem_id')},row,'projection'))
    # The strong original loan FK remains, in addition to the generic read projection.
    loans={str(row['id']):row for table,row in rows if table=='private_loans'}
    for projected in projection['rows']:
        if projected['tabela_origem']=='private_loans':
            raw=loans[projected['origem_id']]
            value=dict(source_system=source,origem_id=raw['id'],empresa_id=projected['empresa_id'],
                       cliente_id_global=projected['cliente_id_global'],produto_id=projected['produto_id'],lote_id=batch,
                       original_amount=raw['original_amount'],contracted_amount=raw['contracted_amount'],
                       status=raw['status'],loan_number=raw.get('loan_number'))
            items.append(item('financeiro.vinculos_titulos',{k:value[k] for k in ('source_system','origem_id')},value,'loan_link'))
    for edge in projection['relationships']:
        value=dict(**edge,lote_id=batch)
        items.append(item('financeiro.relacoes_consulta',edge,value,'relationship'))
    items.append(item('portal_acesso.empresas_portal',{'empresa_id':matches['empresa_id']},
                      dict(empresa_id=matches['empresa_id'],nome=matches['portal_name']),'portal_company'))
    items.append(item('financeiro.estado_carga',{'empresa_id':matches['empresa_id']},
                      dict(empresa_id=matches['empresa_id'],situacao='historico_importado',data_referencia=reference),'load_state',True))
    seen=set()
    for entry in items:
        identity=(entry['entity'],fingerprint(entry['key']))
        if identity in seen: raise ValueError('duplicate_destination_item')
        seen.add(identity)
    return dict(batch_id=batch,source_system=source,items=items,held=projection['held'],
                totals=dict(Counter(entry['kind'] for entry in items)))

def classify(entry,current):
    if current is None: return 'insert'
    if fingerprint({k:current.get(k) for k in entry['values']})==fingerprint(entry['values']): return 'unchanged'
    if (entry['update_allowed'] and current.get('situacao')=='nao_carregado'
        and not current.get('data_referencia')): return 'update'
    return 'conflict'

def preview(store,intent):
    if hasattr(store,'prepare_snapshot'): store.prepare_snapshot(intent)
    actions=[]
    for entry in intent['items']:
        current=store.get(entry['entity'],entry['key'])
        actions.append(dict(entry=entry,current=current,action=classify(entry,current)))
    expected={(i['entity'],fingerprint(i['key'])) for i in intent['items']}
    extras=store.extras(intent['source_system'],expected)
    summary=dict(Counter(a['action'] for a in actions)); summary['extra']=len(extras); summary['held']=len(intent['held'])
    affected={}
    for a in actions:
        affected.setdefault(a['entry']['entity'],Counter())[a['action']]+=1
    return dict(actions=actions,summary=summary,affected={k:dict(v) for k,v in affected.items()},extras=extras)

def reconcile(store,intent):
    checked=preview(store,intent)
    if any(a['action']!='unchanged' for a in checked['actions']) or checked['extras'] or checked['summary']['held']:
        raise ValueError('reconciliation_failed')
    from reconciliation import verify_projection,verify_origin_totals
    verify_projection(store,intent)
    verify_origin_totals(store,intent)
    return checked['affected']

def apply(store,intent,approval,approval_digest,confirmation,before_commit=None):
    """Connection is created by a separate operational gate or marked local test adapter."""
    check_confirmation(approval_digest,confirmation)
    plan_hash=fingerprint(intent)
    if approval.get('plan_sha256')!=plan_hash: raise ValueError('unapproved_desired_plan')
    with store.transaction():
        store.lock_source(intent['source_system'])
        previous=store.execution(intent['batch_id'])
        if previous:
            if previous['status']!='completed' or previous['approval_sha256']!=approval_digest or previous['plan_sha256']!=plan_hash:
                raise ValueError('previous_batch_mismatch_or_recovered')
            store.check_journal_unchanged(intent['batch_id'])
            reconcile(store,intent)
            return dict(already_applied=True,batch_id=intent['batch_id'])
        store.lock_reviewed_references(intent)
        if fingerprint(store.conditions(intent))!=approval['expected_conditions_sha256']:
            raise ValueError('destination_changed_since_approval')
        planned=preview(store,intent)
        if planned['summary']!=approval['expected_changes']:
            raise ValueError('change_counts_changed_since_approval')
        if planned['summary'].get('conflict',0) or planned['summary']['extra'] or planned['summary']['held']:
            raise ValueError('conflicts_extras_or_held_prevent_full_load')
        store.initialize_reviewed_schema()
        # Locks also serialize external mutations of the source/projection during reconciliation.
        store.lock_migration_tables()
        refreshed=preview(store,intent)
        if refreshed['summary']!=planned['summary']: raise ValueError('destination_changed_during_preparation')
        writes=[a for a in refreshed['actions'] if a['action']!='unchanged']
        if hasattr(store,'write_many'):
            store.write_many(writes)
            store.prepare_snapshot(intent)
        journal=[]
        for action in writes:
            entry=action['entry']; kind=action['action']; before=action['current']
            if not hasattr(store,'write_many'): store.write(entry,kind)
            after=store.get(entry['entity'],entry['key'])
            if after is None: raise ValueError('inserted_row_not_found')
            journal.append((entry,kind,before,fingerprint(after)))
        if hasattr(store,'journal_many'): store.journal_many(intent['batch_id'],journal)
        else:
            for entry,kind,before,after_hash in journal: store.journal(intent['batch_id'],entry,kind,before,after_hash)
        store.constraints_immediate()
        affected=reconcile(store,intent)
        if before_commit is not None: before_commit()
        store.record_execution(intent['batch_id'],approval_digest,plan_hash,affected)
        return dict(already_applied=False,batch_id=intent['batch_id'],changes=planned['summary'],affected=affected)

def recover(store,batch_id,approval_digest,confirmation):
    if confirmation!='RECOVER:'+approval_digest+':'+batch_id: raise ValueError('explicit_recovery_confirmation_required')
    with store.transaction():
        store.lock_source(batch_id.rsplit(':',1)[0])
        previous=store.execution(batch_id)
        if not previous or previous['status']!='completed' or previous['approval_sha256']!=approval_digest:
            raise ValueError('unknown_or_unapproved_recovery_batch')
        journal=store.read_journal(batch_id)
        owned={(j['entity'],fingerprint(j['item_key'])) for j in journal if j['operation']=='insert'}
        store.lock_migration_tables()
        store.check_journal_unchanged(batch_id)
        for row in journal:
            if row['entity']!='financeiro_origem.lotes' and row['operation']=='insert' and store.external_references(row['entity'],row['item_key'],owned):
                raise ValueError('recovery_blocked_by_later_reference')
        store.constraints_deferred()
        for row in reversed(journal):
            # Retain original batch metadata for audit; never remove preexisting records.
            if row['entity']=='financeiro_origem.lotes': continue
            store.undo(row)
        store.constraints_immediate()
        store.mark_recovered(batch_id)
        return dict(batch_id=batch_id,recovered=len(journal)-sum(r['entity']=='financeiro_origem.lotes' for r in journal))
