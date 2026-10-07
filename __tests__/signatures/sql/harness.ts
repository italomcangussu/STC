// @vitest-environment node
/**
 * Harness dos testes SQL de Documentos e Assinaturas.
 *
 * Sobe um Postgres em memória (PGlite) com:
 *  1. o mínimo do Supabase (roles, `auth.uid()`, `storage`);
 *  2. `profiles` e `is_admin()` como o STC define;
 *  3. a migration REAL de auditoria do STC (`admin_audit_logs`);
 *  4. as migrations de assinaturas, em ordem.
 *
 * Nada aqui toca o banco remoto.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../../supabase/migrations');

const BASE = `
create role anon;
create role authenticated;
create role service_role bypassrls;

create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select case when auth.uid() is null then 'anon' else 'authenticated' end $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[]; begin parts := string_to_array(name, '/'); return parts[1:array_length(parts, 1) - 1]; end $$;

create type user_role as enum ('admin', 'socio', 'lanchonete');

create table public.profiles(
  id uuid primary key references auth.users(id), name text not null, email text, phone text,
  role user_role default 'socio', avatar_url text, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now());
create function public.is_admin() returns boolean language plpgsql security definer as $$
begin return exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); end $$;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (true);
`;

export async function newDb(opts: { only?: string[] } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE);
  // Auditoria real do STC (cria admin_audit_logs e admin_audit_insert_log).
  await db.exec(await readFile(resolve(MIGRATIONS, '20260427134500_admin_audit_logs.sql'), 'utf8'));
  const files = (await readdir(MIGRATIONS)).filter((f) => /^202610071\d{5}_signatures_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (opts.only && !opts.only.some((o) => f.includes(o))) continue;
    try {
      await db.exec(await readFile(resolve(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      throw new Error(`Falha ao aplicar ${f}: ${(e as Error).message}`);
    }
  }
  return db;
}

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const U = {
  admin: ID(1),
  socioA: ID(2),
  socioB: ID(3),
  socioC: ID(4),
  lanch: ID(5),
  semFone: ID(6),
};

/** CPFs válidos (dígitos verificadores corretos) para os testes. */
export const CPF = { a: '52998224725', b: '11144477735', c: '39053344705', admin: '12345678909', semFone: '98765432100' };

/** CPF válido de cada pessoa do mundo de teste (assim ninguém troca de CPF no meio). */
export const cpfOf = (uid: string) =>
  ({ [U.admin]: CPF.admin, [U.socioA]: CPF.a, [U.socioB]: CPF.b, [U.socioC]: CPF.c, [U.semFone]: CPF.semFone } as Record<string, string>)[uid] ?? CPF.a;

/** Cria usuários do STC: admin, três sócios com telefone, um sem telefone e um da lanchonete. */
export async function seedPeople(db: PGlite) {
  await db.exec(`
    insert into auth.users(id) values ('${U.admin}'),('${U.socioA}'),('${U.socioB}'),('${U.socioC}'),('${U.lanch}'),('${U.semFone}');
    insert into public.profiles(id, name, phone, role, is_active) values
      ('${U.admin}', 'Admin Clube', '85900000001', 'admin', true),
      ('${U.socioA}', 'Ana Sócia', '85900000002', 'socio', true),
      ('${U.socioB}', 'Beto Sócio', '85900000003', 'socio', true),
      ('${U.socioC}', 'Carla Sócia', '85900000004', 'socio', true),
      ('${U.lanch}', 'Lia Lanchonete', '85900000005', 'lanchonete', true),
      ('${U.semFone}', 'Sem Telefone', null, 'socio', true);
  `);
}

/** Executa como um usuário real: papel `authenticated` + RLS valendo. */
export async function asUser<T = Record<string, unknown>>(db: PGlite, uid: string | null, sql: string): Promise<T[]> {
  await db.exec(uid ? `set role authenticated; set request.jwt.claim.sub = '${uid}';` : `set role anon; reset request.jwt.claim.sub;`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub;');
  }
}

/** Executa como `service_role` (edge functions): sem usuário logado. */
export async function asService<T = Record<string, unknown>>(db: PGlite, sql: string): Promise<T[]> {
  await db.exec(`set role service_role; reset request.jwt.claim.sub;`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

export async function asUserError(db: PGlite, uid: string | null, sql: string): Promise<string | null> {
  try {
    await asUser(db, uid, sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export const q = async <T = Record<string, unknown>>(db: PGlite, sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

/** Chama uma função `select ... r` como o usuário e devolve o jsonb `r`. */
export async function rpc<T = Record<string, any>>(db: PGlite, uid: string | null, call: string): Promise<T> {
  const rows = await asUser<{ r: T }>(db, uid, `select ${call} as r`);
  return rows[0].r;
}

/** Mensagem do erro lançado (ex.: 'SIG_FORBIDDEN') ou `null` se a chamada passou. */
export async function rpcError(db: PGlite, uid: string | null, call: string): Promise<string | null> {
  return asUserError(db, uid, `select ${call} as r`);
}

/** Chama uma função `sig_svc_*` como service_role. */
export async function svc<T = Record<string, any>>(db: PGlite, call: string): Promise<T> {
  const rows = await asService<{ r: T }>(db, `select ${call} as r`);
  return rows[0].r;
}

export const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

export const sha = (n: number) => n.toString(16).padStart(64, '0');

/** Mundo mínimo: pessoas. */
export async function world() {
  const db = await newDb();
  await seedPeople(db);
  return db;
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
export const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

let docSeq = 1;

/** Rascunho criado pelo admin. Cada chamada gera um hash novo (caminho distinto). */
export async function draftDoc(db: PGlite, over: Record<string, unknown> = {}) {
  const n = docSeq++;
  const r = await rpc<{ id: string; storage_path: string; version: number }>(db, U.admin,
    `public.sig_create_draft(${j({ title: `Termo de uso ${n}`, file_name: `termo-${n}.pdf`, size_bytes: 120000, page_count: 3,
      content_sha256: sha(1000 + n), ...over })})`);
  return r;
}

/** Simula o upload do PDF para o bucket (o app faz isso pela API de storage). */
export async function putFile(db: PGlite, path: string) {
  await db.exec(`insert into storage.objects(bucket_id, name) values ('sig-docs', '${path}')`);
}

/** Documento publicado. `selected` define os destinatários (modo 'selected'); sem ele, vale para todos. */
export async function publishedDoc(db: PGlite, over: Record<string, unknown> = {}, selected?: string[]) {
  const d = await draftDoc(db, selected ? { audience_mode: 'selected', ...over } : over);
  if (selected) await rpc(db, U.admin, `public.sig_set_recipients('${d.id}', array[${selected.map((s) => `'${s}'::uuid`).join(',')}])`);
  await putFile(db, d.storage_path);
  const pub = await rpc<{ recipients: number; queued: number; skipped_no_phone: number }>(db, U.admin, `public.sig_publish('${d.id}')`);
  return { ...d, ...pub };
}

/** O que o app faz no leitor: abrir, rolar até o fim, marcar "li e concordo". */
export async function readAndConsent(db: PGlite, uid: string, docId: string, pages = 3) {
  await rpc(db, uid, `public.sig_log_event('${docId}', 'viewed')`);
  await rpc(db, uid, `public.sig_log_event('${docId}', 'read_started')`);
  await rpc(db, uid, `public.sig_log_event('${docId}', 'read_completed', ${j({ pages_seen: pages, pages_total: pages })})`);
  await rpc(db, uid, `public.sig_log_event('${docId}', 'consent_checked')`);
}

export async function saveCpf(db: PGlite, uid: string, cpf: string) {
  await rpc(db, uid, `public.sig_save_my_cpf('${cpf}')`);
}

/** Edge function pedindo o desafio do código. */
export const issue = (db: PGlite, uid: string, docId: string, code = '123456', evidence: unknown = {}) =>
  svc<Record<string, any>>(db, `public.sig_svc_issue_challenge('${uid}', '${docId}', '${code}', ${j(evidence)}, '203.0.113.7', 'Mozilla/5.0 teste')`);

/** Edge function conferindo o código digitado. */
export const verify = (db: PGlite, uid: string, challenge: string, code: string, geo: unknown = { city: 'Fortaleza', region: 'CE', country: 'BR' }) =>
  svc<Record<string, any>>(db, `public.sig_svc_verify_code('${challenge}', '${uid}', '${code}', '203.0.113.8', 'Mozilla/5.0 teste', ${j(geo)}, ${j({ timezone: 'America/Fortaleza' })})`);

/** Caminho feliz completo de um sócio: leitura, aceite, CPF, código certo. Devolve o resultado da verificação. */
export async function signAs(db: PGlite, uid: string, docId: string, cpf = cpfOf(uid), code = '482913') {
  await readAndConsent(db, uid, docId);
  await saveCpf(db, uid, cpf);
  const ch = await issue(db, uid, docId, code);
  await svc(db, `public.sig_svc_mark_code_sent('${ch.challenge_id}', 'wamid.${code}')`);
  return verify(db, uid, ch.challenge_id, code);
}
