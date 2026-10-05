# Resultados executados — recorte comercial

Data: 05/10/2026. Branch local `codex/commercial-delivery`.

Base dos testes: `f779a3ab73fdb12ee844d16faa8f0b82da55b985`, descendente da referência validada `dd36dc50e6fc6937ebf8f53ffcc4370875bd1586`. Os testes abaixo foram executados sobre os novos arquivos antes do commit da entrega comercial; esse SHA identifica a base anterior, **não** o commit da implementação nova. O commit publicado é identificado pela revisão Git deste documento e do Draft PR comercial.

## Executado localmente

| Suíte | Executados | Aprovados | Falhas/erros | Ignorados |
| --- | ---: | ---: | ---: | ---: |
| Domínio TypeScript comercial | 41 | 41 | 0 | 0 |
| Limites HTTP / origem / validação | 8 | 8 | 0 | 0 |
| Navegador Chromium — formulário Next.js local | 4 | 4 | 0 | 0 |
| Python anterior — engine | 11 | 11 | 0 | 0 |
| Python anterior — regressões | 16 | 16 | 0 | 0 |
| Python anterior — projeção preservada | 6 | 6 | 0 | 0 |
| Python anterior — primeira carga preservada | 47 | 47 | 0 | 0 |

Total final: **133 casos**, 53 novos comerciais e 80 regressões anteriores. Não somar reexecuções locais como casos novos. Zero retries configurados no navegador. A execução final do navegador levou 5,3 segundos; a suíte Node final levou aproximadamente 0,61 segundo. Warning de detecção de módulos Node e de cores Playwright não são falhas nem skips.

Na preparação do commit/push, somente a documentação de colaboração/consumo foi atualizada; a implementação não mudou. A suíte Node de 49 casos foi reexecutada localmente: 49 aprovados, zero falhas/erros/ignorados, aproximadamente 1,35 segundo. Não foi disparada nova rodada de GitHub Actions; os quatro casos de navegador e 80 casos Python da tabela permanecem evidências da execução anterior, não reexecuções nesta publicação.

Lint (`eslint .`), typecheck (`tsc --noEmit`) e build (`next build --webpack`) concluíram sem erros. Next.js instalado pelo lockfile: 16.3.8, Node 24.17.0. Não houve atualização de dependências/lockfile. O build regenerou `next-env.d.ts` localmente; esse artefato não faz parte do commit comercial e foi preservado como alteração local.

Os casos novos incluem: entrada simples, dados de autoridade proibidos, reenvio idempotente, nova solicitação legítima, complementação no mesmo vínculo, contrato único com vários itens, precisão decimal, proposta/assinatura pendentes bloqueando fechamento, revisão jurídica separada, output sem duplicação, dados de outra empresa negados, DTO financeiro sem campos cadastrais, histórico com agrupamento não comprovado pendente e ausência de efeitos financeiros.

## Falha encontrada e corrigida

Duas execuções locais de navegador tiveram 3 aprovados e 1 falho: `real local handler rejects forged authority and fails closed without database configuration`. O handler devolvia 400 em vez de 503. O diagnóstico identificou `origin_denied`: a URL interna reconstruída pelo Next.js não refletia a origem externa de loopback.

A correção exige origem pública canônica configurada no servidor em produção, mantém a negação de origem não autorizada e não confia em forwarded headers. Foram acrescentadas duas regressões HTTP. A mesma suíte completa de quatro casos passou depois da correção, sem diminuir asserções, excluir casos ou aumentar retries.

## Limites — não executado nesta etapa

- Novos RPCs/SQL/PostgreSQL: **não executados**. A revisão SQL não foi aplicada, nem local nem remotamente. Não havia executáveis PostgreSQL/Docker disponíveis no ambiente consultado.
- Novos grants/RLS e concorrência real: **não homologados**; casos de autorização do domínio não substituem papéis SQL reais.
- Jornada completa com Supabase Auth/JWT/SSR e persistência real: **não executada**. O domínio usou repositório sintético exclusivo dos testes; navegador usou catálogo/recebimento interceptados. O handler de erro foi exercido de verdade sem banco configurado.
- Oito casos JWT da integração anterior: preservados, não reexecutados e não usados como aprovação do novo fluxo.
- Correspondências e publicação do histórico real: não aplicadas; classificação nova não prova agrupamentos que faltam na origem.
- Assinatura externa, migração/carga real, novas operações financeiras e produção: não executadas.
- GitHub Actions: nenhuma execução nova. Os resultados anteriores continuam válidos somente para o código/cenários que executaram.

## Arquivos desta implementação

Adicionados:

- `src/lib/commercial/journey.ts`, `http.ts`;
- `src/services/commercial-journey.service.ts`;
- `src/components/commercial/input-form.tsx`, `journey-panel.tsx`;
- `src/app/contato/page.tsx`;
- `src/app/crm/[id]/formalizacao/page.tsx`;
- `src/app/api/comercial/input/route.ts`, `catalogo/route.ts`, `jornada/[id]/route.ts`, `outputs/[empresa]/route.ts`;
- `tests/commercial/journey.test.mjs`, `http.test.mjs`, `input.spec.mjs`, `playwright.config.mjs`;
- `tools/commercial-output/sql/commercial-journey.review.sql`;
- `docs/COMMERCIAL_INPUT_OUTPUT.md`, este relatório.

Alterados na entrega: links nas páginas CRM/Leads, limite público exato em `src/lib/supabase/proxy.ts` e orientação de formalização antes de `FECHADO` em `src/services/crm.service.ts`. Alteração local gerada e excluída do envio: `next-env.d.ts`.

Não alterados: ferramentas financeiras, conexão global do CRM, workflows, PRs, bases privadas e workspace original. Nenhum dado real, documento pessoal, credencial ou relatório privado foi copiado para estes arquivos.
