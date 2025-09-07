/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        domains: ['thedietfantasy.com'],
        // or use remotePatterns if you want to be more specific:
        // remotePatterns: [
        //   {
        //     protocol: 'https',
        //     hostname: 'thedietfantasy.com',
        //     pathname: '/wp-content/uploads/**',
        //   },
        // ],
    },
};

// next.config.js
module.exports = {
    images: {
        remotePatterns: [{ protocol: 'https', hostname: 'thedietfantasy.com' }],
    },
};
export default nextConfig;
