// Login e páginas públicas do ERP (o proxy da Bia libera caminhos que começam com /login).
import { atender } from "@/erp/registro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = atender;
export const POST = atender;
export const HEAD = atender;
export const PUT = atender;
export const DELETE = atender;
export const PATCH = atender;
