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
          <div className="marine-circle-container animate-fade-in">
            <div className="marine-circle-outer">
              <div className="marine-circle-inner glass">
                <div className="sururu-illustration">
                  <div className="shell shell-left"></div>
                  <div className="shell shell-right"></div>
                  <div className="pearl"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MarineLife;
