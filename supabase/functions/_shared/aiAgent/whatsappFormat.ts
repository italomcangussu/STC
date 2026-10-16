/**
 * Texto do João no formato que o WhatsApp entende. O modelo às vezes escreve Markdown (**negrito**, # título,
 * "- item"); o WhatsApp mostraria os símbolos crus. Aqui viram *negrito*, título em negrito e marcador "•".
 */
export function toWhatsApp(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(formatLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatLine(line: string): string {
  const semFim = line.replace(/[ \t]+$/, '');
  const titulo = /^\s*#{1,6}\s+(.+)$/.exec(semFim);
  const base = titulo ? `*${stripBold(titulo[1])}*` : semFim.replace(/^(\s*)[-*+]\s+(?=\S)/, '$1• ');
  return base
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '*$1*')
    .replace(/__(?=\S)(.+?)(?<=\S)__/g, '*$1*')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '~$1~');
}

const stripBold = (s: string) => s.replace(/\*+/g, '').trim();
