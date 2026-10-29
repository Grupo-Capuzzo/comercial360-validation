"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RecoveryCard, authInputStyle, authButtonStyle } from "@/components/auth/recovery-card";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { recoveryErrorMessage, validateRecoverySession } from "@/lib/supabase/password-recovery";

export default function ResetPasswordPage() {
  const validation = useRef<Promise<string> | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "saving">("checking");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    // Reuse the verification promise in React Strict Mode: codes are single-use.
    validation.current ??= (async () => {
      // Capture before constructing the SDK, and remove sensitive URL parameters.
      const recoveryUrl = new URL(window.location.href);
      window.history.replaceState(null, "", "/reset-password");
      return validateRecoverySession(getSupabaseBrowserClient(), recoveryUrl);
    })();
    validation.current.then(() => { if (active) setState("ready"); }).catch(error => {
      if (active) { setError(recoveryErrorMessage(error)); setState("invalid"); }
    });
    return () => { active = false; };
  }, []);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "ready") return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get("password") ?? "");
    if (password !== values.get("confirmation")) { setError("As senhas não coincidem."); return; }
    if (password.length < 8) { setError("Senha fraca. Use pelo menos 8 caracteres."); return; }
    setState("saving");
    setError("");
    try {
      const client = getSupabaseBrowserClient();
      const verified = await client.auth.getUser();
      if (verified.error) throw verified.error;
      if (!verified.data.user || verified.data.user.id !== await validation.current) {
        throw { name: "AuthSessionMissingError" };
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      form.reset();
      setCompleted(true);
      // Clear this browser's recovery session, without signing out CRM sessions.
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) {
        setError("Senha alterada com sucesso. Não foi possível encerrar a sessão; tente novamente abaixo.");
        return;
      }
      window.location.replace("/login-grupo?message=password-updated");
    } catch (error) {
      setError(recoveryErrorMessage(error));
      setState("ready");
    }
  }

  async function finishSignOut() {
    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/login-grupo?message=password-updated");
    } catch { setError("Senha alterada com sucesso. Erro de comunicação ao encerrar a sessão. Tente novamente."); }
  }

  return <RecoveryCard title="Definir nova senha">
    {state === "checking" && <p role="status">Validando o link de recuperação…</p>}
    {error && <p role="alert" style={{ color: "#a52a2a" }}>{error}</p>}
    {state === "invalid" && <a href="/forgot-password">Solicitar novo link</a>}
    {completed ? <button onClick={finishSignOut} style={authButtonStyle}>Voltar ao login</button> : (state === "ready" || state === "saving") && <form onSubmit={changePassword}>
      <label htmlFor="new-password">Nova senha</label>
      <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} disabled={state === "saving"} style={authInputStyle} />
      <label htmlFor="confirm-password">Confirmar nova senha</label>
      <input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" required minLength={8} disabled={state === "saving"} style={authInputStyle} />
      <button type="submit" disabled={state === "saving"} style={authButtonStyle}>{state === "saving" ? "Salvando…" : "Alterar senha"}</button>
    </form>}
  </RecoveryCard>;
}
