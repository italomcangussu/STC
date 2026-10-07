# public.challenges
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| challenger_id | uuid | sim |  |  |
| challenged_id | uuid | sim |  |  |
| status | text | sim | `'proposed'::text` |  |
| month_ref | text | sim |  |  |
| match_id | uuid | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| scheduled_date | date | sim |  |  |
| scheduled_time | time without time zone | sim |  |  |
| court_id | uuid | sim |  |  |
| notification_seen | boolean | sim | `false` |  |
| reservation_id | uuid | sim |  |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (challenged_id) → public.profiles(id)
- FK (challenger_id) → public.profiles(id)
- FK (court_id) → public.courts(id)
- FK (match_id) → public.matches(id)
- FK (reservation_id) → public.reservations(id)

## Referenciada por
- public.reservations.challenge_id

## Índices
- idx_challenges_notification: `btree (challenged_id, notification_seen) WHERE (notification_seen = false)`
- idx_challenges_scheduled_date: `btree (scheduled_date) WHERE (status = ANY (ARRAY['accepted'::text, 'scheduled'::text]))`

## Políticas RLS
- "Admins can delete challenges" — DELETE para authenticated · using `is_admin()`
- "Admins can insert challenges" — INSERT para authenticated · check `is_admin()`
- "Authenticated can insert challenges" — INSERT para authenticated · check `(auth.uid() = challenger_id)`
- "Participants or Admin can update challenges" — UPDATE para authenticated · using `(((auth.uid() = challenger_id) OR (auth.uid() = challenged_id)) OR is_admin())`
- "Public select challenges" — SELECT para public · using `true`

## Gatilhos
- trg_admin_audit_challenges — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()
- update_challenges_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
