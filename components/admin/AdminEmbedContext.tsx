import React, { createContext, useContext } from 'react';

/**
 * Diz às telas se estão dentro do Painel Admin.
 *
 * O painel já mostra o título e a explicação da seção no topo. Sem este aviso,
 * cada tela repete o seu próprio título logo abaixo (e com um estilo diferente
 * em cada uma). Embutida, a tela omite o título e mantém só as ações; solta
 * (rota própria), continua se apresentando sozinha.
 */
const AdminEmbedContext = createContext(false);

export const AdminEmbedProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <AdminEmbedContext.Provider value>{children}</AdminEmbedContext.Provider>
);

// eslint-disable-next-line react-refresh/only-export-components
export const useAdminEmbedded = (): boolean => useContext(AdminEmbedContext);
