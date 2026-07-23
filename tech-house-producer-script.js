(() => {
  'use strict';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  const engine = {
    ctx: null,
    masterGain: null,
    tracks: [],
    trackCounter: 0,
    focusedIndex: 0,
    armedIndex: 0,
    pendingTrackUploadIndex: null,

    isPlaying: false,
    currentTime: 0,
    playStartTime: 0,
    bpm: 120,
    timeMode: 'bars',
    loopEnabled: false,

    inPoint: null,
    outPoint: null,

    isRecording: false,
    isRecordingPaused: false,
    isCountingIn: false,
    mediaRecorder: null,
    recordedChunks: [],
    currentStream: null,

    metronomeOn: false,
    metronomeNextNote: 0,
    schedulerTimer: null,

    rafId: null
  };

  async function initAudio() {
    if (!engine.ctx) {
      engine.ctx = new AudioCtx();
      engine.masterGain = engine.ctx.createGain();
      engine.masterGain.connect(engine.ctx.destination);
    }
    if (engine.ctx.state === 'suspended') await engine.ctx.resume();
  }

  function announce(msg) {
    const el = document.getElementById('srAnnouncer');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 50);
  }

  function secondsToBars(sec) {
    const beatSec = 60 / engine.bpm;
    const totalBeats = sec / beatSec;
    const bar = Math.floor(totalBeats / 4) + 1;
    const beat = Math.floor(totalBeats % 4) + 1;
    const sixteenth = Math.floor((totalBeats % 1) * 4) + 1;
    return { bar, beat, sixteenth };
  }

  function updateDisplays() {
    const posDisp = document.getElementById('posDisplay');
    const posSub = document.getElementById('posSubDisplay');
    const regDisp = document.getElementById('regionDisplay');
    const regSub = document.getElementById('regionSubDisplay');
    if (!posDisp) return;

    if (engine.timeMode === 'bars') {
      const b = secondsToBars(engine.currentTime);
      posDisp.textContent = `${String(b.bar).padStart(2,'0')}:${String(b.beat).padStart(2,'0')}:${String(b.sixteenth).padStart(2,'0')}`;
      posSub.textContent = `Bar ${b.bar}, Beat ${b.beat}`;
    } else {
      const mins = Math.floor(engine.currentTime / 60);
      const secs = Math.floor(engine.currentTime % 60);
      const ms = Math.floor((engine.currentTime % 1) * 1000);
      posDisp.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
      posSub.textContent = `${engine.currentTime.toFixed(3)} Seconds`;
    }

    const inStr = engine.inPoint !== null ? engine.inPoint.toFixed(2) + 's' : '--';
    const outStr = engine.outPoint !== null ? engine.outPoint.toFixed(2) + 's' : '--';
    regDisp.textContent = `IN: ${inStr} | OUT: ${outStr}`;
    regSub.textContent = engine.loopEnabled ? 'Loop Active' : 'Press S (In) / E (Out)';
  }

  function updatePlaybackButtons() {
    const playBtn = document.getElementById('btnPlayAll');
    if (playBtn) {
      playBtn.setAttribute('aria-pressed', String(engine.isPlaying));
      playBtn.textContent = engine.isPlaying ? 'Pause' : 'Play';
    }
    const recBtn = document.getElementById('btnRecord');
    if (recBtn) {
      recBtn.setAttribute('aria-pressed', String(engine.isRecording));
      recBtn.classList.toggle('armed', engine.isRecording);
      recBtn.textContent = engine.isRecording ? 'Stop Rec' : 'Record';
    }
  }

  function updateLoopButton() {
    const btn = document.getElementById('btnGlobalLoop');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(engine.loopEnabled));
    btn.classList.toggle('active-toggle', engine.loopEnabled);
    btn.textContent = engine.loopEnabled ? 'Loop: ON' : 'Loop: OFF';
  }

  function updateMetronomeButton() {
    const btn = document.getElementById('btnMetronome');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(engine.metronomeOn));
    btn.classList.toggle('active-toggle', engine.metronomeOn);
    btn.textContent = engine.metronomeOn ? 'Metronome: ON' : 'Metronome: OFF';
  }

  function setFocusedTrackDisplay() {
    if (engine.tracks.length === 0) return;
    const current = engine.tracks[engine.focusedIndex];
    document.getElementById('focusTrackDisplay').textContent = current.name;
    document.getElementById('focusStatusDisplay').textContent = current.audioBuffer ? 'Audio Ready' : 'Empty';
  }

  function createAudioTrack(name) {
    engine.trackCounter++;
    const track = {
      id: Date.now() + Math.random(),
      name: name || 'Track ' + engine.trackCounter,
      audioBuffer: null,
      sourceNode: null,
      gainNode: null,
      pannerNode: null,
      eqLow: null,
      eqMid: null,
      eqHigh: null,
      isMuted: false,
      isSolo: false,
      isLooping: false,
      isQuantized: false,
      quantizedStart: null,
      autotuneOn: false,
      trimOnLoop: false,
      volume: 0.8,
      pan: 0,
      pitchSemitones: 0,
      eqLowVal: 0,
      eqMidVal: 0,
      eqHighVal: 0,
      startTimeOffset: 0.0
    };
    engine.tracks.push(track);
    renderTracks();
    setFocusedTrack(engine.tracks.length - 1);
    announce('Created ' + track.name);
  }

  function setFocusedTrack(index) {
    if (engine.tracks.length === 0) return;
    engine.focusedIndex = Math.max(0, Math.min(index, engine.tracks.length - 1));
    document.querySelectorAll('.track-item').forEach((el, idx) => {
      el.classList.toggle('focused', idx === engine.focusedIndex);
      el.setAttribute('aria-selected', String(idx === engine.focusedIndex));
    });
    setFocusedTrackDisplay();
    announce('Focused ' + engine.tracks[engine.focusedIndex].name);
  }

  function armTrack(index) {
    engine.armedIndex = index;
    renderTracks();
    announce('Armed ' + engine.tracks[index].name);
  }

  function triggerTrackUpload(index) {
    engine.pendingTrackUploadIndex = index;
    const input = document.getElementById('trackAudioInput');
    if (input) input.click();
  }

  function renderTracks() {
    const rack = document.getElementById('trackRack');
    if (!rack) return;
    rack.innerHTML = '';

    engine.tracks.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'track-item' + (i === engine.focusedIndex ? ' focused' : '') + (i === engine.armedIndex ? ' armed-track' : '');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-selected', String(i === engine.focusedIndex));
      item.setAttribute('aria-label', t.name + (t.audioBuffer ? ' Audio loaded' : ' Empty') + (i === engine.armedIndex ? ' Armed' : ''));
      item.onclick = (e) => {
        if (!e.target.matches('button, input, select')) setFocusedTrack(i);
      };
      item.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setFocusedTrack(i);
        }
      };

      item.innerHTML = `
        <div class="track-main-row">
          <div class="track-info">
            <div class="track-title">${t.name}</div>
            <div class="track-status">${t.audioBuffer ? 'Audio Loaded' : 'Empty'}</div>
          </div>
          <div class="btn-group">
            <button class="${i === engine.armedIndex ? 'armed' : ''}" onclick="window.armTrack(${i})">${i === engine.armedIndex ? 'ARMED' : 'Arm'}</button>
            <button class="${t.isMuted ? 'active-toggle' : ''}" onclick="window.toggleMute(${i})">${t.isMuted ? 'MUTED' : 'Mute'}</button>
            <button class="${t.isSolo ? 'active-toggle' : ''}" onclick="window.toggleSolo(${i})">${t.isSolo ? 'SOLO' : 'Solo'}</button>
            <button class="${t.isQuantized ? 'active-toggle' : ''}" onclick="window.toggleQuantize(${i})">${t.isQuantized ? 'QUANT ON' : 'Quantize'}</button>
            <button class="${t.isLooping ? 'active-toggle' : ''}" onclick="window.toggleTrackLoop(${i})">${t.isLooping ? 'LOOP ON' : 'Loop'}</button>
            <button class="${t.autotuneOn ? 'active-toggle' : ''}" onclick="window.toggleAutotune(${i})">${t.autotuneOn ? 'TUNE ON' : 'Tune'}</button>
            <button class="${t.trimOnLoop ? 'active-toggle' : ''}" onclick="window.toggleTrimOnLoop(${i})">${t.trimOnLoop ? 'TRIM ON' : 'Trim'}</button>
            <button onclick="window.triggerTrackUpload(${i})">Upload</button>
            <button onclick="window.clearTrack(${i})">Clear</button>
          </div>
        </div>
        <div class="track-controls">
          <div class="control-unit">
            <label for="vol-${i}">Vol</label>
            <input id="vol-${i}" type="range" min="0" max="1" step="0.05" value="${t.volume}" oninput="window.updateTrackParam(${i}, 'volume', this.value)" aria-label="Volume">
          </div>
          <div class="control-unit">
            <label for="pan-${i}">Pan</label>
            <input id="pan-${i}" type="range" min="-1" max="1" step="0.1" value="${t.pan}" oninput="window.updateTrackParam(${i}, 'pan', this.value)" aria-label="Pan">
          </div>
          <div class="control-unit">
            <label for="pitch-${i}">Pitch</label>
            <input id="pitch-${i}" type="range" min="-12" max="12" step="${t.autotuneOn ? '1' : '0.1'}" value="${t.pitchSemitones}" oninput="window.updateTrackParam(${i}, 'pitchSemitones', this.value)" aria-label="Pitch Semitones">
          </div>
        </div>
      `;
      rack.appendChild(item);
    });
  }

  function updateTrackParam(index, param, value) {
    const track = engine.tracks[index];
    if (!track) return;
    const num = parseFloat(value);
    track[param] = num;

    if (param === 'volume' && track.gainNode && engine.ctx) {
      track.gainNode.gain.setTargetAtTime(track.volume, engine.ctx.currentTime, 0.02);
    }
    if (param === 'pan' && track.pannerNode && engine.ctx) {
      track.pannerNode.pan.setTargetAtTime(track.pan, engine.ctx.currentTime, 0.02);
    }
    if (param === 'pitchSemitones' && track.sourceNode && engine.ctx) {
      track.sourceNode.detune.setTargetAtTime(track.pitchSemitones * 100, engine.ctx.currentTime, 0.02);
    }
  }

  function toggleMute(index) {
    engine.tracks[index].isMuted = !engine.tracks[index].isMuted;
    renderTracks();
    announce(engine.tracks[index].name + (engine.tracks[index].isMuted ? ' muted' : ' unmuted'));
  }

  function toggleSolo(index) {
    engine.tracks[index].isSolo = !engine.tracks[index].isSolo;
    renderTracks();
    if (engine.isPlaying) {
      stopAllSources();
      scheduleAllTracks();
    }
    announce(engine.tracks[index].name + ' solo ' + (engine.tracks[index].isSolo ? 'on' : 'off'));
  }

  function toggleQuantize(index) {
    const track = engine.tracks[index];
    track.isQuantized = !track.isQuantized;
    if (track.isQuantized) {
      const beatSec = 60 / engine.bpm;
      track.quantizedStart = Math.round(engine.currentTime / beatSec) * beatSec;
      track.startTimeOffset = track.quantizedStart;
    } else {
      track.quantizedStart = null;
      track.startTimeOffset = 0.0;
    }
    renderTracks();
    announce(track.name + ' quantization ' + (track.isQuantized ? 'enabled' : 'disabled'));
  }

  function toggleTrackLoop(index) {
    engine.tracks[index].isLooping = !engine.tracks[index].isLooping;
    renderTracks();
    announce(engine.tracks[index].name + ' loop ' + (engine.tracks[index].isLooping ? 'enabled' : 'disabled'));
  }

  function toggleAutotune(index) {
    const track = engine.tracks[index];
    track.autotuneOn = !track.autotuneOn;
    if (track.autotuneOn) {
      track.pitchSemitones = Math.round(track.pitchSemitones);
    }
    renderTracks();
    announce(track.name + ' auto-tune ' + (track.autotuneOn ? 'enabled' : 'disabled'));
  }

  function toggleTrimOnLoop(index) {
    const track = engine.tracks[index];
    track.trimOnLoop = !track.trimOnLoop;
    renderTracks();
    announce(track.name + ' trim on loop ' + (track.trimOnLoop ? 'enabled' : 'disabled'));
    if (track.trimOnLoop && engine.loopEnabled && engine.inPoint !== null && engine.outPoint !== null) {
      trimTrackBuffer(track);
    }
  }

  function trimTrackBuffer(track) {
    if (!engine.ctx) {
      announce('Audio system not ready');
      return;
    }
    if (!track.audioBuffer || engine.inPoint === null || engine.outPoint === null) {
      announce('Set In and Out points first');
      return;
    }

    const sr = track.audioBuffer.sampleRate;
    const startSample = Math.max(0, Math.floor(engine.inPoint * sr));
    const endSample = Math.min(track.audioBuffer.length, Math.floor(engine.outPoint * sr));
    const newLength = endSample - startSample;

    if (newLength <= 0) {
      announce('Invalid loop region for trimming');
      return;
    }

    const newBuffer = engine.ctx.createBuffer(track.audioBuffer.numberOfChannels, newLength, sr);

    for (let ch = 0; ch < track.audioBuffer.numberOfChannels; ch++) {
      const oldData = track.audioBuffer.getChannelData(ch);
      const newData = newBuffer.getChannelData(ch);
      for (let i = 0; i < newLength; i++) {
        newData[i] = oldData[startSample + i];
      }
    }

    track.audioBuffer = newBuffer;
    track.startTimeOffset = 0;
    renderTracks();
    announce(track.name + ' trimmed to loop region');
  }

  function clearTrack(index) {
    const track = engine.tracks[index];
    cleanupTrackNodes(track);
    track.audioBuffer = null;
    renderTracks();
    announce(track.name + ' cleared');
  }

  function cleanupTrackNodes(track) {
    if (track.sourceNode) {
      track.sourceNode.onended = null;
      try { track.sourceNode.stop(); } catch (e) {}
      try { track.sourceNode.disconnect(); } catch (e) {}
      track.sourceNode = null;
    }
    if (track.gainNode) { try { track.gainNode.disconnect(); } catch (e) {} track.gainNode = null; }
    if (track.pannerNode) { try { track.pannerNode.disconnect(); } catch (e) {} track.pannerNode = null; }
    if (track.eqLow) { try { track.eqLow.disconnect(); } catch (e) {} track.eqLow = null; }
    if (track.eqMid) { try { track.eqMid.disconnect(); } catch (e) {} track.eqMid = null; }
    if (track.eqHigh) { try { track.eqHigh.disconnect(); } catch (e) {} track.eqHigh = null; }
  }

  function stopAllSources() {
    engine.tracks.forEach(t => cleanupTrackNodes(t));
    stopMetronome();
    engine.isPlaying = false;
    updatePlaybackButtons();
  }

  function buildTrackNodes(track, startTime, offset, duration) {
    if (!track.audioBuffer || !engine.ctx) return;
    const anySolo = engine.tracks.some(t => t.isSolo);
    const isAudible = !track.isMuted && (!anySolo || track.isSolo);
    if (!isAudible) return;

    const source = engine.ctx.createBufferSource();
    source.buffer = track.audioBuffer;
    source.detune.value = track.pitchSemitones * 100;

    const eqLow = engine.ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 100;
    eqLow.gain.value = track.eqLowVal;

    const eqMid = engine.ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.gain.value = track.eqMidVal;

    const eqHigh = engine.ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 10000;
    eqHigh.gain.value = track.eqHighVal;

    const panner = engine.ctx.createStereoPanner ? engine.ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = track.pan;

    const gainNode = engine.ctx.createGain();
    gainNode.gain.value = track.volume;

    source.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    let last = eqHigh;
    if (panner) { last.connect(panner); last = panner; }
    last.connect(gainNode);
    gainNode.connect(engine.masterGain);

    const useLoopRegion = engine.loopEnabled && engine.inPoint !== null && engine.outPoint !== null;
    if (useLoopRegion) {
      const regionStart = engine.inPoint;
      const regionDur = engine.outPoint - engine.inPoint;
      if (regionDur <= 0) return;
      const regionPos = offset - regionStart;
      let effectiveOffset = regionStart;
      if (regionPos >= 0) {
        effectiveOffset = regionStart + (regionPos % regionDur);
      }
      if (effectiveOffset >= track.audioBuffer.duration) {
        effectiveOffset = regionStart;
      }
      source.start(startTime, effectiveOffset, regionDur);
      source.onended = () => {
        if (engine.isPlaying && engine.loopEnabled && engine.inPoint !== null && engine.outPoint !== null) {
          scheduleTrack(track);
        }
      };
    } else {
      let effectiveOffset = offset;
      let dur = null;
      if (track.isLooping) {
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = track.audioBuffer.duration;
      } else {
        if (effectiveOffset >= track.audioBuffer.duration) {
          effectiveOffset = 0;
        }
        dur = Math.max(0.01, track.audioBuffer.duration - effectiveOffset);
      }
      source.start(startTime, effectiveOffset, dur);
      source.onended = () => {
        if (engine.isPlaying && !engine.loopEnabled && !track.isLooping) {
          checkAllTracksEnded();
        }
      };
    }

    track.sourceNode = source;
    track.gainNode = gainNode;
    track.pannerNode = panner;
    track.eqLow = eqLow;
    track.eqMid = eqMid;
    track.eqHigh = eqHigh;
  }

  function scheduleTrack(track) {
    if (!track.audioBuffer || !engine.ctx) return;
    const now = engine.ctx.currentTime;
    const offset = engine.currentTime;
    buildTrackNodes(track, now, offset, null);
  }

  function scheduleAllTracks() {
    engine.tracks.forEach(t => scheduleTrack(t));
  }

  function checkAllTracksEnded() {
    const anyAudible = engine.tracks.some(t => {
      if (!t.audioBuffer || !t.sourceNode) return false;
      const anySolo = engine.tracks.some(ts => ts.isSolo);
      return !t.isMuted && (!anySolo || t.isSolo);
    });
    if (!anyAudible) {
      stopPlayback();
      engine.currentTime = 0;
      updateDisplays();
      announce('Playback finished');
    }
  }

  async function startPlayback(fromStart = false) {
    await initAudio();
    stopPlayback();

    const now = engine.ctx.currentTime;
    engine.playStartTime = now;

    if (fromStart) {
      engine.currentTime = 0;
    } else if (engine.loopEnabled && engine.inPoint !== null) {
      engine.currentTime = engine.inPoint;
    } else {
      engine.currentTime = 0;
    }

    scheduleAllTracks();
    if (engine.metronomeOn) startMetronome();

    engine.isPlaying = true;
    updatePlaybackButtons();
    announce('Playing');
    tick();
  }

  function stopPlayback() {
    if (engine.rafId) {
      cancelAnimationFrame(engine.rafId);
      engine.rafId = null;
    }
    stopAllSources();
  }

  function goToStart() {
    engine.currentTime = 0;
    if (engine.isPlaying) {
      stopAllSources();
      scheduleAllTracks();
      if (engine.metronomeOn) startMetronome();
      engine.isPlaying = true;
      updatePlaybackButtons();
      announce('Playhead reset to start');
    } else {
      updateDisplays();
      announce('Playhead at start');
    }
  }

  function tick() {
    if (!engine.isPlaying || !engine.ctx) return;
    const now = engine.ctx.currentTime;
    engine.currentTime = now - engine.playStartTime;

    const useLoopRegion = engine.loopEnabled && engine.inPoint !== null && engine.outPoint !== null;
    if (useLoopRegion) {
      const regionDur = engine.outPoint - engine.inPoint;
      if (regionDur > 0 && engine.currentTime >= engine.outPoint) {
        engine.currentTime = engine.inPoint + ((engine.currentTime - engine.inPoint) % regionDur);
        engine.playStartTime = now - engine.currentTime;
        stopAllSources();
        scheduleAllTracks();
        if (engine.metronomeOn) startMetronome();
        engine.isPlaying = true;
        updatePlaybackButtons();
      }
    }

    updateDisplays();
    engine.rafId = requestAnimationFrame(tick);
  }

  function startMetronome() {
    stopMetronome();
    engine.metronomeNextNote = engine.ctx.currentTime + 0.05;
    engine._metronomeLookahead = 25;
    engine._metronomeScheduleAheadTime = 0.1;
    schedulerMetronome();
  }

  function stopMetronome() {
    if (engine.schedulerTimer) {
      clearTimeout(engine.schedulerTimer);
      engine.schedulerTimer = null;
    }
  }

  function scheduleClick(time, isAccent) {
    if (!engine.ctx) return;
    const osc = engine.ctx.createOscillator();
    const gain = engine.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isAccent ? 1600 : 1000, time);
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    osc.connect(gain);
    gain.connect(engine.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.04);
  }

  function schedulerMetronome() {
    const secondsPerBeat = 60.0 / engine.bpm;
    while (engine.metronomeNextNote < engine.ctx.currentTime + engine._metronomeScheduleAheadTime) {
      const elapsed = engine.metronomeNextNote - (engine.ctx.currentTime - engine.currentTime);
      const beatIndex = Math.round(elapsed / secondsPerBeat) % 4;
      const isAccent = beatIndex === 0;
      scheduleClick(engine.metronomeNextNote, isAccent);
      engine.metronomeNextNote += secondsPerBeat;
    }
    engine.schedulerTimer = setTimeout(schedulerMetronome, engine._metronomeLookahead);
  }

  async function runCountIn(totalBeats, callback) {
    await initAudio();
    if (engine.isCountingIn) return;
    engine.isCountingIn = true;
    announce('Count-in: ' + totalBeats + ' beats');

    const secondsPerBeat = 60.0 / engine.bpm;
    const now = engine.ctx.currentTime;
    for (let b = 0; b < totalBeats; b++) {
      scheduleClick(now + b * secondsPerBeat, b % 4 === 0);
    }
    const duration = totalBeats * secondsPerBeat * 1000;
    setTimeout(() => {
      engine.isCountingIn = false;
      callback();
    }, duration);
  }

  async function prepareAndRecord() {
    await initAudio();
    if (engine.isRecording || engine.isCountingIn) return;

    if (engine.armedIndex < 0 || engine.armedIndex >= engine.tracks.length) {
      announce('No track armed for recording');
      return;
    }

    const deviceId = document.getElementById('audioSource').value;
    const constraints = {
      audio: deviceId
        ? { exact: deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    };

    try {
      engine.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      announce('Microphone access denied or no input found.');
      return;
    }

    const totalBeats = parseInt(document.getElementById('countInSelect').value) || 0;
    const armedTrack = engine.tracks[engine.armedIndex];

    const execute = () => {
      try {
        engine.mediaRecorder = new MediaRecorder(engine.currentStream);
        engine.recordedChunks = [];
        engine.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) engine.recordedChunks.push(e.data); };
        engine.mediaRecorder.onstop = async () => {
          const blob = new Blob(engine.recordedChunks, { type: 'audio/webm' });
          const arrayBuf = await blob.arrayBuffer();
          let decoded = await engine.ctx.decodeAudioData(arrayBuf);
          if (decoded) {
            const countInBeats = parseInt(document.getElementById('countInSelect').value) || 0;
            const secondsPerBeat = 60 / engine.bpm;
            const silenceDuration = countInBeats * secondsPerBeat;
            const startSample = Math.floor(silenceDuration * decoded.sampleRate);
            if (startSample > 0 && startSample < decoded.length) {
              const newLength = decoded.length - startSample;
              const trimmed = engine.ctx.createBuffer(decoded.numberOfChannels, newLength, decoded.sampleRate);
              for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
                const oldData = decoded.getChannelData(ch);
                const newData = trimmed.getChannelData(ch);
                for (let i = 0; i < newLength; i++) newData[i] = oldData[startSample + i];
              }
              decoded = trimmed;
            }
          }
          armedTrack.audioBuffer = decoded;
          renderTracks();
          announce('Recorded to ' + armedTrack.name);
        };

        engine.isRecording = true;
        engine.isRecordingPaused = false;
        updatePlaybackButtons();
        announce('Recording on ' + armedTrack.name);
        engine.mediaRecorder.start();
      } catch (err) {
        announce('Failed to start recorder. Try again.');
      }
    };

    if (totalBeats > 0) {
      await runCountIn(totalBeats, execute);
    } else {
      execute();
    }
  }

  function pauseRecording() {
    if (!engine.isRecording || !engine.mediaRecorder) return;
    if (engine.mediaRecorder.state === 'recording') {
      engine.mediaRecorder.pause();
      engine.isRecordingPaused = true;
      announce('Recording paused');
    } else if (engine.mediaRecorder.state === 'paused') {
      engine.mediaRecorder.resume();
      engine.isRecordingPaused = false;
      announce('Recording resumed');
    }
  }

  function stopRecording() {
    if (!engine.isRecording) return;
    if (engine.mediaRecorder && engine.mediaRecorder.state !== 'inactive') {
      engine.mediaRecorder.stop();
    }
    if (engine.currentStream) engine.currentStream.getTracks().forEach(tr => tr.stop());
    stopPlayback();
    engine.isRecording = false;
    engine.isRecordingPaused = false;
    updatePlaybackButtons();
    announce('Recording stopped');
  }

  async function exportMasterMix() {
    await initAudio();
    const active = engine.tracks.filter(t => t.audioBuffer && !t.isMuted);
    if (active.length === 0) {
      announce('No active audio tracks to render.');
      return;
    }

    let maxLen = 0;
    active.forEach(t => {
      const len = t.audioBuffer.length;
      if (len > maxLen) maxLen = len;
    });

    const sampleRate = engine.ctx.sampleRate;
    const offline = new OfflineAudioContext(2, maxLen, sampleRate);

    active.forEach(t => {
      const src = offline.createBufferSource();
      const gain = offline.createGain();
      src.buffer = t.audioBuffer;
      gain.gain.value = t.volume;

      const eqLow = offline.createBiquadFilter();
      eqLow.type = 'lowshelf';
      eqLow.frequency.value = 100;
      eqLow.gain.value = t.eqLowVal;

      const eqMid = offline.createBiquadFilter();
      eqMid.type = 'peaking';
      eqMid.frequency.value = 1000;
      eqMid.gain.value = t.eqMidVal;

      const eqHigh = offline.createBiquadFilter();
      eqHigh.type = 'highshelf';
      eqHigh.frequency.value = 10000;
      eqHigh.gain.value = t.eqHighVal;

      const panner = offline.createStereoPanner ? offline.createStereoPanner() : null;
      if (panner) panner.pan.value = t.pan;

      src.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      let last = eqHigh;
      if (panner) { last.connect(panner); last = panner; }
      last.connect(gain);
      gain.connect(offline.destination);
      src.start(t.startTimeOffset);
    });

    announce('Rendering mixdown...');
    try {
      const rendered = await offline.startRendering();
      const wav = bufferToWav(rendered);
      downloadBlob(wav, 'Master_Studio_Mixdown.wav');
      announce('Mixdown exported!');
    } catch (e) {
      announce('Export failed. Try again.');
    }
  }

  function bufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const bitDepth = 16;
    const result = numCh === 2
      ? interleave(buffer.getChannelData(0), buffer.getChannelData(1))
      : buffer.getChannelData(0);

    const dataLength = result.length * (bitDepth / 8);
    const ab = new ArrayBuffer(44 + dataLength);
    const view = new DataView(ab);

    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * (bitDepth / 8), true);
    view.setUint16(32, numCh * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let off = 44;
    for (let i = 0; i < result.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, result[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  function interleave(L, R) {
    const len = L.length + R.length;
    const out = new Float32Array(len);
    let i = 0, j = 0;
    while (i < len) {
      out[i++] = L[j];
      out[i++] = R[j];
      j++;
    }
    return out;
  }

  function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async function getAudioDevices() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const sel = document.getElementById('audioSource');
      sel.innerHTML = '';
      inputs.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Hardware Input ' + (i + 1);
        sel.appendChild(opt);
      });
      announce('Found ' + inputs.length + ' audio input device(s).');
    } catch (e) {
      announce('Hardware permission pending or no devices found.');
    }
  }

  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Home'].includes(e.code)) {
      e.preventDefault();
    }

    switch (e.key) {
      case 'ArrowUp':
        setFocusedTrack(engine.focusedIndex - 1);
        break;
      case 'ArrowDown':
        setFocusedTrack(engine.focusedIndex + 1);
        break;
      case 'ArrowLeft':
        if (engine.isPlaying) break;
        const stepL = e.shiftKey ? -(60 / engine.bpm) * 4 : (e.ctrlKey ? -(60 / engine.bpm) / 4 : -(60 / engine.bpm));
        engine.currentTime = Math.max(0, engine.currentTime + stepL);
        updateDisplays();
        break;
      case 'ArrowRight':
        if (engine.isPlaying) break;
        const stepR = e.shiftKey ? (60 / engine.bpm) * 4 : (e.ctrlKey ? (60 / engine.bpm) / 4 : (60 / engine.bpm));
        engine.currentTime += stepR;
        updateDisplays();
        break;
      case 'Home':
        goToStart();
        break;
      case ' ':
        if (engine.isRecording) {
          pauseRecording();
        } else if (engine.isPlaying) {
          stopPlayback();
        } else {
          startPlayback(false);
        }
        break;
      case 'r':
      case 'R':
        if (engine.isRecording) {
          stopRecording();
        } else if (!engine.isCountingIn) {
          prepareAndRecord();
        }
        break;
      case 's':
      case 'S':
        if (!ctrl) {
          engine.inPoint = engine.currentTime;
          updateDisplays();
          announce('In point at ' + engine.inPoint.toFixed(2) + ' seconds');
        }
        break;
      case 'e':
      case 'E':
        if (ctrl && engine.ctx) {
          e.preventDefault();
          exportMasterMix();
        } else if (!ctrl) {
          engine.outPoint = engine.currentTime;
          updateDisplays();
          announce('Out point at ' + engine.outPoint.toFixed(2) + ' seconds');
        }
        break;
      case 'Escape':
        if (engine.isRecording) stopRecording();
        stopPlayback();
        engine.currentTime = 0;
        updateDisplays();
        announce('Stopped, playhead at start, regions cleared');
        break;
      case 't':
      case 'T':
        if (!ctrl) {
          engine.timeMode = engine.timeMode === 'bars' ? 'seconds' : 'bars';
          document.getElementById('modeBadge').textContent = 'Time Base: ' + (engine.timeMode === 'bars' ? 'Bars & Beats' : 'Seconds & MS');
          updateDisplays();
          announce('Time mode: ' + engine.timeMode);
        }
        break;
      case 'm':
      case 'M':
        engine.metronomeOn = !engine.metronomeOn;
        updateMetronomeButton();
        if (engine.metronomeOn && engine.isPlaying) startMetronome();
        else stopMetronome();
        announce('Metronome ' + (engine.metronomeOn ? 'on' : 'off'));
        break;
      case 'l':
      case 'L':
        engine.loopEnabled = !engine.loopEnabled;
        updateLoopButton();
        updateDisplays();
        announce('Loop ' + (engine.loopEnabled ? 'enabled' : 'disabled'));
        if (engine.loopEnabled) announce('Set In (S) and Out (E) points to define loop region');
        break;
      default:
        break;
    }
  });

  document.getElementById('btnAddTrack').onclick = () => createAudioTrack();
  document.getElementById('btnRecord').onclick = () => engine.isRecording ? stopRecording() : prepareAndRecord();
  document.getElementById('btnPlayAll').onclick = () => engine.isPlaying ? stopPlayback() : startPlayback(false);
  document.getElementById('btnStop').onclick = () => { if (engine.isRecording) stopRecording(); stopPlayback(); engine.currentTime = 0; updateDisplays(); };
  document.getElementById('btnGoStart').onclick = goToStart;
  document.getElementById('btnGlobalLoop').onclick = () => { engine.loopEnabled = !engine.loopEnabled; updateLoopButton(); updateDisplays(); announce('Loop ' + (engine.loopEnabled ? 'enabled' : 'disabled')); };
  document.getElementById('btnMetronome').onclick = () => { engine.metronomeOn = !engine.metronomeOn; updateMetronomeButton(); if (engine.metronomeOn && engine.isPlaying) startMetronome(); else stopMetronome(); announce('Metronome ' + (engine.metronomeOn ? 'on' : 'off')); };
  document.getElementById('btnExport').onclick = exportMasterMix;
  document.getElementById('btnToggleTime').onclick = () => {
    engine.timeMode = engine.timeMode === 'bars' ? 'seconds' : 'bars';
    document.getElementById('modeBadge').textContent = 'Time Base: ' + (engine.timeMode === 'bars' ? 'Bars & Beats' : 'Seconds & MS');
    updateDisplays();
    announce('Time mode: ' + engine.timeMode);
  };
  document.getElementById('btnScanHardware').onclick = getAudioDevices;

  document.getElementById('audioFileInput').addEventListener('change', async (e) => {
    await initAudio();
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const decoded = await engine.ctx.decodeAudioData(buffer);
      createAudioTrack(file.name.replace(/\.[^/.]+$/, ''), 'audio');
      engine.tracks[engine.tracks.length - 1].audioBuffer = decoded;
      announce('Imported file ' + file.name);
    } catch (err) {
      announce('Error decoding audio file. Format unsupported.');
    }
  });

  document.getElementById('trackAudioInput').addEventListener('change', async (e) => {
    await initAudio();
    const file = e.target.files[0];
    if (!file || engine.pendingTrackUploadIndex === null) return;
    const index = engine.pendingTrackUploadIndex;
    engine.pendingTrackUploadIndex = null;
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await engine.ctx.decodeAudioData(buffer);
      engine.tracks[index].audioBuffer = decoded;
      renderTracks();
      announce('Imported ' + file.name + ' to ' + engine.tracks[index].name);
    } catch (err) {
      announce('Error decoding audio file for this track.');
    }
  });

  document.getElementById('bpmInput').addEventListener('change', (e) => {
    engine.bpm = parseInt(e.target.value) || 120;
    announce('BPM set to ' + engine.bpm);
  });

  window.addEventListener('load', () => {
    createAudioTrack('Track 1');
    engine.armedIndex = 0;
    renderTracks();
    getAudioDevices();
    updateDisplays();
  });
})();
