-- Aluno novo nasce com o professor padrão: o único professor ativo do clube.
-- Antes: dependente nascia sem professor; o professor tomava 403 (RLS) ao cadastrar e a tela dele não o listava.

create temp table u as select fab.usuario('prof@x.com') as prof, fab.usuario('socio@x.com') as socio, fab.usuario('adm@x.com') as adm;
grant select on u to authenticated;

insert into public.profiles (id, name, role) select prof, 'Professor A', 'socio' from u;
insert into public.profiles (id, name, role) select socio, 'Sócio', 'socio' from u;
insert into public.profiles (id, name, role) select adm, 'Admin', 'admin' from u;

insert into public.professors (id, user_id, name) values ('00000000-0000-0000-0000-0000000000a1', (select prof from u), 'Professor A');

-- 1) dependente cadastrado sem professor (admin, João, qualquer caminho) nasce com o professor padrão
insert into public.non_socio_students (id, name, plan_type, student_type, responsible_socio_id, relationship_type)
values ('00000000-0000-0000-0000-000000000001', 'Filho', 'Dependente', 'dependent', (select socio from u), 'filho');
do $$ begin
  assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000a1',
    'dependente sem professor deveria nascer com o professor padrão';
end $$;

-- 2) o PRÓPRIO professor cadastra dependente sem informar professor: antes dava 403, agora passa e fica dele
select fab.como('authenticated', (select prof from u));
insert into public.non_socio_students (id, name, plan_type, student_type, responsible_socio_id, relationship_type)
values ('00000000-0000-0000-0000-000000000002', 'Esposa', 'Dependente', 'dependent', (select socio from u), 'esposa');
select fab.espera_linhas($$select 1 from public.non_socio_students where id = '00000000-0000-0000-0000-000000000002' and professor_id = '00000000-0000-0000-0000-0000000000a1'$$, 1);

-- 2b) o perfil de aluno do dependente também nasce dele (a Agenda insere os dois em seguida)
insert into public.student_profiles (non_socio_student_id, technical_level, student_status)
values ('00000000-0000-0000-0000-000000000002', 'Iniciante', 'active');
select fab.espera_linhas($$select 1 from public.student_profiles where non_socio_student_id = '00000000-0000-0000-0000-000000000002' and professor_id = '00000000-0000-0000-0000-0000000000a1'$$, 1);

-- 3) quem não é professor nem admin continua sem poder cadastrar aluno (a regra de acesso não mudou)
select fab.como('authenticated', (select socio from u));
select fab.espera_erro($$insert into public.non_socio_students (name, plan_type) values ('Intruso', 'Day Card')$$, 'row-level security');

-- 4) professor informado é respeitado, e professor inativo não conta como padrão
select fab.dono();
insert into public.professors (id, name, is_active) values ('00000000-0000-0000-0000-0000000000b1', 'Professor B', false);
insert into public.non_socio_students (id, name, plan_type, professor_id)
values ('00000000-0000-0000-0000-000000000003', 'Com B', 'Day Card', '00000000-0000-0000-0000-0000000000b1');
insert into public.non_socio_students (id, name, plan_type) values ('00000000-0000-0000-0000-000000000004', 'Sem professor', 'Day Card');
do $$ begin
  assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-0000000000b1',
    'professor informado não pode ser trocado';
  assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000004') = '00000000-0000-0000-0000-0000000000a1',
    'com um só professor ativo, ele é o padrão (o inativo não conta)';
end $$;

-- 5) o backfill da migration só preenche vazios e não troca o professor de ninguém
alter table public.non_socio_students disable trigger trg_non_socio_students_default_professor;
insert into public.non_socio_students (id, name, plan_type, student_type) values ('00000000-0000-0000-0000-000000000005', 'Antigo', 'Dependente', 'dependent');
alter table public.non_socio_students enable trigger trg_non_socio_students_default_professor;
do $$ begin assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000005') is null, 'preparo: aluno antigo sem professor'; end $$;

update public.non_socio_students set professor_id = public.default_professor_id() where professor_id is null and public.default_professor_id() is not null;
do $$ begin
  assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000005') = '00000000-0000-0000-0000-0000000000a1', 'backfill deveria preencher o vazio';
  assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-0000000000b1', 'backfill não pode trocar professor existente';
end $$;

-- 5b) editar o aluno regravando professor_id vazio (o que a tela de alunos do admin faz) não tira o vínculo
update public.non_socio_students set professor_id = null where id = '00000000-0000-0000-0000-000000000005';
do $$ begin assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000005') = '00000000-0000-0000-0000-0000000000a1', 'editar para vazio deveria manter o professor padrão'; end $$;
update public.non_socio_students set name = 'Antigo Renomeado' where id = '00000000-0000-0000-0000-000000000003';
do $$ begin assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-0000000000b1', 'editar outro campo não pode mexer no professor'; end $$;

-- 6) com DOIS professores ativos o banco não adivinha: o aluno fica como veio, e a RLS segue valendo
update public.professors set is_active = true where id = '00000000-0000-0000-0000-0000000000b1';
do $$ begin assert public.default_professor_id() is null, 'com dois professores ativos não há padrão'; end $$;
insert into public.non_socio_students (id, name, plan_type) values ('00000000-0000-0000-0000-000000000006', 'Ambíguo', 'Day Card');
do $$ begin assert (select professor_id from public.non_socio_students where id = '00000000-0000-0000-0000-000000000006') is null, 'sem padrão, professor_id continua vazio'; end $$;
select fab.como('authenticated', (select prof from u));
select fab.espera_erro($$insert into public.non_socio_students (name, plan_type) values ('Y', 'Day Card')$$, 'row-level security');

-- 7) sem nenhum professor ativo também não há padrão
select fab.dono();
update public.professors set is_active = false;
do $$ begin assert public.default_professor_id() is null, 'sem professor ativo não há padrão'; end $$;
