// @vitest-environment node
/**
 * Harness dos testes SQL de Conversas.
 *
 * Sobe o mesmo Postgres em memória (PGlite) do financeiro — roles do Supabase, `auth.uid()`, `storage`, as
 * tabelas do STC de que o módulo depende, a auditoria REAL e as migrations do financeiro (as automações leem
 * `fin_private.charge_rows`) — e acrescenta as tabelas de quadras e campeonatos com as colunas que as migrations
 * versionadas e o código do app usam. Depois aplica as migrations NOVAS de Conversas, em ordem.
 *
 * Nada aqui toca o banco remoto.
 */
import type { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { newDb as newFinanceDb, ID, U, key, seedPeople, asUser, asUserError, q, rpc, rpcError, j } from '../../finance/sql/harness';

export { ID, U, key, seedPeople, asUser, asUserError, q, rpc, rpcError, j };

const MIGRATIONS = resolve(__dirname, '../../../supabase/migrations');

const EXTRA = `
-- Campos/objetos de ranking usados pelo contexto dinâmico do João.
alter table public.profiles add column if not exists legacy_points integer default 0;
alter table public.profiles add column if not exists legacy_wins integer default 0;
alter table public.profiles add column if not exists legacy_sets_won integer default 0;
create table if not exists public.ranking_reset_events(
  id uuid primary key default gen_random_uuid(),
  executed_at timestamptz not null default now()
);
create or replace function public.get_ranking_cycle_start() returns timestamptz
language sql stable as $ select max(executed_at) from public.ranking_reset_events $;

create type court_type as enum ('Saibro', 'Rápida');
create table public.courts(id uuid primary key default gen_random_uuid(), name text not null, type court_type not null,
  is_active boolean default true);
alter table public.courts enable row level security;
grant select on public.courts to authenticated;
create policy courts_read on public.courts for select using (true);

create table public.championships(id uuid primary key default gen_random_uuid(), name text not null, status text default 'draft');
create table public.championship_registrations(id uuid primary key default gen_random_uuid(),
  championship_id uuid references public.championships(id), participant_type text default 'socio',
  user_id uuid references public.profiles(id), guest_name text, class text not null default '5ª classe');
create table public.matches(id uuid primary key default gen_random_uuid(), championship_id uuid references public.championships(id),
  phase text, player_a_id uuid references public.profiles(id), player_b_id uuid references public.profiles(id),
  score_a integer[], score_b integer[], winner_id uuid references public.profiles(id), status text default 'pending',
  type text default 'Amistoso', date date, created_at timestamptz default now(), updated_at timestamptz default now(),
  registration_a_id uuid references public.championship_registrations(id), registration_b_id uuid references public.championship_registrations(id),
  winner_registration_id uuid references public.championship_registrations(id),
  walkover_winner_id uuid, walkover_winner_registration_id uuid, is_walkover boolean default false,
  result_type text not null default 'played', result_set_at timestamptz,
  player_a_source_match_id uuid references public.matches(id), player_b_source_match_id uuid references public.matches(id));
`;

export async function newDb(): Promise<PGlite> {
  const db = await newFinanceDb();
  await db.exec(EXTRA);
  const files = (await readdir(MIGRATIONS)).filter((f) => /^2026100710\d{4}_conversations_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    try {
      await db.exec(await readFile(resolve(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      throw new Error(`Falha ao aplicar ${f}: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Chama uma função como `service_role` (webhook, IA, dispatch). */
export async function svc<T = Record<string, any>>(db: PGlite, call: string): Promise<T> {
  await db.exec(`set role service_role`);
  try {
    return (await db.query<{ r: T }>(`select ${call} as r`)).rows[0].r;
  } finally {
    await db.exec('reset role');
  }
}

export async function svcError(db: PGlite, call: string): Promise<string | null> {
  try { await svc(db, call); return null; } catch (e) { return (e as Error).message; }
}

/** Mundo mínimo: pessoas (com telefone) e quadras. */
export async function world() {
  const db = await newDb();
  await seedPeople(db);
  await db.exec(`
    update public.profiles set phone = '99900000001' where id = '${U.admin}';
    update public.profiles set phone = '99900000002' where id = '${U.socioA}';
    update public.profiles set phone = '99900000003' where id = '${U.socioB}';
    update public.profiles set phone = '99900000004' where id = '${U.prof}';
    insert into public.professors(id, user_id, name) values ('${ID(900)}', '${U.prof}', 'Paulo Professor');
    insert into public.courts(id, name, type) values ('${ID(801)}', 'Quadra 1', 'Saibro'), ('${ID(802)}', 'Quadra 2', 'Saibro'), ('${ID(803)}', 'Quadra Rápida', 'Rápida');
  `);
  return { db, court1: ID(801), court2: ID(802), fast: ID(803), professor: ID(900) };
}

/** Telefone → mensagem de entrada pelo webhook. */
let seq = 1;
export async function inbound(db: PGlite, input: Record<string, unknown>) {
  const pid = `WA${Date.now()}${seq++}`;
  return svc<{ message_id: string; conversation_id: string; contact_id: string | null; duplicate: boolean; ignored?: string }>(
    db, `public.conv_svc_ingest_message(${j({ provider_id: pid, chat_kind: 'direct', kind: 'text', from_me: false, ...input })})`);
}

// ---------------------------------------------------------------------------------------------
// Adaptador: faz o código das edge functions (que chama `db(nome, args)` como o supabase-js) falar com o
// Postgres em memória, como `service_role`. Assim o turno da IA é testado de ponta a ponta contra o SQL real.
// ---------------------------------------------------------------------------------------------
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  // Lista de objetos = jsonb (como o supabase-js manda); lista de textos = text[].
  if (Array.isArray(v)) return v.some((x) => x !== null && typeof x === 'object') ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `array[${v.map(lit).join(', ')}]::text[]`;
  return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
};

export function pgDb(db: PGlite) {
  return async (name: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: { message: string } | null }> => {
    const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
    await db.exec('set role service_role');
    try {
      const r = await db.query<Record<string, unknown>>(`select * from public.${name}(${named})`);
      if (r.fields.length === 1 && r.fields[0].name === name) {
        const value = r.rows[0]?.[name];
        return { data: value === undefined ? null : value, error: null };
      }
      return { data: r.rows, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    } finally {
      await db.exec('reset role');
    }
  };
}
