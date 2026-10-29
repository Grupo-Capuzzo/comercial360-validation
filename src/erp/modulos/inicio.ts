/* eslint-disable @typescript-eslint/no-explicit-any */
// Área inicial do portal (depois do login): resumo de chamados e demandas por empresa,
// rotina do dia (demandas + agenda Google/Outlook do usuário) e Treinamentos (POPs e arquivos).
import {
  PyDate, abort, flash, g, get, post, q, q1, redirect, render_template, request, run, sendFile, url_for,
} from "../core/flask";
import { apagarArquivo, lerArquivo, salvarArquivo } from "../core/arquivos";
import { baixarIcs, compromissosDoDia, limparCacheIcs, urlIcsValida } from "../core/ics";
import { TEMA_GRUPO, checar_csrf, empresas_visiveis, exige_admin } from "./portal";

/** As 3 etapas de treinamento de cada empresa (coluna "categoria" da tabela). */
export const ETAPAS: [string, string, string][] = [
  ["pop", "POPs", "Procedimentos operacionais padrão da empresa."],
  ["curso", "Cursos básicos", "Conteúdos para começar a operar na empresa."],
  ["ferramenta", "Ferramentas", "Sistemas, planilhas e acessos usados no dia a dia."],
];
const ETAPA_NOMES: Record<string, string> = Object.fromEntries(ETAPAS.map(([k, n]) => [k, n]));
/** Conteúdos antigos (POP/Vídeo/Documento/Link) caem na etapa correspondente. */
function etapa_de(cat: string) { return ETAPA_NOMES[cat] ? cat : cat === "link" ? "ferramenta" : "curso"; }
function formato_de(t: any): string {
  if (/^video\//.test(t.arquivo_tipo ?? "") || /youtube\.com|youtu\.be|vimeo\.com|loom\.com/i.test(t.link ?? "")) return "video";
  if (t.arquivo_nome) return "arquivo";
  return t.link ? "link" : "arquivo";
}
const MAX_ARQUIVO = 20 * 1024 * 1024; // 20 MB (vídeos grandes: use um link do YouTube/Drive)
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function agora() { return PyDate.now().isoformat("T"); }
function data_extenso(d: PyDate) {
  return `${DIAS_SEMANA[(d.weekday() + 1) % 7]}, ${d.day} de ${MESES[d.month - 1]} de ${d.year}`;
}
function data_br(iso: string) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; }
function tamanho(n: number) { return n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }

/** Empresas que o usuário vê, com os contadores de chamados e demandas. */
async function resumo_empresas(user: any) {
  const empresas = (await empresas_visiveis(user)).filter((e) => e.status !== "inativo" || user.admin);
  const slugs = empresas.map((e) => e.slug);
  if (!slugs.length) return { empresas: [], tot: { chamados: 0, atendimento: 0, atrasadas: 0, hoje: 0 } };
  const hoje = PyDate.today().isoformat();
  const marc = slugs.map(() => "?").join(",");
  const filtroResp = user.admin ? "" : " AND responsavel_id = ?";
  const [tarefas, chamados] = await Promise.all([q(
    `SELECT empresa_slug, SUM(CASE WHEN vencimento <> '' AND vencimento < ? THEN 1 ELSE 0 END) AS atrasadas, ` +
    `SUM(CASE WHEN vencimento = ? THEN 1 ELSE 0 END) AS hoje FROM operacao_tarefas ` +
    `WHERE status <> 'concluida' AND empresa_slug IN (${marc})${filtroResp} GROUP BY empresa_slug`,
    [hoje, hoje, ...slugs, ...(user.admin ? [] : [user.id])]),
  q(
    `SELECT empresa_slug, SUM(CASE WHEN status = 'aberto' THEN 1 ELSE 0 END) AS abertos, ` +
    `SUM(CASE WHEN status = 'atendimento' THEN 1 ELSE 0 END) AS atendimento FROM operacao_chamados ` +
    `WHERE status <> 'concluido' AND empresa_slug IN (${marc}) GROUP BY empresa_slug`, slugs)]);
  const t = Object.fromEntries(tarefas.map((r) => [r.empresa_slug, r]));
  const c = Object.fromEntries(chamados.map((r) => [r.empresa_slug, r]));
  const tot = { chamados: 0, atendimento: 0, atrasadas: 0, hoje: 0 };
  const lista = empresas.map((e) => {
    const x = {
      ...e,
      chamados: Number(c[e.slug]?.abertos ?? 0) + Number(c[e.slug]?.atendimento ?? 0),
      atendimento: Number(c[e.slug]?.atendimento ?? 0),
      atrasadas: Number(t[e.slug]?.atrasadas ?? 0),
      hoje: Number(t[e.slug]?.hoje ?? 0),
    };
    tot.chamados += x.chamados; tot.atendimento += x.atendimento; tot.atrasadas += x.atrasadas; tot.hoje += x.hoje;
    return x;
  });
  // quem tem mais pendência primeiro; depois a ordem do portal
  lista.sort((a, b) => (b.atrasadas - a.atrasadas) || (b.chamados + b.hoje - a.chamados - a.hoje) || 0);
  return { empresas: lista, tot };
}

/** Demandas do próprio usuário: atrasadas e de hoje (rotina). */
async function minhas_demandas(user: any, slugs: string[]) {
  if (!slugs.length) return [];
  const hoje = PyDate.today().isoformat();
  const linhas = await q(
    `SELECT id, empresa_slug, titulo, prioridade, vencimento, status FROM operacao_tarefas ` +
    `WHERE responsavel_id = ? AND status <> 'concluida' AND vencimento <> '' AND vencimento <= ? ` +
    `AND empresa_slug IN (${slugs.map(() => "?").join(",")}) ORDER BY vencimento, CASE prioridade WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id`,
    [user.id, hoje, ...slugs]);
  return linhas.map((r) => ({ ...r, atrasada: r.vencimento < hoje, venc_br: data_br(r.vencimento) }));
}

async function agenda_do_usuario(uid: number) {
  const r = await q1("SELECT ics_url FROM portal_agendas WHERE usuario_id = ?", [uid]);
  if (!r) return { conectada: false, itens: [], erro: null as string | null, amanha: [] as any[] };
  try {
    const txt = await baixarIcs(r.ics_url);
    const hoje = PyDate.today();
    return { conectada: true, itens: compromissosDoDia(txt, hoje.isoformat()), amanha: compromissosDoDia(txt, hoje.addDays(1).isoformat()), erro: null };
  } catch (e: any) {
    return { conectada: true, itens: [], amanha: [], erro: e?.name === "AbortError" ? "A agenda demorou para responder." : (e?.message || "Não foi possível ler a agenda.") };
  }
}

async function treinamentos_visiveis(user: any, slugs: string[]) {
  const linhas = await q("SELECT id, empresa_slug, categoria, titulo, descricao, link, arquivo_nome, arquivo_tamanho, criado_em, ativo FROM portal_treinamentos WHERE ativo = 1 ORDER BY criado_em DESC, id DESC");
  return linhas.filter((t) => !t.empresa_slug || user.admin || slugs.includes(t.empresa_slug));
}

export function registrar() {
  // ── Início ──
  get("portal_inicio", "/inicio", async () => {
    const user = g().portal_user;
    const { empresas, tot } = await resumo_empresas(user);
    const slugs = empresas.map((e: any) => e.slug);
    const [demandas, agenda, trein] = await Promise.all([minhas_demandas(user, slugs), agenda_do_usuario(user.id), treinamentos_visiveis(user, slugs)]);
    const n_trein = trein.length;
    return render_template("portal/inicio.html", {
      t: TEMA_GRUPO, empresas, tot, demandas, agenda, n_trein,
      hoje_extenso: data_extenso(PyDate.today()),
      saudacao: PyDate.now().hour < 12 ? "Bom dia" : PyDate.now().hour < 18 ? "Boa tarde" : "Boa noite",
    });
  });

  post("portal_agenda", "/inicio/agenda", async () => {
    checar_csrf();
    const uid = g().portal_user.id;
    const f = request().form;
    if (f.get("acao") === "remover") {
      const r = await q1("SELECT ics_url FROM portal_agendas WHERE usuario_id = ?", [uid]);
      if (r) limparCacheIcs(r.ics_url);
      await run("DELETE FROM portal_agendas WHERE usuario_id = ?", [uid]);
      flash("Agenda desconectada.", "ok");
      return redirect(url_for("portal_inicio"));
    }
    const url = (f.get("ics_url") ?? "").trim();
    if (!urlIcsValida(url)) {
      flash("Cole o endereço secreto da agenda (formato iCal/.ics) do Google Agenda ou do Outlook.", "erro");
      return redirect(url_for("portal_inicio") + "#agenda");
    }
    try {
      limparCacheIcs(url);
      await baixarIcs(url);
    } catch (e: any) {
      flash(`Não consegui ler essa agenda: ${e?.message || "erro desconhecido"}`, "erro");
      return redirect(url_for("portal_inicio") + "#agenda");
    }
    await run("INSERT INTO portal_agendas (usuario_id, ics_url, atualizado_em) VALUES (?, ?, ?) ON CONFLICT (usuario_id) DO UPDATE SET ics_url = excluded.ics_url, atualizado_em = excluded.atualizado_em", [uid, url, agora()]);
    flash("Agenda conectada.", "ok");
    return redirect(url_for("portal_inicio") + "#agenda");
  });

  // ── Treinamentos: empresas → 3 etapas (POPs, Cursos básicos, Ferramentas) ──
  async function empresas_do_operador(user: any) {
    return (await empresas_visiveis(user)).filter((e) => e.status !== "inativo" || user.admin);
  }
  function enfeitar(t: any) {
    return { ...t, etapa: etapa_de(t.categoria), formato: formato_de(t), data: data_br(t.criado_em), tam: t.arquivo_tamanho ? tamanho(t.arquivo_tamanho) : "" };
  }

  get("portal_treinamentos", "/treinamentos", async () => {
    const user = g().portal_user;
    const empresas = await empresas_do_operador(user);
    const slugs = empresas.map((e) => e.slug);
    const itens = (await treinamentos_visiveis(user, slugs)).map(enfeitar);
    const cards = empresas.map((e) => {
      const deles = itens.filter((t) => !t.empresa_slug || t.empresa_slug === e.slug);
      return { ...e, total: deles.length, por_etapa: Object.fromEntries(ETAPAS.map(([k]) => [k, deles.filter((t) => t.etapa === k).length])) };
    });
    return render_template("portal/treinamentos.html", { t: TEMA_GRUPO, empresas: cards, ETAPAS });
  });

  get("portal_treinamentos_empresa", "/treinamentos/<slug>", async (slug: string) => {
    const user = g().portal_user;
    const empresas = await empresas_do_operador(user);
    const e = empresas.find((x) => x.slug === slug);
    if (!e) abort(empresas.length ? 403 : 404);
    const itens = (await treinamentos_visiveis(user, [slug])).filter((t) => !t.empresa_slug || t.empresa_slug === slug).map(enfeitar);
    const etapas = ETAPAS.map(([k, nome, desc], i) => ({ id: k, n: i + 1, nome, desc, itens: itens.filter((t) => t.etapa === k) }));
    const sel = request().args.get("t", null, "int");
    const editar = sel ? itens.find((x) => x.id === sel) ?? null : null;
    return render_template("portal/treinamentos_empresa.html", {
      t: e.tema_full, empresa: e, empresas, etapas, ETAPAS, editar,
      aba: editar ? editar.etapa : request().args.get("etapa", "pop"), max_mb: MAX_ARQUIVO / 1048576,
    });
  });

  post("portal_treinamento_salvar", "/treinamentos/salvar", async () => {
    exige_admin();
    checar_csrf();
    const f = request().form;
    const id = f.get("id", null, "int");
    const titulo = (f.get("titulo") ?? "").trim().slice(0, 160);
    const categoria = ETAPA_NOMES[f.get("categoria")] ? f.get("categoria") : "pop";
    const empresa = f.get("empresa_slug") ?? "";
    const descricao = (f.get("descricao") ?? "").trim().slice(0, 2000);
    const link = (f.get("link") ?? "").trim();
    const arq = request().file("arquivo");
    const origem = f.get("origem") ?? "";
    const pagina = (extra: Record<string, any> = {}) => (origem ? url_for("portal_treinamentos_empresa", { slug: origem, ...extra }) : url_for("portal_treinamentos"));
    const voltar = id ? pagina({ t: id }) : pagina({ etapa: categoria });
    if (!titulo) { flash("Informe o título.", "erro"); return redirect(voltar); }
    if (link && !/^https?:\/\//i.test(link)) { flash("O link precisa começar com http:// ou https://.", "erro"); return redirect(voltar); }
    if (arq && arq.filename && arq.size > MAX_ARQUIVO) { flash(`Arquivo maior que ${MAX_ARQUIVO / 1048576} MB. Para vídeos, use um link (YouTube, Google Drive...).`, "erro"); return redirect(voltar); }
    let tid = id;
    if (id) {
      await run("UPDATE portal_treinamentos SET titulo = ?, categoria = ?, empresa_slug = ?, descricao = ?, link = ? WHERE id = ?", [titulo, categoria, empresa, descricao, link, id]);
    } else {
      tid = (await run("INSERT INTO portal_treinamentos (empresa_slug, categoria, titulo, descricao, link, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [empresa, categoria, titulo, descricao, link, g().portal_user.nome, agora()])).lastrowid;
    }
    if (arq && arq.filename) {
      const caminho = `treinamentos/${tid}`;
      await salvarArquivo(caminho, arq.read(), arq.mimetype || "application/octet-stream");
      await run("UPDATE portal_treinamentos SET arquivo_caminho = ?, arquivo_nome = ?, arquivo_tipo = ?, arquivo_tamanho = ? WHERE id = ?",
        [caminho, arq.filename, arq.mimetype || "application/octet-stream", arq.size, tid]);
    } else if (f.get("remover_arquivo")) {
      await apagarArquivo(`treinamentos/${tid}`);
      await run("UPDATE portal_treinamentos SET arquivo_caminho = '', arquivo_nome = '', arquivo_tipo = '', arquivo_tamanho = 0 WHERE id = ?", [tid]);
    }
    flash(id ? "Conteúdo atualizado." : "Conteúdo publicado.", "ok");
    return redirect(pagina({ etapa: categoria }));
  });

  post("portal_treinamento_excluir", "/treinamentos/<int:tid>/excluir", async (tid: number) => {
    exige_admin();
    checar_csrf();
    await apagarArquivo(`treinamentos/${tid}`);
    const t = await q1("SELECT categoria FROM portal_treinamentos WHERE id = ?", [tid]);
    await run("DELETE FROM portal_treinamentos WHERE id = ?", [tid]);
    flash("Conteúdo excluído.", "ok");
    const origem = request().form.get("origem") ?? "";
    return redirect(origem ? url_for("portal_treinamentos_empresa", { slug: origem, etapa: t ? etapa_de(t.categoria) : "pop" }) : url_for("portal_treinamentos"));
  });

  get("portal_treinamento_arquivo", "/treinamentos/<int:tid>/arquivo", async (tid: number) => {
    const user = g().portal_user;
    const t = await q1("SELECT * FROM portal_treinamentos WHERE id = ? AND ativo = 1", [tid]);
    if (!t || !t.arquivo_caminho) abort(404);
    if (t.empresa_slug && !user.admin) {
      const slugs = (await empresas_visiveis(user)).map((e) => e.slug);
      if (!slugs.includes(t.empresa_slug)) abort(403);
    }
    const dados = await lerArquivo(t.arquivo_caminho);
    if (!dados) abort(404);
    const inline = /^(application\/pdf|image\/|video\/)/.test(t.arquivo_tipo ?? "");
    return sendFile(dados, { download_name: t.arquivo_nome, mimetype: t.arquivo_tipo || "application/octet-stream", as_attachment: !inline });
  });
}
