# public.members
> view · security_invoker — Perfis vinculados ao clube como sócio, incluindo admins. Espelha MEMBER_ROLES/isMember em utils.ts. security_invoker mantém a RLS de profiles válida para quem consulta.

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | sim |  |  |
| name | text | sim |  |  |
| email | text | sim |  |  |
| role | user_role | sim |  |  |
| balance | numeric | sim |  |  |
| avatar_url | text | sim |  |  |
| category | text | sim |  |  |
| is_professor | boolean | sim |  |  |
| is_active | boolean | sim |  |  |
| created_at | timestamp with time zone | sim |  |  |
| age | integer | sim |  |  |
| phone | text | sim |  |  |
| legacy_wins | integer | sim |  |  |
| legacy_losses | integer | sim |  |  |
| legacy_sets_won | integer | sim |  |  |
| legacy_games_won | integer | sim |  |  |
| legacy_points | integer | sim |  |  |
| legacy_sets_lost | integer | sim |  |  |
| legacy_games_lost | integer | sim |  |  |
| legacy_tiebreaks_won | integer | sim |  |  |
| legacy_tiebreaks_lost | integer | sim |  |  |
| legacy_matches_played | integer | sim |  |  |
| legacy_matches_with_tiebreak | integer | sim |  |  |
| updated_at | timestamp with time zone | sim |  |  |

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)

## Definição
```sql
SELECT id,
    name,
    email,
    role,
    balance,
    avatar_url,
    category,
    is_professor,
    is_active,
    created_at,
    age,
    phone,
    legacy_wins,
    legacy_losses,
    legacy_sets_won,
    legacy_games_won,
    legacy_points,
    legacy_sets_lost,
    legacy_games_lost,
    legacy_tiebreaks_won,
    legacy_tiebreaks_lost,
    legacy_matches_played,
    legacy_matches_with_tiebreak,
    updated_at
   FROM profiles
  WHERE role::text = ANY (ARRAY['socio'::text, 'admin'::text]);
```
