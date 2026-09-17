import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Radio, Cpu, Zap, Activity } from 'lucide-react';

export type OrbTheme = 'jarvis' | 'ultron' | 'gwen';

export interface JarvisUltronVoiceOrbProps {
  analyser?: AnalyserNode | null;
  outputAnalyser?: AnalyserNode | null;
  isActive: boolean;
  isSpeaking: boolean;
  isUserSpeaking?: boolean;
  isMuted?: boolean;
  selectedPersona?: 'jarvis' | 'gwen';
  accentColor?: string;
  themeMode?: OrbTheme;
  onThemeChange?: (theme: OrbTheme) => void;
  className?: string;
  sampleRate?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  maxAlpha: number;
  life: number;
  maxLife: number;
  color: string;
}

export const JarvisUltronVoiceOrb: React.FC<JarvisUltronVoiceOrbProps> = ({
  analyser,
  outputAnalyser,
  isActive,
  isSpeaking,
  isUserSpeaking = false,
  isMuted = false,
  selectedPersona = 'jarvis',
  accentColor: _accentColor,
  themeMode: controlledTheme,
  onThemeChange,
  className = '',
  sampleRate = 48000,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Local theme state if not externally controlled
  const [internalTheme, setInternalTheme] = useState<OrbTheme>(
    selectedPersona === 'gwen' ? 'gwen' : 'jarvis'
  );

  const currentTheme = controlledTheme || internalTheme;

  const handleToggleTheme = useCallback(
    (theme: OrbTheme) => {
      setInternalTheme(theme);
      onThemeChange?.(theme);
    },
    [onThemeChange]
  );

  // Sync with persona if persona changes and theme not overridden
  useEffect(() => {
    if (!controlledTheme) {
      setInternalTheme(selectedPersona === 'gwen' ? 'gwen' : 'jarvis');
    }
  }, [selectedPersona, controlledTheme]);

  // Audio telemetry states for HUD overlay
  const [telemetry, setTelemetry] = useState({
    peakFreq: 0,
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    sampleRateKhz: (sampleRate / 1000).toFixed(1),
    decibels: -60,
  });

  // Color palette configuration based on active theme
  const themePalette = useMemo(() => {
    switch (currentTheme) {
      case 'ultron':
        return {
          name: 'ULTRON PROTOCOL',
          primary: '#ff1744',
          secondary: '#ff5252',
          glow: 'rgba(255, 23, 68, 0.45)',
          coreInner: '#ffffff',
          coreMid: '#ff1744',
          coreOuter: '#b71c1c',
          particleColors: ['#ff1744', '#ff8a80', '#ffd600', '#ffffff'],
          border: 'border-red-500/40',
          bgGlow: 'from-red-950/40 via-transparent to-red-950/20',
          badgeText: 'text-red-400',
          badgeBg: 'bg-red-950/80 border-red-500/50',
          accent: '#ff1744',
        };
      case 'gwen':
        return {
          name: 'GWEN NEURAL FLARE',
          primary: '#f59e0b',
          secondary: '#fbbf24',
          glow: 'rgba(245, 158, 11, 0.45)',
          coreInner: '#ffffff',
          coreMid: '#f59e0b',
          coreOuter: '#b45309',
          particleColors: ['#f59e0b', '#fbbf24', '#f43f5e', '#ffffff'],
          border: 'border-amber-500/40',
          bgGlow: 'from-amber-950/40 via-transparent to-amber-950/20',
          badgeText: 'text-amber-300',
          badgeBg: 'bg-amber-950/80 border-amber-500/50',
          accent: '#f59e0b',
        };
      case 'jarvis':
      default:
        return {
          name: 'J.A.R.V.I.S. ARC ORB',
          primary: '#00f0ff',
          secondary: '#38bdf8',
          glow: 'rgba(0, 240, 255, 0.45)',
          coreInner: '#ffffff',
          coreMid: '#00f0ff',
          coreOuter: '#0369a1',
          particleColors: ['#00f0ff', '#80f7ff', '#38bdf8', '#ffffff'],
          border: 'border-[#00f0ff]/40',
          bgGlow: 'from-[#00f0ff]/10 via-transparent to-cyan-950/20',
          badgeText: 'text-[#00f0ff]',
          badgeBg: 'bg-cyan-950/80 border-[#00f0ff]/50',
          accent: '#00f0ff',
        };
    }
  }, [currentTheme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let phase = 0;
    let ringPhase1 = 0;
    let ringPhase2 = 0;
    let ringPhase3 = 0;

    // Particles system
    const particles: Particle[] = [];
    const MAX_PARTICLES = 40;

    const createParticle = (cx: number, cy: number, baseRadius: number) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = baseRadius * (0.8 + Math.random() * 0.5);
      const speed = 0.5 + Math.random() * 1.5;
      const colors = themePalette.particleColors;
      return {
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random() * 2.5,
        alpha: 0.1,
        maxAlpha: 0.4 + Math.random() * 0.6,
        life: 0,
        maxLife: 40 + Math.random() * 60,
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    };

    let lastTelemetryUpdate = 0;

    const render = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const maxDim = Math.min(width, height);
      const baseOrbRadius = Math.max(30, maxDim * 0.22);

      // Analyze real frequency data
      // Priority: outputAnalyser (Jarvis speaking) > analyser (mic speaking)
      const targetAnalyser = isSpeaking ? outputAnalyser || analyser : analyser;
      let rawFreq = new Uint8Array(64);
      let realAudioDetected = false;

      if (targetAnalyser) {
        try {
          const bins = targetAnalyser.frequencyBinCount;
          const tempBuf = new Uint8Array(bins);
          targetAnalyser.getByteFrequencyData(tempBuf);
          if (tempBuf.some((v) => v > 0)) {
            realAudioDetected = true;
            for (let i = 0; i < 64; i++) {
              rawFreq[i] = tempBuf[i] || 0;
            }
          }
        } catch {
          // ignore web audio read issues
        }
      }

      // Energy calculation
      let bass = 0;
      let mid = 0;
      let treble = 0;

      if (realAudioDetected) {
        let bSum = 0;
        let mSum = 0;
        let tSum = 0;
        for (let i = 0; i < 8; i++) bSum += rawFreq[i];
        for (let i = 8; i < 32; i++) mSum += rawFreq[i];
        for (let i = 32; i < 64; i++) tSum += rawFreq[i];
        bass = bSum / 8 / 255;
        mid = mSum / 24 / 255;
        treble = tSum / 32 / 255;
      } else if (isSpeaking) {
        // Organic simulated speech modulation if real audio element is not directly hooked
        const speechCadence = Math.sin(phase * 4) * 0.5 + 0.5;
        const formantMod = Math.sin(phase * 7.5) * 0.3 + 0.7;
        bass = (0.45 + speechCadence * 0.4) * formantMod;
        mid = 0.4 + Math.sin(phase * 11) * 0.35;
        treble = 0.3 + Math.cos(phase * 9) * 0.25;
      } else if (isUserSpeaking && !isMuted) {
        bass = 0.35 + Math.sin(phase * 3) * 0.25;
        mid = 0.3 + Math.sin(phase * 5) * 0.2;
        treble = 0.2;
      } else if (isActive) {
        // Idle breathing
        bass = 0.08 + Math.sin(phase * 1.5) * 0.04;
        mid = 0.05 + Math.cos(phase * 1.8) * 0.03;
        treble = 0.03;
      } else {
        bass = 0.02;
        mid = 0.01;
        treble = 0.01;
      }

      // Update telemetry state throttled (every 100ms)
      if (time - lastTelemetryUpdate > 100) {
        lastTelemetryUpdate = time;
        let peakIndex = 0;
        let peakVal = 0;
        for (let i = 0; i < 64; i++) {
          if (rawFreq[i] > peakVal) {
            peakVal = rawFreq[i];
            peakIndex = i;
          }
        }
        const calculatedHz = Math.round(
          peakIndex * ((sampleRate || 48000) / (targetAnalyser?.fftSize || 256))
        );
        const overallEnergy = (bass * 0.5 + mid * 0.3 + treble * 0.2) * 100;
        const dbApprox = Math.round(-60 + overallEnergy * 0.6);

        setTelemetry({
          peakFreq: calculatedHz > 0 ? calculatedHz : isSpeaking ? 340 : 0,
          bassEnergy: Math.round(bass * 100),
          midEnergy: Math.round(mid * 100),
          trebleEnergy: Math.round(treble * 100),
          sampleRateKhz: ((sampleRate || 48000) / 1000).toFixed(1),
          decibels: Math.max(-60, Math.min(0, dbApprox)),
        });
      }

      // Dynamic Pulsing Scale
      const orbScale = 1 + bass * 0.45 + (isSpeaking ? 0.12 : 0);
      const currentRadius = baseOrbRadius * orbScale;

      // ── 1. BACKGROUND ENERGY CORONA & GLOW FIELD ──
      const bgGlowRadius = currentRadius * (1.8 + mid * 0.6);
      const bgGlow = ctx.createRadialGradient(cx, cy, currentRadius * 0.3, cx, cy, bgGlowRadius);
      bgGlow.addColorStop(0, themePalette.glow);
      bgGlow.addColorStop(0.5, themePalette.glow.replace('0.45', '0.15'));
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, bgGlowRadius, 0, Math.PI * 2);
      ctx.fill();

      // ── 2. HOLOGRAPHIC GYROSCOPIC TECH RINGS ──
      // Ring 1: Outer Segments Ring (Counter-Clockwise)
      const ring1Radius = currentRadius * 1.55;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringPhase1);
      ctx.strokeStyle = themePalette.primary;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 18, 4, 18]);
      ctx.globalAlpha = 0.4 + bass * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, ring1Radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Ring 2: Mid Tech Reticle Ring with Degree Markers (Clockwise)
      const ring2Radius = currentRadius * 1.32;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringPhase2);
      ctx.strokeStyle = themePalette.secondary;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10, 2, 10]);
      ctx.globalAlpha = 0.5 + mid * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, ring2Radius, 0, Math.PI * 2);
      ctx.stroke();

      // Small notch marks along Ring 2
      const numNotches = 16;
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < numNotches; i++) {
        const ang = (i / numNotches) * Math.PI * 2;
        const x1 = Math.cos(ang) * (ring2Radius - 4);
        const y1 = Math.sin(ang) * (ring2Radius - 4);
        const x2 = Math.cos(ang) * (ring2Radius + 4);
        const y2 = Math.sin(ang) * (ring2Radius + 4);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // Ring 3: Inner High-Frequency Orbital Halo (Oscillating)
      const ring3Radius = currentRadius * 1.15;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringPhase3);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 8]);
      ctx.globalAlpha = 0.6 + treble * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, ring3Radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── 3. DYNAMIC RADIAL FREQUENCY WAVEFORM (The Ultron/Jarvis Living Filaments) ──
      const numSpikes = 64;
      ctx.save();
      ctx.translate(cx, cy);

      // Layer A: Outer Energy Waveform
      ctx.beginPath();
      for (let i = 0; i <= numSpikes; i++) {
        const angle = (i / numSpikes) * Math.PI * 2;
        const binIndex = i % 32;
        const binVal = (rawFreq[binIndex] || 0) / 255;
        const modulation = isSpeaking
          ? binVal * 0.65 + Math.sin(angle * 8 + phase * 4) * 0.15 * (bass + 0.3)
          : Math.sin(angle * 6 + phase * 2) * 0.08 * (bass + 0.1);

        const r = currentRadius * (1 + modulation);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = themePalette.primary;
      ctx.lineWidth = 2;
      ctx.shadowColor = themePalette.primary;
      ctx.shadowBlur = 12 + bass * 16;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      // Layer B: Inner High-Frequency Filament Ring
      ctx.beginPath();
      for (let i = 0; i <= numSpikes; i++) {
        const angle = (i / numSpikes) * Math.PI * 2;
        const binIndex = (i + 16) % 32;
        const binVal = (rawFreq[binIndex] || 0) / 255;
        const modulation = isSpeaking
          ? binVal * 0.45 + Math.cos(angle * 10 - phase * 5) * 0.12 * (mid + 0.2)
          : Math.cos(angle * 4 - phase * 2) * 0.05;

        const r = currentRadius * 0.85 * (1 + modulation);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = themePalette.secondary;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.restore();

      // ── 4. GLOWING PLASMA CORE (Arc Reactor / Neural Singularity) ──
      const coreGrad = ctx.createRadialGradient(
        cx - currentRadius * 0.15,
        cy - currentRadius * 0.15,
        currentRadius * 0.05,
        cx,
        cy,
        currentRadius * 0.85
      );
      coreGrad.addColorStop(0, themePalette.coreInner);
      coreGrad.addColorStop(0.35, themePalette.coreMid);
      coreGrad.addColorStop(0.8, themePalette.coreOuter);
      coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');

      ctx.save();
      ctx.fillStyle = coreGrad;
      ctx.shadowColor = themePalette.primary;
      ctx.shadowBlur = 20 + bass * 25;
      ctx.beginPath();
      ctx.arc(cx, cy, currentRadius * 0.78, 0, Math.PI * 2);
      ctx.fill();

      // White-hot inner core point
      const innerWhiteRadius = currentRadius * (0.28 + bass * 0.18);
      const innerWhite = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerWhiteRadius);
      innerWhite.addColorStop(0, '#ffffff');
      innerWhite.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
      innerWhite.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = innerWhite;
      ctx.beginPath();
      ctx.arc(cx, cy, innerWhiteRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── 5. FLOATING SPARK & PLASMA PARTICLES ──
      if (particles.length < MAX_PARTICLES && (isSpeaking || bass > 0.15)) {
        particles.push(createParticle(cx, cy, currentRadius));
      }

      ctx.save();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        const progress = p.life / p.maxLife;
        p.alpha = (1 - progress) * p.maxAlpha;

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Phase progression
      const rotSpeed = isSpeaking ? 0.035 : 0.012;
      phase += isSpeaking ? 0.08 : 0.03;
      ringPhase1 -= rotSpeed * 0.8;
      ringPhase2 += rotSpeed * 1.2;
      ringPhase3 += rotSpeed * 0.6;

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [
    analyser,
    outputAnalyser,
    isActive,
    isSpeaking,
    isUserSpeaking,
    isMuted,
    themePalette,
    sampleRate,
  ]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl bg-gradient-to-b ${themePalette.bgGlow} border ${themePalette.border} p-4 flex flex-col items-center justify-between shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden font-mono select-none ${className}`}
      style={{ minHeight: '260px' }}
    >
      {/* Background HUD Grid Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)]"
        style={{ backgroundSize: '24px 24px' }}
      />

      {/* Top HUD Telemetry Banner */}
      <div className="w-full flex items-center justify-between z-10 text-[11px] font-mono border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full animate-ping" style={{ backgroundColor: themePalette.primary }} />
          <span className={`font-bold tracking-widest uppercase ${themePalette.badgeText}`}>
            {themePalette.name}
          </span>
          <span className="text-white/40 hidden sm:inline">•</span>
          <span className="text-white/60 hidden sm:inline font-mono">
            {isSpeaking
              ? 'SPEECH RESONANCE ACTIVE'
              : isActive
              ? 'ACOUSTIC SENTINEL ARMED'
              : 'OFFLINE / STANDBY'}
          </span>
        </div>

        {/* Theme Persona Selector Badges */}
        <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded-lg border border-white/10">
          <button
            type="button"
            onClick={() => handleToggleTheme('jarvis')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
              currentTheme === 'jarvis'
                ? 'bg-[#00f0ff] text-slate-950 shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                : 'text-cyan-400/60 hover:text-cyan-200'
            }`}
          >
            JARVIS
          </button>
          <button
            type="button"
            onClick={() => handleToggleTheme('ultron')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
              currentTheme === 'ultron'
                ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(255,23,68,0.5)]'
                : 'text-red-400/60 hover:text-red-200'
            }`}
          >
            ULTRON
          </button>
          <button
            type="button"
            onClick={() => handleToggleTheme('gwen')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
              currentTheme === 'gwen'
                ? 'bg-amber-500 text-slate-950 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                : 'text-amber-400/60 hover:text-amber-200'
            }`}
          >
            GWEN
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Orb Viewport */}
      <div className="relative w-full flex-1 flex items-center justify-center my-2">
        <canvas
          ref={canvasRef}
          className="w-full h-[180px] sm:h-[220px] max-w-[420px] rounded-full filter drop-shadow-[0_0_20px_rgba(0,0,0,0.6)]"
        />

        {/* Radial Holographic HUD Overlays */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-3 text-[10px] text-white/50 font-mono">
          {/* Left HUD Panel */}
          <div className="space-y-1.5 backdrop-blur-sm bg-black/40 p-2 rounded-lg border border-white/5">
            <div className="flex items-center gap-1">
              <Activity className="size-3" style={{ color: themePalette.primary }} />
              <span className="text-white/40">FREQ:</span>
              <span className="font-bold text-white">{telemetry.peakFreq} Hz</span>
            </div>
            <div className="flex items-center gap-1">
              <Cpu className="size-3" style={{ color: themePalette.primary }} />
              <span className="text-white/40">RATE:</span>
              <span className="font-bold text-white">{telemetry.sampleRateKhz} kHz</span>
            </div>
          </div>

          {/* Right HUD Panel */}
          <div className="space-y-1.5 backdrop-blur-sm bg-black/40 p-2 rounded-lg border border-white/5 text-right">
            <div className="flex items-center justify-end gap-1">
              <span className="font-bold text-white">{telemetry.decibels} dB</span>
              <span className="text-white/40">ENERGY:</span>
              <Zap className="size-3" style={{ color: themePalette.secondary }} />
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className="font-bold text-emerald-400">{isSpeaking ? 'TRANSMITTING' : 'LISTENING'}</span>
              <Radio className="size-3 text-emerald-400 animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Audio Spectrum Band Level Indicators */}
      <div className="w-full z-10 flex items-center justify-between gap-2 pt-2 border-t border-white/10 text-[10px]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-white/40">BASS</span>
            <div className="w-12 sm:w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-75 rounded-full"
                style={{
                  width: `${Math.min(100, telemetry.bassEnergy)}%`,
                  backgroundColor: themePalette.primary,
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-white/40">MID</span>
            <div className="w-12 sm:w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-75 rounded-full"
                style={{
                  width: `${Math.min(100, telemetry.midEnergy)}%`,
                  backgroundColor: themePalette.secondary,
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-white/40">TREBLE</span>
            <div className="w-12 sm:w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-75 rounded-full"
                style={{
                  width: `${Math.min(100, telemetry.trebleEnergy)}%`,
                  backgroundColor: '#ffffff',
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-white/60">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          <span>REAL-TIME FFT 256</span>
        </div>
      </div>
    </div>
  );
};

export default JarvisUltronVoiceOrb;
