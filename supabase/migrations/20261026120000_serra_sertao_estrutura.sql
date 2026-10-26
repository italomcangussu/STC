-- Serra e Sertão 2026: estrutura para o João inscrever atletas pelo WhatsApp.
--
-- A pré-inscrição vive em championship_signups e só vira linha em championship_registrations quando
-- o Pix é confirmado. Assim a chave, o Criador e a página pública continuam mostrando só quem pagou.
-- O campeonato fica SEM série (series_id nulo): o Serra e Sertão tem ranking próprio e não pode
-- somar pontos no ranking interno do STC quando terminar (on_championship_finished_apply_points).

-- 1) O que o João sabe e cobra de cada campeonato que ele inscreve.
alter table public.championships add column if not exists joao_info jsonb;
comment on column public.championships.joao_info is
  'Inscrição pelo João (WhatsApp): enabled, price_cents, shirt_sizes, max_per_class, deadline (YYYY-MM-DD, inclusive), category_name, shirt_image {path,mime,name} no bucket conv-media e info (texto que o João usa para tirar dúvidas).';

-- 2) Ordem dos cabeças de chave (1 = cabeça 1). cabeca_de_chave continua sendo a marca que o app lê.
alter table public.championship_registrations add column if not exists seed_number integer;
do $$ begin
  alter table public.championship_registrations add constraint championship_registrations_seed_number_check check (seed_number between 1 and 16);
exception when duplicate_object then null; end $$;

-- 3) Pré-inscrições feitas pelo João.
create table if not exists public.championship_signups (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships(id) on delete cascade,
  class text not null,
  full_name text not null check (length(trim(full_name)) between 5 and 120),
  name_key text not null,
  phone text not null check (phone ~ '^[1-9][0-9]{9,14}$'),
  phone_key text not null,
  city text check (city is null or length(trim(city)) between 2 and 60),
  shirt_size text not null,
  profile_id uuid references public.profiles(id),
  status text not null default 'pre' check (status in ('pre', 'confirmed', 'waitlist', 'canceled')),
  registered_by_contact_id uuid references public.conv_contacts(id),
  conversation_id uuid references public.conv_conversations(id),
  amount_cents bigint not null check (amount_cents > 0),
  paid_at timestamptz,
  receipt_intent_id uuid,
  fin_entry_id uuid references public.fin_entries(id),
  registration_id uuid references public.championship_registrations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.championship_signups is
  'Pré-inscrições de campeonato feitas pelo João. pre = aguardando Pix; confirmed = pago e inscrito (registration_id); waitlist = classe cheia. Escrita só pelas funções conv_svc_*.';

-- Um atleta por campeonato: nem o mesmo telefone nem o mesmo nome duas vezes (cancelada não conta).
create unique index if not exists championship_signups_phone_uidx on public.championship_signups (championship_id, phone_key) where status <> 'canceled';
create unique index if not exists championship_signups_name_uidx on public.championship_signups (championship_id, name_key) where status <> 'canceled';
create index if not exists championship_signups_contact_idx on public.championship_signups (registered_by_contact_id, status);
create index if not exists championship_signups_class_idx on public.championship_signups (championship_id, class, status);
create index if not exists championship_signups_profile_idx on public.championship_signups (profile_id) where profile_id is not null;
create index if not exists championship_signups_entry_idx on public.championship_signups (fin_entry_id) where fin_entry_id is not null;
create index if not exists championship_signups_registration_idx on public.championship_signups (registration_id) where registration_id is not null;
create index if not exists championship_signups_conversation_idx on public.championship_signups (conversation_id) where conversation_id is not null;

alter table public.championship_signups enable row level security;
revoke all on public.championship_signups from anon, authenticated;
grant select on public.championship_signups to authenticated;
drop policy if exists "Admins read championship signups" on public.championship_signups;
create policy "Admins read championship signups" on public.championship_signups for select to authenticated using (public.is_admin());

drop trigger if exists championship_signups_updated_at on public.championship_signups;
create trigger championship_signups_updated_at before update on public.championship_signups
  for each row execute function public.update_updated_at_column();

-- 4) Categoria da receita das inscrições.
insert into public.fin_categories (name, kind, dre_line, system_key, position)
select 'Inscrição Serra e Sertão', 'revenue', 'revenue', 'championship_serra_sertao', 50
where not exists (select 1 from public.fin_categories where system_key = 'championship_serra_sertao');

-- 5) O campeonato e as rodadas das duas classes (oitavas → final, uma rodada por fase e por classe).
insert into public.championships (name, status, format, start_date, end_date, rules, slug, edition_year, series_id,
  allow_guests, allow_students, registration_open, format_config, joao_info)
select 'Serra e Sertão 2026', 'draft', 'mata-mata', date '2026-11-27', date '2026-11-29',
  'Mata-mata em melhor de 3 sets; se houver 3º set, ele é decidido num tie-break de 7 pontos. 4ª Classe no saibro e 5ª Classe na quadra rápida.',
  'serra-e-sertao-2026', 2026, null, true, false, true,
  jsonb_build_object(
    '4ª Classe', jsonb_build_object('format', 'mata-mata', 'seeded', true, 'qualifying', null, 'mainDrawStartPhase', 'round_of_16'),
    '5ª Classe', jsonb_build_object('format', 'mata-mata', 'seeded', true, 'qualifying', null, 'mainDrawStartPhase', 'round_of_16')),
  jsonb_build_object(
    'enabled', true,
    'price_cents', 13000,
    'shirt_sizes', jsonb_build_array('P', 'M', 'G', 'GG'),
    'max_per_class', 16,
    'deadline', '2026-11-24',
    'category_name', 'Inscrição Serra e Sertão',
    'shirt_image', null,
    'info', concat_ws(E'\n',
      'O Serra e Sertão é um campeonato regional de tênis que reúne atletas de Sobral, Tianguá, Nova Russas, Boa Viagem e Crateús. A edição de 2026 é no Sobral Tênis Clube (STC), em Sobral.',
      'Tem ranking próprio, o ranking do Serra e Sertão. Não é o ranking interno do STC e o campeonato não mexe no ranking do STC.',
      'Datas: 27, 28 e 29 de novembro de 2026 (sexta, sábado e domingo).',
      'Classes: 4ª Classe e 5ª Classe, com 16 atletas em cada. Cada atleta joga uma classe só.',
      'Quadras: a 4ª Classe joga no saibro e a 5ª Classe na quadra rápida.',
      'Formato: mata-mata. Sexta: oitavas de final. Sábado: quartas de final. Domingo: semifinais e finais.',
      'Horário: chamada dos jogos a partir das 16h, sempre à tarde. Não há jogo pela manhã, salvo situação excepcional.',
      'Jogos em melhor de 3 sets. Se houver 3º set, ele é decidido num tie-break de 7 pontos.',
      'Confrontos entre atletas da mesma cidade na 1ª e na 2ª fase podem ser jogados na própria cidade, para desafogar a tabela: há essa flexibilidade, combinada com a organização.',
      'Bola oficial: Wilson Championship, a versão para saibro na quadra de saibro e a versão para quadra rápida na quadra rápida.',
      'Inscrição: R$ 130,00 por atleta. Inclui a camisa do evento (tamanhos P, M, G e GG).',
      'Premiação: 1º lugar ganha troféu e brinde; 2º lugar ganha troféu.',
      'Inscrições até 24 de novembro ou até a classe lotar. A vaga só é garantida depois do Pix; com a classe cheia, o atleta entra na lista de espera.',
      'Os cabeças de chave são definidos pela organização antes do sorteio da chave.'))
where not exists (select 1 from public.championships where slug = 'serra-e-sertao-2026');

insert into public.championship_rounds (championship_id, class, round_number, name, phase, start_date, end_date, status)
select c.id, k.classe, r.n, r.nome, r.fase, r.dia, r.dia, 'pending'
from public.championships c
cross join (values ('4ª Classe'), ('5ª Classe')) as k(classe)
cross join (values (1, 'Oitavas de Final', 'oitavas', date '2026-11-27'), (2, 'Quartas de Final', 'quartas', date '2026-11-28'),
                   (3, 'Semifinais', 'semifinal', date '2026-11-29'), (4, 'Final', 'final', date '2026-11-29')) as r(n, nome, fase, dia)
where c.slug = 'serra-e-sertao-2026'
on conflict (championship_id, class, round_number) do nothing;
