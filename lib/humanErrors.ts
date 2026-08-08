/**
 * Tradução de erros técnicos para mensagens que o admin consegue agir em cima.
 *
 * A regra é a mesma dos três livros: **causa + correção, nunca culpa**.
 * `'Erro ao salvar: duplicate key value violates unique constraint'` diz ao
 * usuário que ele errou, sem dizer no quê nem o que fazer. Aqui a mesma falha
 * vira `'Este atleta já está inscrito nesta classe.'` + `'Remova a inscrição
 * anterior antes de inscrevê-lo de novo.'`
 *
 * Complementa — não substitui — o `errorMessage()` de `logger.ts`:
 * - `errorMessage(e)` → texto cru, para o **log**. Precisa ser fiel.
 * - `humanizeError(e)` → causa + correção, para a **tela**. Precisa ser útil.
 *
 * Sempre logue o cru e mostre o humano; nunca troque um pelo outro.
 */

export interface HumanError {
    /** O que aconteceu, sem jargão. Vira o título do toast. */
    message: string;
    /** O que fazer a respeito. Vira a descrição do toast. */
    hint?: string;
}

/**
 * Códigos do Postgres que a UI de campeonatos realmente encontra.
 * Referência: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const POSTGRES_ERRORS: Record<string, HumanError> = {
    // unique_violation
    '23505': {
        message: 'Este registro já existe.',
        hint: 'Verifique se o atleta ou confronto já não foi cadastrado antes.',
    },
    // foreign_key_violation
    '23503': {
        message: 'Este item depende de outro que não existe mais.',
        hint: 'Atualize a página — algo pode ter sido removido em outra aba.',
    },
    // not_null_violation
    '23502': {
        message: 'Faltou preencher um campo obrigatório.',
        hint: 'Confira se todos os campos marcados foram preenchidos.',
    },
    // check_violation
    '23514': {
        message: 'Algum valor informado não é aceito pelo sistema.',
        hint: 'Confira as opções selecionadas e tente de novo.',
    },
    // insufficient_privilege — na prática, RLS barrando a operação
    '42501': {
        message: 'Você não tem permissão para esta ação.',
        hint: 'Se acredita que deveria ter, peça a um administrador para revisar seu acesso.',
    },
    // undefined_table / undefined_column — deploy fora de sincronia com o banco
    '42P01': {
        message: 'O sistema está fora de sincronia com o banco de dados.',
        hint: 'Recarregue a página. Se persistir, avise o suporte técnico.',
    },
    '42703': {
        message: 'O sistema está fora de sincronia com o banco de dados.',
        hint: 'Recarregue a página. Se persistir, avise o suporte técnico.',
    },
};

/** Códigos do PostgREST (camada HTTP do Supabase). */
const POSTGREST_ERRORS: Record<string, HumanError> = {
    // Nenhuma linha retornada em .single()
    PGRST116: {
        message: 'Registro não encontrado.',
        hint: 'Ele pode ter sido removido. Atualize a página.',
    },
    // JWT expirado ou inválido
    PGRST301: {
        message: 'Sua sessão expirou.',
        hint: 'Entre novamente para continuar.',
    },
};

/** Um objeto de erro solto pode ou não carregar `code`. */
function errorCode(error: unknown): string | null {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code: unknown }).code;
        if (typeof code === 'string') return code;
        if (typeof code === 'number') return String(code);
    }
    return null;
}

function rawText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

/**
 * Falha de rede não tem `code` — só dá para reconhecer pelo texto que o
 * runtime produz (`fetch` do browser, `AbortError` de timeout).
 */
function isNetworkFailure(error: unknown): boolean {
    const text = rawText(error).toLowerCase();
    return text.includes('failed to fetch')
        || text.includes('networkerror')
        || text.includes('network request failed')
        || text.includes('load failed')
        || text.includes('aborted');
}

/**
 * Converte qualquer erro em algo que o admin consegue ler e resolver.
 *
 * @param error   O erro cru (Error, PostgrestError, string, o que vier).
 * @param fallback Mensagem quando o erro não é reconhecido. Passe uma que diga
 *                 *o que* falhou — 'Não foi possível salvar o placar.' é muito
 *                 melhor que o genérico, porque a tela sozinha não conta isso.
 */
export function humanizeError(
    error: unknown,
    fallback = 'Não foi possível concluir a operação.'
): HumanError {
    if (isNetworkFailure(error)) {
        return {
            message: 'Sem conexão com o servidor.',
            hint: 'Verifique sua internet e tente de novo — nada foi salvo.',
        };
    }

    const code = errorCode(error);
    if (code) {
        const known = POSTGRES_ERRORS[code] ?? POSTGREST_ERRORS[code];
        if (known) return known;
    }

    // Erro desconhecido: o texto cru quase nunca ajuda o admin, então ele vai
    // para a dica (onde serve de pista para o suporte) e o título fica com o
    // fallback, que ao menos diz qual operação falhou.
    const raw = rawText(error).trim();
    return {
        message: fallback,
        hint: raw && raw !== 'undefined' && raw !== 'null' ? raw : undefined,
    };
}

/**
 * Erros de negócio que a própria tela detecta antes de chamar o banco.
 * Ficam aqui para que o texto mostrado seja consistente entre as telas que
 * checam a mesma regra (o Criador e o Admin validam inscrição nos dois lugares).
 */
export const CHAMPIONSHIP_ERRORS = {
    semVencedor: {
        message: 'Não foi possível identificar o vencedor.',
        hint: 'Confira se os dois atletas do confronto estão definidos.',
    },
    empateNoMataMata: {
        message: 'Empate técnico não vale no mata-mata.',
        hint: 'O mata-mata precisa de um vencedor para montar a próxima fase. Use W.O. se ninguém jogou.',
    },
    semSocioSelecionado: {
        message: 'Selecione um sócio para inscrever.',
        hint: 'Use a busca acima para encontrá-lo pelo nome.',
    },
    semNomeConvidado: {
        message: 'Informe o nome do convidado.',
        hint: 'O nome aparece na chave e na tabela de jogos.',
    },
    semSerie: {
        message: 'Este campeonato não está vinculado a nenhuma série.',
        hint: 'Vincule-o a uma série antes de aplicar os pontos ao ranking.',
    },
    semCabecasDeChave: {
        message: 'Defina os cabeças de chave dos dois grupos.',
        hint: 'Cada grupo precisa de um cabeça antes do sorteio.',
    },
    jogadoresSemGrupo: {
        message: 'Há jogadores sem grupo.',
        hint: 'Todo jogador precisa estar em um grupo antes de salvar.',
    },
} satisfies Record<string, HumanError>;
