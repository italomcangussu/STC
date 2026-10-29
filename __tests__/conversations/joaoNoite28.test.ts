// @vitest-environment node
// Noite de 28/10 (AUGE OPEN), três falhas do João:
//  · Emanuel: a leitura do comprovante falhou e o João ficou mudo, com a inscrição esperando o Pix;
//  · Hermeson: quem foi posto no painel sem pagar (Mario, Davi) saía como "confirmado/pago" nas listas;
//  · Joaquim e Helder: a resposta do modelo veio ilegível uma vez e a conversa foi direto para a equipe.
import { describe, expect, it } from 'vitest';
import { askParsed, parseAnswer } from '../../supabase/functions/_shared/aiAgent/answerParse';
import { championshipText } from '../../supabase/functions/_shared/aiAgent/championshipPrompt';
import { beforeModel } from '../../supabase/functions/_shared/aiAgent/turnShortcuts';

const champ = (extra: Record<string, unknown> = {}) => ({
  id: 'C1', name: 'AUGE OPEN', start_date: '2026-11-27', end_date: '2026-11-29', status: 'draft', info: '', price_cents: 13000,
  shirt_sizes: ['P', 'M', 'G', 'GG'], max_per_class: 16, deadline: '2026-11-24', registration_open: true, shirt_image: null,
  classes: [{ class: '4ª Classe', confirmed: 3, pre: 1, waitlist: 0, spots_left: 13, drawn: false }], mine: [], admin: null, ...extra,
});
const pack = (c: Record<string, unknown>) => ({ requester_phone: '88999991001', is_admin: true, pix_key: '52.393.541/0001-20', payee: 'Sobral Tênis Clube', championships: [c] });

describe('lista do administrador: painel não é pagamento', () => {
  const t = championshipText({ championship: pack(champ({ admin: {
    signups: [{ full_name: 'Daniel Rodrigues', class: '4ª Classe', shirt_size: 'M', phone: '88999516693', status: 'pre' }],
    registered: [
      { class: '4ª Classe', name: 'Bruno Farias', pay: 'paid' },
      { class: '4ª Classe', name: 'Thieslley Soares', pay: 'exempt' },
      { class: '4ª Classe', name: 'Mario Rego', pay: 'panel' },
    ] } })) });
  it('pago, isento e "só no painel" ficam em grupos separados', () => {
    expect(t).toMatch(/PAGAMENTO CONFERIDO[^\n]*\n- 4ª Classe: Bruno Farias/);
    expect(t).toMatch(/SEM PIX[^\n]*\n- 4ª Classe: Thieslley Soares/);
    expect(t).toMatch(/SÓ PELO PAINEL[^\n]*\n- 4ª Classe: Mario Rego/);
  });
  it('quem está só no painel não aparece entre os pagos', () => {
    const pagos = t.split('PAGAMENTO CONFERIDO')[1].split('\n\n')[0].split('SEM PIX')[0];
    expect(pagos).not.toContain('Mario Rego');
  });
  it('o resumo por classe não chama vaga ocupada de "confirmado"', () => {
    expect(t).toContain('4ª Classe: 3 vagas ocupadas no painel');
  });
});

describe('resposta ilegível do modelo', () => {
  const boa = JSON.stringify({ messages: ['Bora! Me manda seu nome completo.'], intent: 'campeonato' });
  it('tenta de novo uma vez antes de transferir', async () => {
    const saidas = ['{"messages": ["Bora', boa];
    const a = await askParsed(async () => saidas.shift()!);
    expect(a.transfer).toBe(false);
    expect(a.messages[0]).toContain('Bora');
  });
  it('duas vezes ilegível: aí sim transfere', async () => {
    let n = 0;
    const a = await askParsed(async () => { n += 1; return ''; });
    expect(n).toBe(2);
    expect(a.transfer).toBe(true);
  });
  it('resposta boa de primeira: uma chamada só', async () => {
    let n = 0;
    await askParsed(async () => { n += 1; return boa; });
    expect(n).toBe(1);
    expect(parseAnswer(boa).transfer).toBe(false);
  });
});

describe('foto que não virou comprovante, com inscrição esperando o Pix', () => {
  const turno = (mine: unknown[]) => {
    const falas: string[] = [];
    const db = async (name: string) => ({ data: name === 'conv_svc_receipt_stage' ? null : null, error: null });
    const t = {
      deps: { db, chat: async () => ({ output: '{}' }), uaz: null, sleep: async () => undefined, mediaOnly: true }, isGroup: false, soMidia: true, buffered: '',
      settings: { model: 'm', handoff_keywords: [] }, conversation: 'CONV', session: 'S', sessionMemory: {}, socioNoPrivado: false,
      ultima: { id: 'M1', kind: 'image' }, pendentes: [{ id: 'M1', kind: 'image' }],
      ctx: { is_group: false, requester: { profile: null }, transcript: [], championship: pack(champ({ mine })) },
      entregar: async (b: { text: string }[]) => { falas.push(...b.map((x) => x.text)); return b.length; },
      save: async () => undefined,
      say: async (m: string[], action: string) => { falas.push(...m); return { status: 'replied', action }; },
    } as never;
    return { t, falas };
  };
  it('responde que recebeu e que a equipe vai conferir, em vez de ficar mudo', async () => {
    const { t, falas } = turno([{ full_name: 'Emanuel Lourenço', class: '5ª Classe', shirt_size: 'GG', status: 'pre', phone: '85999251325' }]);
    const r = await beforeModel(t) as { status: string; action?: string };
    expect(r.status).toBe('replied');
    expect(falas.join(' ')).toMatch(/Recebi seu comprovante/);
  });
  it('sem inscrição esperando o Pix, a foto solta segue em silêncio (só o financeiro)', async () => {
    const { t, falas } = turno([]);
    const r = await beforeModel(t) as { status: string; reason?: string };
    expect(r.reason).toBe('media_only');
    expect(falas).toEqual([]);
  });
});
