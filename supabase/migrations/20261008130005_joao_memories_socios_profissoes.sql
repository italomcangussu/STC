-- Memória social do João: profissão e turma de alguns sócios, contadas pela diretoria (já aprovadas).
-- O nome do sujeito é o do perfil, para o João achar a memória quando a pessoa for citada ou estiver na conversa.
-- Idempotente: não duplica se a mesma memória já existir (pendente ou aprovada).
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status, reviewed_at)
select v.subject_name, v.kind, v.content, 1, 'approved', now()
from (values
  ('Daniel Leão', 'confirmed_fact', 'É médico.'),
  ('Júlio César Cavalcante', 'confirmed_fact', 'É médico ortopedista.'),
  ('Renan Vieira Furtado', 'confirmed_fact', 'É médico.'),
  ('William Yoshida', 'confirmed_fact', 'É médico e de origem japonesa (brincar com a profissão, nunca com a origem).'),
  ('Jorge Medeiros', 'confirmed_fact', 'É médico dermatologista.'),
  ('Marcelino', 'confirmed_fact', 'É médico neurologista.'),
  ('Daniel Leão', 'social_relation', 'Faz parte da turma dos médicos do clube, com Júlio César, Renan, William, Jorge e Marcelino.'),
  ('Júlio César Cavalcante', 'social_relation', 'Faz parte da turma dos médicos do clube, com Daniel, Renan, William, Jorge e Marcelino.'),
  ('Renan Vieira Furtado', 'social_relation', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, William, Jorge e Marcelino.'),
  ('William Yoshida', 'social_relation', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, Jorge e Marcelino.'),
  ('Jorge Medeiros', 'social_relation', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, William e Marcelino.'),
  ('Marcelino', 'social_relation', 'Faz parte da turma dos médicos do clube, com Daniel, Júlio César, Renan, William e Jorge.'),
  ('Henrique Coelho', 'inside_joke', 'Está sempre de férias; a turma brinca que ninguém sabe direito o que ele faz, só que é "alguma coisa com leite de boi" e veterinária.')
) as v(subject_name, kind, content)
where not exists (
  select 1 from public.conv_ai_memory_candidates c
  where lower(c.subject_name) = lower(v.subject_name)
    and lower(c.content) = lower(v.content)
    and c.status in ('pending', 'approved')
);
