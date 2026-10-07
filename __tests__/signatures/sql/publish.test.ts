// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { CPF, ID, U, draftDoc, inDays, j, publishedDoc, putFile, q, rpc, rpcError, sha, signAs, world } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await world();
  // Sócio inativo (saiu do clube): nunca recebe documento.
  await db.exec(`insert into auth.users(id) values ('${ID(90)}');
    insert into public.profiles(id, name, phone, role, is_active) values ('${ID(90)}', 'Inativo Antigo', '85900000090', 'socio', false)`);
}, 60000);

type Notif = { profile_id: string; kind: string; slot: string; status: string; skip_reason: string | null };
const notifs = (id: string) =>
  q<Notif>(db, `select profile_id, kind, slot, status, skip_reason from public.sig_notifications where document_id = '${id}' order by profile_id`);
const recipients = async (id: string) =>
  (await q<{ profile_id: string }>(db, `select profile_id from public.sig_recipients where document_id = '${id}'`)).map((r) => r.profile_id).sort();

describe('rascunho', () => {
  it('nasce versão 1, no caminho <id>/<sha256>.pdf, com o título aparado', async () => {
    const d = await draftDoc(db, { title: '  Estatuto do clube  ', description: 'Leia com atenção', due_at: inDays(10) });
    expect(d.version).toBe(1);
    expect(d.storage_path).toMatch(new RegExp(`^${d.id}/[0-9a-f]{64}\\.pdf$`));
    const row = (await q<{ title: string; status: string; created_by: string }>(db, `select title, status, created_by from public.sig_documents where id = '${d.id}'`))[0];
    expect(row).toEqual({ title: 'Estatuto do clube', status: 'draft', created_by: U.admin });
  });

  it('recusa dados inválidos', async () => {
    const base = { title: 'Termo válido', file_name: 'a.pdf', size_bytes: 1000, page_count: 2, content_sha256: sha(1) };
    const err = (over: Record<string, unknown>) => rpcError(db, U.admin, `public.sig_create_draft(${j({ ...base, ...over })})`);
    expect(await err({ title: 'ab' })).toMatch(/check constraint/);
    expect(await err({ content_sha256: 'xyz' })).toMatch(/check constraint/);
    expect(await err({ size_bytes: 10485761 })).toMatch(/check constraint/);
    expect(await err({ page_count: 0 })).toMatch(/check constraint/);
    expect(await err({ audience_mode: 'ninguem' })).toMatch(/check constraint/);
    expect(await err({ replaces_id: ID(77) })).toContain('SIG_REPLACES_INVALID');
  });

  it('edita título e prazo; trocar o PDF muda o caminho e avisa o antigo', async () => {
    const d = await draftDoc(db);
    const a = await rpc<{ storage_path: string; previous_storage_path: string | null }>(db, U.admin,
      `public.sig_update_draft('${d.id}', ${j({ title: 'Título novo', due_at: inDays(5) })})`);
    expect(a.storage_path).toBe(d.storage_path);
    expect(a.previous_storage_path).toBeNull();
    const b = await rpc<{ storage_path: string; previous_storage_path: string }>(db, U.admin,
      `public.sig_update_draft('${d.id}', ${j({ content_sha256: sha(55), file_name: 'novo.pdf', size_bytes: 5000, page_count: 7 })})`);
    expect(b.storage_path).toBe(`${d.id}/${sha(55)}.pdf`);
    expect(b.previous_storage_path).toBe(d.storage_path);
    const row = (await q<{ title: string; page_count: number }>(db, `select title, page_count from public.sig_documents where id = '${d.id}'`))[0];
    expect(row).toEqual({ title: 'Título novo', page_count: 7 });
    expect(await rpcError(db, U.admin, `public.sig_update_draft('${d.id}', ${j({ content_sha256: sha(56) })})`)).toContain('SIG_FILE_DATA_REQUIRED');
  });

  it('só rascunho se edita ou apaga', async () => {
    const d = await publishedDoc(db);
    expect(await rpcError(db, U.admin, `public.sig_update_draft('${d.id}', ${j({ title: 'Outro título' })})`)).toContain('SIG_DOCUMENT_IMMUTABLE');
    expect(await rpcError(db, U.admin, `public.sig_delete_draft('${d.id}')`)).toContain('SIG_DOCUMENT_IMMUTABLE');
  });

  it('apagar o rascunho devolve o caminho do arquivo', async () => {
    const d = await draftDoc(db);
    expect(await rpc<string>(db, U.admin, `public.sig_delete_draft('${d.id}')`)).toBe(d.storage_path);
    expect(await q(db, `select 1 from public.sig_documents where id = '${d.id}'`)).toHaveLength(0);
  });

  it('"vale para sócio novo" só no modo todos', async () => {
    const d = await draftDoc(db, { audience_mode: 'selected', applies_to_new_members: true });
    expect((await q<{ applies_to_new_members: boolean }>(db, `select applies_to_new_members from public.sig_documents where id = '${d.id}'`))[0].applies_to_new_members).toBe(false);
    expect(await rpcError(db, U.admin, `public.sig_set_new_members('${d.id}', true)`)).toContain('SIG_NEW_MEMBERS_NEEDS_ALL');
    const todos = await draftDoc(db, { applies_to_new_members: true });
    expect((await q<{ applies_to_new_members: boolean }>(db, `select applies_to_new_members from public.sig_documents where id = '${todos.id}'`))[0].applies_to_new_members).toBe(true);
    await rpc(db, U.admin, `public.sig_update_draft('${todos.id}', ${j({ audience_mode: 'selected' })})`);
    expect((await q<{ applies_to_new_members: boolean }>(db, `select applies_to_new_members from public.sig_documents where id = '${todos.id}'`))[0].applies_to_new_members).toBe(false);
  });
});

describe('destinatários do rascunho', () => {
  it('só no modo escolhidos, só sócios ativos, e a lista substitui a anterior', async () => {
    const todos = await draftDoc(db);
    expect(await rpcError(db, U.admin, `public.sig_set_recipients('${todos.id}', array['${U.socioA}'::uuid])`)).toContain('SIG_NOT_SELECTED_MODE');
    const d = await draftDoc(db, { audience_mode: 'selected' });
    expect(await rpcError(db, U.admin, `public.sig_set_recipients('${d.id}', array['${U.lanch}'::uuid])`)).toContain('SIG_RECIPIENT_INVALID');
    expect(await rpcError(db, U.admin, `public.sig_set_recipients('${d.id}', array['${ID(90)}'::uuid])`)).toContain('SIG_RECIPIENT_INVALID');
    expect(await rpc<number>(db, U.admin, `public.sig_set_recipients('${d.id}', array['${U.socioA}'::uuid, '${U.socioB}'::uuid, '${U.socioA}'::uuid])`)).toBe(2);
    expect(await rpc<number>(db, U.admin, `public.sig_set_recipients('${d.id}', array['${U.socioC}'::uuid])`)).toBe(1);
    expect(await recipients(d.id)).toEqual([U.socioC]);
  });
});

describe('publicar', () => {
  it('exige o arquivo no bucket, destinatário e prazo futuro', async () => {
    const semArquivo = await draftDoc(db);
    expect(await rpcError(db, U.admin, `public.sig_publish('${semArquivo.id}')`)).toContain('SIG_FILE_MISSING');

    const semGente = await draftDoc(db, { audience_mode: 'selected' });
    await putFile(db, semGente.storage_path);
    expect(await rpcError(db, U.admin, `public.sig_publish('${semGente.id}')`)).toContain('SIG_NO_RECIPIENTS');

    const vencido = await draftDoc(db, { due_at: inDays(-1) });
    await putFile(db, vencido.storage_path);
    expect(await rpcError(db, U.admin, `public.sig_publish('${vencido.id}')`)).toContain('SIG_DUE_IN_PAST');
    expect(await rpcError(db, U.admin, `public.sig_publish('${ID(77)}')`)).toContain('SIG_NOT_FOUND');
  });

  it('modo todos: vale para sócios ativos e admin, não para lanchonete nem inativo', async () => {
    const d = await publishedDoc(db, { due_at: inDays(15) });
    expect(await recipients(d.id)).toEqual([U.admin, U.socioA, U.socioB, U.socioC, U.semFone].sort());
    expect(d.recipients).toBe(5);
  });

  it('enfileira o aviso de WhatsApp de cada um; sem telefone fica registrado como pulado', async () => {
    const d = await publishedDoc(db);
    expect(d.queued).toBe(4);
    expect(d.skipped_no_phone).toBe(1);
    const n = await notifs(d.id);
    expect(n).toHaveLength(5);
    expect(n.every((x) => x.kind === 'publish' && x.slot === '')).toBe(true);
    expect(n.filter((x) => x.status === 'queued')).toHaveLength(4);
    expect(n.find((x) => x.profile_id === U.semFone)).toMatchObject({ status: 'skipped', skip_reason: 'no_phone' });
  });

  it('modo escolhidos: só os escolhidos', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    expect(await recipients(d.id)).toEqual([U.socioA, U.socioB].sort());
    expect(d.queued).toBe(2);
  });

  it('publicar de novo é recusado e não duplica aviso', async () => {
    const d = await publishedDoc(db);
    expect(await rpcError(db, U.admin, `public.sig_publish('${d.id}')`)).toContain('SIG_ALREADY_PUBLISHED');
    expect(await notifs(d.id)).toHaveLength(5);
  });

  it('grava a auditoria da publicação com resumo', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    const logs = await q<{ action: string; source: string; new_data: Record<string, unknown> }>(db,
      `select action, source, new_data from public.admin_audit_logs where record_id = '${d.id}' and source = 'signatures' order by occurred_at`);
    const acts = logs.map((l) => l.action);
    expect(acts).toContain('sig.create_draft');
    expect(acts).toContain('sig.publish');
    expect(acts).toContain('sig.publish_summary');
    expect(logs.find((l) => l.action === 'sig.publish_summary')!.new_data).toMatchObject({ recipients: 1, queued: 1 });
  });

  it('a auditoria da assinatura guarda o hash, não o CPF nem o telefone', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await signAs(db, U.socioA, d.id);
    const logs = await q<{ action: string; new_data: Record<string, unknown> }>(db,
      `select action, new_data from public.admin_audit_logs where table_name = 'sig_signatures' and new_data->>'document_id' = '${d.id}'`);
    expect(logs.map((l) => l.action)).toEqual(['sig.sign']);
    expect(Object.keys(logs[0].new_data).sort()).toEqual(['document_id', 'document_sha256', 'evidence_hash', 'id', 'seq', 'signed_at']);
    expect(JSON.stringify(logs[0].new_data)).not.toMatch(new RegExp(`${CPF.a}|85900000002`));
  });
});

describe('nova versão', () => {
  it('publicar a versão 2 arquiva a 1, mantém as assinaturas dela e descarta avisos pendentes', async () => {
    const v1 = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    await signAs(db, U.socioA, v1.id);
    const v2draft = await draftDoc(db, { replaces_id: v1.id, title: 'Termo de uso (revisado)' });
    expect(v2draft.version).toBe(2);
    await putFile(db, v2draft.storage_path);
    await rpc(db, U.admin, `public.sig_publish('${v2draft.id}')`);
    const old = (await q<{ status: string; archived_reason: string }>(db, `select status, archived_reason from public.sig_documents where id = '${v1.id}'`))[0];
    expect(old).toEqual({ status: 'archived', archived_reason: 'replaced' });
    expect((await q(db, `select 1 from public.sig_signatures where document_id = '${v1.id}'`))).toHaveLength(1);
    const pendentes = (await notifs(v1.id)).filter((n) => n.status === 'queued');
    expect(pendentes).toHaveLength(0);
  });
});

describe('depois de publicado', () => {
  it('inclui sócios novos e avisa só os incluídos', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    const r = await rpc<{ added: number; queued: number }>(db, U.admin, `public.sig_add_recipients('${d.id}', array['${U.socioA}'::uuid, '${U.socioB}'::uuid])`);
    expect(r).toMatchObject({ added: 1, queued: 1 });
    expect(await notifs(d.id)).toHaveLength(2);
    expect(await rpcError(db, U.admin, `public.sig_add_recipients('${d.id}', array['${U.lanch}'::uuid])`)).toContain('SIG_RECIPIENT_INVALID');
    const semFone = await rpc<{ added: number; skipped_no_phone: number }>(db, U.admin, `public.sig_add_recipients('${d.id}', array['${U.semFone}'::uuid])`);
    expect(semFone).toMatchObject({ added: 1, skipped_no_phone: 1 });
  });

  it('tira quem não assinou; quem já assinou fica', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    await signAs(db, U.socioA, d.id);
    expect(await rpcError(db, U.admin, `public.sig_remove_recipient('${d.id}', '${U.socioA}')`)).toContain('SIG_ALREADY_SIGNED');
    await rpc(db, U.admin, `public.sig_remove_recipient('${d.id}', '${U.socioB}')`);
    expect(await recipients(d.id)).toEqual([U.socioA]);
    expect((await notifs(d.id)).find((n) => n.profile_id === U.socioB)).toMatchObject({ status: 'skipped', skip_reason: 'removed' });
  });

  it('muda o prazo (futuro) ou o remove', async () => {
    const d = await publishedDoc(db, { due_at: inDays(10) });
    expect(await rpcError(db, U.admin, `public.sig_update_due('${d.id}', now() - interval '1 hour')`)).toContain('SIG_DUE_IN_PAST');
    await rpc(db, U.admin, `public.sig_update_due('${d.id}', '${inDays(20)}')`);
    await rpc(db, U.admin, `public.sig_update_due('${d.id}', null)`);
    expect((await q<{ due_at: string | null }>(db, `select due_at from public.sig_documents where id = '${d.id}'`))[0].due_at).toBeNull();
  });

  it('arquivar descarta avisos pendentes e não se repete', async () => {
    const d = await publishedDoc(db);
    await rpc(db, U.admin, `public.sig_archive('${d.id}', 'não vale mais')`);
    expect((await notifs(d.id)).filter((n) => n.status === 'queued')).toHaveLength(0);
    expect((await q<{ archived_reason: string }>(db, `select archived_reason from public.sig_documents where id = '${d.id}'`))[0].archived_reason).toBe('não vale mais');
    expect(await rpcError(db, U.admin, `public.sig_archive('${d.id}')`)).toContain('SIG_NOT_PUBLISHED');
    expect(await rpcError(db, U.admin, `public.sig_update_due('${d.id}', null)`)).toContain('SIG_NOT_PUBLISHED');
  });

  it('"reenviar falhas" recoloca na fila só o que falhou e ainda não assinou', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB, U.socioC]);
    await db.exec(`update public.sig_notifications set status = 'failed', attempts = 3, error = 'timeout' where document_id = '${d.id}' and profile_id in ('${U.socioA}', '${U.socioB}')`);
    await db.exec(`update public.sig_notifications set status = 'sent', sent_at = now() where document_id = '${d.id}' and profile_id = '${U.socioC}'`);
    await signAs(db, U.socioB, d.id);
    expect(await rpc<number>(db, U.admin, `public.sig_resend_failed('${d.id}')`)).toBe(1);
    const n = await notifs(d.id);
    expect(n.find((x) => x.profile_id === U.socioA)!.status).toBe('queued');
    expect(n.find((x) => x.profile_id === U.socioC)!.status).toBe('sent');
  });
});

describe('acompanhamento do admin', () => {
  it('visão geral e lista de destinatários trazem quem assinou, quem falta e o estado do aviso', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB, U.semFone]);
    await signAs(db, U.socioA, d.id);
    const ov = (await q<Record<string, string>>(db, `select recipients::text, signed::text, no_phone::text, status from public.sig_documents_overview where id = '${d.id}'`))[0];
    expect(ov).toMatchObject({ recipients: '3', signed: '1', no_phone: '1', status: 'published' });
    const lista = await rpc<unknown[]>(db, U.admin, `(select jsonb_agg(to_jsonb(x)) from public.sig_admin_recipients('${d.id}') x)`);
    expect(lista).toHaveLength(3);
    expect((lista as Array<{ profile_id: string; notification_status: string }>).find((x) => x.profile_id === U.semFone)!.notification_status).toBe('skipped');
    // o primeiro da lista é quem ainda não assinou
    expect((lista as Array<{ signed_at: string | null }>)[0].signed_at).toBeNull();
  });

  it('o sócio não enxerga a visão geral dos outros', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    const rows = await rpc<unknown[]>(db, U.socioA, `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sig_documents_overview x where x.id = '${d.id}')`);
    expect(rows as Array<{ recipients: number }>).toHaveLength(1);
    expect((rows as Array<{ recipients: number }>)[0].recipients).toBe(1);
  });
});
