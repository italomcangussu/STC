import { repeatedHumor, looksHumorous, humorTopic } from './humor.ts';

Deno.test('rejeita tema bola na linha com nomes diferentes', () => {
  const original = 'Hoje tem Sinner x Alcaraz. Enquanto eles brigam no circuito, por aqui a discussão continua sendo se a bola pegou ou não na linha. 😂';
  const novo = 'Hoje tem Bublik x Shelton. Enquanto eles brigam no circuito, por aqui a discussão continua sendo se a bola pegou ou não na linha. 😂';
  if (!repeatedHumor(novo, [original])) throw new Error('Não detectou template repetido');
});
Deno.test('rejeita piada de bola na rede', () => {
  if (!repeatedHumor('Pouca bola na rede neste sábado 😄', ['Pouca bola na rede hoje 😂'])) throw new Error('Não detectou tema saturado');
});
Deno.test('não bloqueia respostas operacionais', () => {
  if (repeatedHumor('Aula confirmada hoje às 18h na quadra rápida', ['Aula confirmada hoje às 18h na quadra rápida'])) throw new Error('Operação bloqueada');
});
Deno.test('não bloqueia humor de temática nova', () => {
  if (repeatedHumor('Henrique deve estar de férias de novo 😂', ['O juiz pediu replay 😄'])) throw new Error('Falso positivo');
});
Deno.test('classifica tema e distingue resposta neutra', () => {
  if (humorTopic('Parece que a bola pegou na linha 😂') !== 'bola_linha' || looksHumorous('Bom dia, presidente.')) throw new Error('Classificação incorreta');
});
