// Preferências de "app nativo": comportamentos do PWA que o usuário pode ligar ou desligar.
// Ficam no aparelho (localStorage) e são aplicadas já na abertura, antes do React montar.

export interface AppPreferences {
    /** Sem seleção de texto fora de campos, sem menu de toque longo, sem quique de rolagem. */
    nativeFeel: boolean;
    /** Desliga animações e transições, independente da configuração do sistema. */
    reduceMotion: boolean;
    /** Mantém a tela acesa enquanto o app está aberto (Screen Wake Lock). */
    keepAwake: boolean;
}

const STORAGE_KEY = 'stc_app_preferences_v1';

type Stored = Partial<AppPreferences>;

function lerArmazenado(): Stored {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Stored) : {};
    } catch {
        return {};
    }
}

function instaladoComoApp(): boolean {
    if (typeof window === 'undefined') return false;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** O comportamento nativo vem ligado quando o app está instalado; no navegador, desligado. */
export function loadPreferences(): AppPreferences {
    const salvo = lerArmazenado();
    return {
        nativeFeel: salvo.nativeFeel ?? instaladoComoApp(),
        reduceMotion: salvo.reduceMotion ?? false,
        keepAwake: salvo.keepAwake ?? false,
    };
}

export function savePreferences(prefs: AppPreferences): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Armazenamento indisponível: a preferência vale só até recarregar.
    }
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener: (t: 'release', cb: () => void) => void };

let sentinela: WakeLockSentinelLike | null = null;
let querAcordado = false;
let ouvindoVisibilidade = false;

async function adquirirWakeLock(): Promise<void> {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wakeLock || sentinela || document.visibilityState !== 'visible') return;
    try {
        sentinela = await wakeLock.request('screen');
        sentinela.addEventListener('release', () => { sentinela = null; });
    } catch {
        sentinela = null;
    }
}

function aoMudarVisibilidade(): void {
    // O sistema solta o wake lock quando a aba some; reabre ao voltar.
    if (querAcordado && document.visibilityState === 'visible') void adquirirWakeLock();
}

export function isWakeLockSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function aplicarKeepAwake(ligado: boolean): void {
    querAcordado = ligado;
    if (ligado) {
        if (!ouvindoVisibilidade) {
            document.addEventListener('visibilitychange', aoMudarVisibilidade);
            ouvindoVisibilidade = true;
        }
        void adquirirWakeLock();
    } else if (sentinela) {
        void sentinela.release().catch(() => {});
        sentinela = null;
    }
}

export function applyPreferences(prefs: AppPreferences): void {
    const root = document.documentElement;
    if (prefs.nativeFeel) root.dataset.nativeFeel = 'on';
    else delete root.dataset.nativeFeel;
    if (prefs.reduceMotion) root.dataset.reduceMotion = 'on';
    else delete root.dataset.reduceMotion;
    aplicarKeepAwake(prefs.keepAwake);
}

export function installAppPreferences(): void {
    applyPreferences(loadPreferences());
}
