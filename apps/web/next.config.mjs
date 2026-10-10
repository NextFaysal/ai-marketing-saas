/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/ui", "@repo/contracts"],
  async rewrites() {
    // Same-origin API proxy: the browser only ever talks to the web
    // origin, and Next.js forwards /backend/* to the API server-side.
    // This avoids cross-origin CORS entirely and keeps the app working
    // behind single-domain tunnels/hosts. The destination is the API's
    // internal address (API_INTERNAL_URL, default localhost:4000).
    const apiInternal = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/backend/:path*", destination: `${apiInternal}/:path*` }];
  },
};
export default nextConfig;
