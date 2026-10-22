-- Mensalista Kids: Card Mensal de criança pela METADE do preço do mensalista. É uma faixa do Card Mensal, não um plano
-- novo: tudo que trata mensalista (validade, aula, Agenda, caixa, João) continua valendo; só o preço muda.
-- O preço do mensalista sai do código (200 fixo em AdminStudents, ProfessorProfile e no João) e vai para o financeiro.

alter table public.non_socio_students add column if not exists card_tier text not null default 'regular';
alter table public.non_socio_students add constraint non_socio_students_card_tier_check check (card_tier in ('regular', 'kids'));
comment on column public.non_socio_students.card_tier is 'Faixa do Card Mensal: regular ou kids (metade do preço).';

alter table public.fin_settings add column if not exists card_mensal_price_cents bigint not null default 20000;
alter table public.fin_settings add constraint fin_settings_card_mensal_price_check check (card_mensal_price_cents between 100 and 10000000);

-- Preço do Card Mensal por faixa (Kids = metade, arredondada para o centavo).
create or replace function fin_private.card_price_cents(p_tier text) returns bigint
language sql stable security definer set search_path = '' as $$
  select case when p_tier = 'kids' then round(v.price / 2.0)::bigint else v.price end
  from (select coalesce((select card_mensal_price_cents from public.fin_settings where id), 20000) price) v
$$;
revoke all on function fin_private.card_price_cents(text) from public, anon, authenticated;

-- Leitura para as telas de aluno (admin e professor registram pagamento de Card).
create or replace function public.student_card_prices() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('regular_cents', fin_private.card_price_cents('regular'), 'kids_cents', fin_private.card_price_cents('kids'))
$$;
revoke all on function public.student_card_prices() from public, anon;
grant execute on function public.student_card_prices() to authenticated;
