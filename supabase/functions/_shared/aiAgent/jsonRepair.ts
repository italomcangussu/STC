// Portado do CRM Ibiapaba (`_shared/ia/shared/jsonRepair.ts`) sem mudanças.
// Helpers de leitura de saída de LLM, idênticos nos três nodes de parse do workflow
// (Router, Memory, Atendente). No n8n cada Code node carrega a sua própria cópia; aqui
// existe uma só — a duplicação era imposta pelo runtime, não pelo domínio.

/**
 * Conserta a vírgula sobrando antes de `]` ou `}` — o erro de sintaxe recuperável mais
 * comum dos LLMs (exec 434620: o Atendente matou 3 turnos por causa de uma).
 *
 * Conservador de propósito: NÃO fecha chave aberta nem completa string. JSON truncado
 * segue falhando e virando handoff, que é a resposta certa quando o conteúdo realmente
 * não existe.
 */
export function repararJson(texto: unknown): string {
  return String(texto == null ? "" : texto).replace(/,(\s*[\]}])/g, "$1");
}

/**
 * Primeiro objeto JSON **balanceado** do texto.
 *
 * O modelo às vezes escreve raciocínio antes do JSON, ou repete o objeto duas vezes
 * coladas — exec 453045 (cenário 05, turno 2): a resposta boa
 * `["Anotei.","Qual o seu nome completo?"]` virou transferência porque o parse viu prosa
 * mais dois objetos. A regex gulosa `/\{[\s\S]*\}/` vai até o ÚLTIMO `}`, junta os dois
 * e reprova igual.
 *
 * Conservador como o `repararJson`: chave aberta sem fechar devolve o texto cru, então
 * saída truncada segue falhando e virando handoff — que é a resposta certa quando o
 * conteúdo realmente não chegou.
 */
export function extrairObjeto(texto: unknown): string {
  const s = String(texto == null ? "" : texto);
  const inicio = s.indexOf("{");
  if (inicio === -1) return s;
  let profundidade = 0;
  let emString = false;
  let escapado = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (escapado) { escapado = false; continue; }
    if (c === "\\") { escapado = true; continue; }
    if (c === '"') { emString = !emString; continue; }
    if (emString) continue;
    if (c === "{") profundidade++;
    else if (c === "}") {
      profundidade--;
      if (profundidade === 0) return s.slice(inicio, i + 1);
    }
  }
  return s;
}

/** Tira as marcas de bloco de código markdown que o modelo às vezes envolve no JSON. */
export function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

/** Equivalente a `String(error.message || error)` do JS dos nodes. */
export function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return String(message || error);
}
