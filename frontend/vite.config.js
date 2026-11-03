import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 本地开发：npm run dev 启动 Vite（5173），/api 自动代理到后端 Node 服务（3000）
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        // SSE 长连接不缓冲
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (String(proxyRes.headers['content-type'] || '').includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
