-- Arquivo de trilha de auditoria: movimentos eliminados dos cálculos de caixa.
-- Exclusão lógica, sem DELETE físico nem transação bancária.
create table if not exists fin_private.cash_removed (
  source_type text not null check (source_type in ('entry_payment','member_payment','member_reversal','student_payment','day_card')),
  source_id text not null,
  reason text not null check(length(reason) between 8 and 500),
  actor_id uuid not null references public.profiles(id),
  occurred_at timestamptz not null default now(),
  request_id uuid not null,
  snapshot jsonb not null,
  primary key(source_type,source_id)
);
alter table fin_private.cash_removed enable row level security;
revoke all on fin_private.cash_removed from public,anon,authenticated;
