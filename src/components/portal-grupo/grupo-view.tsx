"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Ic } from "./ic";
import { STATUS, type StatusEmpresa } from "./portal-data";
import { PortalShell, type PortalLinks, type PortalUser } from "./portal-shell";

/** Um card de empresa. `chave` é o identificador usado pela integração (empresa_id ou apelido). */
export type EmpresaCard = { chave: string; nome: string; descricao: string; logo: string; status: StatusEmpresa; obs: string; href: string };

export type GrupoViewProps = {
  user: PortalUser;
  links: PortalLinks;
  empresas: EmpresaCard[];
  favoritas?: string[];
  /** Grava o favorito (Supabase na produção). Sem ela, o coração só muda na tela. */
  onFavoritar?: (chave: string, favorita: boolean) => void | Promise<void>;
  /** Grava situação/observação (somente admin). Sem ela, o diálogo só fecha. */
  onSalvarConfig?: (chave: string, dados: { status: StatusEmpresa; obs: string }) => void | Promise<void>;
};

/**
 * Página inicial do Grupo — layout do Fernando (cópia fiel de templates/portal/grupo.html).
 * Só apresentação: as empresas, permissões e gravações chegam por props.
 */
export function PortalGrupoView(props: GrupoViewProps) {
  return (
    <PortalShell user={props.user} links={props.links}>
      <GrupoCards {...props} />
    </PortalShell>
  );
}

type Filtro = "todas" | "fav" | "ativo" | "pendente";

function GrupoCards({ empresas, favoritas = [], user, onFavoritar, onSalvarConfig }: GrupoViewProps) {
  const [favs, setFavs] = useState<string[]>(favoritas);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [config, setConfig] = useState<EmpresaCard | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const primeiroNome = user.nome.split(" ")[0];
  const ativas = empresas.filter((e) => e.status === "ativo").length;
  const pendentes = empresas.filter((e) => e.status === "pendente").length;

  // Mesma ordem do original: favoritas primeiro, depois a ordem padrão.
  const ordenadas = useMemo(() => {
    const ordem = new Map(empresas.map((e, i) => [e.chave, i]));
    return [...empresas].sort((a, b) => Number(!favs.includes(a.chave)) - Number(!favs.includes(b.chave)) || ordem.get(a.chave)! - ordem.get(b.chave)!);
  }, [empresas, favs]);

  const q = busca.trim().toLowerCase();
  const visivel = (e: EmpresaCard) =>
    (!q || e.nome.toLowerCase().includes(q)) && (filtro === "todas" || (filtro === "fav" ? favs.includes(e.chave) : e.status === filtro));
  const qtdVisiveis = ordenadas.filter(visivel).length;

  function abrirConfig(e: EmpresaCard) {
    setConfig(e);
    dlg.current?.showModal();
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow-line">Portal do Grupo Capuzzo</div>
          <h1>
            Olá, <b>{primeiroNome}</b>.
          </h1>
          <p>Escolha a empresa que deseja acessar.</p>
        </div>
        <div className="stats">
          <div className="stat dark"><b>{empresas.length}</b><span>Empresas</span></div>
          <div className="stat"><b>{ativas}</b><span>Ativas</span></div>
          <div className="stat"><b>{pendentes}</b><span>Pendentes</span></div>
        </div>
      </section>

      {!empresas.length ? (
        <div className="vazio">Nenhuma empresa liberada para o seu usuário. Fale com o administrador.</div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Ic nome="search" />
              <input id="busca" type="search" placeholder="Buscar empresa…" autoComplete="off" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
            <div className="chips" id="filtros">
              {([["todas", "Todas"], ["fav", "Favoritas"], ["ativo", "Ativas"], ["pendente", "Pendentes"]] as [Filtro, string][]).map(([f, rot]) => (
                <button key={f} type="button" className={`chip ${filtro === f ? "on" : ""}`} onClick={() => setFiltro(f)}>{rot}</button>
              ))}
            </div>
          </div>

          <div className="grid" id="grid">
            {ordenadas.map((e, i) => {
              const fav = favs.includes(e.chave);
              return (
                <FragmentoCard key={e.chave}>
                  {i === 1 && (
                    <article className="promo" id="promo" hidden={!(filtro === "todas" && !q)}>
                      <div className="slide"><small>Grupo Capuzzo</small><h4>Bem-vindo, <b>{primeiroNome}</b>.</h4>
                        <p>Selecione uma empresa para ver os módulos dela, com a identidade visual da própria marca.</p></div>
                      <div className="slide"><small>Visão do grupo</small><h4><b>{ativas}</b> empresas ativas</h4>
                        <p>{pendentes} com pendência no momento. Acompanhe a situação de cada uma pelos cartões.</p></div>
                      <div className="slide"><small>Dica</small><h4>Seus <b>favoritos</b> primeiro</h4>
                        <p>Toque no coração de um cartão para fixar a empresa no topo da lista.</p></div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="mark" src="/portal/logos/grupo_word_light.png" alt="" />
                      <div className="dots"><i /><i /><i /></div>
                    </article>
                  )}
                  <article className={`card st-${e.status}`} id={`emp-${e.chave}`} hidden={!visivel(e)}>
                    <header className="card-head">
                      <div className="status"><span className="bar" />
                        <div>
                          <b>{STATUS[e.status]}{e.status !== "ativo" && " *"}</b>
                          {e.status !== "ativo" && <small>* {e.obs || (e.status === "pendente" ? "Pendência" : "Acesso suspenso")}</small>}
                        </div>
                      </div>
                      <div className="head-actions">
                        <button
                          type="button"
                          className={`ico ${fav ? "fav-on" : ""}`}
                          title={fav ? "Remover dos favoritos" : "Favoritar"}
                          onClick={() => {
                            setFavs((f) => (fav ? f.filter((s) => s !== e.chave) : [...f, e.chave]));
                            void onFavoritar?.(e.chave, !fav);
                          }}
                        >
                          <Ic nome={fav ? "favorite" : "favorite_border"} />
                        </button>
                        {user.admin && (
                          <button className="ico" type="button" title="Configurar" onClick={() => abrirConfig(e)}>
                            <Ic nome="settings" />
                          </button>
                        )}
                      </div>
                    </header>
                    <div className="card-body">
                      <span className="logo-circle">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/portal/logos/${e.logo}`} alt={e.nome} />
                      </span>
                      <div><h3>{e.nome}</h3>{e.descricao && <p>{e.descricao}</p>}</div>
                    </div>
                    <footer className="card-foot">
                      {e.status === "inativo" && !user.admin ? (
                        <span className="btn-pill disabled">Acessar</span>
                      ) : (
                        <Link className={`btn-pill ${e.status !== "ativo" ? "outline" : ""}`} href={e.href}>Acessar</Link>
                      )}
                    </footer>
                  </article>
                </FragmentoCard>
              );
            })}
          </div>
          <div className="vazio" id="semres" hidden={qtdVisiveis > 0}>Nenhuma empresa encontrada com esse filtro.</div>

          {user.admin && (
            <dialog id="dlg-config" className="dlg" ref={dlg}>
              <form
                id="form-config"
                key={config?.chave}
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  if (config) void onSalvarConfig?.(config.chave, { status: f.get("status") as StatusEmpresa, obs: String(f.get("obs") ?? "") });
                  dlg.current?.close();
                }}
              >
                <div className="dlg-head"><h3>Configurar empresa</h3>
                  <button type="button" className="ico" onClick={() => dlg.current?.close()}><Ic nome="close" /></button></div>
                <div className="dlg-emp">
                  <span className="logo-circle">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {config && <img id="cfg-logo" src={`/portal/logos/${config.logo}`} alt="" />}
                  </span>
                  <b id="cfg-nome">{config?.nome}</b>
                </div>
                <label className="lbl">Situação</label>
                <select className="inp" name="status" id="cfg-status" defaultValue={config?.status}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="lbl">Observação da situação</label>
                <input className="inp" name="obs" id="cfg-obs" maxLength={120} placeholder="Ex.: Pendência financeira" defaultValue={config?.obs} />
                <p className="hint">Usuários com acesso a cada empresa são definidos em Administração.</p>
                <button className="btn-pill" type="submit">Salvar</button>
              </form>
            </dialog>
          )}
        </>
      )}
    </>
  );
}

function FragmentoCard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
