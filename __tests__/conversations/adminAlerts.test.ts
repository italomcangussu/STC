// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeAlertMessage, evaluateAlerts, runAdminAlerts, type Db } from '../../supabase/functions/_shared/adminAlerts';
import { composeBriefing } from '../../supabase/functions/_shared/adminBriefing';

const dados = {
  overdue_days: 7, min_balance_cents: 500000, total_cents: 300000,
  overdue: { count: 3, cents: 45000, members: 2 }, receipts_waiting: { count: 1 }, payables: { overdue_cents: 12000, overdue_count: 2 },
};

describe('alertas por regra do João', () => {
  it('cada regra gera a sua linha, com os números do banco', () => {
    const a = evaluateAlerts(dados);
    expect(a.map((x) => x.rule)).toEqual(['overdue', 'receipts', 'payables', 'balance']);
    expect(a[0].text).toBe('📥 3 cobranças vencidas há 7 dias ou mais: R$ 450,00 de 2 sócios.');
    expect(a[1].text).toBe('🧾 1 comprovante esperando análise há mais de 24 horas.');
    expect(a[2].text).toBe('📤 2 contas a pagar vencidas: R$ 120,00.');
    expect(a[3].text).toBe('💰 O caixa está em R$ 3.000,00, abaixo do mínimo de R$ 5.000,00 que você definiu.');
  });

  it('sem nada fora do normal não há alerta; sem saldo mínimo definido não avisa de caixa', () => {
    expect(evaluateAlerts({ ...dados, overdue: { count: 0 }, receipts_waiting: { count: 0 }, payables: { overdue_cents: 0 }, min_balance_cents: null })).toEqual([]);
    expect(evaluateAlerts({ ...dados, min_balance_cents: null }).map((x) => x.rule)).not.toContain('balance');
    expect(evaluateAlerts({ ...dados, total_cents: 600000 }).map((x) => x.rule)).not.toContain('balance');
  });

  it('a mensagem junta as regras e cumprimenta pelo primeiro nome', () => {
    const t = composeAlertMessage('Hermeson Veras', evaluateAlerts(dados).slice(0, 2));
    expect(t.startsWith('Hermeson, um aviso do clube:\n📥')).toBe(true);
    expect(t.endsWith('Quer detalhar? É só pedir aqui.')).toBe(true);
    expect(composeAlertMessage('+5588999999999', evaluateAlerts(dados).slice(0, 1)).startsWith('um aviso do clube:')).toBe(true);
  });

  const mundo = (claimed: Set<string> = new Set()) => {
    const sent: string[] = []; const released: string[] = [];
    const db: Db = async (name, args) => {
      if (name === 'conv_svc_admin_alert_targets') return { data: [{ profile_id: 'p1', name: 'Hermeson Veras', conversation_id: 'c1' }], error: null };
      if (name === 'conv_svc_admin_alert_data') return { data: { ok: true, data: dados }, error: null };
      if (name === 'conv_svc_admin_alert_claim') { const k = String(args.p_rule); if (claimed.has(k)) return { data: false, error: null }; claimed.add(k); return { data: true, error: null }; }
      if (name === 'conv_svc_admin_alert_release') { released.push(String(args.p_rule)); claimed.delete(String(args.p_rule)); return { data: null, error: null }; }
      if (name === 'conv_svc_queue_message') return { data: [{ message_id: 'm1', destination: '5588999999999', already_sent: false }], error: null };
      if (name === 'conv_svc_finish_message') return { data: null, error: null };
      return { data: null, error: { message: 'unknown' } };
    };
    const uaz = async (req: { path: string; body: Record<string, unknown> }) => { sent.push(String(req.body.text)); return { ok: true as const, body: { messageid: 'X' } }; };
    return { db, uaz, sent, released, claimed };
  };

  it('na janela manda uma mensagem só; repetir no mesmo dia não avisa de novo o que já avisou', async () => {
    const w = mundo();
    expect(await runAdminAlerts(w.db, w.uaz, { now: new Date('2026-10-08T13:00:00Z') })).toEqual({ targets: 1, sent: 1, skipped: 0, failed: 0 });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain('📥 3 cobranças vencidas');
    expect(await runAdminAlerts(w.db, w.uaz, { now: new Date('2026-10-08T14:00:00Z') })).toEqual({ targets: 1, sent: 0, skipped: 1, failed: 0 });
    expect(w.sent).toHaveLength(1);
  });

  it('fora da janela (antes das 09h ou a partir das 18h) não consulta nem envia', async () => {
    for (const hora of ['2026-10-08T11:59:00Z', '2026-10-08T21:00:00Z']) {
      const w = mundo();
      expect(await runAdminAlerts(w.db, w.uaz, { now: new Date(hora) })).toEqual({ targets: 0, sent: 0, skipped: 0, failed: 0 });
      expect(w.sent).toHaveLength(0);
    }
  });

  it('se o envio falhar, libera as regras para tentar de novo na próxima hora', async () => {
    const w = mundo();
    const falha = async () => ({ ok: false as const, error: 'HTTP_500' });
    const r = await runAdminAlerts(w.db, falha, { now: new Date('2026-10-08T13:00:00Z') });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(w.released.sort()).toEqual(['balance', 'overdue', 'payables', 'receipts']);
    expect(w.claimed.size).toBe(0);
  });

  it('resumo da manhã curto: só caixa, a receber/pagar e comprovantes', () => {
    const base = { today: '2026-10-08', total_cents: 100000, accounts: [], yesterday: {}, month: {}, receivables: { open_cents: 0 }, payables: { payable_open_cents: 0 },
      receipts: { total: 0 }, access: { total: 2 }, signatures: [{ title: 'Regimento', recipients: 10, signed: 5 }], reservations: { total: 3, by_type: { Play: 3 } } };
    const completo = composeBriefing('Ana', base); const curto = composeBriefing('Ana', { ...base, style: 'curto' });
    expect(completo).toMatch(/Regimento/); expect(completo).toMatch(/Hoje: 3 reservas/); expect(completo).toMatch(/2 pedidos de acesso/);
    expect(curto).not.toMatch(/Regimento|Hoje:|pedidos de acesso/);
    expect(curto).toMatch(/Caixa: R\$ 1\.000,00/);
  });
});
