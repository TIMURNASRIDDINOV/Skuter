import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reachable from other devices on the LAN, same as the API.
    host: true,
  },
});
