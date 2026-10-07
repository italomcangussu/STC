# public.championship_rounds
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| championship_id | uuid | não |  |  |
| round_number | integer | não |  |  |
| name | character varying(100) | não |  |  |
| phase | character varying(50) | não |  |  |
| start_date | date | não |  |  |
| end_date | date | não |  |  |
| status | character varying(20) | sim | `'pending'::character varying` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| class | text | sim |  | Classe a que esta rodada pertence. NULL = campeonato do modelo antigo (pré-Criador), cujas classes compartilham rodadas. |

## Chaves e restrições
- PK (id)
- FK (championship_id) → public.championships(id) on delete cascade

## Referenciada por
- public.matches.round_id

## Índices
- uidx_championship_rounds_champ_class_number: `btree (championship_id, class, round_number)` único

## Políticas RLS
- "Admins manage rounds" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role)::text = 'admin'::text))))`
- "Public view rounds" — SELECT para public · using `true`

## Gatilhos
- update_championship_rounds_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
