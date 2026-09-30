import React, { useState, useEffect, useCallback } from 'react';
import {
  Vote, CheckCircle2, Lock, Users, BarChart3,
  Loader2, AlertCircle, ArrowLeft, RefreshCw,
  Radio, CheckSquare, MessageSquare, ShieldCheck,
  ChevronRight, LogIn
} from 'lucide-react';
import { formsService } from '../lib/formsService';
import { ClubForm, FormLiveResults, FormAnswerItem } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../lib/notifications';
import { Auth } from './Auth';

interface PublicFormPageProps {
  slug: string;
  onBackToApp?: () => void;
}

export const PublicFormPage: React.FC<PublicFormPageProps> = ({ slug, onBackToApp }) => {
  const { currentUser, loading: authLoading } = useAuth();
  const [form, setForm] = useState<ClubForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Status de Voto
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [checkingReceipt, setCheckingReceipt] = useState(false);

  // Respostas selecionadas pelo usuário: chave = question_id
  const [answers, setAnswers] = useState<Record<string, { option_id?: string; option_ids?: string[]; text_response?: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  // Apuração ao Vivo
  const [viewMode, setViewMode] = useState<'vote' | 'results'>('vote');
  const [liveResults, setLiveResults] = useState<FormLiveResults | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);

  // Carregar dados do formulário
  const loadFormData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await formsService.fetchFormBySlug(slug);
      if (!data) {
        setNotFound(true);
        return;
      }
      setForm(data);

      // Se o formulário estiver inativo e tiver resultados ao vivo, abrir direto nos resultados
      if (!data.is_active && data.show_live_results) {
        setViewMode('results');
      }
    } catch (err) {
      console.error(err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadFormData();
  }, [loadFormData]);

  // Verificar se o usuário logado já votou
  useEffect(() => {
    const checkReceipt = async () => {
      if (!form || !currentUser) {
        setAlreadyVoted(false);
        return;
      }

      setCheckingReceipt(true);
      try {
        const hasReceipt = await formsService.checkUserReceipt(form.id, currentUser.id);
        setAlreadyVoted(hasReceipt);
        if (hasReceipt && !form.allow_multiple_submissions) {
          // Se já votou e só pode votar 1 vez, ir para o modo de apuração se permitido
          if (form.show_live_results) {
            setViewMode('results');
          }
        }
      } catch (err) {
        console.error('Erro ao verificar recibo:', err);
      } finally {
        setCheckingReceipt(false);
      }
    };

    checkReceipt();
  }, [form, currentUser]);

  // Carregar Apuração ao Vivo
  const loadLiveResults = useCallback(async () => {
    if (!form) return;
    try {
      setLoadingLive(true);
      const res = await formsService.fetchLiveResults(form.id);
      setLiveResults(res);
    } catch (err) {
      console.error('Erro ao carregar apuração:', err);
    } finally {
      setLoadingLive(false);
    }
  }, [form]);

  useEffect(() => {
    if (viewMode === 'results' && form) {
      loadLiveResults();
      // Inscrição Realtime
      const unsubscribe = formsService.subscribeToLiveResults(form.id, () => {
        loadLiveResults();
      });
      return () => {
        unsubscribe();
      };
    }
  }, [viewMode, form, loadLiveResults]);

  // Manipuladores de Seleção de Respostas
  const handleSelectSingleChoice = (questionId: string, optionId: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { option_id: optionId }
    }));
  };

  const handleToggleMultipleChoice = (questionId: string, optionId: string) => {
    setAnswers(prev => {
      const cur = prev[questionId]?.option_ids || [];
      const next = cur.includes(optionId)
        ? cur.filter(id => id !== optionId)
        : [...cur, optionId];
      return {
        ...prev,
        [questionId]: { option_ids: next }
      };
    });
  };

  const handleTextChange = (questionId: string, text: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text_response: text }
    }));
  };

  // Enviar Voto
  const handleSubmit = async () => {
    if (!form) return;

    if (form.requires_auth && !currentUser) {
      notify.error('É necessário entrar como sócio para votar.');
      return;
    }

    // Validar perguntas obrigatórias
    const questions = form.questions || [];
    for (const q of questions) {
      if (q.is_required) {
        const ans = answers[q.id];
        if (q.question_type === 'single_choice' && !ans?.option_id) {
          notify.error(`Por favor, responda à pergunta: "${q.title}"`);
          return;
        }
        if (q.question_type === 'multiple_choice' && (!ans?.option_ids || ans.option_ids.length === 0)) {
          notify.error(`Por favor, selecione ao menos uma alternativa em: "${q.title}"`);
          return;
        }
        if (q.question_type === 'open_text' && (!ans?.text_response || !ans.text_response.trim())) {
          notify.error(`Por favor, preencha o campo de texto em: "${q.title}"`);
          return;
        }
      }
    }

    // Montar payload
    const payload: FormAnswerItem[] = [];
    Object.entries(answers).forEach(([qId, val]) => {
      if (val.option_id) {
        payload.push({ question_id: qId, option_id: val.option_id });
      } else if (val.option_ids && val.option_ids.length > 0) {
        payload.push({ question_id: qId, option_ids: val.option_ids });
      } else if (val.text_response && val.text_response.trim()) {
        payload.push({ question_id: qId, text_response: val.text_response.trim() });
      }
    });

    try {
      setSubmitting(true);
      const res = await formsService.submitFormAnswers(form.id, payload);
      notify.success(res.message || 'Seu voto foi registrado com sucesso!');
      setSubmittedSuccess(true);
      setAlreadyVoted(true);

      // Se tiver apuração ao vivo, abre o placar
      if (form.show_live_results) {
        setViewMode('results');
      }
    } catch (err: any) {
      console.error(err);
      notify.error(err.message || 'Erro ao registrar voto. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  // 1. Loading Inicial
  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-900 text-white p-6">
        <Loader2 className="animate-spin text-saibro-500 mb-4" size={48} />
        <span className="text-xs uppercase tracking-widest font-bold text-stone-400">
          Carregando Votação STC...
        </span>
      </div>
    );
  }

  // 2. Formulário não encontrado
  if (notFound || !form) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-900 text-white p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-stone-800 text-saibro-500 flex items-center justify-center mb-4 border border-stone-700">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Formulário ou Votação Não Encontrada</h2>
        <p className="text-stone-400 text-sm max-w-sm mb-6">
          O link acessado pode ter sido desativado, expirado ou digitado incorretamente.
        </p>
        {onBackToApp && (
          <button
            onClick={onBackToApp}
            className="px-6 py-2.5 rounded-xl bg-saibro-600 hover:bg-saibro-700 text-white font-bold text-sm transition-all shadow-lg shadow-saibro-600/20"
          >
            Voltar ao Início
          </button>
        )}
      </div>
    );
  }

  // 3. Exige Sócio Autenticado e Visitante não está Logado
  if (form.requires_auth && !currentUser) {
    return (
      <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full bg-stone-900 border border-stone-800 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-saibro-500/10 text-saibro-500 flex items-center justify-center mx-auto border border-saibro-500/20">
              <Lock size={28} />
            </div>
            <span className="text-[10px] uppercase font-black tracking-widest text-saibro-500 bg-saibro-500/10 px-3 py-1 rounded-full inline-block">
              Área Restrita a Sócios
            </span>
            <h2 className="text-xl font-black text-white">{form.title}</h2>
            <p className="text-xs text-stone-400">
              Para garantir a legitimidade e o voto único, é necessário fazer login com sua conta de sócio do STC Play.
            </p>
          </div>

          {/* Componente de Login Autenticado */}
          <div className="pt-2">
            <Auth />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col selection:bg-saibro-500 selection:text-white pb-16">
      {/* Top Header Barra STC */}
      <header className="bg-stone-900/90 backdrop-blur-xl border-b border-stone-800/80 sticky top-0 z-40 px-4 py-3.5">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBackToApp && (
              <button
                onClick={onBackToApp}
                className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
                title="Voltar ao STC Play"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <img
                src="https://smztsayzldjmkzmufqcz.supabase.co/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png"
                alt="STC"
                className="w-7 h-7 object-contain"
              />
              <span className="font-extrabold text-white text-base tracking-tight">STC Play</span>
            </div>
          </div>

          {/* Toggle entre Votar e Ver Apuração */}
          {form.show_live_results && (
            <div className="flex items-center bg-stone-800/90 p-1 rounded-xl border border-stone-700/60 text-xs">
              <button
                onClick={() => setViewMode('vote')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  viewMode === 'vote'
                    ? 'bg-saibro-600 text-white shadow-xs'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                Votação
              </button>
              <button
                onClick={() => setViewMode('results')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'results'
                    ? 'bg-saibro-600 text-white shadow-xs'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Apuração ao Vivo
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Conteúdo Central */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 pt-6 space-y-6">
        {/* Banner do Formulário */}
        <div className="bg-stone-900/90 border border-stone-800 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden space-y-4">
          <div className="absolute top-0 right-0 w-72 h-72 bg-saibro-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

          {/* Badges de Destaque */}
          <div className="flex flex-wrap items-center gap-2">
            {form.is_secret_vote ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <ShieldCheck size={14} />
                Voto 100% Secreto & Anônimo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-stone-800 text-stone-300 border border-stone-700">
                <Users size={14} />
                Voto Identificado
              </span>
            )}

            {!form.is_active && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                Votação Encerrada
              </span>
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-tight">
              {form.title}
            </h1>
            {form.description && (
              <p className="text-sm md:text-base text-stone-300 whitespace-pre-wrap leading-relaxed">
                {form.description}
              </p>
            )}
          </div>

          {/* Identificação do Sócio Atual */}
          {currentUser && (
            <div className="pt-3 border-t border-stone-800/80 flex items-center justify-between text-xs text-stone-400">
              <span>
                Conectado como: <strong className="text-white">{currentUser.name || 'Sócio'}</strong>
              </span>
              {alreadyVoted && !form.allow_multiple_submissions && (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 size={14} /> Voto já computado
                </span>
              )}
            </div>
          )}
        </div>

        {/* MODO 1: APURAÇÃO AO VIVO */}
        {viewMode === 'results' ? (
          <div className="bg-stone-900/90 border border-stone-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-stone-800 pb-4">
              <div>
                <h3 className="text-lg md:text-xl font-black text-white flex items-center gap-2">
                  <BarChart3 className="text-saibro-500" size={22} />
                  Placar & Apuração ao Vivo
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  Atualização instantânea conforme os votos são registrados.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold text-stone-300 bg-stone-800 px-3 py-1.5 rounded-xl border border-stone-700">
                  {liveResults?.total_participants || 0} {liveResults?.total_participants === 1 ? 'voto' : 'votos'}
                </span>
                <button
                  onClick={loadLiveResults}
                  disabled={loadingLive}
                  className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
                  title="Recarregar apuração"
                >
                  <RefreshCw size={16} className={loadingLive ? 'animate-spin text-saibro-500' : ''} />
                </button>
              </div>
            </div>

            {loadingLive && !liveResults ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-saibro-500" size={36} />
                <span className="text-xs font-semibold text-stone-400">Calculando resultados ao vivo...</span>
              </div>
            ) : liveResults?.questions && liveResults.questions.length > 0 ? (
              <div className="space-y-6">
                {liveResults.questions.map((q, qIndex) => {
                  const totalQVotes = q.total_votes || 0;
                  return (
                    <div key={q.question_id} className="bg-stone-950/70 rounded-2xl p-5 border border-stone-800/80 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-extrabold text-white text-base">
                          {qIndex + 1}. {q.title}
                        </h4>
                        <span className="text-xs font-mono text-stone-400">
                          {totalQVotes} {totalQVotes === 1 ? 'resposta' : 'respostas'}
                        </span>
                      </div>

                      {q.question_type !== 'open_text' ? (
                        <div className="space-y-3.5">
                          {(q.options || []).map(opt => {
                            const percent = totalQVotes > 0 ? Math.round((opt.votes / totalQVotes) * 100) : 0;
                            return (
                              <div key={opt.option_id} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs md:text-sm">
                                  <span className="font-bold text-stone-200">{opt.label}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-black text-saibro-400 text-sm">
                                      {percent}%
                                    </span>
                                    <span className="text-stone-500 text-xs">({opt.votes})</span>
                                  </div>
                                </div>
                                <div className="w-full h-3.5 bg-stone-800 rounded-full overflow-hidden p-0.5 border border-stone-700/50">
                                  <div
                                    className="h-full bg-gradient-to-r from-saibro-600 to-saibro-500 rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3 bg-stone-900 rounded-xl border border-stone-800 text-xs text-stone-400">
                          Respostas qualitativas de texto computadas: <strong>{q.open_responses_count}</strong>.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-stone-500 text-center py-10">Nenhum voto registrado até agora.</p>
            )}

            {/* Botão de Voltar para Votar (se permitido) */}
            {(!alreadyVoted || form.allow_multiple_submissions) && form.is_active && (
              <button
                onClick={() => setViewMode('vote')}
                className="w-full py-3.5 rounded-2xl font-bold text-sm bg-stone-800 hover:bg-stone-700 text-white transition-all text-center"
              >
                Voltar e Responder Formulário
              </button>
            )}
          </div>
        ) : (
          /* MODO 2: FORMULÁRIO DE VOTAÇÃO */
          <div className="space-y-6">
            {/* Aviso se já tiver votado */}
            {alreadyVoted && !form.allow_multiple_submissions ? (
              <div className="bg-emerald-950/40 border border-emerald-600/30 rounded-3xl p-6 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 size={32} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-black text-white">Voto Já Registrado</h3>
                  <p className="text-xs text-stone-300 max-w-md mx-auto">
                    Você já participou desta votação. As regras deste formulário permitem apenas um único voto por sócio.
                  </p>
                </div>
                {form.show_live_results && (
                  <button
                    onClick={() => setViewMode('results')}
                    className="px-6 py-2.5 rounded-xl font-bold text-xs bg-saibro-600 hover:bg-saibro-700 text-white transition-all"
                  >
                    Acompanhar Placar ao Vivo
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Lista de Perguntas */}
                <div className="space-y-6">
                  {(form.questions || []).map((q, qIndex) => {
                    const ans = answers[q.id];

                    return (
                      <div
                        key={q.id}
                        className="bg-stone-900/90 border border-stone-800 rounded-3xl p-5 md:p-7 shadow-xl space-y-4"
                      >
                        {/* Enunciado */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-saibro-500/20 text-saibro-400 font-bold text-xs flex items-center justify-center">
                              {qIndex + 1}
                            </span>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                              {q.question_type === 'single_choice' && 'Escolha Única'}
                              {q.question_type === 'multiple_choice' && 'Múltipla Escolha (Selecione 1 ou mais)'}
                              {q.question_type === 'open_text' && 'Resposta Aberta'}
                            </span>
                            {q.is_required && (
                              <span className="text-saibro-500 text-xs font-bold" title="Obrigatória">*</span>
                            )}
                          </div>
                          <h3 className="text-base md:text-lg font-bold text-white pt-1">
                            {q.title}
                          </h3>
                          {q.description && (
                            <p className="text-xs text-stone-400 leading-relaxed">
                              {q.description}
                            </p>
                          )}
                        </div>

                        {/* Alternativas Múltipla Escolha Única */}
                        {q.question_type === 'single_choice' && (
                          <div className="space-y-2.5 pt-2">
                            {(q.options || []).map(opt => {
                              const isSelected = ans?.option_id === opt.id;
                              return (
                                <button
                                  type="button"
                                  key={opt.id}
                                  onClick={() => handleSelectSingleChoice(q.id, opt.id)}
                                  className={`w-full min-h-[48px] px-4 py-3 rounded-2xl border text-left flex items-center gap-3.5 transition-all duration-200 active:scale-[0.99] select-none ${
                                    isSelected
                                      ? 'bg-saibro-950/60 border-saibro-500 ring-2 ring-saibro-500 text-white shadow-md shadow-saibro-950'
                                      : 'bg-stone-950/70 border-stone-800 text-stone-200 hover:border-stone-700 hover:bg-stone-900'
                                  }`}
                                >
                                  <div
                                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                                      isSelected
                                        ? 'border-saibro-500 bg-saibro-500 text-white'
                                        : 'border-stone-600 bg-stone-900'
                                    }`}
                                  >
                                    {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                                  </div>
                                  <span className="font-semibold text-sm leading-snug">
                                    {opt.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Alternativas Múltipla Escolha Múltipla */}
                        {q.question_type === 'multiple_choice' && (
                          <div className="space-y-2.5 pt-2">
                            {(q.options || []).map(opt => {
                              const isSelected = (ans?.option_ids || []).includes(opt.id);
                              return (
                                <button
                                  type="button"
                                  key={opt.id}
                                  onClick={() => handleToggleMultipleChoice(q.id, opt.id)}
                                  className={`w-full min-h-[48px] px-4 py-3 rounded-2xl border text-left flex items-center gap-3.5 transition-all duration-200 active:scale-[0.99] select-none ${
                                    isSelected
                                      ? 'bg-saibro-950/60 border-saibro-500 ring-2 ring-saibro-500 text-white shadow-md shadow-saibro-950'
                                      : 'bg-stone-950/70 border-stone-800 text-stone-200 hover:border-stone-700 hover:bg-stone-900'
                                  }`}
                                >
                                  <div
                                    className={`w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                                      isSelected
                                        ? 'border-saibro-500 bg-saibro-500 text-white'
                                        : 'border-stone-600 bg-stone-900'
                                    }`}
                                  >
                                    {isSelected && <CheckSquare size={13} className="text-white" />}
                                  </div>
                                  <span className="font-semibold text-sm leading-snug">
                                    {opt.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Campo de Texto Aberto */}
                        {q.question_type === 'open_text' && (
                          <div className="space-y-1.5 pt-1">
                            <textarea
                              rows={3}
                              value={ans?.text_response || ''}
                              onChange={e => handleTextChange(q.id, e.target.value)}
                              placeholder="Digite sua resposta aqui..."
                              className="w-full px-4 py-3 rounded-2xl border border-stone-800 bg-stone-950/70 text-white placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-saibro-500 focus:border-transparent resize-none"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Botão de Submissão do Voto */}
                <div className="pt-2">
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || !form.is_active}
                    className="w-full min-h-[52px] py-4 rounded-2xl font-black text-base bg-saibro-600 hover:bg-saibro-500 active:scale-[0.99] text-white shadow-xl shadow-saibro-600/30 transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        <span>Computando Voto na Urna...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={20} />
                        <span>Confirmar e Registrar Meu Voto</span>
                      </>
                    )}
                  </button>
                  <p className="text-center text-[11px] text-stone-500 mt-2.5">
                    {form.is_secret_vote
                      ? '🔒 Urna Cega Criptográfica: seu voto é estritamente confidencial.'
                      : 'Voto identificado associado ao seu perfil de sócio.'}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
