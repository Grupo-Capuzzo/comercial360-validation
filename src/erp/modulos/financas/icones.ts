// Ícones do módulo Finanças (Material Icons, licença Apache 2.0) — porte de financas/icones.py.
import { Markup } from "../../core/flask";
import { ICONES_FINANCAS } from "../../dados/icones";
import { ic } from "../portal";

export const _P = ICONES_FINANCAS;

/** Ícone do Finanças; se não houver, cai no ícone do portal. */
export function fic(nome: string) {
  if (Object.prototype.hasOwnProperty.call(_P, nome)) {
    return Markup(`<svg class="ms" viewBox="0 0 24 24" aria-hidden="true"><path d="${_P[nome]}"/></svg>`);
  }
  return ic(nome);
}
