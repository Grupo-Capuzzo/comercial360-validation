# Migração financeira — preparação e revisão

Estado: preparação técnica. Nenhuma migration aplicada remotamente. O importador só admite PostgreSQL em localhost e não tem modo de escrita remota. Camada de origem privada proposta; a conexão operacional do Portal/Financeiro será implementada após aprovação de empresa, políticas e correspondências. Nada dispara e-mail, remessa, pagamento ou bootstrap.

## Comandos de leitura

```powershell
python tools/finance-migration/source.py --sqlite <copia-privada.sqlite> --manifest <manifesto-privado.json> --csv-dir <pasta-privada-csv>
python tools/finance-migration/reconcile.py --sqlite <copia-privada.sqlite> --manifest <manifesto-privado.json>
python tools/finance-migration/cli.py --sqlite <copia-privada.sqlite> --source-system <identificador-estavel-aprovado>
python tools/finance-migration/test_engine.py
```

Dry run compara apenas a fonte contra um destino hipoteticamente vazio. Não apresenta conflitos com pessoas existentes no CRM como resolvidos. O arquivo schema.json é exclusivamente metadado de campos/FKs, sem dados ou totais reais.

`target_reconcile.py --sqlite <copia> --source-system <origem>` compara todos os campos de cada linha contra o ensaio PostgreSQL local, em transação somente leitura. Missing/extra/changed são contagens; não imprime dados. Ainda não foi executado por falta de instância PostgreSQL local.

`recovery.py` prepara elegibilidade por lote, fingerprint atual e referências posteriores, sem executar exclusões. `local_recovery.py` coleta referências de FKs no catálogo e permite recuperação seletiva SOMENTE no banco local descartável marcado; qualquer linha alterada ou referência posterior aborta a execução inteira. Não existe modo remoto.

## Ensaio PostgreSQL pendente

As DDLs em migrations/*.review.sql são propostas de revisão, não migrations registradas pelo Supabase CLI. O CLI não está instalado. Ao homologar, gerar os nomes por `supabase migration new` e incorporar as DDLs revisadas. Não adicionar estes arquivos ao deploy automático antes da aprovação.

Em PostgreSQL privado local descartável, aplicar a DDL de origem para ensaio e instalar requirements-test.txt em venv isolado. FINANCE_LOCAL_POSTGRES_DSN exige URI sem query/fragment, credenciais explícitas e nome capuzzo_test_*. Variáveis PG* são rejeitadas. O driver recebe apenas parâmetros reconstruídos com endereço loopback, sem DNS. O banco precisa de marcador `capuzzo.disposable=synthetic-only`; isso não substitui credenciais/rede exclusivas nem autoriza um túnel para produção. Então `cli.py --local-rehearsal --reference-at <referencia> --approved-sha256 <hash-aprovado>` exerce transação com lock por origem/tabelas, FKs diferidas e reconciliação obrigatória antes de confirmar. Extras e conflitos abortam; não há exclusão automática. Repetição intacta resulta em zero inserts. Cada snapshot registra ocorrências separadas do lote de criação.

O workflow `.github/workflows/finance-migration-synthetic.yml` dispara em PR para main somente da branch codex/finance-migration-ci dentro do mesmo repositório, com paths restritos, e conserva disparo manual nessa branch. Usa serviço PostgreSQL 17 efêmero, checkout do SHA da cabeça do PR sem persistência de credenciais e nenhum segredo de produção/deploy. `strict_tests.py` exige contagens exatas (11 originais, 16 regressões, 13 PostgreSQL), zero skips e saída não zero para falha/setup/indisponibilidade. Cria fixtures sintéticas de roles/auth.uid/estruturas CRM; não cria usuários Supabase. Seus testes confirmam current_user, ausência de SUPERUSER/BYPASSRLS e de propriedade das tabelas consultadas. NÃO validam tokens JWT, SSR ou APIs reais. Não executar essa suíte num banco existente. Evidência de execução consta nos logs/resumos do run e inclui SHA efetivamente obtido pelo checkout e versão do servidor.

Testes Python cobrem planejamento, não provam execução PostgreSQL ou políticas RLS. Verificar commit/rollback real, falha no meio da carga, FK órfã, concorrência, numeric, RLS e nova extração com mudanças antes da primeira carga.

## Backup, recuperação e corte

Antes da carga: guardar original, hash, manifesto e snapshot de destino privado; registrar PKs/fingerprints existentes das tabelas afetadas. Executar importação atômica com constraint checks antes do commit. Falha anterior ao commit faz rollback da transação.

Após commit: recuperar somente linhas criadas pelo lote e ainda com o conteúdo importado; conferir fingerprint atual e referências posteriores antes de excluir. O executor local usa FKs diferidas, preserva lotes/ocorrências e impede exclusão se existir vínculo operacional. Linhas alteradas após a carga devem ser resolvidas individualmente, sem apagar trabalho do CRM. O executor ainda precisa de homologação PostgreSQL e não oferece recuperação remota. Não restaurar o banco inteiro sobre o CRM.

Extrações posteriores: source_system continua igual; hash/lote muda. Linhas iguais são no-op, novas são inserts, modificadas são conflitos explícitos. Ausência em snapshot posterior não implica exclusão. Atualizações aprovadas precisam de before-image e compare-and-swap; não há sobrescrita silenciosa.

Reconciliar fonte e destino por tabela, fingerprints, relacionamentos adicionais, grupos financeiros e histórico completo. Reconciliar dados históricos sem emitir eventos novos. Remessas included/generated não são liquidação. Caminhos externos não são documentos disponíveis: anexos serão recebidos por canal privado e armazenados com acesso restrito, sem regeneração de ordens antigas.

Na virada, Fernando congela lançamentos, produz extração final, aprova conflitos e reconciliação final. A aplicação deve gravar somente no Supabase após a virada; verificar ausência de fallback SQLite antes de abrir produção.

## Pendências para aprovação

Definir empresa_id e produtos existentes; conferir correspondências de clientes por origem/documento sem consulta por nome; completar destino operacional e RLS por empresa/módulo; confirmar todas as automações e backups; homologar importador/DDL/recuperação em PostgreSQL privado; revisar lote e plano de corte. Nenhuma senha/hash legado ou usuário de acesso é importado automaticamente.

## Estrutura do destino consultada, somente leitura

Referência confirmada: `umvldqzzliqmgkvoedyd`, a mesma conexão configurada no CRM. Foram consultados catálogos de estrutura, não cadastros de pessoas. As estruturas comerciais existentes permanecem intactas. Os namespaces propostos `financeiro_origem` e `portal_acesso` não existem no destino consultado; sua criação é apenas proposta nos arquivos de revisão.

Foram encontrados dois jobs ativos de pg_cron. A inspeção de metadados não mostrou referência direta aos schemas comerciais nos comandos desses jobs; isso não elimina efeitos indiretos. pg_net está instalado. Nenhum trigger de usuário foi encontrado nos schemas comercial_360/api_comercial, mas há triggers em outros schemas. Revisar funções, tarefas externas e automações da hospedagem antes da carga; esta conferência não comprova ausência de efeitos externos em todo o projeto.
