# Jurídico — entrega de 05/11/2026

Repositório: Grupo-Capuzzo/comercial360-validation. Branch de implementação: codex/juridico-v1-inicial, baseada em main b08639f8. Publicação autorizada pelo usuário nesta conversa.

## Implementação

- Menu, atalho no Início e card Jurídico nas empresas, seguindo os templates e estilos existentes.
- Casos por empresa: cliente, fase, instância, responsável, prazo, histórico, encerramento/cancelamento sem exclusão. Alterações auditadas atomicamente; controle de versão; cadastro idempotente.
- Visão Jurídico para os administradores existentes: menu do usuário → Ver como Jurídico → menu reduzido e bloqueio das rotas do ERP fora de Jurídico, Empresas e Treinamentos. Voltar à visão Administrador no mesmo menu.
- Nenhum perfil persistente, usuário Auth, senha, UUID ou permissão do CRM foi modificado. Os usuários atuais suporte@grupocapuzzo.com e controladoria@grupocapuzzo.com já são administradores ativos. A visão é uma preferência de sessão no ERP, não uma revogação das permissões das contas nos outros aplicativos.
- Pedidos internos: qualquer usuário ativo com empresa autorizada pode abrir; solicitante vê apenas seus pedidos, status, prazo e resposta final, sem acesso a casos ou auditoria interna. Jurídico define prazo e responde; conclusão exige resposta. Edições ficam auditadas no banco.
- Documentos privados em casos e pedidos: PDF, DOCX, PNG/JPEG; até 5 MB por arquivo, 20 arquivos ou 50 MB por ficha. Assinatura básica e extensão conferidas, SHA-256, downloads autenticados como attachment com no-store/nosniff. DOCX é validado como contêiner ZIP; esta validação não é antivírus. A aplicação não executa ou incorpora os documentos na página.
- Os documentos ficam em bytea no schema jurídico privado do Supabase, como já ocorre com arquivos do ERP; não há bucket público, link aberto ou nova variável secreta.
- Encaminhamento manual da cobrança: card Finanças da empresa → Encaminhar cobrança ao Jurídico. Financeiro preenche referência única, cliente, resumo e linha do tempo e confirma. A operação cria caso em Triagem com histórico na mesma transação; repetir a referência não duplica. Quem não é do Jurídico recebe protocolo sem acesso à ficha interna.
- A linha do tempo é informada e conferida pelo Financeiro; não é uma importação automática. O registro email_logs existente não foi tratado como histórico completo de cobrança. Nenhum ajuizamento ou mensagem é disparado pelo encaminhamento.

## Migrations aplicadas via Supabase CLI

Projeto: umvldqzzliqmgkvoedyd (servopa-integrations).

1. 20261105162110_juridico_casos_historico.sql — SHA-256 625b3669589b3e87ccb455f56f491a44ad646ac642d11f39764faa65c7ab0c5e
2. 20261105170136_juridico_documentos_pedidos_encaminhamentos.sql — SHA-256 ae01809408918581389a1e5574ea3a306afb045cf03c4b7e67d39a7d21ce5a80

O histórico remoto foi recuperado em tests/isolated/juridico-deployment (ignorado pelo Git) para conciliação. Cada dry-run confirmou somente a migration nova. Não houve repair, execução das migrations antigas, seeds ou importações. O CLI registrou as duas aplicações com sucesso.

Schema juridico: casos, eventos, pedidos, pedidos_auditoria, anexos, encaminhamentos. Confirmadas as seis tabelas com RLS habilitada e forçada; backend erp_app sem superuser/bypassrls. Sem grants a anon/authenticated. Contexto de autor, empresas e papel é validado pelo servidor e restrito à transação (SET LOCAL). Não expor o schema na Data API.

Sem alterações em tabelas financeiras, CRM, Auth ou histórico antigo das migrations. Nenhuma migration roda durante login, build ou startup.

## Verificações

9 testes aprovados em PostgreSQL WebAssembly isolado (PGlite 0.3.14), incluindo RLS, auditoria, concorrência, IDOR, CSRF, pedidos próprios, documentos privados e encaminhamento. Fluxo de casos também aprovado no Chrome desktop/mobile com dados sintéticos. Nenhuma credencial de produção é utilizada nesses testes.

Typecheck, lint dos arquivos alterados e build de produção aprovados. O lint global possui 5 erros preexistentes em base/dec.ts, base/pyextra.ts, core/jinja.ts, core/py.ts e na diretiva original de templates.gen.ts; não foram alteradas regras financeiras/core para corrigi-los.

Para repetir os testes, usar os comandos e o runtime externo descritos no documento histórico. O teste opcional de navegador usa JURIDICO_BROWSER=1.

## Homologação no site após publicação

1. Entrar normalmente em /login-grupo como Administrador.
2. Menu do usuário → Ver como Jurídico. Confirmar Jurídico, Empresas e Treinamentos, sem CRM Geral/Plano de Ação na visão do ERP.
3. Cadastrar um caso da empresa correta; registrar movimentação; alterar prazo e verificar histórico; encerrar/cancelar preservando registros.
4. Anexar um documento não sensível, baixar e conferir integridade.
5. Abrir pedido, definir prazo/resposta e verificar isolamento do solicitante.
6. Retornar à visão Administrador e testar o encaminhamento manual com referência única e histórico conferido.

Não registrar dados fictícios como processos reais. Testes destrutivos ou exclusões de histórico não fazem parte da homologação.

## Próximas etapas

Validar vocabulário de fases/instâncias com a advogada e cadastrar sua conta específica quando identificada. Notificações automáticas por e-mail, integração n8n/WhatsApp, indicadores no Início e importação estruturada de histórico são entregas posteriores; não há disparos automáticos nesta publicação.

Rollback: voltar ao código anterior e preservar os dados jurídicos. Não remover tabelas ou arquivos com registros. Não houve alteração da conexão Session pooler da Hostinger, das credenciais ou das regras financeiras.
