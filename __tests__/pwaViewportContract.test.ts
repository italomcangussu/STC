import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const indexCss = readFileSync(resolve(root, 'index.css'), 'utf8');
const indexTsx = readFileSync(resolve(root, 'index.tsx'), 'utf8');
const layoutTsx = readFileSync(resolve(root, 'components/Layout.tsx'), 'utf8');

describe('PWA viewport shell contract', () => {
    it('installs the viewport height synchronizer before rendering React', () => {
        expect(indexTsx).toContain("import { installViewportHeightSync } from './lib/viewportHeightSync';");
        expect(indexTsx.indexOf('installViewportHeightSync();')).toBeLessThan(indexTsx.indexOf('ReactDOM.createRoot'));
    });

    it('uses the synced viewport height on html, body, and root', () => {
        expect(indexCss).toContain('height: var(--app-viewport-height, 100%);');
        expect(indexCss).toContain('min-height: var(--app-viewport-height, 100%);');
    });

    it('anchors mobile bottom navigation to the app shell with rounded-corner safe padding', () => {
        expect(layoutTsx).toContain('relative h-full flex flex-col');
        expect(layoutTsx).toContain('absolute bottom-0 left-0 right-0');
        expect(layoutTsx).toContain('pb-[max(1rem,env(safe-area-inset-bottom,0px))]');
        expect(layoutTsx).toContain('pb-[calc(76px+max(1rem,env(safe-area-inset-bottom,0px)))]');
        expect(layoutTsx).not.toContain('h-dvh flex flex-col');
        expect(layoutTsx).not.toContain('pb-[calc(35px+env(safe-area-inset-bottom,20px))]');
    });
});
