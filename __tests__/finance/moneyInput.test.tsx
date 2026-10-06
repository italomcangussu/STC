import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// `ui.tsx` importa o financeApi (que exige as variáveis do Supabase); aqui só o campo importa.
vi.mock('../../lib/finance/financeApi', () => ({ newRequestId: () => 'k' }));
import { MoneyInput } from '../../components/finance/ui';

const Harness: React.FC<{ initial?: number | null }> = ({ initial = null }) => {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput value={v} onChange={setV} aria-label="Valor" />
      <output aria-label="cents">{v === null ? 'null' : v}</output>
      <button onClick={() => setV(7050)}>sugerir</button>
    </>
  );
};

const box = () => screen.getByLabelText('Valor') as HTMLInputElement;
const type = (t: string) => fireEvent.change(box(), { target: { value: t } });

describe('MoneyInput — o texto digitado não é reescrito enquanto se digita', () => {
  it('digitar "2" mantém "2" (não vira "2,00" nem leva o cursor ao fim)', () => {
    render(<Harness />);
    type('2');
    expect(box().value).toBe('2');
    expect(screen.getByLabelText('cents')).toHaveTextContent('200');
  });

  it('segue digitando: "25", "25,", "25,5"', () => {
    render(<Harness />);
    for (const t of ['2', '25', '25,', '25,5']) { type(t); expect(box().value).toBe(t); }
    expect(screen.getByLabelText('cents')).toHaveTextContent('2550');
  });

  it('ao sair do campo, formata com duas casas', () => {
    render(<Harness />);
    type('25');
    fireEvent.blur(box());
    expect(box().value).toBe('25,00');
  });

  it('apagar tudo deixa o campo vazio e o valor nulo', () => {
    render(<Harness initial={1500} />);
    type('');
    expect(box().value).toBe('');
    expect(screen.getByLabelText('cents')).toHaveTextContent('null');
  });

  it('valor trocado por fora (sugestão) aparece formatado', () => {
    render(<Harness />);
    type('2');
    fireEvent.click(screen.getByText('sugerir'));
    expect(box().value).toBe('70,50');
  });

  it('valor inicial vem formatado e pode ser editado sem salto', () => {
    render(<Harness initial={15000} />);
    expect(box().value).toBe('150,00');
    type('150,0');
    expect(box().value).toBe('150,0');
  });
});
