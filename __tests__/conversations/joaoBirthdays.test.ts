import { describe, expect, it } from 'vitest';
import { birthdayParts, parseSlots } from '../../supabase/functions/_shared/aiAgent/turn';
import { fallbackTexts, groupText, pickTexts, type Birthday } from '../../supabase/functions/joao-birthdays/messages';

const lucas: Birthday = { profile_id: 'p1', name: 'Lucas Rodrigues', phone: '5588992241070', direct_conversation_id: 'c1', memories: [] };

describe('parabéns do João', () => {
  it('usa o texto do modelo quando vem no formato e cita a pessoa', () => {
    const raw = '{"grupo":"Parabéns, Lucas! Hoje o play é seu 🎾","privado":["Fala, Lucas! Feliz aniversário!"]}';
    expect(pickTexts(raw, lucas, '2026-10-08')).toEqual({ group: 'Parabéns, Lucas! Hoje o play é seu 🎾', direct: ['Fala, Lucas! Feliz aniversário!'] });
  });

  it.each([
    ['não é JSON', 'Parabéns!'],
    ['não cita a pessoa', '{"grupo":"Parabéns, campeão do grupo!","privado":["Feliz aniversário!"]}'],
    ['sem privado', '{"grupo":"Parabéns, Lucas!","privado":[]}'],
  ])('volta ao texto pronto quando o modelo %s', (_, raw) => {
    expect(pickTexts(raw, lucas, '2026-10-08')).toEqual(fallbackTexts(lucas, '2026-10-08'));
  });

  it('texto pronto cita o primeiro nome e o privado se apresenta', () => {
    const t = fallbackTexts(lucas, '2026-10-08');
    expect(t.group).toContain('Lucas');
    expect(t.direct[0]).toContain('João');
  });

  it('a mensagem do grupo leva a menção pelo número; sem telefone vai sem menção', () => {
    expect(groupText(lucas, 'parabéns!')).toBe('@5588992241070 parabéns!');
    expect(groupText({ ...lucas, phone: null }, 'parabéns!')).toBe('parabéns!');
  });
});

describe('aniversário contado pelo administrador', () => {
  it.each([['14/01', { day: 14, month: 1 }], ['8/10', { day: 8, month: 10 }], [' 08-10 ', { day: 8, month: 10 }]])('lê %s', (v, esperado) => {
    expect(birthdayParts(v)).toEqual(esperado);
  });
  it.each(['32/01', '10/13', '14 de janeiro', '', null])('recusa %s', (v) => {
    expect(birthdayParts(v)).toBeNull();
  });
  it('o slot chega normalizado como DD/MM', () => {
    expect(parseSlots({ adm_action: 'aniversario', member_name: 'Lucas', birthday: '8/10' })).toMatchObject({ adm_action: 'aniversario', birthday: '08/10' });
    expect(parseSlots({ birthday: 'amanhã' }).birthday).toBeNull();
  });
});
