-- Acesso exclusivamente pelo servidor ERP; sem exposição na Data API.
CREATE FUNCTION juridico.escopo_permitido(slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(current_setting('juridico.empresas', true), ''), '[]')::jsonb ? slug
    AND length(COALESCE(current_setting('juridico.autor', true), '')) > 0;
$$;
CREATE OR REPLACE FUNCTION juridico.empresa_permitida(slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT juridico.escopo_permitido(slug) AND current_setting('juridico.papel', true) = 'juridico';
$$;
REVOKE ALL ON FUNCTION juridico.escopo_permitido(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION juridico.escopo_permitido(text) TO erp_app;

CREATE TABLE juridico.pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa text NOT NULL,
  solicitante text NOT NULL CHECK (length(solicitante) BETWEEN 1 AND 200),
  area text NOT NULL CHECK (area IN ('Cível','Criminal','Trabalhista','Contratos','Consultivo','Societário')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 10000),
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto','em_atendimento','concluido','cancelado')),
  prazo date, resposta_final text NOT NULL DEFAULT '' CHECK (length(resposta_final) <= 10000),
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0),
  criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, empresa), CHECK (situacao <> 'concluido' OR length(btrim(resposta_final)) > 0)
);
CREATE TABLE juridico.pedidos_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pedido_id uuid NOT NULL, empresa text NOT NULL,
  autor text NOT NULL, anterior jsonb, novo jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(pedido_id,empresa) REFERENCES juridico.pedidos(id,empresa)
);
CREATE TABLE juridico.anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa text NOT NULL,
  caso_id uuid, pedido_id uuid, nome text NOT NULL CHECK(length(nome) BETWEEN 1 AND 180),
  tipo text NOT NULL CHECK(tipo IN ('application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  conteudo bytea NOT NULL CHECK(octet_length(conteudo) BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), autor text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((caso_id IS NULL) <> (pedido_id IS NULL)),
  FOREIGN KEY(caso_id,empresa) REFERENCES juridico.casos(id,empresa),
  FOREIGN KEY(pedido_id,empresa) REFERENCES juridico.pedidos(id,empresa)
);
CREATE TABLE juridico.encaminhamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa text NOT NULL,
  referencia text NOT NULL CHECK(length(btrim(referencia)) BETWEEN 1 AND 200),
  caso_id uuid NOT NULL, resumo text NOT NULL CHECK(length(btrim(resumo)) BETWEEN 1 AND 4000),
  historico text NOT NULL CHECK(length(btrim(historico)) BETWEEN 1 AND 10000),
  autor text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa,referencia), UNIQUE(caso_id),
  FOREIGN KEY(caso_id,empresa) REFERENCES juridico.casos(id,empresa)
);
CREATE INDEX pedidos_empresa_data ON juridico.pedidos(empresa,criado_em DESC,id);
CREATE INDEX pedidos_solicitante ON juridico.pedidos(solicitante,criado_em DESC,id);
CREATE INDEX pedidos_auditoria_pedido ON juridico.pedidos_auditoria(pedido_id,criado_em DESC);
CREATE INDEX anexos_caso ON juridico.anexos(caso_id,empresa);
CREATE INDEX anexos_pedido ON juridico.anexos(pedido_id,empresa);
ALTER TABLE juridico.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE juridico.pedidos FORCE ROW LEVEL SECURITY;
ALTER TABLE juridico.pedidos_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE juridico.pedidos_auditoria FORCE ROW LEVEL SECURITY;
ALTER TABLE juridico.anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE juridico.anexos FORCE ROW LEVEL SECURITY;
ALTER TABLE juridico.encaminhamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE juridico.encaminhamentos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA juridico FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON juridico.pedidos TO erp_app;
GRANT SELECT,INSERT ON juridico.anexos,juridico.pedidos_auditoria,juridico.encaminhamentos TO erp_app;
CREATE POLICY pedidos_leitura ON juridico.pedidos FOR SELECT TO erp_app
  USING (juridico.escopo_permitido(empresa) AND (juridico.empresa_permitida(empresa) OR solicitante=current_setting('juridico.autor',true)));
CREATE POLICY pedidos_cadastro ON juridico.pedidos FOR INSERT TO erp_app
  WITH CHECK (juridico.escopo_permitido(empresa) AND solicitante=current_setting('juridico.autor',true) AND situacao='aberto' AND prazo IS NULL AND resposta_final='' AND versao=1);
CREATE POLICY pedidos_edicao ON juridico.pedidos FOR UPDATE TO erp_app
  USING (juridico.empresa_permitida(empresa)) WITH CHECK(juridico.empresa_permitida(empresa));
CREATE POLICY pedidos_auditoria_leitura ON juridico.pedidos_auditoria FOR SELECT TO erp_app USING(juridico.empresa_permitida(empresa));
CREATE POLICY pedidos_auditoria_cadastro ON juridico.pedidos_auditoria FOR INSERT TO erp_app
  WITH CHECK(juridico.escopo_permitido(empresa) AND autor=current_setting('juridico.autor',true));
CREATE POLICY anexos_leitura ON juridico.anexos FOR SELECT TO erp_app
  USING(juridico.empresa_permitida(empresa) OR (juridico.escopo_permitido(empresa) AND pedido_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM juridico.pedidos p WHERE p.id=pedido_id AND p.empresa=anexos.empresa AND p.solicitante=current_setting('juridico.autor',true))));
CREATE POLICY anexos_cadastro ON juridico.anexos FOR INSERT TO erp_app
  WITH CHECK(autor=current_setting('juridico.autor',true) AND (juridico.empresa_permitida(empresa) OR (juridico.escopo_permitido(empresa) AND pedido_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM juridico.pedidos p WHERE p.id=pedido_id AND p.empresa=anexos.empresa AND p.solicitante=current_setting('juridico.autor',true)))));
CREATE POLICY encaminhamentos_leitura ON juridico.encaminhamentos FOR SELECT TO erp_app USING(juridico.empresa_permitida(empresa));
CREATE POLICY encaminhamentos_cadastro ON juridico.encaminhamentos FOR INSERT TO erp_app
  WITH CHECK(juridico.empresa_permitida(empresa) AND autor=current_setting('juridico.autor',true));
CREATE FUNCTION juridico.auditar_pedido() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.empresa<>OLD.empresa OR NEW.solicitante<>OLD.solicitante OR NEW.descricao<>OLD.descricao OR NEW.area<>OLD.area OR NEW.criado_em<>OLD.criado_em
      THEN RAISE EXCEPTION 'Identificação e descrição original do pedido são imutáveis'; END IF;
    IF NEW.versao<>OLD.versao+1 THEN RAISE EXCEPTION 'Versão inválida'; END IF;
  END IF;
  NEW.atualizado_em:=now(); RETURN NEW;
END; $$;
CREATE FUNCTION juridico.registrar_pedido() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO juridico.pedidos_auditoria(pedido_id,empresa,autor,anterior,novo)
    VALUES(NEW.id,NEW.empresa,current_setting('juridico.autor',true),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION juridico.auditar_pedido(),juridico.registrar_pedido() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preparar_pedido BEFORE UPDATE ON juridico.pedidos FOR EACH ROW EXECUTE FUNCTION juridico.auditar_pedido();
CREATE TRIGGER registrar_pedido AFTER INSERT OR UPDATE ON juridico.pedidos FOR EACH ROW EXECUTE FUNCTION juridico.registrar_pedido();
