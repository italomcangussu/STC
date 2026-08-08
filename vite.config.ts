import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          secure: false,
        },
      },
    },
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    preview: {
      allowedHosts: true,
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          /**
           * A forma de objeto (`{'react-vendor': ['react']}`) casa por
           * substring de caminho, e `@react-three/fiber` contém `react`. O
           * resultado era `react-vendor` com **1 byte** e o React morando
           * dentro de `three-vendor` — que o entry então importava
           * estaticamente, obrigando todo mundo a baixar 1 MB de Three.js para
           * abrir a Agenda.
           *
           * A forma de função casa por caminho exato. A ordem importa: os
           * pacotes `@react-three/*` são testados antes de `react`.
           */
          manualChunks(id) {
            /**
             * Helpers virtuais do Vite/Rollup (`\0vite/preload-helper`,
             * `\0commonjsHelpers`) não têm `node_modules` no id. Sem destino
             * explícito o Rollup os coloca em qualquer chunk — e foi assim que
             * `export-vendor` (777 kB) virou dependência estática do entry por
             * causa de um helper de ~300 bytes. Vão junto do React, que a
             * página carrega de qualquer forma.
             */
            if (/vite\/(preload-helper|modulepreload-polyfill)|commonjsHelpers/.test(id)) {
              return 'react-vendor';
            }

            if (!id.includes('node_modules')) return;

            if (id.includes('/node_modules/three/') || id.includes('@react-three/')) {
              return 'three-vendor';
            }
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
              return 'react-vendor';
            }
            // Só o Dashboard usa gráfico; separado do resto da UI, ele sai do
            // caminho de quem nunca abre o Dashboard.
            if (/\/node_modules\/(recharts|d3-[a-z]+|victory-vendor)\//.test(id)) {
              return 'charts-vendor';
            }
            if (id.includes('/node_modules/lucide-react/')) {
              return 'icons-vendor';
            }
            // Exportar agenda em PNG/PDF é ação pontual do admin; não pode
            // custar meio megabyte no primeiro carregamento de todo sócio.
            if (/\/node_modules\/(jspdf|html2canvas|canvg|dompurify)\//.test(id)) {
              return 'export-vendor';
            }
            if (id.includes('/node_modules/@supabase/')) {
              return 'supabase-vendor';
            }
          },
        },
      },
    },
  };
});
