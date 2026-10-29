/* eslint-disable @typescript-eslint/no-explicit-any */
// Cache curto em memória (por processo) para dados lidos em toda página: usuário logado,
// empresas liberadas, situação das empresas. Evita idas ao banco a cada clique.
const g = globalThis as any;
const M: Map<string, { ate: number; v: any }> = g.__erpMemo ?? (g.__erpMemo = new Map());

export async function memo<T>(chave: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const agora = Date.now();
  const c = M.get(chave);
  if (c && c.ate > agora) return c.v as T;
  const v = await fn();
  M.set(chave, { ate: agora + ttlMs, v });
  if (M.size > 5000) for (const [k, x] of M) if (x.ate <= agora) M.delete(k);
  return v;
}
/** Apaga as chaves que começam com o prefixo (ou tudo, sem prefixo). */
export function limparMemo(prefixo = "") {
  for (const k of [...M.keys()]) if (k.startsWith(prefixo)) M.delete(k);
}
