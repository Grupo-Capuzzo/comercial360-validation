/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/reports.py — exportações em Excel/CSV.
// O Flask gravava em exports/; aqui os arquivos ficam em erp_arquivos (core/arquivos.ts)
// com o mesmo nome lógico ("exports/<nome>_<timestamp>.xlsx").
import ExcelJS from "exceljs";

import { PyDate, pyRound } from "../core/py";
import { listarArquivos, salvarArquivo } from "../core/arquivos";
import { csvLinha, utf8Sig } from "./dec";

export const EXPORTS_DIR = "exports";
export const FMT_MOEDA = "#,##0.00";
export const FMT_DATA = "DD/MM/YYYY";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Col = [string, string, number, string | null];
export const _COLS_CONSOLIDADO: Col[] = [
  ["E-mail", "email", 28, null],
  ["Cliente", "cliente", 38, null],
  ["Data de Pagamento", "data_pagamento", 18, FMT_DATA],
  ["Rendimento", "rendimento", 15, FMT_MOEDA],
  ["Nº de cotas Ativas", "cotas", 17, "0"],
  ["Valor do Ativo", "valor_ativo", 16, FMT_MOEDA],
];
export const _COLS_VENCIMENTOS: Col[] = [
  ["e-mail", "email", 28, null],
  ["investidor", "investidor", 38, null],
  ["valor do contrato", "valor", 18, FMT_MOEDA],
  ["data de vencimento", "vencimento", 18, FMT_DATA],
];

/** Arquivo gerado (equivale ao Path devolvido pelo Python). */
export interface ArquivoGerado { name: string; path: string; dados: Uint8Array }

/** Valor de célula como o openpyxl gravaria (date → data do Excel). */
export function valorCelula(v: any): any {
  if (v instanceof PyDate) return new Date(Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second));
  // openpyxl não grava texto vazio (a célula fica vazia)
  if (v === undefined || v === "") return null;
  return v;
}

export function _escrever_aba(ws: ExcelJS.Worksheet, colunas: Col[], linhas: Record<string, any>[], totais: Record<string, any> | null = null) {
  colunas.forEach(([titulo, , largura], i) => {
    const cel = ws.getCell(1, i + 1);
    cel.value = titulo;
    cel.font = { bold: true };
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "00D9D9D9" } };
    cel.border = { bottom: { style: "thin", color: { argb: "00BFBFBF" } } };
    cel.alignment = { horizontal: "left", vertical: "middle" };
    ws.getColumn(i + 1).width = largura;
  });
  linhas.forEach((linha, r) => {
    colunas.forEach(([, chave, , fmt], c) => {
      const cel = ws.getCell(r + 2, c + 1);
      cel.value = valorCelula(linha[chave]);
      if (fmt) cel.numFmt = fmt;
    });
  });
  if (totais) {
    const r = linhas.length + 2;
    colunas.forEach(([, chave, , fmt], c) => {
      if (chave in totais) {
        const cel = ws.getCell(r, c + 1);
        cel.value = valorCelula(totais[chave]);
        cel.font = { bold: true };
        if (fmt) cel.numFmt = fmt;
      }
    });
  }
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }];
}

function soma(l: any[], k: string) { return l.reduce((a, x) => a + (x[k] || 0), 0); }

export async function exportar_apuracao_padrao_planilha(blocos: any[], nome_arquivo: string): Promise<ArquivoGerado | null> {
  const timestamp = PyDate.now().strftime("%Y%m%d_%H%M%S");
  const name = `${nome_arquivo}_${timestamp}.xlsx`;
  try {
    const wb = new ExcelJS.Workbook();
    for (const bloco of blocos) {
      const cons = bloco.consolidado || [];
      let ws = wb.addWorksheet(String(bloco.aba_consolidado).slice(0, 31));
      _escrever_aba(ws, _COLS_CONSOLIDADO, cons, {
        rendimento: pyRound(soma(cons, "rendimento"), 2),
        valor_ativo: pyRound(soma(cons, "valor_ativo"), 2),
      });
      const venc = bloco.vencimentos || [];
      ws = wb.addWorksheet(String(bloco.aba_vencimentos).slice(0, 31));
      _escrever_aba(ws, _COLS_VENCIMENTOS, venc, { valor: pyRound(soma(venc, "valor"), 2) });
    }
    const dados = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const path = `${EXPORTS_DIR}/${name}`;
    await salvarArquivo(path, dados, XLSX_MIME);
    return { name, path, dados };
  } catch (e) {
    console.error(`Erro ao exportar apuração no padrão da planilha: ${e}`);
    return null;
  }
}

/** Exporta uma lista de linhas (no lugar do DataFrame) para Excel em exports/. */
export async function exportar_dataframe_excel(linhas: Record<string, any>[], nome_arquivo: string, nome_aba = "Dados"): Promise<ArquivoGerado | null> {
  const name = `${nome_arquivo}_${PyDate.now().strftime("%Y%m%d_%H%M%S")}.xlsx`;
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(nome_aba);
    const cols = linhas.length ? Object.keys(linhas[0]) : [];
    cols.forEach((c, i) => { const cel = ws.getCell(1, i + 1); cel.value = c; cel.font = { bold: true }; cel.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }; cel.alignment = { horizontal: "center", vertical: "top" }; });
    linhas.forEach((l, r) => cols.forEach((c, i) => { ws.getCell(r + 2, i + 1).value = valorCelula(l[c]); }));
    const dados = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const path = `${EXPORTS_DIR}/${name}`;
    await salvarArquivo(path, dados, XLSX_MIME);
    return { name, path, dados };
  } catch (e) {
    console.error(`Erro ao exportar Excel: ${e}`);
    return null;
  }
}

/** Exporta uma lista de linhas para CSV (utf-8-sig, separador ";") em exports/. */
export async function exportar_dataframe_csv(linhas: Record<string, any>[], nome_arquivo: string): Promise<ArquivoGerado | null> {
  const name = `${nome_arquivo}_${PyDate.now().strftime("%Y%m%d_%H%M%S")}.csv`;
  try {
    const cols = linhas.length ? Object.keys(linhas[0]) : [];
    let txt = csvLinha(cols).replace(/\r\n$/, "\n");
    for (const l of linhas) txt += csvLinha(cols.map((c) => l[c])).replace(/\r\n$/, "\n");
    const dados = utf8Sig(txt);
    const path = `${EXPORTS_DIR}/${name}`;
    await salvarArquivo(path, dados, "text/csv");
    return { name, path, dados };
  } catch (e) {
    console.error(`Erro ao exportar CSV: ${e}`);
    return null;
  }
}

/** Lista os arquivos exportados (só os que ficam direto em exports/, como o iterdir do Python). */
export async function listar_exports(): Promise<Record<string, any>[]> {
  const arquivos = (await listarArquivos(EXPORTS_DIR + "/"))
    .filter((a) => !a.caminho.slice(EXPORTS_DIR.length + 1).includes("/"))
    .sort((a, b) => (a.caminho < b.caminho ? 1 : -1));
  const resultado: Record<string, any>[] = [];
  for (const a of arquivos) {
    const nome = a.caminho.slice(EXPORTS_DIR.length + 1);
    if (nome.startsWith(".")) continue;
    const d = PyDate.tryParse(a.criado_em);
    resultado.push({
      nome, caminho: a.caminho, tamanho_kb: pyRound(Number(a.tamanho) / 1024, 1),
      data: d ? d.strftime("%d/%m/%Y %H:%M") : "",
    });
  }
  return resultado;
}
