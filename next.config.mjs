/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    images: {
        remotePatterns: [{ protocol: "https", hostname: "thedietfantasy.com", pathname: "/**" }],
    },
    telemetry: false,

    experimental: {},
};
export default nextConfig;