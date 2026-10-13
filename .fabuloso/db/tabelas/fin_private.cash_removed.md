# fin_private.cash_removed
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| source_type | text | não |  |  |
| source_id | text | não |  |  |
| reason | text | não |  |  |
| actor_id | uuid | não |  |  |
| occurred_at | timestamp with time zone | não | `now()` |  |
| request_id | uuid | não |  |  |
| snapshot | jsonb | não |  |  |

## Chaves e restrições
- PK (source_type, source_id)
- FK (actor_id) → public.profiles(id)
- CHECK cash_removed_reason_check: `CHECK (((length(reason) >= 8) AND (length(reason) <= 500)))`
- CHECK cash_removed_source_type_check: `CHECK ((source_type = ANY (ARRAY['entry_payment'::text, 'member_payment'::text, 'member_reversal'::text, 'student_payment'::text, 'day_card'::text, 'opening'::text])))`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
