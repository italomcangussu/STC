import { describe, expect, it } from 'vitest';
import { fallbackIntro, introUserPayload, linesFromUaz, pickIntro, type IntroContext } from '../../supabase/functions/joao-group-intro/messages';

const c: IntroContext = {
  group_name: 'AUGE OPEN - 3ª Etapa Serra & Sertão', persona: 'João Fonseca',
  championship: { name: 'Serra e Sertão 2026', title: ['AUGE OPEN'], start_date: '2026-11-27', end_date: '2026-11-29', total: 2, socios: 1,
    classes: [{ class: '4ª Classe', athletes: [{ name: 'Carlos Carneiro', socio: true, city: null }, { name: 'Bruno Farias', socio: false, city: 'Tianguá' }] }] },
  recent: [{ sender: 'Mario Rego', body: 'quem perder paga o almoço kkkk' }],
};
const json = (m: string[]) => JSON.stringify({ mensagens: m });
const boa = ['Opa, cheguei! João Fonseca, o Fonsequinha 😄', 'Mario, almoço por conta de quem perde? Então o Bruno já pode ir guardando a carteira kkkk', 'Me marca no @ que eu apareço!'];

describe('apresentação do João no grupo', () => {
  it('aceita a resposta do modelo no formato, com nome, sobrenome e apelido', () => {
    expect(pickIntro(json(boa), c)).toEqual(boa);
    expect(pickIntro('```json\n' + json(boa) + '\n```', c)).toEqual(boa);
  });

  it.each([
    ['não é JSON', 'Oi, pessoal!'],
    ['uma mensagem só', json(['João Fonseca, o Fonsequinha, na área!'])],
    ['sem o apelido', json(['Sou o João Fonseca', 'Bora!'])],
    ['se diz IA', json(['João Fonseca, o Fonsequinha, a IA do clube', 'Bora!'])],
    ['fala de Pix', json(['João Fonseca, o Fonsequinha', 'Quem não mandou o Pix?'])],
    ['mostra telefone', json(['João Fonseca, o Fonsequinha', 'Me chama no 88999990000'])],
  ])('volta ao texto pronto quando o modelo %s', (_, raw) => {
    expect(pickIntro(raw, c)).toEqual(fallbackIntro(c));
  });

  it('"ia" verbo não é confundido com a sigla', () => {
    const m = ['João Fonseca, o Fonsequinha, chegando!', 'Eu ia ficar calado, mas com essa do almoço não dá kkk'];
    expect(pickIntro(json(m), c)).toEqual(m);
  });

  it('o texto pronto se apresenta e não fala de dinheiro', () => {
    const t = fallbackIntro(c).join(' ');
    expect(t).toContain('João Fonseca');
    expect(t).toContain('Fonsequinha');
    expect(t).not.toMatch(/pix|r\$|pag/i);
  });

  it('o modelo lê só primeiro nome, sócio × convidado e o papo, sem telefone', () => {
    const p = JSON.parse(introUserPayload(c));
    expect(p.campeonato.classes[0].atletas).toEqual(['Carlos (sócio)', 'Bruno (convidado, Tianguá)']);
    expect(p.campeonato.datas).toBe('27/11 a 29/11');
    expect(p.papo_recente).toEqual(['Mario: quem perder paga o almoço kkkk']);
  });

  it('lê o papo da UAZAPI em ordem, sem as falas do próprio número', () => {
    const body = { messages: [
      { messageTimestamp: 20, senderName: 'Bruno', text: 'segunda' },
      { messageTimestamp: 10, senderName: 'Mario', text: 'primeira' },
      { messageTimestamp: 15, fromMe: true, text: 'do clube' },
      { messageTimestamp: 16, senderName: 'X', text: '' },
    ] };
    expect(linesFromUaz(body)).toEqual([{ sender: 'Mario', body: 'primeira' }, { sender: 'Bruno', body: 'segunda' }]);
    expect(linesFromUaz(null)).toEqual([]);
  });
});
