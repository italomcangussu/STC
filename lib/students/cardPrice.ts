// Preço do Card Mensal por faixa. O valor do mensalista vem do financeiro (fin_settings.card_mensal_price_cents);
// o Mensalista Kids paga a metade. O banco calcula o mesmo em fin_private.card_price_cents.
import { supabase } from '../supabase';

export type CardTier = 'regular' | 'kids';
export interface CardPrices { regularCents: number; kidsCents: number }

export const DEFAULT_CARD_PRICES: CardPrices = { regularCents: 20000, kidsCents: 10000 };
export const CARD_TIER_LABEL: Record<CardTier, string> = { regular: 'Mensalista', kids: 'Mensalista Kids' };

export const cardTierOf = (value: unknown): CardTier => (value === 'kids' ? 'kids' : 'regular');
export const cardPriceReais = (tier: CardTier | null | undefined, prices: CardPrices) =>
  (tier === 'kids' ? prices.kidsCents : prices.regularCents) / 100;

export async function loadCardPrices(): Promise<CardPrices> {
  const { data, error } = await supabase.rpc('student_card_prices');
  const p = (data ?? {}) as { regular_cents?: number; kids_cents?: number };
  if (error || !p.regular_cents || !p.kids_cents) return DEFAULT_CARD_PRICES;
  return { regularCents: Number(p.regular_cents), kidsCents: Number(p.kids_cents) };
}
