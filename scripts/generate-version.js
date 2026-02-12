#!/usr/bin/env node

/**
 * Script para gerar version.json no build
 * Executado automaticamente durante o build do Vite
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

const version = {
  version: Date.now().toString(), // Timestamp como versão
  buildDate: new Date().toISOString(),
  env: process.env.NODE_ENV || 'production'
};

const distPath = join(process.cwd(), 'dist', 'version.json');

try {
  writeFileSync(distPath, JSON.stringify(version, null, 2));
  console.log('✅ version.json criado:', version);
} catch (error) {
  console.error('❌ Erro ao criar version.json:', error);
  process.exit(1);
}
