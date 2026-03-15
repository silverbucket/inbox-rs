import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
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
