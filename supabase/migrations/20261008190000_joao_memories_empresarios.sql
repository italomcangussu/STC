-- Memória social do João: os empresários do clube e seus negócios, contados pela diretoria (já aprovadas).
-- Idempotente: não duplica se a mesma memória já existir (pendente ou aprovada).
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status, reviewed_at)
select v.subject_name, v.kind, v.content, 1, 'approved', now()
from (values
  ('Ítalo Cangussú', 'confirmed_fact', 'É empresário, dono do Hospital dos iPhones.'),
  ('Mario Rego', 'confirmed_fact', 'É empresário, dono do restaurante Divino Fogão e da sorveteria Frost.'),
  ('Tiago Gomes', 'confirmed_fact', 'É empresário, dono da Gomes Prime Ótica.'),
  ('Ítalo Cangussú', 'social_relation', 'Faz parte da turma dos empresários do clube, com o Mario e o Tiago.'),
  ('Mario Rego', 'social_relation', 'Faz parte da turma dos empresários do clube, com o Ítalo e o Tiago.'),
  ('Tiago Gomes', 'social_relation', 'Faz parte da turma dos empresários do clube, com o Ítalo e o Mario.')
) as v(subject_name, kind, content)
where not exists (
  select 1 from public.conv_ai_memory_candidates c
  where lower(c.subject_name) = lower(v.subject_name)
    and lower(c.content) = lower(v.content)
    and c.status in ('pending', 'approved')
);
