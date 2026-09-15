# Fundação do frontend Comercial 360

## Decisões técnicas

- Next.js App Router com TypeScript estrito.
- Tailwind CSS para o sistema visual, sem biblioteca externa de componentes.
- Cliente Supabase único e centralizado em `src/lib/supabase/client.ts`.
- Camada de serviço isolada em `src/services/dashboard.service.ts`.
- Tipos explícitos para as views consumidas.
- Dashboard somente leitura, sem mutações de banco.

## Autoridade dos dados

- D4: cadastro, origem e contratos.
- Servopa: operação atual de Consórcio.
- Grupo Capuzzo App: posição financeira atual dos investimentos sob seu escopo.
- Comercial 360: consolidação multidomínio, sem substituir as fontes.

O frontend consome apenas `api_comercial`; não consulta schemas RAW ou tabelas operacionais diretamente.

## Diagnóstico de acesso — 26/08/2026

As views `api_comercial.dashboard_executivo`, `api_comercial.produtos_resumo` e `api_comercial.cliente_360` existem e foram criadas com `security_invoker=true`.

O teste com a role `anon` retornou PostgreSQL `42501: permission denied for schema api_comercial`.

Estado observado:

- `anon`: sem `USAGE` no schema e sem `SELECT` nas views;
- `authenticated`: sem `USAGE` no schema e sem `SELECT` nas views;
- tabelas-base em `comercial_360`: RLS habilitado;
- nenhuma policy aplicável foi encontrada nas tabelas-base auditadas.

Nenhuma permissão foi alterada. Antes de liberar dados ao frontend, deve ser definido o modelo de autenticação/autorização e então configurados, com menor privilégio:

1. exposição do schema `api_comercial` na Data API;
2. `GRANT USAGE ON SCHEMA api_comercial` somente para a role aprovada;
3. `GRANT SELECT` apenas nas views aprovadas;
4. grants mínimos e policies RLS coerentes nas dependências, pois as views usam `security_invoker`;
5. teste com JWT real da role escolhida.

Não é recomendado liberar essas views para `anon` enquanto elas contiverem dados corporativos internos.
