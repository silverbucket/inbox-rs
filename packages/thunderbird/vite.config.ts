import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

function copyManifestAndIcons() {
  return {
    name: 'copy-manifest-and-icons',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json'),
      );
      mkdirSync(resolve(__dirname, 'dist/icons'), { recursive: true });
      copyFileSync(
        resolve(__dirname, 'icons/icon-16.png'),
        resolve(__dirname, 'dist/icons/icon-16.png'),
      );
      copyFileSync(
        resolve(__dirname, 'icons/icon-32.png'),
        resolve(__dirname, 'dist/icons/icon-32.png'),
      );
      copyFileSync(
        resolve(__dirname, 'icons/icon-48.png'),
        resolve(__dirname, 'dist/icons/icon-48.png'),
      );
      copyFileSync(
        resolve(__dirname, 'icons/icon-128.png'),
        resolve(__dirname, 'dist/icons/icon-128.png'),
      );
    },
  };
}

export default defineConfig({
  plugins: [svelte(), copyManifestAndIcons()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
