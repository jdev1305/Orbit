import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No server-side STEPXML discovery or XML assets in the production bundle.
// GitHub Pages hosts Orbit under /Orbit/.
export default defineConfig({
  plugins: [react()],
  base: '/Orbit/',
})
