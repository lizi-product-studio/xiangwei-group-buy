import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
      '/api': 'http://127.0.0.1:3100',
      '/health': 'http://127.0.0.1:3100',
    },
  },
});
