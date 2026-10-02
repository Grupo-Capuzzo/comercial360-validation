"""Pure reviewed projection builder. No database, inference, recalculation or writes."""
from decimal import Decimal

# kind, amount, reference date. Values remain original, never recomputed.
RULES = {
    'clients': ('clientes', None, 'created_at'),
    'private_loan_clients': ('clientes', None, 'created_at'),
    'shares': ('cotas', 'share_value', 'acquisition_date'),
    'monthly_calculations': ('apuracoes', None, 'calculated_at'),
    'monthly_calculation_items': ('apuracoes', 'income_value', 'period_end'),
    'private_loans': ('titulos', 'contracted_amount', 'start_date'),
    'private_loan_installments': ('parcelas', 'installment_amount', 'due_date'),
    'private_loan_payments': ('recebimentos', 'amount', 'payment_date'),
    'private_loan_amortizations': ('amortizacoes', 'amount', 'payment_date'),
    'private_loan_extensions': ('renovacoes', 'extension_amount', 'reference_date'),
    'bank_remittance_files': ('remessas', 'total_amount', 'payment_date'),
    'bank_remittance_items': ('remessas', 'amount', None),
    'central_tarefas': ('plano_acao', None, 'criado_em'),
    'central_etapas': ('plano_acao', None, 'prazo'),
    'central_subetapas': ('plano_acao', None, 'concluido_em'),
}
SAFE_DETAILS = {'condominium_id','client_id','private_client_id','linked_client_id',
    'share_id','monthly_calculation_id','loan_id','installment_id','remittance_file_id',
    'calculation_item_id','calculation_id','tarefa_id','etapa_id','share_number','loan_number',
    'installment_number','share_value','original_amount','contracted_amount','income_value',
    'principal_amount','interest_amount','installment_amount','paid_amount','amount',
    'amount_before','amount_after','extension_amount','principal_kept_amount',
    'calculation_month','calculation_year','period_start','period_end','applied_rate',
    'active_days','total_period_days','maturity_date','last_renewal_date','withdrawal_date',
    'withdrawal_requested','withdrawal_request_date','withdrawal_effective_date',
    'accrual_until_withdrawal','due_date','paid_date','covered_until_date','status'}

def scalar(value):
    if isinstance(value, float): raise ValueError('binary_float_not_accepted_for_preserved_values')
    return str(value) if isinstance(value, Decimal) else value

def project(table, row, binding, source_system, batch):
    if table not in RULES: raise ValueError('private_or_unmapped_table')
    if binding.get('approved') is not True: raise ValueError('binding_not_approved')
    kind, amount, date = RULES[table]
    if not binding.get('empresa_id') or not source_system or not batch or row.get('id') is None:
        raise ValueError('stable_origin_batch_company_required')
    if kind not in ('apuracoes','remessas','plano_acao') and not binding.get('cliente_id_global'):
        raise ValueError('approved_client_required')
    # Existing CRM position is linked only, never recreated or summed here.
    return dict(empresa_id=binding['empresa_id'], source_system=source_system,
        tabela_origem=table, origem_id=str(row['id']), tipo=kind, lote_id=batch,
        cliente_id_global=binding.get('cliente_id_global'), produto_id=binding.get('produto_id'),
        posicao_crm_id=binding.get('posicao_crm_id'), descricao=table+' #'+str(row['id']),
        status=row.get('status'), valor_preservado=scalar(row.get(amount)) if amount else None,
        data_referencia=row.get(date) if date else None,
        detalhes={key:scalar(value) for key,value in row.items() if key in SAFE_DETAILS})

def classify(current, desired):
    if current is None: return 'create'
    return 'unchanged' if current == desired else 'blocked'
