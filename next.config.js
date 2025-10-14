/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (
    config,
    { buildId, dev, isServer, defaultLoaders, webpack }
  ) => {
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false
    
    // Handle pdfjs-dist worker
    config.resolve.alias['pdfjs-dist'] = 'pdfjs-dist/legacy/build/pdf.js'
    
    return config
  },
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdf2pic", "gm", "canvas", "sharp"],
  },
  transpilePackages: ['pdfjs-dist'],
}

module.exports = nextConfig
