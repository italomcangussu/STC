# Análise: Critérios de Desempate e Classificação

**Data da análise:** 2026-02-06  
**Campeonato:** 3º Circuito de Inverno  
**Sistema Atual:** Fase de Grupos + Mata-Mata (previsto)

---

## 🚨 PROBLEMAS CRÍTICOS IDENTIFICADOS

### 1. **Head-to-Head (H2H) NÃO IMPLEMENTADO** ⚠️

**Arquivo:** `lib/championshipUtils.ts` (linhas 232-238)

**Problema:**  
O critério de confronto direto (Head-to-Head) não está implementado. Existe apenas um comentário:
```typescript
// H2H would go here (complex to check in simple sort)
```

**Impacto:**  
- Se dois jogadores terminam com mesma pontuação, o sistema usa saldo de sets/games
- No tênis, o H2H é **fundamental** e deve vir **ANTES** dos saldos
- Exemplo: Se Jorge e Júlio empatam em 6 pontos, quem ganhou Jorge vs Júlio deve ficar à frente

**Ordem ATUAL (ERRADA):**
1. ✅ Pontos
2. ⚠️ Vitórias (redundante em sistema de 3pts por vitória)
3. ❌ Saldo de Sets (deveria ser H2H aqui)
4. ❌ Saldo de Games

**Ordem CORRETA (Padrão ITF/ATP):**
1. ✅ Pontos
2. ❌ **Head-to-Head (H2H)** ← FALTANDO
3. ✅ Saldo de Sets
4. ✅ Saldo de Games
5. ⏺️ Sorteio (se persistir empate)

---

### 2. **Classificação para Mata-Mata NÃO DEFINIDA** 🔍

**Problema:**  
Não há código que:
- Define quantos jogadores passam por grupo (assumindo 1º e 2º?)
- Cria automaticamente as partidas de semifinal/final
- Organiza o chaveamento do mata-mata baseado na classificação dos grupos

**Evidências:**
- `ChampionshipInProgress.tsx` só gerencia partidas da fase de grupos
- Não há trigger automático para gerar semifinais quando grupos terminam
- Não há visualização de "quem está classificado"

**Perguntas não respondidas pelo código:**
- Quantos classificam por grupo? (Top 1? Top 2?)
- Como será o chaveamento? (1º Grupo A vs 2º Grupo B?)
- Quando as semifinais são criadas? (Manual? Automático?)

---

## 💡 RECOMENDAÇÕES DE CORREÇÃO

### Correção 1: Implementar Head-to-Head

**Arquivo:** `lib/championshipUtils.ts`

```typescript
export function calculateGroupStandings(
    registrations: ChampionshipRegistration[],
    matches: Match[]
): InternalStanding[] {
    // ... código existente ...

    // Função auxiliar para calcular H2H
    const getH2HWins = (regId: string, opponentRegId: string): number => {
        const h2hMatches = matches.filter(m =>
            m.status === 'finished' &&
            ((m.registration_a_id === regId && m.registration_b_id === opponentRegId) ||
             (m.registration_a_id === opponentRegId && m.registration_b_id === regId))
        );

        return h2hMatches.filter(m => {
            if (m.registration_a_id === regId) {
                // Jogador é A - conta sets
                const setsA = m.scoreA.filter((s, i) => s > m.scoreB[i]).length;
                const setsB = m.scoreB.filter((s, i) => s > m.scoreA[i]).length;
                return setsA > setsB;
            } else {
                // Jogador é B
                const setsA = m.scoreA.filter((s, i) => s > m.scoreB[i]).length;
                const setsB = m.scoreB.filter((s, i) => s > m.scoreA[i]).length;
                return setsB > setsA;
            }
        }).length;
    };

    return Object.values(standings).sort((a, b) => {
        // 1º: Pontos
        if (b.points !== a.points) return b.points - a.points;

        // 2º: Head-to-Head (se jogaram entre si)
        const h2hA = getH2HWins(a.userId, b.userId);
        const h2hB = getH2HWins(b.userId, a.userId);
        if (h2hA !== h2hB) return h2hB - h2hA;

        // 3º: Saldo de Sets
        const setsDiffA = a.setsWon - a.setsLost;
        const setsDiffB = b.setsWon - b.setsLost;
        if (setsDiffB !== setsDiffA) return setsDiffB - setsDiffA;

        // 4º: Saldo de Games
        const gamesDiffA = a.gamesWon - a.gamesLost;
        const gamesDiffB = b.gamesWon - b.gamesLost;
        return gamesDiffB - gamesDiffA;
    });
}
```

### Correção 2: Adicionar Indicador de Classificação

**No componente de classificação (`GroupStandingsCard.tsx` ou similar):**

```tsx
{standings.map((s, idx) => {
    const isQualified = idx < 2; // 2 primeiros se classificam
    return (
        <div className={`... ${isQualified ? 'border-green-500 bg-green-50' : ''}`}>
            {isQualified && (
                <span className="text-xs bg-green-600 text-white px-2 py-1 rounded-full">
                    CLASSIFICADO
                </span>
            )}
            {/* resto do card */}
        </div>
    );
})}
```

### Correção 3: Criar Sistema de Geração de Mata-Mata

**Adicionar ao `ChampionshipInProgress.tsx`:**

```typescript
const handleGeneratePlayoffs = async () => {
    // 1. Verificar se todas as partidas de grupo foram finalizadas
    const allGroupMatchesFinished = matches
        .filter(m => rounds.slice(0, 3).map(r => r.id).includes(m.round_id))
        .every(m => m.status === 'finished');

    if (!allGroupMatchesFinished) {
        alert('Todas as partidas da fase de grupos devem ser finalizadas primeiro.');
        return;
    }

    // 2. Calcular classificação de cada grupo
    const groupStandings = groups.map(group => {
        const groupMatches = matches.filter(m => m.championship_group_id === group.id);
        const groupRegs = registrations.filter(r => 
            group.members.map((m: any) => m.registration_id).includes(r.id)
        );
        return {
            groupId: group.id,
            groupName: group.category + ' - Grupo ' + group.group_name,
            standings: calculateGroupStandings(groupRegs, groupMatches)
        };
    });

    // 3. Pegar top 2 de cada grupo
    const qualifiedPlayers = groupStandings.flatMap(g => 
        g.standings.slice(0, 2).map((s, idx) => ({
            registrationId: s.userId,
            groupName: g.groupName,
            position: idx + 1 // 1º ou 2º
        }))
    );

    // 4. Criar chaveamento (1º A vs 2º B, 1º B vs 2º A)
    // ... lógica de criação de semifinais
};
```

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

- [ ] Implementar função `getH2HWins` em `championshipUtils.ts`
- [ ] Atualizar `calculateGroupStandings` com H2H como 2º critério
- [ ] Adicionar indicador visual de "CLASSIFICADO" nos standings
- [ ] Criar função `handleGeneratePlayoffs` para gerar mata-mata
- [ ] Adicionar botão "Gerar Mata-Mata" (admin only, após grupos finalizados)
- [ ] Testar critérios de desempate com dados reais
- [ ] Documentar regras de classificação no README

---

## 🧪 CASO DE TESTE

**Cenário:** 4 jogadores no grupo, todos terminam com 6 pontos (2V-1D cada)

| Jogador | Pontos | V-D | H2H vs Jorge | Saldo Sets |
|---------|--------|-----|--------------|------------|
| Jorge   | 6      | 2-1 | -            | +2         |
| Júlio   | 6      | 2-1 | Perdeu       | +3         |
| Moacyr  | 6      | 2-1 | Ganhou       | +1         |
| Bruninho| 6      | 2-1 | Perdeu       | +2         |

**Sistema ATUAL (errado):**
1. Júlio (melhor saldo +3)
2. Jorge ou Bruninho (empate +2, vai para games)

**Sistema CORRETO (com H2H):**
1. Moacyr (ganhou de Jorge no H2H)
2. Jorge (ganhou de Júlio no H2H)
3. Júlio (perdeu de Jorge, mas melhor saldo)
4. Bruninho (perdeu de Jorge e pior saldo)

---

**Próximos Passos:**
1. Aplicar correção do H2H
2. Definir regras de classificação (quantos passam)
3. Implementar geração automática de mata-mata
