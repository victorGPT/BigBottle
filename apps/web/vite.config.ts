import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // @vechain/picasso publishes a broken "module" entry (esm/index.js) that uses `require(...)`.
    // Force the CJS build so Vite/Rollup can transform it for the browser.
    alias: {
      '@vechain/picasso': '@vechain/picasso/dist/index.js'
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
