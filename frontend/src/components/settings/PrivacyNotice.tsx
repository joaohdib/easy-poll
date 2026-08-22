import { ShieldCheck } from 'lucide-react';

export function PrivacyNotice() {
  return <section className="card settings-privacy" aria-labelledby="settings-privacy-title"><ShieldCheck aria-hidden="true" /><div><p className="step">Privacidade local</p><h2 id="settings-privacy-title">Seus dados permanecem neste computador</h2><p>O EasyPoll armazena apenas informações necessárias sobre enquetes e sincronização. O conteúdo de mensagens comuns do WhatsApp não é armazenado.</p></div></section>;
}
