# public.reservations
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| court_id | uuid | sim |  |  |
| creator_id | uuid | sim |  |  |
| date | date | não |  |  |
| start_time | time without time zone | não |  |  |
| end_time | time without time zone | não |  |  |
| type | text | não |  |  |
| status | reservation_status | sim | `'active'::reservation_status` |  |
| observation | text | sim |  |  |
| professor_id | uuid | sim |  |  |
| student_id | uuid | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| challenge_id | uuid | sim |  |  |
| match_id | uuid | sim |  |  |
| participant_ids | uuid[] | sim | `'{}'::uuid[]` |  |
| guest_name | text | sim |  |  |
| guest_responsible_id | uuid | sim |  |  |
| student_type | text | sim |  |  |
| non_socio_student_id | text | sim |  |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| payment_status | payment_status_type | sim | `'paid'::payment_status_type` |  |
| non_socio_student_ids | uuid[] | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (challenge_id) → public.challenges(id)
- FK (court_id) → public.courts(id)
- FK (creator_id) → public.profiles(id)
- FK (guest_responsible_id) → public.profiles(id)
- FK (match_id) → public.matches(id)
- FK (professor_id) → public.professors(id)
- FK (student_id) → public.students(id)

## Referenciada por
- public.challenges.reservation_id
- public.conv_booking_proposals.reservation_id
- public.reservation_participants.reservation_id

## Índices
- idx_reservations_challenge: `btree (challenge_id)`
- idx_reservations_match: `btree (match_id)`

## Políticas RLS
- "Allow update for creators, admins, or participants" — UPDATE para authenticated · using `((auth.uid() = creator_id) OR is_admin() OR ((type = ANY (ARRAY['Play'::text, 'Desafio'::text])) AND (status = 'active'::reservation_status)))` · check `((auth.uid() = creator_id) OR is_admin() OR (type = ANY (ARRAY['Play'::text, 'Desafio'::text])))`
- "Authenticated can create reservation" — INSERT para public · check `(auth.role() = 'authenticated'::text)`
- "Creator or Admin can delete reservation" — DELETE para public · using `((auth.uid() = creator_id) OR is_admin())`
- "Reservations viewable by everyone" — SELECT para public · using `true`

## Gatilhos
- trg_admin_audit_reservations — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()
- update_reservations_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
