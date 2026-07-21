import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The proxy makes the browser see one origin during development: any request the
// frontend makes to these paths is quietly forwarded to the FastAPI server on port
// 8000. Same-origin means the auth cookie flows automatically and the backend
// needs no CORS configuration.
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/auth': backend,
      '/admin': backend,
      '/users': backend,
      '/games': backend,
      '/debug': backend, // TESTING ONLY — see backend/app/routes/debug.py
      '/health': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
})
