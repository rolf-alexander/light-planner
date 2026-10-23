import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const DAY = 24 * 60 * 60;

export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/light-planner/
  base: '/light-planner/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Light Planner',
        short_name: 'Light Planner',
        description: 'Plan for light in the mountains: elevation, slope and aspect anywhere.',
        theme_color: '#1f2933',
        background_color: '#1f2933',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Files saved for offline use at install. .mjs is MapLibre's worker.
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg}'],
        // Keep the map tiles you have looked at, so they still work with poor signal.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//,
            handler: 'CacheFirst', // elevations never change
            options: {
              cacheName: 'dem-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 90 * DAY },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: 'StaleWhileRevalidate', // show cached, refresh in background
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 14 * DAY },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
