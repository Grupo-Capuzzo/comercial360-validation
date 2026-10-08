"""Aggregate-only reconciliation; source is always read-only."""
import argparse
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from source import connect


def cents(value):
    if value is None:
        raise ValueError('missing_financial_value')
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def aggregate_cents(value, count):
    return cents(0 if count == 0 and value is None else value)


def verify(path, manifest):
    checks = {}
    with connect(path) as db:
        checks['clients_status'] = sorted(list(db.execute('SELECT status,count(*) FROM clients GROUP BY status'))) == sorted((r['status'],r['qtd']) for r in manifest['totais_para_conferencia']['clientes_por_status'])
        actual = list(db.execute('SELECT c.code,s.status,count(*),sum(s.share_value) FROM shares s JOIN condominiums c ON c.id=s.condominium_id GROUP BY c.code,s.status'))
        checks['shares'] = sorted((a,b,c,cents(d)) for a,b,c,d in actual) == sorted((r['condominio'],r['status'],r['qtd'],cents(r['valor_total'])) for r in manifest['totais_para_conferencia']['cotas_por_condominio_e_status'])
        actual = list(db.execute('SELECT m.id,c.code,m.calculation_year,m.calculation_month,count(i.id),sum(i.income_value) FROM monthly_calculations m JOIN condominiums c ON c.id=m.condominium_id LEFT JOIN monthly_calculation_items i ON i.monthly_calculation_id=m.id GROUP BY m.id'))
        checks['calculations'] = sorted((*r[:-1],aggregate_cents(r[-1],r[-2])) for r in actual) == sorted((r['id'],r['condominio'],r['ano'],r['mes'],r['itens'],cents(r['rendimento_total'])) for r in manifest['totais_para_conferencia']['apuracoes_mensais'])
        actual = list(db.execute('SELECT id,condominium_code,bank_name,payment_date,total_payments,total_amount,status FROM bank_remittance_files'))
        checks['remittance_headers'] = sorted((*r[:5],cents(r[5]),r[6]) for r in actual) == sorted((r['id'],r['condominium_code'],r['bank_name'],r['payment_date'],r['total_payments'],cents(r['total_amount']),r['status']) for r in manifest['totais_para_conferencia']['remessas_bancarias'])
        checks['remittance_included'] = all(n==expected_n and aggregate_cents(amount,n)==cents(expected_amount) and n==valued for n,amount,expected_n,expected_amount,valued in db.execute("SELECT count(i.id),sum(i.amount),f.total_payments,f.total_amount,count(i.amount) FROM bank_remittance_files f LEFT JOIN bank_remittance_items i ON i.remittance_file_id=f.id AND i.status='included' GROUP BY f.id"))
        actual = list(db.execute('SELECT loan_number,status,original_amount,contracted_amount,installments_count FROM private_loans'))
        checks['loans'] = sorted((a,b,cents(c),cents(d),e) for a,b,c,d,e in actual) == sorted((r['loan_number'],r['status'],cents(r['original']),cents(r['contratado']),r['parcelas']) for r in manifest['totais_para_conferencia']['titulos_privados'])
        for child,col,parent in [('central_etapas','tarefa_id','central_tarefas'),('central_subetapas','etapa_id','central_etapas'),('bank_remittance_items','calculation_item_id','monthly_calculation_items')]:
            checks[child+'_'+col] = db.execute(f'SELECT count(*) FROM {child} c LEFT JOIN {parent} p ON p.id=c.{col} WHERE c.{col} IS NOT NULL AND p.id IS NULL').fetchone()[0] == 0
        checks['payment_installment_loan'] = db.execute('SELECT count(*) FROM private_loan_payments p JOIN private_loan_installments i ON i.id=p.installment_id WHERE p.loan_id<>i.loan_id').fetchone()[0] == 0
        checks['calculation_condominium'] = db.execute('SELECT count(*) FROM monthly_calculation_items i JOIN monthly_calculations m ON m.id=i.monthly_calculation_id WHERE m.condominium_id<>i.condominium_id').fetchone()[0] == 0
    return checks


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--sqlite',required=True)
    parser.add_argument('--manifest',required=True)
    args=parser.parse_args()
    checks=verify(args.sqlite,json.loads(Path(args.manifest).read_text(encoding='utf-8')))
    print(json.dumps(checks,indent=2))
    raise SystemExit(0 if all(checks.values()) else 1)
