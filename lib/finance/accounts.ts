import type { FinAccount } from './types';

/**
 * Conta que já vem escolhida ao registrar uma entrada: a padrão de recebimentos, desde que esteja ativa;
 * senão a primeira ativa. Conta desativada nunca é pré-selecionada (a lista de contas não a oferece).
 */
export function defaultReceiptsAccountId(accounts: FinAccount[]): string {
  const active = accounts.filter((a) => a.active);
  return (active.find((a) => a.is_default_receipts) ?? active[0])?.id ?? '';
}
