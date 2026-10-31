# public.championship_signups
> tabela · RLS on · ~<100 linhas — Pré-inscrições de campeonato feitas pelo João. pre = aguardando Pix; confirmed = pago e inscrito (registration_id); waitlist = classe cheia. Escrita só pelas funções conv_svc_*.

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| championship_id | uuid | não |  |  |
| class | text | não |  |  |
| full_name | text | não |  |  |
| name_key | text | não |  |  |
| phone | text | não |  |  |
| phone_key | text | não |  |  |
| city | text | sim |  |  |
| shirt_size | text | não |  |  |
| profile_id | uuid | sim |  |  |
| status | text | não | `'pre'::text` |  |
| registered_by_contact_id | uuid | sim |  |  |
| conversation_id | uuid | sim |  |  |
| amount_cents | bigint | não |  |  |
| paid_at | timestamp with time zone | sim |  |  |
| receipt_intent_id | uuid | sim |  |  |
| fin_entry_id | uuid | sim |  |  |
| registration_id | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (championship_id) → public.championships(id) on delete cascade
- FK (conversation_id) → public.conv_conversations(id)
- FK (fin_entry_id) → public.fin_entries(id)
- FK (profile_id) → public.profiles(id)
- FK (registered_by_contact_id) → public.conv_contacts(id)
- FK (registration_id) → public.championship_registrations(id) on delete set null
- CHECK championship_signups_amount_cents_check: `CHECK ((amount_cents > 0))`
- CHECK championship_signups_city_check: `CHECK (((city IS NULL) OR ((length(TRIM(BOTH FROM city)) >= 2) AND (length(TRIM(BOTH FROM city)) <= 60))))`
- CHECK championship_signups_full_name_check: `CHECK (((length(TRIM(BOTH FROM full_name)) >= 5) AND (length(TRIM(BOTH FROM full_name)) <= 120)))`
- CHECK championship_signups_phone_check: `CHECK ((phone ~ '^[1-9][0-9]{9,14}$'::text))`
- CHECK championship_signups_status_check: `CHECK ((status = ANY (ARRAY['pre'::text, 'confirmed'::text, 'waitlist'::text, 'canceled'::text])))`

## Índices
- championship_signups_class_idx: `btree (championship_id, class, status)`
- championship_signups_contact_idx: `btree (registered_by_contact_id, status)`
- championship_signups_conversation_idx: `btree (conversation_id) WHERE (conversation_id IS NOT NULL)`
- championship_signups_entry_idx: `btree (fin_entry_id) WHERE (fin_entry_id IS NOT NULL)`
- championship_signups_name_uidx: `btree (championship_id, name_key) WHERE (status <> 'canceled'::text)` único
- championship_signups_phone_uidx: `btree (championship_id, phone_key) WHERE (status <> 'canceled'::text)` único
- championship_signups_profile_idx: `btree (profile_id) WHERE (profile_id IS NOT NULL)`
- championship_signups_registration_idx: `btree (registration_id) WHERE (registration_id IS NOT NULL)`

## Políticas RLS
- "Admins read championship signups" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- championship_signups_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
