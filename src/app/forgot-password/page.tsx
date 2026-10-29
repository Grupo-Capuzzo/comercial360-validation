"use client";

import { useState, type FormEvent } from "react";
import { RecoveryCard, authInputStyle, authButtonStyle } from "@/components/auth/recovery-card";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { passwordRecoveryRedirect, recoveryErrorMessage } from "@/lib/supabase/password-recovery";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    // PKCE stores its verifier in cookies: start on the same origin as the link.
    if (window.location.origin !== new URL(passwordRecoveryRedirect).origin) {
      setError("Abra a recuperação em " + new URL(passwordRecoveryRedirect).origin + "/forgot-password e solicite o link neste navegador.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
        redirectTo: passwordRecoveryRedirect,
      });
      if (error) throw error;
      setSent(true);
    } catch (error) {
      setError(recoveryErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return <RecoveryCard title="Recuperar senha">
    {sent ? <p role="status">Se houver uma conta para este email, você receberá um link de recuperação. Abra-o neste mesmo navegador.</p> : <>
      <p>Informe seu email para receber um link de recuperação de senha.</p>
      <form onSubmit={requestRecovery}>
        <label htmlFor="recovery-email">Email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" required disabled={pending} style={authInputStyle} />
        {error && <p role="alert" style={{ color: "#a52a2a" }}>{error}</p>}
        <button type="submit" disabled={pending} style={authButtonStyle}>{pending ? "Enviando…" : "Enviar link de recuperação"}</button>
      </form>
    </>}
  </RecoveryCard>;
}
