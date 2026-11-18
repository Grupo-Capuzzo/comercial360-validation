# Assessoria Financeira: investigação de 30/10/2026

## Causa reproduzida e correção de configuração

Após o PR #12, a implantação ativa usa `main` no SHA `b08639f8f9c3c646106bbb243f4cd7b26a734813` (Hostinger `01a18d8a-2720-7355-8e0a-12f9378b6940`). Os traces autenticados de 14:11 e 14:12 (Brasília) não alcançaram `painel.leituras.fim`; não entraram nos cálculos finais ou no template. Portanto a hipótese anterior de bloqueio na renderização não foi confirmada.

O teste local de produção com Node 22, driver `postgres` 3.4.9, `prepare: false`, conexão real `erp_app` e somente SELECT reproduziu a espera no shared transaction pooler (`aws-1-us-east-1.pooler.supabase.com:6543`). Ao encerrar o teste, permaneceu pendente a consulta de soma dos movimentos por conta, hash `684e6ea0439d`. O mesmo ocorreu com `max_pipeline` 100 e 1. Aumentar timeout não resolve a causa.

O Supabase documenta que o pipelining do postgres.js combinado com esse pooler transacional pode deixar consultas pendentes ou retornar linhas desencontradas: https://supabase.com/docs/guides/database/postgres-js. Para servidor com conexões persistentes, recomenda Session pooler.

Mantendo **exatamente o código publicado** (sem mudanças no cache, queries, cálculos ou templates) e alterando apenas a porta da conexão para **5432**, o teste local concluiu todas as 31 consultas e retornou **HTTP 200 em 8.591 ms**, com renderização em aproximadamente 106 ms. A reprodução na porta 6543 não terminou em 30 segundos (um teste anterior também não terminou em 45 segundos). Esses tempos medem o processo local contra o Supabase, não o carregamento autenticado da Hostinger. A identidade de teste é sintética e apenas local; login e permissões reais precisam de validação final no Portal.

### Aplicação na Hostinger após autorização

1. Site `portal.grupocapuzzo.com.br` → Variáveis de ambiente → editar **somente** `ERP_DATABASE_URL`.
2. Manter esquema URI, host `aws-1-us-east-1.pooler.supabase.com`, usuário `erp_app.umvldqzzliqmgkvoedyd`, senha existente, banco `postgres` e eventuais opções. Trocar exclusivamente a porta `6543` por `5432` (Session pooler).
3. Salvar/aplicar e reimplantar a mesma fonte `b08639f8`, sem importar dados, migrations ou atualizar dependências.
4. Manter o diagnóstico temporário; entrar normalmente e abrir Assessoria. Confirmar `painel.leituras.fim`, `template.render.fim` e `resposta` 200 nos logs, conferindo dados e permissões.
5. Depois da validação, desligar `ERP_ASSESSORIA_DIAGNOSTICO`. Monitorar o limite de conexões: o pool da aplicação continua no máximo 5 por processo. Não aumentar sem necessidade medida.

Rollback de configuração: restaurar apenas a porta anterior e reaplicar a mesma fonte. Isso restaura o modo anterior, incluindo o risco de timeout; não reverte nem altera dados. A alteração de conexão ainda não foi aplicada automaticamente. Este PR corrige a documentação da configuração; nenhum código de runtime foi modificado.

Os experimentos locais de cache/pipeline que não resolveram o bloqueio foram excluídos da alteração final. Credenciais usadas no teste não foram exibidas, versionadas ou mantidas em arquivo temporário após os testes.

## Histórico da investigação inicial

- Base da branch: `acc73cf2` (ver SHA completo em `git rev-parse HEAD` na base). O `origin/main` foi atualizado antes da análise. Os outros checkouts, inclusive `release-qa`, foram preservados.
- Implantação informada: `01a18d0b-abef-711f-bc6f-c171598f785d`. O log informa `Source: previous deployment source`; não contém o SHA. Portanto o SHA efetivamente publicado **não está confirmado** por esse log.
- Build Hostinger: passou em Node 22 / Next 16.3.8, usando fallback SWC WASM. Os avisos GLIBC não impediram esse build; não provam a causa do 500.
- Logs de execução fornecidos: somente inicializações `Ready`, sem exceção de `/erp/financas/assessoria`.
- O trecho enviado do DevTools é da extensão Apollo (`chrome-extension@17.2.1`), não uma resposta HTTP do Portal.
- Verificação pública sem sessão: `/login-grupo` = 200 (Server-Timing ERP 5 ms); `/erp/inicio` e `/erp/financas/assessoria` = 307 para `/login`. Isso confirma que a proteção está ativa, mas não testa a página autenticada na Hostinger.
- Foram consultados apenas metadados e SELECTs no Supabase `umvldqzzliqmgkvoedyd`. Nenhuma migration, carga, alteração de dados, usuários, permissões ou RLS foi executada.

## Nova evidência: timeout do LiteSpeed

O usuário forneceu a resposta de `/erp/inicio` em **30/10/2026 14:30:23 UTC (11:30:23 Brasília)**: status 500, `server: LiteSpeed`, HTML de 384 bytes com título `500 Internal Server Error` e corpo `Request Timeout` / `This request takes too long to process`. Não há `server-timing` do ERP nessa resposta. Os cookies compartilhados não foram usados, copiados para arquivos ou incluídos em logs/PR.

Isso comprova o timeout da resposta de Início no servidor intermediário, não a etapa interna que demorou nem que todas as falhas da Assessoria tenham a mesma origem. Não se deve aumentar o Connection Timeout como se fosse correção comprovada.

No Supabase, a janela 14:25–14:35 UTC não apresentou erro PostgreSQL do ERP. A consulta atual a `pg_stat_activity` encontrou uma conexão `erp_app` ociosa e nenhum bloqueio; esse retrato não reconstrói o estado do momento da falha. Os eventos Auth globais de credenciais inválidas nessa janela não foram atribuídos ao usuário nem ao timeout sem correlação.

A instrumentação foi ampliada estritamente para `/erp/inicio`, pois a falha dessa segunda rota agora está comprovada. O proxy registra início/validação Auth/fim antes de chegar ao handler; o handler registra entrada, consultas e resposta. Os UUIDs do proxy e do handler são independentes: não são compartilhados por cache/global nem por cookies, e não substituem uma correlação por horário/rota. A lógica de autenticação e os cookies SSR permanecem intactos.

**O timeout do LiteSpeed está comprovado para Início; a origem interna da demora e a causa da falha intermitente da Assessoria ainda não. Este PR continua sendo de diagnóstico e tratamento explícito de indisponibilidade, não uma alegação de correção definitiva do 500.**

## Caminho da requisição

1. `src/lib/supabase/proxy.ts`: valida sessão Supabase; redireciona sem sessão.
2. `src/app/erp/[[...rota]]/route.ts`: Route Handler Node, dinâmico, chama `atender`.
3. `src/erp/registro.ts`: registra os módulos.
4. `src/erp/core/app.ts`: resolve `/financas/<slug>/`, executa os ganchos de acesso e o handler `financas.painel`.
5. `src/erp/modulos/financas/index.ts`: `_empresa`, `_ctx`, contas, lançamentos em aberto, resumo do mês, produtos.
6. `src/erp/modulos/financas/dados.ts` e `capuzzo.ts` / `gt.ts`: acesso financeiro via driver Postgres e `core/db.ts`.
7. `financas/painel.html` → `financas/_layout.html` → `portal/base.html`, incluindo `operacao/_barra_empresa.html` e diálogos. As fontes usadas em produção ficam em `templates.gen.ts`.

Não há Server Component React nem layout React específico da Assessoria: o handler renderiza Nunjucks.

## Banco e reprodução

- O ERP usa o schema privado `erp` via conexão PostgreSQL, não as views da Data API de `financeiro`/`portal_consulta` para esse painel. Não é necessário expor `erp` nem mover tabelas para `public`.
- As tabelas financeiras e de produtos consultadas existem, têm SELECT para `erp_app`, RLS ativada e policies para esse papel. `erp_app` tem `search_path=erp`. Não foram modificados.
- Assessoria: 6.303 lançamentos e 36 contas. Nenhum lançamento com `valor`/`vencimento` nulo; nenhuma conta com `saldo_inicial` nulo.
- Categorias padrão e marcador de preparação GT já existem. Os caminhos existentes de preparação podem escrever; por isso a reprodução bloqueou qualquer comando que não fosse SELECT e executou as leituras em `BEGIN READ ONLY ... ROLLBACK`.
- Logs recentes PostgreSQL 42P01 encontrados estavam associados a `operacao_tarefa_etapas`, não às consultas financeiras. Não foram tratados como causa deste incidente nem corrigidos fora do escopo.
- Código-fonte com registro completo e dados reais: HTTP 200 no processo isolado.
- Route Handler do build de produção, com sessão sintética apenas no processo de teste e leituras reais: HTTP 200, 31 consultas. Nenhum usuário real foi autenticado; nenhuma credencial real foi criada/alterada.
- Limite da reprodução: as consultas reais passaram pela CLI administrativa em transações somente leitura, não pela conexão `erp_app` da Hostinger. Tentativa de assumir esse papel via CLI foi recusada (42501), sem mudança de permissões. A conexão, limites e reinícios de processos da Hostinger ainda precisam de evidência do ambiente.
- Os tempos dessa reprodução incluem inicialização/HTTP da CLI. Não são tempos de carregamento representativos da Hostinger e não demonstram ganho antes/depois.

## Alterações preparadas

- Instrumentação opcional só para as rotas exatas Assessoria e Início: `ERP_ASSESSORIA_DIAGNOSTICO=1`, exclusivamente servidor. Desligada por padrão.
- Log por consulta: UUID da requisição, hash da estrutura SQL, duração, sucesso e código de erro seguro. Não grava SQL, parâmetros, dados financeiros, emails, cookies, tokens, senhas, mensagens/detail do PostgreSQL nem string de conexão.
- Consulta que falha agora também entra no contador/tempo. O erro original continua sendo propagado, com HTTP 500 nas falhas críticas.
- Cabeçalho `x-erp-diagnostic-id` correlaciona a resposta com o log quando o diagnóstico está ligado. `server-timing` existente é preservado.
- Falha no bloco opcional de produtos deixa aviso explícito de dados indisponíveis em vez de ocultar silenciosamente o bloco ou inventar indicadores zero. Cálculos e consultas não foram modificados.

## Desempenho: constatações, sem mudança de regras

### Reteste autenticado após publicar o PR #11 (30/10/2026)

Implantação Hostinger `01a18d60-4c3d-702c-9da6-acf70437c285`, fonte `main` em `56cbe40768ba8a1ca1b3c9fbb3821ed25d6eebda`. Início respondeu 200 em 2.801 ms. Nas tentativas da Assessoria às 12:19:42 e 12:20:03 (Brasília), a validação Auth terminou em 3 e 14 ms. Os handlers registraram respectivamente 30 e 33 consultas concluídas com sucesso, com a última em aproximadamente 3,7 e 4,1 segundos desde a entrada. Não apareceu evento `resposta` nem exceção segura desses handlers. A comparação dos hashes com o teste local encontrou as consultas financeiras esperadas concluídas em ambos os traces. Isso delimita a investigação, mas não prova a função que ficou bloqueada.

O build de produção local, inclusive com Node 22.23.4 e compilador SWC WASM, respondeu 200 com leituras reais protegidas por transações READ ONLY. O teste usa uma identidade sintética somente no processo isolado, portanto não valida a sessão/permissão real nem reproduz o runtime Linux da Hostinger. A duração desse teste inclui inicialização do CLI por consulta e não é uma comparação de desempenho com produção.

Marcadores adicionais distinguem conclusão das leituras, conclusão dos cálculos, criação do contexto, inicialização do ambiente e renderização do template. Usam o mesmo UUID do handler e o mesmo opt-in existente, sem registrar conteúdo, mudar consultas/cálculos ou capturar erros adicionais. A falta de um marcador final permite localizar a próxima etapa a investigar; não se apresenta esta instrumentação como correção definitiva do 500. Nenhum aumento de timeout ou alteração financeira foi feito.

O painel carrega todos os lançamentos não cancelados antes de calcular saldo em aberto, embora mostre só 12 próximos vencimentos. `_ctx` faz leituras sequenciais; há leituras repetidas concorrentes antes do cache ser preenchido; o resumo de produtos faz agregações sequenciais por condomínio. O pool é limitado (padrão 5) e pode enfileirar chamadas. Não foi comprovado timeout dessas consultas na Hostinger.

Não foi colocado LIMIT na entrada dos cálculos: truncar linhas alteraria totais financeiros. Qualquer otimização posterior deve comparar os mesmos indicadores e manter o conjunto completo de dados.

## Validação e publicação manual

```sh
node --test tests/assessoria-diagnostics.test.mjs tests/password-recovery.test.mjs
npm run typecheck
npm run build
```

Após revisão e decisão de publicar:

1. Integrar o PR em `main` manualmente; nenhum merge/deploy faz parte desta entrega.
2. Na Hostinger, confirmar repositório e branch `main`. Publicar a fonte atual do GitHub; guardar o SHA mostrado, evitando confundir uma restauração de fonte anterior com atualização do GitHub.
3. Manter as variáveis existentes e habilitar temporariamente `ERP_ASSESSORIA_DIAGNOSTICO=1` (sem `NEXT_PUBLIC_`). Aplicar a configuração conforme o painel.
4. Acessar a Assessoria autenticado. Em DevTools → Rede/Network → requisição Document da página → Headers, guardar status, `server-timing` e `x-erp-diagnostic-id`, sem copiar Cookie/Authorization.
5. Correlacionar o UUID nos Logs de execução com `[erp:assessoria]` e `[erp] portal`. Para Início, verificar também `pagina=inicio`. Entrada `proxy.auth.inicio` sem `proxy.auth.fim` delimita espera na validação Auth; `handler.inicio` sem resposta delimita espera no ERP, e consultas concluídas ajudam a afunilar. Os traces do proxy e do handler têm UUIDs independentes; usar horário e página para relacioná-los. Se o 500 vier sem cabeçalhos ou logs dessas etapas, investigar runtime/proxy, reinícios e limites na Hostinger. Ausência de cabeçalhos isoladamente não prova a origem: o handler pode nem ter sido alcançado ou os cabeçalhos podem ter sido removidos.
6. Após identificar/tratar a causa e validar 200 autenticado, desabilitar a variável de diagnóstico. Não executar SQL, migrations ou cargas para esta instrumentação.

Se o Portal continuar indisponível, a restauração de uma implantação anteriormente funcional é uma decisão operacional separada; não foi realizada automaticamente.
