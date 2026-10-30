import { randomUUID } from "node:crypto";

export interface MedidaConsulta {
  consulta: string;
  ms: number;
  sucesso: boolean;
  codigo: string | null;
}

/** Never log PostgreSQL detail, query, parameters, error message or connection strings. */
export function erroSeguro(error: unknown) {
  const e = error as { code?: unknown; name?: unknown; stack?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const codigo = /^[0-9A-Z]{5}$/.test(code) || [
    "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED",
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
  ].includes(code) ? code : "UNKNOWN";
  const tipo = ["TypeError", "RangeError", "Template render error", "SyntaxError"].includes(String(e?.name))
    ? String(e?.name) : "Error";
  // Only source basenames and coordinates, never the first stack line (error message).
  const origem = typeof e?.stack === "string" ? e.stack.split("\n").slice(1)
    .filter(line => /^\s+at\s/.test(line))
    .map(line => line.match(/[/\\]([\w.-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .slice(0, 4).map(match => `${match[1]}:${match[2]}:${match[3]}`) : [];
  return { tipo, codigo, ...(origem.length ? { origem } : {}) };
}

export function rotaAssessoria(rota: string) {
  return /^\/financas\/assessoria\/?$/.test(rota);
}

export function rotaDiagnosticoPortal(rota: string) {
  return rotaAssessoria(rota) || /^\/inicio\/?$/.test(rota);
}

/** Temporary opt-in diagnostics for the two routes with reported production failures. */
export function diagnosticoAssessoria(rota: string) {
  if (process.env.ERP_ASSESSORIA_DIAGNOSTICO !== "1" || !rotaDiagnosticoPortal(rota)) return null;
  const id = randomUUID();
  const pagina = rotaAssessoria(rota) ? "assessoria" : "inicio";
  const start = performance.now();
  const emit = (value: object) => {
    try { console.info("[erp:assessoria]", JSON.stringify({ id, pagina, ...value })); }
    catch { /* Failure of the diagnostic output must not change the HTTP response. */ }
  };
  return {
    id,
    etapa: (fase: "proxy.inicio" | "proxy.auth.inicio" | "proxy.auth.fim" | "proxy.auth.erro" | "proxy.fim" | "handler.inicio") => {
      emit({ fase, ms: Math.round(performance.now() - start) });
    },
    consulta: (medida: MedidaConsulta) => emit({ fase: "consulta", ...medida }),
    finalizar: (status: number, ms: number, banco: { n: number; ms: number }) => {
      emit({ fase: "resposta", status, ms, consultas: banco.n, banco_ms: banco.ms });
    },
  };
}
