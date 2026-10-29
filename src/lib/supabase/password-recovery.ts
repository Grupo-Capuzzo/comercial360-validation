import type { SupabaseClient } from "@supabase/supabase-js";

export const passwordRecoveryRedirect =
  process.env.NEXT_PUBLIC_PASSWORD_RESET_REDIRECT_URL?.trim() ||
  (process.env.NODE_ENV === "production"
    ? "https://portal.grupocapuzzo.com.br/reset-password"
    : "http://localhost:3100/reset-password");

export function recoveryErrorMessage(error: unknown): string {
  const details = error as { code?: string; name?: string; status?: number };
  switch (details?.code) {
    case "otp_expired":
    case "flow_state_expired":
      return "O código de recuperação expirou. Solicite um novo link.";
    case "flow_state_not_found":
      return "O código de recuperação já foi utilizado ou não foi encontrado. Solicite um novo link.";
    case "weak_password":
      return "Senha fraca. Use uma senha mais longa, com letras, números e símbolos.";
    case "same_password":
      return "A nova senha deve ser diferente da senha atual.";
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "Sessão de recuperação inexistente ou expirada. Solicite um novo link.";
    case "pkce_code_verifier_not_found":
      return "Verificador de recuperação ausente. Solicite um novo link e abra-o no mesmo navegador e endereço usados na solicitação.";
    case "bad_code_verifier":
    case "validation_failed":
      return "Link de recuperação inválido ou expirado. Abra o link no mesmo navegador em que solicitou a recuperação.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Muitas solicitações. Aguarde alguns minutos antes de tentar novamente.";
  }
  if (details?.status === 0 || (details?.status ?? 0) >= 500 ||
      details?.name === "AuthRetryableFetchError" || error instanceof TypeError) {
    return "Erro de comunicação com o Supabase. Verifique sua conexão e tente novamente.";
  }
  if (details?.name === "AuthSessionMissingError") {
    return "Sessão de recuperação inexistente. Solicite um novo link.";
  }
  return "Não foi possível concluir a recuperação. Solicite um novo link ou tente novamente mais tarde.";
}

// One owner for code exchange. Keep fulfilled and rejected attempts to prevent
// duplicate consumption on Strict Mode, remounts and concurrent calls.
const exchanges = new WeakMap<SupabaseClient["auth"], Map<string, Promise<string>>>();

export function validateRecoverySession(client: Pick<SupabaseClient, "auth">, url: URL): Promise<string> {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const errorCode = url.searchParams.get("error_code") || fragment.get("error_code");
  if (errorCode || url.searchParams.has("error") || fragment.has("error")) {
    return Promise.reject({ code: errorCode || "validation_failed" });
  }
  const code = url.searchParams.get("code");
  if (!code) return Promise.reject({ name: "AuthSessionMissingError" });
  let attempts = exchanges.get(client.auth);
  if (!attempts) { attempts = new Map(); exchanges.set(client.auth, attempts); }
  const existing = attempts.get(code);
  if (existing) return existing;
  const pending = exchangeRecoveryCode(client, code, url.searchParams.get("sb_flow_id"));
  attempts.set(code, pending);
  return pending;
}

async function exchangeRecoveryCode(client: Pick<SupabaseClient, "auth">, code: string, flowId: string | null) {
  let recoveryReceived = false;
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    // No async Auth calls inside this callback: the SDK holds its session lock.
    if (event === "PASSWORD_RECOVERY" && session) recoveryReceived = true;
  });
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(
      code, flowId ? { flowId } : undefined,
    );
    if (error) throw error;
    if (!data.session || !data.user) throw { name: "AuthSessionMissingError" };
    // exchangeCodeForSession awaits its notification. No timer or init-event race.
    if (!recoveryReceived) throw { code: "validation_failed" };
    const verified = await client.auth.getUser();
    if (verified.error) throw verified.error;
    if (!verified.data.user || verified.data.user.id !== data.user.id) {
      throw { name: "AuthSessionMissingError" };
    }
    return verified.data.user.id;
  } finally {
    subscription.unsubscribe();
  }
}
