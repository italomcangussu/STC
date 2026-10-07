// A jornada do sócio no documento (viewed → read_started → read_completed → consent_checked).
//
// O servidor exige essa ORDEM e grava a hora de cada passo. Aqui os envios saem um de cada vez, na ordem
// em que foram pedidos (uma fila): `read_started` e `read_completed` pedidos juntos não podem se
// atropelar na rede. Cada passo só é enviado uma vez com sucesso; se falhar, o próximo pedido tenta de novo.

export type JourneyKind = 'viewed' | 'read_started' | 'read_completed' | 'consent_checked';

export type JourneySender = (kind: JourneyKind, meta?: Record<string, unknown>) => Promise<unknown>;

export type Journey = {
  /** Resolve quando o servidor registrou (ou já tinha registrado nesta sessão). Rejeita se falhar. */
  log(kind: JourneyKind, meta?: Record<string, unknown>): Promise<void>;
  recorded(kind: JourneyKind): boolean;
};

export function createJourney(send: JourneySender): Journey {
  const done = new Set<JourneyKind>();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    recorded: (kind) => done.has(kind),
    log(kind, meta) {
      const run = queue.then(async () => {
        if (done.has(kind)) return;
        await send(kind, meta);
        done.add(kind);
      });
      // A fila segue mesmo se este passo falhar; quem chamou recebe o erro pelo `run`.
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
