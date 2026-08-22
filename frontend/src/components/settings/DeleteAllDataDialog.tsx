import { useRef, useState } from 'react';
import { Button } from '../ui/button';

const CONFIRMATION_PHRASE = 'LIMPAR TUDO';

export function DeleteAllDataDialog({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const confirmed = confirmation === CONFIRMATION_PHRASE;

  function close() {
    if (pending) return;
    dialog.current?.close();
    setConfirmation('');
  }

  async function confirm() {
    if (!confirmed || pending) return;
    setPending(true);
    try {
      await onConfirm();
      dialog.current?.close();
      setConfirmation('');
    } catch {
      // The page presents the API error in a toast and the dialog remains open.
    } finally {
      setPending(false);
    }
  }

  return <>
    <Button variant="destructive" type="button" onClick={() => dialog.current?.showModal()}>Limpar todos os dados locais</Button>
    <dialog ref={dialog} className="app-dialog settings-dialog" aria-labelledby="delete-all-title" onClick={(event) => { if (event.target === dialog.current) close(); }}>
      <div className="dialog-shell">
        <div className="dialog-header"><div><p className="step">Confirmação necessária</p><h2 id="delete-all-title">Limpar todos os dados locais?</h2></div><button className="dialog-close" type="button" aria-label="Fechar" disabled={pending} onClick={close}>×</button></div>
        <p className="dialog-description">Isso removerá do EasyPoll todos os grupos, enquetes, votos e índices locais. O banco e sua estrutura permanecerão disponíveis.</p>
        <p className="settings-whatsapp-warning"><strong>Nada será apagado do WhatsApp.</strong> A sessão, as mensagens, as enquetes e os grupos não serão alterados.</p>
        <label className="settings-confirm-label" htmlFor="delete-all-confirmation">Para confirmar, digite <strong>{CONFIRMATION_PHRASE}</strong></label>
        <input id="delete-all-confirmation" autoComplete="off" value={confirmation} disabled={pending} onChange={(event) => setConfirmation(event.target.value)} />
        <div className="dialog-actions settings-dialog-actions"><Button variant="secondary" type="button" disabled={pending} onClick={close}>Cancelar</Button><Button variant="destructive" type="button" disabled={!confirmed || pending} onClick={() => void confirm()}>{pending ? 'Limpando…' : 'Limpar tudo'}</Button></div>
      </div>
    </dialog>
  </>;
}
