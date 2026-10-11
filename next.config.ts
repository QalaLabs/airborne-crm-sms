import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // This app is its own standalone project — pin tracing to its own directory
  // so `.next/standalone/server.js` is flat (avoids the workspace-root warning
  // caused by the repo-root pnpm-lock.yaml) and the Docker COPY paths are stable.
  outputFileTracingRoot: path.join(__dirname),
  eslint: {
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["argon2", "@prisma/client", "prisma"],
  experimental: {
    middlewareClientMaxBodySize: "60mb",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.cloudflare.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
