import { describe, expect, it } from 'vitest';
import { athleteFirstNames, championshipGroupRules, groupChampionshipText, scrubGroupContext } from '../../supabase/functions/_shared/aiAgent/groupChampionship';
import { systemPrompt, userPrompt, type AiSettings, type Ctx } from '../../supabase/functions/_shared/aiAgent/prompts';

const serra: Ctx = {
  name: 'Serra e Sertão 2026', title: ['AUGE OPEN', '3ª Etapa'], total: 3, socios: 1,
  classes: [
    { class: '4ª Classe', athletes: [{ name: 'Carlos Carneiro', socio: true, city: null }, { name: 'Bruno Farias', socio: false, city: 'Tianguá' }] },
    { class: '5ª Classe', athletes: [{ name: 'Maria Eduarda', socio: false, city: null }] },
  ],
};

const champPack = () => ({
  requester_phone: '88999990000', pix_key: 'pix', payee: 'STC',
  championships: [{ name: 'Serra e Sertão 2026', admin: { registered: [{ name: 'Fulano', pay: 'panel' }] },
    mine: [{ full_name: 'Bruno Farias', phone: '88999990000', status: 'confirmed' }] }],
});

describe('João no grupo do campeonato', () => {
  it('conhece a turma por classe, marcando sócio e convidado com a cidade', () => {
    const t = groupChampionshipText({ group_championship: serra });
    expect(t).toContain('3 inscritos: 1 sócios do STC e 2 convidados');
    expect(t).toContain('- Carlos Carneiro (sócio do STC)');
    expect(t).toContain('- Bruno Farias (convidado, de Tianguá)');
    expect(t).toContain('- Maria Eduarda (convidado)');
  });

  it('fora de grupo de campeonato não muda nada', () => {
    expect(groupChampionshipText({})).toBe('');
    expect(championshipGroupRules({ is_group: true })).toBe('');
  });

  it('no grupo, tira do turno os dados de administrador e os telefones; no do campeonato, também o financeiro', () => {
    const ctx: Ctx = { is_group: true, group_championship: serra, championship: champPack(),
      financial_context: { students: [{ name: 'Aluno' }], day_cards: [], member_pendencies: [{ name: 'Sócio' }] } };
    scrubGroupContext(ctx);
    const c = (ctx.championship as Ctx).championships[0] as Ctx;
    expect(c.admin).toBeNull();
    expect((c.mine as Ctx[])[0].phone).toBeNull();
    expect((ctx.championship as Ctx).requester_phone).toBeNull();
    expect(ctx.financial_context).toEqual({ students: [], day_cards: [], member_pendencies: [] });
  });

  it('no grupo de sócios mantém o financeiro (regra da casa) e no privado não mexe em nada', () => {
    const socios: Ctx = { is_group: true, championship: champPack(), financial_context: { students: [{ name: 'A' }] } };
    scrubGroupContext(socios);
    expect(socios.financial_context).toEqual({ students: [{ name: 'A' }] });
    const privado: Ctx = { is_group: false, championship: champPack() };
    scrubGroupContext(privado);
    expect(((privado.championship as Ctx).championships[0] as Ctx).admin).not.toBeNull();
  });

  it('o prompt do grupo do campeonato troca a regra do grupo de sócios e proíbe financeiro', () => {
    const ctx: Ctx = { is_group: true, group_championship: serra, requester: { profile: { name: 'Bruno' } } };
    const sys = systemPrompt({ persona_name: 'João Fonseca' } as AiSettings, ctx);
    expect(sys).toContain('ESTA CONVERSA É O GRUPO DO CAMPEONATO "Serra e Sertão 2026"');
    expect(sys).toContain('NADA de financeiro aqui');
    expect(sys).not.toContain('STATUS DE ALUNOS/CARDS, DAY CARDS DE CONVIDADOS e PENDÊNCIAS DE SÓCIO recebidos do sistema são contexto autorizado');
    expect(sys).toContain('Fonsequinha');
  });

  it('o prompt do turno leva a lista de inscritos', () => {
    const ctx: Ctx = { is_group: true, group_championship: serra, settings: {}, now_local: '2026-10-30T14:00', weekday_today: 5 };
    expect(userPrompt(ctx, {}, 'kkkk')).toContain('# INSCRITOS DESTE CAMPEONATO');
  });

  it('primeiros nomes dos inscritos, sem repetir', () => {
    expect(athleteFirstNames(serra)).toEqual(['Carlos', 'Bruno', 'Maria']);
    expect(athleteFirstNames(null)).toEqual([]);
  });
});

describe('ranking do circuito no grupo do campeonato (Hermeson, 30/10: "quem é melhor, Bruno ou Tiago?")', () => {
  const circuito: Ctx = { ...serra, circuit_ranking: {
    title: 'Ranking oficial', stages: ['Sobral', 'Finals', 'Nova Russas', 'Tianguá'], clubs: ['Sobral (STC)', 'Tianguá', 'Nova Russas', 'Crateús', 'Boa Viagem'],
    classes: [{ class: '4ª Classe', rows: [
      { pos: 8, name: 'Bruno', total: 400, stages: { Sobral: 100, Finals: 200, 'Nova Russas': 100 } },
      { pos: 14, name: 'Tiago', total: 200, stages: { Sobral: 200 } }] }] } };
  const stcBruno = { name: 'Bruno Sócio do STC', aliases: ['bruno'], global_position: 9, category_position: 9, category: '4ª', points: 50, social_context: 'o do saque torto' };
  const ctx = (): Ctx => ({ is_group: true, group_championship: circuito, group_members: ['Hermeson Veras'], club_roster: [stcBruno],
    requester: { profile: { name: 'Hermeson Veras' } }, settings: {}, now_local: '2026-10-30T14:11', weekday_today: 5 });

  it('o turno leva o ranking do circuito com os pontos por etapa e os clubes', () => {
    const t = userPrompt(ctx(), {}, 'Quem é melhor Bruno ou Tiago?');
    expect(t).toContain('# RANKING DO CIRCUITO SERRA & SERTÃO');
    expect(t).toContain('8. Bruno — 400 pts (Sobral 100, Finals 200, Nova Russas 100)');
    expect(t).toContain('14. Tiago — 200 pts (Sobral 200)');
    expect(t).toContain('Crateús');
  });

  it('o ranking interno do STC e o sócio homônimo citado no papo ficam de fora', () => {
    const t = userPrompt(ctx(), {}, 'Quem é melhor Bruno ou Tiago?');
    expect(t).not.toContain('# RANKING DO CLUBE');
    expect(t).not.toContain('Bruno Sócio do STC');
  });

  it('no grupo de sócios continua tudo como antes', () => {
    const socios = { ...ctx(), group_championship: null };
    const t = userPrompt(socios, {}, 'Quem é melhor Bruno ou Tiago?');
    expect(t).toContain('# RANKING DO CLUBE');
    expect(t).toContain('Bruno Sócio do STC');
  });

  it('a regra ensina a perguntar "qual Bruno?" em vez de chutar', () => {
    const sys = systemPrompt({ persona_name: 'João Fonseca' } as AiSettings, ctx());
    expect(sys).toContain('nunca o sócio do STC com o mesmo nome');
    expect(sys).toContain('qual Bruno');
  });
});
