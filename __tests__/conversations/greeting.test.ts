// @vitest-environment node
// Bom-dia diário do João: partes puras (a função `joao-daily-greeting` só junta isto com rede e banco).
import { describe, expect, it } from 'vitest';
import { cleanGreeting, clubFacts, fallbackGreeting, FALLBACK_GREETINGS, GREETING_SYSTEM_PROMPT, isValidGreeting } from '../../supabase/functions/_shared/joaoGreeting';

describe('pulso do clube no bom-dia', () => {
  it('sem a função no banco (nulo, erro, lixo) o bom-dia segue só com o tênis', () => {
    const vazio = { plays_today: 0, first_play_today: null, recent_results: [] };
    expect(clubFacts(null)).toEqual(vazio);
    expect(clubFacts(undefined)).toEqual(vazio);
    expect(clubFacts('erro')).toEqual(vazio);
    expect(clubFacts({ plays_today: 'muitos', first_play_today: 'cedo', results: 'x' })).toEqual(vazio);
  });

  it('aceita o que o RPC devolve; no máximo 3 resultados; descarta resultado sem vencedor ou perdedor', () => {
    const r = (winner: unknown, loser: unknown, extra: Record<string, unknown> = {}) => ({ played_on: '2026-10-06', winner, loser, score: '6x3 6x4', championship: 'Open da Galera', phase: 'Final', walkover: false, ...extra });
    const f = clubFacts({ plays_today: 3, first_play_today: '06:30', results: [r('Ana', 'Beto'), r(null, 'Beto'), r('Caio', 'Davi', { score: null, walkover: true }), r('Eva', 'Fabi'), r('Gil', 'Hugo')] });
    expect(f.plays_today).toBe(3);
    expect(f.first_play_today).toBe('06:30');
    expect(f.recent_results.map((x) => [x.winner, x.loser])).toEqual([['Ana', 'Beto'], ['Caio', 'Davi'], ['Eva', 'Fabi']]);
    expect(f.recent_results[1]).toMatchObject({ score: null, walkover: true });
  });

  it('o prompt manda citar UMA coisa do clube, sem humilhar, e nunca inventar', () => {
    expect(GREETING_SYSTEM_PROMPT).toContain('cite UMA coisa');
    expect(GREETING_SYSTEM_PROMPT).toContain('nunca para humilhar quem perdeu');
    expect(GREETING_SYSTEM_PROMPT).toContain('Nunca invente');
    expect(GREETING_SYSTEM_PROMPT).toContain('recent_greetings');
  });
});

describe('texto do bom-dia', () => {
  it('só vale se começa com "Bom dia" e tem tamanho de mensagem; senão cai no texto de reserva do dia', () => {
    expect(isValidGreeting('Bom dia, turma! Hoje tem play marcado cedo, quem chega primeiro pega a sombra.')).toBe(true);
    expect(isValidGreeting('bom dia pessoal, café na mão e raquete na bolsa!')).toBe(true);
    expect(isValidGreeting('Boa tarde, turma! Hoje tem play marcado cedo, quem chega primeiro pega a sombra.')).toBe(false);
    expect(isValidGreeting('Bom dia!')).toBe(false);
    expect(isValidGreeting(`Bom dia ${'x'.repeat(600)}`)).toBe(false);
    expect(FALLBACK_GREETINGS.every(isValidGreeting)).toBe(true);
    expect(fallbackGreeting('2026-10-07')).toBe(FALLBACK_GREETINGS[7 % FALLBACK_GREETINGS.length]);
    expect(fallbackGreeting('2026-10-08')).not.toBe(fallbackGreeting('2026-10-07'));
  });

  it('limpa aspas e quebras de linha do modelo', () => {
    expect(cleanGreeting('"Bom dia, turma!\n\nBora jogar?"')).toBe('Bom dia, turma! Bora jogar?');
    expect(cleanGreeting('“Bom dia!”')).toBe('Bom dia!');
    expect(cleanGreeting(null)).toBe('');
  });
});
