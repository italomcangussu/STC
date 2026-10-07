# public.championship_registrations
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| championship_id | uuid | não |  |  |
| participant_type | text | não |  |  |
| user_id | uuid | sim |  |  |
| guest_name | text | sim |  |  |
| class | text | não |  |  |
| shirt_size | text | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| registered_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| final_phase | text | sim |  |  |
| cabeca_de_chave | boolean | não | `false` |  |
| guest_cidade | text | sim |  |  |
| guest_idade | integer | sim |  |  |
| student_id | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (championship_id) → public.championships(id) on delete cascade
- FK (registered_by) → public.profiles(id)
- FK (student_id) → public.non_socio_students(id)
- FK (user_id) → public.profiles(id)
- CHECK championship_registrations_final_phase_check: `CHECK ((final_phase = ANY (ARRAY['champion'::text, 'finalist'::text, 'semifinal'::text, 'quarterfinal'::text, 'round_of_16'::text, 'round_of_32'::text, 'qualifying'::text, 'participation'::text])))`
- CHECK championship_registrations_participant_type_check: `CHECK ((participant_type = ANY (ARRAY['socio'::text, 'guest'::text, 'aluno'::text])))`
- CHECK championship_registrations_shirt_size_check: `CHECK ((shirt_size = ANY (ARRAY['P'::text, 'M'::text, 'G'::text, 'GG'::text, 'XGG'::text])))`
- CHECK valid_participant: `CHECK ((((participant_type = 'socio'::text) AND (user_id IS NOT NULL)) OR ((participant_type = 'guest'::text) AND (guest_name IS NOT NULL)) OR ((participant_type = 'aluno'::text) AND (student_id IS N…`

## Referenciada por
- public.championship_group_members.registration_id
- public.championship_groups.seed_registration_id
- public.matches.registration_a_id
- public.matches.registration_b_id
- public.matches.walkover_winner_registration_id
- public.matches.winner_registration_id

## Índices
- idx_championship_registrations_championship: `btree (championship_id)`
- idx_championship_registrations_class: `btree (class)`

## Políticas RLS
- "Admins can delete registrations" — DELETE para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can insert registrations" — INSERT para public · check `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can update registrations" — UPDATE para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Anyone can view registrations" — SELECT para public · using `true`

## Gatilhos
- update_championship_registrations_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
