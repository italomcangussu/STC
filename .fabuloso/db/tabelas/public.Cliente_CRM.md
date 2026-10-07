# public.Cliente_CRM
> tabela · RLS on · ~<10k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | bigint | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| nome | text | sim |  |  |
| id_contact | numeric | sim |  |  |
| resumo_lead | text | sim |  |  |
| telefone | text | sim |  |  |
| score_de_intencao | numeric | sim |  |  |
| modelo_atual | text | sim |  | ultimo modelo de aparelho informado pelo cliente |
| Cidade | text | sim |  | qual unidade escolheu ser atendido |
| id_venda_os | text | sim |  |  |
| horario_resumo_lead | timestamp with time zone | sim |  |  |
| entity_id | numeric | sim |  |  |
| valor pago | numeric | sim |  |  |
| produtos/servico | text | sim |  |  |
| credito_aniversário | boolean | sim | `false` |  |
| credito_crm_set_at | timestamp with time zone | sim |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Gatilhos
- trg_set_credito_crm_timestamp — BEFORE UPDATE → public.set_credito_crm_timestamp()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
