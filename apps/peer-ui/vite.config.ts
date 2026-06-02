import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4174,
    proxy: {
      '/api': 'http://localhost:4747',
      '/health': 'http://localhost:4747',
    },
  },
})
