-- Memória social do João: os advogados do clube, contados pela diretoria (já aprovadas).
-- Idempotente: não duplica se a mesma memória já existir (pendente ou aprovada).
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status, reviewed_at)
select v.subject_name, v.kind, v.content, 1, 'approved', now()
from (values
  ('Diego Parente', 'confirmed_fact', 'É advogado.'),
  ('Bruno Vaz Carvalho', 'confirmed_fact', 'É advogado.'),
  ('Diego Parente', 'social_relation', 'Forma a dupla de advogados do clube com o Bruno.'),
  ('Bruno Vaz Carvalho', 'social_relation', 'Forma a dupla de advogados do clube com o Diego Parente.')
) as v(subject_name, kind, content)
where not exists (
  select 1 from public.conv_ai_memory_candidates c
  where lower(c.subject_name) = lower(v.subject_name)
    and lower(c.content) = lower(v.content)
    and c.status in ('pending', 'approved')
);
