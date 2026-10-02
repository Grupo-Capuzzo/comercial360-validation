import { redirect } from "next/navigation";
import { PortalError } from "@/services/portal.service";
export function AccessResult({ error }: { error: unknown }) {
  if (error instanceof PortalError && error.status === 401) redirect("/login");
  return <div role="alert" className="rounded-2xl border bg-white p-8"><h1 className="text-xl font-semibold">{error instanceof PortalError && error.status === 403 ? "Sem permissão para esta empresa ou módulo" : "Não foi possível consultar os dados"}</h1><p>O erro não representa saldo zero. Tente novamente ou solicite a verificação do acesso.</p></div>;
}
