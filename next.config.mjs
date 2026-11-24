/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Etapa 6 (promoção em 2026-11-24): a raiz passa a servir o
      // Commander Center 2.0. O arquivo da home antiga foi movido
      // para /v1 (src/app/v1/page.tsx), então "/" não tem arquivo
      // próprio e este rewrite assume.
      { source: "/", destination: "/v2" },
      // A versão antiga segue alcançável em /v1 por 30 dias (até
      // 2026-12-24): as páginas de conta antigas continuam onde
      // sempre estiveram e ganham o endereço /v1/account/[slug].
      { source: "/v1/account/:slug", destination: "/account/:slug" },
    ];
  },
};
export default nextConfig;
