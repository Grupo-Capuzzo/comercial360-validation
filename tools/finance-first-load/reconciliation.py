"""Exact totals grouped by source measure, never header+items or CRM+history combined."""
from collections import defaultdict
from decimal import Decimal
from policy import fingerprint

def exact_total(values):
    values=[Decimal(v) for v in values]
    if not values: return None
    if any(not v.is_finite() for v in values): raise ValueError('nonfinite_reconciliation_value')
    exponent=min(v.as_tuple().exponent for v in values)
    total=0
    for value in values:
        sign,digits,exp=value.as_tuple()
        total+=(-1 if sign else 1)*int(''.join(map(str,digits)) or '0')*10**(exp-exponent)
    return Decimal((1 if total<0 else 0,tuple(map(int,str(abs(total)))),exponent))

def groups(rows):
    grouped=defaultdict(list); counts=defaultdict(int)
    for row in rows:
        period=(row.get('data_referencia') or '')[:7]
        key=(row['empresa_id'],row.get('produto_id'),row['tabela_origem'],period,row.get('status'))
        counts[key]+=1
        if row.get('valor_preservado') is not None: grouped[key].append(row['valor_preservado'])
    return sorted([dict(group=list(key),records=counts[key],valued_records=len(grouped[key]),
                        total=str(exact_total(grouped[key])) if grouped[key] else None) for key in counts],key=lambda r:str(r['group']))

def verify_projection(store,intent):
    expected=[i['values'] for i in intent['items'] if i['kind']=='projection']
    actual=[store.get(i['entity'],i['key']) for i in intent['items'] if i['kind']=='projection']
    if any(r is None for r in actual): raise ValueError('missing_projection_for_totals')
    source_groups=groups(expected); target_groups=groups(actual)
    if fingerprint(source_groups)!=fingerprint(target_groups): raise ValueError('grouped_financial_reconciliation_failed')
    return dict(groups_checked=len(source_groups),totals_sha256=fingerprint(source_groups))

def origin_numeric_groups(intent,actual=None):
    """Compare every original numeric measure separately; not a new economic balance.

    Table AND field remain in the group: rates, principal, paid amounts, balances
    and header/detail measures are never combined into one financial total.
    """
    from engine import SPEC
    projections={(i['values']['tabela_origem'],i['values']['origem_id']):i['values'] for i in intent['items'] if i['kind']=='projection'}
    counters=defaultdict(int); values=defaultdict(list)
    for entry in intent['items']:
        if entry['kind']!='origin': continue
        table=entry['entity'].split('.')[1]
        row=entry['values'] if actual is None else actual.get(entry['entity'],entry['key'])
        if row is None: raise ValueError('missing_origin_for_numeric_totals')
        binding=projections.get((table,str(entry['key']['id'])),{})
        for column in SPEC[table]['columns']:
            if column['type']!='REAL': continue
            key=(table,column['name'],binding.get('empresa_id'),binding.get('produto_id'),
                 (binding.get('data_referencia') or '')[:7],row.get('status'))
            counters[key]+=1
            if row[column['name']] is not None: values[key].append(row[column['name']])
    return sorted([dict(group=list(k),records=counters[k],valued_records=len(values[k]),
                        total=str(exact_total(values[k])) if values[k] else None) for k in counters],key=lambda r:str(r['group']))

def verify_origin_totals(store,intent):
    expected=origin_numeric_groups(intent); actual=origin_numeric_groups(intent,store)
    if fingerprint(expected)!=fingerprint(actual): raise ValueError('original_numeric_totals_reconciliation_failed')
    return dict(measures_checked=len(expected),totals_sha256=fingerprint(expected))
