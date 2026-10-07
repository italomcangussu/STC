// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ID, U, inDays, publishedDoc, q, rpc, signAs, svc, world } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await world();
}, 60000);
// A fila é global: cada teste começa com ela vazia (e com os documentos antigos fora de circulação).
beforeEach(async () => {
  await db.exec(`delete from public.sig_notifications; update public.sig_documents set status = 'archived', archived_at = now() where status = 'published'`);
});

type Claimed = { id: string; profile_id: string; kind: string; slot: string; phone: string; name: string; title: string; attempts: number };
const claim = (limit = 50) => svc<Claimed[]>(db, `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sig_svc_claim_notifications(${limit}) x)`);
const finish = (id: string, sent: boolean, provider: string | null = null, error: string | null = null) =>
  svc(db, `public.sig_svc_finish_notification('${id}', ${sent}, ${provider ? `'${provider}'` : 'null'}, ${error ? `'${error}'` : 'null'})`);
const status = async (doc: string) =>
  Object.fromEntries((await q<{ profile_id: string; status: string }>(db, `select profile_id, status from public.sig_notifications where document_id = '${doc}' and kind = 'publish'`)).map((r) => [r.profile_id, r.status]));

describe('fila de envio (sig_svc_claim_notifications / finish)', () => {
  it('entrega o necessário para montar a mensagem e marca como "enviando"', async () => {
    const d = await publishedDoc(db, { title: 'Termo das quadras' }, [U.socioA]);
    const [n] = await claim();
    expect(n).toMatchObject({ profile_id: U.socioA, kind: 'publish', phone: '85900000002', name: 'Ana Sócia', title: 'Termo das quadras', attempts: 1 });
    expect((await status(d.id))[U.socioA]).toBe('sending');
    expect(await claim()).toHaveLength(0); // ninguém pega o mesmo aviso duas vezes
  });

  it('respeita o limite por lote e a ordem de chegada', async () => {
    await publishedDoc(db, {}, [U.socioA, U.socioB, U.socioC]);
    expect(await claim(2)).toHaveLength(2);
    expect(await claim(2)).toHaveLength(1);
    expect(await claim(2)).toHaveLength(0);
  });

  it('enviado: guarda o id da mensagem e registra o evento', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    const [n] = await claim();
    await finish(n.id, true, 'wamid.ABC');
    const row = (await q<{ status: string; provider_message_id: string; sent_at: string }>(db, `select status, provider_message_id, sent_at from public.sig_notifications where id = '${n.id}'`))[0];
    expect(row).toMatchObject({ status: 'sent', provider_message_id: 'wamid.ABC' });
    expect(row.sent_at).not.toBeNull();
    expect((await q<{ kind: string }>(db, `select kind from public.sig_events where document_id = '${d.id}'`)).map((e) => e.kind)).toContain('notified');
  });

  it('falha: tenta de novo com espera crescente e desiste na 3ª (fica "failed" para o admin reenviar)', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    const run = async () => {
      await db.exec(`update public.sig_notifications set not_before = now() where document_id = '${d.id}'`);
      const [n] = await claim();
      await finish(n.id, false, null, 'instância desconectada');
      return n;
    };
    expect((await run()).attempts).toBe(1);
    let r = (await q<{ status: string; not_before: string }>(db, `select status, not_before from public.sig_notifications where document_id = '${d.id}'`))[0];
    expect(r.status).toBe('queued');
    expect(new Date(r.not_before).getTime() - Date.now()).toBeGreaterThan(4 * 60000); // ~5 min
    expect(await claim()).toHaveLength(0); // ainda não é hora
    expect((await run()).attempts).toBe(2);
    expect((await run()).attempts).toBe(3);
    r = (await q<{ status: string; not_before: string }>(db, `select status, not_before from public.sig_notifications where document_id = '${d.id}'`))[0];
    expect(r.status).toBe('failed');
    expect((await q<{ error: string }>(db, `select error from public.sig_notifications where document_id = '${d.id}'`))[0].error).toBe('instância desconectada');
    expect((await q<{ n: string }>(db, `select count(*)::text n from public.sig_events where document_id = '${d.id}' and kind = 'notification_failed'`))[0].n).toBe('3');
    // o admin manda reenviar e a fila volta a andar
    expect(await rpc<number>(db, U.admin, `public.sig_resend_failed('${d.id}')`)).toBe(1);
    expect(await claim()).toHaveLength(1);
  });

  it('aviso preso em "enviando" por mais de 10 min volta à fila', async () => {
    await publishedDoc(db, {}, [U.socioA]);
    expect(await claim()).toHaveLength(1);
    await db.exec(`update public.sig_notifications set claimed_at = now() - interval '11 minutes' where status = 'sending'`);
    expect(await claim()).toHaveLength(1);
  });

  it('descarta o que perdeu o sentido: já assinou, foi removido, documento arquivado, telefone apagado', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB, U.socioC]);
    await signAs(db, U.socioA, d.id);
    await rpc(db, U.admin, `public.sig_remove_recipient('${d.id}', '${U.socioB}')`);
    await db.exec(`update public.profiles set phone = null where id = '${U.socioC}'`);
    try {
      expect(await claim()).toHaveLength(0);
    } finally {
      await db.exec(`update public.profiles set phone = '85900000004' where id = '${U.socioC}'`);
    }
    const reasons = Object.fromEntries((await q<{ profile_id: string; skip_reason: string }>(db, `select profile_id, skip_reason from public.sig_notifications where document_id = '${d.id}'`)).map((r) => [r.profile_id, r.skip_reason]));
    expect(reasons[U.socioA]).toBe('already_signed');
    expect(reasons[U.socioB]).toBe('removed');
    expect(reasons[U.socioC]).toBe('no_phone');

    const arq = await publishedDoc(db, {}, [U.socioA]);
    await rpc(db, U.admin, `public.sig_archive('${arq.id}')`);
    expect(await claim()).toHaveLength(0);
  });
});

describe('lembretes (sig_svc_enqueue_reminders)', () => {
  /** Documento publicado há `publicadoHa` dias, com prazo daqui a `prazoEm` dias. */
  async function docComPrazo(publicadoHa: number, prazoEm: number) {
    const d = await publishedDoc(db, { due_at: inDays(40) }, [U.socioA, U.socioB]);
    await db.exec(`update public.sig_documents set published_at = now() - interval '${publicadoHa} days', due_at = now() + interval '${prazoEm} days' where id = '${d.id}';
      update public.sig_notifications set created_at = now() - interval '${publicadoHa} days' where document_id = '${d.id}'`);
    await db.exec(`delete from public.sig_notifications where document_id = '${d.id}'`);
    return d;
  }
  const reminders = (doc: string) =>
    q<{ profile_id: string; slot: string; status: string }>(db, `select profile_id, slot, status from public.sig_notifications where document_id = '${doc}' and kind = 'reminder' order by slot, profile_id`);

  it('longe do prazo não lembra ninguém', async () => {
    await docComPrazo(1, 20);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(0);
  });

  it('3 dias antes: um lembrete por pendente, uma vez só (rodar de novo não repete)', async () => {
    const d = await docComPrazo(10, 2.5);
    await signAs(db, U.socioA, d.id);
    await db.exec(`delete from public.sig_notifications where document_id = '${d.id}'`);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(1);
    const r = await reminders(d.id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ profile_id: U.socioB, status: 'queued' });
    expect(r[0].slot).toMatch(/^d-3@\d{4}-\d{2}-\d{2}$/);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(0);
    expect(await reminders(d.id)).toHaveLength(1);
  });

  it('no dia do prazo (depois das 8h de Fortaleza) sai o segundo lembrete', async () => {
    const d = await docComPrazo(10, 0.01);
    // prazo daqui a ~15 min: o dia do prazo em Fortaleza começa antes disso, mas só vale se já passou das 8h locais
    await db.exec(`update public.sig_documents set due_at = date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza' + interval '23 hours 59 minutes' where id = '${d.id}'`);
    const horaLocal = (await q<{ h: number }>(db, `select extract(hour from now() at time zone 'America/Fortaleza')::int h`))[0].h;
    const n = await svc<number>(db, `public.sig_svc_enqueue_reminders()`);
    const slots = (await reminders(d.id)).map((r) => r.slot.split('@')[0]);
    if (horaLocal >= 8) {
      expect(n).toBeGreaterThan(0);
      expect(slots).toContain('d0');
    } else {
      expect(slots).not.toContain('d0');
    }
  });

  it('nunca cola no aviso de publicação: documento recém-publicado com prazo curto não recebe lembrete', async () => {
    const d = await publishedDoc(db, { due_at: inDays(2) }, [U.socioA]);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(0);
    expect(await reminders(d.id)).toHaveLength(0);
  });

  it('quem acabou de ser avisado (publicação ou sócio novo) não recebe lembrete junto', async () => {
    const d = await docComPrazo(10, 2.5);
    await rpc(db, U.admin, `public.sig_add_recipients('${d.id}', array['${U.socioC}'::uuid])`);
    await svc<number>(db, `public.sig_svc_enqueue_reminders()`);
    const r = await reminders(d.id);
    expect(r.map((x) => x.profile_id)).toEqual([U.socioA, U.socioB].sort());
  });

  it('mudar o prazo reabre os lembretes; sem prazo ou vencido não lembra', async () => {
    const d = await docComPrazo(10, 2.5);
    await svc<number>(db, `public.sig_svc_enqueue_reminders()`);
    expect(await reminders(d.id)).toHaveLength(2);
    // O slot leva a DATA do prazo (Fortaleza): mudar o horário no mesmo dia não repete, mudar o dia reabre.
    await db.exec(`update public.sig_documents set due_at = now() + interval '1 day' where id = '${d.id}'`);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(2);
    await rpc(db, U.admin, `public.sig_update_due('${d.id}', null)`);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(0);
    await db.exec(`update public.sig_documents set due_at = now() - interval '1 day' where id = '${d.id}'`);
    expect(await svc<number>(db, `public.sig_svc_enqueue_reminders()`)).toBe(0);
  });

  it('lembrete segue o mesmo caminho da fila e some quando o sócio assina', async () => {
    const d = await docComPrazo(10, 2.5);
    await svc<number>(db, `public.sig_svc_enqueue_reminders()`);
    await signAs(db, U.socioA, d.id);
    const lote = await claim();
    expect(lote.map((n) => n.profile_id)).toEqual([U.socioB]);
    expect(lote[0].kind).toBe('reminder');
  });
});

describe('sócio novo (gatilho em profiles)', () => {
  async function novoSocio(n: number, role = 'socio', active = true) {
    await db.exec(`insert into auth.users(id) values ('${ID(n)}');
      insert into public.profiles(id, name, phone, role, is_active) values ('${ID(n)}', 'Novo ${n}', '8590000${n}', '${role}', ${active})`);
    return ID(n);
  }
  const recipientsOf = async (doc: string) => (await q<{ profile_id: string; source: string }>(db, `select profile_id, source from public.sig_recipients where document_id = '${doc}'`));

  it('entra no documento marcado "vale para sócio novo" e recebe o aviso', async () => {
    const d = await publishedDoc(db, { applies_to_new_members: true });
    const marcado = await novoSocio(41);
    expect(await recipientsOf(d.id)).toContainEqual({ profile_id: marcado, source: 'new_member' });
    const n = await q<{ kind: string; status: string }>(db, `select kind, status from public.sig_notifications where document_id = '${d.id}' and profile_id = '${marcado}'`);
    expect(n).toEqual([{ kind: 'new_member', status: 'queued' }]);
    const [c] = (await claim(100)).filter((x) => x.profile_id === marcado);
    expect(c.kind).toBe('new_member');
  });

  it('não entra em documento sem a marca, nem em modo escolhidos, nem sendo da lanchonete', async () => {
    const semMarca = await publishedDoc(db, {});
    const escolhidos = await publishedDoc(db, {}, [U.socioA]);
    const marcado = await publishedDoc(db, { applies_to_new_members: true });
    const lanch = await novoSocio(42, 'lanchonete');
    const inativo = await novoSocio(43, 'socio', false);
    for (const d of [semMarca, escolhidos, marcado]) {
      const ids = (await recipientsOf(d.id)).map((r) => r.profile_id);
      expect(ids).not.toContain(lanch);
      expect(ids).not.toContain(inativo);
    }
    const socio = await novoSocio(44);
    expect((await recipientsOf(semMarca.id)).map((r) => r.profile_id)).not.toContain(socio);
    expect((await recipientsOf(escolhidos.id)).map((r) => r.profile_id)).not.toContain(socio);
  });

  it('quem vira sócio depois (reativado ou promovido) também entra — e só uma vez', async () => {
    const d = await publishedDoc(db, { applies_to_new_members: true });
    const inativo = await novoSocio(45, 'socio', false);
    expect((await recipientsOf(d.id)).map((r) => r.profile_id)).not.toContain(inativo);
    await db.exec(`update public.profiles set is_active = true where id = '${inativo}'`);
    expect((await recipientsOf(d.id)).filter((r) => r.profile_id === inativo)).toHaveLength(1);
    await db.exec(`update public.profiles set is_active = false where id = '${inativo}'; update public.profiles set is_active = true where id = '${inativo}'`);
    expect((await q<{ n: string }>(db, `select count(*)::text n from public.sig_notifications where document_id = '${d.id}' and profile_id = '${inativo}'`))[0].n).toBe('1');
    const promovido = await novoSocio(46, 'lanchonete');
    await db.exec(`update public.profiles set role = 'socio' where id = '${promovido}'`);
    expect((await recipientsOf(d.id)).map((r) => r.profile_id)).toContain(promovido);
  });

  it('documento arquivado não pega sócio novo; falha do gatilho nunca barra o perfil', async () => {
    const d = await publishedDoc(db, { applies_to_new_members: true });
    await rpc(db, U.admin, `public.sig_archive('${d.id}')`);
    const depois = await novoSocio(47);
    expect((await recipientsOf(d.id)).map((r) => r.profile_id)).not.toContain(depois);

    // simula defeito no módulo: o cadastro do perfil continua funcionando
    await publishedDoc(db, { applies_to_new_members: true });
    await db.exec(`alter table public.sig_recipients rename to sig_recipients_off`);
    try {
      await novoSocio(48);
      expect((await q(db, `select 1 from public.profiles where id = '${ID(48)}'`))).toHaveLength(1);
    } finally {
      await db.exec(`alter table public.sig_recipients_off rename to sig_recipients`);
    }
  });
});
