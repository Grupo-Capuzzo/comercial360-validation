# Release V1 — migrations oficiais, ainda não aplicadas

Os seis arquivos em `migrations/` foram gerados com `supabase migration new`
usando o CLI oficial 2.119.0. A fonte é o commit
`1233daa1820525f788f2d61252914b92a2191b1f` de `release/portal-v1`.
O manifesto `migrations-manifest.json` registra ordem, origem e SHA-256.

## Conversão

Foi preservado todo o SQL das seis propostas, exceto os comandos externos
`BEGIN;` e `COMMIT;`: a execução e o registro ficam a cargo do CLI.
Cada migration recebeu três comentários de proveniência. Os `.review.sql`
originais continuam intactos para rastreabilidade e para não modificar os
executores existentes. Eles não são uma segunda via oficial de aplicação.
`financeiro.sql` corresponde a `financeiro_operacional.review.sql`, e
`control.sql` cria `financeiro_controle` e os controles da projeção.

`commercial-journey.review.sql` não foi convertido: modifica o CRM e está fora
do escopo autorizado. Nenhuma tabela, função, trigger, dado ou policy do CRM
existente foi alterada nesta preparação.

## Ordem e dependências

1. `20261008142948_financeiro_origem.sql`: camada privada de origem e lotes.
2. `20261008142950_portal_acesso.sql`: permissões; depende de Auth e empresas.
3. `20261008142952_financeiro.sql`: vínculos de títulos; depende de origem,
   permissões e cadastros do CRM.
4. `20261008142954_portal_consulta.sql`: sessão, empresas autorizadas, estado,
   projeção e view; depende dos três arquivos anteriores.
5. `20261008142957_control.sql`: journal, correspondências, relações, FKs e
   triggers; completa a exigência de sessão na policy dos títulos.
6. `20261008142959_api_exposure.sql`: exposição dos dois schemas consultáveis,
   depois de todas as estruturas, grants, RLS e revisão de acessos.

O destino documentado é `umvldqzzliqmgkvoedyd` (`servopa-integrations`).
Este checkout NÃO está ligado a um projeto remoto. `config.toml` é configuração
local do CLI, não uma configuração enviada ao Supabase; seeds estão desativados.

Este pacote é incremental: requer `auth.users`, `auth.sessions`, `auth.uid()`,
`auth.jwt()` e as tabelas/chaves existentes `comercial_360.empresas(empresa_id)`,
`clientes(cliente_id_global)`, `produtos(produto_id, empresa_id)` e
`investimento_posicoes(posicao_id)`. Não recria o CRM e não constitui um baseline
para um Supabase vazio. Antes de um futuro `db push`, conciliar o histórico remoto
preexistente com os arquivos locais; não apagar/reparar o histórico para contornar
versions ausentes. Nenhum fetch, repair, pull, link ou db push foi executado.

## Aplicação futura e limites

Arquivos na pasta padrão podem ser aplicados por comandos como `supabase start`,
`db reset`, `migration up` ou `db push`. Sua execução requer autorização separada.
Não foi acrescentado workflow, hook de build ou deploy que os execute.
Esta etapa NÃO executou nenhum desses comandos, importação, carga ou SQL.

`api_exposure` altera configuração do PostgREST: sua guarda exige exatamente
`public, graphql_public, comercial_360, api_comercial` na configuração de
`authenticator`, preserva os quatro schemas e acrescenta apenas `portal_acesso`
e `financeiro`. Nunca expor `financeiro_origem` ou `financeiro_controle`.
Verificar qual configuração é autoritativa no destino antes de aplicar; não usar
SQL e configuração gerenciada como duas alterações independentes.

Conversão não significa homologação de produção. Permanecem os achados da
revisão anterior: a policy de permissões não verifica sessão ativa; FKs dos
vínculos de títulos não garantem juntas coerência produto/empresa/lote; a policy
da projeção permite todos os seus tipos, inclusive plano de ação e remessas.
Esses pontos exigem decisão/revisão antes de exposição. O dono da função
SECURITY DEFINER e o pacote completo precisam de homologação isolada.
Nenhum acesso de usuário ou catálogo de empresa é provisionado por estes SQLs.

## Rollback

Não há migration reversa homologada neste pacote. Um erro de execução deve
interromper a aplicação e exigir conferência do estado e histórico. Depois de
commits anteriores bem-sucedidos, não presumir reversão global do conjunto.
A reversão planejada começa por retirar somente as novas exposições/acessos,
seguida de reversão seletiva dos objetos novos em ordem inversa, após inventário
de dependências e backup. Não usar DROP CASCADE, apagar o CRM ou restaurar o banco
inteiro sobre ele. A recuperação de carga existente não é rollback de DDL e não
foi executada aqui.

## Verificação realizada

Comparação estática de cada migration com seu `.review.sql`, retirando somente
os wrappers externos e os três comentários de proveniência; conferência dos
seis nomes/timestamps únicos, ordem, SHA-256, seeds desativados e diff restrito a
esta pasta. Nenhuma migration foi aplicada, inclusive em banco local. Não foram
executados CI, importadores ou testes que criem tabelas/dados.
