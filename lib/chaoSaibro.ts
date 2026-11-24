// Chão de saibro: a quadra à noite, sob o refletor, desenhada num <canvas>
// atrás do conteúdo do tema escuro. É só decoração: nada aqui carrega dado,
// e todo texto fica em superfície opaca por cima.
//
// O que se mexe: grãos em três profundidades levados por um vento lento,
// rajadas (ao trocar de dia e de vez em quando), a marca da bola no toque,
// e o rastelo que alisa a quadra e apaga as marcas.

export const EVENTO_RAJADA = 'stc:rajada';

// Barro à noite, tirado da foto de referência. O pó (grãos e nuvens) é o mesmo
// saibro solto: um tom só um pouco mais fechado que a quadra, nunca mais claro.
const CHAO = '#9a3a14';
const TEXTURA = ['#b04a1c', '#c25c1e', '#86300e', '#a3401a', '#7a2a0c'];
const GRAOS = ['#8c3311', '#7f2c0e', '#94381a', '#7a2a0f', '#863012'];
const PO = '#8a3112';
// Topo aceso de um torrão: no máximo o tom da quadra.
const TOPO_DO_TORRAO = '#9a3a14';
// Linhas da quadra: fita branca gasta, com pó de saibro por cima e trincas.
const LINHA = '#efe5d8';
const LARGURA_LINHA = 6;
const PO_NA_LINHA = ['#c4693e', '#a9481f', '#d99a74', '#b5552a'];
const GIZ = '#f2c4a2';
const VENTO = 0.22;
const SOBRA = 400; // altura a mais da textura, para a paralaxe da rolagem
const RASTELO_CICLO = 16000;
const RASTELO_DURACAO = 3200;
const QUADRO_MS = 30; // ~30 quadros por segundo: o pó é lento, a bateria agradece

export function contarGraos(largura: number, altura: number): number {
    return Math.max(500, Math.min(2200, Math.round((largura * altura) / 260)));
}

/** 0 → 1 em 900 ms, com uma oscilação de lâmpada acendendo; depois respira ±3%. */
export function intensidadeDaLuz(ms: number): number {
    const u = Math.min(1, Math.max(0, ms / 900));
    const rampa = u * u * (3 - 2 * u);
    if (ms < 1150) return rampa * (0.72 + 0.28 * Math.sin(ms * 0.085));
    return 0.97 + 0.03 * Math.sin(ms * 0.0011);
}

/** Posição x da frente da rajada: entra 90 px antes da tela e sai 90 px depois. */
export function frenteDaRajada(u: number, dir: 1 | -1, largura: number): number {
    return dir > 0 ? -90 + (largura + 180) * u : largura + 90 - (largura + 180) * u;
}

/** Pede uma rajada ao chão (por exemplo, ao trocar de dia). Sem chão montado, não faz nada. */
export function soprarChao(dir: 1 | -1): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(EVENTO_RAJADA, { detail: { dir } }));
}

interface Grao { x: number; y: number; vx: number; vy: number; s: number; z: number; c: string; a: number; brilha: boolean; fase: number }
interface Po { x: number; y: number; vx: number; vy: number; r: number; vida: number; idade: number }
interface Sulco { x: number; a: number; escuro: boolean }

export interface ChaoSaibro {
    destruir(): void;
    /** Marca da bola + pó, em coordenadas do canvas (px CSS). */
    tocar(x: number, y: number): void;
    soprar(dir: 1 | -1, forca?: number): void;
    rolar(y: number): void;
    redimensionar(): void;
}

function profundidade(): number {
    const r = Math.random();
    if (r < 0.5) return 0.3 + Math.random() * 0.25;
    if (r < 0.85) return 0.55 + Math.random() * 0.25;
    return 0.85 + Math.random() * 0.3;
}

const MARGEM_LINHA = 14;

/** Ruído suave que emenda nas bordas: grade aleatória com interpolação bilinear, 0–1 por pixel. */
function ruidoPeriodico(lado: number, celulas: number): Float32Array {
    const grade = new Float32Array(celulas * celulas).map(() => Math.random());
    const saida = new Float32Array(lado * lado), passo = celulas / lado;
    for (let y = 0; y < lado; y++) {
        const gy = y * passo, y0 = gy | 0, fy = gy - y0, y1 = (y0 + 1) % celulas;
        for (let x = 0; x < lado; x++) {
            const gx = x * passo, x0 = gx | 0, fx = gx - x0, x1 = (x0 + 1) % celulas;
            const a = grade[y0 * celulas + x0], b = grade[y0 * celulas + x1], c = grade[y1 * celulas + x0], e = grade[y1 * celulas + x1];
            saida[y * lado + x] = (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
        }
    }
    return saida;
}

const LADRILHO_CSS = 256;
const ladrilhos = new Map<number, HTMLCanvasElement>();

/**
 * O saibro da foto num ladrilho que se repete sem costura: torrões miúdos com
 * o topo aceso e a sombra embaixo (relevo = altura menos a do vizinho de cima,
 * a luz do refletor vem de cima). Gerado uma vez por densidade de tela.
 */
function ladrilhoDeSaibro(d: number): HTMLCanvasElement {
    const pronto = ladrilhos.get(d);
    if (pronto) return pronto;
    const lado = Math.round(LADRILHO_CSS * d);
    const graos = ruidoPeriodico(lado, Math.round(LADRILHO_CSS / 2.2)), torroes = ruidoPeriodico(lado, Math.round(LADRILHO_CSS / 6)), manchas = ruidoPeriodico(lado, 4);
    const base = [0x9a, 0x3a, 0x14], passo = Math.max(1, Math.round(1.2 * d)) * lado;
    const c = document.createElement('canvas'); c.width = lado; c.height = lado;
    const g = c.getContext('2d')!; const img = g.createImageData(lado, lado), px = img.data;
    for (let i = 0; i < lado * lado; i++) {
        const alt = graos[i] * 0.6 + torroes[i] * 0.4;
        const k = (i - passo + lado * lado) % (lado * lado);
        const cima = graos[k] * 0.6 + torroes[k] * 0.4;
        let v = 0.92 + (alt - 0.5) * 0.2 + (alt - cima) * 1.05 + (manchas[i] - 0.5) * 0.18 + (Math.random() - 0.5) * 0.08;
        if (alt < 0.3) v *= 0.88; // vão entre os grãos
        const quente = 1 + (alt - 0.5) * 0.12; // topo do grão puxa para o laranja
        px[i * 4] = Math.min(255, base[0] * v * quente);
        px[i * 4 + 1] = Math.min(255, base[1] * v * quente * quente);
        px[i * 4 + 2] = Math.min(255, base[2] * v);
        px[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    ladrilhos.set(d, c);
    return c;
}

function pintarGranulado(t: CanvasRenderingContext2D, w: number, h: number, d: number): void {
    t.save(); t.setTransform(1, 0, 0, 1, 0, 0);
    t.fillStyle = t.createPattern(ladrilhoDeSaibro(d), 'repeat') ?? CHAO;
    t.fillRect(0, 0, w, h); t.restore();
}

/** Fita de linha de quadra gasta, já com pó por cima. `comprimento` em px CSS. */
function linhaGasta(comprimento: number, vertical: boolean, d: number): HTMLCanvasElement {
    const larg = LARGURA_LINHA + 2;
    const c = document.createElement('canvas');
    c.width = Math.round((vertical ? larg : comprimento) * d); c.height = Math.round((vertical ? comprimento : larg) * d);
    const g = c.getContext('2d')!; g.setTransform(d, 0, 0, d, 0, 0);
    const ret = (u: number, v: number, a: number, b: number) => (vertical ? g.fillRect(v, u, b, a) : g.fillRect(u, v, a, b));
    // Faixa branca com a tinta variando ao longo dela.
    g.fillStyle = LINHA;
    for (let u = 0; u < comprimento; u += 6) { g.globalAlpha = 0.82 + Math.random() * 0.16; ret(u, 1, 6, LARGURA_LINHA); }
    // Bordas comidas pelo saibro.
    g.fillStyle = CHAO;
    for (let u = 0; u < comprimento; u += 1.5) {
        if (Math.random() < 0.18) { g.globalAlpha = 0.4 + Math.random() * 0.5; ret(u, 1, 1.5, 0.5 + Math.random() * 0.9); }
        if (Math.random() < 0.18) { g.globalAlpha = 0.5 + Math.random() * 0.5; const e = 0.6 + Math.random() * 1.1; ret(u, 1 + LARGURA_LINHA - e, 1.5, e); }
    }
    // Pó de saibro assentado na tinta.
    for (let i = 0; i < comprimento * 0.6; i++) {
        g.globalAlpha = 0.2 + Math.random() * 0.35; g.fillStyle = PO_NA_LINHA[(Math.random() * 4) | 0];
        const s = 0.6 + Math.random() * 1.3; ret(Math.random() * comprimento, 1 + Math.random() * (LARGURA_LINHA - s), s, s);
    }
    // Trincas da fita, de tempos em tempos.
    g.fillStyle = '#7a3a22';
    for (let u = 10 + Math.random() * 40; u < comprimento; u += 24 + Math.random() * 46) { g.globalAlpha = 0.35 + Math.random() * 0.3; ret(u, 1, 0.9, LARGURA_LINHA); }
    g.globalAlpha = 1;
    return c;
}

export function criarChaoSaibro(canvas: HTMLCanvasElement): ChaoSaibro | null {
    const x = canvas.getContext('2d');
    if (!x) return null;
    const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    let W = 0, H = 0, d = 1, LX = 0, LR = 640;
    const LY = -60;
    let textura: HTMLCanvasElement | null = null;
    let linhaLateral: HTMLCanvasElement | null = null, linhaDeSaque: HTMLCanvasElement | null = null, linhaCentral: HTMLCanvasElement | null = null;
    let rastro: CanvasRenderingContext2D | null = null;
    let rastroTela: HTMLCanvasElement | null = null;
    let luz: CanvasGradient | null = null;
    let graos: Grao[] = [];
    let pos: Po[] = [];
    let sulcos: Sulco[] = [];
    let rolagem = 0, rolagemAnterior = 0;
    let rajada: { t0: number; dir: 1 | -1; forca: number } | null = null;
    let morto = false, raf = 0;
    const t0 = performance.now();
    let ultimo = t0, rasteloAnterior = -999, proximaRajada = 7000;
    let ultimoApagar = 0;

    function montar() {
        W = canvas.clientWidth; H = canvas.clientHeight;
        if (W < 2 || H < 2) return;
        d = Math.min(W > 900 ? 1.5 : 2, window.devicePixelRatio || 1);
        LX = W * 0.87; LR = Math.max(640, Math.hypot(W, H) * 0.7);
        canvas.width = Math.round(W * d); canvas.height = Math.round(H * d);
        x!.setTransform(d, 0, 0, d, 0, 0);

        const TH = H + SOBRA;
        textura = document.createElement('canvas');
        textura.width = canvas.width; textura.height = Math.round(TH * d);
        const t = textura.getContext('2d')!;
        t.setTransform(d, 0, 0, d, 0, 0);
        pintarGranulado(t, textura.width, textura.height, d);
        const area = W * TH;
        for (let i = 0; i < area / 6800; i++) {
            t.globalAlpha = 0.07; t.fillStyle = TEXTURA[i % 5];
            t.beginPath(); t.ellipse(Math.random() * W, Math.random() * TH, 12 + Math.random() * 46, 4 + Math.random() * 14, Math.random() * 3, 0, 7); t.fill();
        }
        t.globalAlpha = 1;
        linhaLateral = linhaGasta(TH, true, d);
        linhaDeSaque = linhaGasta(W - 2 * MARGEM_LINHA, false, d);
        linhaCentral = linhaGasta(H + 200, true, d);

        rastroTela = document.createElement('canvas');
        rastroTela.width = canvas.width; rastroTela.height = canvas.height;
        rastro = rastroTela.getContext('2d')!;
        rastro.setTransform(d, 0, 0, d, 0, 0);

        luz = x!.createRadialGradient(LX, LY, 20, LX, LY, LR);
        luz.addColorStop(0, 'rgba(226,118,50,0.22)'); luz.addColorStop(0.45, 'rgba(194,92,30,0.08)'); luz.addColorStop(1, 'rgba(154,58,20,0)');

        graos = [];
        const n = contarGraos(W, H);
        for (let i = 0; i < n; i++) {
            const z = profundidade(), a0 = Math.random() * 6.283, v0 = reduzido ? 0 : Math.random() * 2.4 * z;
            graos.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.cos(a0) * v0, vy: Math.sin(a0) * v0, s: 0.5 + z * 1.5 * (0.6 + Math.random() * 0.6), z, c: GRAOS[(Math.random() * 5) | 0], a: 0.4 + z * 0.5, brilha: Math.random() < 0.12, fase: Math.random() * 6.283 });
        }
        pos = [];
        sulcos = [];
        for (let gx = 4; gx < W; gx += 5 + Math.random() * 8) sulcos.push({ x: gx, a: 0.02 + Math.random() * 0.04, escuro: Math.random() < 0.5 });
        rasteloAnterior = -999;
    }

    function nuvem(px: number, py: number, n: number, forca: number, sobe: number) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.283, v = (0.3 + Math.random()) * forca;
            pos.push({ x: px + Math.cos(a) * 6, y: py + Math.sin(a) * 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - sobe, r: 0.8 + Math.random() * 1.6, vida: 600 + Math.random() * 800, idade: 0 });
        }
        if (pos.length > 500) pos.splice(0, pos.length - 500);
    }

    function desenhar(agora: number, f: number) {
        if (!textura || !rastro || !rastroTela || !luz) return;
        const T = agora - t0;
        // Um salto de rolagem (voltar ao topo) não pode virar um vendaval.
        const dv = Math.max(-40, Math.min(40, rolagem - rolagemAnterior)); rolagemAnterior = rolagem;
        const L = reduzido ? 1 : intensidadeDaLuz(T);

        const desvio = (((rolagem * 0.25) % SOBRA) + SOBRA) % SOBRA;
        x!.globalAlpha = 1;
        x!.drawImage(textura, 0, desvio * d, W * d, H * d, 0, 0, W, H);
        x!.globalAlpha = L; x!.fillStyle = luz; x!.fillRect(0, 0, W, H);

        // Linhas da quadra: laterais (andam com a textura) e a de saque, que sobe com a rolagem.
        const ly = H * 0.62 - rolagem * 0.5;
        if (linhaLateral && linhaDeSaque && linhaCentral) {
            x!.globalAlpha = 0.55 + 0.4 * L;
            const lw = LARGURA_LINHA + 2;
            x!.drawImage(linhaLateral, 0, desvio * d, lw * d, H * d, MARGEM_LINHA - 1, 0, lw, H);
            x!.drawImage(linhaLateral, 0, desvio * d, lw * d, H * d, W - MARGEM_LINHA - lw + 1, 0, lw, H);
            if (ly < H + 10) {
                x!.drawImage(linhaCentral, W / 2 - lw / 2, ly + LARGURA_LINHA / 2, lw, H + 200);
                x!.drawImage(linhaDeSaque, MARGEM_LINHA, ly - lw / 2, W - 2 * MARGEM_LINHA, lw);
            }
            x!.globalAlpha = 1;
        }

        // As marcas somem devagar (e mais rápido enquanto a tela rola).
        // Em pulsos: um apagar fraco a cada quadro não vence o arredondamento do canal alfa.
        if (T - ultimoApagar > 400 || Math.abs(dv) > 2) {
            ultimoApagar = T;
            rastro.globalCompositeOperation = 'destination-out'; rastro.globalAlpha = Math.min(1, 0.07 + Math.abs(dv) * 0.02); rastro.fillRect(0, 0, W, H);
            rastro.globalCompositeOperation = 'source-over'; rastro.globalAlpha = 1;
        }

        let rastelo = -999;
        if (!reduzido && T > 5000) { const c = (T - 5000) % RASTELO_CICLO; if (c < RASTELO_DURACAO) rastelo = -30 + (c / RASTELO_DURACAO) * (H + 60); }
        if (rastelo > -900) {
            if (rasteloAnterior < -900 || rasteloAnterior > rastelo) rasteloAnterior = rastelo - 2;
            rastro.globalCompositeOperation = 'destination-out'; rastro.fillRect(0, rasteloAnterior - 1, W, rastelo - rasteloAnterior + 2); rastro.globalCompositeOperation = 'source-over';
            rastro.lineWidth = 1;
            for (const q of sulcos) {
                rastro.strokeStyle = q.escuro ? `rgba(6,3,1,${q.a * 2})` : `rgba(217,122,69,${q.a})`;
                rastro.beginPath(); rastro.moveTo(q.x, rasteloAnterior - 1); rastro.lineTo(q.x + Math.sin(rastelo * 0.05 + q.x) * 0.6, rastelo + 1); rastro.stroke();
            }
            const porQuadro = Math.max(2, Math.round(W / 200));
            for (let i = 0; i < porQuadro; i++) pos.push({ x: Math.random() * W, y: rastelo, vx: (Math.random() - 0.5) * 0.5, vy: -0.2 - Math.random() * 0.5, r: 0.8 + Math.random() * 1.4, vida: 500 + Math.random() * 600, idade: 0 });
            rasteloAnterior = rastelo;
        } else rasteloAnterior = -999;

        x!.globalAlpha = 0.5 + 0.5 * L; x!.drawImage(rastroTela, 0, 0, W, H); x!.globalAlpha = 1;
        if (rastelo > -900) { x!.fillStyle = 'rgba(217,122,69,0.10)'; x!.fillRect(0, rastelo - 12, W, 14); x!.fillStyle = 'rgba(242,196,162,0.32)'; x!.fillRect(0, rastelo, W, 1.5); }

        if (!reduzido && !rajada && T > proximaRajada) { rajada = { t0: T, dir: Math.random() < 0.5 ? 1 : -1, forca: 1.3 }; proximaRajada = T + 9000 + Math.random() * 6000; }
        let frente = -9999, gk = 0, gd = 0;
        if (rajada) {
            const u = (T - rajada.t0) / 1100;
            if (u >= 1) rajada = null;
            else { gd = rajada.dir; gk = rajada.forca * Math.sin(u * Math.PI); frente = frenteDaRajada(u, rajada.dir, W); }
        }

        for (const p of graos) {
            if (!reduzido) {
                const ang = -0.3 + 0.9 * Math.sin(p.x * 0.011 + T * 0.00022) + 0.8 * Math.cos(p.y * 0.009 - T * 0.00017);
                const sp = VENTO * p.z, rel = 0.03 * f;
                p.vx += (Math.cos(ang) * sp - p.vx) * rel; p.vy += (Math.sin(ang) * sp * 0.6 - p.vy) * rel;
                p.vy -= dv * 0.035 * p.z; p.vx += dv * 0.006 * Math.sin(p.fase) * p.z;
                const fx = Math.abs(p.x - frente);
                if (fx < 80) { const w = (1 - fx / 80) * gk * p.z * f; p.vx += gd * w * 0.55; p.vy += Math.sin(p.fase + T * 0.004) * w * 0.12; }
                if (Math.abs(p.y - rastelo) < 14) { p.vx += (Math.random() - 0.5) * 0.4; p.vy = p.vy * 0.6 + 0.6; }
                p.x += p.vx * f; p.y += p.vy * f;
                if (p.x < -6) p.x = W + 6; else if (p.x > W + 6) p.x = -6;
                if (p.y < -6) p.y = H + 6; else if (p.y > H + 6) p.y = -6;
            }
            const lx = p.x - LX, lyy = p.y - LY, aceso = Math.max(0, 1 - Math.sqrt(lx * lx + lyy * lyy) / LR);
            // O pó é escuro: o refletor só o deixa um pouco mais nítido, nunca mais claro.
            let al = p.a * (0.6 + aceso * 0.5 * L);
            if (p.brilha) al *= 0.55 + 0.9 * Math.max(0, Math.sin(T * 0.003 + p.fase)) * (0.3 + aceso);
            x!.globalAlpha = Math.min(1, al);
            if (p.vx * p.vx + p.vy * p.vy > 1.1) { x!.strokeStyle = p.c; x!.lineWidth = p.s; x!.beginPath(); x!.moveTo(p.x, p.y); x!.lineTo(p.x - p.vx * 2.6, p.y - p.vy * 2.6); x!.stroke(); }
            else {
                // Torrão: corpo escuro e, nos maiores, um topo um pouco aceso, como na quadra de dia.
                x!.fillStyle = p.c; x!.fillRect(p.x, p.y, p.s, p.s);
                if (p.s > 1.4) { x!.fillRect(p.x + p.s * 0.5, p.y - p.s * 0.3, p.s * 0.8, p.s * 0.8); x!.fillStyle = TOPO_DO_TORRAO; x!.fillRect(p.x, p.y, p.s * 0.6, p.s * 0.45); }
            }
        }

        const vivos: Po[] = [];
        x!.fillStyle = PO;
        for (const q of pos) {
            q.idade += 16.67 * f; if (q.idade >= q.vida) continue;
            vivos.push(q);
            const arrasto = Math.pow(0.94, f); q.vx *= arrasto; q.vy = q.vy * arrasto - 0.006 * f; q.x += q.vx * f; q.y += q.vy * f; q.r += 0.035 * f;
            const k = 1 - q.idade / q.vida; x!.globalAlpha = k * k * 0.6 * (0.5 + 0.5 * L);
            x!.beginPath(); x!.arc(q.x, q.y, q.r, 0, 6.283); x!.fill();
        }
        pos = vivos;
        x!.globalAlpha = 1;
    }

    function quadro(agora: number) {
        if (morto) return;
        raf = requestAnimationFrame(quadro);
        if (document.hidden) { ultimo = agora; return; }
        const passou = agora - ultimo;
        if (passou < QUADRO_MS) return;
        ultimo = agora;
        desenhar(agora, Math.min(3, passou / 16.67));
    }

    montar();
    if (reduzido) desenhar(performance.now(), 1);
    else raf = requestAnimationFrame(quadro);

    return {
        destruir() { morto = true; cancelAnimationFrame(raf); },
        tocar(px, py) {
            if (!rastro) return;
            const g = rastro, giro = Math.random() * Math.PI;
            g.save(); g.translate(px, py); g.rotate(giro);
            for (let i = 3; i >= 1; i--) { g.globalAlpha = 0.16 * (4 - i) / 3; g.fillStyle = '#060301'; g.beginPath(); g.ellipse(-i * 9, 0, 13 - i * 2.5, 7 - i * 1.3, 0, 0, 6.283); g.fill(); }
            g.globalAlpha = 0.7; g.fillStyle = '#060301'; g.beginPath(); g.ellipse(0, 0, 15, 9, 0, 0, 6.283); g.fill();
            g.globalAlpha = 0.8; g.strokeStyle = GIZ; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 17, 10.5, 0, -1.6, 1.6); g.stroke();
            g.restore(); g.globalAlpha = 1;
            if (reduzido) { desenhar(performance.now(), 1); return; }
            nuvem(px, py, 26, 2.2, 0.5);
            for (const p of graos) {
                const dx = p.x - px, dy = p.y - py, dd = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dd < 120) { const k = (1 - dd / 120) * 3.6 * p.z; p.vx += (dx / dd) * k; p.vy += (dy / dd) * k; }
            }
        },
        soprar(dir, forca = 3.4) { if (!reduzido) rajada = { t0: performance.now() - t0, dir, forca }; },
        rolar(y) { rolagem = y; if (reduzido) desenhar(performance.now(), 1); },
        redimensionar() { if (canvas.clientWidth !== W || canvas.clientHeight !== H) { montar(); if (reduzido) desenhar(performance.now(), 1); } },
    };
}
