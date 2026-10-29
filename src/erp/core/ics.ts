/* eslint-disable @typescript-eslint/no-explicit-any */
// Leitura de agendas no formato iCalendar (.ics) — Google Agenda e Outlook publicam um
// "endereço secreto" .ics de cada agenda. Aqui buscamos esse arquivo e listamos os
// compromissos de um dia (horário de Brasília), com repetições (RRULE) básicas.

const TZ_BR = "America/Sao_Paulo";
const WIN_TZ: Record<string, string> = {
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Eastern Standard Time": "America/Fortaleza",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "SA Western Standard Time": "America/Manaus",
  "Tocantins Standard Time": "America/Araguaina",
  "Bahia Standard Time": "America/Bahia",
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
  "Eastern Standard Time": "America/New_York",
  "Pacific Standard Time": "America/Los_Angeles",
};

export interface Compromisso {
  titulo: string;
  local: string;
  inicio: string; // "HH:MM" (Brasília) ou "" se dia inteiro
  fim: string;
  diaInteiro: boolean;
  ordem: number;  // minutos desde 00:00 (dia inteiro = -1)
}

interface Prop { valor: string; params: Record<string, string> }
interface Evento { props: Record<string, Prop[]> }

function desdobrar(txt: string): string[] {
  return txt.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}
function lerEventos(txt: string): Evento[] {
  const out: Evento[] = [];
  let atual: Evento | null = null;
  let nivel = 0;
  for (const linha of desdobrar(txt)) {
    if (linha === "BEGIN:VEVENT") { atual = { props: {} }; nivel = 0; continue; }
    if (!atual) continue;
    if (linha.startsWith("BEGIN:")) { nivel++; continue; }
    if (linha.startsWith("END:")) { if (linha === "END:VEVENT" && nivel === 0) { out.push(atual); atual = null; } else nivel--; continue; }
    if (nivel > 0) continue;
    const i = linha.indexOf(":");
    if (i < 0) continue;
    const [nome, ...ps] = linha.slice(0, i).split(";");
    const params: Record<string, string> = {};
    for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
    const k = nome.toUpperCase();
    (atual.props[k] ??= []).push({ valor: linha.slice(i + 1), params });
  }
  return out;
}
function texto(v: string) { return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim(); }

/** Diferença (ms) entre o horário de parede do fuso e UTC num instante. */
function offsetMs(tz: string, utc: number) {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utc)).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utc;
  } catch { return offsetMs(TZ_BR, utc); }
}
function paredeParaUtc(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let utc = guess - offsetMs(tz, guess);
  utc = guess - offsetMs(tz, utc);
  return utc;
}
function utcParaBr(utc: number) {
  const o = offsetMs(TZ_BR, utc);
  const d = new Date(utc + o);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

interface DataIcs { y: number; m: number; d: number; h: number; mi: number; s: number; diaInteiro: boolean; tz: string; utc: boolean }
function lerData(p?: Prop): DataIcs | null {
  if (!p) return null;
  const v = p.valor.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const tzid = p.params.TZID ? (WIN_TZ[p.params.TZID] ?? p.params.TZID) : TZ_BR;
  return { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0), diaInteiro: !m[4] || p.params.VALUE === "DATE", tz: tzid, utc: !!m[7] };
}
const diaNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const deDiaNum = (n: number) => { const x = new Date(n * 86400000); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const DIAS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Dia (no fuso do evento) em que cai uma ocorrência; devolve o instante UTC de início. */
function inicioUtc(dt: DataIcs, dia: { y: number; m: number; d: number }) {
  if (dt.utc) return Date.UTC(dia.y, dia.m - 1, dia.d, dt.h, dt.mi, dt.s);
  return paredeParaUtc(dia.y, dia.m, dia.d, dt.h, dt.mi, dt.s, dt.tz);
}

function regra(rrule: string) {
  const r: Record<string, string> = {};
  for (const p of rrule.split(";")) { const [k, v] = p.split("="); if (k && v) r[k.toUpperCase()] = v; }
  return r;
}

/** A regra de repetição gera uma ocorrência no dia `n` (dias desde 1970, no fuso do evento)? */
function casaRegra(r: Record<string, string>, ini: DataIcs, n: number): boolean {
  const n0 = diaNum(ini.y, ini.m, ini.d);
  if (n < n0) return false;
  const { y, m, d } = deDiaNum(n);
  const intervalo = Math.max(1, +(r.INTERVAL ?? 1));
  if (r.UNTIL) {
    const u = /^(\d{4})(\d{2})(\d{2})/.exec(r.UNTIL);
    if (u && n > diaNum(+u[1], +u[2], +u[3])) return false;
  }
  if (r.BYMONTH && !r.BYMONTH.split(",").map(Number).includes(m)) return false;
  const dow = new Date(n * 86400000).getUTCDay();
  const byday = r.BYDAY ? r.BYDAY.split(",") : null;
  switch ((r.FREQ ?? "").toUpperCase()) {
    case "DAILY":
      if ((n - n0) % intervalo) return false;
      return !byday || byday.some((b) => b.slice(-2) === DIAS[dow]);
    case "WEEKLY": {
      const semana = (x: number) => Math.floor((x + 3) / 7); // semanas começando na segunda
      if ((semana(n) - semana(n0)) % intervalo) return false;
      const dias = byday ? byday.map((b) => b.slice(-2)) : [DIAS[new Date(n0 * 86400000).getUTCDay()]];
      return dias.includes(DIAS[dow]);
    }
    case "MONTHLY": {
      const meses = (y - ini.y) * 12 + (m - ini.m);
      if (meses % intervalo) return false;
      if (r.BYMONTHDAY) return r.BYMONTHDAY.split(",").map(Number).some((x) => (x > 0 ? x : ultimoDia(y, m) + x + 1) === d);
      if (byday) {
        return byday.some((b) => {
          const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(b);
          if (!mm || mm[2] !== DIAS[dow]) return false;
          if (!mm[1]) return true;
          const k = +mm[1];
          if (k > 0) return Math.ceil(d / 7) === k;
          return Math.floor((ultimoDia(y, m) - d) / 7) + 1 === -k;
        });
      }
      return d === ini.d;
    }
    case "YEARLY":
      if ((y - ini.y) % intervalo) return false;
      if (!r.BYMONTH && m !== ini.m) return false;
      if (r.BYMONTHDAY) return r.BYMONTHDAY.split(",").map(Number).includes(d);
      return d === ini.d;
  }
  return false;
}

function ocorre(r: Record<string, string>, ini: DataIcs, n: number): boolean {
  if (!casaRegra(r, ini, n)) return false;
  if (!r.COUNT) return true;
  let c = 0;
  const n0 = diaNum(ini.y, ini.m, ini.d);
  for (let x = n0; x <= n && x - n0 < 3700; x++) if (casaRegra(r, ini, x)) c++;
  return c <= +r.COUNT;
}

const hhmm = (h: number, mi: number) => `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;

/** Compromissos de um dia (YYYY-MM-DD, horário de Brasília). */
export function compromissosDoDia(ics: string, diaIso: string): Compromisso[] {
  const [Y, M, D] = diaIso.split("-").map(Number);
  const alvoIni = paredeParaUtc(Y, M, D, 0, 0, 0, TZ_BR);
  const alvoFim = alvoIni + 86400000;
  const eventos = lerEventos(ics);
  // ocorrências alteradas (RECURRENCE-ID) por UID
  const alterados = new Map<string, Set<number>>();
  for (const e of eventos) {
    const rid = lerData(e.props["RECURRENCE-ID"]?.[0]);
    const uid = e.props.UID?.[0]?.valor ?? "";
    if (rid && uid) {
      const t = rid.diaInteiro ? diaNum(rid.y, rid.m, rid.d) : (() => { const u = rid.utc ? Date.UTC(rid.y, rid.m - 1, rid.d, rid.h, rid.mi, rid.s) : paredeParaUtc(rid.y, rid.m, rid.d, rid.h, rid.mi, rid.s, rid.tz); const b = new Date(u + offsetMs(rid.tz, u)); return diaNum(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate()); })();
      (alterados.get(uid) ?? alterados.set(uid, new Set()).get(uid)!).add(t);
    }
  }
  const out: Compromisso[] = [];
  for (const e of eventos) {
    if ((e.props.STATUS?.[0]?.valor ?? "").toUpperCase() === "CANCELLED") continue;
    const ini = lerData(e.props.DTSTART?.[0]);
    if (!ini) continue;
    const fimD = lerData(e.props.DTEND?.[0]);
    const titulo = texto(e.props.SUMMARY?.[0]?.valor ?? "(sem título)");
    const local = texto(e.props.LOCATION?.[0]?.valor ?? "");
    const uid = e.props.UID?.[0]?.valor ?? "";
    const rrule = e.props.RRULE?.[0]?.valor;
    const ehAlteracao = !!e.props["RECURRENCE-ID"];

    if (ini.diaInteiro) {
      const n0 = diaNum(ini.y, ini.m, ini.d);
      const dur = fimD ? Math.max(1, diaNum(fimD.y, fimD.m, fimD.d) - n0) : 1;
      const nAlvo = diaNum(Y, M, D);
      let ok = false;
      if (rrule && !ehAlteracao) {
        const r = regra(rrule);
        for (let k = 0; k < dur && !ok; k++) ok = ocorre(r, ini, nAlvo - k);
      } else ok = nAlvo >= n0 && nAlvo < n0 + dur;
      const ex = (e.props.EXDATE ?? []).flatMap((p) => p.valor.split(",")).some((v) => v.startsWith(diaIso.replace(/-/g, "")));
      if (ok && !ex) out.push({ titulo, local, inicio: "", fim: "", diaInteiro: true, ordem: -1 });
      continue;
    }

    const durMs = fimD
      ? (fimD.utc ? Date.UTC(fimD.y, fimD.m - 1, fimD.d, fimD.h, fimD.mi, fimD.s) : paredeParaUtc(fimD.y, fimD.m, fimD.d, fimD.h, fimD.mi, fimD.s, fimD.tz))
        - (ini.utc ? Date.UTC(ini.y, ini.m - 1, ini.d, ini.h, ini.mi, ini.s) : paredeParaUtc(ini.y, ini.m, ini.d, ini.h, ini.mi, ini.s, ini.tz))
      : 3600000;
    const candidatos: number[] = [];
    if (rrule && !ehAlteracao) {
      const r = regra(rrule);
      const exd = new Set((e.props.EXDATE ?? []).flatMap((p) => p.valor.split(",")).map((v) => v.slice(0, 8)));
      const alt = alterados.get(uid);
      // dias do fuso do evento que podem cair no dia-alvo de Brasília
      const base = diaNum(Y, M, D);
      for (const nd of [base - 1, base, base + 1]) {
        if (!ocorre(r, ini, nd)) continue;
        const dd = deDiaNum(nd);
        const chave = `${dd.y}${String(dd.m).padStart(2, "0")}${String(dd.d).padStart(2, "0")}`;
        if (exd.has(chave) || alt?.has(nd)) continue;
        candidatos.push(inicioUtc(ini, dd));
      }
    } else {
      candidatos.push(ini.utc ? Date.UTC(ini.y, ini.m - 1, ini.d, ini.h, ini.mi, ini.s) : paredeParaUtc(ini.y, ini.m, ini.d, ini.h, ini.mi, ini.s, ini.tz));
    }
    for (const u of candidatos) {
      if (u >= alvoFim || u + durMs <= alvoIni) continue;
      const a = utcParaBr(Math.max(u, alvoIni));
      const b = utcParaBr(Math.min(u + durMs, alvoFim - 60000));
      out.push({ titulo, local, inicio: hhmm(a.h, a.mi), fim: hhmm(b.h, b.mi), diaInteiro: false, ordem: a.h * 60 + a.mi });
    }
  }
  return out.sort((x, y) => x.ordem - y.ordem || x.titulo.localeCompare(y.titulo));
}

// ── Busca com cache curto (5 min) ───────────────────────────────
const cache = new Map<string, { quando: number; txt: string }>();
export async function baixarIcs(url: string): Promise<string> {
  const c = cache.get(url);
  if (c && Date.now() - c.quando < 5 * 60000) return c.txt;
  const u = url.trim().replace(/^webcal:\/\//i, "https://");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { "user-agent": "Portal Grupo Capuzzo" } });
    if (!r.ok) throw new Error(`A agenda respondeu com erro ${r.status}.`);
    const txt = await r.text();
    if (!txt.includes("BEGIN:VCALENDAR")) throw new Error("O endereço não é de uma agenda (.ics).");
    cache.set(url, { quando: Date.now(), txt });
    return txt;
  } finally {
    clearTimeout(t);
  }
}
export function limparCacheIcs(url: string) { cache.delete(url); }

/** Aceita só endereços https/webcal de agendas (evita usar o servidor para buscar qualquer coisa). */
export function urlIcsValida(url: string): boolean {
  try {
    const u = new URL(url.trim().replace(/^webcal:\/\//i, "https://"));
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return ["calendar.google.com", "outlook.office365.com", "outlook.live.com", "outlook.office.com"].some((d) => h === d || h.endsWith("." + d));
  } catch { return false; }
}
