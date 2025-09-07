/** @type {import('next').NextConfig} */
const nextConfig = {
    // Required for Next.js 13+ (Vercel recommends standalone for production)
    output: "standalone",

    // Remote images (instead of deprecated images.domains)
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "thedietfantasy.com",
                pathname: "/**", // allow all paths under this host
            },
            // Add more hosts if needed
        ],
    },

    // Disable telemetry in builds (optional)
    telemetry: false,

    // Experimental options (Turbopack is already enabled by build command)
    experimental: {},
};

export default nextConfig;