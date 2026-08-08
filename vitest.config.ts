import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      /**
       * Instrumenta todo o código-fonte, e não só os arquivos que algum teste
       * importa.
       *
       * Sem isto o denominador se mexia a cada teste novo: escrever a rede do
       * `ChampionshipInProgress` puxou 14 arquivos nunca instrumentados para o
       * relatório e a cobertura "caiu" de 57,81% para 45,10% — mesmo com 212
       * linhas a **mais** realmente cobertas. O número antigo era lisonjeiro
       * porque só media o que alguém já tinha testado.
       *
       * Declarar `include` faz o v8 instrumentar tudo o que casa com o padrão,
       * tenha ou não teste. O percentual passa a ser comparável entre
       * execuções, que é a única forma de usá-lo como régua de regressão.
       * (No Vitest 4 esta é a forma; a opção `all` foi removida.)
       */
      include: ['components/**', 'lib/**', 'hooks/**', 'contexts/**', 'utils.ts', 'App.tsx'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        '**/*.test.{ts,tsx}',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
