// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { briefingKey, composeBriefing, fortalezaDay, fortalezaHour, runAdminBriefing, type Db } from '../../supabase/functions/_shared/adminBriefing';

const dados = {
  today: '2026-10-08', total_cents: 1560733, accounts: [{ name: 'Cora', balance_cents: 1560733 }],
  yesterday: { inflow_cents: 12000, outflow_cents: 5000 }, month: { inflow_cents: 829000, outflow_cents: 614305, net_cents: 214695 },
  receivables: { open_cents: 784000, overdue_cents: 20000, overdue_count: 2, overdue_members: 2 },
  payables: { payable_open_cents: 524500, payable_overdue_cents: 0, payable_due_7d_cents: 80000 },
  receipts: { total: 2, oldest_at: '2026-10-07T16:20:00-03:00' }, access: { total: 1 },
  signatures: [{ title: 'Regimento', recipients: 100, signed: 60, due_at: '2026-10-20T00:00:00Z' }],
  reservations: { total: 5, by_type: { Aula: 3, Play: 2 } },
};

describe('resumo da manhã do João', () => {
  it('compõe o texto com os números do banco, em uma mensagem', () => {
    const t = composeBriefing('Hermeson Veras', dados);
    expect(t.startsWith('Bom dia, Hermeson! Resumo do clube de 08/10.')).toBe(true);
    expect(t).toContain('💰 Caixa: R$ 15.607,33');
    expect(t).toContain('Ontem entrou R$ 120,00 e saiu R$ 50,00. No mês: entrou R$ 8.290,00, saiu R$ 6.143,05 (R$ 2.146,95).');
    expect(t).toContain('📥 A receber: R$ 7.840,00 em aberto; vencido R$ 200,00 (2 cobranças, 2 sócios).');
    expect(t).toContain('📤 A pagar: R$ 5.245,00 em aberto; nada vencido, R$ 800,00 vencem em 7 dias.');
    expect(t).toContain('🧾 2 comprovantes aguardando análise (o mais antigo de 07/10).');
    expect(t).toContain('✍️ «Regimento»: 60 de 100 assinaram, prazo 20/10.');
    expect(t).toContain('🔑 1 pedido de acesso pendente.');
    expect(t).toContain('🎾 Hoje: 5 reservas (3 aula, 2 play).');
    expect(t.endsWith('Quer detalhar algo? É só pedir aqui.')).toBe(true);
  });

  it('omite o que está zerado e não inventa nome', () => {
    const t = composeBriefing('+5588999265229', { ...dados, receipts: { total: 0 }, access: { total: 0 }, signatures: [], reservations: { total: 0, by_type: {} },
      accounts: [{ name: 'A', balance_cents: 100 }, { name: 'B', balance_cents: 200 }], month: { net_cents: -5000 } });
    expect(t.startsWith('Bom dia! Resumo')).toBe(true);
    expect(t).not.toMatch(/comprovante|acesso pendente|assinaram/);
    expect(t).toContain('🎾 Hoje: sem reservas.');
    expect(t).toContain('(A R$ 1,00 · B R$ 2,00)');
    expect(t).toContain('(-R$ 50,00)');
  });

  it('chave estável por dia e administrador (UUID), diferente entre dias e pessoas', async () => {
    const a = await briefingKey('2026-10-08', 'p1');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await briefingKey('2026-10-08', 'p1')).toBe(a);
    expect(await briefingKey('2026-10-09', 'p1')).not.toBe(a);
    expect(await briefingKey('2026-10-08', 'p2')).not.toBe(a);
  });

  it('fuso de Fortaleza: 11:00 UTC é 08h; 02:30 UTC é 23h do dia anterior', () => {
    expect(fortalezaHour(new Date('2026-10-08T11:00:00Z'))).toBe(8);
    expect(fortalezaHour(new Date('2026-10-08T02:30:00Z'))).toBe(23);
    expect(fortalezaDay(new Date('2026-10-08T02:30:00Z'))).toBe('2026-10-07');
  });

  const mundo = (opts: { alreadySent?: boolean } = {}) => {
    const calls: string[] = []; const sent: { number: string; text: string }[] = []; const finished: boolean[] = [];
    const db: Db = async (name, args) => {
      calls.push(name);
      if (name === 'conv_svc_admin_briefing_targets') return { data: [{ profile_id: 'p1', name: 'Hermeson Veras', conversation_id: 'c1' }, { profile_id: 'p2', name: 'Henrique Coelho', conversation_id: 'c2' }], error: null };
      if (name === 'conv_svc_admin_briefing_data') return { data: { ok: true, data: dados }, error: null };
      if (name === 'conv_svc_queue_message') return { data: [{ message_id: `m-${args.p_conversation}`, destination: '5588999999999', already_sent: opts.alreadySent === true }], error: null };
      if (name === 'conv_svc_finish_message') { finished.push(args.p_sent === true); return { data: null, error: null }; }
      return { data: null, error: { message: 'unknown' } };
    };
    const uaz = async (req: { path: string; body: Record<string, unknown> }) => { sent.push({ number: String(req.body.number), text: String(req.body.text) }); return { ok: true as const, body: { messageid: 'X1' } }; };
    return { db, uaz, calls, sent, finished };
  };

  it('às 08h00 manda uma mensagem para cada administrador e marca como enviada', async () => {
    const w = mundo();
    const r = await runAdminBriefing(w.db, w.uaz, { now: new Date('2026-10-08T11:00:00Z') });
    expect(r).toEqual({ targets: 2, sent: 2, skipped: 0, failed: 0 });
    expect(w.sent).toHaveLength(2);
    expect(w.sent[0].text).toContain('Bom dia, Hermeson!');
    expect(w.sent[1].text).toContain('Bom dia, Henrique!');
    expect(w.finished).toEqual([true, true]);
  });

  it('repetir o agendador no mesmo dia não manda de novo (já enviada)', async () => {
    const w = mundo({ alreadySent: true });
    const r = await runAdminBriefing(w.db, w.uaz, { now: new Date('2026-10-08T11:30:00Z') });
    expect(r).toEqual({ targets: 2, sent: 0, skipped: 2, failed: 0 });
    expect(w.sent).toHaveLength(0);
  });

  it('fora da janela (antes das 08h ou a partir do meio-dia) não consulta nem envia', async () => {
    for (const hora of ['2026-10-08T10:59:00Z', '2026-10-08T15:00:00Z', '2026-10-08T21:00:00Z']) {
      const w = mundo();
      expect(await runAdminBriefing(w.db, w.uaz, { now: new Date(hora) })).toEqual({ targets: 0, sent: 0, skipped: 0, failed: 0 });
      expect(w.calls).toHaveLength(0);
    }
  });

  it('sem provedor de WhatsApp: conta como falha e não marca nada como enviado', async () => {
    const w = mundo();
    const r = await runAdminBriefing(w.db, null, { now: new Date('2026-10-08T11:00:00Z') });
    expect(r).toMatchObject({ sent: 0, failed: 2 });
    expect(w.calls).not.toContain('conv_svc_finish_message');
  });

  it('dry_run devolve os textos fora da janela e não envia nem enfileira', async () => {
    const w = mundo();
    const r = await runAdminBriefing(w.db, w.uaz, { now: new Date('2026-10-08T22:00:00Z'), dryRun: true });
    expect(r.dry).toHaveLength(2);
    expect(w.sent).toHaveLength(0);
    expect(w.calls).not.toContain('conv_svc_queue_message');
  });
});
