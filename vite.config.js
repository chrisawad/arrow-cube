import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    host: '::',
    port: 5173,
    strictPort: true,
    allowedHosts: ['riva-laptop'],
  },
  preview: {
    host: '::',
    port: 4173,
    strictPort: true,
    allowedHosts: ['riva-laptop'],
  },
});
