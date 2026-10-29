# Recuperação de senha do Portal

O link no layout do Fernando abre /forgot-password e solicita somente email. O envio é feito por resetPasswordForEmail do Supabase Auth, com PKCE e cookies SSR. /reset-password realiza explicitamente uma única troca por sessão, valida o usuário no Auth e libera updateUser somente após validar a recuperação. Sessões comuns não liberam o formulário. O usuário informa e confirma sua senha pessoalmente.

O redirect padrão de produção é https://portal.grupocapuzzo.com.br/reset-password; em desenvolvimento, http://localhost:3100/reset-password. NEXT_PUBLIC_PASSWORD_RESET_REDIRECT_URL permite configurar outro destino explicitamente. Esses endereços devem constar na allowlist do Supabase. Abra o email no navegador e origem em que solicitou o link.

Após sucesso, a sessão de recuperação é encerrada localmente e o login do ERP mostra Senha alterada com sucesso. São tratados erros de rede, senha fraca, código inválido/expirado/consumido, verificador ausente e sessão revogada. Logs de requisições de desenvolvimento e encaminhamento de console estão desligados para não registrar códigos.

Verificação: node --test tests/password-recovery.test.mjs. Os endpoints de Auth dos testes são simulados; nenhum código real é consumido. O teste real depende do destinatário abrir o email e submeter a nova senha.

Este fluxo não altera a senha do role PostgreSQL erp_app, o segredo de sessão do ERP ou ERP_DATABASE_URL. A rotação da credencial de banco é uma operação administrativa separada e exige atualização coordenada da Hostinger e demais consumidores. Não há migrations ou alterações de permissões.
