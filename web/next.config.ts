import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim image for Railway/Docker: only the standalone server + static assets.
  output: "standalone",
};

export default nextConfig;
