// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

async function session(w: W, phone: string) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `A${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'Pessoa', kind: 'text', body: 'oi joão' })})`);
  return (await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`)).session_id as string;
}

// Hermeson (09/11): os atrasados só foram lembrados quando ele pediu, porque as réguas da mensalidade estavam em rascunho
// e o João não tinha como ver isso.
describe('consulta de automações pelo assessor', () => {
  it('o administrador vê cada automação com status, horário e últimos envios; o switch geral vem junto', async () => {
    const w = await world();
    await q(w.db, `insert into public.conv_automations(name, objective, source, trigger_type, status, schedule, message_body, definition)
      values ('Régua de teste', 'testar', 'finance_charge', 'scheduled', 'draft', '{"time":"09:00","weekdays":[1,2,3,4,5]}', 'oi', '{}')`);
    const s = await session(w, '99900000001');
    const r = await svc<any>(w.db, `public.conv_svc_ai_admin_automations('${s}')`);
    expect(r.ok).toBe(true);
    expect(typeof r.data.enabled).toBe('boolean');
    expect(r.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Régua de teste', status: 'draft', schedule: { time: '09:00', weekdays: [1, 2, 3, 4, 5] }, sent_30d: 0, last_sent_at: null }),
    ]));
  });

  it('quem não é administrador não consulta', async () => {
    const w = await world();
    const s = await session(w, '99900000002');
    const r = await svc<any>(w.db, `public.conv_svc_ai_admin_automations('${s}')`);
    expect(r).toMatchObject({ ok: false, code: 'ADMIN_ONLY_PRIVATE' });
  });
});
