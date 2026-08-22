import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Eraser, Send } from 'lucide-react';
import { api } from '../../api/easypollApi';
import type { Group } from '../../types/api';
import { errorMessage } from '../../utils/format';
import { MemberSelector } from './MemberSelector';
import { PollOptions } from './PollOptions';

interface PollComposerProps {
  connected: boolean;
  groupId: string;
  groupSelector: ReactNode;
  selectedGroup: Group | null;
  showToast: (message: string, error?: boolean) => void;
}

export function PollComposer({ connected, groupId, groupSelector, selectedGroup, showToast }: PollComposerProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [sending, setSending] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const questionInput = useRef<HTMLInputElement>(null);
  const filledOptions = options.map((option) => option.trim()).filter(Boolean);

  function clearForm() {
    if ((question.trim() || filledOptions.length) && !window.confirm('Limpar a pergunta e todas as opções? O grupo selecionado será mantido.')) return;
    setQuestion('');
    setOptions(['', '']);
    setAllowMultiple(false);
    questionInput.current?.focus();
  }

  async function sendPoll(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!groupId) { showToast('Selecione um grupo.', true); return; }
    if (!form.current?.reportValidity()) return;
    setSending(true);
    try {
      const data = await api.sendPoll({ groupId, question, options, allowMultipleAnswers: allowMultiple });
      showToast(selectedGroup ? `✓ Enquete enviada para ${selectedGroup.name}` : data.message || '✓ Enquete enviada com sucesso.');
    } catch (error) {
      showToast(errorMessage(error), true);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const dialogOpen = document.querySelector('.bulk-dialog[open], .member-dialog[open]');
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || dialogOpen) return;
      event.preventDefault();
      if (!(connected && groupId && question.trim() && filledOptions.length >= 2)) {
        showToast('Preencha grupo, pergunta e pelo menos duas opções antes de enviar.', true);
        return;
      }
      form.current?.requestSubmit();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [connected, filledOptions.length, groupId, question, showToast]);

  return <form ref={form} className="card poll-card" onSubmit={(event) => void sendPoll(event)}><div className="section-heading"><div><p className="step">Compositor</p><h2>Sua enquete</h2><p className="section-description">Tudo que você precisa para começar uma boa conversa.</p></div></div><fieldset disabled={!connected}>{groupSelector}<div className="field question-field"><div className="label-row"><label htmlFor="question">Pergunta</label><span>{question.length}/255</span></div><input ref={questionInput} id="question" maxLength={255} placeholder="Ex.: Qual jogo vamos jogar hoje?" required value={question} onChange={(event) => setQuestion(event.target.value)} /></div><PollOptions options={options} onChange={setOptions} showToast={showToast}><MemberSelector groupId={groupId} hasFilledOptions={Boolean(filledOptions.length)} onApply={(names) => setOptions([...names, ...Array(Math.max(0, 2 - names.length)).fill('')])} showToast={showToast} /></PollOptions><label className="checkbox-row"><input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} /><span className="fake-checkbox" aria-hidden="true" /><span><strong>Permitir múltiplas respostas</strong><small>Participantes poderão selecionar mais de uma opção.</small></span></label><div className="composer-actions"><button className="button primary" type="submit" disabled={sending}><Send aria-hidden="true" /><span className="button-label">{sending ? 'Enviando…' : 'Enviar enquete'}</span>{sending && <span className="spinner" />}</button><button className="button clear-form" type="button" onClick={clearForm}><Eraser aria-hidden="true" />Limpar</button></div></fieldset></form>;
}
