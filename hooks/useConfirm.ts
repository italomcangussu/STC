import { createContext, useContext } from 'react';
import type { ConfirmDialogProps } from '../components/ui/ConfirmDialog';

/**
 * `confirm()` do navegador, trocado por um diálogo nosso — sem mudar a forma
 * de escrever a chamada.
 *
 * O nativo tem uma vantagem real que a maioria das substituições joga fora: ele
 * é **uma linha dentro do handler**. Um `<ConfirmDialog>` controlado por estado
 * cobra, em cada uso, um `useState`, um handler partido em duas metades e um
 * pedaço de JSX — e é por isso que, na prática, o `confirm()` nativo sobrevive
 * nos cantos do app. Aqui o custo por chamada volta a ser uma linha:
 *
 * ```tsx
 * const confirm = useConfirm();
 * if (!await confirm({ title: 'Remover inscrição?', confirmLabel: 'Remover' })) return;
 * ```
 *
 * O que se ganha em relação ao nativo: texto de consequências, confirmação
 * digitada, foco preso, `Escape`, e um visual que não denuncia o navegador.
 *
 * O provider vive em `components/ui/ConfirmProvider.tsx`.
 */
export type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'busy' | 'onConfirm' | 'onCancel'>;

export type ConfirmAsk = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmAsk | null>(null);

/**
 * Devolve a função de perguntar. Lança se não houver `<ConfirmProvider>` acima:
 * o modo silencioso — devolver `false` sempre — transformaria todo botão
 * protegido em botão morto, e ninguém notaria até alguém reclamar que "não
 * acontece nada ao clicar".
 */
export function useConfirm(): ConfirmAsk {
    const ask = useContext(ConfirmContext);
    if (!ask) throw new Error('useConfirm() exige um <ConfirmProvider> acima na árvore.');
    return ask;
}
