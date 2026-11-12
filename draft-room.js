(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const setMotion = () => document.body.classList.toggle('still', reducedMotion.matches);
  reducedMotion.addEventListener('change', setMotion);
  setMotion();

  const torchButton = document.querySelector('#torch-toggle');
  let torchOn = false;
  function placeTorch(x, y) {
    document.body.style.setProperty('--torch-x', `${x}px`);
    document.body.style.setProperty('--torch-y', `${y}px`);
  }
  torchButton.addEventListener('click', () => {
    torchOn = !torchOn;
    document.body.classList.toggle('torch-on', torchOn);
    torchButton.setAttribute('aria-pressed', String(torchOn));
    torchButton.textContent = torchOn ? 'Flashlight off' : 'Flashlight on';
    placeTorch(window.innerWidth / 2, window.innerHeight * 0.4);
  });
  document.addEventListener('pointermove', e => {
    if (torchOn) placeTorch(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('pointerdown', e => {
    if (torchOn && !e.target.closest('.room-controls')) placeTorch(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && torchOn) torchButton.click();
  });

  const panel = document.querySelector('.room-controls');
  const roomButtons = [...document.querySelectorAll('[data-room-toggle]')];
  const volume = document.querySelector('#room-volume');
  const stateLabel = document.querySelector('#room-state');
  const actionLabel = document.querySelector('#room-action');
  let context, master, analyser, sources = [], monitorTimer;
  let playing = false, busy = false;
  let currentVolume = Number(volume.value) / 100;
  // Procedural vinyl surface noise only; playback begins after a user gesture.
  function makeNoiseBuffer() {
    const length = Math.floor(context.sampleRate * 19.3);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let brown = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + white * 0.018) / 1.018;
        data[i] = white * 0.0045 + brown * 0.013;
      }
      for (let n = 0; n < 98; n++) {
        const at = Math.floor(Math.random() * (length - context.sampleRate * 0.03));
        const samples = Math.floor(context.sampleRate * (0.0007 + Math.random() ** 3 * 0.011));
        const intensity = 0.018 + Math.random() ** 2 * 0.1;
        for (let j = 0; j < samples; j++) {
          data[at + j] += (Math.random() * 2 - 1) * Math.exp(-j / Math.max(1, samples * 0.17)) * intensity;
        }
      }
      const fade = Math.floor(context.sampleRate * 0.012);
      for (let i = 0; i < fade; i++) { data[i] *= i / fade; data[length - 1 - i] *= i / fade; }
    }
    return buffer;
  }
  function buildSound() {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) throw new Error('unsupported');
    context = new AudioEngine();
    master = context.createGain();
    master.gain.value = 0;
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 18;
    limiter.ratio.value = 4;
    master.connect(limiter); limiter.connect(analyser); analyser.connect(context.destination);
    {
      const source = context.createBufferSource();
      source.buffer = makeNoiseBuffer(); source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 5600;
      const gain = context.createGain(); gain.gain.value = 3.2;
      source.connect(filter); filter.connect(gain); gain.connect(master); source.start(); sources.push(source);
    }
  }
  function monitor() {
    clearTimeout(monitorTimer);
    if (!playing || !analyser) { panel.dataset.audioLevel = '0'; return; }
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    samples.forEach(x => { sum += ((x - 128) / 128) ** 2; });
    panel.dataset.audioLevel = Math.sqrt(sum / samples.length).toFixed(5);
    monitorTimer = setTimeout(monitor, 300);
  }
  function updateSoundLabels() {
    panel.classList.toggle('playing', playing);
    panel.dataset.audioState = playing ? 'playing' : 'off';
    roomButtons.forEach(button => button.setAttribute('aria-pressed', String(playing)));
    actionLabel.textContent = playing ? 'Pause the vinyl' : 'Play the vinyl';
    stateLabel.textContent = playing ? 'Vinyl crackle / playing softly' : 'Vinyl crackle / sound off';
    const invite = document.querySelector('.ambient-invite');
    invite.textContent = playing ? 'The record is turning. Stay a while.' : 'Drop the needle. Listen.';
  }
  async function toggleRoom() {
    if (busy) return;
    busy = true;
    try {
      if (!context) buildSound();
      if (!playing) {
        await context.resume();
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setValueAtTime(0, context.currentTime);
        master.gain.linearRampToValueAtTime(currentVolume * 1.2, context.currentTime + 0.6);
        playing = true;
      } else {
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setValueAtTime(master.gain.value, context.currentTime);
        master.gain.linearRampToValueAtTime(0, context.currentTime + 0.3);
        playing = false;
        await new Promise(resolve => setTimeout(resolve, 340));
        await context.suspend();
      }
      updateSoundLabels(); monitor();
    } catch (error) {
      playing = false; updateSoundLabels();
      stateLabel.textContent = 'Sound unavailable in this browser';
    } finally { busy = false; }
  }
  roomButtons.forEach(button => button.addEventListener('click', toggleRoom));
  volume.addEventListener('input', () => {
    currentVolume = Number(volume.value) / 100;
    if (master && playing) master.gain.setTargetAtTime(currentVolume * 1.2, context.currentTime, 0.08);
  });
  // Make space for the foreground music when its Spotify player is opened.
  document.querySelector('#load-player')?.addEventListener('click', () => { if (playing) toggleRoom(); });
  window.addEventListener('pagehide', () => {
    clearTimeout(monitorTimer);
    sources.forEach(source => { try { source.stop(); } catch {} });
    if (context && context.state !== 'closed') context.close();
  });
  updateSoundLabels();
})();
