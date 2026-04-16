import React from 'react';
import { Fish, ShieldAlert, HeartPulse } from 'lucide-react';
import './MarineLife.css';

const MarineLife = () => {
  return (
    <section id="marine-life" className="marine-life-section section-container">
      <div className="marine-content">
        <div className="marine-text">
          <h2 className="section-title">Impacto na Vida Marinha</h2>
          <p className="marine-description">
            O <strong>Sururu</strong> (<em>Mytella charruana</em>) é um molusco bivalve filtrador essencial. Ele atua como um verdadeiro 'termômetro' da saúde da lagoa. Quando a qualidade da água cai, a população de sururu é a primeira a sofrer, impactando toda a teia alimentar e a economia local.
          </p>

          <ul className="marine-impact-list">
            <li className="impact-item">
              <div className="impact-icon-wrapper">
                <ShieldAlert className="impact-icon warning" />
              </div>
              <div>
                <h4>Vulnerabilidade à Poluição</h4>
                <p>Sendo animais filtradores, eles acumulam toxinas, metais pesados e bactérias presentes na água contaminada.</p>
              </div>
            </li>
            <li className="impact-item">
              <div className="impact-icon-wrapper">
                <Fish className="impact-icon" />
              </div>
              <div>
                <h4>Desequilíbrio na Cadeia Alimentar</h4>
                <p>A mortandade do sururu afeta peixes, crustáceos e aves que dependem dele como fonte primária de alimento.</p>
              </div>
            </li>
            <li className="impact-item">
              <div className="impact-icon-wrapper">
                <HeartPulse className="impact-icon success" />
              </div>
              <div>
                <h4>Nossa Esperança</h4>
                <p>Monitorando e agindo rapidamente, podemos promover o repovoamento e garantir o ciclo da vida marinha e do pescador.</p>
              </div>
            </li>
          </ul>
        </div>
        
        <div className="marine-visual">
          <div className="lagoon-scene animate-fade-in">
            <svg viewBox="0 0 360 400" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Ilustração do ecossistema da lagoa com bóia de monitoramento">
              <defs>
                <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#060b12"/>
                  <stop offset="100%" stopColor="#0a1a2e"/>
                </linearGradient>
                <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(0,120,180,0.12)"/>
                  <stop offset="100%" stopColor="rgba(0,30,80,0.35)"/>
                </linearGradient>
                <linearGradient id="seabedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0a1628"/>
                  <stop offset="100%" stopColor="#060d18"/>
                </linearGradient>
                <radialGradient id="antGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.6"/>
                  <stop offset="100%" stopColor="#00f0ff" stopOpacity="0"/>
                </radialGradient>
                <radialGradient id="depthFade" cx="50%" cy="100%" r="60%">
                  <stop offset="0%" stopColor="#000a18" stopOpacity="0.8"/>
                  <stop offset="100%" stopColor="transparent" stopOpacity="0"/>
                </radialGradient>
                <clipPath id="sceneClip">
                  <rect width="360" height="400" rx="14"/>
                </clipPath>
              </defs>

              <g clipPath="url(#sceneClip)">
                {/* Sky */}
                <rect width="360" height="400" fill="url(#skyGrad)"/>

                {/* Water body */}
                <rect x="0" y="155" width="360" height="245" fill="url(#waterGrad)"/>

                {/* Depth fade at bottom */}
                <rect x="0" y="280" width="360" height="120" fill="url(#depthFade)"/>

                {/* Subtle depth grid lines */}
                <line x1="0" y1="210" x2="360" y2="210" stroke="rgba(255,255,255,0.025)" strokeWidth="1"/>
                <line x1="0" y1="275" x2="360" y2="275" stroke="rgba(255,255,255,0.02)" strokeWidth="1"/>
                <line x1="0" y1="340" x2="360" y2="340" stroke="rgba(255,255,255,0.015)" strokeWidth="1"/>
                <text x="8" y="208" fontSize="7" fill="rgba(0,240,255,0.2)" fontFamily="monospace">0.5m</text>
                <text x="8" y="273" fontSize="7" fill="rgba(0,240,255,0.15)" fontFamily="monospace">1.5m</text>
                <text x="8" y="338" fontSize="7" fill="rgba(0,240,255,0.1)" fontFamily="monospace">2.5m</text>

                {/* Wave surface - layer 1 */}
                <path className="wave wave-bg" d="M0,160 Q40,150 90,160 Q140,170 180,160 Q220,150 270,160 Q310,170 360,160 L360,175 Q310,183 270,175 Q220,165 180,175 Q140,183 90,175 Q40,165 0,175 Z" fill="rgba(0,240,255,0.05)"/>
                {/* Wave surface - layer 2 */}
                <path className="wave wave-top" d="M0,157 Q45,147 90,157 Q135,167 180,157 Q225,147 270,157 Q315,167 360,157" stroke="rgba(0,240,255,0.35)" strokeWidth="1.5" fill="none"/>
                {/* Wave surface - layer 3 subtle */}
                <path className="wave wave-sub" d="M0,163 Q60,156 120,163 Q180,170 240,163 Q300,156 360,163" stroke="rgba(0,240,255,0.12)" strokeWidth="1" fill="none"/>

                {/* ── BUOY SM-01 ── */}
                {/* Mast */}
                <rect x="178" y="95" width="2" height="64" fill="#475569"/>
                {/* Antenna */}
                <line x1="179" y1="95" x2="179" y2="72" stroke="#334155" strokeWidth="1.5"/>
                {/* Antenna LED glow */}
                <circle cx="179" cy="70" r="10" fill="url(#antGlow)" className="ant-ring"/>
                <circle cx="179" cy="70" r="3.5" fill="#00f0ff" className="ant-dot"/>

                {/* Buoy body */}
                <ellipse cx="179" cy="163" rx="22" ry="9" fill="#1a3a5c" stroke="rgba(0,240,255,0.3)" strokeWidth="1"/>
                <rect x="157" y="154" width="44" height="14" rx="7" fill="#1a3a5c" stroke="rgba(0,240,255,0.25)" strokeWidth="1"/>
                <rect x="157" y="157" width="44" height="5" fill="rgba(0,240,255,0.45)" rx="1"/>
                <ellipse cx="179" cy="168" rx="22" ry="9" fill="#122d4a"/>

                {/* SM-01 tag */}
                <rect x="188" y="84" width="38" height="16" rx="4" fill="rgba(0,240,255,0.1)" stroke="rgba(0,240,255,0.3)" strokeWidth="0.8"/>
                <text x="207" y="96" fontSize="7.5" fill="#00f0ff" fontFamily="monospace" textAnchor="middle" fontWeight="700">SM-01</text>

                {/* ── SENSOR CABLE + PROBE ── */}
                <line x1="179" y1="170" x2="179" y2="305" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="5 4"/>
                {/* Probe body */}
                <rect x="172" y="302" width="14" height="24" rx="7" fill="#0d2035" stroke="rgba(0,240,255,0.4)" strokeWidth="1"/>
                <rect x="175" y="306" width="8" height="4" rx="1" fill="rgba(0,240,255,0.6)"/>
                <rect x="175" y="313" width="8" height="4" rx="1" fill="rgba(245,158,11,0.55)"/>
                <rect x="175" y="320" width="8" height="3" rx="1" fill="rgba(16,185,129,0.55)"/>

                {/* ── FISH ── */}
                {/* Fish 1 - left, mid depth */}
                <g className="fish fish-1">
                  <ellipse cx="55" cy="225" rx="20" ry="8" fill="rgba(0,170,200,0.22)" stroke="rgba(0,220,255,0.28)" strokeWidth="0.8"/>
                  <polygon points="35,225 22,233 22,217" fill="rgba(0,160,190,0.18)"/>
                  <circle cx="68" cy="221" r="2.2" fill="rgba(255,255,255,0.5)"/>
                  <line x1="45" y1="219" x2="45" y2="231" stroke="rgba(0,220,255,0.15)" strokeWidth="0.5"/>
                  <line x1="52" y1="218" x2="52" y2="232" stroke="rgba(0,220,255,0.15)" strokeWidth="0.5"/>
                </g>

                {/* Fish 2 - right, deeper */}
                <g className="fish fish-2">
                  <ellipse cx="295" cy="248" rx="14" ry="5.5" fill="rgba(0,140,180,0.18)" stroke="rgba(0,200,230,0.22)" strokeWidth="0.7"/>
                  <polygon points="281,248 270,254 270,242" fill="rgba(0,130,170,0.14)"/>
                  <circle cx="305" cy="245" r="1.8" fill="rgba(255,255,255,0.45)"/>
                </g>

                {/* Fish 3 - small, left deeper */}
                <g className="fish fish-3">
                  <ellipse cx="90" cy="268" rx="11" ry="4.5" fill="rgba(16,185,129,0.18)" stroke="rgba(16,185,129,0.25)" strokeWidth="0.7"/>
                  <polygon points="79,268 70,273 70,263" fill="rgba(16,185,129,0.12)"/>
                  <circle cx="98" cy="265" r="1.5" fill="rgba(255,255,255,0.4)"/>
                </g>

                {/* Fish 4 - tiny, right area */}
                <g className="fish fish-4">
                  <ellipse cx="270" cy="288" rx="9" ry="3.5" fill="rgba(0,150,200,0.15)" stroke="rgba(0,200,240,0.2)" strokeWidth="0.6"/>
                  <polygon points="261,288 254,292 254,284" fill="rgba(0,140,190,0.1)"/>
                  <circle cx="276" cy="286" r="1.3" fill="rgba(255,255,255,0.35)"/>
                </g>

                {/* ── DATA READING BADGES ── */}
                <g className="data-badge badge-ph">
                  <rect x="26" y="178" width="52" height="22" rx="11" fill="rgba(0,240,255,0.07)" stroke="rgba(0,240,255,0.3)" strokeWidth="0.8"/>
                  <text x="52" y="193" fontSize="9" fill="#00f0ff" textAnchor="middle" fontFamily="monospace" fontWeight="600">pH 7.2</text>
                </g>

                <g className="data-badge badge-temp">
                  <rect x="258" y="190" width="72" height="22" rx="11" fill="rgba(239,68,68,0.07)" stroke="rgba(239,68,68,0.3)" strokeWidth="0.8"/>
                  <text x="294" y="205" fontSize="9" fill="#f87171" textAnchor="middle" fontFamily="monospace" fontWeight="600">26.3 °C</text>
                </g>

                <g className="data-badge badge-od">
                  <rect x="30" y="285" width="62" height="22" rx="11" fill="rgba(16,185,129,0.07)" stroke="rgba(16,185,129,0.28)" strokeWidth="0.8"/>
                  <text x="61" y="300" fontSize="9" fill="#34d399" textAnchor="middle" fontFamily="monospace" fontWeight="600">OD 6.8</text>
                </g>

                <g className="data-badge badge-turb">
                  <rect x="252" y="300" width="80" height="22" rx="11" fill="rgba(245,158,11,0.07)" stroke="rgba(245,158,11,0.28)" strokeWidth="0.8"/>
                  <text x="292" y="315" fontSize="9" fill="#fbbf24" textAnchor="middle" fontFamily="monospace" fontWeight="600">3.2 NTU</text>
                </g>

                {/* ── SURURU BED (bottom) ── */}
                {[
                  [18,385], [55,388], [95,383], [135,387], [172,384],
                  [210,388], [248,383], [288,386], [322,384], [348,388]
                ].map(([x, y], i) => (
                  <g key={i} transform={`translate(${x},${y})`}>
                    <ellipse cx="8" cy="-5" rx="11" ry="5" fill="rgba(71,85,105,0.45)" stroke="rgba(100,116,139,0.3)" strokeWidth="0.6" transform="rotate(-15)"/>
                    <ellipse cx="9" cy="1" rx="11" ry="5" fill="rgba(51,65,85,0.4)" stroke="rgba(100,116,139,0.2)" strokeWidth="0.6" transform="rotate(15)"/>
                    <ellipse cx="9" cy="-2" rx="3" ry="2" fill="rgba(148,163,184,0.15)"/>
                  </g>
                ))}

                {/* ── RISING BUBBLES ── */}
                <circle cx="108" cy="340" r="3" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" className="bubble b1"/>
                <circle cx="215" cy="355" r="2" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" className="bubble b2"/>
                <circle cx="260" cy="335" r="4" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" className="bubble b3"/>
                <circle cx="148" cy="348" r="2.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" className="bubble b4"/>
                <circle cx="310" cy="360" r="2" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" className="bubble b5"/>

                {/* ── BORDER ── */}
                <rect width="360" height="400" rx="14" fill="none" stroke="rgba(0,240,255,0.08)" strokeWidth="1"/>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MarineLife;
