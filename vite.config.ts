import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

/**
 * The release number from package.json, shown in the profile menu so phones can
 * be compared. It goes up with every release: 1.1.0 for new features, 1.0.1 for fixes.
 */
function appVersion(): string {
  return (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
}

// base './' keeps every asset path relative, so the same build works on
// GitHub Pages (a sub-folder), Cloudflare Pages, or any static host.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png', 'icons/favicon-64.png'],
      manifest: {
        id: './',
        name: 'JoshWorks POS',
        short_name: 'JW POS',
        description: 'Offline event register, production cost, profit share and pricing for JoshWorks.',
        lang: 'en-PH',
        theme_color: '#181516',
        background_color: '#181516',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,ttf,webp,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
  },
  server: { host: true },
  preview: { host: true },
});
