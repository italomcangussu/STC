/**
 * Novo documento / edição de rascunho / nova versão (administrador).
 *
 * Ordem do que acontece ao salvar (a que o banco exige): cria o rascunho (linha) → envia o PDF para o
 * bucket privado (a política só aceita o caminho de um rascunho existente) → grava os destinatários.
 * Publicar é um passo à parte, com confirmação, porque envia WhatsApp a todos e congela o documento.
 * Se o envio do arquivo falhar depois de criado o rascunho, o rascunho FICA (o próximo "Salvar" reenvia
 * o arquivo para o mesmo documento), em vez de apagar às cegas.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, Search } from 'lucide-react';
import {
  adminErrorMessage, createDraft, getDocumentDescription, listRecipients, listSignableMembers, prepareFile, publishDocument, removeDraftFile,
  setRecipients, updateDraft, uploadDraftFile, type DraftInput, type MemberOption, type OverviewRow, type PreparedFile, type PublishResult,
} from '../../../lib/signatures/admin';
import { endOfClubDay, formatDate, toDateInput, todayInput } from '../../../lib/signatures/format';
import { useConfirm } from '../../../hooks/useConfirm';
import { Notice, Spinner, btnGhost, btnPrimary, inputCls } from '../ui';

export type FormTarget =
  | { kind: 'new' }
  | { kind: 'draft'; doc: OverviewRow }
  | { kind: 'version'; of: OverviewRow };

type Props = {
  target: FormTarget;
  onCancel: () => void;
  /** Rascunho salvo (sem publicar). */
  onSaved: (id: string) => void;
  /** Publicado: quem chama despacha os avisos e mostra o resultado. */
  onPublished: (id: string, result: PublishResult) => void;
};

const titleOf = (t: FormTarget) => (t.kind === 'new' ? 'Novo documento' : t.kind === 'draft' ? 'Editar rascunho' : `Nova versão de "${t.of.title}"`);

export const DocumentForm: React.FC<Props> = ({ target, onCancel, onSaved, onPublished }) => {
  const confirm = useConfirm();
  const source = target.kind === 'draft' ? target.doc : target.kind === 'version' ? target.of : null;

  const [title, setTitle] = useState(source?.title ?? '');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState(target.kind === 'draft' ? toDateInput(source?.due_at) : '');
  const [audience, setAudience] = useState<'all' | 'selected'>(source?.audience_mode ?? 'all');
  const [newMembers, setNewMembers] = useState(source?.applies_to_new_members ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<MemberOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'publish'>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Rascunho já criado nesta tela (o envio do arquivo pode ter falhado): salvar de novo atualiza, não duplica.
  const draftId = useRef<string | null>(target.kind === 'draft' ? target.doc.id : null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, current, text] = await Promise.all([
          listSignableMembers(),
          target.kind === 'draft' && target.doc.audience_mode === 'selected' ? listRecipients(target.doc.id) : Promise.resolve([]),
          target.kind === 'draft' ? getDocumentDescription(target.doc.id) : Promise.resolve(''),
        ]);
        if (!alive) return;
        setMembers(list);
        setDescription(text);
        setSelected(new Set(current.map((r) => r.profile_id)));
      } catch (e) {
        if (alive) setLoadError(adminErrorMessage(e, 'Não foi possível carregar a lista de sócios.'));
      }
    })();
    return () => { alive = false; };
  }, [target]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? []).filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [members, query]);

  const hasFile = Boolean(prepared) || target.kind === 'draft';
  const recipientsCount = audience === 'all' ? (members?.length ?? 0) : selected.size;
  const withoutPhone = (audience === 'all' ? members ?? [] : (members ?? []).filter((m) => selected.has(m.id))).filter((m) => !m.phone?.trim()).length;
  const canSave = title.trim().length >= 3 && hasFile && (audience === 'all' || selected.size > 0) && !reading && busy === null;

  const pickFile = async (file: File | undefined) => {
    setFileError(null);
    setPrepared(null);
    if (!file) return;
    setReading(true);
    try {
      const p = await prepareFile(file);
      setPrepared(p);
      if (!title.trim()) setTitle(p.fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
    } catch (e) {
      setFileError(adminErrorMessage(e));
      if (fileInput.current) fileInput.current.value = '';
    } finally {
      setReading(false);
    }
  };

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /** Grava o rascunho (linha, arquivo e destinatários) e devolve o id. */
  const persist = async (): Promise<string> => {
    const input: DraftInput = {
      title, description, dueAt: endOfClubDay(due), audienceMode: audience, appliesToNewMembers: newMembers,
      replacesId: target.kind === 'version' ? target.of.id : null,
    };
    let id = draftId.current;
    if (!id) {
      if (!prepared) throw new Error('SIG_FILE_DATA_REQUIRED');
      const created = await createDraft(input, prepared);
      id = created.id;
      draftId.current = id;
      await uploadDraftFile(created.storagePath, prepared.file);
    } else {
      const updated = await updateDraft(id, input, prepared ?? undefined);
      if (prepared) {
        await uploadDraftFile(updated.storagePath, prepared.file);
        if (updated.previousStoragePath) await removeDraftFile(updated.previousStoragePath);
      }
    }
    if (audience === 'selected') await setRecipients(id, [...selected]);
    return id;
  };

  const save = async () => {
    setBusy('save'); setError(null);
    try { onSaved(await persist()); } catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(null); }
  };

  const publish = async () => {
    const ok = await confirm({
      title: 'Publicar e avisar os sócios?',
      description: `${recipientsCount} ${recipientsCount === 1 ? 'sócio receberá' : 'sócios receberão'} um WhatsApp com o link para ler e assinar "${title.trim()}".`,
      consequences: [
        'Depois de publicado, o PDF e o texto não podem mais ser alterados (só criando uma nova versão).',
        ...(withoutPhone > 0 ? [`${withoutPhone} ${withoutPhone === 1 ? 'sócio está sem telefone' : 'sócios estão sem telefone'} e não ${withoutPhone === 1 ? 'receberá' : 'receberão'} o aviso.`] : []),
        ...(target.kind === 'version' ? [`A versão ${target.of.version} sai de circulação (as assinaturas dela continuam valendo).`] : []),
      ],
      confirmLabel: 'Publicar e enviar avisos', tone: 'warning',
    });
    if (!ok) return;
    setBusy('publish'); setError(null);
    try {
      const id = await persist();
      onPublished(id, await publishDocument(id));
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={titleOf(target)}>
      <h2 className="text-lg font-black text-stone-800">{titleOf(target)}</h2>
      {target.kind === 'version' && (
        <Notice tone="info">A nova versão começa como rascunho. Só ao publicar a versão {target.of.version} sai de circulação, e quem já assinou continua com a assinatura registrada. Os sócios precisam assinar a versão nova.</Notice>
      )}

      <label className="block space-y-1 text-sm font-bold text-stone-700">
        Título
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Ex.: Termo de uso das quadras 2026" />
      </label>

      <label className="block space-y-1 text-sm font-bold text-stone-700">
        Descrição <span className="font-medium text-stone-400">(opcional)</span>
        <textarea className={`${inputCls} min-h-20`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Uma frase que explique o documento ao sócio." />
      </label>

      <div className="space-y-1 text-sm font-bold text-stone-700">
        PDF <span className="font-medium text-stone-400">(até 10 MB)</span>
        <input ref={fileInput} id="sig-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void pickFile(e.target.files?.[0])} />
        <label htmlFor="sig-file" className={`${btnGhost} w-full cursor-pointer justify-start`}>
          {reading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FileUp size={16} aria-hidden />}
          <span className="min-w-0 truncate">
            {reading ? 'Lendo o arquivo…' : prepared ? prepared.fileName : target.kind === 'draft' ? `Arquivo atual (${source?.page_count} pág.) — toque para trocar` : 'Escolher o PDF'}
          </span>
        </label>
        {prepared && <p className="text-xs font-medium text-emerald-700">{prepared.pageCount} {prepared.pageCount === 1 ? 'página' : 'páginas'} · {(prepared.sizeBytes / 1024 / 1024).toFixed(2)} MB · SHA-256 {prepared.sha256.slice(0, 12)}…</p>}
        {fileError && <p role="alert" className="text-xs font-bold text-red-700">{fileError}</p>}
      </div>

      <label className="block space-y-1 text-sm font-bold text-stone-700">
        Prazo para assinar <span className="font-medium text-stone-400">(opcional)</span>
        <input type="date" className={inputCls} value={due} min={todayInput()} onChange={(e) => setDue(e.target.value)} />
        <span className="block text-xs font-medium text-stone-400">Os sócios que não assinarem recebem lembretes 3 dias antes e no dia do prazo. Quem assinar depois do prazo continua podendo.{due && ` Vale até ${formatDate(endOfClubDay(due))}.`}</span>
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-stone-700">Quem deve assinar</legend>
        {([['all', 'Todos os sócios ativos'], ['selected', 'Só alguns sócios']] as const).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-700">
            <input type="radio" name="audience" checked={audience === value} onChange={() => setAudience(value)} className="h-4 w-4 accent-saibro-600" /> {label}
          </label>
        ))}
        {audience === 'all' && (
          <label className="flex min-h-11 items-start gap-3 rounded-xl px-1 text-sm font-medium text-stone-600">
            <input type="checkbox" checked={newMembers} onChange={(e) => setNewMembers(e.target.checked)} className="mt-1 h-4 w-4 accent-saibro-600" />
            <span>Vale também para quem virar sócio depois (recebe o aviso ao entrar).</span>
          </label>
        )}
      </fieldset>

      {audience === 'selected' && (
        <section className="space-y-2 rounded-3xl border border-stone-100 bg-white p-3" aria-label="Escolher sócios">
          {loadError ? <Notice tone="bad">{loadError}</Notice> : members === null ? <Spinner label="Carregando sócios…" /> : (
            <>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
                <input className={`${inputCls} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar sócio" aria-label="Buscar sócio" />
              </div>
              <div className="flex items-center justify-between text-xs font-bold text-stone-500">
                <span>{selected.size} de {members.length} escolhidos</span>
                <span className="flex gap-3">
                  <button type="button" className="min-h-9 text-saibro-700" onClick={() => setSelected(new Set(members.map((m) => m.id)))}>Todos</button>
                  <button type="button" className="min-h-9 text-saibro-700" onClick={() => setSelected(new Set())}>Nenhum</button>
                </span>
              </div>
              <ul className="max-h-72 divide-y divide-stone-100 overflow-y-auto rounded-2xl border border-stone-100">
                {visible.map((m) => (
                  <li key={m.id}>
                    <label className="flex min-h-11 items-center gap-3 px-3 text-sm text-stone-700">
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4 accent-saibro-600" />
                      <span className="min-w-0 flex-1 truncate font-bold">{m.name}</span>
                      {!m.phone?.trim() && <span className="shrink-0 text-[11px] font-bold text-amber-700">sem telefone</span>}
                    </label>
                  </li>
                ))}
                {visible.length === 0 && <li className="px-3 py-4 text-center text-xs text-stone-400">Nenhum sócio com esse nome.</li>}
              </ul>
            </>
          )}
        </section>
      )}

      {withoutPhone > 0 && <Notice tone="warn">{withoutPhone} {withoutPhone === 1 ? 'sócio está sem telefone' : 'sócios estão sem telefone'} no cadastro e não receberá o WhatsApp (nem o código para assinar). Cadastre o número antes de publicar, ou avise pessoalmente.</Notice>}
      {error && <Notice tone="bad" title="Não foi possível concluir">{error}</Notice>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={btnGhost} onClick={onCancel} disabled={busy !== null}>Cancelar</button>
        <button type="submit" className={btnGhost} disabled={!canSave}>{busy === 'save' && <Loader2 size={16} className="animate-spin" aria-hidden />} Salvar rascunho</button>
        <button type="button" className={btnPrimary} disabled={!canSave} onClick={() => void publish()}>{busy === 'publish' && <Loader2 size={16} className="animate-spin" aria-hidden />} Publicar…</button>
      </div>
    </form>
  );
};
