#!/usr/bin/env node

/**
 * 📡 Deploy Broadcaster
 * 
 * Script para enviar notificação de deploy via Supabase Realtime
 * Execute após o deploy para notificar usuários instantaneamente
 * 
 * Uso:
 *   node scripts/broadcast-deploy.js
 * 
 * Requer:
 *   - SUPABASE_URL e SUPABASE_ANON_KEY no .env
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar .env
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY devem estar configurados no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function broadcastDeployNotification() {
  try {
    const channel = supabase.channel('app_updates');

    const payload = {
      timestamp: new Date().toISOString(),
      message: 'Nova versão disponível! 🎉'
    };

    // Enviar broadcast
    await channel.send({
      type: 'broadcast',
      event: 'new_deploy',
      payload
    });

    console.log('✅ Broadcast de deploy enviado com sucesso!');
    console.log('📡 Payload:', payload);
    
    // Cleanup
    await supabase.removeChannel(channel);
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao enviar broadcast:', error);
    process.exit(1);
  }
}

broadcastDeployNotification();
