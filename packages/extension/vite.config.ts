import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

function copyManifest() {
  return {
    name: 'copy-manifest',
    closeBundle() {
      const browser = process.env.BROWSER || 'chrome';
      const src = browser === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';
      copyFileSync(resolve(__dirname, src), resolve(__dirname, 'dist/manifest.json'));
      // Copy icons
      mkdirSync(resolve(__dirname, 'dist/icons'), { recursive: true });
      copyFileSync(resolve(__dirname, 'icons/icon-48.png'), resolve(__dirname, 'dist/icons/icon-48.png'));
      copyFileSync(resolve(__dirname, 'icons/icon-128.png'), resolve(__dirname, 'dist/icons/icon-128.png'));
    }
  };
}

export default defineConfig({
  plugins: [svelte(), copyManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content-metadata': resolve(__dirname, 'src/content/metadata.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
