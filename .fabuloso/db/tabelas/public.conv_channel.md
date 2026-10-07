# public.conv_channel
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | boolean | não | `true` |  |
| provider | text | não | `'uazapi'::text` |  |
| institutional_name | text | não | `'STC Institucional'::text` |  |
| bot_phone | text | sim |  |  |
| bot_lids | text[] | não | `'{}'::text[]` |  |
| inbound_token_hash | text | sim |  |  |
| inbound_token_rotated_at | timestamp with time zone | sim |  |  |
| ai_direct_enabled | boolean | não | `false` |  |
| ai_group_enabled | boolean | não | `false` |  |
| mention_verified_at | timestamp with time zone | sim |  |  |
| mention_verified_by | uuid | sim |  |  |
| group_session_minutes | smallint | não | `15` |  |
| version | integer | não | `1` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (mention_verified_by) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- CHECK conv_channel_bot_lids_check: `CHECK ((cardinality(bot_lids) <= 5))`
- CHECK conv_channel_bot_phone_check: `CHECK (((bot_phone IS NULL) OR (bot_phone ~ '^[1-9][0-9]{9,14}$'::text)))`
- CHECK conv_channel_group_needs_verified: `CHECK (((NOT ai_group_enabled) OR (mention_verified_at IS NOT NULL)))`
- CHECK conv_channel_group_session_minutes_check: `CHECK (((group_session_minutes >= 2) AND (group_session_minutes <= 120)))`
- CHECK conv_channel_id_check: `CHECK (id)`
- CHECK conv_channel_inbound_token_hash_check: `CHECK (((inbound_token_hash IS NULL) OR (inbound_token_hash ~ '^[0-9a-f]{64}$'::text)))`
- CHECK conv_channel_institutional_name_check: `CHECK (((length(TRIM(BOTH FROM institutional_name)) >= 2) AND (length(TRIM(BOTH FROM institutional_name)) <= 80)))`
- CHECK conv_channel_provider_check: `CHECK ((provider = 'uazapi'::text))`

## Políticas RLS
- "conv_channel_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
