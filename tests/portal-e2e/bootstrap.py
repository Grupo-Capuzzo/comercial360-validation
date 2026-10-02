"""Seeds ONLY a fresh LOCAL Supabase stack in GitHub Actions, synthetic data."""
import json
import os
from pathlib import Path
import urllib.request
import psycopg

root=Path(__file__).parents[2]
status=json.loads((root/'tests/isolated/status.json').read_text())
url=status['API_URL']; dsn=status['DB_URL']
if os.environ.get('GITHUB_ACTIONS')!='true' or not url.startswith('http://127.0.0.1:54321') or not dsn.startswith('postgresql://postgres:postgres@127.0.0.1:54322/'):
    raise ValueError('fresh_local_CI_only')
key=status['SERVICE_ROLE_KEY']
with psycopg.connect(dsn) as check:
    version = check.execute('SHOW server_version').fetchone()[0]
    if not version.startswith('17.'):
        raise ValueError('PostgreSQL_17_required')
    print('Local Auth PostgreSQL:', version)
    if check.execute("SELECT to_regnamespace('comercial_360')").fetchone()[0] is not None or check.execute('SELECT count(*) FROM auth.users').fetchone()[0]!=0:
        raise ValueError('existing_database_rejected_before_auth_seed')
users={}
for tag in ['alice','bob','commercial']:
    request=urllib.request.Request(url+'/auth/v1/admin/users',data=json.dumps({'email':tag+'@example.test','password':'Synthetic-Only-2026!','email_confirm':True}).encode(),headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    with urllib.request.urlopen(request) as response: users[tag]=json.load(response)['id']
a='00000000-0000-0000-0000-000000000001'; b='00000000-0000-0000-0000-000000000002'
with psycopg.connect(dsn) as db:
    if db.execute("SELECT to_regnamespace('comercial_360')").fetchone()[0] is not None: raise ValueError('existing_database_rejected')
    db.execute('CREATE SCHEMA comercial_360; CREATE TABLE comercial_360.empresas(empresa_id uuid PRIMARY KEY); CREATE TABLE comercial_360.clientes(cliente_id_global uuid PRIMARY KEY); CREATE TABLE comercial_360.produtos(produto_id uuid PRIMARY KEY,empresa_id uuid REFERENCES comercial_360.empresas)')
    for name in ['financeiro_origem','portal_acesso','financeiro_operacional','portal_consulta']:
        db.execute((root/'tools/finance-migration/migrations'/f'{name}.review.sql').read_text())
    db.execute('INSERT INTO comercial_360.empresas VALUES (%s),(%s)',(a,b))
    db.execute('INSERT INTO comercial_360.clientes VALUES (%s),(%s)',(a,b))
    db.execute('INSERT INTO comercial_360.produtos VALUES (%s,%s),(%s,%s)',(a,a,b,b))
    db.execute("INSERT INTO portal_acesso.empresas_portal VALUES (%s,'Empresa Sintética A'),(%s,'Empresa Sintética B')",(a,b))
    for tag,company,modules in [('alice',a,['financeiro','comercial']),('bob',b,['financeiro']),('commercial',a,['comercial'])]:
        for module in modules:
            db.execute('INSERT INTO portal_acesso.permissoes VALUES (%s,%s,%s,true,false)',(users[tag],company,module))
    for company,label in [(a,'A'),(b,'B')]:
        db.execute("INSERT INTO financeiro.estado_carga VALUES (%s,'sintetico','2026-10-01')",(company,))
        source='synthetic-'+label; batch=source+':snapshot'
        db.execute('INSERT INTO financeiro_origem.lotes VALUES (%s,%s,%s,%s)',(batch,source,'synthetic-hash','synthetic-reference'))
        for section in ['clientes','cotas','apuracoes','titulos','parcelas']:
            db.execute("INSERT INTO financeiro.registros_consulta(empresa_id,source_system,tabela_origem,origem_id,tipo,lote_id,cliente_id_global,produto_id,descricao,status,valor_preservado,data_referencia,detalhes) VALUES (%s,%s,%s,'1',%s,%s,%s,%s,%s,'synthetic',10.250000000001,'2026-10-01','{\"historico\":\"sintetico\"}')",(company,source,section,section,batch,company,company,section+' synthetic-'+label))
    db.execute("NOTIFY pgrst,'reload schema'")
# Runtime fixture only; no production credentials or users.
(root/'tests/isolated/fixture.json').write_text(json.dumps({'users':users,'a':a,'b':b}))
with open(os.environ['GITHUB_ENV'],'a') as env:
    env.write('NEXT_PUBLIC_SUPABASE_URL='+url+'\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='+status['ANON_KEY']+'\n')
print('Fresh local Supabase Auth and five synthetic finance sections seeded.')
