"use client";

/**
 * Tela de login do Portal — layout do Fernando (cópia fiel de templates/portal/login.html).
 * Só apresentação: quem autentica é a ação recebida em `acao` (na produção, a da Bia com Supabase).
 * Campos enviados no FormData: `acesso` ("admin" | "usuario"), `email`, `password`.
 */
import { useActionState, useState } from "react";

import { Ic } from "./ic";
import { EMPRESAS } from "./portal-data";
import { PortalShell } from "./portal-shell";

export type EstadoLogin = { erro: string | null; email: string; acesso: "admin" | "usuario" };
export type AcaoLogin = (estado: EstadoLogin, form: FormData) => Promise<EstadoLogin>;
export type MarcaLogin = { chave: string; nome: string; logo: string };

const inicial: EstadoLogin = { erro: null, email: "", acesso: "usuario" };
const marcasPadrao: MarcaLogin[] = EMPRESAS.map((e) => ({ chave: e.slug, nome: e.nome, logo: e.logo }));

export function PortalLoginView({ acao, marcas = marcasPadrao, ano = new Date().getFullYear() }: { acao: AcaoLogin; marcas?: MarcaLogin[]; ano?: number }) {
  return (
    <PortalShell links={{ grupo: "#", logout: "#" }} bodyClass="page-login">
      <div className="login">
        <section className="cover">
          <div className="grain" />
          <div className="cover-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/portal/logos/grupo_ring_light.png" alt="Grupo Capuzzo" />
          </div>
          <div className="cover-mid">
            <div className="eyebrow-line">Portal corporativo</div>
            <h1>
              Gestão integrada de <strong>todas as empresas</strong> do grupo.
            </h1>
            <p className="lead">
              Finanças, indicadores e rotinas de cada empresa do Grupo Capuzzo reunidos em um só lugar, com a identidade de cada marca.
            </p>
            <div className="cover-brands">
              {marcas.map((e) => (
                <span className="logo-circle sm" key={e.chave}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/portal/logos/${e.logo}`} alt={e.nome} />
                </span>
              ))}
              <span className="cb-txt">{marcas.length} empresas conectadas</span>
            </div>
          </div>
          <div className="cover-foot">
            <span>© {ano} Grupo Capuzzo · Grupo Empresarial</span>
            <span>Acesso restrito</span>
          </div>
        </section>

        <section className="login-side">
          <LoginForm acao={acao} />
        </section>
      </div>
    </PortalShell>
  );
}

function LoginForm({ acao: acaoServidor }: { acao: AcaoLogin }) {
  const [estado, acao, enviando] = useActionState(acaoServidor, inicial);
  const [verSenha, setVerSenha] = useState(false);
  return (
    <form className="login-box" action={acao} autoComplete="on" key={estado.erro ?? "novo"}>
      <div className="eyebrow">Bem-vindo</div>
      <h2>Acesse sua conta</h2>
      <p className="sub">Entre com o e-mail e a senha cadastrados.</p>

      <label className="lbl">Tipo de acesso</label>
      <div className="seg">
        <input type="radio" id="ac-admin" name="acesso" value="admin" defaultChecked={estado.acesso === "admin"} />
        <label htmlFor="ac-admin">Administrador</label>
        <input type="radio" id="ac-user" name="acesso" value="usuario" defaultChecked={estado.acesso !== "admin"} />
        <label htmlFor="ac-user">Usuário</label>
      </div>

      <label className="lbl" htmlFor="email">E-mail</label>
      <input className="inp" id="email" name="email" type="email" defaultValue={estado.email} placeholder="nome@grupocapuzzo.com" required autoFocus />

      <label className="lbl" htmlFor="senha">Senha</label>
      <div className="pw">
        <input className="inp" id="senha" name="password" type={verSenha ? "text" : "password"} placeholder="Sua senha" required />
        <button type="button" className="pw-eye" aria-label="Mostrar senha" onClick={() => setVerSenha((v) => !v)}>
          <Ic nome="visibility" />
        </button>
      </div>

      {estado.erro && (
        <div className="alert">
          <Ic nome="error" />
          {estado.erro}
        </div>
      )}

      <button className="btn-gold" type="submit" disabled={enviando}>Entrar</button>
      <div className="login-help">Esqueceu a senha? Fale com o administrador do portal.</div>
      <div className="login-secure">
        <Ic nome="lock" /> Conexão protegida · senhas armazenadas com criptografia
      </div>
    </form>
  );
}
