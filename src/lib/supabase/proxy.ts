import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseConfig } from "@/lib/supabase/config";
import { diagnosticoAssessoria } from "@/erp/core/diagnostico-assessoria";

export async function updateSession(request: NextRequest) {
  // Independent proxy trace: do not forward cookies/tokens or alter the SSR auth flow.
  const path = request.nextUrl.pathname;
  const diagnostico = diagnosticoAssessoria(path.startsWith("/erp/") ? path.slice(4) : "");
  diagnostico?.etapa("proxy.inicio");
  const concluir = (response: NextResponse) => {
    diagnostico?.etapa("proxy.fim");
    return response;
  };
  if (["/forgot-password", "/reset-password"].includes(request.nextUrl.pathname)) {
    const response = NextResponse.next({ request });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  // Exact public intake boundary. No CRM/customer/output endpoints are public.
  if (["/contato", "/api/comercial/input", "/api/comercial/catalogo"].includes(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    supabaseConfig.url,
    supabaseConfig.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    },
  );

  diagnostico?.etapa("proxy.auth.inicio");
  const result = await supabase.auth.getClaims().catch((error: unknown) => {
    diagnostico?.etapa("proxy.auth.erro");
    throw error;
  });
  diagnostico?.etapa("proxy.auth.fim");
  const { data } = result;
  const claims = data?.claims;

  if (
    !claims &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return concluir(NextResponse.json({ code: "session_required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } }));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return concluir(NextResponse.redirect(url));
  }

  return concluir(supabaseResponse);
}
