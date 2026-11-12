# ERP do Grupo Capuzzo (área do Fernando) — `/erp`

Versão online do app que rodava em Flask no computador do Fernando (Condomínios, Finanças,
Contratos, Operação, Plano de ação). Mesmo layout e mesmas funções; só mudou o formato.
Nenhum arquivo existente do site foi alterado — só arquivos novos (e 3 dependências no package.json).

## Endereços
| Caminho | O que é |
|---|---|
| `/login-grupo` | Login do portal do Grupo (Supabase Auth — o mesmo login do site) |
| `/erp/grupo` | Empresas do Grupo → módulos |
| `/erp/` | Condomínios de Investimento (Capuzzo Assessoria) |
| `/erp/financas/<empresa>/` | Finanças |
| `/erp/contratos/` | Contratos |
| `/erp/operacao/<empresa>/...` | Demandas e chamados |
| `/erp/central/plano` | Plano de ação (administradores) |
| `/auth/contrato/<token>` | Assinatura pública de contratos (sem login) |
| `/login-grupo/static/...` | CSS, JS e logos |

`/login-grupo` e `/auth/contrato` ficam fora de `/erp` porque o `src/proxy.ts` libera sem login só
caminhos que começam com `/login` e `/auth`.

## Variáveis de ambiente (Hostinger → configurar no painel; NUNCA no código)
| Variável | Valor |
|---|---|
| `ERP_DATABASE_URL` | `postgresql://erp_app.<ref>:<senha>@<host do pooler>:5432/postgres` (Supabase → Connect → Session pooler, usuário `erp_app`; servidor Node.js persistente na Hostinger) |
| `ERP_SESSION_SECRET` | texto aleatório longo (assina o cookie de sessão do ERP) |
| `SUPABASE_SECRET_KEY` | chave secreta do Supabase (só servidor) — usada para criar usuários e trocar senhas no portal |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | as que o site já usa |

Na Hostinger, use o **Session pooler**. O Supabase documenta que o pipelining do `postgres.js` no shared transaction pooler (porta 6543) pode deixar consultas pendentes ou retornar linhas desencontradas. `prepare: false` não elimina esse problema. Referência: https://supabase.com/docs/guides/database/postgres-js. Evidências e procedimento: `docs/ASSESSORIA_HTTP500.md`. Não troque usuário, senha ou projeto ao ajustar o modo de conexão.
| `ERP_SEM_AGENDADOR` | opcional: `1` desliga a sincronização automática do Omie |

## Banco
Schema `erp` do Supabase (cópia 1:1 das tabelas do SQLite). O app conecta com o role `erp_app`
(search_path = erp, acesso só ao schema erp via política RLS). Migrações: `docs` do Fernando / Supabase.

## Como funciona (para manutenção)
- `src/erp/templates/` — os templates Jinja originais; `node tools/erp/gerar_templates.mjs` gera `templates.gen.ts`.
- `src/erp/core/` — "Flask" em TypeScript (rotas, url_for, sessão, flash), Jinja via nunjucks, banco (postgres).
- `src/erp/base/`, `src/erp/modulos/` — a lógica de cada arquivo .py original, com os mesmos nomes de funções.
- `src/app/erp/[[...rota]]/route.ts` (e `login-grupo`, `auth/contrato`) — entrada do Next.js.
