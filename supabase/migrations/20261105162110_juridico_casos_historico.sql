-- Revisão pendente. Não aplicada ao projeto remoto.
-- Backend ERP apenas. Não expor este schema na Data API.
CREATE SCHEMA juridico;
REVOKE ALL ON SCHEMA juridico FROM PUBLIC, anon, authenticated;

CREATE TABLE juridico.casos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa text NOT NULL CHECK (length(empresa) BETWEEN 1 AND 100),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  cliente_nome text NOT NULL CHECK (length(btrim(cliente_nome)) BETWEEN 1 AND 200),
  cliente_tipo text NOT NULL CHECK (cliente_tipo IN ('PF', 'PJ')),
  cliente_documento text NOT NULL CHECK (cliente_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  cliente_telefone text NOT NULL CHECK (length(btrim(cliente_telefone)) BETWEEN 1 AND 40),
  cliente_email text NOT NULL DEFAULT '' CHECK (length(cliente_email) <= 254),
  condicao text NOT NULL CHECK (condicao IN ('devedor', 'credor')),
  area text NOT NULL CHECK (area IN ('Cível','Criminal','Trabalhista','Contratos','Consultivo','Societário')),
  fase text NOT NULL CHECK (fase IN ('Triagem','Análise','Negociação','Preparação','Ajuizado','Instrução','Recurso','Cumprimento','Concluído')),
  instancia text NOT NULL CHECK (instancia IN ('Não se aplica','1ª instância','2ª instância','Turma recursal','Tribunal superior','STF')),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','encerrado','cancelado')),
  numero_processo text NOT NULL DEFAULT '' CHECK (length(numero_processo) <= 100),
  vara text NOT NULL DEFAULT '' CHECK (length(vara) <= 200),
  comarca text NOT NULL DEFAULT '' CHECK (length(comarca) <= 200),
  parte_contraria text NOT NULL DEFAULT '' CHECK (length(parte_contraria) <= 200),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 10000),
  responsavel text NOT NULL CHECK (length(btrim(responsavel)) BETWEEN 1 AND 200),
  prazo date,
  prazo_descricao text NOT NULL DEFAULT '' CHECK (length(prazo_descricao) <= 500),
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  encerrado_em timestamptz,
  UNIQUE (id, empresa),
  CHECK ((prazo IS NULL AND prazo_descricao = '') OR (prazo IS NOT NULL AND length(btrim(prazo_descricao)) > 0)),
  CHECK ((situacao = 'ativo' AND encerrado_em IS NULL) OR (situacao <> 'ativo' AND encerrado_em IS NOT NULL))
);

CREATE TABLE juridico.eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id uuid NOT NULL,
  empresa text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('cadastro','alteracao','andamento','contato','anotacao')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 10000),
  autor text NOT NULL CHECK (length(btrim(autor)) BETWEEN 1 AND 200),
  anterior jsonb,
  novo jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (caso_id, empresa) REFERENCES juridico.casos(id, empresa) ON DELETE RESTRICT
);
CREATE INDEX casos_empresa_prazo ON juridico.casos (empresa, situacao, prazo, criado_em DESC);
CREATE INDEX eventos_caso_data ON juridico.eventos (caso_id, criado_em DESC, id DESC);

ALTER TABLE juridico.casos ENABLE ROW LEVEL SECURITY;
ALTER TABLE juridico.casos FORCE ROW LEVEL SECURITY;
ALTER TABLE juridico.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE juridico.eventos FORCE ROW LEVEL SECURITY;

-- Contexto definido somente pelo servidor, dentro de BEGIN/COMMIT, após autorização.
CREATE FUNCTION juridico.empresa_permitida(slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(current_setting('juridico.empresas', true), ''), '[]')::jsonb ? slug
    AND length(COALESCE(current_setting('juridico.autor', true), '')) > 0;
$$;
REVOKE ALL ON FUNCTION juridico.empresa_permitida(text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA juridico TO erp_app;
GRANT EXECUTE ON FUNCTION juridico.empresa_permitida(text) TO erp_app;
REVOKE ALL ON ALL TABLES IN SCHEMA juridico FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON juridico.casos TO erp_app;
GRANT SELECT, INSERT ON juridico.eventos TO erp_app;
CREATE POLICY casos_leitura ON juridico.casos FOR SELECT TO erp_app USING (juridico.empresa_permitida(empresa));
CREATE POLICY casos_cadastro ON juridico.casos FOR INSERT TO erp_app WITH CHECK (juridico.empresa_permitida(empresa));
CREATE POLICY casos_edicao ON juridico.casos FOR UPDATE TO erp_app USING (juridico.empresa_permitida(empresa)) WITH CHECK (juridico.empresa_permitida(empresa));
CREATE POLICY eventos_leitura ON juridico.eventos FOR SELECT TO erp_app USING (juridico.empresa_permitida(empresa));
CREATE POLICY eventos_cadastro ON juridico.eventos FOR INSERT TO erp_app WITH CHECK (juridico.empresa_permitida(empresa) AND autor = current_setting('juridico.autor', true));

CREATE FUNCTION juridico.preparar_caso() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.empresa <> OLD.empresa OR NEW.criado_em <> OLD.criado_em THEN
      RAISE EXCEPTION 'Identificação do caso é imutável';
    END IF;
    IF NEW.versao <> OLD.versao + 1 THEN RAISE EXCEPTION 'Versão inválida'; END IF;
  ELSE
    IF NEW.versao <> 1 THEN RAISE EXCEPTION 'Versão inicial inválida'; END IF;
  END IF;
  IF length(btrim(COALESCE(current_setting('juridico.descricao', true), ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Motivo da alteração obrigatório';
  END IF;
  NEW.atualizado_em := now();
  IF NEW.situacao = 'ativo' THEN NEW.encerrado_em := NULL;
  ELSIF TG_OP = 'INSERT' THEN NEW.encerrado_em := now();
  ELSIF NEW.situacao IS DISTINCT FROM OLD.situacao THEN NEW.encerrado_em := now();
  ELSE NEW.encerrado_em := OLD.encerrado_em; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION juridico.auditar_caso() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO juridico.eventos (caso_id, empresa, tipo, descricao, autor, anterior, novo)
  VALUES (NEW.id, NEW.empresa, CASE WHEN TG_OP = 'INSERT' THEN 'cadastro' ELSE 'alteracao' END,
    current_setting('juridico.descricao', true), current_setting('juridico.autor', true),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION juridico.preparar_caso(), juridico.auditar_caso() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER preparar_caso BEFORE INSERT OR UPDATE ON juridico.casos FOR EACH ROW EXECUTE FUNCTION juridico.preparar_caso();
CREATE TRIGGER auditar_caso AFTER INSERT OR UPDATE ON juridico.casos FOR EACH ROW EXECUTE FUNCTION juridico.auditar_caso();
-- Sem DELETE, sem edição do histórico, sem grant a anon/authenticated.
