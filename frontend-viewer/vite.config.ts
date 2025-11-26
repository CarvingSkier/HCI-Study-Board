import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.txt', '**/*.jpg', '**/*.jpeg', '**/*.png'],
  server: {
    watch: {
      // Ignore TypeScript config and build info files to prevent reload loops
      ignored: [
        '**/*.tsbuildinfo',
        '**/node_modules/.tmp/**',
        '**/tsconfig*.json',
        '**/tsconfig*.ts'
      ]
    }
  }
})
