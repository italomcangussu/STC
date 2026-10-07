# public.conv_ai_memory_candidates
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| subject_name | text | não |  |  |
| kind | text | não |  |  |
| content | text | não |  |  |
| confidence | numeric(4,3) | não | `0.500` |  |
| status | text | não | `'pending'::text` |  |
| source_message_id | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| reviewed_at | timestamp with time zone | sim |  |  |
| reviewed_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (reviewed_by) → auth.users(id) on delete set null
- FK (source_message_id) → public.conv_messages(id) on delete set null
- CHECK conv_ai_memory_candidates_confidence_check: `CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))`
- CHECK conv_ai_memory_candidates_content_check: `CHECK (((char_length(content) >= 3) AND (char_length(content) <= 500)))`
- CHECK conv_ai_memory_candidates_kind_check: `CHECK ((kind = ANY (ARRAY['confirmed_fact'::text, 'recurring_preference'::text, 'social_relation'::text, 'inside_joke'::text])))`
- CHECK conv_ai_memory_candidates_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'superseded'::text])))`
- CHECK conv_ai_memory_candidates_subject_name_check: `CHECK (((char_length(subject_name) >= 2) AND (char_length(subject_name) <= 120)))`

## Índices
- conv_ai_memory_candidates_status_created_idx: `btree (status, created_at DESC)`
- conv_ai_memory_candidates_subject_idx: `btree (lower(subject_name), status)`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
