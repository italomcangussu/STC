/**
 * Alunos e Day Card — as taxas dos NÃO-sócios ao clube.
 *
 *  - Day Card: taxa do convidado de um sócio, para ter acesso ao clube por um dia
 *    (nada a ver com aula). Não há pagamento registrado: é derivado da reserva
 *    com convidado, no valor configurado.
 *  - Aula avulsa e Card Mensal: taxas que o aluno não-sócio paga ao clube para ter
 *    aulas. Contam pelo pagamento REGISTRADO no cadastro do aluno (`student_payments`);
 *    a aula em si não gera receita extra.
 *  - O professor é pago pelo próprio aluno, por hora/aula: isso não entra no
 *    financeiro do clube.
 *
 * A aba "Painel de alunos" é o relatório mensal de sempre (pagamentos de alunos e
 * isenção de convidados), alinhado a estas regras.
 */
import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { dayCardRows } from '../../../lib/finance/financeApi';
import { dayCardSpec } from '../../../lib/finance/export';
import { resolvePeriod, type Period } from '../../../lib/finance/reports';
import { brDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, ExportButtons, Notice, PeriodBar, Row, SectionTabs, Spinner } from '../ui';

const FinanceiroAdmin = lazy(() => import('../../FinanceiroAdmin').then((m) => ({ default: m.FinanceiroAdmin })));

const DayCardPanel: React.FC<{ period: Period }> = ({ period }) => {
  const { settings } = useFinance();
  const data = useAsync(() => dayCardRows(period.from, period.to), [period.from, period.to]);
  const rows = useMemo(() => data.data ?? [], [data.data]);
  const total = rows.reduce((s, r) => s + r.charged_cents, 0);
  const charged = rows.filter((r) => !r.exempt).length;

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Como cada taxa entra no financeiro">
        <ul className="list-disc space-y-1 pl-4">
          <li><b>Day Card</b>: taxa do convidado de um sócio, para ter acesso ao clube por um dia ({settings ? formatBRL(settings.day_card_price_cents) : 'valor configurado'} por convidado). É derivado da reserva com convidado — não há pagamento registrado — e conta no DRE pela data da reserva.</li>
          <li><b>Aula avulsa</b> e <b>Card Mensal</b>: taxas que o aluno não-sócio paga ao clube para ter aulas. Contam pelo <b>pagamento registrado</b> no cadastro do aluno (veja o “Painel de alunos”). A aula em si não gera receita a mais.</li>
          <li><b>Professor</b>: é pago pelo próprio aluno, por hora/aula. Isso não entra no financeiro do clube.</li>
        </ul>
      </Notice>

      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading ? <Spinner /> : (
        <Card title="Day Card dos convidados" subtitle={`${charged} cobrado(s) · ${rows.length - charged} isento(s) · total ${formatBRL(total)}`}
          right={<ExportButtons disabled={rows.length === 0} getSpec={() => dayCardSpec(rows, { period, generatedAt: new Date().toISOString() })} />}>
          {rows.length === 0 ? <Empty title="Nenhum convidado no período" hint="Aparece aqui toda reserva de amistoso com convidado." icon={<Users size={28} />} /> : (
            <ul className="space-y-2">
              {rows.slice(0, 300).map((r) => (
                <li key={r.reservation_id}>
                  <Row>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-stone-800">{r.guest_name}</p>
                        <p className="text-xs text-stone-500">{brDate(r.occurred_on)}{r.booked_by ? ` · reserva de ${r.booked_by}` : ''}</p>
                      </div>
                      <div className="text-right"><p className="text-sm font-black tabular-nums">{formatBRL(r.charged_cents)}</p><Badge tone={r.exempt ? 'muted' : 'warn'}>{r.exempt ? 'Isento' : 'Cobrado'}</Badge></div>
                    </div>
                  </Row>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 300 && <p className="mt-2 text-xs text-stone-400">Mostrando 300 de {rows.length}. A exportação leva todas as linhas.</p>}
          <p className="mt-3 text-[11px] text-stone-400">Para isentar ou voltar a cobrar um convidado, use o “Painel de alunos”.</p>
        </Card>
      )}
    </div>
  );
};

const StudentsTab: React.FC = () => {
  const today = useToday();
  const { settings } = useFinance();
  const [view, setView] = useState('daycard');
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-stone-600"><Users size={18} /><p className="text-sm font-bold">Alunos e Day Card</p></div>
      <SectionTabs label="Visão" value={view} onChange={setView} items={[{ id: 'daycard', label: 'Day Card (convidados)' }, { id: 'legacy', label: 'Painel de alunos' }]} />
      {view === 'daycard' && <Card title="Período"><PeriodBar value={period} onChange={setPeriod} today={today} presets={['month', 'prev_month', 'quarter', 'last_30', 'custom']} /></Card>}
      {view === 'daycard' && <DayCardPanel period={period} />}
      {view === 'legacy' && (
        <Suspense fallback={<Spinner />}>
          <FinanceiroAdmin dayCardPriceCents={settings?.day_card_price_cents} />
        </Suspense>
      )}
    </div>
  );
};

export default StudentsTab;
