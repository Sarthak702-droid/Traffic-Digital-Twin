import type { NextConfig } from "next";
const config: NextConfig = {
  async rewrites() {
    const origin = process.env.API_ORIGIN || "http://127.0.0.1:8081";
    return [
      { source: "/api/v1/:path*", destination: `${origin}/api/v1/:path*` },
      { source: "/ws/v1/live", destination: `${origin}/ws/v1/live` },
    ];
  },
};
export default config;
