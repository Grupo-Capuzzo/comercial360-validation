/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/gmail_integration.py — Gmail via OAuth 2.0 + API REST (fetch).
// Online não existem os arquivos config/gmail_credentials.json e config/gmail_token.json:
// o conteúdo deles fica em erp_config (chaves "gmail_credentials" e "gmail_token").
// O fluxo OAuth "installed app" (servidor local na porta 8765 + abrir navegador) vira
// o fluxo web: authenticate_gmail() devolve a URL de consentimento do Google e
// concluir_autenticacao_gmail() troca o "code" do retorno pelo token.
// Regras mantidas: escopo mínimo gmail.compose; o token nunca vai para o frontend.
import { gravarConfig, lerConfig } from "../core/arquivos";

export const CREDENTIALS_PATH = "config/gmail_credentials.json";
export const TOKEN_PATH = "config/gmail_token.json";
const CHAVE_CREDENCIAIS = "gmail_credentials";
const CHAVE_TOKEN = "gmail_token";

export const SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];
export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const DRAFTS_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
export const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export const MSG_CREDENCIAIS_NAO_ENCONTRADAS =
  "Arquivo de credenciais do Gmail nao encontrado. Configure config/gmail_credentials.json.";

export class GmailCredentialsNotFoundError extends Error {}
export class GmailNotAuthenticatedError extends Error {}
export class GmailDependencyMissingError extends Error {}

const agora = () => Date.now() / 1000;

export async function credentials_file_exists(): Promise<boolean> {
  try { return !!(await lerConfig(CHAVE_CREDENCIAIS)).trim(); } catch { return false; }
}
export async function token_file_exists(): Promise<boolean> {
  try { return !!(await lerConfig(CHAVE_TOKEN)).trim(); } catch { return false; }
}

async function _read_token(): Promise<Record<string, any>> {
  try { return JSON.parse(await lerConfig(CHAVE_TOKEN)); } catch (e) {
    console.warn(`gmail_integration: falha ao ler gmail_token.json: ${e}`);
    return {};
  }
}
async function _write_token(dados: Record<string, any>) {
  await gravarConfig(CHAVE_TOKEN, JSON.stringify(dados, null, 2));
}

export async function get_gmail_status(): Promise<Record<string, any>> {
  const creds_ok = await credentials_file_exists();
  const token_ok = await token_file_exists();
  let token_valid = false;
  if (token_ok) {
    try {
      const t = await _read_token();
      const tem_access = !!t.access_token;
      const ainda_valido = Number(t.expires_at ?? 0) > agora();
      const tem_refresh = !!t.refresh_token;
      token_valid = tem_access && (ainda_valido || tem_refresh);
    } catch { token_valid = false; }
  }
  return {
    credentials_found: creds_ok, token_found: token_ok, token_valid,
    libs_installed: true, libs_error: null, auth_method: "REST OAuth manual",
    credentials_path: CREDENTIALS_PATH, token_path: TOKEN_PATH,
  };
}

async function _load_client_config(): Promise<{ client_id: string; client_secret: string }> {
  const bruto = (await lerConfig(CHAVE_CREDENCIAIS)).trim();
  if (!bruto) throw new GmailCredentialsNotFoundError(MSG_CREDENCIAIS_NAO_ENCONTRADAS);
  let data: any;
  try { data = JSON.parse(bruto); } catch (e: any) {
    throw new GmailCredentialsNotFoundError(`Falha ao ler config/gmail_credentials.json: ${e.message ?? e}`);
  }
  const section = data?.installed || data?.web;
  if (!section) throw new GmailCredentialsNotFoundError("config/gmail_credentials.json nao possui a estrutura esperada ('installed' ou 'web').");
  if (!section.client_id || !section.client_secret) throw new GmailCredentialsNotFoundError("config/gmail_credentials.json nao contem client_id/client_secret.");
  return { client_id: section.client_id, client_secret: section.client_secret };
}

async function _post_form(url: string, fields: Record<string, string>): Promise<Record<string, any>> {
  let resp: Response;
  try {
    resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(30000) });
  } catch (e: any) {
    throw new GmailNotAuthenticatedError(`Falha de conexao com o Google: ${e.message ?? e}`);
  }
  const texto = await resp.text();
  if (!resp.ok) throw new GmailNotAuthenticatedError(`Erro ao comunicar com o Google (${resp.status}): ${texto}`);
  return JSON.parse(texto);
}

/** Início do fluxo OAuth (web): devolve a URL de consentimento do Google.
 *  `redirect_uri` é a rota de retorno do ERP (deve estar cadastrada no Google Cloud). */
export async function authenticate_gmail(redirect_uri: string, state = ""): Promise<string> {
  const cfg = await _load_client_config();
  const params = new URLSearchParams({
    client_id: cfg.client_id, redirect_uri, response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent",
  });
  if (state) params.set("state", state);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Retorno do Google: troca o code pelo token e grava (equivale ao fim de authenticate_gmail). */
export async function concluir_autenticacao_gmail(code: string | null, error: string | null, redirect_uri: string): Promise<boolean> {
  if (error) throw new GmailNotAuthenticatedError(`Falha na autenticacao do Gmail: ${error}`);
  if (!code) throw new GmailNotAuthenticatedError("Nenhum codigo de autorizacao foi recebido (tempo esgotado ou janela fechada). Tente novamente.");
  const cfg = await _load_client_config();
  const response = await _post_form(TOKEN_ENDPOINT, {
    code, client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri, grant_type: "authorization_code",
  });
  if (!("access_token" in response)) throw new GmailNotAuthenticatedError(`O Google nao retornou um access_token valido: ${JSON.stringify(response)}`);
  response.expires_at = agora() + Number(response.expires_in ?? 3600) - 60;
  await _write_token(response);
  return true;
}

export async function _get_valid_access_token(): Promise<string> {
  if (!(await token_file_exists())) {
    throw new GmailNotAuthenticatedError('Gmail ainda nao autenticado. Acesse Configuracoes e clique em "Autenticar Gmail" antes de criar rascunhos.');
  }
  const t = await _read_token();
  const access_token = t.access_token;
  const expires_at = Number(t.expires_at ?? 0);
  if (access_token && expires_at > agora()) return access_token;
  const refresh_token = t.refresh_token;
  if (!refresh_token) throw new GmailNotAuthenticatedError("Token do Gmail expirado e sem refresh_token. Autentique novamente em Configuracoes.");
  const cfg = await _load_client_config();
  const response = await _post_form(TOKEN_ENDPOINT, {
    client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token, grant_type: "refresh_token",
  });
  const novo = response.access_token;
  if (!novo) throw new GmailNotAuthenticatedError("Falha ao renovar o token do Gmail. Autentique novamente em Configuracoes.");
  response.refresh_token = response.refresh_token || refresh_token;
  response.expires_at = agora() + Number(response.expires_in ?? 3600) - 60;
  await _write_token(response);
  return novo;
}

export async function get_gmail_service(): Promise<boolean> {
  if (!(await credentials_file_exists())) throw new GmailCredentialsNotFoundError(MSG_CREDENCIAIS_NAO_ENCONTRADAS);
  await _get_valid_access_token();
  return true;
}

/** Mensagem MIME (To, Subject, text/plain utf-8) em base64url sem "=", como o EmailMessage do Python. */
function montarRaw(to: string, subject: string, body: string): string {
  const assunto = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?utf-8?b?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  let corpo = body.replace(/\r\n|\r/g, "\n");
  if (!corpo.endsWith("\n")) corpo += "\n";
  const ascii = /^[\x00-\x7f]*$/.test(corpo);
  const linhas = [
    `To: ${to}`, `Subject: ${assunto}`, 'Content-Type: text/plain; charset="utf-8"',
    `Content-Transfer-Encoding: ${ascii ? "7bit" : "base64"}`, "MIME-Version: 1.0", "",
    ascii ? corpo : (Buffer.from(corpo, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\n") + "\n",
  ];
  return Buffer.from(linhas.join("\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function _post_json(url: string, token: string, payload: any, erroHttp: string, erroConexao: string): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  } catch (e: any) {
    throw new GmailNotAuthenticatedError(`${erroConexao}: ${e.message ?? e}`);
  }
  const texto = await resp.text();
  if (!resp.ok) throw new GmailNotAuthenticatedError(`${erroHttp} (${resp.status}): ${texto}`);
  return JSON.parse(texto);
}

export async function create_gmail_draft(to_email: string, subject: string, body: string): Promise<string> {
  to_email = (to_email || "").trim();
  if (!to_email) throw new Error("E-mail do destinatario e obrigatorio.");
  const token = await _get_valid_access_token();
  const raw = montarRaw(to_email, subject || "", body || "");
  const draft = await _post_json(DRAFTS_ENDPOINT, token, { message: { raw } }, "Erro ao criar rascunho no Gmail", "Falha de conexao com o Gmail");
  return draft.id ?? "";
}

export async function send_gmail_message(to_email: string, subject: string, body: string): Promise<string> {
  to_email = (to_email || "").trim();
  if (!to_email) throw new Error("E-mail do destinatario e obrigatorio.");
  const token = await _get_valid_access_token();
  const raw = montarRaw(to_email, subject || "", body || "");
  const sent = await _post_json(SEND_ENDPOINT, token, { raw }, "Erro ao enviar e-mail pelo Gmail", "Falha de conexao com o Gmail");
  return sent.id ?? "";
}
