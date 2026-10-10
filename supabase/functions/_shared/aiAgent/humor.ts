/**
 * Memória de humor do João: compara piadas com conv_messages (até 30 dias).
 * Somente respostas sociais são avaliadas; operações, valores e confirmações ficam intactos.
 */
export const normHumor = (s: string): string => String(s || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const patterns: [string, RegExp][] = [
  ['bola_linha', /\b(linha|pegou ou nao|bola dentro|bola fora|marcacao duvidosa)\b/],
  ['bola_rede', /\b(rede|bola na rede|bateu na rede)\b/],
  ['ferias', /\b(ferias|nunca trabalha|trabalha pouco)\b/],
  ['apostas', /\b(bets|aposta|palpite|odds)\b/],
  ['desculpas', /\b(desculpa|culpa da raquete|culpa do vento)\b/],
  ['replay', /\b(replay|arbitro|jurado|juiz de linha)\b/],
  ['ranking', /\b(ranking|quarto lugar|quinto lugar)\b/],
];
const stop = new Set('bom dia boa tarde boa noite do da de dos das por para que com em na no um uma hoje daqui aqui tenis turma tenistas clube stc essa esse mais pouco agora todo toda todos enquanto circuito jogam joga eles elas jogo'.split(' '));
export function humorTopic(text: string): string | null {
  const t = normHumor(text);
  return patterns.find(([, exp]) => exp.test(t))?.[0] || null;
}
export function looksHumorous(text: string): boolean {
  return /😂|🤣|😆|😅|😁|😄|kkkk|resenha|zoeira|piada/i.test(text)
    || /bola (na rede|fora|dentro)|pegou ou nao na linha|vive de ferias/.test(normHumor(text));
}
function tokens(text: string): Set<string> {
  return new Set(normHumor(text).split(' ').filter(x => x.length >= 4 && !stop.has(x)));
}
function similarity(a: string, b: string): number {
  const x=tokens(a), y=tokens(b);
  if (x.size < 4 || y.size < 4) return 0;
  let shared=0;
  for(const z of x) if(y.has(z)) shared++;
  return shared/Math.min(x.size,y.size);
}
export function repeatedHumor(text: string, history: string[]): string | null {
  if (!looksHumorous(text)) return null;
  const current=normHumor(text), topic=humorTopic(text);
  for(const [i,prev] of history.slice(0,70).entries()) {
    if (!looksHumorous(prev)) continue;
    if (current===normHumor(prev)) return 'frase_identica';
    if (similarity(text,prev)>=0.78) return 'estrutura_semelhante';
    if (topic && topic===humorTopic(prev) && i<15) return 'tema_recente';
  }
  return null;
}
export function noveltyHint(history: string[]): string {
  const recent=history.slice(0,20);
  const used=[...new Set(recent.map(humorTopic).filter(Boolean))];
  return 'Você repetiu uma piada. Refaça de modo CRIATIVO e CONTEXTUAL, sem repetir mecanismos, temas ou bordões. '
    +'Temas recentes a evitar: '+(used.join(', ')||'nenhum')+'. '
    +'Sem piada é melhor que piada repetida. Exemplos das suas falas que NÃO deve reciclar: '
    +JSON.stringify(recent.slice(0,10)).slice(0,1700);
}
