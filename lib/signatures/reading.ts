// "Leia até o fim": quem decide que o sócio leu é este rastreio, que o app alimenta enquanto o PDF rola.
//
// A regra é propositalmente simples para o sócio entender: o documento conta como lido quando
// (1) TODAS as páginas apareceram na tela e (2) o fim da última página foi alcançado.
// Pular direto para o final não vale, porque as páginas do meio nunca ficam visíveis.
//
// Isto é um aviso de boa-fé do aparelho, e é assim que o dossiê o trata: o servidor grava a hora de
// cada passo (`read_started`, `read_completed`) e o aparelho informa só a contagem de páginas.

export type ReadingSnapshot = {
  pagesSeen: number;
  pagesTotal: number;
  endReached: boolean;
  complete: boolean;
  /** 0–100, para a barra de progresso. */
  percent: number;
};

export type ReadingTracker = {
  /** Devolve `true` se o estado mudou (a tela só se atualiza quando muda). */
  markSeen(page: number): boolean;
  markEnd(): boolean;
  snapshot(): ReadingSnapshot;
};

export function createReadingTracker(pagesTotal: number): ReadingTracker {
  const total = Math.max(1, Math.floor(pagesTotal) || 1);
  const seen = new Set<number>();
  let end = false;
  return {
    markSeen(page) {
      if (!Number.isInteger(page) || page < 1 || page > total || seen.has(page)) return false;
      seen.add(page);
      return true;
    },
    markEnd() {
      if (end) return false;
      end = true;
      return true;
    },
    snapshot() {
      const complete = end && seen.size >= total;
      const pageShare = seen.size / total;
      // O último passo (alcançar o fim) vale os últimos 2%: a barra só chega a 100 quando está liberado.
      const percent = complete ? 100 : Math.min(98, Math.round(pageShare * 98));
      return { pagesSeen: seen.size, pagesTotal: total, endReached: end, complete, percent };
    },
  };
}

export type PageVisibility = {
  isIntersecting: boolean;
  /** Altura da parte da página que está dentro da área de rolagem. */
  visibleHeight: number;
  pageHeight: number;
  viewportHeight: number;
};

/** Uma página conta como "vista" quando pelo menos 40% do que cabe dela na tela esteve visível. */
export function pageCountsAsSeen(v: PageVisibility): boolean {
  if (!v.isIntersecting || v.visibleHeight <= 0) return false;
  const reference = Math.min(v.pageHeight, v.viewportHeight);
  return reference > 0 && v.visibleHeight >= reference * 0.4;
}
