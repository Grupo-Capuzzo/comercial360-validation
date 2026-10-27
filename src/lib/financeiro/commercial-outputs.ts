/**
 * Financeiro — consumidor dos outputs comerciais (contrato de consumo v1).
 *
 * Fonte do formato: tipo `Output` em src/lib/commercial/journey.ts e docs/COMMERCIAL_INPUT_OUTPUT.md
 * (endpoint GET /api/comercial/outputs/[empresa]). Este módulo NÃO define outro DTO.
 *
 * O que faz (puro, sem efeitos colaterais):
 *  - valida estritamente cada output recebido;
 *  - interpreta a resposta do endpoint sem transformar indisponibilidade em lista vazia ou saldo zero;
 *  - decide, para cada output, se é novo, já processado, versão posterior (exige regra explícita),
 *    conflito ou sem efeito financeiro — nunca gera lançamento por item nem duplica por reprocessamento.
 *
 * O que NÃO faz: não grava nada, não cria cobranças/remessas/pagamentos, não lê documentos do contrato
 * (referências não concedem acesso) e não altera posições de investimento.
 */
import type { Item, Output } from "@/lib/commercial/journey";

// ───────────────────────── Dinheiro: decimal exato em centavos ─────────────────────────

const DECIMAL = /^(0|[1-9]\d{0,11})\.\d{2}$/;

/** "100.20" → 10020n. Rejeita qualquer outro formato (sem Number/parseFloat). */
export function paraCentavos(valor: unknown): bigint {
  if (typeof valor !== "string" || !DECIMAL.test(valor)) throw new Error("valor_monetario_invalido");
  return BigInt(valor.replace(".", ""));
}

/** 10020n → "100.20". */
export function deCentavos(c: bigint): string {
  if (c < BigInt(0)) throw new Error("valor_monetario_invalido");
  const t = c.toString().padStart(3, "0");
  return `${t.slice(0, -2)}.${t.slice(-2)}`;
}

/** 10020n → "R$ 100,20" (somente exibição). */
export function formatarCentavosBRL(c: bigint): string {
  const [inteiro, dec] = deCentavos(c).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

// ───────────────────────── Validação estrita do DTO ─────────────────────────

const CAMPOS_OUTPUT = [
  "id", "version", "business", "client", "company", "opportunity", "proposal", "items", "total", "conditions",
  "contract", "formalization", "closedAt", "source", "originReferences", "triggersNewSale", "affectsInvestmentPositions",
] as const;
const CAMPOS_ITEM = ["id", "product", "description", "quantity", "unitPrice"] as const;
const CAMPOS_CONTRATO = ["id", "template", "templateVersion", "fields", "documents", "signatureEvidence", "legalApproved"] as const;

function regra(ok: unknown, codigo: string): asserts ok {
  if (!ok) throw new Error(codigo);
}
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown) => typeof v === "string" && v.length > 0;
const inteiroPositivo = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
const mapaDeTextos = (v: unknown) => objeto(v) && Object.values(v).every((x) => typeof x === "string");

function mesmasChaves(v: Record<string, unknown>, esperadas: readonly string[], codigo: string) {
  const chaves = Object.keys(v);
  regra(chaves.length === esperadas.length && esperadas.every((k) => k in v), codigo);
}

function validarItem(raw: unknown): Item {
  regra(objeto(raw), "item_invalido");
  mesmasChaves(raw, CAMPOS_ITEM, "item_campos_inesperados");
  regra(texto(raw.id) && texto(raw.product) && texto(raw.description), "item_invalido");
  regra(inteiroPositivo(raw.quantity) && (raw.quantity as number) <= 100000, "item_quantidade_invalida");
  paraCentavos(raw.unitPrice);
  return raw as unknown as Item;
}

/** Soma exata dos itens: Σ unitPrice × quantity, em centavos. */
export function somaItensCentavos(items: Item[]): bigint {
  return items.reduce((s, i) => s + paraCentavos(i.unitPrice) * BigInt(i.quantity), BigInt(0));
}

/** Valida um output conforme o contrato v1. Lança Error("<codigo>") em qualquer divergência. */
export function validarOutput(raw: unknown): Output {
  regra(objeto(raw), "output_invalido");
  mesmasChaves(raw, CAMPOS_OUTPUT, "output_campos_inesperados");
  regra(texto(raw.id) && raw.business === raw.id, "output_identidade_invalida");
  regra(inteiroPositivo(raw.version), "output_versao_invalida");
  regra(texto(raw.client) && texto(raw.company), "output_referencias_invalidas");
  regra(raw.opportunity === null || texto(raw.opportunity), "output_referencias_invalidas");
  regra(raw.proposal === null || texto(raw.proposal), "output_referencias_invalidas");
  regra(Array.isArray(raw.items) && raw.items.length > 0 && raw.items.length <= 100, "output_itens_invalidos");
  const items = raw.items.map(validarItem);
  regra(new Set(items.map((i) => i.id)).size === items.length, "output_itens_duplicados");
  regra(paraCentavos(raw.total) === somaItensCentavos(items), "output_total_divergente");
  regra(typeof raw.conditions === "string", "output_condicoes_invalidas");

  const c = raw.contract;
  regra(objeto(c), "output_contrato_invalido");
  mesmasChaves(c, CAMPOS_CONTRATO, "output_contrato_campos_inesperados");
  regra(texto(c.id) && texto(c.template) && inteiroPositivo(c.templateVersion), "output_contrato_invalido");
  regra(mapaDeTextos(c.fields) && mapaDeTextos(c.documents), "output_contrato_invalido");
  regra(c.signatureEvidence === null || texto(c.signatureEvidence), "output_contrato_invalido");
  regra(typeof c.legalApproved === "boolean", "output_contrato_invalido");

  regra(raw.formalization === "completed", "output_formalizacao_nao_concluida");
  regra(typeof raw.closedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw.closedAt) && Number.isFinite(Date.parse(raw.closedAt)), "output_data_invalida");
  regra(raw.source === "crm_new" || raw.source === "imported_history", "output_origem_invalida");
  regra(Array.isArray(raw.originReferences) && raw.originReferences.every((r) => typeof r === "string"), "output_origem_invalida");
  regra(typeof raw.triggersNewSale === "boolean", "output_classificacao_invalida");
  regra(raw.affectsInvestmentPositions === false, "output_afeta_posicoes");
  return raw as unknown as Output;
}

// ───────────────────────── Resposta do endpoint ─────────────────────────

export type ResultadoConsulta =
  | { estado: "ok"; outputs: Output[]; rejeitados: { indice: number; motivo: string }[] }
  | { estado: "sem_sessao" | "sem_permissao" | "indisponivel" | "conflito" | "requisitos_nao_atendidos" | "resposta_invalida"; status: number; code: string | null };

const ESTADO_POR_CODE: Record<string, Exclude<ResultadoConsulta["estado"], "ok">> = {
  session_required: "sem_sessao",
  access_denied: "sem_permissao",
  version_or_submission_conflict: "conflito",
  commercial_requirements_not_met: "requisitos_nao_atendidos",
  commercial_structure_unavailable: "indisponivel",
  query_failed: "indisponivel",
};

/**
 * Interpreta status + corpo do GET /api/comercial/outputs/[empresa].
 * Somente HTTP 200 com array é "ok"; qualquer outra coisa é um estado de falha explícito
 * (a tela deve mostrar "indisponível", nunca R$ 0,00 nem "sem pendências").
 */
export function interpretarResposta(status: number, corpo: unknown): ResultadoConsulta {
  if (status === 200) {
    if (!Array.isArray(corpo)) return { estado: "resposta_invalida", status, code: null };
    const outputs: Output[] = [];
    const rejeitados: { indice: number; motivo: string }[] = [];
    corpo.forEach((raw, indice) => {
      try {
        outputs.push(validarOutput(raw));
      } catch (e) {
        rejeitados.push({ indice, motivo: (e as Error).message });
      }
    });
    return { estado: "ok", outputs, rejeitados };
  }
  const code = objeto(corpo) && typeof corpo.code === "string" ? corpo.code : null;
  const porStatus = status === 401 ? "sem_sessao" : status === 403 ? "sem_permissao" : "indisponivel";
  return { estado: (code && ESTADO_POR_CODE[code]) || porStatus, status, code };
}

/**
 * Busca os outputs de uma empresa pela rota do Comercial, com a sessão do próprio usuário.
 * `fetcher` é injetável para teste; no navegador usa cookies da mesma origem (sem service_role).
 */
export async function consultarOutputs(empresa: string, fetcher: typeof fetch = fetch, base = ""): Promise<ResultadoConsulta> {
  let resposta: Response;
  try {
    resposta = await fetcher(`${base}/api/comercial/outputs/${encodeURIComponent(empresa)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return { estado: "indisponivel", status: 0, code: null };
  }
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: resposta.ok ? "resposta_invalida" : "indisponivel", status: resposta.status, code: null };
  }
  return interpretarResposta(resposta.status, corpo);
}

// ───────────────────────── Idempotência e decisão ─────────────────────────

/** Representação canônica (chaves ordenadas) para detectar conteúdo diferente na mesma versão. */
export function impressaoDigital(o: Output): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : objeto(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  return JSON.stringify(canon(o));
}

/** Registro do que o Financeiro já recebeu. A persistência depende de estrutura SQL a combinar. */
export type RecebimentoRegistrado = { id: string; version: number; impressao: string };
export interface RegistroRecebimentos {
  doNegocio(id: string): RecebimentoRegistrado[];
}

export type Decisao =
  | { tipo: "novo"; id: string; version: number; totalCentavos: bigint; itens: number; impressao: string }
  | { tipo: "ja_recebido"; id: string; version: number }
  | { tipo: "versao_posterior_requer_regra"; id: string; version: number; versaoRecebida: number }
  | { tipo: "versao_anterior_ignorada"; id: string; version: number; versaoRecebida: number }
  | { tipo: "conflito_mesma_versao"; id: string; version: number }
  | { tipo: "sem_efeito_financeiro"; id: string; version: number; motivo: "historico_importado" | "nao_dispara_venda" }
  | { tipo: "bloqueado"; id: string; version: number; motivo: "outra_empresa" | "sem_aprovacao_juridica" };

/**
 * Decide o que fazer com cada output, SEM executar nada.
 * Regras:
 *  - chave de idempotência = id do negócio + versão; vários itens = um único negócio/contrato;
 *  - mesma chave já recebida → ignorada; mesma chave com conteúdo diferente → conflito (bloqueia);
 *  - versão maior que a já recebida → exige regra explícita de revisão (não gera lançamento novo);
 *  - histórico importado ou triggersNewSale=false → sem efeito financeiro automático;
 *  - output de outra empresa ou sem aprovação jurídica → bloqueado.
 */
export function planejarRecebimento(outputs: Output[], empresa: string, registro: RegistroRecebimentos): Decisao[] {
  const vistosNoLote = new Map<string, string>();
  const novosNoLote = new Map<string, RecebimentoRegistrado[]>();
  const decisoes: Decisao[] = [];
  // Versões menores primeiro, para que várias versões do mesmo negócio no lote não virem vários "novos".
  const ordenados = [...outputs].sort((a, b) => a.version - b.version);
  for (const o of ordenados) {
    const chave = `${o.id}@${o.version}`;
    const impressao = impressaoDigital(o);
    const base = { id: o.id, version: o.version };

    const repetido = vistosNoLote.get(chave);
    if (repetido !== undefined) {
      if (repetido !== impressao) decisoes.push({ tipo: "conflito_mesma_versao", ...base });
      continue;
    }
    vistosNoLote.set(chave, impressao);

    if (o.company !== empresa) { decisoes.push({ tipo: "bloqueado", ...base, motivo: "outra_empresa" }); continue; }
    if (!o.contract.legalApproved) { decisoes.push({ tipo: "bloqueado", ...base, motivo: "sem_aprovacao_juridica" }); continue; }
    if (o.source === "imported_history") { decisoes.push({ tipo: "sem_efeito_financeiro", ...base, motivo: "historico_importado" }); continue; }
    if (!o.triggersNewSale) { decisoes.push({ tipo: "sem_efeito_financeiro", ...base, motivo: "nao_dispara_venda" }); continue; }

    const anteriores = [...registro.doNegocio(o.id), ...(novosNoLote.get(o.id) ?? [])];
    const mesma = anteriores.find((r) => r.version === o.version);
    if (mesma) {
      decisoes.push(mesma.impressao === impressao ? { tipo: "ja_recebido", ...base } : { tipo: "conflito_mesma_versao", ...base });
      continue;
    }
    if (anteriores.length) {
      const maior = Math.max(...anteriores.map((r) => r.version));
      decisoes.push(
        o.version > maior
          ? { tipo: "versao_posterior_requer_regra", ...base, versaoRecebida: maior }
          : { tipo: "versao_anterior_ignorada", ...base, versaoRecebida: maior },
      );
      continue;
    }
    novosNoLote.set(o.id, [{ id: o.id, version: o.version, impressao }]);
    decisoes.push({ tipo: "novo", ...base, totalCentavos: paraCentavos(o.total), itens: o.items.length, impressao });
  }
  return decisoes;
}
