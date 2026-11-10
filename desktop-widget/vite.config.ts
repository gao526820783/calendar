import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Tauri expects a fixed port; fail if it is unavailable.
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Tauri uses its own OS-specific targets.
    target: 'chrome105',
    minify: 'esbuild',
    sourcemap: false,
  },
});
