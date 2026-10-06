// @vitest-environment node
// Contexto da IA: janela das últimas 8 trocas por pessoa e resumo do atendimento anterior.
import { describe, expect, it } from 'vitest';
import { j, key, q, rpc, svc, U, world } from './harness';

let n = 0;
const pause = () => new Promise((r) => setTimeout(r, 12));
const PHONE = '85988880002';

async function enable(w: Awaited<ReturnType<typeof world>>) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
}
const inbound = (w: Awaited<ReturnType<typeof world>>, body: string) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `X${++n}${Math.random()}`, chat_kind: 'direct', phone: PHONE, name: 'Ana', kind: 'text', body })})`);
const trigger = (w: Awaited<ReturnType<typeof world>>, id: string) => svc<any>(w.db, `public.conv_svc_ai_trigger('${id}')`);
const context = (w: Awaited<ReturnType<typeof world>>, session: string) => svc<any>(w.db, `public.conv_svc_ai_context('${session}')`);

describe('janela de contexto (8 trocas) e resumo', () => {
  it('a conversa curta vai inteira; passou de 8 mensagens da pessoa, só as 8 últimas entram e o resto é contado como "mais antigo"', async () => {
    const w = await world();
    await enable(w);
    let last: any;
    for (let i = 1; i <= 12; i++) { last = await inbound(w, `msg-${String(i).padStart(2, '0')}`); await pause(); }
    const t = await trigger(w, last.message_id);
    const c = await context(w, t.session_id);
    const bodies = (c.transcript as any[]).map((x) => x.body);
    expect(bodies).toEqual(Array.from({ length: 8 }, (_, k) => `msg-${String(k + 5).padStart(2, '0')}`));   // 05..12
    expect(c.older_messages).toBe(4);                                                                            // 01..04 só no resumo
    expect(c.prior_summary).toBeNull();
  }, 60000);

  it('até 8 mensagens: nada fica de fora', async () => {
    const w = await world();
    await enable(w);
    let last: any;
    for (let i = 1; i <= 8; i++) { last = await inbound(w, `m${i}`); await pause(); }
    const c = await context(w, (await trigger(w, last.message_id)).session_id);
    expect((c.transcript as any[]).map((x) => x.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    expect(c.older_messages).toBe(0);
  }, 60000);

  it('o que a IA e a equipe disseram no meio entra na janela; o que veio antes das 8 últimas da pessoa não', async () => {
    const w = await world();
    await enable(w);
    let t: any; let m: any;
    for (let i = 1; i <= 10; i++) {
      m = await inbound(w, `u${i}`); await pause();
      if (i === 1) t = await trigger(w, m.message_id);
      if (i < 10) {
        await w.db.exec(`insert into public.conv_messages(conversation_id, direction, kind, body, status, origin, ai_session_id)
          values ('${m.conversation_id}', 'outbound', 'text', 'ia${i}', 'sent', 'ai', '${t.session_id}')`);
        await pause();
      }
    }
    const c = await context(w, t.session_id);
    const bodies = (c.transcript as any[]).map((x) => x.body);
    expect(bodies[0]).toBe('u3');                                  // a 3ª é a mais antiga das 8 últimas
    expect(bodies).toContain('ia3');
    expect(bodies).not.toContain('ia2');
    expect(bodies).not.toContain('u2');
    expect(bodies[bodies.length - 1]).toBe('u10');
    expect(c.older_messages).toBe(4);                              // u1, ia1, u2, ia2
  }, 60000);

  it('sessão nova da mesma pessoa herda o resumo do atendimento anterior (e só dela)', async () => {
    const w = await world();
    await enable(w);
    const m1 = await inbound(w, 'quero saibro');
    const t1 = await trigger(w, m1.message_id);
    await svc(w.db, `public.conv_svc_ai_save_turn('${t1.session_id}', ${j({ summary: 'Prefere saibro à noite, joga com o Beto.' })}, 'close', '{}'::jsonb, false, true)`);
    await pause();
    const m2 = await inbound(w, 'oi, de novo');
    const t2 = await trigger(w, m2.message_id);
    expect(t2.session_id).not.toBe(t1.session_id);
    expect((await context(w, t2.session_id)).prior_summary).toBe('Prefere saibro à noite, joga com o Beto.');
    // outra pessoa não herda o resumo de ninguém
    const other = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `Y${++n}`, chat_kind: 'direct', phone: '85988880003', name: 'Beto', kind: 'text', body: 'oi' })})`);
    const t3 = await trigger(w, other.message_id);
    expect((await context(w, t3.session_id)).prior_summary).toBeNull();
    expect((await q<any>(w.db, `select count(*)::int c from public.conv_ai_sessions`))[0].c).toBe(3);
  }, 60000);
});
