/**
 * Empresa (somente os módulos) e Módulo em construção — layout do Fernando
 * (cópias fiéis de templates/portal/empresa.html e modulo.html).
 * Só apresentação: empresa, tema, usuário, módulos liberados e endereços chegam por props.
 */
import Link from "next/link";

import { Ic } from "./ic";
import type { Tema } from "./portal-data";
import { PortalShell, type PortalLinks, type PortalUser } from "./portal-shell";

export type EmpresaInfo = { nome: string; logo: string };
export type ModuloCard = { id: string; nome: string; icone: string; desc: string; status: "ativo" | "construcao"; href: string };

type Base = {
  t: Tema; user: PortalUser; links: PortalLinks; empresa: EmpresaInfo;
  /** Atalhos extras na barra superior da empresa (ex.: cronômetro, Demandas, Chamados). */
  tbExtra?: React.ReactNode;
};

function Marca({ empresa }: { empresa: EmpresaInfo }) {
  return (
    <>
      <span className="logo-circle xs">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/portal/logos/${empresa.logo}`} alt="" />
      </span>
      <span className="tb-name"><b>{empresa.nome}</b><small>Grupo Capuzzo</small></span>
    </>
  );
}

export function PortalEmpresaView({ t, user, links, empresa, modulos, tbExtra }: Base & { modulos: ModuloCard[] }) {
  return (
    <PortalShell
      t={t}
      user={user}
      links={links}
      brand={<Marca empresa={empresa} />}
      tbLinks={<><Link className="tb-btn" href={links.grupo}><Ic nome="apps" /><span className="lbl">Empresas</span></Link>{tbExtra}</>}
    >
      <section className="emp-head">
        <span className="logo-square">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/portal/logos/${empresa.logo}`} alt={empresa.nome} />
        </span>
        <div>
          <div className="eyebrow-line">Módulos</div>
          <h1>{empresa.nome}</h1>
          <p>{modulos.length ? "Selecione o módulo que deseja acessar." : "Os módulos desta empresa aparecerão aqui conforme forem liberados."}</p>
        </div>
      </section>

      {!modulos.length ? (
        <div className="empty">
          <div className="empty-ic"><Ic nome="grid_view" /></div>
          <h3>Nenhum módulo disponível ainda</h3>
          <p>Assim que o primeiro módulo da {empresa.nome} for publicado, ele aparecerá aqui com o botão de acesso.</p>
        </div>
      ) : (
        <div className="mods">
          {modulos.map((m) => (
            <article key={m.id} className={`mod ${m.status === "ativo" ? "mod-on" : ""}`}>
              <div className="mod-ic"><Ic nome={m.icone} /></div>
              <h3>{m.nome}</h3>
              <p>{m.desc}</p>
              <div className="mod-foot">
                {m.status === "ativo" ? <span className="tag tag-on">Disponível</span> : <span className="tag">Em construção</span>}
                <Link className="btn-pill" href={m.href}>Acessar</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </PortalShell>
  );
}

/** `aviso` substitui o texto padrão "Módulo em construção" (ex.: módulo que depende de outra integração). */
export function PortalModuloView({ t, user, links, empresa, empresaHref, modulos, atual, aviso, tbExtra }: Base & { empresaHref: string; modulos: ModuloCard[]; atual: ModuloCard; aviso?: { titulo: string; texto: string } }) {
  return (
    <PortalShell
      t={t}
      user={user}
      links={links}
      brand={<Marca empresa={empresa} />}
      tbLinks={
        <>
          <Link className="tb-btn" href={empresaHref}><Ic nome="grid_view" /><span className="lbl">Módulos</span></Link>
          <Link className="tb-btn" href={links.grupo}><Ic nome="apps" /><span className="lbl">Empresas</span></Link>
          {tbExtra}
        </>
      }
    >
      <div className="mod-layout">
        <aside className="side">
          <div className="side-title">Módulos</div>
          {modulos.map((m) => (
            <Link key={m.id} className={`side-link ${m.id === atual.id ? "on" : ""}`} href={m.href}>
              <Ic nome={m.icone} />
              {m.nome}
            </Link>
          ))}
          <div className="side-sep" />
          <Link className="side-link" href={empresaHref}><Ic nome="arrow_back" />Voltar aos módulos</Link>
        </aside>
        <section className="mod-main">
          <div className="banner">
            <div className="txt"><small>{empresa.nome}</small><h1>{atual.nome}</h1><p>{atual.desc}</p></div>
          </div>
          <div className="empty">
            <div className="empty-ic"><Ic nome={atual.icone} /></div>
            <h3>{aviso?.titulo ?? "Módulo em construção"}</h3>
            <p>{aviso?.texto ?? `As informações de ${atual.nome.toLowerCase()} da ${empresa.nome} aparecerão aqui assim que o módulo for publicado.`}</p>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}
