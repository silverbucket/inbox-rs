import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173
  },
  resolve: {
    alias: {
      'onnxruntime-node': 'onnxruntime-web',
      'sharp': 'onnxruntime-web',
    }
  }
});
