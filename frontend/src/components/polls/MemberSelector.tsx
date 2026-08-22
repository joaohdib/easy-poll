import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/easypollApi';
import type { Member } from '../../types/api';
import { errorMessage, normalizeSearch } from '../../utils/format';
import { MAX_POLL_OPTIONS, uniqueMemberNames } from '../../utils/polls';
import { MemberAvatar } from '../MemberAvatar';

interface MemberSelectorProps {
  groupId: string;
  hasFilledOptions: boolean;
  onApply: (names: string[]) => void;
  showToast: (message: string, error?: boolean) => void;
}

export function MemberSelector({ groupId, hasFilledOptions, onApply, showToast }: MemberSelectorProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadedGroupId, setLoadedGroupId] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const groupValue = useRef(groupId);
  groupValue.current = groupId;
  const visibleMembers = useMemo(() => {
    const query = normalizeSearch(search);
    return members.filter((member) => normalizeSearch(member.name).includes(query));
  }, [members, search]);

  useEffect(() => {
    controller.current?.abort();
    dialog.current?.close();
    setMembers([]);
    setLoadedGroupId('');
    setSelectedIds(new Set());
    setSearch('');
  }, [groupId]);
  useEffect(() => () => controller.current?.abort(), []);

  async function open() {
    if (!groupId) { showToast('Selecione um grupo primeiro.', true); return; }
    dialog.current?.showModal();
    if (loadedGroupId === groupId && members.length) return;
    setLoading(true);
    setLoadedGroupId(groupId);
    setMembers([]);
    setSelectedIds(new Set());
    const target = groupId;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 15_000);
    try {
      const data = await api.members(target, request.signal);
      if (request.signal.aborted || groupValue.current !== target) return;
      if (!data.members.length) throw new Error('Nenhum membro foi encontrado nesse grupo.');
      setMembers([...data.members].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      if (data.totalMembers > data.members.length) showToast('Alguns membros não puderam ser identificados.', true);
    } catch (error) {
      if (groupValue.current !== target) return;
      dialog.current?.close();
      setLoadedGroupId('');
      showToast(error instanceof DOMException && error.name === 'AbortError'
        ? 'Não foi possível carregar os membros a tempo. Tente novamente.'
        : errorMessage(error, 'Não foi possível carregar os membros.'), true);
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === request) controller.current = null;
      if (groupValue.current === target) setLoading(false);
    }
  }

  function toggle(memberId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else if (next.size < MAX_POLL_OPTIONS) next.add(memberId);
      else showToast('Você pode selecionar no máximo 12 membros.', true);
      return next;
    });
  }
  function selectRandom() {
    const shuffled = [...members];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    setSelectedIds(new Set(shuffled.slice(0, MAX_POLL_OPTIONS).map((member) => member.id)));
  }
  function apply() {
    const selected = members.filter((member) => selectedIds.has(member.id));
    if (!selected.length) return;
    if (hasFilledOptions && !window.confirm('As opções preenchidas serão substituídas pelos membros selecionados. Continuar?')) return;
    onApply(uniqueMemberNames(selected));
    dialog.current?.close();
    showToast(`${selected.length} ${selected.length === 1 ? 'membro adicionado' : 'membros adicionados'} às opções. Revise antes de enviar.`);
  }

  const memberDialog = <dialog ref={dialog} className="app-dialog member-dialog" aria-labelledby="member-dialog-title" onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}><div className="member-dialog-shell"><div className="member-dialog-header"><div><p className="step">Opções da enquete</p><h2 id="member-dialog-title">Selecionar membros</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={() => dialog.current?.close()}>×</button></div>{loading ? <div className="member-loading">Carregando membros…</div> : <div><div className="member-toolbar"><label className="member-search"><span className="sr-only">Buscar por nome</span><input type="search" placeholder="Buscar por nome…" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} /></label><strong className="selection-count">{selectedIds.size}/12 selecionados</strong></div><div className="member-quick-actions"><button className="button secondary small-button" type="button" onClick={selectRandom}>Selecionar 12 aleatórios</button><button className="button ghost small-button" type="button" disabled={!selectedIds.size} onClick={() => setSelectedIds(new Set())}>Limpar seleção</button></div>{selectedIds.size >= MAX_POLL_OPTIONS && <p className="member-limit-message" role="status">O limite de 12 membros foi atingido.</p>}<div className="member-list" role="list">{visibleMembers.map((member) => { const selected = selectedIds.has(member.id); return <label key={member.id} className={`member-card${selected ? ' selected' : ''}`} role="checkbox" tabIndex={0} aria-checked={selected} onClick={(event) => { event.preventDefault(); toggle(member.id); }} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(member.id); } }}><MemberAvatar groupId={groupId} member={member} /><span className="member-copy"><strong>{member.name}</strong><small>{member.numberHint || 'Identificador indisponível'}</small></span><input type="checkbox" tabIndex={-1} checked={selected} readOnly /><span className="member-check" aria-hidden="true">✓</span></label>; })}</div>{!visibleMembers.length && <p className="member-empty">Nenhum membro encontrado nessa busca.</p>}</div>}<div className="member-dialog-actions"><button className="button secondary" type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="button primary dialog-primary" type="button" disabled={!selectedIds.size} onClick={apply}>Usar selecionados</button></div></div></dialog>;
  return <>
    <button className="button ghost" type="button" disabled={loading} onClick={() => void open()}>{loading ? 'Carregando membros…' : '♙ Selecionar membros'}</button>
    {createPortal(memberDialog, document.body)}
  </>;
}
