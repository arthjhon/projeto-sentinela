import React, { useState } from 'react';
import { Heart, QrCode, Mail, TrendingUp, Cpu, Copy, CheckCircle2 } from 'lucide-react';
import './SupportUsPage.css';

const SupportUsPage = () => {
  const [copied, setCopied] = useState(false);
  const pixKey = "apoio@projetosentinela.com.br"; // Chave mockup

  const handleCopy = () => {
    navigator.clipboard.writeText(pixKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="public-page-container">
      <div className="text-center mb-5">
        <div className="heart-icon-wrapper mb-3 mx-auto">
           <Heart size={48} color="var(--danger)" fill="rgba(255, 59, 59, 0.2)" />
        </div>
        <h1 className="gradient-text mb-3">Apoie a Proteção das Lagoas</h1>
        <p className="subtitle mx-auto" style={{ maxWidth: '800px' }}>
          O Projeto Sentinela é uma iniciativa com custos de hardware, baterias, conexões de dados (IoT) e nuvem.
          Toda ajuda é convertida diretamente na expansão da rede de bóias de monitoramento da vida marinha de Alagoas.
        </p>
      </div>

      <div className="support-split-layout mt-5">
        
        {/* DOATION PANEL */}
        <div className="support-card glass animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <h2 className="text-white mb-2">Contribuição Direta (PIX)</h2>
          <p className="text-muted mb-4">Ajude a custear chips de celular (MQTT), sensores de ph, e manutenções mecânicas nas bóias.</p>
          
          <div className="qr-code-box mx-auto mb-4">
             <QrCode size={120} color="#fff" strokeWidth={1} />
             <div className="qr-scan-line"></div>
          </div>

          <div className="copy-pix-box">
             <span className="pix-key-text">{pixKey}</span>
             <button className="btn-copy" onClick={handleCopy} title="Copiar Chave">
                {copied ? <CheckCircle2 size={18} color="var(--success)"/> : <Copy size={18} />}
             </button>
          </div>
          {copied && <span className="copy-success-text mt-2 block text-success" style={{fontSize: '0.8rem'}}>Chave copiada!</span>}
        </div>

        {/* PARTERNSHIP PANEL */}
        <div className="support-card glass align-left animate-fade-in" style={{ animationDelay: '0.2s', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h2 className="text-white mb-4">Patrocínio Corporativo</h2>
          
          <ul className="benefits-list mb-4">
            <li>
               <div className="benefit-icon"><TrendingUp size={20} color="var(--success)"/></div>
               <div>
                 <strong>Escalabilidade de Impacto</strong>
                 <p className="text-muted text-sm">Empresas parceiras têm suas logomarcas anexadas à página de apoiadores e materiais de pesquisa acadêmica oficial na UMJ.</p>
               </div>
            </li>
             <li>
               <div className="benefit-icon"><Cpu size={20} color="var(--warning)"/></div>
               <div>
                 <strong>Fornecimento de Hardware</strong>
                 <p className="text-muted text-sm">Se sua empresa comercializa soluções em IoT, painéis solares pequenos ou circuitos, você pode apoiar fornecendo peças.</p>
               </div>
            </li>
          </ul>

          <div className="contact-box p-3 rounded" style={{background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)'}}>
             <p className="text-white font-medium mb-2 d-flex-align gap-2"><Mail size={16} color="var(--primary)"/> Fale com a coordenação:</p>
             <a href="mailto:contato@projetosentinela.com.br" className="text-primary hover-underline">contato@projetosentinela.com.br</a>
          </div>
        </div>

      </div>
    </div>
  );
};

export default SupportUsPage;
