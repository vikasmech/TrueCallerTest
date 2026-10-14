/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@phone-rep/shared"],
  async headers() {
    return [{
      source: "/auth/verify",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }];
  },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
