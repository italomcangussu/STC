// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isOpinionTalk } from '../../supabase/functions/_shared/aiAgent/decide';
import { claimsOwnAction, claimsSuccess } from '../../supabase/functions/_shared/aiAgent/serverRules';

/**
 * Conversa do Hermeson (presidente), 26/10 a 09/11: respostas certas trocadas por "Ainda não registrei nada"
 * porque o filtro de anúncio de sucesso pegava negação, contagem e rótulo de lista.
 */
describe('trava de anúncio de sucesso: negação, contagem e lista não são anúncio', () => {
  it.each([
    'Não, o Ítalo não deixou nenhuma cobrança agendada.',
    'Nada foi agendado ainda para esse mês.',
    'Não confirmei ainda, falta o comprovante.',
    'Ainda não marquei ninguém, quer que eu monte a lista?',
    '✅ *Confirmados:* 12',
    'Combinado! Hoje são 12 inscritos confirmados e 3 pendentes.',
    '- Cancelados: 2',
  ])('não detecta: %s', (t) => {
    expect(claimsSuccess(t)).toBe(false);
  });

  it.each([
    'Pronto, reservei!',
    'Não se preocupe, reservei para você.',
    'Sua reserva está confirmada',
    'Cancelei a cobrança do Jorge.',
    'Quadra reservada.',
  ])('continua detectando: %s', (t) => {
    expect(claimsSuccess(t)).toBe(true);
  });
});

describe('trava de anúncio de sucesso: consulta do administrador no privado', () => {
  const admin = { requester: { profile: { is_admin: true } } };
  it('consulta ou informação do admin sem proposta só corta "eu fiz"', () => {
    expect(isOpinionTalk(admin, { intent: 'consultar' } as never, false)).toBe(true);
    expect(isOpinionTalk(admin, { intent: 'informar' } as never, false)).toBe(true);
    expect(claimsOwnAction('A mensalidade de novembro do Jorge está confirmada.')).toBe(false);
  });
  it('com proposta aberta, intenção de ação, sócio comum ou grupo, a trava cheia continua', () => {
    expect(isOpinionTalk(admin, { intent: 'consultar' } as never, true)).toBe(false);
    expect(isOpinionTalk(admin, { intent: 'admin_financeiro' } as never, false)).toBe(false);
    expect(isOpinionTalk({ requester: { profile: { is_admin: false } } }, { intent: 'consultar' } as never, false)).toBe(false);
    expect(isOpinionTalk({ ...admin, is_group: true }, { intent: 'consultar' } as never, false)).toBe(false);
  });
});

// Henrique (07/11): "O patrocínio de R$ 350 também já ficou lançado" e não estava. O caixa também é anúncio de sucesso.
describe('trava de anúncio de sucesso: lançamentos do caixa', () => {
  it.each([
    'Boa, então não mexo na baixa do Tiago. O patrocínio de R$ 350 também já ficou lançado.',
    'Lancei a despesa do pintor.',
    'Já dei baixa na mensalidade do Diego.',
    'Pronto, registrei o patrocínio.',
  ])('corta mesmo em consulta: %s', (t) => {
    expect(claimsOwnAction(t)).toBe(true);
    expect(claimsSuccess(t)).toBe(true);
  });
  it('estado lançado conta fora da consulta', () => {
    expect(claimsSuccess('Despesa lançada.')).toBe(true);
  });
  it.each([
    'Ainda não dei baixa, falta o valor.',
    'Não lancei nada ainda.',
    'Vou lançar a despesa: Pintor, R$ 400,00. Confirma?',
    'Nenhum lançamento registrado ontem.',
  ])('não corta: %s', (t) => {
    expect(claimsSuccess(t)).toBe(false);
  });
});
