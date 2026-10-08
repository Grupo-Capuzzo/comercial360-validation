"""Render PRIVATE decisions and draft matches. No names, full documents or bank data.

Reads the prior private report; does not reread SQLite or access any database.
Outputs never imply approval and cannot be used by apply without human decisions.
"""
import argparse
import html
import json
from pathlib import Path
from policy import private_path,PROJECT,VALIDATED_SHA

def render(report):
    esc=lambda value:html.escape(str(value if value is not None else '—'))
    counts=report['counts']
    parts=['<!doctype html><meta charset="utf-8"><title>Decisões privadas — primeira carga</title>',
        '<style>body{font:15px system-ui;max-width:1600px;margin:30px;color:#172333}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #bbc5cf;padding:8px;text-align:left;vertical-align:top}th{background:#edf2f7}pre{white-space:pre-wrap}</style>',
        '<h1>Decisões privadas — referência '+esc(report['origin_snapshot'])+'</h1>',
        '<p>Rascunho: nenhum vínculo aprovado ou aplicado. Não compartilhar no GitHub ou em artefatos de CI.</p>',
        '<p>'+esc(counts['source_records'])+' registros: '+esc(counts['by_table']['clients'])+' clients e '+esc(counts['by_table']['private_loan_clients'])+' private_loan_clients. '+esc(counts['candidates'])+' candidatos, '+esc(counts['proposed_new'])+' novos cadastros propostos e '+esc(counts['conflict'])+' conflitos. Categorias de situação são exclusivas por registro.</p>',
        '<p>Vínculos explícitos entre tabelas: '+esc(counts['explicit_cross_table_links'])+'. Concordância documental é evidência para revisão, não decisão automática. Grupos documentais: '+esc(counts['nonempty_document_groups'])+'; não equivalem a pessoas confirmadas.</p>',
        '<p>Cotas com possível sobreposição agregada: '+esc(counts.get('shares_with_possible_existing_position','não informado'))+'; sem posição comprovada: '+esc(counts.get('shares_without_proven_position','não informado'))+'. Não representam pessoas nem autorizam novas posições.</p>',
        '<h2>Revisão prioritária: conflitos → novos cadastros → candidatos</h2>',
        '<table><tr><th>Tabela / ID de origem</th><th>Destino proposto</th><th>Critério e evidência</th><th>Situação</th><th>Decisão / consequência</th></tr>']
    for row in report['priority_records']:
        evidence=row['evidence']; decision=row['decision']
        if row['situation']=='conflito':
            decision='Confirmar identidade por evidência documental válida e/ou vínculo explícito. Sem resolução, suspender a primeira carga integral; hold não é exclusão silenciosa.'
        parts.append('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in (
            row['table']+' / '+str(row['source_id']),row['proposed_cliente_id_global'],
            row['criterion']+'; '+json.dumps(evidence,ensure_ascii=False),row['situation'],
            decision+' Consequência: '+row['impact']))+'</tr>')
    parts+=['</table><h2>Cotas que exigem decisão sobre sobreposição</h2><p>Recomendação: preservar histórico do lote separado; dashboard continua com posições CRM. Nenhuma ligação individual é comprovada por agrupamento cliente/produto.</p>',
            '<table><tr><th>Origem / cliente origem</th><th>Destino proposto</th><th>Evidência agregada</th><th>Situação / decisão</th></tr>']
    for row in report['investment_review']['records']:
        parts.append('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in (
            'shares / '+str(row['source_id'])+'; clients / '+str(row['client_origin_id']),
            str(row['proposed_cliente_id_global'])+'; produto '+str(row['proposed_produto_id']),
            json.dumps(row['existing_groups'],ensure_ascii=False),row['situation']+'; '+row['decision']))+'</tr>')
    parts+=['</table><h2>Integrações conhecidas — revisão de efeitos pendente</h2>',
            '<pre>'+esc(json.dumps(report['investment_review'].get('known_jobs',[]),ensure_ascii=False,indent=2))+'</pre>',
            '<p>Revisar os efeitos dos jobs listados antes da carga. Este relatório não pausa jobs nem comprova auditoria dos corpos das integrações.</p>']
    return '\n'.join(parts)

def draft(report,snapshot):
    entries=[]
    for row in report['priority_records']:
        entries.append(dict(table=row['table'],source_id=row['source_id'],approved=False,
            decision=None,destination_cliente_id_global=row['proposed_cliente_id_global'],
            proposed_decision='link' if row['situation']=='candidato' else 'create' if row['situation']=='novo cadastro' else 'review_conflict',
            evidence_reference=None,reviewer_decision=None))
    return dict(approved=False,project_ref=PROJECT,source_sha256=snapshot,reference_at=report['origin_snapshot'],
        validated_code_base=VALIDATED_SHA,empresa_id=None,portal_name=None,products={},loan_product_id=None,
        clients=entries,investment_policy=dict(approved=False,mode='historical_only',dashboard_authority='existing_crm'),
        warning='RASCUNHO não executável. Exige decisões humanas, evidências e sementes mínimas de cadastro em arquivo privado.')

def main():
    p=argparse.ArgumentParser(); p.add_argument('--report',type=Path,required=True)
    p.add_argument('--html',type=Path,required=True); p.add_argument('--draft',type=Path,required=True)
    p.add_argument('--snapshot-sha256',required=True); args=p.parse_args()
    report=json.loads(private_path(args.report).read_text(encoding='utf-8'))
    outputs=[private_path(args.html),private_path(args.draft)]
    if any(p.exists() for p in outputs): raise ValueError('review_output_already_exists')
    with outputs[0].open('x',encoding='utf-8') as f: f.write(render(report))
    with outputs[1].open('x',encoding='utf-8') as f: json.dump(draft(report,args.snapshot_sha256),f,ensure_ascii=False,indent=2)
    print('private_review_and_unapproved_draft_created; no database access')

if __name__=='__main__': main()
