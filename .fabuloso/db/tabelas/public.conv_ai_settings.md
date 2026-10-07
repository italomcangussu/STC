# public.conv_ai_settings
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| version | integer | não |  |  |
| active | boolean | não | `false` |  |
| persona_name | text | não | `'Assistente do STC'::text` |  |
| model | text | não | `''::text` |  |
| instructions | text | não | `''::text` |  |
| business_context | text | não | `''::text` |  |
| buffer_seconds | integer | não | `6` |  |
| max_turns | integer | não | `12` |  |
| handoff_keywords | text[] | não | `ARRAY['atendente'::text, 'humano'::text, 'pessoa'::text, 'f…` |  |
| daily_turn_budget | integer | não | `300` |  |
| proposal_ttl_minutes | integer | não | `20` |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (version)
- FK (created_by) → public.profiles(id)
- CHECK conv_ai_active_needs_model: `CHECK (((NOT active) OR (length(TRIM(BOTH FROM model)) > 0)))`
- CHECK conv_ai_settings_buffer_seconds_check: `CHECK (((buffer_seconds >= 0) AND (buffer_seconds <= 60)))`
- CHECK conv_ai_settings_business_context_check: `CHECK ((length(business_context) <= 6000))`
- CHECK conv_ai_settings_daily_turn_budget_check: `CHECK (((daily_turn_budget >= 1) AND (daily_turn_budget <= 5000)))`
- CHECK conv_ai_settings_instructions_check: `CHECK ((length(instructions) <= 6000))`
- CHECK conv_ai_settings_max_turns_check: `CHECK (((max_turns >= 1) AND (max_turns <= 100)))`
- CHECK conv_ai_settings_model_check: `CHECK ((length(model) <= 120))`
- CHECK conv_ai_settings_persona_name_check: `CHECK (((length(TRIM(BOTH FROM persona_name)) >= 1) AND (length(TRIM(BOTH FROM persona_name)) <= 40)))`
- CHECK conv_ai_settings_proposal_ttl_minutes_check: `CHECK (((proposal_ttl_minutes >= 2) AND (proposal_ttl_minutes <= 120)))`
- CHECK conv_ai_settings_version_check: `CHECK ((version > 0))`

## Referenciada por
- public.conv_ai_decisions.settings_version

## Políticas RLS
- "conv_ai_settings_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
