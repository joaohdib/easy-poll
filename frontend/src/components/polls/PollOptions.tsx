import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MAX_POLL_OPTIONS, parseBulkOptions } from '../../utils/polls';

interface PollOptionsProps {
  children?: ReactNode;
  options: string[];
  onChange: (options: string[]) => void;
  showToast: (message: string, error?: boolean) => void;
}

export function PollOptions({ children, options, onChange, showToast }: PollOptionsProps) {
  const [bulkText, setBulkText] = useState('');
  const [bulkMode, setBulkMode] = useState<'replace' | 'append'>('replace');
  const [bulkFeedback, setBulkFeedback] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const filledOptions = options.map((option) => option.trim()).filter(Boolean);

  function updateOption(index: number, value: string) {
    onChange(options.map((item, itemIndex) => itemIndex === index ? value : item));
  }
  function addOption() {
    if (options.length >= MAX_POLL_OPTIONS) {
      showToast('Uma enquete pode ter no máximo 12 opções.', true);
      return;
    }
    onChange([...options, '']);
  }
  function removeOption(index: number) {
    if (options.length > 2) onChange(options.filter((_, itemIndex) => itemIndex !== index));
  }
  function openDialog() {
    setBulkText('');
    setBulkFeedback('');
    setBulkMode('replace');
    dialog.current?.showModal();
  }
  function importBulk(event: FormEvent) {
    event.preventDefault();
    const imported = parseBulkOptions(bulkText);
    const combined = [...(bulkMode === 'append' ? filledOptions : []), ...imported];
    const normalized = combined.map((option) => option.toLocaleLowerCase('pt-BR'));
    const duplicate = combined.find((_, index) => normalized.indexOf(normalized[index]) !== index);
    if (!imported.length) { setBulkFeedback('Cole pelo menos uma opção válida.'); return; }
    if (duplicate) { setBulkFeedback(`A opção “${duplicate}” está duplicada. Remova a repetição para continuar.`); return; }
    if (combined.length > MAX_POLL_OPTIONS) { setBulkFeedback(`Foram encontradas ${combined.length} opções, mas o WhatsApp permite no máximo 12. Remova algumas antes de continuar.`); return; }
    if (combined.some((option) => option.length > 100)) { setBulkFeedback('Cada opção deve ter no máximo 100 caracteres.'); return; }
    onChange([...combined, ...Array(Math.max(0, 2 - combined.length)).fill('')]);
    dialog.current?.close();
    showToast(`${imported.length} ${imported.length === 1 ? 'opção importada' : 'opções importadas'} com sucesso.`);
  }

  const bulkDialog = <dialog ref={dialog} className="app-dialog bulk-dialog" aria-labelledby="bulk-dialog-title" onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}><form method="dialog" className="dialog-shell" onSubmit={importBulk}><div className="dialog-header"><div><p className="step">Atalho de produtividade</p><h2 id="bulk-dialog-title">Colar várias opções</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={() => dialog.current?.close()}>×</button></div><p className="dialog-description">Use uma opção por linha. Em uma única linha, vírgulas e ponto e vírgulas também são aceitos.</p><label className="bulk-text-label" htmlFor="bulk-text">Opções</label><textarea id="bulk-text" rows={8} placeholder={'Minecraft\nValorant\nGartic\nStop'} value={bulkText} onChange={(event) => setBulkText(event.target.value)} />{filledOptions.length > 0 && <fieldset className="bulk-mode"><legend>Já existem opções preenchidas</legend><label><input type="radio" name="bulkMode" value="replace" checked={bulkMode === 'replace'} onChange={() => setBulkMode('replace')} /> Substituir opções atuais</label><label><input type="radio" name="bulkMode" value="append" checked={bulkMode === 'append'} onChange={() => setBulkMode('append')} /> Adicionar às opções atuais</label></fieldset>}{bulkFeedback && <p className="bulk-feedback" role="alert">{bulkFeedback}</p>}<div className="dialog-actions"><button className="button secondary" type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="button primary dialog-primary" type="submit">Importar opções</button></div></form></dialog>;
  return <>
    <div className="field"><div className="label-row"><label>Opções</label><span>{options.length} opções</span></div><div className="options-list">{options.map((option, index) => <div className="option-row" key={index}><input className="poll-option" maxLength={100} placeholder={`Opção ${index + 1}`} aria-label={`Opção ${index + 1}`} required value={option} onChange={(event) => updateOption(index, event.target.value)} /><button className="remove-option" type="button" aria-label={`Remover opção ${index + 1}`} disabled={options.length <= 2} onClick={() => removeOption(index)}>×</button></div>)}</div><div className="option-actions"><button className="button ghost" type="button" disabled={options.length >= MAX_POLL_OPTIONS} onClick={addOption}>＋ Adicionar opção</button><button className="button ghost" type="button" onClick={openDialog}>▤ Colar várias opções</button>{children}</div></div>
    {createPortal(bulkDialog, document.body)}
  </>;
}
