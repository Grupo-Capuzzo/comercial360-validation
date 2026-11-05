import { sql } from "../../core/db";
import { CasoNaoEncontrado, ConflitoJuridico, ValidacaoJuridica, validarCaso, type Caso, type Evento } from "./modelo";

export interface ExecutorJuridico { consultar<T>(sql: string, params?: unknown[]): Promise<T[]> }
export type TransacaoJuridica = <T>(empresas: string[], autor: string, descricao: string, fn: (db: ExecutorJuridico) => Promise<T>) => Promise<T>;
export const transacao: TransacaoJuridica = async (empresas, autor, descricao, fn) => {
  // SET LOCAL fica restrito à transação: nunca vaza para outra sessão do pool.
  return await sql().begin(async tx => {
    await tx.unsafe("SELECT set_config('juridico.empresas', $1, true), set_config('juridico.autor', $2, true), set_config('juridico.descricao', $3, true), set_config('juridico.papel', 'juridico', true), set_config('statement_timeout', '10000', true)", [JSON.stringify(empresas), autor, descricao]);
    return await fn({ consultar: async <T>(q: string, p: unknown[] = []) => Array.from(await tx.unsafe(q, p as never[])) as T[] });
  }) as Awaited<ReturnType<typeof fn>>;
};
const COLUNAS = "c.*, c.prazo::text AS prazo, c.criado_em::text AS criado_em, c.atualizado_em::text AS atualizado_em, c.encerrado_em::text AS encerrado_em";
export function criarRepositorio(executar: TransacaoJuridica = transacao) {
  return {
    listar(empresas: string[], autor: string, filtros: { busca: string; area: string; situacao: string; pagina: number }) {
      return executar(empresas, autor, "", async db => {
        // Parâmetros sempre vinculados; curingas da busca são literais.
        const busca = filtros.busca.replace(/[\\%_]/g, "\\$&");
        return db.consultar<Caso>(`SELECT ${COLUNAS} FROM juridico.casos c WHERE empresa = ANY($1::text[]) AND ($2 = '' OR cliente_nome ILIKE $2 ESCAPE '\\' OR titulo ILIKE $2 ESCAPE '\\') AND ($3 = '' OR area = $3) AND situacao = $4 ORDER BY c.prazo ASC NULLS LAST, c.criado_em DESC, c.id LIMIT 51 OFFSET $5`, [empresas, busca ? `%${busca}%` : "", filtros.area, filtros.situacao, (filtros.pagina - 1) * 50]);
      });
    },
    consultar(empresas: string[], autor: string, id: string, pagina = 1) {
      return executar(empresas, autor, "", async db => {
        const caso = (await db.consultar<Caso>(`SELECT ${COLUNAS} FROM juridico.casos c WHERE id = $1 AND empresa = ANY($2::text[])`, [id, empresas]))[0];
        if (!caso) throw new CasoNaoEncontrado();
        const eventos = await db.consultar<Evento>("SELECT e.*, e.criado_em::text AS criado_em FROM juridico.eventos e WHERE caso_id = $1 AND empresa = $2 ORDER BY e.criado_em DESC, e.id DESC LIMIT 51 OFFSET $3", [id, caso.empresa, (pagina - 1) * 50]);
        return { caso, eventos };
      });
    },
    salvar(empresas: string[], autor: string, empresa: string, entrada: Record<string, string>, id?: string) {
      if (!empresas.includes(empresa)) throw new CasoNaoEncontrado();
      const dados = validarCaso(entrada);
      if (!id && dados.situacao !== "ativo") throw new ValidacaoJuridica("Novos casos devem começar ativos.");
      if (!id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entrada.cadastro_id ?? "")) throw new ValidacaoJuridica("Formulário de cadastro inválido. Reabra o formulário.");
      const motivo = (entrada.motivo ?? "").trim();
      if (id && (!motivo || motivo.length > 2000)) throw new ValidacaoJuridica("Informe o motivo da alteração com até 2000 caracteres.");
      const versao = Number(entrada.versao);
      if (id && (!Number.isSafeInteger(versao) || versao < 1)) throw new ValidacaoJuridica("Versão inválida. Recarregue a ficha.");
      return executar(empresas, autor, id ? motivo : "Cadastro do caso", async db => {
        const campos = Object.keys(dados);
        const valores = Object.values(dados);
        if (!id) {
          const rows = await db.consultar<{ id: string }>(`INSERT INTO juridico.casos (id, empresa, ${campos.join(', ')}) VALUES ($1, $2, ${campos.map((_, i) => `$${i + 3}`).join(', ')}) ON CONFLICT (id) DO NOTHING RETURNING id`, [entrada.cadastro_id, empresa, ...valores]);
          if (rows[0]) return rows[0].id;
          // Reenvio do mesmo formulário não duplica cadastro nem histórico.
          const existente = await db.consultar<Caso>(`SELECT ${COLUNAS} FROM juridico.casos c WHERE id = $1 AND empresa = $2`, [entrada.cadastro_id, empresa]);
          if (!existente[0]) throw new ConflitoJuridico("Identificador já utilizado. Abra um novo formulário.");
          if (Object.entries(dados).some(([campo,valor]) => (existente[0] as Record<string,unknown>)[campo] !== valor)) throw new ConflitoJuridico("Este formulário já foi concluído com outros dados. Reabra a ficha existente ou um novo cadastro.");
          return existente[0].id;
        }
        const rows = await db.consultar<{ id: string }>(`UPDATE juridico.casos SET ${campos.map((k, i) => `${k} = $${i + 1}`).join(', ')}, versao = versao + 1 WHERE id = $${campos.length + 1} AND empresa = $${campos.length + 2} AND versao = $${campos.length + 3} RETURNING id`, [...valores, id, empresa, versao]);
        if (!rows.length) throw new ConflitoJuridico("O caso foi alterado em outra sessão ou não está mais disponível. Reabra a ficha antes de salvar.");
        return rows[0].id;
      });
    },
    anotar(empresas: string[], autor: string, id: string, tipo: string, descricao: string) {
      descricao = descricao.trim();
      if (!["andamento", "contato", "anotacao"].includes(tipo) || !descricao || descricao.length > 10000) throw new ValidacaoJuridica("Informe o tipo e a descrição da movimentação (até 10000 caracteres).");
      return executar(empresas, autor, "", async db => {
        const rows = await db.consultar<{ id: string }>("INSERT INTO juridico.eventos (caso_id, empresa, tipo, descricao, autor) SELECT id, empresa, $2, $3, $4 FROM juridico.casos WHERE id = $1 AND empresa = ANY($5::text[]) RETURNING id", [id, tipo, descricao, autor, empresas]);
        if (!rows.length) throw new CasoNaoEncontrado();
      });
    },
  };
}
