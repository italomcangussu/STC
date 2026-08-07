import { DEFAULT_SCORING, type ScoringRules } from './creation';

/** Mesma lista usada por ChampionshipAdmin.tsx. */
export const CHAMPIONSHIP_CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

/**
 * Dados coletados no passo Básico do Criador, antes de gravar.
 * O formato não vive aqui: cada classe tem o seu, escolhido no passo seguinte.
 */
export interface SetupValues {
    name: string;
    startDate: string;
    endDate: string;
    seriesId: string | null;
    classes: string[];
    scoring: ScoringRules;
}

export const emptySetup = (): SetupValues => ({
    name: '',
    startDate: '',
    endDate: '',
    seriesId: null,
    classes: [],
    scoring: { ...DEFAULT_SCORING },
});
