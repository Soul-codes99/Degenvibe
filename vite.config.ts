import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The game page is web/index.html (plain JavaScript). Vite only bundles the Privy sign-in next to it.
export default defineConfig({ root: 'web', plugins: [react()], build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 } });
