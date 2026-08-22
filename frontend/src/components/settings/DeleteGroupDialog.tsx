import { useRef, useState } from 'react';
import type { StoredGroupSummary } from '../../types/api';
import { numberFormatter, plural } from '../../utils/format';
import { Button } from '../ui/button';

interface DeleteGroupDialogProps {
  group: StoredGroupSummary;
  onConfirm: () => Promise<void>;
}

export function DeleteGroupDialog({ group, onConfirm }: DeleteGroupDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      dialog.current?.close();
    } catch {
      // The page presents the API error in a toast and the dialog remains open.
    } finally {
      setPending(false);
    }
  }

  return <>
    <Button variant="destructive" size="sm" type="button" onClick={() => dialog.current?.showModal()}>Limpar dados locais</Button>
    <dialog ref={dialog} className="app-dialog settings-dialog" aria-labelledby={`delete-${group.id}-title`} onClick={(event) => { if (event.target === dialog.current && !pending) dialog.current.close(); }}>
      <div className="dialog-shell">
        <div className="dialog-header"><div><p className="step">Dados deste grupo</p><h2 id={`delete-${group.id}-title`}>Limpar dados de {group.name}?</h2></div><button className="dialog-close" type="button" aria-label="Fechar" disabled={pending} onClick={() => dialog.current?.close()}>×</button></div>
        <p className="dialog-description">Serão removidos do EasyPoll:</p>
        <ul className="settings-delete-summary">
          <li>{plural(group.polls, 'enquete', 'enquetes')}</li>
          <li>{plural(group.participations, 'participação', 'participações')}</li>
          <li>{plural(group.selections, 'seleção', 'seleções')}</li>
          <li>{numberFormatter.format(group.processedMessages)} mensagens indexadas</li>
        </ul>
        <p className="settings-whatsapp-warning"><strong>Isso não apaga nada do WhatsApp.</strong> Nenhuma mensagem, enquete ou informação do grupo será alterada.</p>
        <div className="dialog-actions settings-dialog-actions"><Button variant="secondary" type="button" disabled={pending} onClick={() => dialog.current?.close()}>Cancelar</Button><Button variant="destructive" type="button" disabled={pending} onClick={() => void confirm()}>{pending ? 'Limpando…' : 'Limpar dados locais'}</Button></div>
      </div>
    </dialog>
  </>;
}
