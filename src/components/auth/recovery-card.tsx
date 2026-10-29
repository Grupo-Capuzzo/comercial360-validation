import type { ReactNode } from "react";

export const authInputStyle = {
  width: "100%", boxSizing: "border-box" as const, padding: "14px 16px",
  border: "1px solid #d8dee8", borderRadius: "10px", margin: "8px 0 20px", fontSize: "16px",
};
export const authButtonStyle = {
  width: "100%", border: 0, borderRadius: "10px", padding: "14px 18px",
  background: "#c9a45c", color: "#1c1a16", fontWeight: 700, fontSize: "16px", cursor: "pointer",
};

export function RecoveryCard({ title, children }: { title: string; children: ReactNode }) {
  return <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f2ed", padding: "24px" }}>
    <section style={{ width: "100%", maxWidth: "420px", background: "white", borderRadius: "20px", padding: "40px", boxShadow: "0 20px 60px rgba(15,35,64,0.12)" }}>
      <h1 style={{ color: "#1c1a16", fontSize: "28px" }}>{title}</h1>
      {children}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- ERP is an HTML Route Handler and requires full navigation. */}
      <a href="/login-grupo" style={{ display: "block", marginTop: "24px", color: "#1c1a16" }}>Voltar ao login</a>
    </section>
  </main>;
}
