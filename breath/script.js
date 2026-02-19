const phases = [
  { id: "inhale", instruction: "Inhale", duration: 4000, from: 0.78, to: 1.06 },
  { id: "hold-high", instruction: "Hold", duration: 4000, from: 1.06, to: 1.06 },
  { id: "exhale", instruction: "Exhale", duration: 4000, from: 1.06, to: 0.78 },
  { id: "hold-low", instruction: "Hold", duration: 4000, from: 0.78, to: 0.78 }
];

const quoteRefreshMs = 60000;
const holdReleaseMs = 240;
const minSizePercent = 55;
const maxSizePercent = 130;
const fadeDurationMs = 220;
const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
const noiseLayerGainBoost = 11;
const ambientNoiseGainBoost = 9.5;
const settingsStorageKey = "breath.settings.v1";

const nodes = {
  visualizer: document.getElementById("visualizer"),
  scene: document.getElementById("scene"),
  core: document.getElementById("breath-core"),
  instruction: document.getElementById("instruction"),
  countdown: document.getElementById("countdown"),
  elapsed: document.getElementById("elapsed"),
  quoteCard: document.getElementById("quote-card"),
  quoteText: document.getElementById("quote-text"),
  quoteRefresh: document.getElementById("quote-refresh"),
  quoteAuthor: document.getElementById("quote-author"),
  quoteAutoToggle: document.getElementById("quote-auto-toggle"),
  quoteShuffle: document.getElementById("quote-shuffle"),
  sizeSlider: document.getElementById("size-slider"),
  sizeValue: document.getElementById("size-value"),
  startPause: document.getElementById("start-pause"),
  reset: document.getElementById("reset"),
  toggleInstruction: document.getElementById("toggle-instruction"),
  toggleCountdown: document.getElementById("toggle-countdown"),
  toggleElapsed: document.getElementById("toggle-elapsed"),
  toggleQuotes: document.getElementById("toggle-quotes"),
  toggleSound: document.getElementById("toggle-sound")
};

const fadeTimers = new Map();
const fadeAnimationFrames = new Map();
const pendingFadeValues = new Map();

const state = {
  phaseIndex: 0,
  phaseId: null,
  phaseStartedAt: performance.now(),
  sessionStartedAt: performance.now(),
  quotes: [],
  quoteIndex: -1,
  quoteNextAt: 0,
  quoteTimeoutId: null,
  quoteRefreshTickerId: null,
  quoteAutoShuffle: true,
  soundEnabled: false,
  audioCtx: null,
  audioMaster: null,
  audioToneFilter: null,
  audioDry: null,
  audioWet: null,
  audioConvolver: null,
  audioLimiter: null,
  ambientVoice: null,
  activeVoices: [],
  noiseBuffer: null,
  running: true,
  pausedAt: null,
  rafId: null
};

function parseStoredBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function loadPersistedSettings() {
  try {
    const rawValue = window.localStorage.getItem(settingsStorageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    return parsedValue;
  } catch (error) {
    return null;
  }
}

function applyPersistedSettings() {
  const persisted = loadPersistedSettings();
  if (!persisted) {
    return;
  }

  const persistedSize = Number(persisted.sizePercent);
  if (Number.isFinite(persistedSize)) {
    const normalizedSize = clamp(Math.round(persistedSize), minSizePercent, maxSizePercent);
    nodes.sizeSlider.value = String(normalizedSize);
  }

  nodes.toggleSound.checked = parseStoredBoolean(persisted.soundEnabled, nodes.toggleSound.checked);
  nodes.toggleInstruction.checked = parseStoredBoolean(persisted.showInstruction, nodes.toggleInstruction.checked);
  nodes.toggleCountdown.checked = parseStoredBoolean(persisted.showCountdown, nodes.toggleCountdown.checked);
  nodes.toggleElapsed.checked = parseStoredBoolean(persisted.showElapsed, nodes.toggleElapsed.checked);
  nodes.toggleQuotes.checked = parseStoredBoolean(persisted.showQuotes, nodes.toggleQuotes.checked);
  nodes.quoteAutoToggle.checked = parseStoredBoolean(persisted.quoteAutoShuffle, nodes.quoteAutoToggle.checked);
}

function collectCurrentSettings() {
  const rawSize = Number(nodes.sizeSlider.value);
  return {
    sizePercent: clamp(Math.round(Number.isFinite(rawSize) ? rawSize : 100), minSizePercent, maxSizePercent),
    soundEnabled: nodes.toggleSound.checked,
    showInstruction: nodes.toggleInstruction.checked,
    showCountdown: nodes.toggleCountdown.checked,
    showElapsed: nodes.toggleElapsed.checked,
    showQuotes: nodes.toggleQuotes.checked,
    quoteAutoShuffle: nodes.quoteAutoToggle.checked
  };
}

function persistSettings() {
  try {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(collectCurrentSettings()));
  } catch (error) {
    // Storage can fail in private browsing or strict privacy modes.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function setVisibility(toggleNode, targetNode) {
  targetNode.classList.toggle("is-hidden", !toggleNode.checked);
}

function wireToggle(toggleNode, targetNode) {
  toggleNode.addEventListener("change", () => {
    setVisibility(toggleNode, targetNode);
    persistSettings();
  });
  setVisibility(toggleNode, targetNode);
}

function setPhaseTheme(phaseId) {
  if (state.phaseId === phaseId) {
    return;
  }

  state.phaseId = phaseId;
  document.body.dataset.phase = phaseId;
}

function ensureAudioContext() {
  if (!AudioContextCtor) {
    return null;
  }

  if (state.audioCtx && state.audioCtx.state === "closed") {
    state.audioCtx = null;
    state.audioMaster = null;
    state.audioToneFilter = null;
    state.audioDry = null;
    state.audioWet = null;
    state.audioConvolver = null;
    state.audioLimiter = null;
    state.ambientVoice = null;
    state.activeVoices = [];
    state.noiseBuffer = null;
  }

  if (!state.audioCtx) {
    state.audioCtx = new AudioContextCtor();
  }

  if (!state.audioMaster) {
    state.audioMaster = state.audioCtx.createGain();
    state.audioMaster.gain.value = 2.8;
  }

  if (!state.audioToneFilter) {
    state.audioToneFilter = state.audioCtx.createBiquadFilter();
    state.audioToneFilter.type = "lowpass";
    state.audioToneFilter.frequency.setValueAtTime(1800, state.audioCtx.currentTime);
    state.audioToneFilter.Q.setValueAtTime(0.2, state.audioCtx.currentTime);
  }

  if (!state.audioLimiter) {
    state.audioLimiter = state.audioCtx.createDynamicsCompressor();
    state.audioLimiter.threshold.setValueAtTime(-14, state.audioCtx.currentTime);
    state.audioLimiter.knee.setValueAtTime(28, state.audioCtx.currentTime);
    state.audioLimiter.ratio.setValueAtTime(3, state.audioCtx.currentTime);
    state.audioLimiter.attack.setValueAtTime(0.02, state.audioCtx.currentTime);
    state.audioLimiter.release.setValueAtTime(0.3, state.audioCtx.currentTime);
  }

  if (!state.audioConvolver) {
    state.audioDry = state.audioCtx.createGain();
    state.audioWet = state.audioCtx.createGain();
    state.audioConvolver = state.audioCtx.createConvolver();

    state.audioDry.gain.value = 0.95;
    state.audioWet.gain.value = 0.95;
    state.audioConvolver.buffer = createReverbImpulse(state.audioCtx, 4.8, 3.4);

    state.audioMaster.connect(state.audioToneFilter);
    state.audioToneFilter.connect(state.audioDry);
    state.audioToneFilter.connect(state.audioConvolver);
    state.audioConvolver.connect(state.audioWet);
    state.audioDry.connect(state.audioLimiter);
    state.audioWet.connect(state.audioLimiter);
    state.audioLimiter.connect(state.audioCtx.destination);
  }

  return state.audioCtx;
}

function resumeAudioContextIfNeeded(onReady) {
  const ctx = ensureAudioContext();
  if (!ctx) {
    return null;
  }

  if (ctx.state === "running") {
    if (typeof onReady === "function") {
      onReady(ctx);
    }
    return ctx;
  }

  if (ctx.state === "suspended" || ctx.state === "interrupted") {
    ctx.resume()
      .then(() => {
        if (ctx.state === "running" && typeof onReady === "function") {
          onReady(ctx);
        }
      })
      .catch(() => {});
  }

  return ctx;
}

function createReverbImpulse(ctx, durationSeconds, decay) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSeconds);
  const preDelayFrames = Math.floor(sampleRate * 0.024);
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
    const channel = impulse.getChannelData(channelIndex);
    let smoother = 0;
    for (let i = 0; i < length; i += 1) {
      if (i < preDelayFrames) {
        channel[i] = 0;
        continue;
      }

      const progress = (i - preDelayFrames) / Math.max(1, length - preDelayFrames);
      const envelope = Math.pow(1 - progress, decay);
      const white = Math.random() * 2 - 1;
      smoother = smoother * 0.72 + white * 0.28;
      channel[i] = smoother * envelope * (channelIndex === 0 ? 1 : 0.92);
    }
  }

  return impulse;
}

function ensureNoiseBuffer(ctx) {
  if (state.noiseBuffer) {
    return state.noiseBuffer;
  }

  const sampleRate = ctx.sampleRate;
  const frameCount = sampleRate * 2;
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  let smoother = 0;

  for (let i = 0; i < frameCount; i += 1) {
    const white = Math.random() * 2 - 1;
    smoother = smoother * 0.985 + white * 0.015;
    channel[i] = smoother;
  }

  state.noiseBuffer = buffer;
  return buffer;
}

function stopAllPhaseAudio() {
  if (!state.audioCtx || state.activeVoices.length === 0) {
    state.activeVoices = [];
    return;
  }

  const stopAt = state.audioCtx.currentTime + 0.02;
  state.activeVoices.forEach((voice) => {
    if (voice.gainNode) {
      try {
        voice.gainNode.gain.cancelScheduledValues(state.audioCtx.currentTime);
        voice.gainNode.gain.setTargetAtTime(0.0001, state.audioCtx.currentTime, 0.03);
      } catch (error) {
        // Gain node may already be disconnected.
      }
    }

    voice.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop(stopAt);
      } catch (error) {
        // Oscillators may already be stopped.
      }
    });
  });
  state.activeVoices = [];
}

function startAmbientBed() {
  if (!state.soundEnabled || !state.running) {
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running" || state.ambientVoice) {
    return;
  }

  const source = ctx.createBufferSource();
  const highpass = ctx.createBiquadFilter();
  const lowpass = ctx.createBiquadFilter();
  const bandpass = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  const driftOscillator = ctx.createOscillator();
  const driftGain = ctx.createGain();

  source.buffer = ensureNoiseBuffer(ctx);
  source.loop = true;

  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(95, ctx.currentTime);
  highpass.Q.setValueAtTime(0.6, ctx.currentTime);

  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(720, ctx.currentTime);
  lowpass.Q.setValueAtTime(0.4, ctx.currentTime);

  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(330, ctx.currentTime);
  bandpass.Q.setValueAtTime(0.42, ctx.currentTime);

  driftOscillator.type = "sine";
  driftOscillator.frequency.setValueAtTime(0.04, ctx.currentTime);
  driftGain.gain.setValueAtTime(18, ctx.currentTime);
  driftOscillator.connect(driftGain);
  driftGain.connect(bandpass.frequency);

  gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01 * ambientNoiseGainBoost, ctx.currentTime + 1.3);

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(bandpass);
  bandpass.connect(gainNode);
  gainNode.connect(state.audioMaster || ctx.destination);

  source.start(ctx.currentTime);
  driftOscillator.start(ctx.currentTime);
  state.ambientVoice = { source, gainNode, driftOscillator };
}

function stopAmbientBed() {
  if (!state.audioCtx || !state.ambientVoice) {
    state.ambientVoice = null;
    return;
  }

  const ctx = state.audioCtx;
  const { source, gainNode, driftOscillator } = state.ambientVoice;
  const stopAt = ctx.currentTime + 0.5;

  try {
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.14);
  } catch (error) {
    // Gain node may already be disconnected.
  }

  try {
    source.stop(stopAt);
  } catch (error) {
    // Source may already be stopped.
  }

  try {
    driftOscillator.stop(stopAt);
  } catch (error) {
    // LFO may already be stopped.
  }

  state.ambientVoice = null;
}

function schedulePhaseLayer(ctx, options) {
  const startAt = ctx.currentTime + (options.startOffset || 0);
  const duration = Math.max(0.2, options.duration || 4);
  const attack = Math.max(0.05, options.attack || 0.7);
  const release = Math.max(0.2, options.release || 0.8);
  const peak = options.peak || 0.025;
  const sustain = options.sustain || 0.82;
  const startFreq = Math.max(20, options.startFreq || 180);
  const endFreq = Math.max(20, options.endFreq || startFreq);
  const harmonicRatio = options.harmonicRatio || 1.5;
  const harmonicMix = options.harmonicMix || 0.09;
  const overtoneRatio = options.overtoneRatio || 0;
  const overtoneMix = options.overtoneMix || 0;
  const vibratoDepth = Math.max(0, options.vibratoDepth || 0);
  const vibratoRate = options.vibratoRate || 4.6;
  const tremoloDepth = Math.max(0, options.tremoloDepth || 0);
  const tremoloRate = options.tremoloRate || 0.25;
  const noiseMix = Math.max(0, options.noiseMix || 0);
  const noiseCenter = Math.max(120, options.noiseCenter || 1200);
  const noiseCenterEnd = Math.max(120, options.noiseCenterEnd || noiseCenter);
  const noiseQ = options.noiseQ || 0.9;
  const endAt = startAt + duration;
  const peakAt = Math.min(endAt - 0.02, startAt + attack);
  const releaseStart = clamp(
    Math.max(startAt + attack + 0.05, endAt - release),
    peakAt,
    endAt - 0.02
  );

  const baseOscillator = ctx.createOscillator();
  const harmonicOscillator = ctx.createOscillator();
  const harmonicGain = ctx.createGain();
  const overtoneOscillator = overtoneRatio > 0 ? ctx.createOscillator() : null;
  const overtoneGain = overtoneRatio > 0 ? ctx.createGain() : null;
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const tremoloNode = ctx.createGain();
  const extraOscillators = [];

  baseOscillator.type = options.wave || "sine";
  baseOscillator.frequency.setValueAtTime(startFreq, startAt);
  baseOscillator.frequency.exponentialRampToValueAtTime(endFreq, endAt);

  harmonicOscillator.type = options.harmonicWave || "triangle";
  harmonicOscillator.frequency.setValueAtTime(startFreq * harmonicRatio, startAt);
  harmonicOscillator.frequency.exponentialRampToValueAtTime(endFreq * harmonicRatio, endAt);
  harmonicOscillator.detune.setValueAtTime(options.detune || 3, startAt);
  harmonicGain.gain.setValueAtTime(harmonicMix, startAt);

  if (overtoneOscillator && overtoneGain) {
    overtoneOscillator.type = options.overtoneWave || "sine";
    overtoneOscillator.frequency.setValueAtTime(startFreq * overtoneRatio, startAt);
    overtoneOscillator.frequency.exponentialRampToValueAtTime(endFreq * overtoneRatio, endAt);
    overtoneOscillator.detune.setValueAtTime(options.overtoneDetune || 0, startAt);
    overtoneGain.gain.setValueAtTime(overtoneMix, startAt);
  }

  filter.type = options.filterType || "lowpass";
  filter.frequency.setValueAtTime(options.startCutoff || 820, startAt);
  filter.frequency.exponentialRampToValueAtTime(options.endCutoff || options.startCutoff || 820, endAt);
  filter.Q.setValueAtTime(options.q || 0.55, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, peakAt);
  gain.gain.exponentialRampToValueAtTime(peak * sustain, releaseStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  tremoloNode.gain.setValueAtTime(1, startAt);
  if (tremoloDepth > 0) {
    const tremoloOscillator = ctx.createOscillator();
    const tremoloGain = ctx.createGain();
    tremoloOscillator.type = "sine";
    tremoloOscillator.frequency.setValueAtTime(tremoloRate, startAt);
    tremoloNode.gain.setValueAtTime(1 - tremoloDepth / 2, startAt);
    tremoloGain.gain.setValueAtTime(tremoloDepth / 2, startAt);
    tremoloOscillator.connect(tremoloGain);
    tremoloGain.connect(tremoloNode.gain);
    tremoloOscillator.start(startAt);
    tremoloOscillator.stop(endAt + 0.04);
    extraOscillators.push(tremoloOscillator);
  }

  if (vibratoDepth > 0) {
    const vibratoOscillator = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibratoOscillator.type = "sine";
    vibratoOscillator.frequency.setValueAtTime(vibratoRate, startAt);
    vibratoGain.gain.setValueAtTime(vibratoDepth, startAt);
    vibratoOscillator.connect(vibratoGain);
    vibratoGain.connect(baseOscillator.detune);
    vibratoGain.connect(harmonicOscillator.detune);
    if (overtoneOscillator) {
      vibratoGain.connect(overtoneOscillator.detune);
    }
    vibratoOscillator.start(startAt);
    vibratoOscillator.stop(endAt + 0.04);
    extraOscillators.push(vibratoOscillator);
  }

  if (noiseMix > 0) {
    const noiseSource = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();

    noiseSource.buffer = ensureNoiseBuffer(ctx);
    noiseSource.loop = true;

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(noiseCenter, startAt);
    noiseFilter.frequency.exponentialRampToValueAtTime(noiseCenterEnd, endAt);
    noiseFilter.Q.setValueAtTime(noiseQ, startAt);

    noiseGain.gain.setValueAtTime(0.0001, startAt);
    noiseGain.gain.exponentialRampToValueAtTime(noiseMix, Math.min(endAt - 0.02, startAt + attack));
    noiseGain.gain.exponentialRampToValueAtTime(noiseMix * sustain, releaseStart);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(filter);

    noiseSource.start(startAt);
    noiseSource.stop(endAt + 0.04);
    extraOscillators.push(noiseSource);
  }

  baseOscillator.connect(filter);
  harmonicOscillator.connect(harmonicGain);
  harmonicGain.connect(filter);
  if (overtoneOscillator && overtoneGain) {
    overtoneOscillator.connect(overtoneGain);
    overtoneGain.connect(filter);
  }
  filter.connect(gain);
  gain.connect(tremoloNode);
  tremoloNode.connect(state.audioMaster || ctx.destination);

  baseOscillator.start(startAt);
  harmonicOscillator.start(startAt);
  if (overtoneOscillator) {
    overtoneOscillator.start(startAt);
  }
  baseOscillator.stop(endAt + 0.04);
  harmonicOscillator.stop(endAt + 0.04);
  if (overtoneOscillator) {
    overtoneOscillator.stop(endAt + 0.04);
  }

  const voice = {
    oscillators: [
      baseOscillator,
      harmonicOscillator,
      ...(overtoneOscillator ? [overtoneOscillator] : []),
      ...extraOscillators
    ],
    gainNode: gain
  };
  state.activeVoices.push(voice);
  window.setTimeout(() => {
    const voiceIndex = state.activeVoices.indexOf(voice);
    if (voiceIndex >= 0) {
      state.activeVoices.splice(voiceIndex, 1);
    }
  }, Math.ceil((duration + 0.1) * 1000));
}

function scheduleNoisePad(ctx, options = {}) {
  const startAt = ctx.currentTime + (options.startOffset || 0);
  const duration = Math.max(0.4, options.duration || 4);
  const attack = Math.max(0.1, options.attack || 0.5);
  const release = Math.max(0.2, options.release || 1.8);
  const peak = (options.peak || 0.008) * noiseLayerGainBoost;
  const sustain = options.sustain || 0.86;
  const centerStart = Math.max(120, options.centerStart || 900);
  const centerEnd = Math.max(120, options.centerEnd || centerStart);
  const bandQ = options.q || 0.55;
  const endAt = startAt + duration;
  const peakAt = Math.min(endAt - 0.02, startAt + attack);
  const releaseStart = clamp(
    Math.max(startAt + attack + 0.05, endAt - release),
    peakAt,
    endAt - 0.02
  );

  const noiseSource = ctx.createBufferSource();
  const highpass = ctx.createBiquadFilter();
  const bandpass = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  const extraOscillators = [];

  noiseSource.buffer = ensureNoiseBuffer(ctx);
  noiseSource.loop = true;

  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(options.highpass || 140, startAt);
  highpass.Q.setValueAtTime(0.5, startAt);

  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(centerStart, startAt);
  bandpass.frequency.exponentialRampToValueAtTime(centerEnd, endAt);
  bandpass.Q.setValueAtTime(bandQ, startAt);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(peak, peakAt);
  gainNode.gain.exponentialRampToValueAtTime(peak * sustain, releaseStart);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

  if ((options.driftDepth || 0) > 0) {
    const driftOscillator = ctx.createOscillator();
    const driftGain = ctx.createGain();
    driftOscillator.type = "sine";
    driftOscillator.frequency.setValueAtTime(options.driftRate || 0.12, startAt);
    driftGain.gain.setValueAtTime(options.driftDepth, startAt);
    driftOscillator.connect(driftGain);
    driftGain.connect(bandpass.frequency);
    driftOscillator.start(startAt);
    driftOscillator.stop(endAt + 0.04);
    extraOscillators.push(driftOscillator);
  }

  noiseSource.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gainNode);
  gainNode.connect(state.audioMaster || ctx.destination);

  noiseSource.start(startAt);
  noiseSource.stop(endAt + 0.04);

  const voice = {
    oscillators: [noiseSource, ...extraOscillators],
    gainNode
  };
  state.activeVoices.push(voice);
  window.setTimeout(() => {
    const voiceIndex = state.activeVoices.indexOf(voice);
    if (voiceIndex >= 0) {
      state.activeVoices.splice(voiceIndex, 1);
    }
  }, Math.ceil((duration + 0.1) * 1000));
}

function scheduleTempleStrike(ctx, options = {}) {
  const freq = options.freq || 232;
  schedulePhaseLayer(ctx, {
    duration: Math.max(1, options.duration || 3.2),
    startOffset: options.startOffset || 0,
    wave: "sine",
    harmonicWave: "sine",
    overtoneWave: "sine",
    startFreq: freq,
    endFreq: freq * 0.997,
    startCutoff: 1200,
    endCutoff: 860,
    filterType: "lowpass",
    peak: options.peak || 0.004,
    sustain: 0.82,
    harmonicRatio: 2.02,
    harmonicMix: 0.007,
    overtoneRatio: 2.9,
    overtoneMix: 0.0015,
    overtoneDetune: -0.2,
    detune: randomBetween(-0.25, 0.25),
    q: 0.34,
    attack: 0.28,
    release: 3.4,
    vibratoDepth: 0.2,
    vibratoRate: randomBetween(0.08, 0.12),
    tremoloDepth: 0.0012,
    tremoloRate: randomBetween(0.07, 0.1),
    noiseMix: 0
  });
}

function randomBetween(min, max) {
  return min + (max - min) * Math.random();
}

function playPhaseCue(phaseId, durationSeconds = 4) {
  if (!state.soundEnabled) {
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") {
    return;
  }

  startAmbientBed();

  // Keep a light tail overlap for less robotic transitions.
  if (state.activeVoices.length > 12) {
    stopAllPhaseAudio();
  }

  const duration = Math.max(0.8, durationSeconds);
  const profileByPhase = {
    inhale: {
      // D major family: inhale opens brighter.
      windCenter: 790,
      windEnd: 860,
      windPeak: 0.0085,
      windHighpass: 120,
      shimmerCenter: 1000,
      shimmerEnd: 1080,
      shimmerPeak: 0.0031,
      shimmerHighpass: 170,
      toneFreq: 293.66,
      harmonyFreq: 369.99,
      tonePeak: 0.0024,
      harmonyPeak: 0.0018,
      toneCutoff: 980,
      bowlFreq: 293.66,
      bowlPeak: 0.0042,
      bowlOffset: 0.16
    },
    "hold-high": {
      windCenter: 680,
      windEnd: 650,
      windPeak: 0.0079,
      windHighpass: 110,
      shimmerCenter: 930,
      shimmerEnd: 880,
      shimmerPeak: 0.0028,
      shimmerHighpass: 145,
      toneFreq: 369.99,
      harmonyFreq: 440,
      tonePeak: 0.0024,
      harmonyPeak: 0.0017,
      toneCutoff: 900,
      bowlFreq: 369.99,
      bowlPeak: 0.0047,
      bowlOffset: 0.14
    },
    exhale: {
      // Exhale settles lower and warmer, still harmonized.
      windCenter: 560,
      windEnd: 500,
      windPeak: 0.0088,
      windHighpass: 80,
      shimmerCenter: 760,
      shimmerEnd: 690,
      shimmerPeak: 0.0028,
      shimmerHighpass: 125,
      toneFreq: 220,
      harmonyFreq: 293.66,
      tonePeak: 0.0025,
      harmonyPeak: 0.0019,
      toneCutoff: 760,
      bowlFreq: 220,
      bowlPeak: 0.0043,
      bowlOffset: 0.16
    },
    "hold-low": {
      windCenter: 620,
      windEnd: 580,
      windPeak: 0.0079,
      windHighpass: 100,
      shimmerCenter: 840,
      shimmerEnd: 790,
      shimmerPeak: 0.0027,
      shimmerHighpass: 140,
      toneFreq: 196,
      harmonyFreq: 246.94,
      tonePeak: 0.0022,
      harmonyPeak: 0.0016,
      toneCutoff: 820,
      bowlFreq: 196,
      bowlPeak: 0.0046,
      bowlOffset: 0.14
    }
  };
  const profile = profileByPhase[phaseId] || profileByPhase.inhale;

  scheduleNoisePad(ctx, {
    duration,
    peak: profile.windPeak,
    sustain: 0.94,
    attack: 0.72,
    release: 3.1,
    centerStart: profile.windCenter,
    centerEnd: profile.windEnd,
    q: 0.42,
    highpass: profile.windHighpass,
    driftDepth: 22,
    driftRate: 0.075
  });

  scheduleNoisePad(ctx, {
    duration: Math.max(0.8, duration * 0.96),
    startOffset: 0.04,
    peak: profile.shimmerPeak,
    sustain: 0.88,
    attack: 0.56,
    release: 2.6,
    centerStart: profile.shimmerCenter,
    centerEnd: profile.shimmerEnd,
    q: 0.38,
    highpass: profile.shimmerHighpass,
    driftDepth: 16,
    driftRate: 0.07
  });

  if (profile.tonePeak > 0) {
    schedulePhaseLayer(ctx, {
      duration,
      wave: "sine",
      harmonicWave: "sine",
      overtoneWave: "sine",
      startFreq: profile.toneFreq,
      endFreq: profile.toneFreq,
      startCutoff: profile.toneCutoff,
      endCutoff: profile.toneCutoff,
      filterType: "lowpass",
      peak: profile.tonePeak,
      sustain: 0.92,
      harmonicRatio: 2,
      harmonicMix: 0.004,
      overtoneRatio: 0,
      overtoneMix: 0,
      detune: randomBetween(-0.2, 0.2),
      q: 0.3,
      attack: 1.05,
      release: 3.2,
      vibratoDepth: 0.18,
      vibratoRate: randomBetween(0.08, 0.12),
      tremoloDepth: 0.0015,
      tremoloRate: randomBetween(0.06, 0.09),
      noiseMix: 0
    });

    if (profile.harmonyPeak > 0) {
      schedulePhaseLayer(ctx, {
        duration,
        startOffset: 0.05,
        wave: "sine",
        harmonicWave: "sine",
        overtoneWave: "sine",
        startFreq: profile.harmonyFreq,
        endFreq: profile.harmonyFreq,
        startCutoff: profile.toneCutoff * 0.96,
        endCutoff: profile.toneCutoff * 0.96,
        filterType: "lowpass",
        peak: profile.harmonyPeak,
        sustain: 0.92,
        harmonicRatio: 2,
        harmonicMix: 0.003,
        overtoneRatio: 0,
        overtoneMix: 0,
        detune: randomBetween(-0.16, 0.16),
        q: 0.28,
        attack: 1.12,
        release: 3.3,
        vibratoDepth: 0.14,
        vibratoRate: randomBetween(0.08, 0.12),
        tremoloDepth: 0.001,
        tremoloRate: randomBetween(0.06, 0.09),
        noiseMix: 0
      });
    }
  }

  if (profile.bowlPeak > 0) {
    scheduleTempleStrike(ctx, {
      duration: Math.min(3.4, duration),
      freq: profile.bowlFreq,
      peak: profile.bowlPeak,
      startOffset: profile.bowlOffset
    });
  }
}

function syncSoundControl() {
  if (!nodes.toggleSound) {
    return;
  }

  const shouldEnableSound = nodes.toggleSound.checked;

  if (!AudioContextCtor) {
    nodes.toggleSound.checked = false;
    nodes.toggleSound.disabled = true;
    state.soundEnabled = false;
    return;
  }

  nodes.toggleSound.checked = shouldEnableSound;
  nodes.toggleSound.disabled = false;
  state.soundEnabled = shouldEnableSound;
}

function getCurrentPhaseTiming(now = performance.now()) {
  const phase = phases[state.phaseIndex] || phases[0];
  const elapsed = now - state.phaseStartedAt;
  const remaining = clamp((phase.duration - elapsed) / 1000, 0.2, phase.duration / 1000);
  return { phase, remaining };
}

function installAudioUnlock() {
  function unlock() {
    const ctx = ensureAudioContext();
    if (!ctx) {
      return;
    }

    if (ctx.state !== "suspended" && ctx.state !== "interrupted") {
      return;
    }

    const { phase, remaining } = getCurrentPhaseTiming();
    resumeAudioContextIfNeeded(() => {
      if (state.soundEnabled) {
        playPhaseCue(phase.id, remaining);
      }
    });
  }

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
}

function setTextWithFade(node, value, animate = true) {
  if (!animate) {
    const existingTimer = fadeTimers.get(node);
    if (existingTimer) {
      clearTimeout(existingTimer);
      fadeTimers.delete(node);
    }

    const existingAnimationFrame = fadeAnimationFrames.get(node);
    if (existingAnimationFrame) {
      cancelAnimationFrame(existingAnimationFrame);
      fadeAnimationFrames.delete(node);
    }

    node.textContent = value;
    node.classList.remove("is-fading");
    pendingFadeValues.delete(node);
    return;
  }

  const pendingValue = pendingFadeValues.get(node);
  if (pendingValue === value || node.textContent === value) {
    if (!fadeTimers.has(node) && !fadeAnimationFrames.has(node)) {
      node.classList.remove("is-fading");
      pendingFadeValues.delete(node);
    }
    return;
  }

  const existingTimer = fadeTimers.get(node);
  if (existingTimer) {
    clearTimeout(existingTimer);
    fadeTimers.delete(node);
  }

  const existingAnimationFrame = fadeAnimationFrames.get(node);
  if (existingAnimationFrame) {
    cancelAnimationFrame(existingAnimationFrame);
    fadeAnimationFrames.delete(node);
  }

  pendingFadeValues.set(node, value);
  node.classList.remove("is-fading");
  // Safari occasionally drops rapid opacity transitions without a reflow reset.
  void node.offsetWidth;
  node.classList.add("is-fading");

  const timer = setTimeout(() => {
    node.textContent = value;
    const frameId = requestAnimationFrame(() => {
      node.classList.remove("is-fading");
      pendingFadeValues.delete(node);
      fadeAnimationFrames.delete(node);
    });
    fadeAnimationFrames.set(node, frameId);
    fadeTimers.delete(node);
  }, fadeDurationMs);

  fadeTimers.set(node, timer);
}

function pickNextQuoteIndex() {
  if (state.quotes.length === 0) {
    return -1;
  }

  if (state.quotes.length === 1) {
    return 0;
  }

  let nextIndex = state.quoteIndex;
  while (nextIndex === state.quoteIndex) {
    nextIndex = Math.floor(Math.random() * state.quotes.length);
  }

  return nextIndex;
}

function renderQuote(animate = true) {
  const nextIndex = pickNextQuoteIndex();
  if (nextIndex < 0) {
    return;
  }

  const nextQuote = state.quotes[nextIndex];
  state.quoteIndex = nextIndex;
  setTextWithFade(nodes.quoteText, `"${nextQuote.quote}"`, animate);
  setTextWithFade(nodes.quoteAuthor, `- ${nextQuote.author}`, animate);
}

function clearQuoteTimers() {
  if (state.quoteTimeoutId !== null) {
    clearTimeout(state.quoteTimeoutId);
    state.quoteTimeoutId = null;
  }

  if (state.quoteRefreshTickerId !== null) {
    clearInterval(state.quoteRefreshTickerId);
    state.quoteRefreshTickerId = null;
  }
}

function syncQuoteControls() {
  const canShuffle = state.quotes.length > 1;
  nodes.quoteAutoToggle.disabled = !canShuffle;
  nodes.quoteShuffle.disabled = !canShuffle;
  state.quoteAutoShuffle = canShuffle && nodes.quoteAutoToggle.checked;
}

function updateQuoteRefreshLabel() {
  if (state.quotes.length === 1) {
    nodes.quoteRefresh.textContent = "Single quote loaded";
    return;
  }

  if (!state.quoteAutoShuffle) {
    nodes.quoteRefresh.textContent = "Auto shuffle off";
    return;
  }

  if (state.quoteNextAt === 0) {
    nodes.quoteRefresh.textContent = "Next quote in --s";
    return;
  }

  const remainingSeconds = Math.max(0, Math.ceil((state.quoteNextAt - Date.now()) / 1000));
  nodes.quoteRefresh.textContent = `Next quote in ${remainingSeconds}s`;
}

function scheduleQuoteRefresh() {
  clearQuoteTimers();
  if (!state.quoteAutoShuffle || state.quotes.length <= 1) {
    state.quoteNextAt = 0;
    updateQuoteRefreshLabel();
    return;
  }

  state.quoteNextAt = Date.now() + quoteRefreshMs;
  updateQuoteRefreshLabel();
  state.quoteRefreshTickerId = setInterval(updateQuoteRefreshLabel, 1000);
  state.quoteTimeoutId = setTimeout(() => {
    renderQuote(true);
    scheduleQuoteRefresh();
  }, quoteRefreshMs);
}

async function loadQuotes() {
  try {
    const response = await fetch("quotes.json");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    state.quotes = Array.isArray(data) ? data : [];
    syncQuoteControls();

    if (state.quotes.length === 0) {
      clearQuoteTimers();
      state.quoteNextAt = 0;
      setTextWithFade(nodes.quoteText, "No quotes available.", false);
      nodes.quoteRefresh.textContent = "Quote timer unavailable";
      setTextWithFade(nodes.quoteAuthor, "", false);
      return;
    }

    renderQuote(false);
    scheduleQuoteRefresh();
  } catch (error) {
    clearQuoteTimers();
    state.quoteNextAt = 0;
    state.quotes = [];
    syncQuoteControls();
    setTextWithFade(nodes.quoteText, "Could not load quotes.", false);
    nodes.quoteRefresh.textContent = "Quote timer unavailable";
    setTextWithFade(nodes.quoteAuthor, "", false);
    console.error("Failed to load quotes:", error);
  }
}

function easeInOutSine(progress) {
  return 0.5 - 0.5 * Math.cos(Math.PI * progress);
}

function getAnimatedProgress(phaseId, progress) {
  if (phaseId === "hold-high" || phaseId === "hold-low") {
    return progress;
  }

  return easeInOutSine(progress);
}

function getContainerFill(phaseId, progress) {
  if (phaseId === "inhale") {
    return progress;
  }

  if (phaseId === "hold-high") {
    return 1;
  }

  if (phaseId === "exhale") {
    return 1 - progress;
  }

  return 0;
}

function applySceneScale(rawValue) {
  const percent = clamp(Math.round(Number(rawValue) || 100), minSizePercent, maxSizePercent);
  const scale = percent / 100;
  nodes.visualizer.style.setProperty("--scene-scale", scale.toFixed(2));
  nodes.sizeSlider.value = String(percent);
  nodes.sizeValue.textContent = `${percent}%`;
}

function render(now) {
  let currentPhase = phases[state.phaseIndex];
  let phaseElapsed = now - state.phaseStartedAt;

  while (phaseElapsed >= currentPhase.duration) {
    state.phaseStartedAt += currentPhase.duration;
    state.phaseIndex = (state.phaseIndex + 1) % phases.length;
    currentPhase = phases[state.phaseIndex];
    phaseElapsed = now - state.phaseStartedAt;
  }

  const progress = Math.max(0, Math.min(1, phaseElapsed / currentPhase.duration));
  const animatedProgress = getAnimatedProgress(currentPhase.id, progress);
  const containerFill = getContainerFill(currentPhase.id, animatedProgress);
  const isHoldPhase = currentPhase.id === "hold-high" || currentPhase.id === "hold-low";
  const releasePhase = currentPhase.id === "inhale" || currentPhase.id === "exhale";
  const holdRelease = !isHoldPhase && releasePhase ? clamp(1 - phaseElapsed / holdReleaseMs, 0, 1) : 0;
  const holdProgress = isHoldPhase ? progress : holdRelease > 0 ? 1 : 0;
  const holdVisibility = isHoldPhase ? 1 : holdRelease;
  const holdAlert = isHoldPhase ? Math.max(0, (progress - 0.65) / 0.35) : 0;
  const holdStartRotation = currentPhase.id === "hold-low" || currentPhase.id === "inhale" ? "180deg" : "0deg";
  const coreScale = currentPhase.from + (currentPhase.to - currentPhase.from) * animatedProgress;
  const remaining = Math.max(0, (currentPhase.duration - phaseElapsed) / 1000);
  const remainingSeconds = Math.ceil(remaining);

  const previousPhaseId = state.phaseId;
  setPhaseTheme(currentPhase.id);
  if (previousPhaseId && previousPhaseId !== currentPhase.id) {
    playPhaseCue(currentPhase.id, currentPhase.duration / 1000);
  }
  nodes.scene.style.setProperty("--container-fill", containerFill.toFixed(4));
  nodes.scene.style.setProperty("--hold-progress", holdProgress.toFixed(4));
  nodes.scene.style.setProperty("--hold-visibility", holdVisibility.toFixed(4));
  nodes.scene.style.setProperty("--hold-alert", holdAlert.toFixed(4));
  nodes.scene.style.setProperty("--hold-start-rotation", holdStartRotation);
  nodes.core.style.setProperty("--core-scale", coreScale.toFixed(4));
  setTextWithFade(nodes.instruction, currentPhase.instruction, true);
  setTextWithFade(nodes.countdown, `${remainingSeconds}s`, true);
  nodes.elapsed.textContent = `Elapsed ${formatElapsed(now - state.sessionStartedAt)}`;

  if (state.running) {
    state.rafId = requestAnimationFrame(render);
  }
}

function pause() {
  if (!state.running) {
    return;
  }

  state.running = false;
  state.pausedAt = performance.now();
  nodes.startPause.textContent = "Start";

  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }

  stopAllPhaseAudio();
  stopAmbientBed();
}

function resume() {
  if (state.running) {
    return;
  }

  const now = performance.now();
  const pausedDuration = now - state.pausedAt;
  state.phaseStartedAt += pausedDuration;
  state.sessionStartedAt += pausedDuration;
  state.running = true;
  state.pausedAt = null;
  nodes.startPause.textContent = "Pause";

  if (state.soundEnabled) {
    const { phase, remaining } = getCurrentPhaseTiming(now);
    playPhaseCue(phase.id, remaining);
  }

  state.rafId = requestAnimationFrame(render);
}

function reset() {
  const now = performance.now();
  state.phaseIndex = 0;
  state.phaseStartedAt = now;
  state.sessionStartedAt = now;
  setPhaseTheme(phases[0].id);

  stopAllPhaseAudio();
  if (state.soundEnabled) {
    playPhaseCue(phases[0].id, phases[0].duration / 1000);
  } else {
    stopAmbientBed();
  }

  render(now);
}

nodes.startPause.addEventListener("click", () => {
  if (state.running) {
    pause();
  } else {
    resume();
  }
});

nodes.reset.addEventListener("click", reset);
nodes.sizeSlider.addEventListener("input", (event) => {
  applySceneScale(event.target.value);
  persistSettings();
});
nodes.toggleSound.addEventListener("change", () => {
  state.soundEnabled = nodes.toggleSound.checked;
  persistSettings();
  if (!state.soundEnabled) {
    stopAllPhaseAudio();
    stopAmbientBed();
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }

  const { phase, remaining } = getCurrentPhaseTiming();
  resumeAudioContextIfNeeded(() => {
    playPhaseCue(phase.id, remaining);
  });
});
nodes.quoteAutoToggle.addEventListener("change", () => {
  state.quoteAutoShuffle = nodes.quoteAutoToggle.checked;
  persistSettings();
  scheduleQuoteRefresh();
});
nodes.quoteShuffle.addEventListener("click", () => {
  if (state.quotes.length <= 1) {
    return;
  }

  renderQuote(true);
  if (state.quoteAutoShuffle) {
    scheduleQuoteRefresh();
  }
});

applyPersistedSettings();
wireToggle(nodes.toggleInstruction, nodes.instruction);
wireToggle(nodes.toggleCountdown, nodes.countdown);
wireToggle(nodes.toggleElapsed, nodes.elapsed);
wireToggle(nodes.toggleQuotes, nodes.quoteCard);
syncSoundControl();
installAudioUnlock();
syncQuoteControls();
applySceneScale(nodes.sizeSlider.value);
persistSettings();
setPhaseTheme(phases[state.phaseIndex].id);
loadQuotes();
state.rafId = requestAnimationFrame(render);
