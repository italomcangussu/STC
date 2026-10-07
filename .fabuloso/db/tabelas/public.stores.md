# public.stores
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| name | text | não |  |  |
| cnpj | text | sim |  |  |
| logo_url | text | sim |  |  |
| address | text | sim |  |  |
| phone | text | sim |  |  |
| settings | jsonb | sim | `'{}'::jsonb` |  |
| active | boolean | sim | `true` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)

## Referenciada por
- public.products.store_id
- public.stock_automator_config.store_id

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
