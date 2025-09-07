/** @type {import('next').NextConfig} */
const nextConfig = {
    // Remove images.domains; use remotePatterns instead
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'thedietfantasy.com' },
            // add more hosts here if needed
        ],
    },

    // (Optional) Disable telemetry in prod builds
    // telemetry: false,

    // (Optional) for consistency with Turbopack
    experimental: {
        // turbopack is already enabled by your build command
    },
};

export default nextConfig;