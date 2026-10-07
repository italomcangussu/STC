import { describe, expect, it, vi } from 'vitest';
import { createJourney, type JourneyKind } from '../../../lib/signatures/journey';

const deferred = () => {
  let resolve!: () => void; let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('trilha da leitura enviada ao servidor', () => {
  it('envia na ORDEM pedida, um de cada vez (o servidor exige a ordem)', async () => {
    const gates = new Map<JourneyKind, ReturnType<typeof deferred>>([['read_started', deferred()], ['read_completed', deferred()]]);
    const started: string[] = [];
    const j = createJourney(async (kind) => { started.push(kind); await gates.get(kind)?.promise; });

    const a = j.log('read_started');
    const b = j.log('read_completed', { pages_seen: 3, pages_total: 3 });
    await Promise.resolve();
    expect(started).toEqual(['read_started']);          // o segundo espera o primeiro terminar

    gates.get('read_started')!.resolve();
    await a;
    await vi.waitFor(() => expect(started).toEqual(['read_started', 'read_completed']));
    gates.get('read_completed')!.resolve();
    await b;
    expect(j.recorded('read_completed')).toBe(true);
  });

  it('cada passo é enviado uma vez só quando já foi registrado', async () => {
    const send = vi.fn(async (_kind: string) => undefined);
    const j = createJourney(send);
    await j.log('viewed');
    await j.log('viewed');
    await Promise.all([j.log('consent_checked'), j.log('consent_checked')]);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['viewed', 'consent_checked']);
  });

  it('manda os metadados do passo', async () => {
    const send = vi.fn(async () => undefined);
    await createJourney(send).log('read_completed', { pages_seen: 2, pages_total: 2 });
    expect(send).toHaveBeenCalledWith('read_completed', { pages_seen: 2, pages_total: 2 });
  });

  it('falha: quem chamou recebe o erro, o passo NÃO conta como registrado e a fila segue', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValue(undefined);
    const j = createJourney(send);

    await expect(j.log('read_started')).rejects.toThrow('rede');
    expect(j.recorded('read_started')).toBe(false);

    await expect(j.log('read_started')).resolves.toBeUndefined();   // tenta de novo
    expect(j.recorded('read_started')).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('um passo que falha não trava os seguintes da fila', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValue(undefined);
    const j = createJourney(send);
    const first = j.log('viewed');
    const second = j.log('read_started');
    await expect(first).rejects.toThrow('rede');
    await expect(second).resolves.toBeUndefined();
  });
});
