import { afterEach, describe, expect, it, vi } from 'vitest';
import { installViewportHeightSync } from './viewportHeightSync';

describe('installViewportHeightSync', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.style.removeProperty('--app-viewport-height');
    });

    it('uses full iOS standalone screen height when visualViewport is shorter', () => {
        Object.defineProperty(window.navigator, 'userAgent', {
            configurable: true,
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        });
        Object.defineProperty(window.navigator, 'standalone', {
            configurable: true,
            value: true,
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 895 });
        Object.defineProperty(window, 'screen', {
            configurable: true,
            value: { height: 956 },
        });
        vi.stubGlobal('visualViewport', {
            height: 895,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });

        const cleanup = installViewportHeightSync();

        expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('956px');

        cleanup();
    });
});
