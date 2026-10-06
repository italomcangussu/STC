/**
 * Categorias do DRE (plano de contas simples, dois níveis). As categorias
 * automáticas (mensalidade, Card Mensal, Aula avulsa, Day Card, descontos, multas)
 * existem para o sistema lançar sozinho; lançá-las à mão contaria duas vezes.
 */
import React, { useMemo, useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { saveCategory } from '../../../lib/finance/financeApi';
import type { DreLineKey, FinCategory } from '../../../lib/finance/types';
import { DRE_LINE_LABELS } from '../../../lib/finance/reports';
import { useRequestKey } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Card, Empty, Field, Notice, Row, Sheet, btnGhost, btnPrimary, inputCls } from '../ui';

const LINE_LABEL: Record<DreLineKey, string> = { ...DRE_LINE_LABELS, none: 'Fora do DRE' };
const LINES_BY_KIND: Record<FinCategory['kind'], DreLineKey[]> = {
  revenue: ['revenue', 'deduction', 'none'],
  expense: ['variable_cost', 'operational', 'administrative', 'commercial', 'financial', 'none'],
};

const CategorySheet: React.FC<{ category: FinCategory | 'new' | null; categories: FinCategory[]; onClose: () => void; onDone: () => void }> = ({ category, categories, onClose, onDone }) => {
  const { key, renew } = useRequestKey();
  const editing = category && category !== 'new' ? category : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<FinCategory['kind']>(editing?.kind ?? 'expense');
  const [parent, setParent] = useState(editing?.parent_id ?? '');
  const [line, setLine] = useState<DreLineKey>(editing?.dre_line ?? 'operational');
  const [active, setActive] = useState(editing?.active ?? true);
  const [busy, setBusy] = useState(false);
  if (!category) return null;

  const system = !!editing?.system_key;
  const parents = categories.filter((c) => !c.parent_id && c.active && c.kind === kind && !c.system_key);
  const hasParent = !!parent;
  const save = async () => {
    setBusy(true);
    try {
      const data: Record<string, unknown> = { name: name.trim() };
      if (!editing) { data.kind = kind; data.parent_id = parent || null; if (!hasParent) data.dre_line = line; }
      else { if (!system && !editing.parent_id) data.dre_line = line; data.active = active; }
      await saveCategory(editing?.id ?? null, editing?.version ?? null, data, key);
      notify.success('Categoria salva.'); renew(); onDone(); onClose();
    } catch (e) { notifyFinanceError(e, 'Não foi possível salvar a categoria.', 'finance_category_save_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} title={editing ? 'Editar categoria' : 'Nova categoria'}
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || name.trim().length < 2} onClick={save}>Salvar</button></>}>
      {system && <Notice tone="info">Categoria automática do sistema: só o nome pode mudar. Ela não pode ser desativada nem usada em lançamentos manuais.</Notice>}
      <Field label="Nome"><input className={inputCls} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {!editing && (
        <>
          <Field label="Tipo"><select className={inputCls} value={kind} onChange={(e) => { const k = e.target.value as FinCategory['kind']; setKind(k); setParent(''); setLine(LINES_BY_KIND[k][0]); }}><option value="expense">Despesa</option><option value="revenue">Receita</option></select></Field>
          <Field label="Dentro de (opcional)" hint="Subcategoria herda a linha do DRE da categoria principal."><select className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Categoria principal</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </>
      )}
      {!hasParent && !system && (!editing || !editing.parent_id) && (
        <Field label="Linha do DRE" hint="Define onde a categoria aparece na demonstração."><select className={inputCls} value={line} onChange={(e) => setLine(e.target.value as DreLineKey)}>{LINES_BY_KIND[editing?.kind ?? kind].map((l) => <option key={l} value={l}>{LINE_LABEL[l]}</option>)}</select></Field>
      )}
      {editing && !system && <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-stone-700"><input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />Ativa</label>}
    </Sheet>
  );
};

const CategoriesTab: React.FC = () => {
  const { categories, reload } = useFinance();
  const [sheet, setSheet] = useState<FinCategory | 'new' | null>(null);
  const [kind, setKind] = useState<FinCategory['kind']>('expense');

  const tree = useMemo(() => {
    const roots = categories.filter((c) => !c.parent_id && c.kind === kind);
    return roots.map((r) => ({ root: r, children: categories.filter((c) => c.parent_id === r.id) }));
  }, [categories, kind]);

  return (
    <div className="space-y-4">
      <Card title="Categorias" right={<button className={btnPrimary} onClick={() => setSheet('new')}><Plus size={16} /> Nova</button>}>
        <div className="mb-3 flex gap-2">
          {(['expense', 'revenue'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-11 rounded-full border px-4 text-xs font-bold ${kind === k ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-500'}`}>{k === 'expense' ? 'Despesas' : 'Receitas'}</button>
          ))}
        </div>
        {tree.length === 0 ? <Empty icon={<Tags size={28} />} title="Nenhuma categoria" /> : (
          <ul className="space-y-2">
            {tree.map(({ root, children }) => (
              <li key={root.id} className="space-y-1.5">
                <Row onClick={() => setSheet(root)}>
                  <div className="flex items-center justify-between gap-2"><p className="text-sm font-black">{root.name}</p><div className="flex gap-1.5">{root.system_key && <Badge tone="info">Automática</Badge>}{!root.active && <Badge tone="muted">Inativa</Badge>}<Badge>{LINE_LABEL[root.dre_line]}</Badge></div></div>
                </Row>
                {children.length > 0 && (
                  <ul className="ml-4 space-y-1.5 border-l-2 border-stone-100 pl-3">
                    {children.map((c) => (
                      <li key={c.id}><Row onClick={() => setSheet(c)}><div className="flex items-center justify-between gap-2"><p className="text-sm font-bold">{c.name}</p><div className="flex gap-1.5">{c.system_key && <Badge tone="info">Automática</Badge>}{!c.active && <Badge tone="muted">Inativa</Badge>}</div></div></Row></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <CategorySheet key={sheet === 'new' ? 'new' : sheet?.id ?? 'none'} category={sheet} categories={categories} onClose={() => setSheet(null)} onDone={reload} />
    </div>
  );
};

export default CategoriesTab;
