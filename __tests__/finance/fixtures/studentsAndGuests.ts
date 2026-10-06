/**
 * Fixture ÚNICA de agosto/2026 — alunos não-sócios, aulas, convidados e pagamentos —,
 * compartilhada por:
 *  - o teste do painel de alunos (`FinanceiroAdmin`);
 *  - os testes SQL de Day Card e de DRE (o banco tem de chegar nos mesmos números).
 *
 * Vocabulário (correto): Day Card = taxa do CONVIDADO de um sócio (nada a ver com aula);
 * Aula avulsa e Card Mensal = taxas que o aluno não-sócio paga ao clube para ter aulas
 * (no app, o plano "Day Card" do aluno é a Aula avulsa). Professor é pago pelo aluno.
 * Tudo aqui é dado de TESTE.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const FX = {
  month: '2026-08',
  dayCardPriceCents: 5000,
  prof: { p1: id(501), p2: id(502) },
  students: {
    dayCard: id(601), cardMensal: id(602), dependent: id(603), experimental: id(604),
  },
  socio: id(2), // Ana Sócia (mesmo ID do harness)
  reservations: {
    aulaDoisAlunos: id(701), aulaDependente: id(702), aulaLegado: id(703), aulaSocio: id(704), amistosoConvidado: id(705),
    amistosoIsento: id(706), aulaCancelada: id(707), aulaIsenta: id(708), aulaParticipantsLegado: id(709), amistosoComum: id(710),
  },
  payments: { cardMensal: id(801), dayCard: id(802), experimentalCancelado: id(803), cardMensalExperimental: id(804) },
};

export interface FxReservation {
  id: string; type: 'Aula' | 'Play'; date: string; status: 'active' | 'cancelled'; professor_id: string | null;
  participant_ids: string[]; non_socio_student_ids: string[] | null; non_socio_student_id: string | null;
  student_type: 'socio' | 'non-socio' | null; guest_name: string | null; payment_status: 'paid' | 'pending' | 'exempt';
}

const R = FX.reservations;
const S = FX.students;
const base = { participant_ids: [] as string[], non_socio_student_ids: null as string[] | null, non_socio_student_id: null as string | null,
  student_type: null as 'socio' | 'non-socio' | null, guest_name: null as string | null, payment_status: 'paid' as const, status: 'active' as const };

export const fxReservations: FxReservation[] = [
  { ...base, id: R.aulaDoisAlunos, type: 'Aula', date: '2026-08-03', professor_id: FX.prof.p1, student_type: 'non-socio', non_socio_student_ids: [S.dayCard, S.cardMensal] },
  { ...base, id: R.aulaDependente, type: 'Aula', date: '2026-08-04', professor_id: FX.prof.p1, student_type: 'non-socio', non_socio_student_ids: [S.dependent] },
  { ...base, id: R.aulaLegado, type: 'Aula', date: '2026-08-05', professor_id: FX.prof.p1, student_type: 'non-socio', non_socio_student_id: S.experimental },
  { ...base, id: R.aulaSocio, type: 'Aula', date: '2026-08-06', professor_id: FX.prof.p2, student_type: 'socio', participant_ids: [FX.socio] },
  { ...base, id: R.amistosoConvidado, type: 'Play', date: '2026-08-07', professor_id: null, guest_name: 'Convidado Fulano' },
  { ...base, id: R.amistosoIsento, type: 'Play', date: '2026-08-08', professor_id: null, guest_name: 'Convidado Isento', payment_status: 'exempt' },
  { ...base, id: R.aulaCancelada, type: 'Aula', date: '2026-08-09', professor_id: FX.prof.p1, status: 'cancelled', student_type: 'non-socio', non_socio_student_ids: [S.dayCard] },
  { ...base, id: R.aulaIsenta, type: 'Aula', date: '2026-08-10', professor_id: FX.prof.p2, student_type: 'non-socio', non_socio_student_ids: [S.dayCard], payment_status: 'exempt' },
  { ...base, id: R.aulaParticipantsLegado, type: 'Aula', date: '2026-08-11', professor_id: FX.prof.p2, student_type: 'non-socio', participant_ids: [S.dayCard] },
  { ...base, id: R.amistosoComum, type: 'Play', date: '2026-08-12', professor_id: null },
];

export interface FxStudent { id: string; name: string; plan_type: string; plan_status: 'active' | 'inactive'; student_type: 'regular' | 'dependent'; master_expiration_date: string | null }
export const fxStudents: FxStudent[] = [
  { id: S.dayCard, name: 'Aluno Day Card', plan_type: 'Day Card', plan_status: 'active', student_type: 'regular', master_expiration_date: null },
  { id: S.cardMensal, name: 'Aluno Card Mensal', plan_type: 'Card Mensal', plan_status: 'active', student_type: 'regular', master_expiration_date: '2026-09-30' },
  { id: S.dependent, name: 'Filho Dependente', plan_type: 'Dependente', plan_status: 'active', student_type: 'dependent', master_expiration_date: null },
  { id: S.experimental, name: 'Aluno Experimental', plan_type: 'Day Card Experimental', plan_status: 'active', student_type: 'regular', master_expiration_date: null },
];

export interface FxPayment { id: string; student_id: string; amount: number; payment_date: string; valid_until: string; status: 'active' | 'cancelled'; cancelled_reason: string | null }
const P = FX.payments;
export const fxPayments: FxPayment[] = [
  { id: P.cardMensal, student_id: S.cardMensal, amount: 200, payment_date: '2026-08-02T15:00:00Z', valid_until: '2026-09-02T15:00:00Z', status: 'active', cancelled_reason: null },
  { id: P.dayCard, student_id: S.dayCard, amount: 50, payment_date: '2026-08-03T15:00:00Z', valid_until: '2026-08-04T02:59:59Z', status: 'active', cancelled_reason: null },
  { id: P.experimentalCancelado, student_id: S.experimental, amount: 50, payment_date: '2026-08-05T15:00:00Z', valid_until: '2026-08-06T02:59:59Z', status: 'cancelled', cancelled_reason: 'Convertido para Card Mensal' },
  { id: P.cardMensalExperimental, student_id: S.experimental, amount: 200, payment_date: '2026-08-20T15:00:00Z', valid_until: '2026-09-20T15:00:00Z', status: 'active', cancelled_reason: null },
];

/**
 * Receita de agosto/2026 pela regra do clube: Day Card só do convidado (derivado da reserva);
 * Aula avulsa e Card Mensal só pelo pagamento registrado. As 6 participações de alunos em aula
 * NÃO somam nada por conta própria (antes o painel contava R$ 50 por aula de aluno, em cima do pagamento).
 */
export const EXPECTED = {
  dayCardCount: 1, // "Convidado Fulano" (o isento fica de fora; o amistoso comum não tem convidado)
  dayCardTotal: 5000,
  cardMensalTotal: 40000, // 200 + 200
  aulaAvulsaTotal: 5000, // 1 pagamento de R$ 50 (o experimental cancelado fica de fora)
  activePaymentsTotal: 45000, // 200 + 50 + 200
  cancelledPaymentsTotal: 5000,
  grandTotal: 50000,
};

const sqlArr = (a: string[] | null) => (a === null ? 'null' : `array[${a.map((x) => `'${x}'`).join(',')}]::uuid[]`);
const q = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);

/** SQL de inserção da fixture no banco de teste (professores + alunos + reservas + pagamentos). */
export function fixtureSql(profUsers: { p1: string; p2: string }): string {
  // `replica` desliga os gatilhos só durante a carga: a linha legada (participant_ids com id de aluno)
  // não passa pelo gatilho de auditoria genérico do STC, que espera sócios ali.
  return `
    set session_replication_role = replica;
    insert into public.professors(id, user_id, name) values ('${FX.prof.p1}', '${profUsers.p1}', 'Paulo Professor'), ('${FX.prof.p2}', '${profUsers.p2}', 'Olga Professora');
    insert into public.non_socio_students(id, name, plan_type, plan_status, student_type, master_expiration_date, professor_id) values
      ${fxStudents.map((s) => `('${s.id}', ${q(s.name)}, ${q(s.plan_type)}, '${s.plan_status}', '${s.student_type}', ${q(s.master_expiration_date)}, '${FX.prof.p1}')`).join(',\n      ')};
    insert into public.reservations(id, type, date, status, professor_id, participant_ids, non_socio_student_ids, non_socio_student_id, student_type, guest_name, payment_status) values
      ${fxReservations.map((r) => `('${r.id}', '${r.type}', '${r.date}', '${r.status}', ${q(r.professor_id)}, ${sqlArr(r.participant_ids)}, ${sqlArr(r.non_socio_student_ids)}, ${q(r.non_socio_student_id)}, ${q(r.student_type)}, ${q(r.guest_name)}, '${r.payment_status}')`).join(',\n      ')};
    insert into public.student_payments(id, student_id, amount, payment_date, valid_until, status, cancelled_reason) values
      ${fxPayments.map((p) => `('${p.id}', '${p.student_id}', ${p.amount}, '${p.payment_date}', '${p.valid_until}', '${p.status}', ${q(p.cancelled_reason)})`).join(',\n      ')};
    reset session_replication_role;
  `;
}
