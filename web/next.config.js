/** @type {import('next').NextConfig} */
const nextConfig = {
  // Removido 'output: export' para permitir SSR/ISR.
  // Se usar <Image> com domínios externos, configure images.domains aqui.
  // images: { domains: ["exemplo.com"] },
};

export default nextConfig;
