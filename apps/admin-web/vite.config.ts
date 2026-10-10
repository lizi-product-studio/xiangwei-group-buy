import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1_200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', '@tanstack/react-query'],
          ui: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
  server: {
    proxy: {
      // Preserve the browser host so cookie origin checks match the deployed proxy.
      '/api': { target: apiTarget, changeOrigin: false },
      '/health': apiTarget,
    },
  },
});
