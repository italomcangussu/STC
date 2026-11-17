# Pendências

## João — auditoria de 16/11 (o que não coube em 17/11)
- **Renovação de Card lançada como receita solta** (Iago Ribeiro, Matheus, José): aguardando o Henrique confirmar
  que eram renovações. Não renovar sem a confirmação. Depois: quando o admin lança "aula/mensalidade de aluno" como
  receita, sugerir a renovação do Card do aluno em vez da categoria.
- **Humor em grupo e nome inventado ("Daniel Rodrigues")**: correção de prompt, que exige caso de eval novo
  (falha antes, passa depois). O eval não rodou por falta de OPENAI_API_KEY nesta máquina.
- **Comprovante de convidado sem cadastro numa conversa de inscrição**: continua guardado até a pré-inscrição nascer
  (caso Bruno). Se a pessoa já estiver inscrita pelo app sem perfil vinculado, o modelo ainda conduz: medir.
- **Recusa de comprovante de quem não tem perfil de sócio**: segue sem achar (a recusa exige profile_id).
- **Comprovantes parados em produção**: Ronaldo, R$ 7,50, repassado em 12/11 (o Henrique pediu para desconsiderar);
  Diego, R$ 130, de 10/11, ainda esperando finalidade (a inscrição foi confirmada em 13/11 por outro caminho).
- **Suítes que já falhavam**: automations e topics (dependem da data); adminAutomations estoura 5 s com a fila cheia.
