# Pendências

## João — auditoria de 16/11 (o que não coube em 17/11)
- **Receita de aluno que pode ser renovação de Card** (Iago Ribeiro; José em 19/10): aguardando o Henrique confirmar.
  Não renovar sem a confirmação. Painel e João já avisam nos casos novos (commits 9f50182 e f7085ea).
- **Data dos Cards do Matheus e do José**: estão com pagamento em 09/11, mas o Pix (OCR e E2E do comprovante) é de
  16/11. Só mudar com o Henrique.
- **Humor em grupo e nome inventado ("Daniel Rodrigues")**: correção de prompt, que exige caso de eval novo
  (falha antes, passa depois). O eval não rodou por falta de OPENAI_API_KEY nesta máquina.
- **Comprovante de convidado sem cadastro numa conversa de inscrição**: continua guardado até a pré-inscrição nascer
  (caso Bruno). Se a pessoa já estiver inscrita pelo app sem perfil vinculado, o modelo ainda conduz: medir.
- **Recusa de comprovante de quem não tem perfil de sócio**: segue sem achar (a recusa exige profile_id).
- **Suítes que já falhavam**: automations e topics (dependem da data); adminAutomations estoura 5 s com a fila cheia.

## Campeonato Serra e Sertão
- **Reembolso do Ealber Luna** (desistiu da 5ª Classe; Mardes entrou no lugar, migration 20261126130000): o pagamento de R$ 130 (`fin_entry`) segue intacto. Devolver ou não é decisão da organização; nada foi feito no financeiro.
