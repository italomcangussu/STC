-- Memória social do João: Thiago Coelho é médico (não confundir com o Tiago Gomes, empresário da ótica).
-- Idempotente: não duplica se a mesma memória já existir (pendente ou aprovada).
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status, reviewed_at)
select v.subject_name, v.kind, v.content, 1, 'approved', now()
from (values
  ('Thiago Coelho', 'confirmed_fact', 'É médico (não é o Tiago Gomes da ótica).'),
  ('Thiago Coelho', 'social_relation', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, William, Jorge e Marcelino.')
) as v(subject_name, kind, content)
where not exists (
  select 1 from public.conv_ai_memory_candidates c
  where lower(c.subject_name) = lower(v.subject_name)
    and lower(c.content) = lower(v.content)
    and c.status in ('pending', 'approved')
);
