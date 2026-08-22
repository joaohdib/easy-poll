import type { ConnectionStatusName } from '../../types/api';
import { WHATSAPP_STATUS_COPY } from '../../hooks/useWhatsAppStatus';
import { LogOut, QrCode } from 'lucide-react';

interface WhatsAppStatusProps {
  disconnecting: boolean;
  hint: string;
  qrDataUrl: string | null;
  status: ConnectionStatusName;
  onDisconnect: () => void;
}

export function WhatsAppStatus({ disconnecting, hint, qrDataUrl, status, onDisconnect }: WhatsAppStatusProps) {
  const connected = status === 'connected';
  const statusLabel = status === 'disconnected' && hint.includes('servidor local') ? 'Servidor offline' : WHATSAPP_STATUS_COPY[status][0];
  return <section className={`status-card card status-${status}`} aria-labelledby="status-title"><div className="status-main"><div className="status-copy"><p className="step">Conexão</p><h2 id="status-title">WhatsApp <span className={`status-badge ${status}`}><span className="status-dot" />{statusLabel}</span></h2><p className="connection-hint">{hint}</p></div>{connected && <button className="disconnect-button" type="button" disabled={disconnecting} onClick={onDisconnect}><LogOut aria-hidden="true" />{disconnecting ? 'Desconectando…' : 'Desconectar'}</button>}</div>{status === 'waiting_qr' && qrDataUrl && <div className="qr-panel"><div className="qr-frame"><img src={qrDataUrl} alt="QR Code para conectar ao WhatsApp" /></div><div><QrCode aria-hidden="true" /><h3>Escaneie com seu celular</h3><ol><li>Abra o WhatsApp no celular.</li><li>Vá em <strong>Configurações → Aparelhos conectados</strong>.</li><li>Toque em <strong>Conectar um aparelho</strong>.</li></ol></div></div>}</section>;
}
