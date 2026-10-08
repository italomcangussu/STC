// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ADMIN_READ_DOMAINS } from '../../supabase/functions/_shared/aiAgent/adminReads';
import { ADMIN_READS, CAPABILITIES, capabilityByFinAction, n3Reply } from '../../supabase/functions/_shared/aiAgent/capabilities';

describe('registro de capacidades do assessor', () => {
  it('ids únicos; toda capacidade tem leitura ou escrita; N3 nunca tem escrita', () => {
    expect(new Set(CAPABILITIES.map((c) => c.id)).size).toBe(CAPABILITIES.length);
    for (const c of CAPABILITIES) {
      expect(Boolean(c.read) || Boolean(c.write) || Boolean(c.onDemand)).toBe(true);
      if (c.risk === 'N3') expect(c.write).toBeUndefined();
      if (c.read || c.onDemand) expect(c.risk).toBe('N0');
    }
    expect(ADMIN_READS.map((c) => c.read!.ctxKey)).toContain('club_balances');
  });

  it('todo domínio de consulta está no registro e vice-versa', () => {
    expect([...ADMIN_READ_DOMAINS].sort()).toEqual(CAPABILITIES.filter((c) => c.onDemand).map((c) => c.onDemand!).sort());
  });

  it('as 5 ações financeiras atuais estão registradas, baixa e lançamento como N2', () => {
    expect(['lancar', 'cobrar', 'pausar', 'retomar', 'baixa'].every((a) => capabilityByFinAction(a))).toBe(true);
    expect(capabilityByFinAction('baixa')!.risk).toBe('N2');
    expect(capabilityByFinAction('lancar')!.risk).toBe('N2');
    expect(capabilityByFinAction('apagar')).toBeUndefined();
  });

  it('N3 reconhece os pedidos proibidos e deixa passar os comuns', () => {
    for (const t of ['apaga a pendência do Beto', 'zera o ranking', 'reseta o ranking agora', 'troca o papel do Carlos para admin',
      'encerra o plano da Ana', 'exclui o sócio João', 'altera a chave pix do clube']) expect(n3Reply(t), t).toMatch(/painel administrativo/);
    for (const t of ['qual o saldo do clube?', 'lança 50 pro Beto', 'o Beto pagou 20 no pix', 'cancela a reserva das 19h', 'quem está devendo?', 'pausa a cobrança do p1'])
      expect(n3Reply(t), t).toBeNull();
  });
});
