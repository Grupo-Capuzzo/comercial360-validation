/**
 * Estrutura do portal — cópia fiel de templates/portal/base.html do sistema local.
 */
import Link from "next/link";

import { Ic } from "./ic";
import { tema, type Tema } from "./portal-data";
import "./portal.css";

export type PortalUser = { nome: string; email: string; admin: boolean };

export type PortalLinks = {
  grupo: string;
  logout: string;
  senha?: string;
  plano?: string;
  admin?: string;
};

function varsDoTema(t: Tema): React.CSSProperties {
  return {
    "--primary": t.primary, "--secondary": t.secondary, "--accent": t.accent, "--accent-dark": t.accent_dark,
    "--on-primary": t.on_primary, "--on-accent": t.on_accent, "--bg": t.bg, "--surface": t.surface,
    "--text": t.text, "--muted": t.muted, "--font-head": `'${t.font_head}', 'Poppins', 'Segoe UI', sans-serif`,
    minHeight: "100vh",
  } as React.CSSProperties;
}

function LinkOuInerte({ href, className, children }: { href?: string; className: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>{children}</Link>
  ) : (
    <a className={className} aria-disabled="true" title="Em construção">{children}</a>
  );
}

type PortalShellProps = {
  t?: Tema;
  user?: PortalUser | null;
  links: PortalLinks;
  bodyClass?: string;
  /** Substitui a marca do Grupo (usado nas páginas de empresa). */
  brand?: React.ReactNode;
  /** Botões extras da barra superior (bloco tb_links do original). */
  tbLinks?: React.ReactNode;
  flashes?: { cat: string; msg: string }[];
  children: React.ReactNode;
};

export function PortalShell({ t = tema(), user, links, bodyClass = "", brand, tbLinks, flashes = [], children }: PortalShellProps) {
  const fonte = t.font_head.replace(/ /g, "+");
  return (
    <div className="portal-app" style={varsDoTema(t)}>
      <link
        rel="stylesheet"
        precedence="default"
        href={`https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=${fonte}:wght@300;400;600;700;800&display=swap`}
      />
      <div className={bodyClass}>
        {user && (
          <header className="topbar">
            <div className="topbar-in">
              <Link className="tb-brand" href={links.grupo}>
                {brand ?? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="brand" src="/portal/logos/grupo_word_light.png" alt="Grupo Capuzzo" />
                )}
              </Link>
              <nav className="tb-nav">
                {tbLinks}
                {user.admin && (
                  <>
                    {/* Plano de ação é uma página à parte (não é rota do app): link comum. */}
                    <a href={links.plano} className="tb-btn" aria-disabled={links.plano ? undefined : "true"}>
                      <Ic nome="checklist" />
                      <span className="lbl">Plano de ação</span>
                    </a>
                    <LinkOuInerte href={links.admin} className="tb-btn">
                      <Ic nome="admin_panel_settings" />
                      <span className="lbl">Administração</span>
                    </LinkOuInerte>
                  </>
                )}
                <details className="tb-user">
                  <summary>
                    <span className="who">
                      <b>{user.nome}</b>
                      <small>{user.admin ? "Administrador" : "Usuário"}</small>
                    </span>
                    <span className="avatar">{user.nome.slice(0, 1).toUpperCase()}</span>
                    <Ic nome="expand_more" />
                  </summary>
                  <div className="menu">
                    <div className="menu-mail">{user.email}</div>
                    <LinkOuInerte href={links.senha} className="">
                      <Ic nome="key" /> Alterar senha
                    </LinkOuInerte>
                    <a href={links.logout}>
                      <Ic nome="logout" /> Sair
                    </a>
                  </div>
                </details>
              </nav>
            </div>
          </header>
        )}
        <main className="wrap">
          {flashes.length > 0 && (
            <div className="flashes">
              {flashes.map((f) => (
                <div key={f.msg} className={`flash flash-${f.cat}`}>{f.msg}</div>
              ))}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
