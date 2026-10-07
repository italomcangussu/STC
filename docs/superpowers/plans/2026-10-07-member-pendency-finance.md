# Pendência de sócio — financeiro + automações + OCR

Data: 2026-10-07

## Objetivo
Adicionar Pendência de Sócio ao contas a receber, com cobrança consolidada por WhatsApp, régua configurável, Pix do clube, pagamento parcial/excedente, baixa automática por comprovante OCR e consulta/baixa via João.

## Decisões
- Local: Financeiro > Receber > Pendências.
- Admin escolhe se envia cobrança no lançamento.
- Régua padrão editável: vencimento, +3, +7, +14 e +21 dias.
- Cobrança para quando saldo é quitado.
- Mensagem consolidada por sócio.
- Pagamento parcial permitido; excedente vira crédito.
- Pix: 52.393.541/0001-20.
- Encargos de pendência configuráveis; padrão zero.
- Day Card: convidado e data da visita opcionais.
- OCR de alta confiança pode baixar automaticamente.
- João pode consultar pendências, receber comprovante e comunicar a baixa que o motor financeiro efetivar.

## Arquitetura
1. Reutilizar public.fin_member_charges para que pagamentos, parcial, crédito, histórico e comprovantes continuem numa única fonte de verdade.
2. Permitir charge sem plano apenas quando charge_type=member_pendency; adicionar metadados próprios.
3. Manter mensalidades inalteradas.
4. Reutilizar conv_automations/conversations-dispatch para a régua; adicionar audiência financeira de pendência consolidada.
5. Estender comprovantes para aprovação automática segura e ingestão por WhatsApp.
6. UI admin: nova aba Pendências em Receber.
7. UI sócio: identificar pendências, Pix e comprovante.
8. João: contexto financeiro inclui pendências e mídia de comprovante pode acionar validação.

## Regras de auto-baixa
- OCR ok.
- Valor e data com confiança alta.
- Dados declarados não divergem do OCR.
- Favorecido compatível quando configurado.
- Sem duplicidade por hash/identificador/valor+data.
- Só cobranças abertas/parciais do mesmo sócio.
- Distribuição: vencidas primeiro, depois vencimento mais antigo.
- Valor menor: parcial.
- Valor maior: quita as cobranças elegíveis e sobra vira crédito.
- Qualquer ambiguidade vai para revisão.

## Segurança
- Escrita financeira apenas via SECURITY DEFINER com require_admin ou fluxo autenticado explicitamente validado.
- RLS preservada.
- Nenhum texto OCR bruto persistido.
- Idempotência em criação/pagamento/disparo.
- Automação revalida saldo antes de enviar.
