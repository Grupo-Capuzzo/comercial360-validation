const nextConfig = {
  reactStrictMode: true,
  // One-time recovery codes must never appear in development request logs.
  logging: { incomingRequests: false, browserToTerminal: false },
  // Entrada do site = portal do Grupo (layout do Fernando, em /erp). O Comercial da Bia
  // continua em /comercial/<empresa>, aberto pelo módulo "Comercial" do portal.
  async redirects() {
    return [
      { source: "/", destination: "/erp/grupo", permanent: false },
      { source: "/portal", destination: "/erp/grupo", permanent: false },
      { source: "/portal/empresas/:empresa", destination: "/erp/grupo", permanent: false },
      { source: "/login", destination: "/login-grupo", permanent: false },
    ];
  },
};

export default nextConfig;
