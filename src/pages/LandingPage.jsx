import React from 'react';
import Hero from '../components/Hero';
import About from '../components/About';
import WaterQuality from '../components/WaterQuality';
import MarineLife from '../components/MarineLife';
import '../App.css';

const LandingPage = () => {
  return (
    <div className="landing-sections" style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      <Hero />
      <About />
      <WaterQuality />
      <MarineLife />
    </div>
  );
};

export default LandingPage;
