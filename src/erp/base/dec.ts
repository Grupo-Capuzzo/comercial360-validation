/* eslint-disable @typescript-eslint/no-explicit-any */
// Apoio para os portes de bank_files_*.py / reports.py: aritmética decimal exata
// (equivalente a Decimal(str(x)) do Python), str(float) do Python e csv.writer.
import { numToPlain } from "../core/py";

/** Decimal exato: valor = n / 10^s. */
export class Dec {
  constructor(public n: bigint, public s: number) {}
  /** Decimal(str(x)) — número JS (float) ou texto decimal. */
  static de(v: any): Dec {
    if (v instanceof Dec) return v;
    if (v === null || v === undefined || v === "") return new Dec(BigInt(0), 0);
    let t = typeof v === "number" ? numToPlain(v) : String(v).trim();
    const neg = t.startsWith("-");
    if (neg || t.startsWith("+")) t = t.slice(1);
    const [i, f = ""] = t.split(".");
    if (!/^\d*$/.test(i) || !/^\d*$/.test(f) || (i + f) === "") throw new Error(`Decimal inválido: ${v}`);
    const n = BigInt((i || "0") + f);
    return new Dec(neg ? -n : n, f.length);
  }
  private alinhar(o: Dec): [bigint, bigint, number] {
    const s = Math.max(this.s, o.s);
    return [this.n * BigInt(10) ** BigInt(s - this.s), o.n * BigInt(10) ** BigInt(s - o.s), s];
  }
  add(o: any) { const b = Dec.de(o); const [x, y, s] = this.alinhar(b); return new Dec(x + y, s); }
  sub(o: any) { const b = Dec.de(o); const [x, y, s] = this.alinhar(b); return new Dec(x - y, s); }
  cmp(o: any) { const b = Dec.de(o); const [x, y] = this.alinhar(b); return x < y ? -1 : x > y ? 1 : 0; }
  /** quantize(10^-nd) com ROUND_HALF_EVEN ("even", padrão do Python) ou ROUND_HALF_UP ("up"). */
  quantize(nd: number, modo: "even" | "up" = "even"): Dec {
    if (this.s <= nd) return new Dec(this.n * BigInt(10) ** BigInt(nd - this.s), nd);
    const d = BigInt(10) ** BigInt(this.s - nd);
    const neg = this.n < BigInt(0);
    const a = neg ? -this.n : this.n;
    let q = a / d;
    const r = a % d;
    const dobro = r * BigInt(2);
    if (dobro > d || (dobro === d && (modo === "up" || q % BigInt(2) === BigInt(1)))) q += BigInt(1);
    return new Dec(neg ? -q : q, nd);
  }
  /** str(Decimal) do Python (formato posicional, mantém o expoente). */
  toString() {
    const neg = this.n < BigInt(0);
    let t = (neg ? -this.n : this.n).toString();
    if (this.s > 0) { t = t.padStart(this.s + 1, "0"); t = t.slice(0, t.length - this.s) + "." + t.slice(t.length - this.s); }
    return (neg ? "-" : "") + t;
  }
  /** f"{d:.Nf}" (ROUND_HALF_EVEN). */
  fixed(nd: number) { return this.quantize(nd, "even").toString(); }
  toNumber() { return Number(this.toString()); }
  /** int(self) */
  int() { return Number(this.n / BigInt(10) ** BigInt(this.s)); }
}

/** str(float) / repr(float) do Python. */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
    // notação científica como o Python: 1e-05, 1.5e+16
    let [m, e] = x.toExponential().split("e");
    const ne = Number(e);
    e = (ne < 0 ? "-" : "+") + String(Math.abs(ne)).padStart(2, "0");
    return m + "e" + e;
  }
  const s = numToPlain(x);
  return s.includes(".") ? s : s + ".0";
}

/** csv.writer(delimiter=";") com QUOTE_MINIMAL e "\r\n". */
export function csvLinha(campos: any[], delim = ";"): string {
  return campos.map((c) => {
    const t = c === null || c === undefined ? "" : String(c);
    return /["\r\n]/.test(t) || t.includes(delim) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(delim) + "\r\n";
}

/** Texto com encoding="ascii", errors="replace" (cada caractere fora do ASCII vira "?"). */
export function asciiReplace(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) { const c = ch.codePointAt(0)!; out.push(c < 128 ? c : 63); }
  return new Uint8Array(out);
}

/** encoding="utf-8-sig" (com BOM). */
export function utf8Sig(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(b.length + 3);
  out.set([0xef, 0xbb, 0xbf]); out.set(b, 3);
  return out;
}
