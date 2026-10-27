/* eslint-disable @typescript-eslint/no-explicit-any */
// Utilitários que imitam o comportamento do Python usado no app Flask original.

export class SafeHtml {
  constructor(public readonly html: string) {}
  toString() { return this.html; }
}

/** Verdade no estilo Python: lista/dict/string vazios e 0 são falsos. */
export function pyb(v: any): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (v instanceof String) return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (v instanceof PyDate) return true;
  if (v instanceof Date) return true;
  if (typeof v === "object") {
    if (typeof (v as any).__bool__ === "function") return (v as any).__bool__();
    if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) return Object.keys(v).length > 0;
    return true;
  }
  return Boolean(v);
}

// ── float do Python nos templates ────────────────────────────────
/** Número "float" do Python (resultado de `/`, `|round`, `|float` nos templates): imprime "10.0" como o Jinja. */
export class PyFloat {
  constructor(public readonly v: number) {}
  valueOf() { return this.v; }
  toString() { return reprFloat(this.v); }
  toJSON() { return this.v; }
  __bool__() { return this.v !== 0 && !Number.isNaN(this.v); }
}
/** repr() de float do Python (10 → "10.0"; inf/nan). */
export function reprFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return (Object.is(x, -0) ? "-0" : String(x)) + ".0";
  const s = String(x);
  // JS usa "1e+21"/"1e-7"; o Python usa "1e+21"/"1e-07"
  return s.replace(/e([+-])(\d)$/, "e$10$2");
}
/** Tira o PyFloat (valor numérico puro). */
export function semFloat(v: any): any { return v instanceof PyFloat ? v.v : v; }

// ── Datas ────────────────────────────────────────────────────────
const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, "0");
const DIAS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Data/hora sem fuso (equivalente a date/datetime "ingênuos" do Python). */
export class PyDate {
  constructor(
    public year: number, public month: number, public day: number,
    public hour = 0, public minute = 0, public second = 0, public isDatetime = false,
  ) {}
  static fromDate(d: Date, isDatetime = false) {
    return new PyDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), isDatetime);
  }
  /** Agora no horário de Brasília. */
  static now(): PyDate {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
    return new PyDate(+p.year, +p.month, +p.day, +p.hour, +p.minute, +p.second, true);
  }
  static today(): PyDate { const n = PyDate.now(); return new PyDate(n.year, n.month, n.day); }
  /** Aceita 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DDTHH:MM:SS'. Lança erro se inválida (como fromisoformat). */
  static fromisoformat(s: string): PyDate {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(String(s ?? "").trim());
    if (!m) throw new Error(`Invalid isoformat string: '${s}'`);
    const d = new PyDate(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[4] !== undefined);
    if (!d.valid()) throw new Error(`Invalid isoformat string: '${s}'`);
    return d;
  }
  static tryParse(s: any): PyDate | null { try { return PyDate.fromisoformat(String(s)); } catch { return null; } }
  static strptime(s: string, fmt: string): PyDate {
    const map: Record<string, string> = { "%d": "(\\d{1,2})", "%m": "(\\d{1,2})", "%Y": "(\\d{4})", "%y": "(\\d{2})", "%H": "(\\d{1,2})", "%M": "(\\d{1,2})", "%S": "(\\d{1,2})" };
    const order: string[] = [];
    const re = fmt.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c).replace(/%[dmYyHMS]/g, (t) => { order.push(t); return map[t]; });
    const m = new RegExp("^" + re + "$").exec(String(s).trim());
    if (!m) throw new Error(`time data '${s}' does not match format '${fmt}'`);
    const v: any = { "%d": 1, "%m": 1, "%Y": 1900, "%H": 0, "%M": 0, "%S": 0 };
    order.forEach((t, i) => { v[t] = +m[i + 1]; if (t === "%y") v["%Y"] = 2000 + +m[i + 1]; });
    const d = new PyDate(v["%Y"], v["%m"], v["%d"], v["%H"], v["%M"], v["%S"], /%[HMS]/.test(fmt));
    if (!d.valid()) throw new Error(`time data '${s}' does not match format '${fmt}'`);
    return d;
  }
  private ms() { return Date.UTC(this.year, this.month - 1, this.day, this.hour, this.minute, this.second); }
  valid() {
    const d = new Date(this.ms());
    return d.getUTCFullYear() === this.year && d.getUTCMonth() + 1 === this.month && d.getUTCDate() === this.day;
  }
  date() { return new PyDate(this.year, this.month, this.day); }
  /** Soma dias (timedelta(days=n)); n pode ser fracionário só para datetime. */
  addDays(n: number) { return this.addSeconds(n * 86400); }
  addSeconds(n: number) {
    const d = new Date(this.ms() + Math.round(n * 1000));
    return PyDate.fromDate(d, this.isDatetime);
  }
  /** (a - b) em dias inteiros (timedelta.days). */
  diffDays(o: PyDate) { return Math.floor((this.ms() - o.ms()) / 86400000); }
  diffSeconds(o: PyDate) { return (this.ms() - o.ms()) / 1000; }
  replace(p: { year?: number; month?: number; day?: number; hour?: number; minute?: number; second?: number }) {
    const d = new PyDate(p.year ?? this.year, p.month ?? this.month, p.day ?? this.day, p.hour ?? this.hour, p.minute ?? this.minute, p.second ?? this.second, this.isDatetime);
    if (!d.valid()) throw new Error("day is out of range for month");
    return d;
  }
  weekday() { return (new Date(this.ms()).getUTCDay() + 6) % 7; }
  isoweekday() { return this.weekday() + 1; }
  toordinal() { return Math.floor(this.ms() / 86400000) + 719163; }
  isoformat(sep = "T", timespec?: string) {
    const d = `${pad(this.year, 4)}-${pad(this.month)}-${pad(this.day)}`;
    if (!this.isDatetime) return d;
    if (timespec === "minutes") return `${d}${sep}${pad(this.hour)}:${pad(this.minute)}`;
    return `${d}${sep}${pad(this.hour)}:${pad(this.minute)}:${pad(this.second)}`;
  }
  strftime(fmt: string) {
    return fmt.replace(/%([dmYyHMSjAaBbpI%])/g, (_, c) => {
      switch (c) {
        case "d": return pad(this.day);
        case "m": return pad(this.month);
        case "Y": return pad(this.year, 4);
        case "y": return pad(this.year % 100);
        case "H": return pad(this.hour);
        case "I": return pad(((this.hour + 11) % 12) + 1);
        case "p": return this.hour < 12 ? "AM" : "PM";
        case "M": return pad(this.minute);
        case "S": return pad(this.second);
        case "A": return DIAS_EN[this.weekday()];
        case "a": return DIAS_EN[this.weekday()].slice(0, 3);
        case "B": return MESES_EN[this.month - 1];
        case "b": return MESES_EN[this.month - 1].slice(0, 3);
        case "j": return pad(this.diffDays(new PyDate(this.year, 1, 1)) + 1, 3);
        case "%": return "%";
      }
      return c;
    });
  }
  compare(o: PyDate) { return this.ms() - o.ms(); }
  valueOf() { return this.ms(); }
  toString() { return this.isoformat(" "); }
  toJSON() { return this.isoformat(); }
}

export function ultimoDiaMes(ano: number, mes: number) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }

// ── Formatação Python (% e str.format) ───────────────────────────
function fmtNumSpec(v: any, spec: string): string {
  // [[fill]align][sign][#][0][width][,][.precision][type]
  const m = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
  if (!m) return String(v);
  let [, fill, align] = m;
  const [, , , sign, , zero, width, group, prec, type] = m;
  let s: string;
  const ehFloat = v instanceof PyFloat;
  if (ehFloat) v = v.v;
  const num = typeof v === "number" ? v : Number(v);
  const isNum = typeof v === "number" || (type && type !== "s");
  if (!isNum) {
    s = String(v ?? "None");
    if (prec) s = s.slice(0, +prec);
  } else {
    let n = num;
    let t = type || (Number.isInteger(n) && prec === undefined && !ehFloat ? "d" : "g");
    if (t === "%") { n = n * 100; t = "f"; }
    if (t === "d") s = Math.round(Math.abs(n)).toString();
    else if (t === "f" || t === "F") s = toFixedPy(Math.abs(n), prec !== undefined ? +prec : 6);
    else if (t === "e" || t === "E") s = Math.abs(n).toExponential(prec !== undefined ? +prec : 6);
    else if (t === "x") s = Math.abs(n).toString(16);
    else if (t === "s") s = String(v);
    else { // g
      const p = prec !== undefined ? +prec : undefined;
      s = p !== undefined ? String(Number(Math.abs(n).toPrecision(p || 1))) : String(Math.abs(n));
      if (type === undefined && (ehFloat || !Number.isInteger(n)) && !s.includes(".") && !s.includes("e")) s += ".0";
    }
    if (group) {
      const [i, f] = s.split(".");
      s = i.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (f !== undefined ? "." + f : "");
    }
    if (type === "%") s += "%";
    const neg = n < 0 || Object.is(n, -0) && false;
    const sg = neg ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
    if (zero && !align) { fill = "0"; align = "="; }
    const w = width ? +width : 0;
    if (align === "=" && (sg + s).length < w) return sg + (fill || " ").repeat(w - (sg + s).length) + s;
    s = sg + s;
  }
  const w = width ? +width : 0;
  if (s.length >= w) return s;
  const f = fill || " ";
  const a = align || (isNum ? ">" : "<");
  const falta = w - s.length;
  if (a === "<") return s + f.repeat(falta);
  if (a === "^") return f.repeat(Math.floor(falta / 2)) + s + f.repeat(Math.ceil(falta / 2));
  return f.repeat(falta) + s;
}

/** Arredondamento do Python sobre o valor exato do double (empate exato → par). */
export function toFixedPy(x: number, nd: number): string {
  let s = x.toFixed(nd);
  const y = x * Math.pow(10, nd);
  if (Number.isFinite(y) && Math.abs(y) < 2 ** 52 && !Number.isInteger(y) && Number.isInteger(y * 2)) {
    // possível empate exato: confirma que x*10^nd é exatamente k+0.5
    const k = Math.floor(y);
    if ((k + 0.5) / Math.pow(10, nd) === x && k % 2 === 0) s = (k / Math.pow(10, nd)).toFixed(nd);
    else if ((k + 0.5) / Math.pow(10, nd) === x && x < 0 && k % 2 !== 0) s = ((k + 1) / Math.pow(10, nd)).toFixed(nd);
  }
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return s;
}

/** round() do Python. */
export function pyRound(x: number, nd = 0): number {
  if (!Number.isFinite(x)) return x;
  if (nd >= 0) return Number(toFixedPy(x, nd));
  const f = Math.pow(10, -nd);
  return Number(toFixedPy(x / f, 0)) * f;
}

export function pyFormat(fmt: string, ...args: any[]): string {
  let auto = 0;
  const kw = args.length && args[args.length - 1] && typeof args[args.length - 1] === "object" && (args[args.length - 1] as any).__kw ? args.pop() : {};
  return fmt.replace(/\{\{|\}\}|\{([^{}:!]*)(?:![rsa])?(?::([^{}]*))?\}/g, (m0, campo, spec) => {
    if (m0 === "{{") return "{";
    if (m0 === "}}") return "}";
    let v: any;
    if (campo === "" || campo === undefined) v = args[auto++];
    else if (/^\d+$/.test(campo)) v = args[+campo];
    else {
      const [base, ...resto] = campo.split(".");
      v = kw[base];
      for (const r of resto) v = v?.[r];
    }
    return spec ? fmtNumSpec(v, spec) : pyStr(v);
  });
}

export function pyPercent(fmt: string, args: any): string {
  const lista = Array.isArray(args) ? args : [args];
  let i = 0;
  const dict = !Array.isArray(args) && args && typeof args === "object" && !(args instanceof SafeHtml) ? args : null;
  return fmt.replace(/%(?:\(([^)]+)\))?([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?([sdifrxXeEgGc%])/g, (m0, nome, flags, width, prec, tipo) => {
    if (tipo === "%") return "%";
    const v = nome && dict ? dict[nome] : lista[i++];
    let spec = "";
    if (flags.includes("-")) spec += "<";
    if (flags.includes("+")) spec += "+";
    if (flags.includes("0") && !flags.includes("-")) spec += "0";
    if (width) spec += width;
    if (prec !== undefined) spec += "." + prec;
    if (tipo === "s" || tipo === "r") return fmtNumSpec(pyStr(v), spec.replace(/^\+/, "").replace(/0/, "") + "s");
    if (tipo === "i" || tipo === "d") return fmtNumSpec(Math.trunc(Number(v)), spec + "d");
    return fmtNumSpec(Number(v), spec + (tipo === "f" ? "f" : tipo));
  });
}

/** str() do Python para os tipos mais comuns. */
export function pyStr(v: any): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") {
    if (Number.isInteger(v) && !(v as any).__float) return String(v);
    return String(v);
  }
  if (v instanceof PyDate) return v.toString();
  if (v instanceof PyFloat) return v.toString();
  return String(v);
}

// ── Decimal (para código que usava decimal.Decimal) ─────────────
/** Decimal(str(x)).quantize(10^-nd, ROUND_HALF_UP) — opera no texto decimal do número, como o Python. */
export function roundHalfUp(x: number | string, nd = 2): number {
  return Number(decimalHalfUp(x, nd));
}
export function decimalHalfUp(x: number | string, nd = 2): string {
  let s = typeof x === "number" ? numToPlain(x) : String(x).trim();
  const neg = s.startsWith("-");
  if (neg || s.startsWith("+")) s = s.slice(1);
  let [i, f = ""] = s.split(".");
  i = i || "0";
  if (f.length <= nd) return (neg && /[1-9]/.test(i + f) ? "-" : "") + i + (nd ? "." + f.padEnd(nd, "0") : "");
  const sobe = f.charCodeAt(nd) - 48 >= 5;
  let dig = (i + f.slice(0, nd)).split("").map(Number);
  if (sobe) { let k = dig.length - 1; while (k >= 0) { if (dig[k] === 9) { dig[k] = 0; k--; } else { dig[k]++; break; } } if (k < 0) dig = [1, ...dig]; }
  const t = dig.join("");
  const ii = t.slice(0, t.length - nd) || "0", ff = t.slice(t.length - nd);
  const r = ii.replace(/^0+(?=\d)/, "") + (nd ? "." + ff : "");
  return (neg && /[1-9]/.test(r) ? "-" : "") + r;
}
/** repr() de float sem notação científica. */
export function numToPlain(x: number): string {
  const s = String(x);
  if (!/e/i.test(s)) return s;
  const [m, e] = s.split(/e/i);
  const exp = Number(e);
  const neg = m.startsWith("-");
  const [a, b = ""] = m.replace("-", "").split(".");
  const digs = a + b;
  let pos = a.length + exp;
  let r: string;
  if (pos <= 0) r = "0." + "0".repeat(-pos) + digs;
  else if (pos >= digs.length) r = digs + "0".repeat(pos - digs.length);
  else r = digs.slice(0, pos) + "." + digs.slice(pos);
  pos = 0;
  return (neg ? "-" : "") + r;
}
