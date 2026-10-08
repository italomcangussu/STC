# public.conv_contacts
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| phone | text | sim |  |  |
| lid | text | sim |  |  |
| name | text | sim |  |  |
| avatar_url | text | sim |  |  |
| avatar_checked_at | timestamp with time zone | sim |  |  |
| profile_id | uuid | sim |  |  |
| non_socio_student_id | uuid | sim |  |  |
| link_status | text | não | `'none'::text` |  |
| opt_out | boolean | não | `false` |  |
| opt_out_at | timestamp with time zone | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| merged_into | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (merged_into) → public.conv_contacts(id)
- FK (non_socio_student_id) → public.non_socio_students(id) on delete set null
- FK (profile_id) → public.profiles(id) on delete set null
- CHECK conv_contacts_check1: `CHECK ((NOT ((profile_id IS NOT NULL) AND (non_socio_student_id IS NOT NULL))))`
- CHECK conv_contacts_has_identity: `CHECK (((phone IS NOT NULL) OR (lid IS NOT NULL) OR (merged_into IS NOT NULL)))`
- CHECK conv_contacts_lid_check: `CHECK (((lid IS NULL) OR (lid ~ '^[0-9A-Za-z._-]{3,64}$'::text)))`
- CHECK conv_contacts_link_status_check: `CHECK ((link_status = ANY (ARRAY['none'::text, 'linked'::text, 'ambiguous'::text, 'manual'::text])))`
- CHECK conv_contacts_name_check: `CHECK (((name IS NULL) OR (length(name) <= 200)))`
- CHECK conv_contacts_phone_check: `CHECK (((phone IS NULL) OR (phone ~ '^[1-9][0-9]{9,14}$'::text)))`

## Referenciada por (7)
public.conv_ai_sessions.requester_contact_id, public.conv_automation_recipients.contact_id, public.conv_booking_proposals.confirmed_by_contact_id, public.conv_booking_proposals.requester_contact_id, public.conv_contacts.merged_into, public.conv_conversations.contact_id, public.conv_messages.sender_contact_id

## Índices
- conv_contacts_lid_uidx: `btree (lid) WHERE (lid IS NOT NULL)` único
- conv_contacts_merged_idx: `btree (merged_into) WHERE (merged_into IS NOT NULL)`
- conv_contacts_phone_key_idx: `btree (conv_private.phone_key(phone)) WHERE ((phone IS NOT NULL) AND (merged_into IS NULL))`
- conv_contacts_phone_uidx: `btree (phone) WHERE (phone IS NOT NULL)` único
- conv_contacts_profile_idx: `btree (profile_id) WHERE (profile_id IS NOT NULL)`
- conv_contacts_student_idx: `btree (non_socio_student_id) WHERE (non_socio_student_id IS NOT NULL)`

## Políticas RLS
- "conv_contacts_admin_read" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- conv_contacts_no_delete — BEFORE DELETE → conv_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
