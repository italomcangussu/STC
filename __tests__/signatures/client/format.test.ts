import { describe, expect, it } from 'vitest';
import { dueInfo, formatCountdown, formatDate, formatDateTime } from '../../../lib/signatures/format';
import { cpfDigits, cpfValid, formatCpf, maskCpf } from '../../../lib/signatures/cpf';
import { matchesSha256, sha256Hex } from '../../../lib/signatures/hash';

describe('datas no horário do clube (Fortaleza, UTC−3)', () => {
  it('converte do UTC para o horário do clube', () => {
    expect(formatDate('2026-10-07T02:30:00Z')).toBe('06/10/2026');
    expect(formatDateTime('2026-10-07T02:30:00Z')).toBe('06/10/2026 às 23:30');
    expect(formatDateTime('2026-10-07T15:05:00Z')).toBe('07/10/2026 às 12:05');
  });

  it('data vazia ou inválida vira texto vazio, não "Invalid Date"', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDateTime('lixo')).toBe('');
  });
});

describe('prazo do documento', () => {
  const now = new Date('2026-10-07T15:00:00Z'); // 12:00 em Fortaleza

  it('sem prazo → null', () => {
    expect(dueInfo(null, now)).toBeNull();
  });

  it('longe: só informa a data', () => {
    expect(dueInfo('2026-10-20T12:00:00Z', now)).toMatchObject({ label: 'Prazo: 20/10/2026', tone: 'neutral', days: 13 });
  });

  it('até 3 dias: avisa quantos dias faltam', () => {
    expect(dueInfo('2026-10-10T20:00:00Z', now)).toMatchObject({ label: 'Vence em 3 dias (10/10/2026)', tone: 'warn', days: 3 });
    expect(dueInfo('2026-10-08T20:00:00Z', now)).toMatchObject({ label: 'Vence em 1 dia (08/10/2026)', tone: 'warn' });
  });

  it('no dia: "Vence hoje" (mesmo à noite)', () => {
    expect(dueInfo('2026-10-08T01:00:00Z', now)).toMatchObject({ label: 'Vence hoje', tone: 'warn', days: 0 });
  });

  it('vencido: tom de alerta e quantos dias', () => {
    expect(dueInfo('2026-10-06T12:00:00Z', now)).toMatchObject({ label: 'Prazo venceu há 1 dia (06/10/2026)', tone: 'bad', days: -1 });
    expect(dueInfo('2026-10-01T12:00:00Z', now)).toMatchObject({ label: 'Prazo venceu há 6 dias (01/10/2026)', tone: 'bad' });
  });

  it('conta dias do calendário do clube, não do UTC (23:30 local vs 00:30 local do dia seguinte)', () => {
    const lateNight = new Date('2026-10-08T02:30:00Z'); // 07/10 23:30 em Fortaleza (já é 08/10 em UTC)
    expect(dueInfo('2026-10-08T03:30:00Z', lateNight)).toMatchObject({ days: 1, label: 'Vence em 1 dia (08/10/2026)' });
  });
});

describe('contagem do reenvio', () => {
  it('mm:ss, arredondando para cima e nunca negativa', () => {
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(59.2)).toBe('1:00');
    expect(formatCountdown(0.2)).toBe('0:01');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('CPF', () => {
  it('valida os dígitos verificadores, como o banco', () => {
    expect(cpfValid('529.982.247-25')).toBe(true);
    expect(cpfValid('52998224725')).toBe(true);
    expect(cpfValid('529.982.247-24')).toBe(false);
    expect(cpfValid('111.111.111-11')).toBe(false);
    expect(cpfValid('123')).toBe(false);
    expect(cpfValid('')).toBe(false);
  });

  it('máscara progressiva enquanto digita; ignora letras e o que passar de 11', () => {
    expect(cpfDigits('abc529.982x247-25999')).toBe('52998224725');
    expect(formatCpf('5')).toBe('5');
    expect(formatCpf('52998')).toBe('529.98');
    expect(formatCpf('529982247')).toBe('529.982.247');
    expect(formatCpf('5299822472')).toBe('529.982.247-2');
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('5299822472599')).toBe('529.982.247-25');
  });

  it('o CPF salvo aparece mascarado', () => {
    expect(maskCpf('52998224725')).toBe('•••.982.247-••');
    expect(maskCpf('123')).toBe('');
  });
});

describe('hash do PDF', () => {
  it('SHA-256 conhecido ("abc")', async () => {
    const abc = new TextEncoder().encode('abc');
    expect(await sha256Hex(abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(abc.buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('confere contra o hash publicado (e rejeita um arquivo trocado)', async () => {
    const bytes = new TextEncoder().encode('contrato');
    const hash = await sha256Hex(bytes);
    expect(await matchesSha256(bytes, hash)).toBe(true);
    expect(await matchesSha256(bytes, hash.toUpperCase())).toBe(true);
    expect(await matchesSha256(new TextEncoder().encode('contrato2'), hash)).toBe(false);
  });
});
