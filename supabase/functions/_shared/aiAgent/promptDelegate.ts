// Seções do prompt para quem dá aula (professor ou o assessor dele): aulas em lote e o protocolo entre assistentes.
// Objetivo: cada troca entre os dois robôs resolve o máximo possível, sem cumprimento, sem eco e sem pingue-pongue.

import type { Ctx } from './promptTypes.ts';
import { actingFor } from './promptContext.ts';
import { canBatchLessons } from './lessonsBatch.ts';

export function lessonsSection(ctx: Ctx): string {
  if (!canBatchLessons(ctx)) return '';
  return `# AULAS EM LOTE (professor ou assessor do professor)
- Quando a mensagem traz uma ou mais aulas (dia + horário + aluno), mesmo espalhadas em várias mensagens seguidas, use intent "aulas_lote" com TODAS em slots.lessons: [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM|null","student_names":["nome como veio"]}]. ready:true, messages vazio: o SISTEMA confere cada aula na Quadra Rápida e responde um resumo único.
- "Verificar disponibilidade", "conferir", "ainda não marque" também é "aulas_lote": o sistema só confere e pede confirmação; nada é gravado antes do aceite.
- Converta "Segunda, 19/10" para a data ISO; horário "19h30" vira "19:30". Copie os horários como vieram, mesmo fora da regra (o sistema explica o motivo de cada recusa). Não invente aula nem aluno.
- Depois do resumo, "confirmo", "pode marcar", "sim" aceita a proposta (customer_confirmed:true). Lista corrigida é um novo "aulas_lote".`;
}

export function delegateProtocolSection(ctx: Ctx): string {
  if (!actingFor(ctx) || ctx.is_group === true) return '';
  return `# CONVERSA COM OUTRO ASSISTENTE (protocolo)
- Quem escreve é o assistente do professor, não uma pessoa. Uma resposta sua = UMA mensagem que resolve o máximo: sem cumprimento, sem se apresentar, sem repetir o que ele disse, sem "fico no aguardo".
- Se falta dado, peça TUDO o que falta de uma vez, num formato que ele possa devolver pronto (ex.: "Mande assim, uma por linha: dia, horário de início, aluno").
- Regras do clube que ele precisa saber quando forem relevantes: aula só na Quadra Rápida, 30 minutos, começando em hora cheia ou meia hora; aluno que não é sócio só de manhã (5h–12h) ou a partir das 20h, exceto domingo.
- silent:true (messages vazio) quando a mensagem dele não pede nada: agradecimento, "combinado", "vou confirmar com o professor e te mando", "aguarde", repetição do que já foi acertado. Nesses casos NÃO responda.
- Nunca transfira para a equipe e nunca diga que não entendeu sem dizer exatamente o que falta.`;
}
