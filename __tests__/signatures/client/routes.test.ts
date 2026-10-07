import { afterEach, describe, expect, it } from 'vitest';
import { clearDocumentsHash, documentsHash, parseDocumentsHash, showDocumentsList, viewFromHash } from '../../../lib/signatures/routes';

const ID = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

describe('link do WhatsApp: /#documentos/<id>', () => {
  it.each(['#documentos', '#/documentos', '#documentos/', '#Documentos'])('"%s" abre a lista', (hash) => {
    expect(parseDocumentsHash(hash)).toEqual({ documentId: null });
  });

  it('"#documentos/<id>" abre o documento (id em minúsculas, com ou sem ?…)', () => {
    expect(parseDocumentsHash(`#documentos/${ID}`)).toEqual({ documentId: ID });
    expect(parseDocumentsHash(`#/documentos/${ID.toUpperCase()}`)).toEqual({ documentId: ID });
    expect(parseDocumentsHash(`#documentos/${ID}?utm_source=whatsapp`)).toEqual({ documentId: ID });
  });

  it('id malformado ou com sobra no caminho NÃO derruba: abre a lista', () => {
    expect(parseDocumentsHash('#documentos/abc')).toEqual({ documentId: null });
    expect(parseDocumentsHash('#documentos/../../etc')).toEqual({ documentId: null });
    expect(parseDocumentsHash(`#documentos/${ID}/extra`)).toEqual({ documentId: null });
  });

  it.each(['', '#', '#meu-financeiro', '#conversas', '#documentosX', '#documentos-antigos'])('"%s" não é a aba de documentos', (hash) => {
    expect(parseDocumentsHash(hash)).toBeNull();
  });

  it('documentsHash só monta link com id válido', () => {
    expect(documentsHash(ID)).toBe(`#documentos/${ID}`);
    expect(documentsHash(ID.toUpperCase())).toBe(`#documentos/${ID}`);
    expect(documentsHash(null)).toBe('#documentos');
    expect(documentsHash('<script>')).toBe('#documentos');
  });
});

describe('aba inicial do app a partir do #', () => {
  it('mantém "Meu financeiro" e abre Documentos; o resto é a Agenda', () => {
    expect(viewFromHash('#meu-financeiro')).toBe('meu-financeiro');
    expect(viewFromHash(`#documentos/${ID}`)).toBe('documentos');
    expect(viewFromHash('#documentos')).toBe('documentos');
    expect(viewFromHash('')).toBe('agenda');
    expect(viewFromHash('#qualquer-coisa')).toBe('agenda');
  });
});

describe('sair da aba limpa o link', () => {
  afterEach(() => { window.location.hash = ''; });

  it('remove #documentos/… mas não mexe em outro #', () => {
    window.location.hash = `#documentos/${ID}`;
    clearDocumentsHash();
    expect(window.location.hash).toBe('');

    window.location.hash = '#meu-financeiro';
    clearDocumentsHash();
    expect(window.location.hash).toBe('#meu-financeiro');
  });
});

describe('tocar de novo na aba Documentos', () => {
  afterEach(() => { window.location.hash = ''; });

  it('dentro de um documento, volta para a lista', () => {
    window.location.hash = `#documentos/${ID}`;
    showDocumentsList();
    expect(window.location.hash).toBe('#documentos');
  });

  it('na lista, ou em outro #, não mexe em nada', () => {
    window.location.hash = '#documentos';
    showDocumentsList();
    expect(window.location.hash).toBe('#documentos');

    window.location.hash = '#meu-financeiro';
    showDocumentsList();
    expect(window.location.hash).toBe('#meu-financeiro');
  });
});
