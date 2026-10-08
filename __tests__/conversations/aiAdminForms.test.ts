// @vitest-environment node
/**
 * Formulários do clube pelo João (administrador no privado): `turn.ts` real + SQL real (PGlite).
 * Consultas (quem respondeu / quem falta / resultado) e ações com "sim": criar, encerrar/reabrir e lembrar quem não respondeu.
 */
import { describe, expect, it } from 'vitest';
import { U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { runTurn } from '../../supabase/functions/_shared/aiAgent/turn';
import type { Chat } from '../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

const answer = (o: Record<string, unknown> = {}) => JSON.stringify({
  messages: [], intent: 'admin_acao', ready: true, customer_confirmed: false, declined: false, awaiting: false,
  transfer: false, handoff_kind: null, handoff_note: null, close: false, ...o, slots: { ...((o.slots as object) ?? {}) },
});
const script = (...outs: string[]) => {
  const chat: Chat = async () => {
    const out = outs.shift();
    if (out === undefined) throw new Error('modelo chamado além do roteiro');
    return { output: out, model: 'teste', usage: null };
  };
  return chat;
};
const provider = () => {
  const sent: { number: string; text: string }[] = [];
  const uaz: UazCaller = async ({ path, body }) => {
    if (path === '/send/text') { sent.push({ number: String(body.number), text: String(body.text) }); return { ok: true, body: { messageid: `OUT${++n}` } }; }
    return { ok: true, body: {} };
  };
  return { uaz, sent };
};

async function setup() {
  const w = await world();
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste', buffer_seconds: 0, max_turns: 12 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5599900000099', ai_direct_enabled: true })})`);
  await q(w.db, `update public.profiles set phone = '88993412944' where id = '${U.socioB}'`);
  const [f] = await q<{ id: string }>(w.db, `insert into public.club_forms(title, slug, created_by) values ('Sugestões de Melhorias para o Clube', 'sugestoes-melhorias', '${U.admin}') returning id`);
  await q(w.db, `insert into public.club_form_voter_receipts(form_id, user_id) values ('${f.id}', '${U.socioA}')`);
  return { w, formId: f.id };
}

const tick = () => new Promise((r) => setTimeout(r, 15));
const direct = async (w: W, body: string) => {
  await tick();
  return svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `F${++n}${Math.random()}`, chat_kind: 'direct', phone: '5599900000001', name: 'X', kind: 'text', body })})`);
};
const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
  const m = await direct(w, texto);
  return runTurn(m.message_id, { db: pgDb(w.db), chat: script(answer(o)), uaz: p.uaz, sleep: async () => undefined });
};
const consulta = (domain: string, slots: Record<string, unknown> = {}) => ({ intent: 'admin_consulta', slots: { read_domain: domain, ...slots } });
const acao = (adm_action: string, slots: Record<string, unknown> = {}) => ({ slots: { adm_action, ...slots } });
const queued = (w: W) => q<any>(w.db, `select f.send_body, ct.phone from public.conv_followups f join public.conv_conversations c on c.id = f.conversation_id join public.conv_contacts ct on ct.id = c.contact_id where f.note like 'Lembrete: formulário%'`);

describe('formulários pelo João', () => {
  it('consultas: lista, quem respondeu e quem falta, resultado', async () => {
    const { w } = await setup(); const p = provider();
    expect((await dizer(w, p, 'quais formulários?', consulta('formularios'))).action).toBe('admin_read:formularios');
    expect(p.sent.at(-1)!.text).toMatch(/«Sugestões de Melhorias para o Clube»: aberto, 1 resposta[\s\S]*votacao\/sugestoes-melhorias/);
    await dizer(w, p, 'quem já respondeu as sugestões?', consulta('formulario', { form_ref: 'sugestões' }));
    const t = p.sent.at(-1)!.text;
    expect(t).toMatch(/1 de \d+ sócios responderam/);
    expect(t).toMatch(/Responderam: Ana Sócia/);
    expect(t).toMatch(/Faltam: .*Beto Sócio.*/);
    expect(t).not.toMatch(/Faltam: .*Ana Sócia/);
    await dizer(w, p, 'e o resultado?', consulta('formulario_resultado'));
    expect(p.sent.at(-1)!.text).toMatch(/Resultado de «Sugestões de Melhorias para o Clube» \(1 participante\)/);
    await dizer(w, p, 'e o do outro?', consulta('formulario', { form_ref: 'inexistente' }));
    expect(p.sent.at(-1)!.text).toMatch(/Não achei formulário com esse nome/);
  }, 120000);

  it('lembrar quem falta: resumo com nomes e link, só enfileira no "sim", sem quem já respondeu e sem duplicar', async () => {
    const { w } = await setup(); const p = provider();
    const r = await dizer(w, p, 'manda o link pra quem não respondeu', acao('formulario_cobrar', { form_ref: 'sugestões' }));
    expect(r.action).toBe('proposed_admin');
    const resumo = p.sent.at(-1)!.text;
    expect(resumo).toMatch(/Vou lembrar por WhatsApp \d+ sócios? que ainda não responderam o «Sugestões de Melhorias para o Clube», agora: .*Beto Sócio/);
    expect(resumo).not.toMatch(/Ana Sócia/);
    expect(resumo).toContain('https://stcplay.com.br/votacao/sugestoes-melhorias');
    expect(await queued(w)).toHaveLength(0);
    expect((await dizer(w, p, 'sim', { customer_confirmed: true, intent: 'admin_acao' })).action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toMatch(/lembrete do «Sugestões de Melhorias para o Clube» na fila para \d+/);
    const f = await queued(w);
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x: any) => x.phone === '5588993412944')).toBe(true);
    expect(f.every((x: any) => x.send_body.includes('/votacao/sugestoes-melhorias'))).toBe(true);
    // repetir o "sim" não duplica; pedir de novo no mesmo dia não incomoda quem já recebeu
    await dizer(w, p, 'sim', { customer_confirmed: true, intent: 'admin_acao' });
    expect(await queued(w)).toHaveLength(f.length);
    await dizer(w, p, 'manda de novo', acao('formulario_cobrar', { form_ref: 'sugestões' }));
    expect(p.sent.at(-1)!.text).toMatch(/já recebeu o lembrete nas últimas 24 horas/);
  }, 120000);

  it('criar formulário: valida, mostra o resumo e só grava no "sim"; depois encerrar e reabrir', async () => {
    const { w } = await setup(); const p = provider();
    await dizer(w, p, 'cria um formulário', acao('formulario_criar'));
    expect(p.sent.at(-1)!.text).toMatch(/Qual o título/);
    const slots = { form_title: 'Horário do torneio', form_questions: [
      { title: 'Qual horário prefere?', type: 'unica', required: true, options: ['Manhã', 'Noite'] },
      { title: 'Algum comentário?', type: 'texto', required: false, options: [] }] };
    expect((await dizer(w, p, 'cria', acao('formulario_criar', slots))).action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/Vou criar o formulário «Horário do torneio».*\n1\. Qual horário prefere\? \(escolha única\): Manhã \/ Noite\n2\. Algum comentário\? \(resposta escrita, opcional\)/);
    expect(await q(w.db, `select 1 from public.club_forms where slug = 'horario-do-torneio'`)).toHaveLength(0);
    expect((await dizer(w, p, 'sim', { customer_confirmed: true, intent: 'admin_acao' })).action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toMatch(/formulário «Horário do torneio» criado.*votacao\/horario-do-torneio/);
    expect(await q(w.db, `select o.label from public.club_form_options o join public.club_form_questions qq on qq.id = o.question_id order by o.display_order`)).toHaveLength(2);
    await dizer(w, p, 'encerra', acao('formulario_status', { form_ref: 'horário', active: false }));
    await dizer(w, p, 'sim', { customer_confirmed: true, intent: 'admin_acao' });
    expect((await q<any>(w.db, `select is_active from public.club_forms where slug = 'horario-do-torneio'`))[0].is_active).toBe(false);
    await dizer(w, p, 'manda o link de novo', acao('formulario_cobrar', { form_ref: 'horário' }));
    expect(p.sent.at(-1)!.text).toMatch(/está encerrado/);
    await dizer(w, p, 'reabre', acao('formulario_status', { form_ref: 'horário', active: true }));
    await dizer(w, p, 'sim', { customer_confirmed: true, intent: 'admin_acao' });
    expect((await q<any>(w.db, `select is_active from public.club_forms where slug = 'horario-do-torneio'`))[0].is_active).toBe(true);
  }, 180000);

  it('escolha sem alternativas é recusada com pergunta', async () => {
    const { w } = await setup(); const p = provider();
    await dizer(w, p, 'cria', acao('formulario_criar', { form_title: 'Teste', form_questions: [{ title: 'Escolha um', type: 'unica', required: true, options: ['só uma'] }] }));
    expect(p.sent.at(-1)!.text).toMatch(/precisa de 2 a 12 alternativas/);
  }, 90000);
});
