/* eslint-disable @typescript-eslint/no-explicit-any */
// Motor de templates: nunjucks ajustado para se comportar como o Jinja2 do Flask
// (mesmos arquivos .html do app original, sem alteração de layout).
import nunjucks from "nunjucks";

import { PyDate, PyFloat, SafeHtml, pyb, pyFormat, pyPercent, pyRound, pyStr, semFloat } from "./py";

const nj: any = nunjucks;
const runtime: any = nj.runtime;
const lib: any = nj.lib;

let instalado = false;

// ── Métodos Python em str/list/dict ─────────────────────────────
const STR_METODOS: Record<string, (s: string, ...a: any[]) => any> = {
  startswith: (s, p) => (Array.isArray(p) ? p.some((x) => s.startsWith(x)) : s.startsWith(p)),
  endswith: (s, p) => (Array.isArray(p) ? p.some((x) => s.endsWith(x)) : s.endsWith(p)),
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  strip: (s, c) => (c ? s.replace(new RegExp(`^[${esc(c)}]+|[${esc(c)}]+$`, "g"), "") : s.trim()),
  lstrip: (s, c) => (c ? s.replace(new RegExp(`^[${esc(c)}]+`), "") : s.replace(/^\s+/, "")),
  rstrip: (s, c) => (c ? s.replace(new RegExp(`[${esc(c)}]+$`), "") : s.replace(/\s+$/, "")),
  split: (s, sep, max) => pySplit(s, sep, max),
  rsplit: (s, sep, max) => {
    if (max === undefined || max < 0) return pySplit(s, sep);
    const partes = pySplit(s, sep);
    if (partes.length <= max + 1) return partes;
    return [partes.slice(0, partes.length - max).join(sep ?? " "), ...partes.slice(partes.length - max)];
  },
  replace: (s, a, b) => s.split(a).join(b),
  title: (s) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_m, p, l) => p + l.toUpperCase()),
  capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
  format: (s, ...a) => pyFormat(s, ...a.map(desembrulharKw)),
  join: (s, it) => Array.from(it ?? []).map(String).join(s),
  find: (s, x) => s.indexOf(x),
  count: (s, x) => s.split(x).length - 1,
  isdigit: (s) => /^\d+$/.test(s),
  isalpha: (s) => /^\p{L}+$/u.test(s),
  zfill: (s, n) => (s.startsWith("-") ? "-" + s.slice(1).padStart(n - 1, "0") : s.padStart(n, "0")),
  ljust: (s, n, c = " ") => s.padEnd(n, c),
  rjust: (s, n, c = " ") => s.padStart(n, c),
  center: (s, n, c = " ") => { const f = n - s.length; return f <= 0 ? s : c.repeat(Math.floor(f / 2)) + s + c.repeat(Math.ceil(f / 2)); },
  splitlines: (s) => s.split(/\r?\n/),
  encode: (s) => s,
};
function esc(c: string) { return c.replace(/[\]\\^-]/g, "\\$&"); }
export function pySplit(s: string, sep?: string | null, max?: number): string[] {
  if (sep === undefined || sep === null) {
    const p = s.trim().split(/\s+/).filter((x) => x !== "");
    if (max !== undefined && max >= 0 && p.length > max + 1) {
      const r = p.slice(0, max);
      let resto = s.trim();
      for (const x of r) resto = resto.slice(resto.indexOf(x) + x.length).replace(/^\s+/, "");
      return [...r, resto];
    }
    return p;
  }
  const p = s.split(sep);
  if (max !== undefined && max >= 0 && p.length > max + 1) return [...p.slice(0, max), p.slice(max).join(sep)];
  return p;
}

const LIST_METODOS: Record<string, (l: any[], ...a: any[]) => any> = {
  append: (l, x) => { l.push(x); return ""; },
  extend: (l, x) => { l.push(...Array.from(x)); return ""; },
  index: (l, x) => l.indexOf(x),
  count: (l, x) => l.filter((y) => y === x).length,
  pop: (l, i) => (i === undefined ? l.pop() : l.splice(i < 0 ? l.length + i : i, 1)[0]),
  insert: (l, i, x) => { l.splice(i, 0, x); return ""; },
  remove: (l, x) => { const i = l.indexOf(x); if (i >= 0) l.splice(i, 1); return ""; },
  copy: (l) => [...l],
};
const DICT_METODOS: Record<string, (d: any, ...a: any[]) => any> = {
  items: (d) => (d instanceof Map ? Array.from(d.entries()) : Object.keys(d).map((k) => [k, d[k]])),
  keys: (d) => (d instanceof Map ? Array.from(d.keys()) : Object.keys(d)),
  values: (d) => (d instanceof Map ? Array.from(d.values()) : Object.keys(d).map((k) => d[k])),
  get: (d, k, def = null) => {
    if (d instanceof Map) { if (d.has(k)) return d.get(k); const alt = altKey(k); return alt !== undefined && d.has(alt) ? d.get(alt) : def; }
    return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : def;
  },
  update: (d, o) => {
    const src = desembrulharKw(o);
    if (d instanceof Map) for (const [k, v] of src instanceof Map ? src.entries() : Object.entries(src)) d.set(k, v);
    else Object.assign(d, src instanceof Map ? Object.fromEntries(src) : src);
    return "";
  },
  setdefault: (d, k, v = null) => {
    if (d instanceof Map) { if (!d.has(k)) d.set(k, v); return d.get(k); }
    if (!(k in d)) d[k] = v; return d[k];
  },
  pop: (d, k, def) => {
    if (d instanceof Map) { const v = d.has(k) ? d.get(k) : def; d.delete(k); return v; }
    const v = k in d ? d[k] : def; delete d[k]; return v;
  },
  copy: (d) => (d instanceof Map ? new Map(d) : { ...d }),
};
function altKey(k: any) {
  if (typeof k === "string" && /^-?\d+$/.test(k)) return Number(k);
  if (typeof k === "number") return String(k);
  return undefined;
}
function desembrulharKw(o: any) {
  if (o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, "__keywords")) {
    const c = { ...o }; delete c.__keywords; return { ...c, __kw: true };
  }
  return o;
}

function pySlice(obj: any, start: any, stop: any, step: any) {
  const seq = typeof obj === "string" || obj instanceof String ? Array.from(String(obj)) : Array.isArray(obj) ? obj : [];
  const n = seq.length;
  step = step ?? 1;
  const norm = (v: any, def: number) => { if (v === null || v === undefined) return def; v = Math.trunc(v); if (v < 0) v += n; return v; };
  const out: any[] = [];
  if (step > 0) { let i = Math.max(0, norm(start, 0)); const fim = Math.min(n, norm(stop, n)); for (; i < fim; i += step) out.push(seq[i]); }
  else { let i = Math.min(n - 1, norm(start, n - 1)); const fim = stop === null || stop === undefined ? -1 : Math.max(-1, norm(stop, -1)); for (; i > fim; i += step) out.push(seq[i]); }
  return typeof obj === "string" || obj instanceof String ? out.join("") : out;
}

function memberLookup(obj: any, val: any, ...resto: any[]) {
  if (resto.length === 2) return pySlice(obj, val, resto[0], resto[1]);
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj === "string" || obj instanceof String) {
    const s = String(obj);
    if (typeof val === "number") return s.charAt(val < 0 ? s.length + val : val);
    if (STR_METODOS[val]) return (...a: any[]) => STR_METODOS[val](s, ...a);
    if (val === "length") return s.length;
    return undefined;
  }
  if (Array.isArray(obj)) {
    if (typeof val === "number") return obj[val < 0 ? obj.length + val : val];
    if (typeof val === "string" && /^-?\d+$/.test(val)) { const n = +val; return obj[n < 0 ? obj.length + n : n]; }
    if (LIST_METODOS[val]) return (...a: any[]) => LIST_METODOS[val](obj, ...a);
    return (obj as any)[val];
  }
  if (obj instanceof Map) {
    if (obj.has(val)) return obj.get(val);
    const alt = altKey(val);
    if (alt !== undefined && obj.has(alt)) return obj.get(alt);
    if (DICT_METODOS[val]) return (...a: any[]) => DICT_METODOS[val](obj, ...a);
    return undefined;
  }
  if (obj instanceof Set) {
    if (val === "add") return (x: any) => { obj.add(x); return ""; };
    return undefined;
  }
  if (typeof obj === "object") {
    const proto = Object.getPrototypeOf(obj);
    const plano = proto === Object.prototype || proto === null;
    if (plano) {
      if (Object.prototype.hasOwnProperty.call(obj, val)) return obj[val];
      if (DICT_METODOS[val]) return (...a: any[]) => DICT_METODOS[val](obj, ...a);
      return undefined;
    }
    const v = obj[val];
    if (typeof v === "function") return (...a: any[]) => v.apply(obj, a);
    return v;
  }
  if (typeof obj === "number" && val === "real") return obj;
  return undefined;
}

function pyIter(v: any) {
  if (v === null || v === undefined || v === false) return v;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (v instanceof Map) return Array.from(v.keys());
  if (v instanceof Set) return Array.from(v);
  if (typeof v === "object" && Symbol.iterator in v) return Array.from(v as any);
  if (typeof v === "object") return Object.keys(v);
  return v;
}

function pyMod(a: any, b: any) {
  if (typeof a === "string" || a instanceof String || a instanceof SafeHtml) {
    const r = pyPercent(String(a), b);
    return a instanceof runtime.SafeString ? runtime.markSafe(r) : r;
  }
  const x = Number(semFloat(a)), y = Number(semFloat(b));
  const r = x % y;
  return flt(a, b, r !== 0 && (r < 0) !== (y < 0) ? r + y : r);
}
// Aritmética com float do Python: se um dos lados é PyFloat, o resultado também é (imprime "10.0").
const ehNum = (x: any) => typeof x === "number" || x instanceof PyFloat;
function flt(a: any, b: any, r: number) { return a instanceof PyFloat || b instanceof PyFloat ? new PyFloat(r) : r; }
function pyAdd(a: any, b: any) {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (ehNum(a) && ehNum(b)) return flt(a, b, semFloat(a) + semFloat(b));
  return a + b;
}
function pySub(a: any, b: any) { return ehNum(a) && ehNum(b) ? flt(a, b, semFloat(a) - semFloat(b)) : a - b; }
function pyDiv(a: any, b: any) { return new PyFloat(Number(semFloat(a)) / Number(semFloat(b))); }
function pyFloorDiv(a: any, b: any) { return flt(a, b, Math.floor(Number(semFloat(a)) / Number(semFloat(b)))); }
function pyConcat(a: any, b: any) { return (a instanceof PyFloat ? a.toString() : a) + "" + (b instanceof PyFloat ? b.toString() : b); }
function pyMul(a: any, b: any) {
  if (ehNum(a) && ehNum(b)) return flt(a, b, semFloat(a) * semFloat(b));
  if (typeof a === "string" && typeof b === "number") return a.repeat(Math.max(0, b));
  if (Array.isArray(a) && typeof b === "number") return Array.from({ length: Math.max(0, b) }, () => a).flat();
  return a * b;
}
function pyIn(a: any, b: any) {
  if (b instanceof Map) return b.has(a) || (altKey(a) !== undefined && b.has(altKey(a)));
  if (b instanceof Set) return b.has(a) || (altKey(a) !== undefined && b.has(altKey(a)));
  if (b === null || b === undefined) return false;
  if (Array.isArray(b)) return b.some((x) => x === a || (x instanceof Array && a instanceof Array && JSON.stringify(x) === JSON.stringify(a)));
  if (typeof b === "string" || b instanceof String) return String(b).includes(String(a));
  if (typeof b === "object") return Object.prototype.hasOwnProperty.call(b, a);
  return false;
}
function pyEq(a: any, b: any): boolean {
  a = semFloat(a); b = semFloat(b);
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a instanceof PyDate && b instanceof PyDate) return a.compare(b) === 0;
  if ((typeof a === "string" || a instanceof String) && (typeof b === "string" || b instanceof String)) return String(a) === String(b);
  if (typeof a === "boolean" && typeof b === "number") return Number(a) === b;
  if (typeof b === "boolean" && typeof a === "number") return Number(b) === a;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => pyEq(x, b[i]));
  return false;
}

function instalar() {
  if (instalado) return;
  instalado = true;
  nj.installJinjaCompat();
  const Compiler = nj.compiler.Compiler;
  const P = Compiler.prototype;

  // escape do markupsafe (Jinja): aspas viram &#34; e &#39;
  const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#34;", "'": "&#39;" };
  lib.escape = (v: any) => (v instanceof runtime.SafeString ? v : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
  runtime.memberLookup = memberLookup;
  runtime.pyb = pyb;
  runtime.pyIter = pyIter;
  runtime.pyMod = pyMod;
  runtime.pyAdd = pyAdd;
  runtime.pyMul = pyMul;
  runtime.pySub = pySub;
  runtime.pyDiv = pyDiv;
  runtime.pyFloorDiv = pyFloorDiv;
  runtime.pyConcat = pyConcat;
  runtime.pyNeg = (v: any) => (v instanceof PyFloat ? new PyFloat(-v.v) : -v);
  runtime.inOperator = pyIn;
  runtime.pyEq = pyEq;
  const fromIt = runtime.fromIterator;
  runtime.fromIterator = (v: any) => fromIt(pyIter(v));

  const wrap = (self: any, fn: string, node: any, frame: any) => {
    self._emit(`runtime.${fn}(`);
    self.compile(node, frame);
    self._emit(")");
  };
  P.compileIf = function (this: any, node: any, frame: any, async: any) {
    this._emit("if(runtime.pyb(");
    this._compileExpression(node.cond, frame);
    this._emitLine(")) {");
    this._withScopedSyntax(() => { this.compile(node.body, frame); if (async) this._emit("cb()"); });
    if (node.else_) {
      this._emitLine("}\nelse {");
      this._withScopedSyntax(() => { this.compile(node.else_, frame); if (async) this._emit("cb()"); });
    } else if (async) { this._emitLine("}\nelse {"); this._emit("cb()"); }
    this._emitLine("}");
  };
  P.compileInlineIf = function (this: any, node: any, frame: any) {
    this._emit("(runtime.pyb(");
    this.compile(node.cond, frame);
    this._emit(")?");
    this.compile(node.body, frame);
    this._emit(":");
    if (node.else_ !== null) this.compile(node.else_, frame); else this._emit("undefined");
    this._emit(")");
  };
  P.compileNot = function (this: any, node: any, frame: any) { this._emit("!"); wrap(this, "pyb", node.target, frame); };
  P.compileOr = function (this: any, node: any, frame: any) {
    this._emit("((__t) => runtime.pyb(__t) ? __t : (");
    this.compile(node.right, frame);
    this._emit("))(");
    this.compile(node.left, frame);
    this._emit(")");
  };
  P.compileAnd = function (this: any, node: any, frame: any) {
    this._emit("((__t) => !runtime.pyb(__t) ? __t : (");
    this.compile(node.right, frame);
    this._emit("))(");
    this.compile(node.left, frame);
    this._emit(")");
  };
  const bin = (fn: string) => function (this: any, node: any, frame: any) {
    this._emit(`runtime.${fn}(`);
    this.compile(node.left, frame);
    this._emit(",");
    this.compile(node.right, frame);
    this._emit(")");
  };
  P.compileMod = bin("pyMod");
  P.compileAdd = bin("pyAdd");
  P.compileMul = bin("pyMul");
  P.compileSub = bin("pySub");
  P.compileDiv = bin("pyDiv");
  P.compileFloorDiv = bin("pyFloorDiv");
  P.compileConcat = bin("pyConcat");
  // Tupla do Python: (a, b) → lista (no JS viraria o operador vírgula e valeria só o último)
  const grupoOrig = P.compileGroup;
  P.compileGroup = function (this: any, node: any, frame: any) {
    if (node.children.length > 1) this._compileAggregate(node, frame, "[", "]");
    else grupoOrig.call(this, node, frame);
  };
  P.compileNeg = function (this: any, node: any, frame: any) { wrap(this, "pyNeg", node.target, frame); };
  P.compileCompare = function (this: any, node: any, frame: any) {
    // a < b < c  → (a<b) && (b<c), com == / != no estilo Python
    const ops = node.ops;
    if (ops.length === 1 && (ops[0].type === "==" || ops[0].type === "!=" || ops[0].type === "===" || ops[0].type === "!==")) {
      if (ops[0].type.startsWith("!")) this._emit("!");
      this._emit("runtime.pyEq(");
      this.compile(node.expr, frame);
      this._emit(",");
      this.compile(ops[0].expr, frame);
      this._emit(")");
      return;
    }
    const map: any = { "==": "==", "===": "===", "!=": "!=", "!==": "!==", "<": "<", ">": ">", "<=": "<=", ">=": ">=" };
    this._emit("(");
    this.compile(node.expr, frame);
    ops.forEach((op: any) => {
      this._emit(` ${map[op.type]} `);
      this.compile(op.expr, frame);
    });
    this._emit(")");
  };
  // Chaves de dicionário calculadas: {a ~ b: 1}
  P.compilePair = function (this: any, node: any, frame: any) {
    let key = node.key;
    const nodes = nj.nodes;
    if (key instanceof nodes.Symbol) key = new nodes.Literal(key.lineno, key.colno, key.value);
    if (key instanceof nodes.Literal && (typeof key.value === "string" || typeof key.value === "number")) {
      this._emit(JSON.stringify(String(key.value)));
    } else {
      this._emit("[");
      this._compileExpression(node.key, frame);
      this._emit("]");
    }
    this._emit(": ");
    this._compileExpression(node.value, frame);
  };
  // Parser: aceita chave de dict como expressão
  const Parser = nj.parser.Parser;
  const origAgg = Parser.prototype.parseAggregate;
  Parser.prototype.parseAggregate = function (this: any) {
    return origAgg.apply(this, arguments as any);
  };
  // Precedência como no Jinja/Python: + e - no mesmo nível, e * / // % no mesmo nível, sempre da esquerda
  // para a direita (o nunjucks fazia a * b / c = a * (b / c), o que muda o arredondamento de floats).
  const lexer = nj.lexer;
  const binarios = (ops: Record<string, string>, prox: string) => function (this: any) {
    let node = this[prox]();
    for (;;) {
      const tok = this.peekToken();
      if (!tok || tok.type !== lexer.TOKEN_OPERATOR || !(tok.value in ops)) return node;
      this.nextToken();
      const node2 = this[prox]();
      node = new nj.nodes[ops[tok.value]](node.lineno, node.colno, node, node2);
    }
  };
  Parser.prototype.parseAdd = binarios({ "+": "Add", "-": "Sub" }, "parseMul");
  Parser.prototype.parseMul = binarios({ "*": "Mul", "/": "Div", "//": "FloorDiv", "%": "Mod" }, "parsePow");
}

// ── Pré-processamento do texto Jinja → nunjucks ─────────────────
function dividirTopo(s: string, sep = ","): string[] {
  const partes: string[] = [];
  let nivel = 0, aspas: string | null = null, atual = "";
  for (const c of s) {
    if (aspas) { atual += c; if (c === aspas) aspas = null; continue; }
    if (c === "'" || c === '"') { aspas = c; atual += c; continue; }
    if ("([{".includes(c)) nivel++;
    if (")]}".includes(c)) nivel--;
    if (c === sep && nivel === 0) { partes.push(atual); atual = ""; continue; }
    atual += c;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

/** {% for X in EXPR if COND %}...{% endfor %} → {% for X in EXPR %}{% if COND %}...{% endif %}{% endfor %}
 *  (loop.index/loop.last contam os itens não filtrados — nenhum template usa loop.* nesses laços). */
function filtroDoFor(src: string): string {
  const tag = /\{%(-?)\s*(for|endfor|if|endif|else)\b([\s\S]*?)(-?)%\}/g;
  const pilha: string[] = []; // "for" | "forf" (for com filtro, if interno aberto) | "if"
  let out = "", ult = 0, m: RegExpExecArray | null;
  while ((m = tag.exec(src))) {
    out += src.slice(ult, m.index);
    ult = m.index + m[0].length;
    const t = m[2];
    if (t === "for") {
      const f = /^([\s\S]*?\sin\s[\s\S]*?)\sif\s([\s\S]+)$/.exec(m[3]);
      if (f && !/\selse\s/.test(f[2])) {
        pilha.push("forf");
        out += `{%${m[1]} for${f[1]} %}{% if ${f[2].trim()} ${m[4]}%}`;
      } else { pilha.push("for"); out += m[0]; }
    } else if (t === "if") { pilha.push("if"); out += m[0]; }
    else if (t === "endif") { pilha.pop(); out += m[0]; }
    else if (t === "else") {
      // {% else %} do próprio for filtrado: fecha o if interno antes
      if (pilha[pilha.length - 1] === "forf") { pilha[pilha.length - 1] = "for"; out += "{% endif %}"; }
      out += m[0];
    } else { // endfor
      out += (pilha.pop() === "forf" ? "{% endif %}" : "") + m[0];
    }
  }
  return out + src.slice(ult);
}

export function preprocessar(src: string): string {
  // {% with a = x, b = y %} ... {% endwith %}  →  sets (o escopo do with não é relevante aqui)
  src = src.replace(/\{%(-?)\s*with\s+([\s\S]*?)\s*(-?)%\}/g, (_m, a, corpo, b) =>
    dividirTopo(corpo).map((p) => `{%${a} set ${p.trim()} ${b}%}`).join(""));
  src = src.replace(/\{%(-?)\s*endwith\s*(-?)%\}/g, "");
  // {% set ns.x = expr %} → pyset(ns, 'x', expr)
  src = src.replace(/\{%(-?)\s*set\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([\s\S]*?)\s*(-?)%\}/g,
    (_m, a, ns, at, expr, b) => `{%${a} set __lixo = pyset(${ns}, '${at}', ${expr}) ${b}%}`);
  // **kwargs em chamadas → __splat=kwargs
  src = src.replace(/,\s*\*\*\s*([A-Za-z_][\w.]*)\s*\)/g, ", __splat=$1)");
  // {% do x %} (extensão do Jinja) → set
  src = src.replace(/\{%(-?)\s*do\s+([\s\S]*?)\s*(-?)%\}/g, "{%$1 set __lixo = $2 $3%}");
  // x in ('a','b') — tupla de literais (o nunjucks não tem tupla) → lista
  // (vale para qualquer tupla de literais que não seja argumento de chamada: "in (...)", "[(...), (...)]")
  src = src.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (tag) => tag.replace(
    /\(((?:\s*(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?)\s*,)+\s*(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?)?\s*)\)/g,
    (m, corpo, pos, tudo) => (/[\w)\]]\s*$/.test(tudo.slice(Math.max(0, pos - 40), pos)) && !/\bin\s*$/.test(tudo.slice(Math.max(0, pos - 40), pos)) ? m : `[${corpo}]`)));
  // {% for x in lista if cond %} (filtro do laço do Jinja; no nunjucks vira if inline) → for + if interno
  src = filtroDoFor(src);
  // keep_trailing_newline=False do Jinja: a última quebra de linha do arquivo não sai no resultado
  src = src.replace(/\r?\n$/, "");
  // loop.index0 etc. já existem; "is not none" ok; "is sameas" ok
  return src;
}

// ── Filtros e testes do Jinja ───────────────────────────────────
function kwargs(args: any[]): [any[], Record<string, any>] {
  const ult = args[args.length - 1];
  if (ult && typeof ult === "object" && Object.prototype.hasOwnProperty.call(ult, "__keywords")) {
    const k = { ...ult }; delete k.__keywords;
    return [args.slice(0, -1), k];
  }
  return [args, {}];
}
function attrGet(obj: any, attr: any) {
  if (attr === undefined || attr === null) return obj;
  let v = obj;
  for (const p of String(attr).split(".")) v = memberLookup(v, /^\d+$/.test(p) ? Number(p) : p);
  return v;
}
function lista(v: any): any[] {
  if (v === null || v === undefined) return [];
  const it = pyIter(v);
  return Array.isArray(it) ? it : [];
}
function cmpPy(a: any, b: any): number {
  a = semFloat(a); b = semFloat(b);
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpPy(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (a instanceof PyDate && b instanceof PyDate) return a.compare(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function testar(env: any, nome: string, v: any, args: any[]) {
  if (nome === "equalto" || nome === "eq" || nome === "==") return pyEq(v, args[0]);
  if (nome === "ne" || nome === "!=") return !pyEq(v, args[0]);
  if (nome === "in") return pyIn(v, args[0]);
  if (nome === "none") return v === null || v === undefined;
  if (nome === "defined") return v !== undefined;
  if (nome === "undefined") return v === undefined;
  if (nome === "true") return v === true;
  if (nome === "false") return v === false;
  if (nome === "gt" || nome === ">") return v > args[0];
  if (nome === "lt" || nome === "<") return v < args[0];
  if (nome === "ge" || nome === ">=") return v >= args[0];
  if (nome === "le" || nome === "<=") return v <= args[0];
  const t = env.getTest(nome);
  return t(v, ...args);
}

export function criarAmbiente(fontes: Record<string, string>) {
  instalar();
  const loader = {
    getSource(nome: string) {
      const src = fontes[nome];
      if (src === undefined) return null;
      return { src: preprocessar(src), path: nome, noCache: false };
    },
  };
  const env: any = new nj.Environment(loader as any, { autoescape: true, throwOnUndefined: false, trimBlocks: false, lstripBlocks: false });

  // Testes adicionais
  env.addTest("none", (v: any) => v === null || v === undefined);
  env.addTest("mapping", (v: any) => v instanceof Map || (v !== null && typeof v === "object" && !Array.isArray(v)));
  env.addTest("sequence", (v: any) => Array.isArray(v) || typeof v === "string");
  env.addTest("in", (v: any, c: any) => pyIn(v, c));
  env.addTest("equalto", (v: any, o: any) => pyEq(v, o));
  env.addTest("sameas", (v: any, o: any) => v === o);
  env.addTest("boolean", (v: any) => typeof v === "boolean");
  env.addTest("integer", (v: any) => typeof v === "number" && Number.isInteger(v));
  env.addTest("float", (v: any) => typeof v === "number" && !Number.isInteger(v));

  const F = (nome: string, fn: (...a: any[]) => any) => env.addFilter(nome, fn);
  F("length", (v: any) => (v === null || v === undefined ? 0 : v instanceof Map || v instanceof Set ? v.size : typeof v === "object" && !Array.isArray(v) && !(v instanceof String) ? Object.keys(v).length : v.length));
  F("count", (v: any) => env.getFilter("length")(v));
  F("format", (s: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a);
    if (Object.keys(kw).length) return pyPercent(String(s), kw);
    return pyPercent(String(s), pos.length === 1 ? [pos[0]] : pos);
  });
  F("tojson", (v: any, indent?: any) => runtime.markSafe(jsonPython(toJsonable(v), typeof indent === "number" ? indent : undefined, true)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/'/g, "\\u0027")));
  F("default", (v: any, def: any = "", bool = false) => (bool ? (pyb(v) ? v : def) : v === undefined ? def : v));
  F("d", (v: any, def: any = "", bool = false) => (bool ? (pyb(v) ? v : def) : v === undefined ? def : v));
  F("int", (v: any, def = 0) => {
    if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : def;
    if (typeof v === "boolean") return Number(v);
    const s = String(v ?? "").trim();
    if (/^[-+]?\d+$/.test(s)) return parseInt(s, 10);
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Math.trunc(parseFloat(s));
    return def;
  });
  F("float", (v: any, def = 0.0) => {
    if (v instanceof PyFloat) return v;
    if (typeof v === "number") return new PyFloat(v);
    const n = parseFloat(String(v ?? ""));
    return /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(String(v ?? "")) ? new PyFloat(n) : (typeof def === "number" ? new PyFloat(def) : def);
  });
  F("string", (v: any) => (v instanceof runtime.SafeString ? v : pyStr(v)));
  F("list", (v: any) => lista(v));
  F("round", (v: any, prec = 0, metodo = "common") => {
    // o round do Jinja sempre devolve float
    const n = Number(semFloat(v)); const f = Math.pow(10, prec);
    if (metodo === "ceil") return new PyFloat(Math.ceil(n * f) / f);
    if (metodo === "floor") return new PyFloat(Math.floor(n * f) / f);
    return new PyFloat(pyRound(n, prec));
  });
  F("abs", (v: any) => (v instanceof PyFloat ? new PyFloat(Math.abs(v.v)) : Math.abs(v)));
  F("first", (v: any) => lista(v)[0]);
  F("last", (v: any) => { const l = lista(v); return l[l.length - 1]; });
  F("reverse", (v: any) => (typeof v === "string" ? Array.from(v).reverse().join("") : [...lista(v)].reverse()));
  F("sum", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a);
    const attr = kw.attribute ?? pos[0];
    let total = kw.start ?? pos[1] ?? 0;
    for (const x of lista(v)) total = pyAdd(total, attrGet(x, attr) ?? 0);
    return total;
  });
  F("min", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a); const attr = kw.attribute ?? pos[1];
    const l = lista(v); if (!l.length) return undefined;
    return l.reduce((m, x) => (cmpPy(attrGet(x, attr), attrGet(m, attr)) < 0 ? x : m));
  });
  F("max", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a); const attr = kw.attribute ?? pos[1];
    const l = lista(v); if (!l.length) return undefined;
    return l.reduce((m, x) => (cmpPy(attrGet(x, attr), attrGet(m, attr)) > 0 ? x : m));
  });
  F("map", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a);
    if (kw.attribute !== undefined) return lista(v).map((x) => { const r = attrGet(x, kw.attribute); return r === undefined && "default" in kw ? kw.default : r; });
    const nome = pos[0]; const resto = pos.slice(1);
    const f = env.getFilter(nome);
    return lista(v).map((x) => f(x, ...resto));
  });
  const sel = (inv: boolean, porAttr: boolean) => (v: any, ...a: any[]) => {
    const [pos] = kwargs(a);
    const attr = porAttr ? pos[0] : undefined;
    const teste = porAttr ? pos[1] : pos[0];
    const args = porAttr ? pos.slice(2) : pos.slice(1);
    return lista(v).filter((x) => {
      const val = porAttr ? attrGet(x, attr) : x;
      const r = teste === undefined ? pyb(val) : testar(env, teste, val, args);
      return inv ? !r : r;
    });
  };
  F("selectattr", sel(false, true));
  F("rejectattr", sel(true, true));
  F("select", sel(false, false));
  F("reject", sel(true, false));
  F("join", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a);
    const d = kw.d ?? pos[0] ?? "";
    const attr = kw.attribute ?? pos[1];
    const partes = lista(v).map((x) => attrGet(x, attr));
    const algumSafe = partes.some((p) => p instanceof runtime.SafeString) || d instanceof runtime.SafeString;
    const r = partes.map((p) => (p instanceof runtime.SafeString || !algumSafe ? pyStr(p) : lib.escape(pyStr(p)))).join(String(d));
    return algumSafe ? runtime.markSafe(r) : r;
  });
  F("sort", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a);
    const rev = kw.reverse ?? pos[0] ?? false;
    const attr = kw.attribute ?? pos[2];
    const l = [...lista(v)].sort((x, y) => {
      let ax = attrGet(x, attr), ay = attrGet(y, attr);
      if (!(kw.case_sensitive ?? pos[1]) && typeof ax === "string" && typeof ay === "string") { ax = ax.toLowerCase(); ay = ay.toLowerCase(); }
      return (rev ? -1 : 1) * cmpPy(ax, ay); // reverse estável, como o sorted(reverse=True) do Python
    });
    return l;
  });
  F("unique", (v: any, ...a: any[]) => {
    const [, kw] = kwargs(a); const vistos = new Set(); const out: any[] = [];
    for (const x of lista(v)) { const k = attrGet(x, kw.attribute); if (!vistos.has(k)) { vistos.add(k); out.push(x); } }
    return out;
  });
  F("groupby", (v: any, ...a: any[]) => {
    const [pos, kw] = kwargs(a); const attr = kw.attribute ?? pos[0];
    const ordenado = [...lista(v)].sort((x, y) => cmpPy(attrGet(x, attr), attrGet(y, attr)));
    const grupos: any[] = [];
    for (const x of ordenado) {
      const k = attrGet(x, attr);
      const ult = grupos[grupos.length - 1];
      if (ult && pyEq(ult.grouper, k)) ult.list.push(x);
      else { const g: any = [k, [x]]; g.grouper = k; g.list = g[1]; grupos.push(g); }
    }
    return grupos;
  });
  F("dictsort", (v: any) => DICT_METODOS.items(v).sort((x: any, y: any) => cmpPy(x[0], y[0])));
  F("items", (v: any) => DICT_METODOS.items(v ?? {}));
  F("batch", (v: any, n: number, fill?: any) => {
    const l = lista(v); const out: any[] = [];
    for (let i = 0; i < l.length; i += n) out.push(l.slice(i, i + n));
    if (fill !== undefined && out.length) { const u = out[out.length - 1]; while (u.length < n) u.push(fill); }
    return out;
  });
  F("lower", (v: any) => pyStr(v ?? "").toLowerCase());
  F("upper", (v: any) => pyStr(v ?? "").toUpperCase());
  F("title", (v: any) => STR_METODOS.title(pyStr(v ?? "")));
  F("capitalize", (v: any) => STR_METODOS.capitalize(pyStr(v ?? "")));
  F("trim", (v: any) => pyStr(v ?? "").trim());
  F("replace", (v: any, a: any, b: any) => {
    const r = pyStr(v ?? "").split(String(a)).join(String(b));
    return v instanceof runtime.SafeString ? runtime.markSafe(r) : r;
  });
  F("truncate", (v: any, n = 255, kill = false, end = "...", leeway = 5) => {
    const s = pyStr(v ?? "");
    if (s.length <= n + leeway) return s;
    if (kill) return s.slice(0, n - end.length) + end;
    const r = s.slice(0, n - end.length).split(" ").slice(0, -1).join(" ");
    return r + end;
  });
  F("urlencode", (v: any) => {
    if (v && typeof v === "object") return new URLSearchParams(Object.entries(v).map(([k, x]) => [k, pyStr(x)])).toString();
    // quote(s, safe="/") do Python: também codifica ! ' ( ) * (que o encodeURIComponent deixa passar)
    return encodeURIComponent(pyStr(v ?? "")).replace(/%2F/g, "/").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  });
  F("e", (v: any) => (v instanceof runtime.SafeString ? v : runtime.markSafe(lib.escape(pyStr(v ?? "")))));
  F("escape", (v: any) => (v instanceof runtime.SafeString ? v : runtime.markSafe(lib.escape(pyStr(v ?? "")))));
  F("safe", (v: any) => runtime.markSafe(v === null || v === undefined ? "" : String(v)));
  F("striptags", (v: any) => pyStr(v ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
  F("wordcount", (v: any) => pyStr(v ?? "").split(/\s+/).filter(Boolean).length);
  F("center", (v: any, w = 80) => STR_METODOS.center(pyStr(v), w));

  // Globais básicos do Jinja
  env.addGlobal("range", (a: number, b?: number, passo = 1) => {
    const [ini, fim] = b === undefined ? [0, a] : [a, b];
    const out: number[] = [];
    if (passo > 0) for (let i = ini; i < fim; i += passo) out.push(i);
    else for (let i = ini; i > fim; i += passo) out.push(i);
    return out;
  });
  env.addGlobal("dict", (...a: any[]) => { const [pos, kw] = kwargs(a); return { ...(pos[0] ?? {}), ...kw }; });
  env.addGlobal("namespace", (...a: any[]) => { const [, kw] = kwargs(a); return { ...kw }; });
  env.addGlobal("pyset", (obj: any, k: string, v: any) => { if (obj instanceof Map) obj.set(k, v); else obj[k] = v; return ""; });
  env.addGlobal("len", (v: any) => env.getFilter("length")(v));
  env.addGlobal("enumerate", (v: any, ini = 0) => lista(v).map((x, i) => [i + ini, x]));
  env.addGlobal("zip", (...ls: any[]) => { const a = ls.map(lista); const n = Math.min(...a.map((x) => x.length)); return Array.from({ length: n }, (_, i) => a.map((x) => x[i])); });
  env.addGlobal("lipsum", () => "");
  return env;
}

/** json.dumps do Python: ", " e ": " como separadores e não-ASCII como \\uXXXX. */
export function jsonPython(v: any, indent?: number, ordenar = false): string {
  const ascii = (t: string) => t.replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const enc = (x: any, nivel: number): string => {
    if (x === null || x === undefined) return "null";
    if (x instanceof PyFloat) return Number.isFinite(x.v) ? x.toString() : (Number.isNaN(x.v) ? "NaN" : x.v > 0 ? "Infinity" : "-Infinity");
    if (typeof x === "number") return Number.isFinite(x) ? (Number.isInteger(x) && (x as any).__float ? x + ".0" : String(x)) : "NaN";
    if (typeof x === "boolean") return x ? "true" : "false";
    if (typeof x === "string") return ascii(JSON.stringify(x));
    const pre = indent !== undefined ? "\n" + " ".repeat(indent * (nivel + 1)) : "";
    const fim = indent !== undefined ? "\n" + " ".repeat(indent * nivel) : "";
    const sep = indent !== undefined ? "," : ", ";
    if (Array.isArray(x)) return x.length ? "[" + pre + x.map((y) => enc(y, nivel + 1)).join(sep + pre) + fim + "]" : "[]";
    const ks = ordenar ? Object.keys(x).sort() : Object.keys(x);
    return ks.length ? "{" + pre + ks.map((k) => ascii(JSON.stringify(k)) + ": " + enc(x[k], nivel + 1)).join(sep + pre) + fim + "}" : "{}";
  };
  return enc(v, 0);
}

function toJsonable(v: any): any {
  if (v instanceof PyFloat) return v;
  if (v instanceof PyDate) return v.isoformat();
  if (v instanceof Map) return Object.fromEntries(Array.from(v.entries()).map(([k, x]) => [String(k), toJsonable(x)]));
  if (v instanceof Set) return Array.from(v).map(toJsonable);
  if (Array.isArray(v)) return v.map(toJsonable);
  if (v instanceof runtime.SafeString) return String(v);
  if (v && typeof v === "object") { const o: any = {}; for (const k of Object.keys(v)) if (k !== "__keywords") o[k] = toJsonable(v[k]); return o; }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}

export function marcarSeguro(html: string) { return runtime.markSafe(html); }
export function ehSeguro(v: any) { return v instanceof runtime.SafeString; }
export { runtime as njRuntime, kwargs as separarKwargs };
