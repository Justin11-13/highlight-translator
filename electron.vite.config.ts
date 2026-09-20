import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@assets': resolve(__dirname, 'src/renderer/assets')
      }
    },
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/renderer/popup.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
