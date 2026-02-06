// Procedural audio system using Web Audio API

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;

function ensureGains() {
  const ctx = getCtx();
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.connect(masterGain);
    musicGain = ctx.createGain();
    musicGain.connect(masterGain);
  }
}

export function setVolumes(master: number, sfx: number, music: number) {
  ensureGains();
  if (masterGain) masterGain.gain.value = master;
  if (sfxGain) sfxGain.gain.value = sfx;
  if (musicGain) musicGain.gain.value = music;
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', vol = 0.3, dest?: GainNode) {
  try {
    const ctx = getCtx();
    ensureGains();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(dest || sfxGain || ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch { /* audio not available */ }
}

function playNoise(duration: number, vol = 0.1) {
  try {
    const ctx = getCtx();
    ensureGains();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * vol;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.5;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain || ctx.destination);
    source.start();
  } catch { /* audio not available */ }
}

export function playCheckpointSound() {
  playTone(880, 0.15, 'sine', 0.4);
  setTimeout(() => playTone(1100, 0.15, 'sine', 0.3), 80);
  setTimeout(() => playTone(1320, 0.2, 'sine', 0.3), 160);
}

export function playCollisionSound(severity: number) {
  playNoise(0.3 + severity * 0.2, 0.2 + severity * 0.1);
  playTone(100 + severity * 50, 0.3, 'sawtooth', 0.15);
}

export function playPowerupSound() {
  playTone(600, 0.1, 'sine', 0.3);
  setTimeout(() => playTone(800, 0.1, 'sine', 0.3), 50);
  setTimeout(() => playTone(1200, 0.15, 'sine', 0.4), 100);
  setTimeout(() => playTone(1600, 0.2, 'sine', 0.3), 150);
}

export function playCoinSound() {
  playTone(1200, 0.1, 'sine', 0.2);
  setTimeout(() => playTone(1500, 0.15, 'sine', 0.15), 60);
}

export function playCountdownBeep(final = false) {
  if (final) {
    playTone(880, 0.3, 'square', 0.4);
    setTimeout(() => playTone(1760, 0.4, 'square', 0.3), 100);
  } else {
    playTone(440, 0.2, 'square', 0.3);
  }
}

export function playVictoryFanfare() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 0.3, 'sine', 0.3), i * 150);
  });
  setTimeout(() => {
    playTone(1047, 0.8, 'sine', 0.4);
    playTone(784, 0.8, 'sine', 0.2);
    playTone(523, 0.8, 'sine', 0.15);
  }, 700);
}

export function playDefeatSound() {
  playTone(400, 0.3, 'sine', 0.3);
  setTimeout(() => playTone(350, 0.3, 'sine', 0.25), 200);
  setTimeout(() => playTone(300, 0.5, 'sine', 0.2), 400);
}

export function playAchievementSound() {
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 0.2, 'sine', 0.25), i * 100);
  });
}

export function playUIClick() {
  playTone(800, 0.05, 'sine', 0.15);
}

export function playUIHover() {
  playTone(600, 0.03, 'sine', 0.08);
}

export function playLevelUp() {
  const notes = [400, 500, 600, 800, 1000, 1200];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 0.15, 'sine', 0.3), i * 80);
  });
}

export function playStallWarning() {
  playTone(200, 0.5, 'square', 0.2);
}

export function playBoostSound() {
  playNoise(0.1, 0.15);
  playTone(150, 0.5, 'sawtooth', 0.1);
}

// Engine sound simulation
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;

export function startEngineSound() {
  try {
    const ctx = getCtx();
    ensureGains();
    if (engineOsc) return;
    engineOsc = ctx.createOscillator();
    engineGain = ctx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 80;
    engineGain.gain.value = 0.05;
    engineOsc.connect(engineGain);
    engineGain.connect(sfxGain || ctx.destination);
    engineOsc.start();
  } catch { /* audio not available */ }
}

export function updateEngineSound(speed: number, throttle: number) {
  if (!engineOsc || !engineGain) return;
  const freq = 60 + speed * 0.8 + throttle * 40;
  const vol = 0.02 + throttle * 0.06;
  try {
    engineOsc.frequency.value = Math.min(freq, 400);
    engineGain.gain.value = Math.min(vol, 0.1);
  } catch { /* audio context issue */ }
}

export function stopEngineSound() {
  if (engineOsc) {
    try { engineOsc.stop(); } catch { /* already stopped */ }
    engineOsc = null;
    engineGain = null;
  }
}

// Background music using oscillators
let musicPlaying = false;
let musicInterval: ReturnType<typeof setInterval> | null = null;

export function startMusic(type: 'menu' | 'race' | 'victory' = 'menu') {
  if (musicPlaying) stopMusic();
  musicPlaying = true;
  
  const patterns: Record<string, number[][]> = {
    menu: [[262, 0.5], [330, 0.5], [392, 0.5], [330, 0.5], [262, 0.5], [220, 0.5], [262, 1]],
    race: [[330, 0.2], [440, 0.2], [330, 0.2], [550, 0.2], [440, 0.2], [330, 0.2], [262, 0.2], [330, 0.2]],
    victory: [[523, 0.3], [659, 0.3], [784, 0.3], [1047, 0.6]],
  };

  const pattern = patterns[type] || patterns.menu;
  let noteIndex = 0;
  
  const playNext = () => {
    if (!musicPlaying) return;
    const [freq, dur] = pattern[noteIndex % pattern.length];
    try {
      const ctx = getCtx();
      ensureGains();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur * 0.9);
      osc.connect(gain);
      gain.connect(musicGain || ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
    } catch { /* audio not available */ }
    noteIndex++;
  };

  playNext();
  musicInterval = setInterval(playNext, (pattern[noteIndex % pattern.length]?.[1] || 0.5) * 1000);
}

export function stopMusic() {
  musicPlaying = false;
  if (musicInterval) {
    clearInterval(musicInterval);
    musicInterval = null;
  }
}
