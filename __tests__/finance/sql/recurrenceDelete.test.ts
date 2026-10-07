// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUserError, j, key, q, rpc, rpcError, U, world } from './harness';

const cat = async (w: Awaited<ReturnType<typeof world>>, name: string) => (await q<{ id: string }>(w.db, `select id from public.fin_categories where name = '${name}'`))[0].id;

const recorrenciaComUmMesPago = async () => {
  const w = await world();
  const energia = await cat(w, 'Energia');
  const rec = await rpc<{ id: string }>(w.db, U.admin, `public.fin_save_recurrence('${key()}', null, null, ${j({
    description: 'ENEL', category_id: energia, amount_cents: 50000, due_day: 10, start_month: '2026-01-01' })}, null)`);
  const pago = (await q<{ id: string }>(w.db, `select id from public.fin_entries where recurrence_id = '${rec.id}' and competence_date = '2026-01-01'`))[0].id;
  await rpc(w.db, U.admin, `public.fin_pay_entry('${key()}', '${pago}', 1, ${j({ amount_cents: 50000, paid_on: '2026-02-10', account_id: w.account })})`);
  return { w, rec, pago };
};

describe('apagar recorrência', () => {
  it('apaga o modelo, cancela o pendente sem pagamento e mantém o que foi pago como lançamento avulso', async () => {
    const { w, rec, pago } = await recorrenciaComUmMesPago();
    const antes = (await q<{ n: number }>(w.db, `select count(*)::int n from public.fin_entries where recurrence_id = '${rec.id}'`))[0].n;
    expect(antes).toBeGreaterThan(8);

    const r = await rpc<{ canceled: number; kept: number }>(w.db, U.admin, `public.fin_delete_recurrence('${key()}', '${rec.id}', 1, '{}'::jsonb)`);
    expect(r.kept).toBe(1);
    expect(r.canceled).toBe(antes - 1);

    expect(await q(w.db, `select 1 from public.fin_recurrences where id = '${rec.id}'`)).toHaveLength(0);
    // nenhum lançamento some e nenhum fica ligado ao modelo apagado
    expect((await q<{ n: number }>(w.db, `select count(*)::int n from public.fin_entries where description = 'ENEL'`))[0].n).toBe(antes);
    expect((await q<{ n: number }>(w.db, `select count(*)::int n from public.fin_entries where description = 'ENEL' and recurrence_id is not null`))[0].n).toBe(0);
    const mantido = (await q<{ status: string }>(w.db, `select status from public.fin_entries where id = '${pago}'`))[0];
    expect(mantido.status).toBe('paid');
    const cancelados = await q<{ status: string; cancel_reason: string }>(w.db, `select status, cancel_reason from public.fin_entries where description = 'ENEL' and id <> '${pago}'`);
    expect(cancelados.every((c) => c.status === 'canceled' && c.cancel_reason === 'Recorrência excluída')).toBe(true);
    // o pagamento continua no caixa
    expect((await q<{ n: number }>(w.db, `select count(*)::int n from public.fin_entry_payments where entry_id = '${pago}'`))[0].n).toBe(1);
  }, 60000);

  it('a linha apagada fica na auditoria', async () => {
    const { w, rec } = await recorrenciaComUmMesPago();
    await rpc(w.db, U.admin, `public.fin_delete_recurrence('${key()}', '${rec.id}', 1, '{}'::jsonb)`);
    const log = await q<{ action: string; old_data: { description: string } | null; new_data: unknown }>(w.db,
      `select action, old_data, new_data from public.admin_audit_logs where table_name = 'fin_recurrences' and record_id = '${rec.id}' order by occurred_at desc, id desc limit 1`);
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe('fin.recurrence_delete');
    expect(log[0].old_data?.description).toBe('ENEL');
    expect(log[0].new_data).toBeNull();
  }, 60000);

  it('repetir a mesma chave não apaga de novo; versão velha é recusada; recorrência inexistente também', async () => {
    const { w, rec } = await recorrenciaComUmMesPago();
    expect(await rpcError(w.db, U.admin, `public.fin_delete_recurrence('${key()}', '${rec.id}', 99, '{}'::jsonb)`)).toMatch(/VERSION_CONFLICT/);
    const k = key();
    await rpc(w.db, U.admin, `public.fin_delete_recurrence('${k}', '${rec.id}', 1, '{}'::jsonb)`);
    const again = await rpc<{ replayed?: boolean }>(w.db, U.admin, `public.fin_delete_recurrence('${k}', '${rec.id}', 1, '{}'::jsonb)`);
    expect(again.replayed).toBe(true);
    expect(await rpcError(w.db, U.admin, `public.fin_delete_recurrence('${key()}', '${rec.id}', 1, '{}'::jsonb)`)).toMatch(/RECURRENCE_NOT_FOUND/);
  }, 60000);

  it('só administrador apaga; o delete direto continua bloqueado (gatilho)', async () => {
    const { w, rec } = await recorrenciaComUmMesPago();
    for (const uid of [U.socioA, U.prof, U.lanch, null]) {
      expect(await rpcError(w.db, uid, `public.fin_delete_recurrence('${key()}', '${rec.id}', 1, '{}'::jsonb)`), String(uid)).not.toBeNull();
    }
    expect(await asUserError(w.db, U.admin, `delete from public.fin_recurrences where id = '${rec.id}'`)).not.toBeNull();
    await expect(w.db.exec(`delete from public.fin_recurrences where id = '${rec.id}'`)).rejects.toThrow(/FINANCE_NO_DELETE/);
    expect(await q(w.db, `select 1 from public.fin_recurrences where id = '${rec.id}'`)).toHaveLength(1);
  }, 60000);
});
