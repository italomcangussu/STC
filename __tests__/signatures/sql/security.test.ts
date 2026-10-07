// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { U, asUser, asUserError, draftDoc, publishedDoc, putFile, q, rpc, rpcError, signAs, sha, svc, world } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await world();
}, 60000);

describe('quem pode chamar o quê', () => {
  it('sócio não chama função do administrador', async () => {
    expect(await rpcError(db, U.socioA, `public.sig_create_draft('{}'::jsonb)`)).toContain('SIG_FORBIDDEN');
    expect(await rpcError(db, U.socioA, `public.sig_publish('${U.admin}')`)).toContain('SIG_FORBIDDEN');
    expect(await rpcError(db, U.socioA, `public.sig_admin_recipients('${U.admin}')`)).toContain('SIG_FORBIDDEN');
    expect(await rpcError(db, U.socioA, `public.sig_verify_integrity('${U.admin}')`)).toContain('SIG_FORBIDDEN');
  });

  it('anônimo não chama nada', async () => {
    expect(await rpcError(db, null, `public.sig_my_documents()`)).toMatch(/permission denied/i);
    expect(await rpcError(db, null, `public.sig_create_draft('{}'::jsonb)`)).toMatch(/permission denied/i);
  });

  it('lanchonete não é sócio: não lista nem assina', async () => {
    expect(await rpcError(db, U.lanch, `public.sig_my_documents()`)).toContain('SIG_FORBIDDEN');
    expect(await rpcError(db, U.lanch, `public.sig_save_my_cpf('52998224725')`)).toContain('SIG_FORBIDDEN');
  });

  it('funções do servidor só existem para o service_role', async () => {
    const d = await publishedDoc(db);
    for (const uid of [U.admin, U.socioA, null]) {
      expect(await rpcError(db, uid, `public.sig_svc_issue_challenge('${U.socioA}', '${d.id}', '123456')`)).toMatch(/permission denied/i);
      expect(await rpcError(db, uid, `public.sig_svc_claim_notifications(5)`)).toMatch(/permission denied/i);
      expect(await rpcError(db, uid, `public.sig_svc_enqueue_reminders()`)).toMatch(/permission denied/i);
    }
    const r = await svc<number>(db, `public.sig_svc_enqueue_reminders()`);
    expect(r).toBe(0);
  });

  it('o schema privado não é alcançável pela API', async () => {
    expect(await asUserError(db, U.admin, `select * from sig_private.challenges`)).toMatch(/permission denied/i);
    expect(await asUserError(db, U.admin, `select sig_private.sha256_hex('x')`)).toMatch(/permission denied/i);
  });
});

describe('ninguém escreve direto nas tabelas', () => {
  it('nem o admin', async () => {
    const d = await publishedDoc(db);
    expect(await asUserError(db, U.admin, `update public.sig_documents set title = 'x' where id = '${d.id}'`)).toMatch(/permission denied/i);
    expect(await asUserError(db, U.admin, `delete from public.sig_documents where id = '${d.id}'`)).toMatch(/permission denied/i);
    expect(await asUserError(db, U.admin, `insert into public.sig_events(document_id, kind) values ('${d.id}', 'signed')`)).toMatch(/permission denied/i);
  });

  it('nem o sócio forja assinatura, evento ou CPF', async () => {
    const d = await publishedDoc(db);
    expect(await asUserError(db, U.socioA, `insert into public.sig_events(document_id, profile_id, kind) values ('${d.id}', '${U.socioA}', 'read_completed')`)).toMatch(/permission denied/i);
    expect(await asUserError(db, U.socioA, `update public.sig_recipients set signed_at = now() where document_id = '${d.id}'`)).toMatch(/permission denied/i);
    expect(await asUserError(db, U.socioA, `insert into public.sig_member_identities(profile_id, cpf) values ('${U.socioA}', '52998224725')`)).toMatch(/permission denied/i);
  });
});

describe('RLS: cada um vê só o que é seu', () => {
  it('rascunho só o admin vê; publicado só o destinatário', async () => {
    const draft = await draftDoc(db);
    const pub = await publishedDoc(db, {}, [U.socioA]);
    const idsAdmin = (await asUser<{ id: string }>(db, U.admin, `select id from public.sig_documents`)).map((r) => r.id);
    expect(idsAdmin).toEqual(expect.arrayContaining([draft.id, pub.id]));
    const idsA = (await asUser<{ id: string }>(db, U.socioA, `select id from public.sig_documents`)).map((r) => r.id);
    expect(idsA).toContain(pub.id);
    expect(idsA).not.toContain(draft.id);
    const idsB = (await asUser<{ id: string }>(db, U.socioB, `select id from public.sig_documents`)).map((r) => r.id);
    expect(idsB).not.toContain(pub.id);
  });

  it('sócio vê só a própria assinatura, o próprio CPF e os próprios destinatários', async () => {
    const d = await publishedDoc(db);
    await signAs(db, U.socioA, d.id);
    await signAs(db, U.socioB, d.id);
    const sigA = await asUser<{ profile_id: string }>(db, U.socioA, `select profile_id from public.sig_signatures where document_id = '${d.id}'`);
    expect(sigA.map((r) => r.profile_id)).toEqual([U.socioA]);
    const ids = await asUser<{ profile_id: string }>(db, U.socioA, `select profile_id from public.sig_member_identities`);
    expect(ids.map((r) => r.profile_id)).toEqual([U.socioA]);
    const rec = await asUser<{ profile_id: string }>(db, U.socioA, `select profile_id from public.sig_recipients where document_id = '${d.id}'`);
    expect(rec.map((r) => r.profile_id)).toEqual([U.socioA]);
    const adm = await asUser<{ n: string }>(db, U.admin, `select count(*)::text n from public.sig_signatures where document_id = '${d.id}'`);
    expect(Number(adm[0].n)).toBe(2);
  });

  it('eventos e fila de avisos só o admin lê', async () => {
    const d = await publishedDoc(db);
    expect(await asUser(db, U.socioA, `select 1 from public.sig_events`)).toHaveLength(0);
    expect(await asUser(db, U.socioA, `select 1 from public.sig_notifications`)).toHaveLength(0);
    const n = await asUser<{ n: string }>(db, U.admin, `select count(*)::text n from public.sig_notifications where document_id = '${d.id}'`);
    expect(Number(n[0].n)).toBeGreaterThan(0);
  });

  it('documento arquivado some para quem não assinou e continua para quem assinou', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    await signAs(db, U.socioA, d.id);
    await rpc(db, U.admin, `public.sig_archive('${d.id}')`);
    expect(await asUser(db, U.socioA, `select 1 from public.sig_documents where id = '${d.id}'`)).toHaveLength(1);
    expect(await asUser(db, U.socioB, `select 1 from public.sig_documents where id = '${d.id}'`)).toHaveLength(0);
    const mine = await rpc<unknown[]>(db, U.socioB, `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sig_my_documents() x where x.document_id = '${d.id}')`);
    expect(mine).toHaveLength(0);
  });
});

describe('bucket sig-docs', () => {
  it('é privado, só PDF e até 10 MB', async () => {
    const b = await q<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(db, `select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'sig-docs'`);
    expect(b[0].public).toBe(false);
    expect(Number(b[0].file_size_limit)).toBe(10485760);
    expect(b[0].allowed_mime_types).toEqual(['application/pdf']);
  });

  it('admin só envia para o caminho de um rascunho existente', async () => {
    const d = await draftDoc(db);
    expect(await asUserError(db, U.admin, `insert into storage.objects(bucket_id, name) values ('sig-docs', '${d.storage_path}')`)).toBeNull();
    expect(await asUserError(db, U.admin, `insert into storage.objects(bucket_id, name) values ('sig-docs', '${U.admin}/qualquer.pdf')`)).toMatch(/row-level security/i);
    expect(await asUserError(db, U.socioA, `insert into storage.objects(bucket_id, name) values ('sig-docs', '${draftPath(d.id)}')`)).toMatch(/row-level security/i);
  });

  it('sócio lê o arquivo só se for destinatário de documento publicado', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    expect(await asUser(db, U.socioA, `select 1 from storage.objects where name = '${d.storage_path}'`)).toHaveLength(1);
    expect(await asUser(db, U.socioB, `select 1 from storage.objects where name = '${d.storage_path}'`)).toHaveLength(0);
    expect(await asUser(db, U.admin, `select 1 from storage.objects where name = '${d.storage_path}'`)).toHaveLength(1);
    const draft = await draftDoc(db);
    await putFile(db, draft.storage_path);
    expect(await asUser(db, U.socioA, `select 1 from storage.objects where name = '${draft.storage_path}'`)).toHaveLength(0);
  });

  it('arquivo de documento publicado não se apaga; o de rascunho, sim', async () => {
    const pub = await publishedDoc(db);
    await asUser(db, U.admin, `delete from storage.objects where name = '${pub.storage_path}'`);
    expect(await q(db, `select 1 from storage.objects where name = '${pub.storage_path}'`)).toHaveLength(1);
    const draft = await draftDoc(db);
    await putFile(db, draft.storage_path);
    await asUser(db, U.admin, `delete from storage.objects where name = '${draft.storage_path}'`);
    expect(await q(db, `select 1 from storage.objects where name = '${draft.storage_path}'`)).toHaveLength(0);
  });
});

describe('imutabilidade', () => {
  it('documento publicado não muda título, hash nem arquivo; arquivado fica congelado', async () => {
    const d = await publishedDoc(db);
    expect(await asServiceError(`update public.sig_documents set title = 'Outro título' where id = '${d.id}'`)).toContain('SIG_DOCUMENT_IMMUTABLE');
    expect(await asServiceError(`update public.sig_documents set content_sha256 = '${sha(7)}', storage_path = '${d.id}/${sha(7)}.pdf' where id = '${d.id}'`)).toContain('SIG_DOCUMENT_IMMUTABLE');
    expect(await asServiceError(`delete from public.sig_documents where id = '${d.id}'`)).toContain('SIG_DOCUMENT_IMMUTABLE');
    expect(await asServiceError(`update public.sig_documents set status = 'draft' where id = '${d.id}'`)).toContain('SIG_BAD_TRANSITION');
    await rpc(db, U.admin, `public.sig_archive('${d.id}')`);
    expect(await asServiceError(`update public.sig_documents set status = 'published' where id = '${d.id}'`)).toContain('SIG_DOCUMENT_ARCHIVED');
    expect(await asServiceError(`update public.sig_documents set due_at = now() + interval '9 days' where id = '${d.id}'`)).toContain('SIG_DOCUMENT_ARCHIVED');
  });

  it('assinatura e eventos são append-only, até para o dono do banco', async () => {
    const d = await publishedDoc(db);
    await signAs(db, U.socioA, d.id);
    expect(await ownerError(`update public.sig_signatures set signer_name = 'Fraude' where document_id = '${d.id}'`)).toContain('SIG_APPEND_ONLY');
    expect(await ownerError(`delete from public.sig_signatures where document_id = '${d.id}'`)).toContain('SIG_APPEND_ONLY');
    // Sem CASCADE o Postgres já barra (FK de `sig_recipients`); com CASCADE quem barra é o gatilho.
    expect(await ownerError(`truncate public.sig_signatures`)).toMatch(/SIG_APPEND_ONLY|foreign key/);
    expect(await ownerError(`truncate public.sig_signatures cascade`)).toContain('SIG_APPEND_ONLY');
    expect(await ownerError(`update public.sig_events set kind = 'viewed'`)).toContain('SIG_APPEND_ONLY');
    expect(await ownerError(`delete from public.sig_events`)).toContain('SIG_APPEND_ONLY');
    expect(await ownerError(`truncate public.sig_events`)).toContain('SIG_APPEND_ONLY');
  });

  it('documento com assinatura não pode ser apagado nem pela cascata de rascunho', async () => {
    const d = await publishedDoc(db);
    await signAs(db, U.socioA, d.id);
    expect(await ownerError(`delete from public.sig_documents where id = '${d.id}'`)).toContain('SIG_DOCUMENT_IMMUTABLE');
  });

  it('apagar o perfil do sócio não apaga a prova', async () => {
    const d = await publishedDoc(db);
    await signAs(db, U.socioC, d.id);
    await db.exec(`delete from public.profiles where id = '${U.socioC}'`).catch(() => null);
    const sig = await q<{ signer_name: string }>(db, `select signer_name from public.sig_signatures where document_id = '${d.id}' and profile_id = '${U.socioC}'`);
    expect(sig[0].signer_name).toBe('Carla Sócia');
  });
});

const draftPath = (id: string) => `${id}/${sha(5)}.pdf`;

async function ownerError(sql: string): Promise<string> {
  try {
    await db.exec(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}
const asServiceError = ownerError;
