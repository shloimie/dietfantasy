/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    images: {
        remotePatterns: [{ protocol: "https", hostname: "thedietfantasy.com", pathname: "/**" }],
    },


    experimental: {},
};
export default nextConfig;