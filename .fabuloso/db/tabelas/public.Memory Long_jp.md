# public.Memory Long_jp
> tabela · RLS on · ~0 linhas — This is a duplicate of Memory Long

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id_sender | numeric | não |  |  |
| created_at | timestamp with time zone | não |  |  |
| recipient | text | sim |  |  |
| Conversation_summary | text | sim |  |  |
| count_summary | numeric | sim |  |  |
| story_respond | text | sim |  |  |
| username | text | sim |  |  |
| name | text | sim |  |  |
| update_at | timestamp with time zone | sim |  |  |
| last_message | text | sim |  |  |
| follow-up | boolean | sim | `false` |  |
| phonenumber | text | sim |  |  |
| followups | text[] | sim |  |  |
| message_text | text | sim |  |  |
| message_repasse | text | sim |  |  |
| message_especialista | text | sim |  |  |
| whatsapp_link_repasse | text | sim |  |  |
| last_ia_message | text | sim |  |  |
| intencao_cliente | text | sim |  |  |
| kommo_event | text | sim |  |  |
| Cidade | text | sim |  |  |
| Resposta agente 1 | jsonb | sim |  |  |
| Resposta agente 2 | text | sim |  |  |
| name_cliente | text | sim |  |  |
| resumo_chat | text | sim |  |  |

## Chaves e restrições
- PK (id_sender)

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
