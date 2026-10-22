import { useEffect, useState } from 'react';
import { type CardPrices, DEFAULT_CARD_PRICES, loadCardPrices } from '../lib/students/cardPrice';

/** Preços do Card Mensal (mensalista e Kids); enquanto carrega, vale o padrão do clube. */
export function useCardPrices(): CardPrices {
  const [prices, setPrices] = useState<CardPrices>(DEFAULT_CARD_PRICES);
  useEffect(() => {
    let alive = true;
    loadCardPrices().then((p) => { if (alive) setPrices(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return prices;
}
