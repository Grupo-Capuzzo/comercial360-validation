/**
 * Portal do Grupo Capuzzo — LAYOUT (responsabilidade: Fernando).
 * Componentes só de apresentação, sem Supabase. A autenticação, permissões e dados
 * (responsabilidade: Bia) entram pelas props. Ver README.md desta pasta.
 */
export { PortalShell, type PortalLinks, type PortalUser } from "./portal-shell";
export { PortalLoginView, type AcaoLogin, type EstadoLogin, type MarcaLogin } from "./login-view";
export { PortalGrupoView, type EmpresaCard, type GrupoViewProps } from "./grupo-view";
export { PortalEmpresaView, PortalModuloView, type EmpresaInfo, type ModuloCard } from "./empresa-view";
export { EMPRESAS, STATUS, TEMA_GRUPO, tema, modulosDaEmpresa, type Empresa, type Modulo, type StatusEmpresa, type Tema } from "./portal-data";
export { Ic } from "./ic";
