// @vitest-environment node
// Caso Henrique (07/11): plano "mensalidade do Tiago + patrocínio". O "P1" não existia (a cobrança de novembro não tinha sido
// gerada) e ficou preso: "Não achei essa pendência na lista" 7 vezes, inclusive para "patrocínio não foi lançado".
import { describe, expect, it } from 'vitest';
import { pendencyFor } from '../../supabase/functions/_shared/aiAgent/adminFinance';

const ref = (n: number, member_name: string, description: string) => ({ ref: `p${n}`, id: `C${n}`, member_id: `M${n}`, member_name, description,
  total_due_cents: 32000, collection_enabled: true });
const refs = [ref(1, 'Jorge Medeiros', 'Mensalidade 11/2026'), ref(2, 'Diego Memória', 'Mensalidade 11/2026'), ref(3, 'Diego Memória', 'Multa')];

describe('pendência da lista no financeiro do admin', () => {
  it('receita com p1 sobrando de outro passo não procura pendência', () => {
    expect(pendencyFor(refs, { fin_action: 'receita', pendency_ref: 'p9' } as never)).toEqual({});
  });
  it('número da lista vale', () => {
    expect(pendencyFor(refs, { fin_action: 'baixa', pendency_ref: 'p1' } as never)).toEqual({ ref: refs[0] });
  });
  it('sem número, o sócio com uma pendência basta', () => {
    expect(pendencyFor(refs, { fin_action: 'baixa', member_name: 'jorge' } as never)).toEqual({ ref: refs[0] });
  });
  it('sócio com várias: lista as dele', () => {
    const r = pendencyFor(refs, { fin_action: 'baixa', member_name: 'Diego Memoria' } as never) as { ask: string };
    expect(r.ask).toContain('p2 Mensalidade 11/2026');
    expect(r.ask).toContain('p3 Multa');
  });
  it('sócio sem pendência: diz isso e oferece lançar, não repete "Não achei"', () => {
    const r = pendencyFor(refs, { fin_action: 'baixa', member_name: 'Tiago Gomes', pendency_ref: 'p1x' } as never) as { ask: string };
    expect(r.ask).toContain('Não tem pendência em aberto de Tiago Gomes');
    expect(r.ask).toContain('lance a pendência');
  });
});
