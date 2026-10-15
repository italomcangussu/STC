-- Aniversários passados pela diretoria em 2026-10-08 (dia/mês). Flavio não tem cadastro; o Diego Parente ficou sem data
-- porque a lista trazia dois "Diego" (25/07 e 25/11) e não deu para saber qual é ele.
update public.profiles p set birth_day = v.d, birth_month = v.m
from (values
  ('Derlan', 14, 1), ('Daniel Leão', 10, 2), ('Jorge Medeiros', 16, 3), ('Rafael Fernandes', 27, 4),
  ('Mario Rego', 11, 7), ('Ealber Luna', 23, 7), ('Bruno Vaz Carvalho', 20, 7), ('Carlos Carneiro', 6, 7),
  ('Ítalo Cangussú', 5, 7), ('Thieslley Soares', 5, 8), ('Diego Memória', 11, 8), ('Henrique Coelho', 23, 8),
  ('Lucas Rodrigues', 8, 10), ('Hermeson Veras', 10, 12), ('Marcelo Sampieri', 11, 12), ('Mailson Freitas', 16, 12),
  ('Tiago Gomes', 16, 12)
) as v(name, d, m)
where p.name = v.name;
