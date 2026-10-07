# public.patients_ebm
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| patient_id | uuid | não | `gen_random_uuid()` |  |
| patient_name | text | não |  |  |
| patient_external_id | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| last_consultation_date | date | sim |  |  |
| last_clinical_context | text | sim |  |  |
| last_keywords_used | text[] | sim |  |  |
| last_databases_queried | text | não | `'PubMed/Medline'::text` |  |
| last_verdict | text | sim |  |  |
| last_evidence_summary | text | sim |  |  |
| last_passed_safety_check | boolean | sim |  |  |
| last_flagged_risks | text[] | não | `'{}'::text[]` |  |
| last_audit_json | jsonb | sim |  |  |
| audit_history | jsonb | não | `'[]'::jsonb` |  |

## Chaves e restrições
- PK (patient_id)
- CHECK patients_ebm_last_verdict_check: `CHECK ((last_verdict = ANY (ARRAY['SUPPORTED'::text, 'NOT_SUPPORTED'::text, 'CONTROVERSIAL'::text, 'INCONCLUSIVE'::text])))`

## Índices
- patients_ebm_external_id_uq: `btree (patient_external_id) WHERE (patient_external_id IS NOT NULL)` único
- patients_ebm_full_name_idx: `btree (patient_name)`

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
