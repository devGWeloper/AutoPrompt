/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // oracledb is a native driver that must stay external to the server bundle.
    serverComponentsExternalPackages: ["oracledb"],
    // src/instrumentation.ts starts the MR gate scheduler (docs/gate-design.md).
    instrumentationHook: true
  }
};

export default nextConfig;
