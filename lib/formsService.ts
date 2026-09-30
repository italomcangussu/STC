import { supabase } from './supabase';
import { ClubForm, FormQuestion, FormLiveResults, FormAnswerItem } from '../types';

export const formsService = {
  /**
   * Buscar todos os formulários para o painel administrativo
   */
  async fetchAdminForms(): Promise<ClubForm[]> {
    const { data: forms, error } = await supabase
      .from('club_forms')
      .select(`
        *,
        questions:club_form_questions(
          id,
          title,
          question_type,
          is_required,
          display_order,
          options:club_form_options(id, label, display_order)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar formulários admin:', error);
      throw error;
    }

    if (!forms) return [];

    // Buscar contagem de participantes por formulário
    const { data: receipts } = await supabase
      .from('club_form_voter_receipts')
      .select('form_id');

    const countMap: Record<string, number> = {};
    if (receipts) {
      receipts.forEach(r => {
        countMap[r.form_id] = (countMap[r.form_id] || 0) + 1;
      });
    }

    return forms.map(f => ({
      ...f,
      total_participants: countMap[f.id] || 0,
      questions: (f.questions || []).sort((a: any, b: any) => a.display_order - b.display_order).map((q: any) => ({
        ...q,
        options: (q.options || []).sort((a: any, b: any) => a.display_order - b.display_order)
      }))
    }));
  },

  /**
   * Buscar formulário por slug (para a página pública do sócio/visitante)
   */
  async fetchFormBySlug(slug: string): Promise<ClubForm | null> {
    const { data: form, error } = await supabase
      .from('club_forms')
      .select(`
        *,
        questions:club_form_questions(
          id,
          title,
          description,
          question_type,
          is_required,
          display_order,
          options:club_form_options(id, label, display_order)
        )
      `)
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar formulário por slug:', error);
      throw error;
    }

    if (!form) return null;

    // Buscar contagem de participantes
    const { count } = await supabase
      .from('club_form_voter_receipts')
      .select('*', { count: 'exact', head: true })
      .eq('form_id', form.id);

    return {
      ...form,
      total_participants: count || 0,
      questions: (form.questions || []).sort((a: any, b: any) => a.display_order - b.display_order).map((q: any) => ({
        ...q,
        options: (q.options || []).sort((a: any, b: any) => a.display_order - b.display_order)
      }))
    };
  },

  /**
   * Verificar se o usuário já votou / enviou resposta para este formulário
   */
  async checkUserReceipt(formId: string, userId: string): Promise<boolean> {
    if (!formId || !userId) return false;
    const { data, error } = await supabase
      .from('club_form_voter_receipts')
      .select('id')
      .eq('form_id', formId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao verificar recibo do usuário:', error);
      return false;
    }

    return !!data;
  },

  /**
   * Salvar ou atualizar formulário e suas perguntas/alternativas (Admin)
   */
  async saveForm(
    formData: Partial<ClubForm>,
    questions: Array<Partial<FormQuestion> & { options?: Array<{ id?: string; label: string; display_order?: number }> }>
  ): Promise<ClubForm> {
    // 1. Upsert em club_forms
    const formPayload = {
      title: formData.title,
      description: formData.description || null,
      slug: formData.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'),
      is_active: formData.is_active ?? true,
      is_secret_vote: formData.is_secret_vote ?? false,
      requires_auth: formData.requires_auth ?? true,
      allow_multiple_submissions: formData.allow_multiple_submissions ?? false,
      show_live_results: formData.show_live_results ?? true,
      starts_at: formData.starts_at || null,
      expires_at: formData.expires_at || null,
      updated_at: new Date().toISOString()
    };

    let formId = formData.id;

    if (formId) {
      const { error: updateError } = await supabase
        .from('club_forms')
        .update(formPayload)
        .eq('id', formId);

      if (updateError) throw updateError;
    } else {
      const { data: newForm, error: insertError } = await supabase
        .from('club_forms')
        .insert({
          ...formPayload,
          created_by: (await supabase.auth.getUser()).data.user?.id || null
        })
        .select()
        .single();

      if (insertError) throw insertError;
      formId = newForm.id;
    }

    // 2. Sincronizar perguntas
    // Para simplificar e garantir integridade, se for edição, buscamos perguntas existentes
    const { data: existingQuestions } = await supabase
      .from('club_form_questions')
      .select('id')
      .eq('form_id', formId);

    const existingQIds = new Set((existingQuestions || []).map(q => q.id));
    const keepQIds = new Set<string>();

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qPayload = {
        form_id: formId,
        title: q.title || 'Pergunta sem título',
        description: q.description || null,
        question_type: q.question_type || 'single_choice',
        is_required: q.is_required ?? true,
        display_order: i
      };

      let qId = q.id;
      if (qId && existingQIds.has(qId)) {
        keepQIds.add(qId);
        await supabase
          .from('club_form_questions')
          .update(qPayload)
          .eq('id', qId);
      } else {
        const { data: newQ, error: qError } = await supabase
          .from('club_form_questions')
          .insert(qPayload)
          .select('id')
          .single();

        if (qError) throw qError;
        qId = newQ.id;
      }

      // Sincronizar opções da pergunta se for múltipla escolha
      if (q.question_type !== 'open_text' && q.options && q.options.length > 0) {
        const { data: existingOptions } = await supabase
          .from('club_form_options')
          .select('id')
          .eq('question_id', qId);

        const existingOptIds = new Set((existingOptions || []).map(o => o.id));
        const keepOptIds = new Set<string>();

        for (let j = 0; j < q.options.length; j++) {
          const opt = q.options[j];
          const optPayload = {
            question_id: qId,
            label: opt.label,
            display_order: j
          };

          if (opt.id && existingOptIds.has(opt.id)) {
            keepOptIds.add(opt.id);
            await supabase
              .from('club_form_options')
              .update(optPayload)
              .eq('id', opt.id);
          } else {
            await supabase
              .from('club_form_options')
              .insert(optPayload);
          }
        }

        // Deletar opções removidas
        const removeOptIds = Array.from(existingOptIds).filter(id => !keepOptIds.has(id));
        if (removeOptIds.length > 0) {
          await supabase
            .from('club_form_options')
            .delete()
            .in('id', removeOptIds);
        }
      }
    }

    // Deletar perguntas removidas
    const removeQIds = Array.from(existingQIds).filter(id => !keepQIds.has(id));
    if (removeQIds.length > 0) {
      await supabase
        .from('club_form_questions')
        .delete()
        .in('id', removeQIds);
    }

    const updated = await this.fetchFormBySlug(formPayload.slug!);
    if (!updated) throw new Error('Falha ao recuperar formulário atualizado.');
    return updated;
  },

  /**
   * Alternar ativação do formulário
   */
  async toggleFormActive(formId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('club_forms')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', formId);

    if (error) throw error;
  },

  /**
   * Excluir formulário
   */
  async deleteForm(formId: string): Promise<void> {
    const { error } = await supabase
      .from('club_forms')
      .delete()
      .eq('id', formId);

    if (error) throw error;
  },

  /**
   * Submeter respostas (Urna Cega Atômica via RPC)
   */
  async submitFormAnswers(formId: string, answers: FormAnswerItem[]): Promise<{ success: boolean; message: string }> {
    const { data, error } = await supabase.rpc('submit_club_form', {
      p_form_id: formId,
      p_answers: answers
    });

    if (error) {
      console.error('Erro ao submeter respostas do formulário:', error);
      throw error;
    }

    return data as { success: boolean; message: string };
  },

  /**
   * Obter Resultados ao Vivo Agregados
   */
  async fetchLiveResults(formId: string): Promise<FormLiveResults> {
    const { data, error } = await supabase.rpc('get_form_live_results', {
      p_form_id: formId
    });

    if (error) {
      console.error('Erro ao buscar resultados ao vivo:', error);
      throw error;
    }

    return data as FormLiveResults;
  },

  /**
   * Buscar respostas abertas para relatório do Admin
   */
  async fetchAdminOpenResponses(formId: string, questionId: string): Promise<Array<{ text: string; date: string; authorName?: string }>> {
    const { data, error } = await supabase
      .from('club_form_responses')
      .select(`
        text_response,
        created_at,
        user_id,
        user:profiles(name)
      `)
      .eq('form_id', formId)
      .eq('question_id', questionId)
      .not('text_response', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((r: any) => ({
      text: r.text_response,
      date: r.created_at,
      authorName: r.user?.name || (r.user_id ? 'Sócio' : 'Anônimo')
    }));
  },

  /**
   * Inscrição em Tempo Real para Placar ao Vivo
   */
  subscribeToLiveResults(formId: string, onChange: () => void) {
    const channel = supabase
      .channel(`club_form_live_${formId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_form_responses',
          filter: `form_id=eq.${formId}`
        },
        () => {
          onChange();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_form_voter_receipts',
          filter: `form_id=eq.${formId}`
        },
        () => {
          onChange();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
};
