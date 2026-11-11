// Tema do app: claro, escuro ou o do aparelho. Fica no aparelho (localStorage)
// e é aplicado antes do React montar, para a tela não piscar no tema errado.
// O padrão é escuro (o chão de saibro à noite); quem já escolheu Claro ou
// Do aparelho em Configurações continua com a própria escolha.

export type Tema = 'claro' | 'escuro' | 'auto';

const CHAVE = 'stc_tema_v1';
const COR_BARRA = { claro: '#fafaf9', escuro: '#140c07' } as const;

let padrao: Tema = 'escuro';
let ouvindoSistema = false;

export function lerTema(): Tema {
    try {
        const v = localStorage.getItem(CHAVE);
        if (v === 'claro' || v === 'escuro' || v === 'auto') return v;
    } catch {
        // Armazenamento indisponível: vale o padrão.
    }
    return padrao;
}

function sistemaEscuro(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** O que a tela mostra de fato: `auto` vira claro ou escuro pelo aparelho. */
export function temaEfetivo(tema: Tema = lerTema()): 'claro' | 'escuro' {
    if (tema === 'auto') return sistemaEscuro() ? 'escuro' : 'claro';
    return tema;
}

export function aplicarTema(tema: Tema = lerTema()): void {
    const efetivo = temaEfetivo(tema);
    const root = document.documentElement;
    if (efetivo === 'escuro') root.dataset.tema = 'escuro';
    else delete root.dataset.tema;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA[efetivo]);
}

export function salvarTema(tema: Tema): void {
    try {
        localStorage.setItem(CHAVE, tema);
    } catch {
        // Vale só até recarregar.
    }
    aplicarTema(tema);
}

/** Aplica o tema salvo e acompanha o aparelho quando a escolha é `auto`. */
export function instalarTema(opcoes: { padrao?: Tema } = {}): void {
    if (opcoes.padrao) padrao = opcoes.padrao;
    aplicarTema();
    if (ouvindoSistema || typeof window === 'undefined' || !window.matchMedia) return;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if (lerTema() === 'auto') aplicarTema('auto');
    });
    ouvindoSistema = true;
}
