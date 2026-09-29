import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Firebase is a separate chunk that only loads once sync is used.
  build: { chunkSizeWarningLimit: 600 },
})
