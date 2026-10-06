// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { newDb, q } from './harness';

describe('Conversas — fundação no banco', () => {
  it('aplica as quatro migrations em ordem e cria as tabelas conv_*', async () => {
    const db = await newDb();
    const t = await q<{ table_name: string }>(db, `select table_name from information_schema.tables where table_schema = 'public' and table_name like 'conv\\_%' order by 1`);
    const names = t.map((r) => r.table_name);
    for (const n of ['conv_channel', 'conv_groups', 'conv_contacts', 'conv_conversations', 'conv_messages', 'conv_ai_settings',
      'conv_ai_sessions', 'conv_booking_proposals', 'conv_automations', 'conv_automation_recipients']) expect(names).toContain(n);
  }, 60000);
});
