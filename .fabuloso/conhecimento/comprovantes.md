# Comprovantes e mensalidades — João

Atualizado em 04/11/2026. Publicado no projeto agentes N8N (`smztsayzldjmkzmufqcz`), organização `bkkdufqmfuxobyahvhjx`, pelo plugin Supabase. Commit/push locais pendentes: .git sem escrita nesta sessão.

## Fluxo e decisões
- `receiptContext.ts`: assunto recente, titular, competência declarada e contexto limitado ao arquivo. Declarações do remetente prevalecem sobre perguntas do agente; lista genérica de opções não define finalidade. Mais de uma finalidade exige esclarecer.
- `receiptIntent.ts`: finalidade exclusiva. Mensalidade nunca tenta inscrição como segunda opção. Sem finalidade, pergunta. Uma explicação posterior da competência pode retomar a baixa; pedido de outro assunto não a dispara. Nome explícito e competência em mensagens separadas preservam titularidade dentro do comprovante atual.
- `turnShortcuts.ts`: mídia com legenda e arquivo seguido de texto na mesma rajada consultam o stage do arquivo pendente, em vez de usar comprovante anterior. Admin só usa baixa própria com indicação de titularidade.
- `receiptForward.ts`: resultado e motivo do banco determinam a resposta. Divergência, duplicado e leitura incerta recebem instrução específica. Erro de RPC não vira confirmação de pagamento.
- `financeReceiptOcr.ts`: agendamento, cancelamento e processamento não são pagamento concluído; preserva apenas campos estruturados. Mantém os formatos bancários já cobertos por testes.

## Banco
Migration `20261104091056_joao_receipt_evidence.sql`, sem backfill e sem exclusão de dados.
- Novo overload `conv_svc_receipt_membership_auto(uuid,jsonb)`, restrito a service_role, com `month` e `purpose_kind`. Assinatura antiga UUID mantida como wrapper com as mesmas guardas.
- Exige OCR ok, valor/data com confiança alta, coerência entre declarado e OCR e data não futura. Não inventa a data do pagamento.
- Competência explícita filtra a cobrança antes de comparar o valor. Sem competência, mais de uma cobrança compatível é ambiguidade; não prioriza automaticamente o mês atual.
- Favorecido aceita nome cadastrado ou CNPJ compatível com a chave Pix configurada, reutilizando a regra financeira existente. O OCR não usa o CNPJ do pagador como favorecido.
- Retorna a competência realmente paga e a registra no detalhe da intenção.
- Travas por perfil, hash e identificador serializam chamadas automáticas. Mesmo identificador de transação em arquivos distintos é duplicado.
- Inserção da submissão e aprovação ficam na mesma subtransação. Falha de aprovação desfaz ambas, preservando a intenção pendente.
- Reconcilia documento e cobrança; não consulta o extrato do banco.

## Verificação
- Regressão ampla final: 708 testes em 53 arquivos passaram. Após a última guarda adicional para administradores sem finalidade, os 123 testes afetados passaram; Deno check também passou.
- 24 arquivos SQL passaram em PGlite, incluindo novo teste `joao_receipt_evidence.sql`: ambiguidade, competência atrasada, confiança, data futura, agendamento, duplicidade por transação e permissões negativas.
- Build passou. Deno check dos módulos receiptIntent e turnShortcuts passou.
- Typecheck geral ainda tem erros anteriores em humor.test.ts (global Deno ausente no tsc) e turn.ts (inferência de ChatMessage.role). Não foram atribuídos a esta mudança.
- Não houve avaliação com modelo real nem medição de custo/queda de erros em produção. O plugin permitiu investigar os registros reais após a identificação da conta correta.

## Incidentes reais e publicação
- Thieslley, 04/11: administrador/sócio enviou arquivo e informou nome, valor e mês em mensagens separadas. A intenção existia em awaiting_purpose, mas o agente dizia que não havia comprovante pendente. Reproduzido: reconhecer nome sem preposição, preservar titularidade entre mensagens e encaminhar a própria mensalidade com leitura incerta ao financeiro, usando o arquivo guardado e sem quitação automática.
- Também foram observadas baixas automáticas antigas com confiança baixa no valor; a nova guarda exige confiança alta. Isso é um risco confirmado no fluxo anterior, não prova de que esses pagamentos estivessem incorretos.
- Migration aplicada: `20261104091056_joao_receipt_evidence.sql` (versão real atribuída pelo Supabase; arquivo local renomeado para coincidir).
- Funções publicadas: `whatsapp-webhook` v117 e `finance-receipt-whatsapp` v14. Ambas ACTIVE, configuração de autenticação anterior preservada.
- Verificação SQL publicada: confiança alta aceita; agendamento/confiança baixa recusados; service_role autorizado; anon/authenticated sem execução.
- Advisor de segurança: oito avisos anteriores; nenhum referente às funções novas desta tarefa.
- Não foram alteradas cobranças históricas, reprocessadas intenções antigas ou enviadas mensagens manualmente durante a investigação.

- Proteção final: arquivo do administrador sem finalidade explícita não tenta quitar inscrição de campeonato por valor. Caso reproduzido em teste antes da correção; webhook republicado na versão 117.

## Pendências
- Commit e push dos arquivos da tarefa quando .git estiver gravável. Não incluir supabase/.temp/cli-latest nem .codex, que já estavam alterados.
- Sincronizar com main remota antes de commitar; módulos publicados foram comparados com HEAD e os arquivos não afetados da versão remota foram preservados no pacote.
- Regenerar mapa completo de schema/base quando a conexão direta funcionar; a migration aplicada e o registro de entregas já estão disponíveis.
- Typecheck global e avaliação com o modelo real permanecem pendentes conforme observações acima.

A credencial de .env.local foi carregada sem exposição, mas o acesso direto falhou em DNS. A conexão pelo plugin Supabase funcionou por `link_6ab980ea43348191889ff9429865af6f`, confirmado pela organização e pelo projeto.

## Abatimento de despesas na mensalidade (04/11/2026)
- Caso: o sócio Ítalo Cangussú (admin, profile a585c738…) paga a mensalidade (R$ 400) já descontando "Custo aplicativo" (R$ 148/mês) e, desde 11/2026, "Custo agente de IA" (R$ 23/mês). O Pix dele vem líquido (R$ 229) e isso é o esperado.
- Banco (`20261104140904_mensalidade_abatimento_despesas.sql`, aplicada no remoto pela API de migrations com `SUPABASE_ACCESS_TOKEN`): coluna `fin_recurrences.offset_profile_id` → profiles. Em `fin_private`: `member_offsets`/`member_offset_cents` (despesas pendentes da mesma competência ligadas ao sócio), `settle_member_offsets` (paga as despesas) e `member_offset_plan` (recorrências ativas abatidas).
- `fin_approve_receipt`: se valor alocado + abatimento = saldo da mensalidade, quita a mensalidade cheia e paga as despesas na mesma conta e data (saldo líquido da conta = Pix; DRE com receita 400 e despesas 171). Vale para baixa automática, aprovação pelo WhatsApp e painel; retorna `offset_cents`.
- `conv_svc_receipt_membership_auto` aceita Pix cheio OU líquido; `AMOUNT_MISMATCH` devolve o valor líquido; retorno ganha `offset_cents` e `offset_items`. `socio_ficha` (`ai_admin_read_more`) ganha `data.offsets`; a proposta `fin_receipt_approve` ganha `offset_cents/offset_items` (`conv_private.receipt_proposal_offsets`).
- TS (`_shared/aiAgent`): `receiptForward.ts` (offsetNote na baixa e no aviso ao financeiro), `adminReads.ts` (linha "Abatido da mensalidade todo mês"), `adminMessagesFin.ts` (proposta cita o abatimento).
- Dados: "Custo aplicativo" ligada ao Ítalo; criada recorrência "Custo agente de IA" R$ 23 (mesma categoria/conta, dia 5, início 2026-11-01). Outubro ficou como estava (lançado cheio pela planilha).
- Testes: PGlite `mensalidade_abatimento_despesas.sql` 25/25; `mensalidadeAbatimento.test.ts` e 91 testes afetados passaram; deno check ok. Deploy: `whatsapp-webhook` v119 (verify_jwt false preservado).
- Pendências: o painel (formulário de recorrência) não mostra nem edita `offset_profile_id`; só por SQL. O papel de leitura do script não executa funções `fin_private` (permissão revogada, esperado).
