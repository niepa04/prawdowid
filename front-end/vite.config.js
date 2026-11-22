import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev serwer frontendu na 5173. Zapytania na /api idą do Expressa (backend/serwer.js) na 3000.
// host: true = dostępny też w sieci Tailscale.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
