// SHA-256 do PDF no aparelho: confere se o arquivo baixado é exatamente o que o administrador publicou
// (`content_sha256`). O dossiê da assinatura usa o hash que está no BANCO; esta conferência só impede
// o sócio de "ler" um arquivo trocado ou corrompido no caminho.

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function matchesSha256(data: ArrayBuffer | Uint8Array, expected: string): Promise<boolean> {
  return (await sha256Hex(data)) === (expected ?? '').toLowerCase();
}
