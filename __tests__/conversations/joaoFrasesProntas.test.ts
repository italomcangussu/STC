// @vitest-environment node
// Auditoria de 16/11: o João respondia com frase pronta fora de contexto.
// - "Ainda não registrei nada…": a trava de anúncio cortava a bolha inteira (Bruno, "Valor?"; Mario no grupo).
// - "Não entendi se é para seguir com o que descrevi acima": a proposta ficou aberta sem ser entregue (Thiago, 15/11).
import { describe, expect, it } from 'vitest';
import { claimsSuccess, withoutClaims } from '../../supabase/functions/_shared/aiAgent/serverRules';
import { nadaFeito } from '../../supabase/functions/_shared/aiAgent/decide';
import { mustDeliver } from '../../supabase/functions/_shared/aiAgent/turn';

describe('trava de anúncio corta a frase, não a resposta', () => {
  it('resposta útil com um "confirmado" no meio fica sem a frase do anúncio', () => {
    const t = 'A mensalidade é R$ 320,00, vence dia 5. Seu pagamento de outubro já foi confirmado.';
    expect(withoutClaims(t, claimsSuccess)).toBe('A mensalidade é R$ 320,00, vence dia 5.');
  });
  it('bolha sem anúncio passa igual', () => {
    const t = 'O Pix da mensalidade é o CNPJ do clube: 52.393.541/0001-20.';
    expect(withoutClaims(t, claimsSuccess)).toBe(t);
  });
  it('sobra curta do anúncio cai junto', () => {
    expect(withoutClaims('Reservei pra vocês às 18h! Te vejo lá!', claimsSuccess)).toBeNull();
  });
  it('anúncio em linhas separadas tira só a linha', () => {
    const t = 'Jogão de hoje: Mario e Derlan, 18h no saibro.\nJá registrei no app.';
    expect(withoutClaims(t, claimsSuccess)).toBe('Jogão de hoje: Mario e Derlan, 18h no saibro.');
  });
});

describe('cartão é tudo ou nada', () => {
  it('cartão com status confirmado não vira meio cartão', () => {
    const cartao = '🎾 *AUGE OPEN*\n\n👤 *Atleta:* Hermeson Veras\n📋 *Status da inscrição:* ✅ Inscrição confirmada';
    expect(withoutClaims(cartao, claimsSuccess)).toBeNull();
  });
});

describe('quando não sobra nada', () => {
  it('pedido de ação mantém a frase honesta do resumo', () => {
    expect(nadaFeito({ intent: 'reservar' })).toMatch(/Ainda não registrei nada/);
  });
  it('conversa ou pergunta não fala em "montar resumo"', () => {
    for (const intent of ['informar', 'outro', 'consultar'] as const) {
      expect(nadaFeito({ intent })).not.toMatch(/resumo|registrei/);
    }
  });
});

describe('proposta aberta sempre chega', () => {
  it('proposta de parceiros, de aula e do admin saem mesmo com mensagem nova no meio', () => {
    for (const action of ['proposed', 'proposed_participants', 'proposed_admin', 'proposed_join', 'proposed_lessons']) {
      expect(mustDeliver({ action })).toBe(true);
    }
  });
  it('resposta comum continua interrompível', () => {
    expect(mustDeliver({ action: null })).toBe(false);
    expect(mustDeliver({ action: 'availability' })).toBe(false);
  });
});
