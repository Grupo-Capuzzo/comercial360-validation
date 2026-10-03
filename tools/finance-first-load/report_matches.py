"""Private review report. Reuses prior matching; no full documents, bank fields or names."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

def minimal_source(path):
    with sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        clients=[dict(table='clients',source_id=r[0],document=''.join(c for c in (r[1] or '') if c.isdigit()),linked_client_id=None) for r in db.execute('SELECT id,cpf FROM clients')]
        private=[dict(table='private_loan_clients',source_id=r[0],document=''.join(c for c in (r[1] or '') if c.isdigit()),linked_client_id=r[2]) for r in db.execute('SELECT id,document,linked_client_id FROM private_loan_clients')]
        shares=[dict(source_id=r[0],client_id=r[1],condominium_id=r[2]) for r in db.execute('SELECT id,client_id,condominium_id FROM shares')]
        products=[dict(source_id=r[0],code=r[1]) for r in db.execute('SELECT id,code FROM condominiums')]
    return clients+private,shares,products

def enrich(previous, source, positions, duplicate_candidates=None):
    duplicate_candidates=duplicate_candidates or {(r['table'],r['source_id']):r['candidates'][0] for r in positions.get('overlap_proposals',[]) if len(r['candidates'])==1}
    destinations={r['cliente_id_global']:r for r in positions.get('clients',[])}
    index={(r['table'],r['source_id']):r for r in source}
    if set(index)!=set((r['table'],r['source_id']) for r in previous['records']):
        raise ValueError('prior_report_identity_set_changed')
    groups={}; records=[]
    for old in previous['records']:
        row=index[(old['table'],old['source_id'])]; doc=row['document']
        group=groups.setdefault(doc,'D'+str(len(groups)+1)) if doc else None
        state=old['status']; target=old['candidate_cliente_id_global']
        if state=='duplicate_source_document': target=duplicate_candidates.get((old['table'],old['source_id']),target)
        if state=='candidate_document_unique':
            situation='candidato'; criterion='documento validado e único na origem e no destino'; decision='aprovar ou rejeitar o vínculo ao UUID existente'
        elif state=='proposed_new_registration':
            situation='novo cadastro'; criterion='documento validado sem correspondência encontrada'; decision='aprovar UUID novo e dados cadastrais mínimos; não criar login'
        else:
            situation='conflito'; criterion='documento inválido/ausente' if state=='document_invalid_or_missing' else 'documento compartilhado por registros de origem'
            decision='corrigir evidência de identidade ou aprovar exclusão explícita da projeção; preservar origem'
        link=row['linked_client_id']
        linked=index.get(('clients',link)) if link is not None else None
        evidence=dict(prior_analysis=state,document_group=group,origin_linked_client_id=link,
                      linked_document_agrees=bool(linked and doc and doc==linked['document']),
                      destination_present=target in destinations,
                      destination_marked_conflict=destinations.get(target,{}).get('tem_conflito'))
        if linked: decision+='; confirmar se o vínculo explícito representa a mesma pessoa, sem unir por nome'
        records.append(dict(table=row['table'],source_id=row['source_id'],proposed_cliente_id_global=target,
                            criterion=criterion,evidence=evidence,situation=situation,decision=decision,
                            impact='vínculo habilita projeção; rejeição não altera CRM e mantém registro privado',approved=False))
    groups_count={g:sum(r['evidence']['document_group']==g for r in records) for g in groups.values()}
    overlap=[{'private_id':r['source_id'],'client_id':r['linked_client_id'],
              'document_agrees': bool(index.get(('clients',r['linked_client_id'])) and r['document']==index[('clients',r['linked_client_id'])]['document'])}
             for r in source if r['table']=='private_loan_clients' and r['linked_client_id'] is not None]
    return dict(project_ref=previous['project_ref'],origin_snapshot=previous['origin_snapshot'],
        counts=dict(source_records=len(records),by_table={t:sum(r['table']==t for r in records) for t in ('clients','private_loan_clients')},
                    confirmed=0,candidates=sum(r['situation']=='candidato' for r in records),
                    proposed_new=sum(r['situation']=='novo cadastro' for r in records),conflict=sum(r['situation']=='conflito' for r in records),
                    explicit_cross_table_links=len(overlap),nonempty_document_groups=len(groups),
                    duplicated_document_groups=sum(n>1 for n in groups_count.values())),
        caveat='Contagens são registros, não pessoas únicas. Vínculo explícito e grupo de documento podem se sobrepor; identidade não foi aplicada.',
        cross_table_overlap=overlap,priority_records=sorted(records,key=lambda r:({'conflito':0,'novo cadastro':1,'candidato':2}[r['situation']],r['table'],r['source_id'])),
        investment_review=positions)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous',type=Path,required=True); parser.add_argument('--sqlite',type=Path,required=True)
    parser.add_argument('--positions',type=Path,required=True); parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[2]
    target=args.output.resolve()
    if target.is_relative_to(repo) or any((parent/'.git').exists() for parent in (target,*target.parents)):
        raise ValueError('private_report_outside_git_required')
    source,shares,products=minimal_source(args.sqlite)
    result=enrich(json.loads(args.previous.read_text(encoding='utf-8')),source,json.loads(args.positions.read_text(encoding='utf-8')))
    result['share_origin_ids']=shares; result['condominium_origin_ids']=products
    evidence=result['investment_review']; clients={r['cliente_id_global']:r for r in evidence.get('clients',[])}
    origins={r['source_id']:r for r in result['priority_records'] if r['table']=='clients'}
    investments=[]
    for share in shares:
        client=origins[share['client_id']]; target=client['proposed_cliente_id_global']
        product=evidence['product_proposals'].get(str(share['condominium_id']))
        groups=[g for g in clients.get(target,{}).get('investment_groups',[]) if g['produto_id']==product]
        investments.append(dict(table='shares',source_id=share['source_id'],client_origin_id=share['client_id'],
            proposed_cliente_id_global=target,proposed_produto_id=product,existing_groups=groups,
            situation='possível sobreposição agregada' if groups else 'sem correspondência de posição comprovada',
            criterion='cliente candidato + produto; posições agregadas não equivalem a cotas individuais',
            decision='aprovar histórico somente, sem inserir posições CRM; qualquer vínculo individual exige evidência adicional',
            consequence='dashboard mantém posições CRM; histórico do lote não é somado novamente',approved=False))
    result['investment_review']={'records':investments,'known_jobs':evidence.get('job_metadata',[])}
    result['counts']['shares_with_possible_existing_position']=sum(bool(r['existing_groups']) for r in investments)
    result['counts']['shares_without_proven_position']=len(investments)-result['counts']['shares_with_possible_existing_position']
    with args.output.open('x',encoding='utf-8') as f: json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result['counts']))
