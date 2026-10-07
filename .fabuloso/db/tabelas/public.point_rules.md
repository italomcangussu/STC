# public.point_rules
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| rule_key | text | não |  |  |
| points | integer | não |  |  |
| description | text | sim |  |  |
| updated_at | timestamp with time zone | sim | `timezone('utc'::text, now())` |  |

## Chaves e restrições
- PK (id)
- UNIQUE (rule_key)

## Índices
- point_rules_rule_key_key: `btree (rule_key)` único

## Políticas RLS
- "Enable all access for admins" — ALL para public · using `(auth.uid() IN ( SELECT profiles.id FROM profiles WHERE (profiles.role = 'admin'::user_role)))`
- "Enable read access for all users" — SELECT para public · using `true`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
