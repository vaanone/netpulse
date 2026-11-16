import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
  // Hide the Next.js devtools indicator (the "N" badge) in the bottom-left.
  devIndicators: false,
  // ssh2 ships native bindings / non-ECMAScript assets that Turbopack cannot
  // bundle — load it from node_modules at runtime instead (imported by
  // cli-poll.ts for the SSH/Telnet fallback polling path).
  serverExternalPackages: ["ssh2"],
  // Allow loading from any origin on the LAN (IP-based access)
  allowedDevOrigins: ["*.space-z.ai", "*.chatglm.cn", "http://0.0.0.0:3000", "http://*:3000"],
  // CORS for API routes — other PCs need to fetch data
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};
export default nextConfig;
