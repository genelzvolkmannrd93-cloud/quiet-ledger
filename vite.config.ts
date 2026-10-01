import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => ({
  server: { host: '127.0.0.1', strictPort: true },
  // A private local credential must never be injected into a production build.
  define: {
    __LOCAL_APP_CHECK_DEBUG_TOKEN__: JSON.stringify(command === 'serve'
      ? loadEnv(mode, process.cwd(), 'LOCAL_').LOCAL_APP_CHECK_DEBUG_TOKEN || '' : ''),
  },
  plugins: [{
    name: 'private-local-app-check',
    configResolved(config) {
      const token = loadEnv(mode, process.cwd(), 'LOCAL_').LOCAL_APP_CHECK_DEBUG_TOKEN;
      if (command === 'serve' && token && !['127.0.0.1', 'localhost', '::1'].includes(String(config.server.host))) {
        throw new Error('Local App Check credentials require a loopback-only dev server. Do not use --host 0.0.0.0.');
      }
    },
  }, {
    name: 'public-indexing-policy',
    transformIndexHtml(html) {
      return mode === 'public'
        ? html.replace('noindex, nofollow, noarchive', 'index, follow')
          .replace('Закрытый трекер подписок и регулярных платежей.', 'Личный трекер подписок и регулярных платежей.')
        : html;
    },
  }],
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
        },
      },
    },
  },
}));
