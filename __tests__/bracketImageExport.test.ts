import { describe, expect, it, vi } from 'vitest';
import {
    buildBracketImageName,
    canShareFiles,
    saveFileToDisk,
    shareOrDownload,
    waitForPaint,
} from '../lib/bracketImageExport';

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

describe('buildBracketImageName', () => {
    it('junta campeonato e classe num nome de arquivo previsível', () => {
        expect(buildBracketImageName('Open da Galera 2026', '4ª Classe'))
            .toBe('open-da-galera-2026-4a-classe.png');
    });

    /** `ª` e acentos viram lixo em muitos apps de mensagem e em alguns sistemas de arquivo. */
    it('tira acentos e ordinais', () => {
        expect(buildBracketImageName('Resenha Open', '5ª Classe')).toBe('resenha-open-5a-classe.png');
        expect(buildBracketImageName('Circuito de Inverno · 3º', 'Única'))
            .toBe('circuito-de-inverno-3o-unica.png');
    });

    it('colapsa pontuação e espaços repetidos num traço só', () => {
        expect(buildBracketImageName('  Open   da   Galera!!  ', 'A / B'))
            .toBe('open-da-galera-a-b.png');
    });

    it('aguenta nome vazio sem gerar arquivo começando com traço', () => {
        expect(buildBracketImageName('', '4ª Classe')).toBe('4a-classe.png');
        expect(buildBracketImageName('Open', '')).toBe('open.png');
    });
});

describe('canShareFiles', () => {
    it('só é verdade quando o navegador sabe compartilhar arquivos', () => {
        const nav = { share: vi.fn(), canShare: vi.fn(() => true) } as any;
        expect(canShareFiles([png('a.png')], nav)).toBe(true);
    });

    it('é falso quando o navegador tem share mas recusa arquivos', () => {
        const nav = { share: vi.fn(), canShare: vi.fn(() => false) } as any;
        expect(canShareFiles([png('a.png')], nav)).toBe(false);
    });

    /** Desktop sem Web Share: o caminho tem que ser download, não erro. */
    it('é falso quando não existe Web Share', () => {
        expect(canShareFiles([png('a.png')], {} as any)).toBe(false);
    });

    it('é falso sem arquivo nenhum', () => {
        const nav = { share: vi.fn(), canShare: vi.fn(() => true) } as any;
        expect(canShareFiles([], nav)).toBe(false);
    });
});

describe('shareOrDownload', () => {
    it('abre o diálogo do sistema quando dá', async () => {
        const share = vi.fn(async () => undefined);
        const nav = { share, canShare: () => true } as any;
        const saveFile = vi.fn();
        const files = [png('a.png'), png('b.png')];

        const resultado = await shareOrDownload(files, { title: 'Chave' }, { nav, saveFile });

        expect(resultado).toBe('shared');
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ files, title: 'Chave' }));
        expect(saveFile).not.toHaveBeenCalled();
    });

    /** Fechar o diálogo é escolha do usuário, não falha — não pode virar download surpresa. */
    it('não baixa nada quando o usuário fecha o diálogo', async () => {
        const abort = Object.assign(new Error('cancelado'), { name: 'AbortError' });
        const nav = { share: vi.fn(async () => { throw abort; }), canShare: () => true } as any;
        const saveFile = vi.fn();

        const resultado = await shareOrDownload([png('a.png')], { title: 'Chave' }, { nav, saveFile });

        expect(resultado).toBe('cancelled');
        expect(saveFile).not.toHaveBeenCalled();
    });

    it('cai para download quando o compartilhamento falha de verdade', async () => {
        const nav = { share: vi.fn(async () => { throw new Error('sem permissão'); }), canShare: () => true } as any;
        const saveFile = vi.fn();

        const resultado = await shareOrDownload([png('a.png')], { title: 'Chave' }, { nav, saveFile });

        expect(resultado).toBe('downloaded');
        expect(saveFile).toHaveBeenCalledTimes(1);
    });

    it('baixa cada classe quando não há Web Share', async () => {
        const saveFile = vi.fn();
        const files = [png('a.png'), png('b.png')];

        const resultado = await shareOrDownload(files, { title: 'Chave' }, { nav: {} as any, saveFile });

        expect(resultado).toBe('downloaded');
        expect(saveFile).toHaveBeenCalledTimes(2);
    });

    it('recusa exportação sem imagem em vez de abrir diálogo vazio', async () => {
        await expect(shareOrDownload([], { title: 'Chave' }, { nav: {} as any, saveFile: vi.fn() }))
            .rejects.toThrow(/nenhuma imagem/i);
    });
});

describe('waitForPaint', () => {
    /**
     * `requestAnimationFrame` não dispara em aba oculta. Preso só nele, o
     * export ficava em "Gerando…" para sempre se o usuário trocasse de app no
     * meio da captura — foi exatamente o que aconteceu no navegador.
     */
    it('resolve mesmo quando o navegador nunca chama o requestAnimationFrame', async () => {
        const original = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (() => 0) as any;

        try {
            await expect(waitForPaint(20)).resolves.toBeUndefined();
        } finally {
            globalThis.requestAnimationFrame = original;
        }
    });

    it('resolve mesmo com o carregamento de fontes pendurado', async () => {
        const original = Object.getOwnPropertyDescriptor(document, 'fonts');
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: new Promise(() => { /* nunca resolve */ }) },
        });

        try {
            await expect(waitForPaint(20)).resolves.toBeUndefined();
        } finally {
            if (original) Object.defineProperty(document, 'fonts', original);
        }
    });
});

describe('saveFileToDisk', () => {
    /**
     * O bug que fazia só a primeira imagem chegar: revogar a URL no mesmo tick
     * do clique cancela o download antes de o navegador ler o blob. Com dois
     * arquivos seguidos, o segundo era sempre o que se perdia.
     */
    it('não revoga a URL no mesmo tick do clique', () => {
        const criadas: string[] = [];
        const revogadas: string[] = [];
        const criar = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
            const url = `blob:teste-${criadas.length}`;
            criadas.push(url);
            return url;
        });
        const revogar = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { revogadas.push(url); });
        const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { });

        try {
            saveFileToDisk(png('chave.png'));

            expect(clique).toHaveBeenCalledTimes(1);
            expect(criadas).toHaveLength(1);
            expect(revogadas).toEqual([]);
        } finally {
            criar.mockRestore();
            revogar.mockRestore();
            clique.mockRestore();
        }
    });
});

describe('shareOrDownload — várias classes por download', () => {
    it('entrega todos os arquivos, um de cada vez', async () => {
        const ordem: string[] = [];
        const saveFile = vi.fn((f: File) => { ordem.push(f.name); });
        const files = [png('4a.png'), png('5a.png'), png('fem.png')];

        const resultado = await shareOrDownload(
            files, { title: 'Chave' }, { nav: {} as any, saveFile, spacingMs: 0 }
        );

        expect(resultado).toBe('downloaded');
        expect(ordem).toEqual(['4a.png', '5a.png', 'fem.png']);
    });

    /** Um clique por tick: em rajada o navegador descarta os seguintes. */
    it('não dispara os downloads todos no mesmo tick', async () => {
        const ticks: number[] = [];
        let agora = 0;
        const saveFile = vi.fn(() => { ticks.push(agora); });
        const files = [png('a.png'), png('b.png')];
        const relogio = setInterval(() => { agora += 1; }, 1);

        try {
            await shareOrDownload(files, { title: 'Chave' }, { nav: {} as any, saveFile, spacingMs: 30 });
        } finally {
            clearInterval(relogio);
        }

        expect(saveFile).toHaveBeenCalledTimes(2);
        expect(ticks[1]).toBeGreaterThan(ticks[0]);
    });
});
