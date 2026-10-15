import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
};
export default config;
