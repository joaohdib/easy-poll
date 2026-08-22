import type { ConnectionStatusName } from '../../types/api';
import { WHATSAPP_STATUS_COPY } from '../../hooks/useWhatsAppStatus';

interface WhatsAppStatusProps {
  disconnecting: boolean;
  hint: string;
  qrDataUrl: string | null;
  status: ConnectionStatusName;
  onDisconnect: () => void;
}

export function WhatsAppStatus({ disconnecting, hint, qrDataUrl, status, onDisconnect }: WhatsAppStatusProps) {
  const connected = status === 'connected';
  return <section className="status-card card" aria-labelledby="status-title"><div className="section-heading"><div><p className="step">Conexão</p><h2 id="status-title">Status do WhatsApp</h2></div><div className="status-actions"><div className={`status-badge ${status}`}><span className="status-dot" /><span>{status === 'disconnected' && hint.includes('servidor local') ? 'Servidor offline' : WHATSAPP_STATUS_COPY[status][0]}</span></div>{connected && <button className="disconnect-button" type="button" disabled={disconnecting} onClick={onDisconnect}>{disconnecting ? 'Desconectando…' : 'Desconectar'}</button>}</div></div>{status === 'waiting_qr' && qrDataUrl && <div className="qr-panel"><div className="qr-frame"><img src={qrDataUrl} alt="QR Code para conectar ao WhatsApp" /></div><div><h3>Escaneie com seu celular</h3><ol><li>Abra o WhatsApp no celular.</li><li>Vá em <strong>Configurações → Aparelhos conectados</strong>.</li><li>Toque em <strong>Conectar um aparelho</strong>.</li></ol></div></div>}<p className="connection-hint">{hint}</p></section>;
}
