/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace package (ships as TS source).
  transpilePackages: ["@clarifi/shared"],
};

export default nextConfig;
