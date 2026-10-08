-- Memória social do João: a turma dos médicos passa a incluir o Thiago Coelho.
-- A lista antiga de cada médico vira 'superseded' (sai do prompt, fica no histórico) e entra a nova.
-- Idempotente: rodar de novo não duplica nem reabre nada.
with nova(subject_name, content) as (values
  ('Daniel Leão', 'Faz parte da turma dos médicos do clube, com Júlio César, Renan, William, Jorge, Marcelino e Thiago Coelho.'),
  ('Júlio César Cavalcante', 'Faz parte da turma dos médicos do clube, com Daniel, Renan, William, Jorge, Marcelino e Thiago Coelho.'),
  ('Renan Vieira Furtado', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, William, Jorge, Marcelino e Thiago Coelho.'),
  ('William Yoshida', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, Jorge, Marcelino e Thiago Coelho.'),
  ('Jorge Medeiros', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, William, Marcelino e Thiago Coelho.'),
  ('Marcelino', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, William, Jorge e Thiago Coelho.')
), antigas as (
  update public.conv_ai_memory_candidates c
     set status = 'superseded', reviewed_at = now()
    from nova n
   where lower(c.subject_name) = lower(n.subject_name)
     and c.kind = 'social_relation'
     and c.status = 'approved'
     and c.content like 'Faz parte da turma dos médicos do clube,%'
     and lower(c.content) <> lower(n.content)
  returning c.id
)
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status, reviewed_at)
select n.subject_name, 'social_relation', n.content, 1, 'approved', now()
from nova n
where not exists (
  select 1 from public.conv_ai_memory_candidates c
  where lower(c.subject_name) = lower(n.subject_name)
    and lower(c.content) = lower(n.content)
    and c.status in ('pending', 'approved')
);
