let installed = false;
let cleanup: (() => void) | null = null;

function isIosStandalonePwa() {
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua)
        || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const nav = navigator as Navigator & { standalone?: boolean };
    const isStandalone = nav.standalone === true
        || window.matchMedia?.('(display-mode: standalone)').matches === true;

    return isIos && isStandalone;
}

let maxIosHeight = 0;
let lastWidth = 0;

function getViewportHeight() {
    const measuredHeight = window.visualViewport?.height ?? window.innerHeight;

    if (!isIosStandalonePwa()) return measuredHeight;

    const currentWidth = window.innerWidth;
    if (currentWidth !== lastWidth) {
        maxIosHeight = 0;
        lastWidth = currentWidth;
    }

    if (window.innerHeight > maxIosHeight) {
        maxIosHeight = window.innerHeight;
    }

    return maxIosHeight || window.innerHeight;
}

function publish() {
    const height = Math.round(getViewportHeight());
    document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
}

export function installViewportHeightSync(): () => void {
    if (installed) return () => undefined;
    installed = true;

    publish();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', publish);
    window.addEventListener('orientationchange', publish);
    window.addEventListener('pageshow', publish);
    window.addEventListener('resize', publish);

    cleanup = () => {
        vv?.removeEventListener('resize', publish);
        window.removeEventListener('orientationchange', publish);
        window.removeEventListener('pageshow', publish);
        window.removeEventListener('resize', publish);
        document.documentElement.style.removeProperty('--app-viewport-height');
        installed = false;
        cleanup = null;
    };

    return cleanup;
}
