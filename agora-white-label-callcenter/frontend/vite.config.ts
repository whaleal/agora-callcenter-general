import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['recharts'],
  },
  server: {
    // 监听所有可用的网络接口，这是实现局域网访问的关键
    host: '192.168.3.7', 
    // 可选：指定端口，默认为 5173
    port: 5173,
    // 可选：启动后自动打开浏览器
    open: true
  }
})
