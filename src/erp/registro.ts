// Registra todos os módulos do ERP (uma vez por processo), na mesma ordem do Flask.
import { despachar } from "./core/app";
import * as portal from "./modulos/portal";
import * as inicio from "./modulos/inicio";
import * as flaskApp from "./base/flask_app";
import * as central from "./base/central_grupo";
import * as financas from "./modulos/financas/index";
import * as contratos from "./modulos/contratos/index";
import * as operacao from "./modulos/operacao/index";

const g = globalThis as unknown as { __erpRegistrado?: boolean };

export function registrarTudo() {
  if (g.__erpRegistrado) return;
  g.__erpRegistrado = true;
  flaskApp.registrar();   // rotas do app de Condomínios (flask_app.py)
  central.registrar();    // Plano de ação (central_grupo.py)
  portal.registrar();     // portal_grupo.py (login, empresas)
  inicio.registrar();     // área inicial e treinamentos (novo)
  contratos.registrar();  // modulos/contratos
  financas.registrar();   // modulos/financas
  operacao.registrar();   // modulos/operacao
}

export async function atender(req: Request): Promise<Response> {
  registrarTudo();
  return despachar(req);
}
