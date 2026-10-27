# Correções da revisão recebida — 2026-10-02

Pacote e documentos originais preservados; usados como evidência técnica, sem aceitar comandos anexos como nova autorização. Não houve nova conferência da base real nem acesso remoto nesta rodada.

## Executado

- 11 testes existentes aprovados; caso de repetição atualizado para fornecer campos atuais e fingerprint, sem remover o teste.
- 16 regressões novas aprovadas: desvios URI/environment, Decimal/precisão/tipos, hash antigo/campos alterados, extras, chave nula, otimização Python, tipos SQLite, fechamento, soma vazia, fixtures completas, hash aprovado e bloqueio de acesso legado.
- Compilação Python dos módulos preparados.

F01: parâmetros locais reconstruídos e banco descartável marcado obrigatório. F02: fingerprint tipado distingue texto/número/NULL e normaliza float/Decimal sem converter dinheiro em float. F03: validações explícitas e hash aprovado obrigatório antes/depois da leitura e antes do commit; SQLite em snapshot read-only. F04: campos atuais e hash armazenado conferidos, extras classificados; reconciliação completa dentro da transação com locks.

F05–F06/F10: estrutura/PK/FK, chave nula, soma vazia sem mascarar valores ausentes, fechamento SQLite e ignore ampliado. F07–F08: executor local de recuperação com coleta de FKs, bloqueio de alterações/referências posteriores, coerência origem/lote e ocorrências por snapshot preparados. F09: pequena fatia operacional read-only preparada, com matriz em OPERATIONAL.md; Financeiro completo/API/telas permanecem pendentes.

## Não executado

Não há PostgreSQL/Docker/psql local. DDL, importação PostgreSQL, rollback real, concorrência, recuperação após commit, constraints e RLS real não foram executados. `test_postgres.py` e workflow manual estão preparados, não homologados. Auth é emulado por função SQL na suíte: não equivale a login/JWT Supabase nem teste Next.js ponta a ponta.

## Critério para próxima carga

Workflow revisado/autorizado e executado em ambiente isolado; erros eventualmente encontrados corrigidos; estruturas/vínculos operacionais aprovados; todos os testes financeiros/autorização reais e recuperação homologados; identidade do ambiente de destino, backup e lote/corte confirmados. Nenhuma escrita remota está habilitada por esta entrega.
