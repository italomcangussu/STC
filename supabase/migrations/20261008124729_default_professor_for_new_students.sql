-- Todo aluno nasce com o professor do clube.
--
-- O clube tem um único professor e ele é o padrão. Dependente cadastrado pela Agenda, pelo admin ou pelo João
-- nascia SEM professor, e isso quebrava duas coisas:
--   1. a RLS só deixa o professor inserir aluno com o professor_id dele; o cadastro de dependente feito por ele
--      voltava 403 (row-level security), e a aula não podia ser marcada;
--   2. a tela do professor filtra alunos por professor_id: o dependente não aparecia na lista dele e a aula
--      mostrava "TBD" no lugar do nome.
--
-- Regra: se professor_id vier vazio (ao cadastrar ou ao editar) e existir EXATAMENTE UM professor ativo,
-- o banco preenche com ele. Vale também na edição porque a tela de alunos do admin regrava professor_id
-- vazio ao salvar um dependente, o que desfaria o vínculo. Com zero ou mais de um professor ativo o banco
-- não adivinha: deixa como veio.

create or replace function public.default_professor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (array_agg(p.id))[1]
  from public.professors p
  where coalesce(p.is_active, true)
  having count(*) = 1;
$$;

create or replace function public.set_default_professor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.professor_id is null then
    new.professor_id := public.default_professor_id();
  end if;
  return new;
end;
$$;

revoke all on function public.default_professor_id() from public, anon;
grant execute on function public.default_professor_id() to authenticated, service_role;
revoke all on function public.set_default_professor() from public, anon, authenticated;

drop trigger if exists trg_non_socio_students_default_professor on public.non_socio_students;
create trigger trg_non_socio_students_default_professor
  before insert or update of professor_id on public.non_socio_students
  for each row execute function public.set_default_professor();

drop trigger if exists trg_student_profiles_default_professor on public.student_profiles;
create trigger trg_student_profiles_default_professor
  before insert or update of professor_id on public.student_profiles
  for each row execute function public.set_default_professor();

-- Quem já nasceu sem professor (os 9 dependentes cadastrados até hoje) passa a ser do professor padrão.
-- Só preenche vazios; não troca professor de ninguém. Os gatilhos de nível e de status não disparam
-- (reagem a technical_level e student_status, que este comando não toca).
update public.non_socio_students
   set professor_id = public.default_professor_id()
 where professor_id is null
   and public.default_professor_id() is not null;

update public.student_profiles
   set professor_id = public.default_professor_id()
 where professor_id is null
   and public.default_professor_id() is not null;
