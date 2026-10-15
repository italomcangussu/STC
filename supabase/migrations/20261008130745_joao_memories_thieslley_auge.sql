-- Memória social do João: o Thieslley e as metas da Auge Motos, contado pela diretoria (já aprovada).
-- Idempotente: não duplica se a mesma memória já existir (pendente ou aprovada).
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status, reviewed_at)
select v.subject_name, v.kind, v.content, 1, 'approved', now()
from (values
  ('Thieslley Soares', 'confirmed_fact', 'Comanda a equipe de vendas da Auge Motos e faz o time bater meta todo fim de mês; é ele "aquele que sempre bate as metas".')
) as v(subject_name, kind, content)
where not exists (
  select 1 from public.conv_ai_memory_candidates c
  where lower(c.subject_name) = lower(v.subject_name)
    and lower(c.content) = lower(v.content)
    and c.status in ('pending', 'approved')
);
