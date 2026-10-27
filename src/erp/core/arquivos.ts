/* eslint-disable @typescript-eslint/no-explicit-any */
// Arquivos que o app Flask gravava em pastas (exports/, anexos, remessas) agora ficam
// na tabela erp.erp_arquivos. O "caminho" é só um nome lógico, ex.: "exports/remessas/x.txt".
import { q1, run, q } from "./db";

export async function salvarArquivo(caminho: string, dados: Uint8Array | string, tipo = "application/octet-stream") {
  const buf = Buffer.from(typeof dados === "string" ? new TextEncoder().encode(dados) : dados);
  await run(
    "INSERT INTO erp_arquivos (caminho, conteudo, tipo, tamanho) VALUES (?, ?, ?, ?) ON CONFLICT (caminho) DO UPDATE SET conteudo = excluded.conteudo, tipo = excluded.tipo, tamanho = excluded.tamanho",
    [caminho, buf as any, tipo, buf.length],
  );
  return caminho;
}
export async function lerArquivo(caminho: string): Promise<Uint8Array | null> {
  const r = await q1("SELECT conteudo FROM erp_arquivos WHERE caminho = ?", [caminho]);
  return r ? new Uint8Array(r.conteudo as Buffer) : null;
}
export async function existeArquivo(caminho: string) { return !!(await q1("SELECT 1 AS x FROM erp_arquivos WHERE caminho = ?", [caminho])); }
export async function apagarArquivo(caminho: string) { await run("DELETE FROM erp_arquivos WHERE caminho = ?", [caminho]); }
export async function listarArquivos(prefixo: string) {
  return q("SELECT caminho, tipo, tamanho, criado_em FROM erp_arquivos WHERE caminho LIKE ? ORDER BY caminho", [prefixo.replace(/[%_]/g, "\\$&") + "%"]);
}

export async function lerConfig(chave: string, def = ""): Promise<string> {
  const r = await q1("SELECT valor FROM erp_config WHERE chave = ?", [chave]);
  return r ? r.valor : def;
}
export async function gravarConfig(chave: string, valor: string) {
  await run("INSERT INTO erp_config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')", [chave, valor]);
}
