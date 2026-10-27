# Portal do Grupo Capuzzo — layout

**Divisão:** o layout do portal (login, cards das empresas, identidade visual de cada empresa,
página de módulos) é do **Fernando**. Autenticação, permissões e dados no Supabase são da **Bia**.

Estes componentes são **só apresentação**: não importam Supabase, não leem cookies e não gravam nada.
Tudo entra por props. Para ligar às rotas reais (`/login`, `/portal`, `/portal/empresas/[empresa]`),
a página da Bia busca os dados com os serviços dela e renderiza a view correspondente.

| View | Uso | O que a integração fornece |
| --- | --- | --- |
| `PortalLoginView` | tela de login | `acao`: server action `(estado, FormData) => Promise<EstadoLogin>`. FormData traz `acesso` (`admin`/`usuario`), `email`, `password`. Devolve `{ erro, email, acesso }` ou faz `redirect`. |
| `PortalGrupoView` | página inicial com os cards | `user`, `links`, `empresas: EmpresaCard[]` (já filtradas pela permissão), `favoritas`, e opcionalmente as server actions `onFavoritar` e `onSalvarConfig`. |
| `PortalEmpresaView` | empresa → somente módulos | `t` (tema da empresa), `user`, `links`, `empresa`, `modulos: ModuloCard[]` (só os liberados, com `href`). |
| `PortalModuloView` | módulo em construção | idem + `empresaHref` e `atual`. |

- Identidade visual (logo, cores, fonte) e módulos de cada empresa: `portal-data.ts` (`EMPRESAS`, `tema()`).
  A integração precisa mapear o `empresa_id` do Supabase para a entrada correspondente (ex.: coluna `slug`) — a combinar.
- Logos em `public/portal/logos/`.
- Regras do portal original a manter na integração: tipo de acesso "Administrador" só para perfil admin
  (mensagem "Este usuário não tem acesso de Administrador. Entre como Usuário."); usuário comum vê só
  empresas liberadas e não-inativas; empresa inativa não abre para não-admin.

## Módulos por empresa (definição do Fernando)

| Empresa | Módulos |
| --- | --- |
| Capuzzo Assessoria | Condomínios (disponível), Comercial (Bia), Finanças, Jurídico |
| Capuzzo Cred | Comercial (Bia), Finanças, Jurídico |
| Ether Nexus | Finanças, Comercial (Bia), Orçamentos |
| Terceiriza Fácil | Comercial (Bia), Finanças |
| Hortstufas | Produção, Comercial (Bia), Finanças, Orçamento |
| Grão, World Gym | nenhum por enquanto |

Disponíveis hoje: **Condomínios** (Fernando) e **Comercial** (Bia — rota `/comercial/[empresa]`, CRM).
Os demais aparecem com a etiqueta "Em construção". O campo `origem` de cada módulo indica quem o desenvolve;
a integração decide a rota real e esconde os módulos que o usuário não tem permissão de ver.
