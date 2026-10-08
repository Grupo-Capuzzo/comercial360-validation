"""Build explicit, relationship-aware read projections; never creates investment positions."""
import sys
from pathlib import Path
from decimal import Decimal
from uuid import UUID
sys.path.insert(0,str(Path(__file__).parents[1]/'portal-integration'))
from read_projection import project, RULES

def valid_numeric_document(document,kind):
    size=11 if kind=='PF' else 14
    if not isinstance(document,str) or not document.isascii() or not document.isdigit() or len(document)!=size or len(set(document))==1: return False
    body=document[:-2]
    weights=([list(range(10,1,-1)),list(range(11,1,-1))] if kind=='PF' else
             [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]])
    for expected,w in zip(document[-2:],weights):
        remainder=sum(int(c)*weight for c,weight in zip(body,w))%11
        digit=str(0 if remainder<2 else 11-remainder)
        if digit!=expected: return False
        body+=digit
    return True

def normalize_row(row):
    return {k:Decimal(str(v)) if isinstance(v,float) else v for k,v in row.items()}

def build(rows,matches,source,batch):
    rows=[(t,normalize_row(r)) for t,r in rows]
    index={}
    for table,row in rows:
        k=(table,str(row['id']))
        if k in index: raise ValueError('duplicate_source_identity')
        index[k]=row
    if matches.get('approved') is not True: raise ValueError('matches_not_approved')
    company=matches.get('empresa_id')
    products=matches.get('products',{})
    if not company or not matches.get('portal_name'): raise ValueError('approved_company_and_portal_name_required')
    try:
        UUID(company)
        for value in [*products.values(),matches.get('loan_product_id')]:
            if value is not None: UUID(value)
    except (ValueError,TypeError,AttributeError): raise ValueError('invalid_destination_UUID') from None
    clients={}; holds={}; seeds=[]
    for m in matches.get('clients',[]):
        k=(m.get('table'),str(m.get('source_id')))
        if k not in index or k in clients or k in holds or m.get('approved') is not True:
            raise ValueError('duplicate_unknown_or_unapproved_match')
        action=m.get('decision')
        if action=='hold':
            if not m.get('reason'): raise ValueError('explicit_hold_reason_required')
            holds[k]=m['reason']; continue
        if action not in ('link','create') or not m.get('destination_cliente_id_global') or not m.get('evidence_reference'):
            raise ValueError('approved_customer_decision_required')
        clients[k]=m['destination_cliente_id_global']
        try: UUID(clients[k])
        except (ValueError,TypeError,AttributeError): raise ValueError('invalid_destination_customer_UUID') from None
        if action=='create':
            seed=m.get('seed',{})
            if seed.get('cliente_id_global')!=clients[k] or not seed.get('nome_preferencial') or not seed.get('cpf_cnpj_normalizado') or seed.get('tipo_pessoa') not in ('PF','PJ'):
                raise ValueError('approved_minimal_customer_seed_required')
            if set(seed)-{'cliente_id_global','nome_preferencial','cpf_cnpj_normalizado','tipo_pessoa'}:
                raise ValueError('nonminimal_customer_seed')
            document=seed['cpf_cnpj_normalizado']
            if not valid_numeric_document(document,seed['tipo_pessoa']):
                raise ValueError('invalid_new_customer_document')
            if any(s['cliente_id_global']==clients[k] for s in seeds): raise ValueError('duplicate_new_customer_identity')
            seeds.append(seed)
    required={k for k in index if k[0] in ('clients','private_loan_clients')}
    if required!=set(clients)|set(holds): raise ValueError('every_customer_record_needs_decision')
    for k,row in index.items():
        if k[0]=='private_loan_clients' and row.get('linked_client_id') is not None:
            linked=('clients',str(row['linked_client_id']))
            if k in clients and (linked not in clients or clients[k]!=clients[linked]):
                raise ValueError('explicit_cross_table_identity_conflict')
    investment=matches.get('investment_policy',{})
    if investment.get('approved') is not True or investment.get('mode')!='historical_only' or investment.get('dashboard_authority')!='existing_crm':
        raise ValueError('historical_only_no_double_count_policy_required')
    if matches.get('share_links'): raise ValueError('aggregate_positions_cannot_be_linked_without_separate_reviewed_adapter')
    result=[]; edges=[]; blocked=[]; done={}; active=set()
    def resolve(k):
        if k in done: return done[k]
        if k in active: raise ValueError('source_dependency_cycle')
        if k not in index: raise ValueError('missing_origin_relationship')
        active.add(k); table,origin=k; row=index[k]; client=None; product=None; parents=[]
        if k in holds:
            done[k]=None; active.remove(k); blocked.append(dict(table=table,source_id=origin,reason=holds[k])); return None
        if table in ('clients','private_loan_clients'): client=clients[k]
        elif table in ('shares','monthly_calculation_items'):
            parents.append(('clients',str(row['client_id'])))
            product=products.get(str(row['condominium_id']))
            if not product: raise ValueError('approved_condominium_product_required')
            if table=='monthly_calculation_items':
                share=index.get(('shares',str(row['share_id']))); calculation=index.get(('monthly_calculations',str(row['monthly_calculation_id'])))
                if not share or not calculation or share['client_id']!=row['client_id'] or share['condominium_id']!=row['condominium_id'] or calculation['condominium_id']!=row['condominium_id']:
                    raise ValueError('calculation_client_share_product_conflict')
                parents.extend([('shares',str(row['share_id'])),('monthly_calculations',str(row['monthly_calculation_id']))])
        elif table=='monthly_calculations':
            product=products.get(str(row['condominium_id']))
            if not product: raise ValueError('approved_calculation_product_required')
        elif table=='private_loans':
            parents.append(('private_loan_clients',str(row['private_client_id'])))
            if row.get('linked_client_id') is not None: parents.append(('clients',str(row['linked_client_id'])))
            product=matches.get('loan_product_id')
            if not product: raise ValueError('approved_loan_product_required')
        elif table.startswith('private_loan_'):
            parents.append(('private_loans',str(row['loan_id'])))
            if row.get('installment_id') is not None:
                installment=index.get(('private_loan_installments',str(row['installment_id'])))
                if not installment or installment['loan_id']!=row['loan_id']: raise ValueError('payment_installment_loan_conflict')
                parents.append(('private_loan_installments',str(row['installment_id'])))
        elif table=='bank_remittance_files':
            if row.get('calculation_id') is not None: parents.append(('monthly_calculations',str(row['calculation_id'])))
        elif table=='bank_remittance_items':
            parents.append(('bank_remittance_files',str(row['remittance_file_id'])))
            if row.get('client_id') is not None: parents.append(('clients',str(row['client_id'])))
            if row.get('calculation_item_id') is not None: parents.append(('monthly_calculation_items',str(row['calculation_item_id'])))
        elif table=='central_etapas': parents.append(('central_tarefas',str(row['tarefa_id'])))
        elif table=='central_subetapas': parents.append(('central_etapas',str(row['etapa_id'])))
        parent_rows=[resolve(p) for p in parents]
        if any(p is None for p in parent_rows):
            done[k]=None; active.remove(k); blocked.append(dict(table=table,source_id=origin,reason='dependent_on_explicit_customer_hold')); return None
        parent_clients={p['cliente_id_global'] for p in parent_rows if p['cliente_id_global']}
        parent_products={p['produto_id'] for p in parent_rows if p['produto_id']}
        if len(parent_clients)>1 or len(parent_products)>1: raise ValueError('operational_relationship_identity_conflict')
        client=client or next(iter(parent_clients),None); product=product or next(iter(parent_products),None)
        binding=dict(approved=True,empresa_id=company,cliente_id_global=client,produto_id=product)
        value=project(table,row,binding,source,batch)
        # Lifecycle dates, status and monetary histories stay as originally stored.
        if table=='monthly_calculations': value['detalhes'].update({k:row[k] for k in ('calculation_month','calculation_year') if k in row})
        done[k]=value; active.remove(k); result.append(value)
        edges.extend(dict(source_system=source,parent_table=p[0],parent_id=p[1],child_table=table,child_id=origin) for p in parents)
        return value
    for k in index:
        if k[0] in RULES: resolve(k)
    return dict(rows=result,relationships=edges,held=blocked,new_customers=seeds)
