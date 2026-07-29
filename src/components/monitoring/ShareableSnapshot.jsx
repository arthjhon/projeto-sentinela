import React, { forwardRef } from 'react';
import { WATER_PARAMS, classifyParam, computeWQI } from '../../config/waterQuality';

// Card de snapshot compartilhável (5.5).
//
// Renderiza FORA da tela e é capturado pelo html2canvas sob demanda. Estilo
// próprio, com cores sólidas — nada de gradiente, backdrop-filter ou a função
// CSS color(): o html2canvas 1.4.1 quebra ao encontrar `color(srgb ...)`, que
// é como o Chrome novo serializa os gradientes translúcidos do glassmorphism.
// Este card evita o problema na raiz, e de quebra sai mais legível que uma foto
// da tela (fundo sólido, sem blur).
//
// Tudo em estilo inline: vira rgb/rgba no computed style, que o html2canvas lê
// sem depender de nenhum CSS externo carregado.

const S = {
  card: {
    position: 'absolute', left: '-99999px', top: 0,       // fora da tela
    width: '640px', boxSizing: 'border-box',
    padding: '28px 32px',
    background: '#0a1524',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    fontFamily: "'Outfit', system-ui, sans-serif",
    color: '#e2e8f0',
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logo: { height: '46px', width: 'auto', display: 'block' },
  brand: { fontSize: '20px', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.5px' },
  brandWhite: { color: '#ffffff' },
  sub: { margin: '4px 0 22px', fontSize: '13px', color: '#94a3b8' },
  grid: { display: 'flex', gap: '12px' },
  tile: {
    flex: 1, padding: '16px 14px', borderRadius: '12px',
    background: '#0e1c30', border: '1px solid rgba(255,255,255,0.06)',
  },
  tileLabel: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#94a3b8' },
  tileValue: { fontSize: '28px', fontWeight: 700, lineHeight: 1.1, marginTop: '6px' },
  tileUnit: { fontSize: '14px', fontWeight: 600, marginLeft: '3px' },
  tileHint: { fontSize: '11px', fontWeight: 600, marginTop: '4px' },
  footer: {
    display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px',
    marginTop: '22px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)',
    fontSize: '12px', color: '#64748b',
  },
};

const ShareableSnapshot = forwardRef(function ShareableSnapshot({ reading, boia, fonte, quando }, ref) {
  const wqi = computeWQI(reading);

  return (
    <div ref={ref} style={S.card} aria-hidden="true">
      <div style={S.brandRow}>
        {/* PNG pequeno (não o SVG de 1.2 MB nem a PNG opaca): o html2canvas
            desenha PNG com transparência de forma confiável. */}
        <img src="/sentinela-logo-mark.png" alt="" style={S.logo} />
        <span style={S.brand}>PROJETO <span style={S.brandWhite}>SENTINELA</span></span>
      </div>
      <p style={S.sub}>{boia.id} · {boia.name} — {boia.location}</p>

      <div style={S.grid}>
        {WATER_PARAMS.map(param => {
          const val = reading?.[param.key];
          const c = classifyParam(param.key, val);
          return (
            <div key={param.key} style={S.tile}>
              <div style={S.tileLabel}>{param.label}</div>
              <div style={{ ...S.tileValue, color: param.color }}>
                {val != null ? val.toFixed(param.decimals) : '--'}
                {param.unit && <span style={S.tileUnit}>{param.unit}</span>}
              </div>
              <div style={{ ...S.tileHint, color: c ? c.color : '#64748b' }}>
                {c ? c.text : 'sem leitura'}
              </div>
            </div>
          );
        })}

        {/* WQI como tile de número sólido (sem o gauge SVG, para não arriscar) */}
        <div style={S.tile}>
          <div style={S.tileLabel}>Qualidade</div>
          <div style={{ ...S.tileValue, color: wqi ? wqi.color : '#64748b' }}>
            {wqi ? wqi.score : '--'}
          </div>
          <div style={{ ...S.tileHint, color: wqi ? wqi.color : '#64748b' }}>
            {wqi ? wqi.level : 'sem leitura'}
          </div>
        </div>
      </div>

      <div style={S.footer}>
        <span>{fonte}</span>
        <span>{quando}</span>
      </div>
    </div>
  );
});

export default ShareableSnapshot;
