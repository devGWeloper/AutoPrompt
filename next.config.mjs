/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // oracledb is a native driver that must stay external to the server bundle.
    serverComponentsExternalPackages: ["oracledb"]
  }
};

export default nextConfig;
