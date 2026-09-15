# Comercial 360 — Grupo Capuzzo

Fundação do frontend corporativo do CRM / Comercial 360, construída com Next.js, React, TypeScript, Tailwind CSS e Supabase JS.

## Requisitos

- Node.js 22 ou superior
- npm 10 ou superior

## Configuração

1. Copie `.env.example` para `.env.local`.
2. Preencha a URL e a chave publicável do projeto `servopa-integrations`.
3. Nunca use `service_role`, secret key, senha PostgreSQL ou connection string administrativa no frontend.

```env
NEXT_PUBLIC_SUPABASE_URL=https://umvldqzzliqmgkvoedyd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Desenvolvimento

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Validação

```bash
npm run lint
npm run typecheck
npm run build
```

## Arquitetura de dados

O dashboard consome exclusivamente as views de leitura `api_comercial.dashboard_executivo` e `api_comercial.produtos_resumo`. Nenhum acesso direto a RAW, tabelas Servopa ou schemas internos é realizado.

Consulte [docs/arquitetura/frontend.md](docs/arquitetura/frontend.md) para decisões, segurança e diagnóstico de permissões.
