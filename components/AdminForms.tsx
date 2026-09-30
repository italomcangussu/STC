import React, { useState, useEffect, useCallback } from 'react';
import {
  Vote, Plus, Link, QrCode, Eye, CheckCircle2,
  Trash2, Edit3, Loader2, ArrowLeft,
  Lock, Users, BarChart3, AlertCircle,
  HelpCircle, RefreshCw, Radio, CheckSquare, MessageSquare, Copy, X
} from 'lucide-react';
import { formsService } from '../lib/formsService';
import { ClubForm, FormQuestion, QuestionType, FormLiveResults, FormOption } from '../types';
import { notify } from '../lib/notifications';
import { useConfirm } from '../hooks/useConfirm';
import { StandardModal } from './StandardModal';

export const AdminForms: React.FC = () => {
  const confirm = useConfirm();
  const [forms, setForms] = useState<ClubForm[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSecretVote, setIsSecretVote] = useState(false);
  const [requiresAuth, setRequiresAuth] = useState(true);
  const [allowMultipleSubmissions, setAllowMultipleSubmissions] = useState(false);
  const [showLiveResults, setShowLiveResults] = useState(true);
  const [questions, setQuestions] = useState<Array<Partial<FormQuestion> & { options?: FormOption[] }>>([]);
  const [saving, setSaving] = useState(false);

  // QR Code & Link Modal State
  const [shareModalForm, setShareModalForm] = useState<ClubForm | null>(null);

  // Results Modal State
  const [resultsModalForm, setResultsModalForm] = useState<ClubForm | null>(null);
  const [liveResults, setLiveResults] = useState<FormLiveResults | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [selectedOpenQuestionId, setSelectedOpenQuestionId] = useState<string | null>(null);
  const [openResponses, setOpenResponses] = useState<Array<{ text: string; date: string; authorName?: string }>>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);

  const loadForms = useCallback(async () => {
    try {
      setLoading(true);
      const data = await formsService.fetchAdminForms();
      setForms(data);
    } catch (err: any) {
      console.error(err);
      notify.error('Erro ao carregar formulários.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  // Gerador automático de Slug amigável
  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!editingFormId) {
      const generated = val
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      setSlug(generated);
    }
  };

  const handleOpenCreate = () => {
    setEditingFormId(null);
    setTitle('');
    setDescription('');
    setSlug('');
    setIsActive(true);
    setIsSecretVote(false);
    setRequiresAuth(true);
    setAllowMultipleSubmissions(false);
    setShowLiveResults(true);
    setQuestions([
      {
        title: '',
        description: '',
        question_type: 'single_choice',
        is_required: true,
        options: [
          { label: 'Opção A' },
          { label: 'Opção B' }
        ]
      }
    ]);
    setIsEditing(true);
  };

  const handleOpenEdit = (form: ClubForm) => {
    setEditingFormId(form.id);
    setTitle(form.title);
    setDescription(form.description || '');
    setSlug(form.slug);
    setIsActive(form.is_active);
    setIsSecretVote(form.is_secret_vote);
    setRequiresAuth(form.requires_auth);
    setAllowMultipleSubmissions(form.allow_multiple_submissions);
    setShowLiveResults(form.show_live_results);
    setQuestions(
      (form.questions || []).map(q => ({
        id: q.id,
        title: q.title,
        description: q.description || '',
        question_type: q.question_type,
        is_required: q.is_required,
        options: (q.options || []).map(o => ({ id: o.id, label: o.label }))
      }))
    );
    setIsEditing(true);
  };

  const handleAddQuestion = () => {
    setQuestions(prev => [
      ...prev,
      {
        title: '',
        description: '',
        question_type: 'single_choice',
        is_required: true,
        options: [
          { label: 'Opção 1' },
          { label: 'Opção 2' }
        ]
      }
    ]);
  };

  const handleRemoveQuestion = (index: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateQuestion = (index: number, field: string, val: any) => {
    setQuestions(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleAddOption = (qIndex: number) => {
    setQuestions(prev => {
      const copy = [...prev];
      const q = { ...copy[qIndex] };
      const curOptions = q.options || [];
      q.options = [...curOptions, { label: `Opção ${curOptions.length + 1}` }];
      copy[qIndex] = q;
      return copy;
    });
  };

  const handleRemoveOption = (qIndex: number, optIndex: number) => {
    setQuestions(prev => {
      const copy = [...prev];
      const q = { ...copy[qIndex] };
      q.options = (q.options || []).filter((_, i) => i !== optIndex);
      copy[qIndex] = q;
      return copy;
    });
  };

  const handleUpdateOptionLabel = (qIndex: number, optIndex: number, label: string) => {
    setQuestions(prev => {
      const copy = [...prev];
      const q = { ...copy[qIndex] };
      const options = [...(q.options || [])];
      options[optIndex] = { ...options[optIndex], label };
      q.options = options;
      copy[qIndex] = q;
      return copy;
    });
  };

  const handleSaveForm = async () => {
    if (!title.trim()) {
      notify.error('Por favor, informe o título do formulário.');
      return;
    }

    if (!slug.trim()) {
      notify.error('Por favor, defina um identificador (link amigável).');
      return;
    }

    if (questions.length === 0) {
      notify.error('Adicione pelo menos uma pergunta.');
      return;
    }

    // Validar se perguntas têm títulos e opções
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.title?.trim()) {
        notify.error(`A pergunta #${i + 1} precisa de um título.`);
        return;
      }
      if (q.question_type !== 'open_text') {
        if (!q.options || q.options.length < 2) {
          notify.error(`A pergunta #${i + 1} precisa de no mínimo 2 alternativas.`);
          return;
        }
        for (const opt of q.options) {
          if (!opt.label.trim()) {
            notify.error(`Todas as alternativas da pergunta #${i + 1} devem estar preenchidas.`);
            return;
          }
        }
      }
    }

    try {
      setSaving(true);
      await formsService.saveForm(
        {
          id: editingFormId || undefined,
          title: title.trim(),
          description: description.trim() || null,
          slug: slug.trim().toLowerCase(),
          is_active: isActive,
          is_secret_vote: isSecretVote,
          requires_auth: requiresAuth,
          allow_multiple_submissions: allowMultipleSubmissions,
          show_live_results: showLiveResults
        },
        questions as any
      );

      notify.success(editingFormId ? 'Formulário atualizado com sucesso!' : 'Formulário criado com sucesso!');
      setIsEditing(false);
      loadForms();
    } catch (err: any) {
      console.error(err);
      notify.error(err.message || 'Erro ao salvar formulário.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (form: ClubForm) => {
    try {
      const nextState = !form.is_active;
      await formsService.toggleFormActive(form.id, nextState);
      notify.success(nextState ? 'Formulário ativado!' : 'Formulário pausado/encerrado.');
      setForms(prev => prev.map(f => f.id === form.id ? { ...f, is_active: nextState } : f));
    } catch (err: any) {
      console.error(err);
      notify.error('Não foi possível alterar o status.');
    }
  };

  const handleDeleteForm = async (form: ClubForm) => {
    const ok = await confirm({
      title: 'Excluir Formulário',
      description: `Tem certeza que deseja excluir "${form.title}"?`,
      consequences: ['Todos os votos e respostas associados serão permanentemente apagados.'],
      confirmLabel: 'Excluir Permanentemente',
      cancelLabel: 'Cancelar',
      tone: 'danger'
    });

    if (!ok) return;

    try {
      await formsService.deleteForm(form.id);
      notify.success('Formulário excluído com sucesso.');
      setForms(prev => prev.filter(f => f.id !== form.id));
    } catch (err: any) {
      console.error(err);
      notify.error('Erro ao excluir formulário.');
    }
  };

  const getFormUrl = (formSlug: string) => {
    const base = window.location.origin;
    return `${base}/votacao/${formSlug}`;
  };

  const handleCopyLink = async (formSlug: string) => {
    const url = getFormUrl(formSlug);
    try {
      await navigator.clipboard.writeText(url);
      notify.success('Link copiado para a área de transferência!');
    } catch {
      notify.info(`Link: ${url}`);
    }
  };

  const handleOpenResults = async (form: ClubForm) => {
    setResultsModalForm(form);
    setLoadingResults(true);
    setSelectedOpenQuestionId(null);
    setOpenResponses([]);
    try {
      const res = await formsService.fetchLiveResults(form.id);
      setLiveResults(res);
    } catch (err: any) {
      console.error(err);
      notify.error('Erro ao carregar resultados da votação.');
    } finally {
      setLoadingResults(false);
    }
  };

  const handleViewOpenResponses = async (formId: string, qId: string) => {
    setSelectedOpenQuestionId(qId);
    setLoadingResponses(true);
    try {
      const responses = await formsService.fetchAdminOpenResponses(formId, qId);
      setOpenResponses(responses);
    } catch (err: any) {
      console.error(err);
      notify.error('Erro ao carregar respostas abertas.');
    } finally {
      setLoadingResponses(false);
    }
  };

  // Escuta em tempo real do modal de resultados abertos
  useEffect(() => {
    if (!resultsModalForm) return;

    const unsubscribe = formsService.subscribeToLiveResults(resultsModalForm.id, async () => {
      try {
        const updated = await formsService.fetchLiveResults(resultsModalForm.id);
        setLiveResults(updated);
      } catch (err) {
        console.error('Erro ao atualizar realtime no admin:', err);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [resultsModalForm]);

  // Se estiver editando ou criando
  if (isEditing) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto pb-12">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-stone-200 pb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsEditing(false)}
              className="p-2 rounded-xl text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
              title="Voltar para a lista"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-stone-900 tracking-tight">
                {editingFormId ? 'Editar Formulário' : 'Novo Formulário & Votação'}
              </h2>
              <p className="text-xs md:text-sm text-stone-500">
                Configure as regras, perguntas e alternativas do formulário oficial.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveForm}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-bold bg-saibro-600 hover:bg-saibro-700 text-white shadow-md shadow-saibro-500/20 active:scale-95 transition-all flex items-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {saving ? 'Salvando...' : 'Salvar Formulário'}
            </button>
          </div>
        </div>

        {/* Bloco 1: Informações Básicas */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-stone-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
            <div className="w-8 h-8 rounded-lg bg-saibro-50 text-saibro-600 flex items-center justify-center font-bold text-sm">
              1
            </div>
            <h3 className="font-bold text-stone-800 text-base">Identificação do Formulário</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                Título do Formulário / Votação *
              </label>
              <input
                type="text"
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="Ex: Eleição da Diretoria 2026 ou Pesquisa de Satisfação das Quadras"
                className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-saibro-500 focus:border-transparent text-sm text-stone-800 bg-stone-50/50"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                Subtítulo / Descrição explicativa
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ex: Vote na sua chapa favorita. A apuração em tempo real estará disponível logo após a confirmação."
                className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-saibro-500 focus:border-transparent text-sm text-stone-800 bg-stone-50/50 resize-none"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                Link Público Amigável (Slug da URL) *
              </label>
              <div className="flex items-center rounded-xl border border-stone-200 bg-stone-50/50 overflow-hidden text-sm">
                <span className="px-3.5 py-3 text-stone-400 bg-stone-100/80 border-r border-stone-200 font-mono text-xs select-none">
                  stcplay.com.br/votacao/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="eleicao-diretoria-2026"
                  className="w-full px-3 py-3 focus:outline-none text-stone-800 font-mono text-xs bg-transparent"
                />
              </div>
              <p className="text-[11px] text-stone-400">
                Este link será usado para compartilhar a votação pelo WhatsApp ou gerar QR Code.
              </p>
            </div>
          </div>
        </div>

        {/* Bloco 2: Regras de Votação e Submissão */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-stone-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
            <div className="w-8 h-8 rounded-lg bg-saibro-50 text-saibro-600 flex items-center justify-center font-bold text-sm">
              2
            </div>
            <h3 className="font-bold text-stone-800 text-base">Regras de Votação & Sigilo</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Votação Secreta */}
            <div className={`p-4 rounded-xl border transition-all ${isSecretVote ? 'bg-emerald-50/50 border-emerald-300' : 'bg-stone-50/50 border-stone-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Lock size={16} className={isSecretVote ? 'text-emerald-700' : 'text-stone-500'} />
                    <span className="font-bold text-sm text-stone-800">Votação Secreta (Urna Cega)</span>
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Registra que o sócio votou para bloquear voto duplicado, mas anonimiza o voto no banco. Nem os administradores saberão em quem ele votou.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSecretVote(!isSecretVote)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isSecretVote ? 'bg-emerald-600' : 'bg-stone-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${isSecretVote ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* Placar ao Vivo na Página Pública */}
            <div className={`p-4 rounded-xl border transition-all ${showLiveResults ? 'bg-saibro-50/50 border-saibro-200' : 'bg-stone-50/50 border-stone-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={16} className={showLiveResults ? 'text-saibro-600' : 'text-stone-500'} />
                    <span className="font-bold text-sm text-stone-800">Mostrar Placar ao Vivo</span>
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Exibe a apuração e as barras de porcentagem atualizando em tempo real para os sócios e na página pública.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLiveResults(!showLiveResults)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${showLiveResults ? 'bg-saibro-600' : 'bg-stone-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${showLiveResults ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* Exigir Autenticação de Sócio */}
            <div className={`p-4 rounded-xl border transition-all ${requiresAuth ? 'bg-stone-100/60 border-stone-300' : 'bg-stone-50/50 border-stone-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-stone-600" />
                    <span className="font-bold text-sm text-stone-800">Apenas Sócios Autenticados</span>
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Exige login no STC Play para votar (ideal para eleições e assembleias oficiais do clube).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequiresAuth(!requiresAuth)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${requiresAuth ? 'bg-saibro-600' : 'bg-stone-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${requiresAuth ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* Permitir Múltiplas Respostas */}
            <div className={`p-4 rounded-xl border transition-all ${allowMultipleSubmissions ? 'bg-stone-100/60 border-stone-300' : 'bg-stone-50/50 border-stone-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={16} className="text-stone-600" />
                    <span className="font-bold text-sm text-stone-800">Permitir Várias Respostas</span>
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Se desativado, cada sócio só pode votar uma única vez. Ative para formulários de sugestões contínuas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowMultipleSubmissions(!allowMultipleSubmissions)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${allowMultipleSubmissions ? 'bg-saibro-600' : 'bg-stone-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${allowMultipleSubmissions ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bloco 3: Perguntas e Alternativas */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-stone-200/80 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-saibro-50 text-saibro-600 flex items-center justify-center font-bold text-sm">
                3
              </div>
              <h3 className="font-bold text-stone-800 text-base">Perguntas & Alternativas</h3>
            </div>
            <button
              type="button"
              onClick={handleAddQuestion}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-saibro-600 bg-saibro-50 hover:bg-saibro-100 transition-colors flex items-center gap-1.5"
            >
              <Plus size={15} />
              Adicionar Pergunta
            </button>
          </div>

          <div className="space-y-6">
            {questions.map((q, qIndex) => (
              <div
                key={qIndex}
                className="p-4 md:p-5 rounded-2xl border border-stone-200 bg-stone-50/30 space-y-4 relative group"
              >
                <div className="flex items-center justify-between gap-2 border-b border-stone-200/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-stone-200 text-stone-700 font-bold text-xs flex items-center justify-center">
                      {qIndex + 1}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
                      Pergunta {qIndex + 1}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={q.is_required ?? true}
                        onChange={e => handleUpdateQuestion(qIndex, 'is_required', e.target.checked)}
                        className="rounded text-saibro-600 focus:ring-saibro-500"
                      />
                      <span>Obrigatória</span>
                    </label>

                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveQuestion(qIndex)}
                        className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remover pergunta"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Título e Tipo da Pergunta */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-xs font-semibold text-stone-600">Enunciado da Pergunta *</label>
                    <input
                      type="text"
                      value={q.title || ''}
                      onChange={e => handleUpdateQuestion(qIndex, 'title', e.target.value)}
                      placeholder="Ex: Em qual chapa você vota para a Presidência?"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-saibro-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-stone-600">Tipo de Resposta</label>
                    <select
                      value={q.question_type || 'single_choice'}
                      onChange={e => handleUpdateQuestion(qIndex, 'question_type', e.target.value as QuestionType)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-saibro-500"
                    >
                      <option value="single_choice">Múltipla Escolha (1 Opção)</option>
                      <option value="multiple_choice">Múltipla Escolha (Várias Opções)</option>
                      <option value="open_text">Texto Aberto (Dissertativa)</option>
                    </select>
                  </div>
                </div>

                {/* Alternativas de Múltipla Escolha */}
                {q.question_type !== 'open_text' ? (
                  <div className="space-y-2.5 pt-2">
                    <label className="text-xs font-bold text-stone-600 uppercase tracking-wider block">
                      Alternativas / Candidatos
                    </label>
                    <div className="space-y-2">
                      {(q.options || []).map((opt, optIndex) => (
                        <div key={optIndex} className="flex items-center gap-2">
                          <div className="text-stone-400">
                            {q.question_type === 'single_choice' ? (
                              <Radio size={16} />
                            ) : (
                              <CheckSquare size={16} />
                            )}
                          </div>
                          <input
                            type="text"
                            value={opt.label}
                            onChange={e => handleUpdateOptionLabel(qIndex, optIndex, e.target.value)}
                            placeholder={`Alternativa ${optIndex + 1}`}
                            className="flex-1 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-saibro-500"
                          />
                          {(q.options || []).length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(qIndex, optIndex)}
                              className="p-1.5 text-stone-400 hover:text-red-500 rounded-lg hover:bg-stone-100"
                              title="Remover alternativa"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddOption(qIndex)}
                      className="mt-2 text-xs font-bold text-saibro-600 hover:text-saibro-700 flex items-center gap-1"
                    >
                      <Plus size={14} />
                      Adicionar Alternativa
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-stone-100/70 rounded-xl text-xs text-stone-500 flex items-center gap-2">
                    <MessageSquare size={16} className="text-stone-400 shrink-0" />
                    <span>Os sócios responderão com uma caixa de texto livre.</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <button
            onClick={() => setIsEditing(false)}
            className="px-5 py-3 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveForm}
            disabled={saving}
            className="px-6 py-3 rounded-xl text-sm font-bold bg-saibro-600 hover:bg-saibro-700 text-white shadow-lg shadow-saibro-500/25 active:scale-95 transition-all flex items-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
            {saving ? 'Gravando Formulário...' : 'Finalizar & Salvar Formulário'}
          </button>
        </div>
      </div>
    );
  }

  // Visualização Principal: Listagem de Formulários
  return (
    <div className="space-y-6">
      {/* Header com Ação de Criar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200/80 pb-5">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-stone-900 tracking-tight flex items-center gap-2.5">
            <Vote className="text-saibro-600" size={26} />
            Formulários & Urna de Votação
          </h2>
          <p className="text-xs md:text-sm text-stone-500 mt-0.5">
            Crie pesquisas, enquetes e votações oficiais com apuração ao vivo e urna cega.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="px-4 py-2.5 rounded-xl font-bold text-sm bg-saibro-600 hover:bg-saibro-700 text-white shadow-md shadow-saibro-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 shrink-0"
        >
          <Plus size={18} />
          Criar Novo Formulário
        </button>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="animate-spin text-saibro-600" size={36} />
          <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
            Carregando formulários do clube...
          </span>
        </div>
      ) : forms.length === 0 ? (
        /* Empty State */
        <div className="py-16 px-4 text-center bg-stone-50/60 rounded-3xl border border-dashed border-stone-200 max-w-md mx-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-saibro-100 text-saibro-600 flex items-center justify-center mx-auto">
            <Vote size={32} />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-stone-800 text-base">Nenhum formulário ativo no momento</h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              Crie uma enquete de opinião ou eleição oficial com apuração em tempo real para os sócios.
            </p>
          </div>
          <button
            onClick={handleOpenCreate}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-saibro-600 text-white hover:bg-saibro-700 transition-all inline-flex items-center gap-2"
          >
            <Plus size={16} />
            Criar Primeiro Formulário
          </button>
        </div>
      ) : (
        /* Lista de Formulários */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {forms.map(form => (
            <div
              key={form.id}
              className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs hover:border-saibro-300 transition-all flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                {/* Badges de Status & Configurações */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      form.is_active
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-stone-100 text-stone-600 border border-stone-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${form.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`} />
                    {form.is_active ? 'Ativo' : 'Encerrado'}
                  </span>

                  {form.is_secret_vote ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Lock size={11} />
                      Voto Secreto
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-600 border border-stone-200">
                      <Users size={11} />
                      Voto Aberto
                    </span>
                  )}

                  {form.show_live_results && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-saibro-50 text-saibro-700 border border-saibro-200">
                      <BarChart3 size={11} />
                      Ao Vivo
                    </span>
                  )}
                </div>

                {/* Título & Descrição */}
                <div className="space-y-1">
                  <h3 className="font-extrabold text-stone-900 text-base leading-snug">
                    {form.title}
                  </h3>
                  {form.description && (
                    <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed">
                      {form.description}
                    </p>
                  )}
                </div>

                {/* Metadados Rápidos */}
                <div className="flex items-center gap-4 text-xs text-stone-500 pt-1">
                  <span className="flex items-center gap-1">
                    <Users size={14} className="text-saibro-600" />
                    <strong>{form.total_participants || 0}</strong> {form.total_participants === 1 ? 'participante' : 'participantes'}
                  </span>
                  <span>•</span>
                  <span>
                    <strong>{(form.questions || []).length}</strong> {(form.questions || []).length === 1 ? 'pergunta' : 'perguntas'}
                  </span>
                </div>
              </div>

              {/* Barra de Ações Rápidas */}
              <div className="pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleCopyLink(form.slug)}
                    className="p-2 rounded-xl text-stone-600 hover:text-saibro-600 hover:bg-saibro-50 transition-colors"
                    title="Copiar Link Público"
                  >
                    <Link size={16} />
                  </button>

                  <button
                    onClick={() => setShareModalForm(form)}
                    className="p-2 rounded-xl text-stone-600 hover:text-saibro-600 hover:bg-saibro-50 transition-colors"
                    title="Ver QR Code & Link"
                  >
                    <QrCode size={16} />
                  </button>

                  <button
                    onClick={() => handleOpenResults(form)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-saibro-700 bg-saibro-50 hover:bg-saibro-100 transition-colors flex items-center gap-1.5"
                    title="Ver Apuração dos Votos"
                  >
                    <BarChart3 size={14} />
                    Apuração
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleActive(form)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      form.is_active
                        ? 'text-stone-500 hover:bg-stone-100'
                        : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {form.is_active ? 'Pausar' : 'Reativar'}
                  </button>

                  <button
                    onClick={() => handleOpenEdit(form)}
                    className="p-2 rounded-xl text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                    title="Editar formulário"
                  >
                    <Edit3 size={15} />
                  </button>

                  <button
                    onClick={() => handleDeleteForm(form)}
                    className="p-2 rounded-xl text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Excluir formulário"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Compartilhamento & QR Code */}
      {shareModalForm && (
        <StandardModal
          isOpen={!!shareModalForm}
          onClose={() => setShareModalForm(null)}
          ariaLabel="Compartilhar Formulário"
        >
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-md w-full mx-auto space-y-5 text-center">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="font-bold text-stone-800 text-base">Compartilhar Formulário</h3>
              <button
                onClick={() => setShareModalForm(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 transition-colors"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-1">
              <h4 className="font-extrabold text-stone-900 text-lg">
                {shareModalForm.title}
              </h4>
              <p className="text-xs text-stone-500">
                Aponte a câmera do celular ou copie o link direto para enviar no WhatsApp.
              </p>
            </div>

            {/* Imagem do QR Code */}
            <div className="bg-stone-50 p-4 rounded-2xl inline-block border border-stone-200/80 shadow-xs mx-auto">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(
                  getFormUrl(shareModalForm.slug)
                )}`}
                alt="QR Code da Votação"
                className="w-48 h-48 rounded-xl object-contain mx-auto"
              />
            </div>

            {/* Input com Link e Botão Copiar */}
            <div className="flex items-center gap-2 max-w-md mx-auto">
              <input
                type="text"
                readOnly
                value={getFormUrl(shareModalForm.slug)}
                className="w-full px-3 py-2.5 text-xs font-mono bg-stone-100 border border-stone-200 rounded-xl text-stone-700 select-all"
              />
              <button
                onClick={() => handleCopyLink(shareModalForm.slug)}
                className="px-4 py-2.5 rounded-xl bg-saibro-600 hover:bg-saibro-700 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 transition-colors"
              >
                <Copy size={14} />
                Copiar
              </button>
            </div>
          </div>
        </StandardModal>
      )}

      {/* Modal de Apuração / Resultados Detalhados */}
      {resultsModalForm && (
        <StandardModal
          isOpen={!!resultsModalForm}
          onClose={() => setResultsModalForm(null)}
          ariaLabel="Apuração & Resultados"
        >
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-2xl w-full mx-auto space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="font-bold text-stone-800 text-base">Apuração & Resultados</h3>
              <button
                onClick={() => setResultsModalForm(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 transition-colors"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-6 py-2">
            {/* Cabeçalho do Resultado */}
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h4 className="font-black text-stone-900 text-lg">
                  {resultsModalForm.title}
                </h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-stone-500">
                    Total de participantes: <strong className="text-saibro-600 font-mono text-sm">{liveResults?.total_participants || 0}</strong>
                  </span>
                  {resultsModalForm.is_secret_vote && (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      🔒 Voto Secreto (Urna Cega)
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleOpenResults(resultsModalForm)}
                disabled={loadingResults}
                className="p-2 rounded-xl text-stone-500 hover:text-saibro-600 hover:bg-stone-100 transition-colors"
                title="Atualizar apuração"
              >
                <RefreshCw size={16} className={loadingResults ? 'animate-spin text-saibro-600' : ''} />
              </button>
            </div>

            {loadingResults ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2">
                <Loader2 className="animate-spin text-saibro-600" size={32} />
                <span className="text-xs font-semibold text-stone-400">Carregando apuração dos votos...</span>
              </div>
            ) : liveResults?.questions && liveResults.questions.length > 0 ? (
              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
                {liveResults.questions.map((q, qIdx) => {
                  const totalQVotes = q.total_votes || 0;
                  return (
                    <div key={q.question_id} className="bg-stone-50/60 rounded-2xl p-4 md:p-5 border border-stone-200/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="font-bold text-stone-800 text-sm">
                          {qIdx + 1}. {q.title}
                        </h5>
                        <span className="text-[11px] font-mono text-stone-400">
                          {totalQVotes} {totalQVotes === 1 ? 'voto' : 'votos'}
                        </span>
                      </div>

                      {q.question_type !== 'open_text' ? (
                        /* Barras de Votação */
                        <div className="space-y-3 pt-1">
                          {(q.options || []).map((opt) => {
                            const percent = totalQVotes > 0 ? Math.round((opt.votes / totalQVotes) * 100) : 0;
                            return (
                              <div key={opt.option_id} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-semibold text-stone-700">{opt.label}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-stone-900">{percent}%</span>
                                    <span className="text-stone-400 text-[10px]">({opt.votes})</span>
                                  </div>
                                </div>
                                <div className="w-full h-3 bg-stone-200/80 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-saibro-600 rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        /* Pergunta de Texto Aberto */
                        <div className="space-y-3 pt-1">
                          <button
                            onClick={() => handleViewOpenResponses(resultsModalForm.id, q.question_id)}
                            className="text-xs font-bold text-saibro-600 hover:text-saibro-700 flex items-center gap-1.5"
                          >
                            <MessageSquare size={14} />
                            Ver {q.open_responses_count || 0} respostas recebidas
                          </button>

                          {selectedOpenQuestionId === q.question_id && (
                            <div className="mt-2 space-y-2 border-t border-stone-200 pt-2">
                              {loadingResponses ? (
                                <div className="py-4 text-center">
                                  <Loader2 size={18} className="animate-spin text-saibro-600 mx-auto" />
                                </div>
                              ) : openResponses.length === 0 ? (
                                <p className="text-xs text-stone-400 italic">Nenhuma resposta registrada ainda.</p>
                              ) : (
                                openResponses.map((item, idx) => (
                                  <div key={idx} className="p-3 bg-white rounded-xl border border-stone-200 text-xs space-y-1">
                                    <p className="text-stone-800 whitespace-pre-wrap font-medium">"{item.text}"</p>
                                    <div className="flex items-center justify-between text-[10px] text-stone-400 pt-1">
                                      <span>{item.authorName}</span>
                                      <span>{new Date(item.date).toLocaleString('pt-BR')}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-stone-400 text-center py-6">Nenhum resultado computado até agora.</p>
            )}
            </div>
          </div>
        </StandardModal>
      )}
    </div>
  );
};
