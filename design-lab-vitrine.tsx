/**
 * Vitrine dos primitivos (laboratório, fora do build). Cada peça em todos os
 * estados, para olhar e medir com `capturar --rotas '#vitrine'`.
 * Todo texto aqui é de DEMONSTRAÇÃO.
 */
import React from 'react';
import { CalendarPlus, Plus, Search, Trash2, Trophy } from 'lucide-react';
import { Button, Card, Chip, EmptyState, Field, IconButton, Input, ListRow, Segmented, Select, Sheet, StatusPill, Textarea, notify } from './components/ui';

const Secao: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
    <section className="space-y-3">
        <h2 className="text-meta uppercase tracking-wider text-texto-3">{titulo}</h2>
        {children}
    </section>
);

export const Vitrine: React.FC = () => {
    const [visao, setVisao] = React.useState<'dia' | 'semana' | 'mes'>('dia');
    const [filtro, setFiltro] = React.useState('todos');
    const [folha, setFolha] = React.useState(false);
    const [carregando, setCarregando] = React.useState(false);

    return (
        <main className="mx-auto max-w-lg space-y-8 bg-chao px-4 py-6 text-texto">
            <header>
                <h1 className="text-2xl font-extrabold">Vitrine · Quadra</h1>
                <p className="text-sm text-texto-2">Primitivos do sistema, em todos os estados. Dados de demonstração.</p>
            </header>

            <Secao titulo="Botão">
                <div className="flex flex-wrap gap-2">
                    <Button icon={<CalendarPlus size={18} />}>Reservar</Button>
                    <Button variant="secundaria">Ver horários</Button>
                    <Button variant="fantasma">Agora não</Button>
                    <Button variant="destrutiva" icon={<Trash2 size={18} />}>Excluir</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        loading={carregando}
                        onClick={() => {
                            setCarregando(true);
                            setTimeout(() => setCarregando(false), 1500);
                        }}
                    >
                        Enviar comprovante
                    </Button>
                    <Button disabled>Desabilitado</Button>
                    <Button size="lg" block>Confirmar reserva</Button>
                </div>
                <div className="flex gap-1">
                    <IconButton aria-label="Buscar"><Search size={20} /></IconButton>
                    <IconButton aria-label="Novo" tom="acao"><Plus size={20} /></IconButton>
                    <IconButton aria-label="Excluir" tom="erro"><Trash2 size={20} /></IconButton>
                </div>
            </Secao>

            <Secao titulo="Campo">
                <Field label="Nome" hint="Como aparece no ranking">
                    <Input defaultValue="Ana Demo" autoComplete="name" />
                </Field>
                <Field label="Telefone" error="Faltou o DDD: (88) 99999-0000">
                    <Input inputMode="tel" defaultValue="99999-0000" />
                </Field>
                <Field label="Quadra">
                    <Select defaultValue="1"><option value="1">Quadra 1 · Saibro</option><option value="2">Quadra 2 · Saibro</option></Select>
                </Field>
                <Field label="Observação" optional>
                    <Textarea placeholder="Ex.: levo as bolas" />
                </Field>
                <Field label="Desabilitado">
                    <Input disabled defaultValue="Não editável" />
                </Field>
            </Secao>

            <Secao titulo="Escolha">
                <Segmented<"dia" | "semana" | "mes">
                    label="Visão da agenda"
                    value={visao}
                    onChange={setVisao}
                    options={[{ value: 'dia', label: 'Dia' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mês' }]}
                />
                <div className="faixa-rolavel -mx-4 px-4">
                    {['todos', 'play', 'aula', 'desafio', 'campeonato', 'day use'].map(f => (
                        <Chip key={f} selected={filtro === f} onClick={() => setFiltro(f)}>{f[0].toUpperCase() + f.slice(1)}</Chip>
                    ))}
                </div>
            </Secao>

            <Secao titulo="Selo">
                <div className="flex flex-wrap gap-2">
                    <StatusPill tone="good">Pago</StatusPill>
                    <StatusPill tone="warn">Pendente</StatusPill>
                    <StatusPill tone="bad">Vencido</StatusPill>
                    <StatusPill tone="info">Agendado</StatusPill>
                    <StatusPill tone="muted">Finalizada</StatusPill>
                </div>
            </Secao>

            <Secao titulo="Card e lista">
                <Card>
                    <p className="text-meta text-texto-3">HOJE · 18:00</p>
                    <p className="text-lg font-bold">Quadra 1 · Desafio</p>
                    <p className="text-sm text-texto-2">Diego Demo × Elisa Demo</p>
                </Card>
                <Card as="button" onClick={() => notify.info('Card tocado')}>
                    <p className="font-semibold">Card clicável</p>
                    <p className="text-sm text-texto-2">É um botão: foco, teclado e resposta ao toque.</p>
                </Card>
                <Card padding="none" className="divide-y divide-linha overflow-hidden">
                    <ListRow leading={<Trophy size={20} className="text-acao" />} title="Diego Demo" meta="4ª classe · 9 jogos" value="87" onClick={() => {}} destaque />
                    <ListRow title="Heitor Demo" meta="4ª classe · 9 jogos" value="43" onClick={() => {}} />
                    <ListRow title="Gabriela Demo Nome Bem Comprido da Silva" meta="Nome longo corta com reticências" value="1.250" />
                </Card>
            </Secao>

            <Secao titulo="Vazios">
                <EmptyState kind="primeira-vez" title="Você ainda não tem reservas" hint="Escolha um horário livre na agenda." action={<Button>Reservar quadra</Button>} />
                <EmptyState kind="tudo-feito" title="Nenhum desafio pendente" hint="Quando alguém te desafiar, aparece aqui." />
                <EmptyState kind="sem-resultado" title="Nenhum sócio com “xyz”" action={<Button variant="secundaria">Limpar busca</Button>} />
                <EmptyState kind="sem-permissao" title="Só a diretoria vê este relatório" hint="Fale com a secretaria do clube." />
                <EmptyState kind="erro" title="Não deu para carregar a agenda" hint="Sem conexão. Confira a internet." action={<Button variant="secundaria">Tentar de novo</Button>} />
            </Secao>

            <Secao titulo="Resposta">
                <div className="flex flex-wrap gap-2">
                    <Button variant="secundaria" onClick={() => notify.feito('Reserva cancelada', { descricao: 'Quadra 2 · hoje 18h', desfazer: () => notify.info('Reserva de volta') })}>
                        Feito + desfazer
                    </Button>
                    <Button variant="secundaria" onClick={() => notify.failure(new Error('timeout'), 'Não foi possível salvar.')}>Erro</Button>
                    <Button variant="secundaria" onClick={() => setFolha(true)}>Abrir folha</Button>
                </div>
            </Secao>

            <Sheet
                open={folha}
                onClose={() => setFolha(false)}
                title="Nova reserva"
                subtitle="Quadra 1 · hoje"
                footer={<><Button variant="fantasma" onClick={() => setFolha(false)}>Cancelar</Button><Button onClick={() => setFolha(false)}>Reservar</Button></>}
            >
                <Field label="Horário"><Select><option>18:00 – 19:00</option></Select></Field>
                <Field label="Parceiro"><Input placeholder="Nome do sócio" /></Field>
            </Sheet>
        </main>
    );
};
