import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, el proxy envía /api y /socket.io al backend (puerto 5000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
