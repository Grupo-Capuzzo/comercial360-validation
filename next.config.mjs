const nextConfig = {
  reactStrictMode: true,
  // Entrada do site = portal do Grupo (layout do Fernando, em /erp). O Comercial da Bia
  // continua em /comercial/<empresa>, aberto pelo módulo "Comercial" do portal.
  // CSS, JS e logos do ERP ficam guardados no navegador (evita buscar de novo a cada página).
  async headers() {
    return [
      {
        source: "/login-grupo/:dir(static|financas|operacao)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/", destination: "/erp/inicio", permanent: false },
      { source: "/portal", destination: "/erp/inicio", permanent: false },
      { source: "/portal/empresas/:empresa", destination: "/erp/grupo", permanent: false },
      { source: "/login", destination: "/login-grupo", permanent: false },
    ];
  },
};

export default nextConfig;
