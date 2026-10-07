# public.championship_phase_points
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| phase | text | não |  |  |
| points | integer | não |  |  |

## Chaves e restrições
- PK (phase)
- CHECK championship_phase_points_points_check: `CHECK ((points >= 0))`

## Políticas RLS
- "Admins can manage phase points" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Anyone can read phase points" — SELECT para public · using `true`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
