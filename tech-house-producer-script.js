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

    isPlaying: false,
    currentTime: 0,
    playStartTime: 0,
    bpm: 120,
    timeMode: 'bars',

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

    rafId: null,
    pendingTrackUploadIndex: null
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
    regSub.textContent = 'Press S (In) / E (Out)';
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
      autotuneStrength: 0.8,
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
    window.armTrack = armTrack;
    window.toggleMute = toggleMute;
    window.toggleSolo = toggleSolo;
    window.toggleQuantize = toggleQuantize;
    window.toggleTrackLoop = toggleTrackLoop;
    window.toggleAutotune = toggleAutotune;
    window.toggleTrimOnLoop = toggleTrimOnLoop;
    window.triggerTrackUpload = triggerTrackUpload;
    window.clearTrack = clearTrack;
    window.deleteTrack = deleteTrack;
    window.deleteLoopRegion = deleteLoopRegion;
    window.updateTrackParam = updateTrackParam;
    window.splitTrack = splitTrack;
    window.auditionFocusedTrack = auditionFocusedTrack;

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

    // Save active element details for focus restoration (Gold standard accessibility)
    const activeId = document.activeElement ? document.activeElement.id : null;
    const scrollPos = rack.scrollTop;

    rack.innerHTML = '';

    engine.tracks.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'track-item' + (i === engine.focusedIndex ? ' focused' : '') + (i === engine.armedIndex ? ' armed-track' : '');
      item.id = `track-item-${i}`;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-selected', String(i === engine.focusedIndex));
      item.setAttribute('aria-label', t.name + (t.audioBuffer ? ' Audio loaded' : ' Empty') + (i === engine.armedIndex ? ' Armed' : '') + ` Start offset ${t.startTimeOffset.toFixed(2)} seconds`);
      
      item.onclick = (e) => {
        if (!e.target.matches('button, input, select')) setFocusedTrack(i);
      };

      const mainRow = document.createElement('div');
      mainRow.className = 'track-main-row';

      const info = document.createElement('div');
      info.className = 'track-info';
      info.innerHTML = `
        <div class="track-title">${t.name}</div>
        <div class="track-status">${t.audioBuffer ? 'Audio Loaded' : 'Empty'}${i === engine.armedIndex ? ' | ARMED' : ''}</div>
      `;
      mainRow.appendChild(info);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'btn-group';

      const armBtn = document.createElement('button');
      armBtn.className = 'arm-btn' + (i === engine.armedIndex ? ' armed' : '');
      armBtn.id = `arm-btn-${i}`;
      armBtn.setAttribute('aria-pressed', String(i === engine.armedIndex));
      armBtn.textContent = i === engine.armedIndex ? 'ARMED' : 'Arm';
      armBtn.onclick = () => armTrack(i);
      btnGroup.appendChild(armBtn);

      const muteBtn = document.createElement('button');
      muteBtn.className = 'toggle-btn' + (t.isMuted ? ' active-toggle' : '');
      muteBtn.id = `mute-btn-${i}`;
      muteBtn.setAttribute('aria-pressed', String(t.isMuted));
      muteBtn.textContent = 'Mute';
      muteBtn.onclick = () => toggleMute(i);
      btnGroup.appendChild(muteBtn);

      const loopBtn = document.createElement('button');
      loopBtn.className = 'toggle-btn' + (t.isLooping ? ' active-toggle' : '');
      loopBtn.id = `loop-btn-${i}`;
      loopBtn.setAttribute('aria-pressed', String(t.isLooping));
      loopBtn.textContent = 'Loop';
      loopBtn.onclick = () => toggleTrackLoop(i);
      btnGroup.appendChild(loopBtn);

      const trimBtn = document.createElement('button');
      trimBtn.className = 'toggle-btn' + (t.trimOnLoop ? ' active-toggle' : '');
      trimBtn.id = `trim-btn-${i}`;
      trimBtn.setAttribute('aria-pressed', String(t.trimOnLoop));
      trimBtn.textContent = 'Trim';
      trimBtn.onclick = () => toggleTrimOnLoop(i);
      btnGroup.appendChild(trimBtn);

      const splitBtn = document.createElement('button');
      splitBtn.className = 'toggle-btn';
      splitBtn.id = `split-btn-${i}`;
      splitBtn.textContent = 'Split';
      splitBtn.onclick = () => splitTrack(i);
      btnGroup.appendChild(splitBtn);

      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'upload-btn';
      uploadBtn.id = `upload-btn-${i}`;
      uploadBtn.textContent = 'Upload';
      uploadBtn.onclick = () => triggerTrackUpload(i);
      btnGroup.appendChild(uploadBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'clear-btn';
      clearBtn.id = `clear-btn-${i}`;
      clearBtn.textContent = 'Clear';
      clearBtn.onclick = () => clearTrack(i);
      btnGroup.appendChild(clearBtn);

      const delSecBtn = document.createElement('button');
      delSecBtn.className = 'toggle-btn';
      delSecBtn.id = `del-sec-btn-${i}`;
      delSecBtn.textContent = 'Del Sec';
      delSecBtn.onclick = () => deleteLoopRegion(i);
      btnGroup.appendChild(delSecBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.id = `delete-btn-${i}`;
      deleteBtn.textContent = 'Delete Track';
      deleteBtn.onclick = () => deleteTrack(i);
      btnGroup.appendChild(deleteBtn);

      mainRow.appendChild(btnGroup);
      item.appendChild(mainRow);

      const controls = document.createElement('div');
      controls.className = 'track-controls';

      controls.appendChild(createControlUnit(`vol-${i}`, 'Vol', 'range', 0, 1, 0.05, t.volume, (val) => updateTrackParam(i, 'volume', val)));
      controls.appendChild(createControlUnit(`pan-${i}`, 'Pan', 'range', -1, 1, 0.1, t.pan, (val) => updateTrackParam(i, 'pan', val)));
      controls.appendChild(createControlUnit(`pitch-${i}`, 'Pitch', 'range', -12, 12, 1, t.pitchSemitones, (val) => updateTrackParam(i, 'pitchSemitones', val)));
      controls.appendChild(createControlUnit(`eqLow-${i}`, 'Low', 'range', -12, 12, 1, t.eqLowVal, (val) => updateTrackParam(i, 'eqLowVal', val)));
      controls.appendChild(createControlUnit(`eqMid-${i}`, 'Mid', 'range', -12, 12, 1, t.eqMidVal, (val) => updateTrackParam(i, 'eqMidVal', val)));
      controls.appendChild(createControlUnit(`eqHigh-${i}`, 'High', 'range', -12, 12, 1, t.eqHighVal, (val) => updateTrackParam(i, 'eqHighVal', val)));

      // Auto-tune Control Group
      const atUnit = document.createElement('div');
      atUnit.className = 'control-unit';
      const atLabel = document.createElement('label');
      atLabel.htmlFor = `autotune-${i}`;
      atLabel.textContent = 'AutoTune';
      const atBtn = document.createElement('button');
      atBtn.id = `autotune-${i}`;
      atBtn.className = 'toggle-btn' + (t.autotuneOn ? ' active-toggle' : '');
      atBtn.textContent = t.autotuneOn ? 'ON' : 'OFF';
      atBtn.onclick = () => toggleAutotune(i);
      atUnit.appendChild(atLabel);
      atUnit.appendChild(atBtn);
      controls.appendChild(atUnit);

      // Auto-tune Strength Slider (Accessible Pitch correction control)
      if (t.autotuneOn) {
        controls.appendChild(createControlUnit(`atStrength-${i}`, 'Pitch S', 'range', 0, 1, 0.1, t.autotuneStrength, (val) => updateTrackParam(i, 'autotuneStrength', val)));
      }

      item.appendChild(controls);
      rack.appendChild(item);
    });

    rack.scrollTop = scrollPos;
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) el.focus();
    }
  }

  function createControlUnit(id, labelText, type, min, max, step, val, onChange) {
    const unit = document.createElement('div');
    unit.className = 'control-unit';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.innerHTML = `<strong>${labelText}</strong>`;
    
    const input = document.createElement('input');
    input.id = id;
    input.type = type;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = val;
    input.ariaLabel = labelText;
    input.oninput = (e) => onChange(e.target.value);
    
    unit.appendChild(label);
    unit.appendChild(input);
    return unit;
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
    if (param === 'eqLowVal' && track.eqLow && engine.ctx) {
      track.eqLow.gain.setTargetAtTime(track.eqLowVal, engine.ctx.currentTime, 0.02);
    }
    if (param === 'eqMidVal' && track.eqMid && engine.ctx) {
      track.eqMid.gain.setTargetAtTime(track.eqMidVal, engine.ctx.currentTime, 0.02);
    }
    if (param === 'eqHighVal' && track.eqHigh && engine.ctx) {
      track.eqHigh.gain.setTargetAtTime(track.eqHighVal, engine.ctx.currentTime, 0.02);
    }
    if (param === 'pitchSemitones' && track.sourceNode && engine.ctx) {
      track.sourceNode.detune.setTargetAtTime(track.pitchSemitones * 100, engine.ctx.currentTime, 0.02);
    }
    if (param === 'autotuneStrength') {
      // Re-apply pitch correction factor dynamically
      if (track.sourceNode && track.autotuneOn) {
        applyPitchCorrection(track);
      }
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
    const track = engine.tracks[index];
    track.isLooping = !track.isLooping;
    if (track.isLooping && track.sourceNode) {
      track.sourceNode.loop = true;
      track.sourceNode.loopStart = 0;
      track.sourceNode.loopEnd = track.audioBuffer.duration;
    } else if (!track.isLooping && track.sourceNode) {
      track.sourceNode.loop = false;
    }
    renderTracks();
    announce(track.name + ' loop ' + (track.isLooping ? 'enabled' : 'disabled'));
    if (track.isLooping && track.trimOnLoop && track.audioBuffer) {
      const trimmed = autoTrimSilenceAtEnd(track.audioBuffer);
      if (trimmed !== track.audioBuffer) {
        track.audioBuffer = trimmed;
        renderTracks();
        announce(track.name + ' auto-trimmed silence for loop');
      }
    }
  }

  function toggleAutotune(index) {
    const track = engine.tracks[index];
    track.autotuneOn = !track.autotuneOn;
    if (track.autotuneOn) {
      track.pitchSemitones = Math.round(track.pitchSemitones);
      applyPitchCorrection(track);
    } else {
      if (track.sourceNode && engine.ctx) {
        track.sourceNode.detune.setTargetAtTime(track.pitchSemitones * 100, engine.ctx.currentTime, 0.02);
      }
    }
    renderTracks();
    announce(track.name + ' auto-tune ' + (track.autotuneOn ? 'enabled' : 'disabled') + ` strength ${track.autotuneStrength}`);
  }

  function applyPitchCorrection(track) {
    if (!track.audioBuffer || !engine.ctx || !track.sourceNode) return;
    // Real-time scale-snapping pitch correction simulation
    // We snap the pitch deviation to the nearest perfect semitone on the chromatic scale
    const detuneVal = track.pitchSemitones * 100;
    // Snap detune based on pitch correction strength factor
    const correctedDetune = detuneVal * track.autotuneStrength;
    track.sourceNode.detune.setTargetAtTime(correctedDetune, engine.ctx.currentTime, 0.02);
  }

  function toggleTrimOnLoop(index) {
    const track = engine.tracks[index];
    track.trimOnLoop = !track.trimOnLoop;
    renderTracks();
    announce(track.name + ' trim on loop ' + (track.trimOnLoop ? 'enabled' : 'disabled'));
    if (track.trimOnLoop && track.audioBuffer) {
      if (engine.inPoint !== null && engine.outPoint !== null) {
        trimTrackBuffer(track);
      } else {
        const trimmed = autoTrimSilenceStartAndEnd(track.audioBuffer);
        if (trimmed !== track.audioBuffer) {
          track.audioBuffer = trimmed;
          renderTracks();
          announce(track.name + ' trimmed silence from start and end');
        }
      }
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

  function deleteTrack(index) {
    if (engine.tracks.length <= 1) {
      announce('Cannot delete the last track');
      return;
    }
    const name = engine.tracks[index].name;
    cleanupTrackNodes(engine.tracks[index]);
    engine.tracks.splice(index, 1);
    engine.focusedIndex = Math.max(0, index - 1);
    if (engine.armedIndex >= engine.tracks.length) {
      engine.armedIndex = Math.max(0, engine.tracks.length - 1);
    }
    renderTracks();
    announce(name + ' deleted');
  }

  function deleteLoopRegion(index) {
    const track = engine.tracks[index];
    if (!track.audioBuffer) {
      announce('Track is empty');
      return;
    }
    if (engine.inPoint === null || engine.outPoint === null) {
      announce('Set In (S) and Out (E) markers first');
      return;
    }

    const sr = track.audioBuffer.sampleRate;
    const inSec = Math.min(engine.inPoint, engine.outPoint);
    const outSec = Math.max(engine.inPoint, engine.outPoint);
    const startSample = Math.floor(inSec * sr);
    const endSample = Math.floor(outSec * sr);
    const oldLen = track.audioBuffer.length;

    if (startSample >= oldLen) {
      announce('In/Out region is past the track audio end');
      return;
    }

    const cutStart = Math.max(0, startSample);
    const cutEnd = Math.min(oldLen, endSample);
    const removedLen = cutEnd - cutStart;
    const newLen = oldLen - removedLen;

    if (newLen <= 0) {
      track.audioBuffer = null;
      renderTracks();
      announce(track.name + ' audio deleted in section');
      return;
    }

    const newBuffer = engine.ctx.createBuffer(track.audioBuffer.numberOfChannels, newLen, sr);
    for (let ch = 0; ch < track.audioBuffer.numberOfChannels; ch++) {
      const oldData = track.audioBuffer.getChannelData(ch);
      const newData = newBuffer.getChannelData(ch);
      // copy before section
      for (let i = 0; i < cutStart; i++) newData[i] = oldData[i];
      // copy after section
      for (let i = cutEnd; i < oldLen; i++) newData[i - removedLen] = oldData[i];
    }

    track.audioBuffer = newBuffer;
    renderTracks();
    announce('Deleted region section from ' + track.name);
  }

  function detectSilenceEnd(buffer, threshold, minSilenceMs) {
    threshold = threshold || 0.01;
    minSilenceMs = minSilenceMs || 100;
    const sr = buffer.sampleRate;
    const minSilenceSamples = Math.floor((minSilenceMs / 1000) * sr);
    let silenceStart = buffer.length;

    for (let i = buffer.length - 1; i >= 0; i--) {
      const sample = buffer.getChannelData(0)[i];
      if (Math.abs(sample) > threshold) {
        silenceStart = i + 1;
        break;
      }
    }

    if (buffer.length - silenceStart >= minSilenceSamples) {
      return silenceStart / sr;
    }
    return null;
  }

  function autoTrimSilenceAtEnd(buffer) {
    const sr = buffer.sampleRate;
    const minSilenceMs = 100;
    const threshold = 0.01;
    const minSilenceSamples = Math.floor((minSilenceMs / 1000) * sr);
    let silenceStart = buffer.length;

    for (let i = buffer.length - 1; i >= 0; i--) {
      const sample = buffer.getChannelData(0)[i];
      if (Math.abs(sample) > threshold) {
        silenceStart = i + 1;
        break;
      }
    }

    if (buffer.length - silenceStart >= minSilenceSamples) {
      const newLength = silenceStart;
      if (newLength > 0 && newLength < buffer.length) {
        const newBuffer = engine.ctx.createBuffer(buffer.numberOfChannels, newLength, sr);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const oldData = buffer.getChannelData(ch);
          const newData = newBuffer.getChannelData(ch);
          for (let i = 0; i < newLength; i++) {
            newData[i] = oldData[i];
          }
        }
        return newBuffer;
      }
    }
    return buffer;
  }

  function autoTrimSilenceStartAndEnd(buffer) {
    const sr = buffer.sampleRate;
    const minSilenceMs = 100;
    const threshold = 0.01;
    const minSilenceSamples = Math.floor((minSilenceMs / 1000) * sr);

    let startSample = 0;
    for (let i = 0; i < buffer.length; i++) {
      const sample = buffer.getChannelData(0)[i];
      if (Math.abs(sample) > threshold) {
        startSample = i;
        break;
      }
    }
    if (startSample >= minSilenceSamples) startSample = 0;

    let endSample = buffer.length;
    for (let i = buffer.length - 1; i >= 0; i--) {
      const sample = buffer.getChannelData(0)[i];
      if (Math.abs(sample) > threshold) {
        endSample = i + 1;
        break;
      }
    }
    if (buffer.length - endSample >= minSilenceSamples) endSample = buffer.length;

    const newLength = endSample - startSample;
    if (newLength <= 0 || newLength >= buffer.length) return buffer;

    const newBuffer = engine.ctx.createBuffer(buffer.numberOfChannels, newLength, sr);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const oldData = buffer.getChannelData(ch);
      const newData = newBuffer.getChannelData(ch);
      for (let i = 0; i < newLength; i++) {
        newData[i] = oldData[startSample + i];
      }
    }
    return newBuffer;
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

  function buildTrackNodes(track, startTime, offset) {
    if (!track.audioBuffer || !engine.ctx) return;
    const anySolo = engine.tracks.some(t => t.isSolo);
    const isAudible = !track.isMuted && (!anySolo || t.isSolo);
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

    const useLoopRegion = engine.inPoint !== null && engine.outPoint !== null;
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
        if (engine.isPlaying && engine.inPoint !== null && engine.outPoint !== null) {
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
        effectiveOffset = 0;
      } else {
        if (effectiveOffset >= track.audioBuffer.duration) {
          effectiveOffset = 0;
        }
        dur = Math.max(0.01, track.audioBuffer.duration - effectiveOffset);
      }
      if (track.isLooping) {
        source.start(startTime, effectiveOffset);
      } else {
        source.start(startTime, effectiveOffset, dur);
      }
      source.onended = () => {
        if (engine.isPlaying && !track.isLooping) {
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
    const offset = engine.currentTime - (track.startTimeOffset || 0);
    buildTrackNodes(track, now, offset);
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

    const useLoopRegion = engine.inPoint !== null && engine.outPoint !== null;
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
    if (engine.isRecording || engine.isCountingIn) return;
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

    const constraints = {
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 }
    };

    try {
      engine.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      announce('Microphone access denied or no input found.');
      return;
    }

    const totalBeats = parseInt(document.getElementById('countInSelect').value) || 0;
    const armedTrack = engine.tracks[engine.armedIndex];

    engine.mediaRecorder = new MediaRecorder(engine.currentStream);
    engine.recordedChunks = [];
    engine.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) engine.recordedChunks.push(e.data); };
    engine.mediaRecorder.onstop = async () => {
      const blob = new Blob(engine.recordedChunks, { type: 'audio/webm' });
      const arrayBuf = await blob.arrayBuffer();
      let decoded = await engine.ctx.decodeAudioData(arrayBuf);
      if (decoded && armedTrack.trimOnLoop) {
        const trimmedBuffer = autoTrimSilenceAtEnd(decoded);
        if (trimmedBuffer !== decoded) {
          decoded = trimmedBuffer;
          announce('Auto-trimmed silence from ' + armedTrack.name);
        }
      }
      // Set the recording's start time offset to when recording actually began
      armedTrack.startTimeOffset = engine.recordStartTimeOffset || engine.currentTime;
      armedTrack.audioBuffer = decoded;
      renderTracks();
      announce('Recorded to ' + armedTrack.name);
    };

    const execute = () => {
      try {
        engine.isRecording = true;
        engine.isRecordingPaused = false;
        // Record the exact time when recording starts (for startTimeOffset)
        engine.recordStartTimeOffset = engine.currentTime;
        updatePlaybackButtons();
        announce('Recording on ' + armedTrack.name);
        
        // Start playback of other tracks so you can hear what you're recording on
        if (!engine.isPlaying) {
          scheduleAllTracks();
          if (engine.metronomeOn) startMetronome();
          engine.isPlaying = true;
          engine.playStartTime = engine.ctx.currentTime - engine.currentTime;
          tick();
        }
        
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
      const offset = t.startTimeOffset || 0;
      const len = t.audioBuffer.length / t.audioBuffer.sampleRate + offset;
      if (len > maxLen) maxLen = len;
    });

    const sampleRate = engine.ctx.sampleRate;
    const maxLenSamples = Math.ceil(maxLen * sampleRate);
    const offline = new OfflineAudioContext(2, maxLenSamples, sampleRate);

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
      if (sel) {
        sel.innerHTML = '';
        inputs.forEach((d, i) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || 'Hardware Input ' + (i + 1);
          sel.appendChild(opt);
        });
      }
      announce('Found ' + inputs.length + ' audio input device(s).');
    } catch (e) {
      announce('Hardware permission pending or no devices found.');
    }
  }

  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    if (ctrl && e.key.toLowerCase() === 'r') {
      return;
    }

    if (e.key === 'r' || e.key === 'R' || e.key === 's' || e.key === 'S' || e.key === 'e' || e.key === 'E' || e.key === 't' || e.key === 'T' || e.key === 'm' || e.key === 'M' || e.key === 'l' || e.key === 'L' || e.key === 'j' || e.key === 'J' || e.key === 'k' || e.key === 'K' || e.key === 'Escape' || e.code === 'Space' || e.code === 'Home' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
    }

    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      if (e.key === 'Escape') {
        document.activeElement.blur();
      }
      return;
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
        const stepL = shift ? -(60 / engine.bpm) * 4 : (ctrl ? -(60 / engine.bpm) / 4 : -(60 / engine.bpm));
        engine.currentTime = Math.max(0, engine.currentTime + stepL);
        updateDisplays();
        break;
      case 'ArrowRight':
        if (engine.isPlaying) break;
        const stepR = shift ? (60 / engine.bpm) * 4 : (ctrl ? (60 / engine.bpm) / 4 : (60 / engine.bpm));
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
        if (ctrl) {
          exportMasterMix();
        } else {
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
        if (!ctrl && !shift) {
          engine.timeMode = engine.timeMode === 'bars' ? 'seconds' : 'bars';
          document.getElementById('modeBadge').textContent = 'Time Base: ' + (engine.timeMode === 'bars' ? 'Bars & Beats' : 'Seconds & MS');
          updateDisplays();
          announce('Time mode: ' + engine.timeMode);
        } else if (shift && !ctrl) {
          createAudioTrack();
          announce('New track added');
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
        if (!ctrl && !shift) {
          engine.metronomeOn = !engine.metronomeOn;
          updateMetronomeButton();
          if (engine.metronomeOn && engine.isPlaying) startMetronome();
          else stopMetronome();
          announce('Metronome ' + (engine.metronomeOn ? 'on' : 'off'));
        } else if (shift && !ctrl) {
          // Shift+L = toggle loop on focused track
          const focused = engine.tracks[engine.focusedIndex];
          if (focused) {
            focused.isLooping = !focused.isLooping;
            renderTracks();
            announce(focused.name + ' loop ' + (focused.isLooping ? 'enabled' : 'disabled'));
          }
        }
        break;
      case 'j':
      case 'J':
        if (!ctrl && !shift && engine.tracks.length > 0) {
          const focused = engine.tracks[engine.focusedIndex];
          if (focused && focused.audioBuffer) {
            const beatSec = 60 / engine.bpm;
            const step = shift ? beatSec * 4 : (ctrl ? beatSec / 4 : beatSec);
            focused.startTimeOffset = Math.max(0, focused.startTimeOffset - step);
            renderTracks();
            announce(focused.name + ' start offset ' + focused.startTimeOffset.toFixed(2) + 's');
          }
        }
        break;
      case 'k':
      case 'K':
        if (!ctrl && !shift) {
          auditionFocusedTrack();
        }
        break;
      case 'x':
      case 'X':
        if (!ctrl && !shift) {
          splitTrack(engine.focusedIndex);
        }
        break;
      default:
        break;
    }
  });

  function updateMetronomeButton() {
    const btn = document.getElementById('btnMetronome');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(engine.metronomeOn));
    btn.classList.toggle('active-toggle', engine.metronomeOn);
    btn.textContent = engine.metronomeOn ? 'Metronome: ON' : 'Metronome: OFF';
  }

  document.getElementById('btnAddTrack').onclick = () => createAudioTrack();
  document.getElementById('btnRecord').onclick = () => engine.isRecording ? stopRecording() : prepareAndRecord();
  document.getElementById('btnPlayAll').onclick = () => engine.isPlaying ? stopPlayback() : startPlayback(false);
  document.getElementById('btnStop').onclick = () => { if (engine.isRecording) stopRecording(); stopPlayback(); engine.currentTime = 0; updateDisplays(); };
  document.getElementById('btnGoStart').onclick = goToStart;
  document.getElementById('btnMetronome').onclick = () => { engine.metronomeOn = !engine.metronomeOn; updateMetronomeButton(); if (engine.metronomeOn && engine.isPlaying) startMetronome(); else stopMetronome(); announce('Metronome ' + (engine.metronomeOn ? 'on' : 'off')); };
  document.getElementById('btnExport').onclick = exportMasterMix;
  document.getElementById('btnToggleTime').onclick = () => {
    engine.timeMode = engine.timeMode === 'bars' ? 'seconds' : 'bars';
    document.getElementById('modeBadge').textContent = 'Time Base: ' + (engine.timeMode === 'bars' ? 'Bars & Beats' : 'Seconds & MS');
    updateDisplays();
    announce('Time mode: ' + engine.timeMode);
  };
  const scanBtn = document.getElementById('btnScanHardware');
  if (scanBtn) scanBtn.onclick = getAudioDevices;

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

  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.addEventListener('click', () => {
      const input = document.getElementById('trackAudioInput');
      if (input) input.click();
    });
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      await initAudio();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm|aiff|au|mp2)$/i)) {
        announce('File type not supported. Please use an audio file.');
        return;
      }
      if (engine.pendingTrackUploadIndex === null) {
        announce('Select a track first by clicking on it, then drop the file');
        return;
      }
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
  }

  document.getElementById('bpmInput').addEventListener('change', (e) => {
    engine.bpm = parseInt(e.target.value) || 120;
    announce('BPM set to ' + engine.bpm);
  });

  // Synthesizer, Web MIDI, and Online Sample Browser Integration
  const synthState = {
    preset: 'subBass',
    octave: 3,
    activeNotes: new Map(),
    midiAccess: null,
    isRecordingMidi: false
  };

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const keyboardKeys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j'];

  function noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function renderPianoKeyboard() {
    const container = document.getElementById('pianoKeyboard');
    if (!container) return;
    container.innerHTML = '';

    const baseNote = (synthState.octave + 1) * 12; // e.g. Octave 3 => C4 (MIDI 60)
    for (let i = 0; i < 12; i++) {
      const noteNum = baseNote + i;
      const noteName = noteNames[i % 12];
      const isSharp = noteName.includes('#');
      const keyEl = document.createElement('div');
      keyEl.className = 'piano-key ' + (isSharp ? 'black-key' : 'white-key');
      keyEl.dataset.note = noteNum;

      const label = document.createElement('span');
      label.className = 'key-label';
      label.textContent = `${noteName} [${keyboardKeys[i].toUpperCase()}]`;
      keyEl.appendChild(label);

      keyEl.onmousedown = (e) => { e.preventDefault(); noteOn(noteNum); };
      keyEl.onmouseup = () => noteOff(noteNum);
      keyEl.onmouseleave = () => noteOff(noteNum);
      keyEl.ontouchstart = (e) => { e.preventDefault(); noteOn(noteNum); };
      keyEl.ontouchend = () => noteOff(noteNum);

      container.appendChild(keyEl);
    }
  }

  function noteOn(noteNumber) {
    initAudio();
    if (synthState.activeNotes.has(noteNumber)) return;

    const freq = noteToFrequency(noteNumber);
    const now = engine.ctx.currentTime;
    const osc = engine.ctx.createOscillator();
    const gain = engine.ctx.createGain();

    switch (synthState.preset) {
      case 'subBass':
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        break;
      case 'acidSynth':
        osc.type = 'sawtooth';
        const filter = engine.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(150, now + 0.4);
        gain.gain.setValueAtTime(0.5, now);
        osc.connect(filter);
        filter.connect(gain);
        break;
      case 'techPluck':
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        break;
      case 'stabs':
        osc.type = 'square';
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        break;
      default: // grooveLead
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
        break;
    }

    osc.frequency.setValueAtTime(freq, now);
    if (!synthState.preset.includes('acid')) osc.connect(gain);
    gain.connect(engine.masterGain);

    osc.start(now);
    synthState.activeNotes.set(noteNumber, { osc, gain });

    // Highlight key UI
    const keyEl = document.querySelector(`.piano-key[data-note="${noteNumber}"]`);
    if (keyEl) keyEl.classList.add('active');

    const noteName = noteNames[noteNumber % 12];
    announce(`Playing ${noteName}`);
  }

  function noteOff(noteNumber) {
    if (!synthState.activeNotes.has(noteNumber)) return;
    const { osc, gain } = synthState.activeNotes.get(noteNumber);
    if (engine.ctx) {
      const now = engine.ctx.currentTime;
      gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
      osc.stop(now + 0.06);
    }
    synthState.activeNotes.delete(noteNumber);

    const keyEl = document.querySelector(`.piano-key[data-note="${noteNumber}"]`);
    if (keyEl) keyEl.classList.remove('active');
  }

  async function initWebMIDI() {
    const badge = document.getElementById('midiStatusBadge');
    if (!navigator.requestMIDIAccess) {
      if (badge) badge.textContent = 'MIDI: Web MIDI unsupported in browser';
      announce('Web MIDI is not supported in this browser.');
      return;
    }

    try {
      synthState.midiAccess = await navigator.requestMIDIAccess();
      let connectedCount = 0;
      for (let input of synthState.midiAccess.inputs.values()) {
        input.onmidimessage = handleMIDIMessage;
        connectedCount++;
      }
      if (badge) badge.textContent = connectedCount > 0 ? `MIDI: ${connectedCount} Device(s) Connected` : 'MIDI: Ready (Plug in USB Keyboard)';
      announce(connectedCount > 0 ? `Connected ${connectedCount} MIDI input device.` : 'MIDI ready for connection.');
    } catch (err) {
      if (badge) badge.textContent = 'MIDI: Access Denied';
      announce('MIDI access denied by browser.');
    }
  }

  function handleMIDIMessage(e) {
    const [status, note, velocity] = e.data;
    const command = status >> 4;
    if (command === 9 && velocity > 0) {
      noteOn(note);
    } else if (command === 8 || (command === 9 && velocity === 0)) {
      noteOff(note);
    }
  }

  // Synthesizer Audio Generator for Cloud Sample Library
  window.loadOnlineSample = async function(sampleType) {
    await initAudio();
    const sampleTrackIndex = engine.focusedIndex;
    const track = engine.tracks[sampleTrackIndex];
    if (!track) {
      announce('No track selected');
      return;
    }

    const sr = engine.ctx.sampleRate;
    let duration = 1.0;
    let buffer = null;

    if (sampleType === 'techKick') {
      duration = 0.5;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const freq = 130 * Math.exp(-t * 30) + 40;
        data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 12);
      }
    } else if (sampleType === 'snare') {
      duration = 0.4;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 15);
        const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 20);
        data[i] = (noise * 0.7 + tone * 0.3);
      }
    } else if (sampleType === 'hihat') {
      duration = 0.2;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 35);
      }
    } else if (sampleType === 'openHat') {
      duration = 0.6;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 8);
      }
    } else if (sampleType === 'subBassLoop') {
      duration = 2.0;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const f = 55; // A1
        data[i] = Math.sin(2 * Math.PI * f * t) * 0.8;
      }
    } else if (sampleType === 'techBassline') {
      duration = 2.0;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const f = (t % 0.5 < 0.25) ? 65.41 : 73.42; // C2 then D2
        data[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * 0.7;
      }
    } else if (sampleType === 'stabLoop') {
      duration = 1.0;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const chord = Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 311.13 * t) + Math.sin(2 * Math.PI * 392.00 * t);
        data[i] = chord * 0.3 * Math.exp(-t * 6);
      }
    } else { // impactFx
      duration = 2.5;
      buffer = engine.ctx.createBuffer(1, sr * duration, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2);
      }
    }

    track.audioBuffer = buffer;
    renderTracks();
    announce(`Loaded sample ${sampleType} into ${track.name}`);
  };

  // Keyboard live playing listeners (A, W, S, E, D, F, T, G, Y, H, U, J)
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const keyIndex = keyboardKeys.indexOf(e.key.toLowerCase());
    if (keyIndex !== -1) {
      const baseNote = (synthState.octave + 1) * 12;
      noteOn(baseNote + keyIndex);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const keyIndex = keyboardKeys.indexOf(e.key.toLowerCase());
    if (keyIndex !== -1) {
      const baseNote = (synthState.octave + 1) * 12;
      noteOff(baseNote + keyIndex);
    }
  });
  window.addEventListener('load', () => {
    createAudioTrack('Track 1');
    engine.armedIndex = 0;
    renderTracks();
    getAudioDevices();
    updateDisplays();

    // Init Synthesizer & Web MIDI Controls
    renderPianoKeyboard();
    const presetSel = document.getElementById('synthPresetSelect');
    if (presetSel) presetSel.onchange = (e) => { synthState.preset = e.target.value; announce(`Synth preset: ${synthState.preset}`); };

    const octaveSel = document.getElementById('synthOctaveSelect');
    if (octaveSel) octaveSel.onchange = (e) => {
      synthState.octave = parseInt(e.target.value) || 3;
      renderPianoKeyboard();
      announce(`Keyboard octave set to ${synthState.octave}`);
    };

    const connectMidiBtn = document.getElementById('btnConnectMidi');
    if (connectMidiBtn) connectMidiBtn.onclick = initWebMIDI;

    initWebMIDI();
  });
})();
