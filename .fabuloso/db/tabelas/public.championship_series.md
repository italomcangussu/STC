# public.championship_series
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| name | text | não |  |  |
| slug | text | não |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| created_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- UNIQUE (slug)

## Referenciada por
- public.championships.series_id
- public.point_history.series_id

## Índices
- championship_series_slug_key: `btree (slug)` único

## Políticas RLS
- "Admins can manage championship_series" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Anyone can read championship_series" — SELECT para public · using `true`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
