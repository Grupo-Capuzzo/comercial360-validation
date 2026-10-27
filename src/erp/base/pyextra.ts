/* eslint-disable @typescript-eslint/no-explicit-any */
// Utilitários extras de "Python em TypeScript" usados pela camada de dados/cálculo
// (database.ts, calculations.ts, private_loans_calculations.ts,
// validacao_sistema_calculations.ts) e por quem chama essas funções:
//   - ValueError / InvalidOperation (para `except ValueError` → `e instanceof ValueError`)
//   - Decimal (decimal.Decimal do Python: precisão de contexto, ROUND_HALF_UP/HALF_EVEN,
//     quantize, potência inteira e fracionária, str()/format iguais ao Python)
//   - pyFloatRepr / pyRepr / pyJsonDumps (texto idêntico a repr()/str(dict)/json.dumps)
//   - pyInt / pyFloat (int()/float() com os mesmos erros)
//   - pyCmp / sortBy (sorted(key=...) com tuplas, estável, reverse igual ao Python)
import { PyDate } from "../core/py";

// ── Exceções ─────────────────────────────────────────────────────
export class ValueError extends Error {
  constructor(msg = "") { super(msg); this.name = "ValueError"; }
  toString() { return this.message; }
}
/** decimal.InvalidOperation (no Python NÃO é subclasse de ValueError). */
export class InvalidOperation extends Error {
  constructor(msg = "[<class 'decimal.ConversionSyntax'>]") { super(msg); this.name = "InvalidOperation"; }
}
/** str(exc) do Python. */
export function strExc(e: any): string { return e && typeof e.message === "string" ? e.message : String(e); }

// ── Decimal ──────────────────────────────────────────────────────
export type Rounding = "ROUND_HALF_UP" | "ROUND_HALF_EVEN" | "ROUND_DOWN";
export const ROUND_HALF_UP: Rounding = "ROUND_HALF_UP";
export const ROUND_HALF_EVEN: Rounding = "ROUND_HALF_EVEN";

const B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B5 = BigInt(5), B10 = BigInt(10);
const pot10Cache: bigint[] = [B1];
function p10(n: number): bigint {
  if (n < 0) throw new Error("p10 negativo");
  while (pot10Cache.length <= n && pot10Cache.length < 400) pot10Cache.push(pot10Cache[pot10Cache.length - 1] * B10);
  if (n < pot10Cache.length) return pot10Cache[n];
  return B10 ** BigInt(n);
}
const absB = (x: bigint) => (x < B0 ? -x : x);
const ndig = (x: bigint) => (x === B0 ? 1 : absB(x).toString().length);

/** Divide c por 10^k com o modo de arredondamento (c com sinal). */
function divArred(c: bigint, k: number, modo: Rounding): bigint {
  if (k <= 0) return c * p10(-k);
  const neg = c < B0;
  const a = neg ? -c : c;
  const d = p10(k);
  let q = a / d;
  const r = a % d;
  if (r !== B0 && modo !== "ROUND_DOWN") {
    const dobro = r * B2;
    if (dobro > d || (dobro === d && (modo === "ROUND_HALF_UP" || (q % B2) === B1))) q += B1;
  }
  return neg ? -q : q;
}

/** Equivalente ao decimal.Decimal (finito) com contexto de precisão global. */
export class Decimal {
  /** Precisão do contexto atual (getcontext().prec). */
  static prec = 28;
  readonly c: bigint; // coeficiente com sinal
  readonly e: number; // expoente

  constructor(v: Decimal | string | number | bigint = "0", e?: number) {
    if (typeof v === "bigint") { this.c = v; this.e = e ?? 0; return; }
    if (v instanceof Decimal) { this.c = v.c; this.e = v.e; return; }
    if (typeof v === "number") {
      if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) { this.c = BigInt(v); this.e = 0; return; }
      v = pyFloatRepr(v);
    }
    const s = String(v).trim().replace(/_/g, "");
    const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new InvalidOperation();
    const frac = m[3] ?? "";
    let c = BigInt((m[2] || "") + frac || "0");
    if (m[1] === "-") c = -c;
    this.c = c;
    this.e = (m[4] ? Number(m[4]) : 0) - frac.length;
  }

  /** with localcontext() as ctx: ctx.prec = p — executa fn (síncrona) com outra precisão. */
  static comPrecisao<T>(p: number, fn: () => T): T {
    const ant = Decimal.prec;
    Decimal.prec = p;
    try { return fn(); } finally { Decimal.prec = ant; }
  }

  /** _fix: arredonda para a precisão do contexto (ROUND_HALF_EVEN). */
  private static fix(c: bigint, e: number, prec = Decimal.prec): Decimal {
    const n = ndig(c);
    if (n <= prec) return new Decimal(c, e);
    const k = n - prec;
    let q = divArred(c, k, "ROUND_HALF_EVEN");
    let ee = e + k;
    if (ndig(q) > prec) { q = q / B10; ee += 1; }
    return new Decimal(q, ee);
  }

  isZero() { return this.c === B0; }
  isNeg() { return this.c < B0; }
  __bool__() { return this.c !== B0; }
  neg() { return new Decimal(-this.c, this.e); }
  abs() { return new Decimal(absB(this.c), this.e); }

  add(o: DecLike): Decimal {
    const b = D(o);
    const e = Math.min(this.e, b.e);
    const c = this.c * p10(this.e - e) + b.c * p10(b.e - e);
    return Decimal.fix(c, e);
  }
  sub(o: DecLike): Decimal { return this.add(D(o).neg()); }
  mul(o: DecLike): Decimal { const b = D(o); return Decimal.fix(this.c * b.c, this.e + b.e); }

  /** Divisão igual à do _pydecimal (expoente ideal quando exata). */
  div(o: DecLike): Decimal {
    const b = D(o);
    if (b.c === B0) throw new InvalidOperation("[<class 'decimal.DivisionByZero'>]");
    const prec = Decimal.prec;
    const neg = (this.c < B0) !== (b.c < B0);
    if (this.c === B0) return new Decimal(B0, this.e - b.e);
    const op1 = absB(this.c), op2 = absB(b.c);
    const shift = ndig(op2) - ndig(op1) + prec + 1;
    let exp = this.e - b.e - shift;
    let coeff: bigint, rem: bigint;
    if (shift >= 0) { const n = op1 * p10(shift); coeff = n / op2; rem = n % op2; }
    else { const d = op2 * p10(-shift); coeff = op1 / d; rem = op1 % d; }
    if (rem !== B0) { if (coeff % B5 === B0) coeff += B1; }
    else {
      const ideal = this.e - b.e;
      while (exp < ideal && coeff % B10 === B0) { coeff /= B10; exp += 1; }
    }
    return Decimal.fix(neg ? -coeff : coeff, exp);
  }

  /** self ** other (expoente inteiro ou fracionário), resultado na precisão do contexto. */
  pow(o: DecLike): Decimal {
    const y = D(o);
    const prec = Decimal.prec;
    const yInt = y.e >= 0 || y.c % p10(-y.e) === B0;
    if (yInt) {
      const n = y.e >= 0 ? y.c * p10(y.e) : y.c / p10(-y.e);
      if (n === B0) return new Decimal(B1, 0);
      const trab = prec + 25;
      let base: Decimal = new Decimal(this.c, this.e);
      let k = absB(n);
      let res: Decimal = new Decimal(B1, 0);
      const ant = Decimal.prec;
      Decimal.prec = trab;
      try {
        while (k > B0) {
          if (k % B2 === B1) res = res.mul(base);
          k /= B2;
          if (k > B0) base = base.mul(base);
        }
        if (n < B0) res = new Decimal(B1, 0).div(res);
      } finally { Decimal.prec = ant; }
      return Decimal.fix(res.c, res.e, prec);
    }
    if (this.c <= B0) throw new InvalidOperation("[<class 'decimal.InvalidOperation'>]");
    // exp(y * ln(x)) em ponto fixo com folga de dígitos
    const W = prec + 30;
    const S = p10(W);
    const X = toFixo(this, W);
    const Y = toFixo(y, W);
    const L = lnFixo(X, S);
    const R = expFixo((Y * L) / S, S);
    return Decimal.fix(R, -W, prec);
  }

  cmp(o: DecLike): number {
    const b = D(o);
    const e = Math.min(this.e, b.e);
    const x = this.c * p10(this.e - e), z = b.c * p10(b.e - e);
    return x < z ? -1 : x > z ? 1 : 0;
  }
  lt(o: DecLike) { return this.cmp(o) < 0; }
  le(o: DecLike) { return this.cmp(o) <= 0; }
  gt(o: DecLike) { return this.cmp(o) > 0; }
  ge(o: DecLike) { return this.cmp(o) >= 0; }
  eq(o: DecLike) { return this.cmp(o) === 0; }
  ne(o: DecLike) { return this.cmp(o) !== 0; }

  /** quantize(Decimal("0.01"), rounding). */
  quantize(exp: DecLike, rounding: Rounding = "ROUND_HALF_EVEN"): Decimal {
    const te = D(exp).e;
    if (te >= this.e) return new Decimal(divArred(this.c, te - this.e, rounding), te);
    return new Decimal(this.c * p10(this.e - te), te);
  }

  /** normalize(): arredonda ao contexto e remove zeros à direita. */
  normalize(): Decimal {
    const f = Decimal.fix(this.c, this.e);
    if (f.c === B0) return new Decimal(B0, 0);
    let c = f.c, e = f.e;
    while (c % B10 === B0) { c /= B10; e += 1; }
    return new Decimal(c, e);
  }

  /** float(d) */
  toNumber(): number { return Number(this.toString()); }
  valueOf(): number { return this.toNumber(); }
  toJSON(): string { return this.toString(); }

  /** str(d) do Python. */
  toString(): string {
    const neg = this.c < B0;
    const dig = absB(this.c).toString();
    const left = this.e + dig.length;
    let dot: number;
    if (this.e <= 0 && left > -6) dot = left;
    else dot = 1;
    let ip: string, fp: string;
    if (dot <= 0) { ip = "0"; fp = "." + "0".repeat(-dot) + dig; }
    else if (dot >= dig.length) { ip = dig + "0".repeat(dot - dig.length); fp = ""; }
    else { ip = dig.slice(0, dot); fp = "." + dig.slice(dot); }
    let ex = "";
    if (left !== dot) { const v = left - dot; ex = "E" + (v >= 0 ? "+" : "-") + Math.abs(v); }
    return (neg ? "-" : "") + ip + fp + ex;
  }

  /** Notação fixa com os dígitos exatos (format(d, "f")). */
  toPlain(): string {
    const neg = this.c < B0;
    let dig = absB(this.c).toString();
    let s: string;
    if (this.e >= 0) s = dig + "0".repeat(this.e);
    else {
      const k = -this.e;
      if (dig.length <= k) dig = "0".repeat(k - dig.length + 1) + dig;
      s = dig.slice(0, dig.length - k) + "." + dig.slice(dig.length - k);
    }
    return (neg ? "-" : "") + s;
  }

  /** format(d, spec) para specs do tipo "f", ".2f", ",.2f" (arredondamento HALF_EVEN do contexto). */
  format(spec: string): string {
    const m = /^(,)?(?:\.(\d+))?f$/.exec(spec);
    if (!m) throw new Error("format Decimal não suportado: " + spec);
    let x: Decimal = this;
    if (m[2] !== undefined) x = this.quantize(new Decimal(B1, -Number(m[2])), "ROUND_HALF_EVEN");
    let s = x.toPlain();
    if (m[1]) {
      const neg = s.startsWith("-");
      if (neg) s = s.slice(1);
      const [i, f] = s.split(".");
      s = (neg ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? "." + f : "");
    }
    return s;
  }
}
export type DecLike = Decimal | string | number | bigint;
/** Decimal(x) — números JS viram Decimal(str(float)) como no Python (`Decimal(str(valor))`). */
export function D(x: DecLike): Decimal { return x instanceof Decimal ? x : new Decimal(x); }

function toFixo(x: Decimal, W: number): bigint {
  const k = x.e + W;
  return k >= 0 ? x.c * p10(k) : x.c / p10(-k);
}
function lnFixo(X: bigint, S: bigint): bigint {
  let k = 0;
  while (X > S * B2) { X = X / B2; k++; }
  while (X * B2 < S) { X = X * B2; k--; }
  const serie = (z: bigint) => {
    let soma = z, termo = z;
    const z2 = (z * z) / S;
    for (let i = 3; ; i += 2) {
      termo = (termo * z2) / S;
      const t = termo / BigInt(i);
      if (t === B0) break;
      soma += t;
    }
    return soma * B2;
  };
  const z = ((X - S) * S) / (X + S);
  let r = serie(z);
  if (k !== 0) r += BigInt(k) * serie(S / BigInt(3));
  return r;
}
function expFixo(Y: bigint, S: bigint): bigint {
  let r = 0;
  const lim = S / BigInt(1000);
  while (absB(Y) > lim) { Y = Y / B2; r++; }
  let soma = S, termo = S;
  for (let i = 1; ; i++) {
    termo = (termo * Y) / (S * BigInt(i));
    if (termo === B0) break;
    soma += termo;
  }
  for (let i = 0; i < r; i++) soma = (soma * soma) / S;
  return soma;
}

/** sum(iteravel, Decimal("0")) */
export function somaDec(lista: Iterable<DecLike>, inicio: DecLike = "0"): Decimal {
  let s = D(inicio);
  for (const x of lista) s = s.add(x);
  return s;
}

// ── repr()/str() de float e de estruturas ───────────────────────
/** repr(float) do Python (10000.0, 0.017, 1e-05, 1e+16). */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, expS] = x.toExponential().split("e");
  const exp = Number(expS);
  const neg = mant.startsWith("-");
  const dig = mant.replace("-", "").replace(".", "");
  let s: string;
  if (exp < -4 || exp >= 16) {
    s = dig[0] + (dig.length > 1 ? "." + dig.slice(1) : "") + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  } else if (exp < 0) {
    s = "0." + "0".repeat(-exp - 1) + dig;
  } else if (dig.length <= exp + 1) {
    s = dig + "0".repeat(exp + 1 - dig.length) + ".0";
  } else {
    s = dig.slice(0, exp + 1) + "." + dig.slice(exp + 1);
  }
  return (neg ? "-" : "") + s;
}

/** Colunas REAL do banco: números inteiros nessas chaves são float no Python (10000.0). */
export const CHAVES_FLOAT = new Set([
  "share_value", "default_monthly_rate", "monthly_rate", "agro_special_rate", "applied_rate", "income_value",
  "total_income", "total_amount", "amount", "original_amount", "contracted_amount", "interest_rate_monthly",
  "interest_rate_daily", "installment_amount", "principal_amount", "interest_amount", "paid_amount",
  "extension_amount", "principal_kept_amount", "amount_before", "amount_after", "base_amount", "daily_rate",
  "calculated_amount", "valor_total", "total_value",
]);

function numRepr(n: number, chave?: string): string {
  if (Number.isInteger(n) && !(chave && CHAVES_FLOAT.has(chave))) return String(n);
  return pyFloatRepr(n);
}

function strRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let r = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") r += "\\\\";
    else if (ch === q) r += "\\" + q;
    else if (ch === "\n") r += "\\n";
    else if (ch === "\r") r += "\\r";
    else if (ch === "\t") r += "\\t";
    else if (cp < 0x20 || cp === 0x7f) r += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp >= 0x80 && cp < 0xa0) r += "\\x" + cp.toString(16).padStart(2, "0");
    else r += ch;
  }
  return q + r + q;
}

/** repr() do Python (str(dict) usa repr dos itens). */
export function pyRepr(v: any, chave?: string): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return numRepr(v, chave);
  if (typeof v === "string") return strRepr(v);
  if (v instanceof Decimal) return `Decimal('${v.toString()}')`;
  if (v instanceof PyDate) {
    return v.isDatetime
      ? `datetime.datetime(${v.year}, ${v.month}, ${v.day}, ${v.hour}, ${v.minute}${v.second ? ", " + v.second : ""})`
      : `datetime.date(${v.year}, ${v.month}, ${v.day})`;
  }
  if (Array.isArray(v)) return "[" + v.map((x) => pyRepr(x, chave)).join(", ") + "]";
  if (v instanceof Map) return "{" + [...v.entries()].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x, String(k))}`).join(", ") + "}";
  if (v instanceof Set) return v.size ? "{" + [...v].map((x) => pyRepr(x)).join(", ") + "}" : "set()";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${strRepr(k)}: ${pyRepr(x, k)}`).join(", ") + "}";
  return String(v);
}
/** str(x) do Python (strings sem aspas; o resto como repr). */
export function pyStrX(v: any): string { return typeof v === "string" ? v : v instanceof Decimal ? v.toString() : v instanceof PyDate ? v.toString() : pyRepr(v); }

/** json.dumps(v, ensure_ascii=False, default=str) com separadores do Python. */
export function pyJsonDumps(v: any, chave?: string): string {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
    return numRepr(v, chave);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof Decimal || v instanceof PyDate) return JSON.stringify(v.toString());
  if (Array.isArray(v)) return "[" + v.map((x) => pyJsonDumps(x, chave)).join(", ") + "]";
  if (v instanceof Map) return "{" + [...v.entries()].map(([k, x]) => `${JSON.stringify(String(k))}: ${pyJsonDumps(x, String(k))}`).join(", ") + "}";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJsonDumps(x, k)}`).join(", ") + "}";
  return JSON.stringify(String(v));
}

// ── int() / float() ─────────────────────────────────────────────
/** int(x) do Python: lança ValueError/TypeError (como ValueError aqui) igual. */
export function pyInt(v: any): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ValueError("cannot convert float NaN to integer");
    return Math.trunc(v);
  }
  if (v instanceof Decimal) return Math.trunc(v.toNumber());
  if (typeof v === "string") {
    const s = v.trim();
    if (/^[+-]?\d+(_\d+)*$/.test(s)) return Number(s.replace(/_/g, ""));
    throw new ValueError(`invalid literal for int() with base 10: ${strRepr(v)}`);
  }
  throw new TypeError(`int() argument must be a string, a bytes-like object or a real number, not '${v === null || v === undefined ? "NoneType" : typeof v}'`);
}
/** float(x) do Python. */
export function pyFloat(v: any): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (v instanceof Decimal) return v.toNumber();
  if (typeof v === "string") {
    const s = v.trim().replace(/(\d)_(?=\d)/g, "$1");
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?nan$/i.test(s)) return NaN;
    throw new ValueError(`could not convert string to float: ${strRepr(v)}`);
  }
  throw new TypeError(`float() argument must be a string or a real number, not '${v === null || v === undefined ? "NoneType" : typeof v}'`);
}
/** É TypeError ou ValueError (o `except (TypeError, ValueError)` do Python)? */
export function ehTypeOuValue(e: any) { return e instanceof ValueError || e instanceof TypeError; }

// ── Comparação / ordenação estilo Python ────────────────────────
export function pyCmp(a: any, b: any): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const c = pyCmp(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Decimal) return a.cmp(b instanceof Decimal ? b : D(b));
  if (b instanceof Decimal) return -b.cmp(D(a));
  if (a instanceof PyDate && b instanceof PyDate) return Math.sign(a.compare(b));
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  const x = Number(a), y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
/** sorted(lista, key=fn, reverse=rev) — estável, como no Python. */
export function sortBy<T>(lista: T[], key: (x: T) => any, reverse = false): T[] {
  const k = lista.map((x, i) => ({ x, k: key(x), i }));
  k.sort((p, q) => (reverse ? -pyCmp(p.k, q.k) : pyCmp(p.k, q.k)) || p.i - q.i);
  return k.map((p) => p.x);
}
/** max()/min() estilo Python (primeiro maior/menor). */
export function pyMax<T>(lista: T[]): T {
  if (!lista.length) throw new ValueError("max() arg is an empty sequence");
  return lista.reduce((m, x) => (pyCmp(x, m) > 0 ? x : m));
}
export function pyMin<T>(lista: T[]): T {
  if (!lista.length) throw new ValueError("min() arg is an empty sequence");
  return lista.reduce((m, x) => (pyCmp(x, m) < 0 ? x : m));
}

/** dict.get(k, padrao): devolve o valor mesmo se for null; padrão só se a chave não existe. */
export function dget(o: any, k: string, padrao: any = null): any {
  if (o instanceof Map) return o.has(k) ? o.get(k) : padrao;
  return o != null && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined ? o[k] : padrao;
}
/** "x or y" do Python. */
export function ou<T, U>(a: T, b: U): T | U {
  if (a instanceof Decimal) return a.__bool__() ? a : b;
  if (a === null || a === undefined || a === false || a === 0 || (a as any) === "" || (Array.isArray(a) && a.length === 0)) return b;
  return a;
}
/** str.isdigit() para cada caractere (somente dígitos ASCII). */
export function soDigitos(s: any): string { return String(s ?? "").replace(/\D/g, ""); }
