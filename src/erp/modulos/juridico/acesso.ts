/** Authorization uses the existing server-side portal record, never user metadata. */
type Usuario = { ativo?: number; admin?: boolean; perfil?: string; modo_juridico?: boolean };
export function emVisaoJuridica(user: Usuario | null | undefined) {
  return !!user && (user.perfil === "juridico" || (user.perfil === "admin" && user.modo_juridico === true));
}
export function temAcessoJuridico(user: Usuario | null | undefined) {
  return !!user && user.ativo === 1 && (user.admin === true || emVisaoJuridica(user));
}
export function rotaDaVisaoJuridica(caminho: string) {
  return caminho === "/juridico" || caminho.startsWith("/juridico/") || caminho === "/grupo" ||
    /^\/grupo\/empresa\/[^/]+(?:\/modulo\/juridico)?$/.test(caminho) ||
    /^\/grupo\/favorito\/[^/]+$/.test(caminho) || caminho === "/grupo/visao-juridico" ||
    caminho === "/grupo/minha-senha" || caminho === "/logout" ||
    caminho === "/treinamentos" || caminho.startsWith("/treinamentos/");
}
