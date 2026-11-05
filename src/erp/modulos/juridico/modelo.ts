export const AREAS = ["Cível", "Criminal", "Trabalhista", "Contratos", "Consultivo", "Societário"];
export const FASES = ["Triagem", "Análise", "Negociação", "Preparação", "Ajuizado", "Instrução", "Recurso", "Cumprimento", "Concluído"];
export const INSTANCIAS = ["Não se aplica", "1ª instância", "2ª instância", "Turma recursal", "Tribunal superior", "STF"];
export const SITUACOES = ["ativo", "encerrado", "cancelado"];
export class ValidacaoJuridica extends Error {}
export class ConflitoJuridico extends Error {}
export class CasoNaoEncontrado extends Error {}
export type DadosCaso = ReturnType<typeof validarCaso>;
export type Caso = DadosCaso & { id: string; empresa: string; versao: number; criado_em: string; atualizado_em: string; encerrado_em: string | null };
export type Evento = { id: string; tipo: string; descricao: string; autor: string; criado_em: string; anterior: Record<string, unknown> | null; novo: Record<string, unknown> | null };
type Entrada = Record<string, string>;
function texto(d: Entrada, campo: string, max: number, obrigatorio = false) {
  const v = (d[campo] ?? "").trim();
  if ((obrigatorio && !v) || v.length > max) throw new ValidacaoJuridica(`Preencha ${campo.replaceAll('_', ' ')} com até ${max} caracteres.`);
  return v;
}
function opcao(d: Entrada, campo: string, lista: string[]) {
  const v = texto(d, campo, 80, true);
  if (!lista.includes(v)) throw new ValidacaoJuridica(`Opção inválida para ${campo}.`);
  return v;
}
export function validarCaso(d: Entrada) {
  const prazo = texto(d, "prazo", 10);
  if (prazo && (!/^\d{4}-\d{2}-\d{2}$/.test(prazo) || !Number.isFinite(Date.parse(prazo)) || new Date(prazo).toISOString().slice(0, 10) !== prazo)) throw new ValidacaoJuridica("Data do prazo inválida.");
  const prazo_descricao = texto(d, "prazo_descricao", 500, !!prazo);
  if (!prazo && prazo_descricao) throw new ValidacaoJuridica("Informe a data do prazo ou limpe sua descrição.");
  const cliente_tipo = opcao(d, "cliente_tipo", ["PF", "PJ"]);
  const cliente_documento = texto(d, "cliente_documento", 20, true).replace(/\D/g, "");
  if (!documentoValido(cliente_documento, cliente_tipo)) throw new ValidacaoJuridica("CPF ou CNPJ inválido.");
  const cliente_email = texto(d, "cliente_email", 254);
  if (cliente_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente_email)) throw new ValidacaoJuridica("E-mail inválido.");
  return {
    titulo: texto(d, "titulo", 200, true), cliente_nome: texto(d, "cliente_nome", 200, true), cliente_tipo, cliente_documento,
    cliente_telefone: texto(d, "cliente_telefone", 40, true), cliente_email,
    condicao: opcao(d, "condicao", ["devedor", "credor"]), area: opcao(d, "area", AREAS), fase: opcao(d, "fase", FASES),
    instancia: opcao(d, "instancia", INSTANCIAS), situacao: opcao(d, "situacao", SITUACOES),
    numero_processo: texto(d, "numero_processo", 100), vara: texto(d, "vara", 200), comarca: texto(d, "comarca", 200),
    parte_contraria: texto(d, "parte_contraria", 200), descricao: texto(d, "descricao", 10000, true),
    responsavel: texto(d, "responsavel", 200, true), prazo: prazo || null, prazo_descricao,
  };
}
function documentoValido(d: string, tipo: string) {
  if (d.length !== (tipo === "PF" ? 11 : 14) || /^(\d)\1+$/.test(d)) return false;
  const digito = (base: string, pesos: number[]) => { const r = [...base].reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const tamanho = tipo === "PF" ? 9 : 12;
  const pesos = tipo === "PF" ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
  const primeiro = digito(d.slice(0, tamanho), pesos);
  return Number(d[tamanho]) === primeiro && Number(d[tamanho + 1]) === digito(d.slice(0, tamanho + 1), tipo === "PF" ? [11,...pesos] : [6,...pesos]);
}
/** Dias civis em São Paulo, sem contagem de prazo processual ou dias úteis. */
export function alertaPrazo(prazo: string | null, hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())) {
  if (!prazo) return { dias: null, rotulo: "Sem prazo definido" };
  const dias = Math.round((Date.parse(prazo) - Date.parse(hoje)) / 86400000);
  return { dias, rotulo: dias < 0 ? `Vencido há ${-dias} dia(s)` : dias === 0 ? "Vence hoje" : dias <= 7 ? `Urgente: ${dias} dia(s)` : dias <= 15 ? `Atenção: ${dias} dia(s)` : dias <= 30 ? `Próximo: ${dias} dia(s)` : `${dias} dia(s)` };
}
