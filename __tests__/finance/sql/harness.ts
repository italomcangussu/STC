// @vitest-environment node
/**
 * Harness dos testes SQL do financeiro.
 *
 * Sobe um Postgres em memória (PGlite) com:
 *  1. o mínimo do Supabase (roles, `auth.uid()`, `storage`);
 *  2. as tabelas do STC de que o financeiro depende, com as colunas que as
 *     migrations versionadas definem (`profiles`, `professors`, `non_socio_students`,
 *     `student_payments`, `reservations`, `student_profiles`, `is_admin()`);
 *  3. a migration REAL de auditoria do STC (`admin_audit_logs`);
 *  4. as migrations novas do financeiro, em ordem.
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
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.role() to anon, authenticated;

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
create type payment_status_type as enum ('paid', 'pending', 'exempt');

create table public.profiles(
  id uuid primary key references auth.users(id), name text not null, email text, phone text,
  role user_role default 'socio', balance numeric default 0, avatar_url text, category text,
  is_professor boolean default false, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now());
create function public.is_admin() returns boolean language plpgsql security definer as $$
begin return exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); end $$;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (true);

create table public.professors(
  id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), name text not null,
  bio text, is_active boolean default true, created_at timestamptz default now());
create table public.non_socio_students(
  id uuid primary key default gen_random_uuid(), name text not null, phone text,
  professor_id uuid references public.professors(id), plan_type text default 'Day Card', plan_status text default 'inactive',
  master_expiration_date date, student_type text default 'regular', responsible_socio_id uuid references public.profiles(id),
  relationship_type text, is_active boolean default true);
create table public.student_payments(
  id uuid primary key default gen_random_uuid(), student_id uuid references public.non_socio_students(id) on delete cascade,
  amount numeric(10, 2) default 200.00, payment_date timestamptz default now(), valid_until timestamptz not null,
  approved_by uuid references public.profiles(id), created_at timestamptz default now(),
  status varchar(20) default 'active' check (status in ('active', 'cancelled')), cancelled_reason text,
  related_payment_id uuid references public.student_payments(id) on delete set null);
create table public.reservations(
  id uuid primary key default gen_random_uuid(), court_id uuid, creator_id uuid references public.profiles(id),
  date date not null, start_time time not null default '08:00', end_time time not null default '09:00',
  type text not null, status text default 'active', observation text,
  professor_id uuid references public.professors(id), student_id uuid,
  participant_ids uuid[] default '{}', guest_name text, guest_responsible_id uuid, student_type text,
  non_socio_student_id text, non_socio_student_ids uuid[], payment_status payment_status_type default 'paid',
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.student_profiles(
  id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id),
  non_socio_student_id uuid references public.non_socio_students(id), student_status text not null default 'active',
  professor_id uuid references public.professors(id));
-- Políticas reais do STC que o financeiro NÃO muda (ver supabase/migrations/20260212105246).
alter table public.student_payments enable row level security;
grant select on public.student_payments to authenticated;
create policy "Admins can manage payments" on public.student_payments for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin'));
create policy "Professors can view own student payments" on public.student_payments for select
  using (exists (select 1 from public.non_socio_students s join public.professors p on s.professor_id = p.id
    where s.id = student_payments.student_id and p.user_id = auth.uid()));
alter table public.reservations enable row level security;
grant select on public.reservations to authenticated;
create policy reservations_read on public.reservations for select using (true);
alter table public.professors enable row level security;
grant select on public.professors to authenticated;
create policy professors_read on public.professors for select using (true);
alter table public.non_socio_students enable row level security;
grant select on public.non_socio_students to authenticated;
create policy students_read on public.non_socio_students for select using (true);
`;

export async function newDb(opts: { only?: string[] } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE);
  // Auditoria real do STC (cria admin_audit_logs e admin_audit_insert_log).
  await db.exec(await readFile(resolve(MIGRATIONS, '20260427134500_admin_audit_logs.sql'), 'utf8'));
  const files = (await readdir(MIGRATIONS)).filter((f) => /^2026100[67]\d{6}_finance_.*\.sql$/.test(f)).sort();
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
  prof: ID(4),
  lanch: ID(5),
  profOther: ID(6),
};

let seq = 100000;
export const key = () => ID(seq++);

/** Cria usuários do STC: admin, dois sócios, dois professores e um da lanchonete. */
export async function seedPeople(db: PGlite) {
  await db.exec(`
    insert into auth.users(id) values ('${U.admin}'),('${U.socioA}'),('${U.socioB}'),('${U.prof}'),('${U.lanch}'),('${U.profOther}');
    insert into public.profiles(id, name, role, is_professor, is_active) values
      ('${U.admin}', 'Admin Clube', 'admin', false, true),
      ('${U.socioA}', 'Ana Sócia', 'socio', false, true),
      ('${U.socioB}', 'Beto Sócio', 'socio', false, true),
      ('${U.prof}', 'Paulo Professor', 'socio', true, true),
      ('${U.lanch}', 'Lia Lanchonete', 'lanchonete', false, true),
      ('${U.profOther}', 'Olga Professora', 'socio', true, true);
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

/** Como `asUser`, mas devolve o erro (código/mensagem) em vez de lançar. */
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

/** Mensagem do erro lançado (ex.: 'FINANCE_FORBIDDEN') ou `null` se a chamada passou. */
export async function rpcError(db: PGlite, uid: string | null, call: string): Promise<string | null> {
  return asUserError(db, uid, `select ${call} as r`);
}

export const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

/** Versão atual de `fin_settings`, lida no banco: não depende de quantas migrations já subiram a versão. */
export const SETTINGS_VERSION = '(select version from public.fin_settings)';

/** "Hoje" do banco (Fortaleza). */
export async function dbToday(db: PGlite): Promise<string> {
  return (await q<{ d: string }>(db, `select fin_private.today()::text d`))[0].d;
}

/** Mundo mínimo: pessoas + conta padrão de recebimentos. */
export async function world() {
  const db = await newDb();
  await seedPeople(db);
  const acc = await rpc<{ id: string }>(db, U.admin,
    `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
  return { db, account: acc.id };
}
