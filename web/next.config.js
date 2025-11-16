/** @type {import('next').NextConfig} */
const nextConfig = {
  // Removido 'output: export' para permitir SSR/ISR via plugin do Netlify
  // Se usar <Image> com domínios externos, configure images.domains aqui.
  // images: { domains: ["exemplo.com"] },
};

module.exports = nextConfig;
