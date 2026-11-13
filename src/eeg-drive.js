/* Optional Muse S / Athena multi-sensor feedback automation.
   The Mac bridge computes EEG beta/alpha, fNIRS slow optical density (<0.18 Hz),
   forehead optical pulse variability (PRV), and 3-axis IMU stillness from actual
   headband samples; this controller calibrates personal game/automation mappings,
   never medical or mental-state diagnoses. Default propulsion uses EEG alone.
   Loading this file performs no network activity. */
(function (global) {
  'use strict';
  const FRESH_MS = 5000, REFERENCE_SAMPLES = 20, FNIRS_REF_SAMPLES = 16, PRV_REF_SAMPLES = 12, SAMPLE_SPACING_MS = 950;
  const SENSOR_MODES = ['eeg', 'fnirs', 'prv', 'stillness', 'fusion'];
  const SENSOR_LABELS = {
    eeg: 'EEG balance (β/α)',
    fnirs: 'fNIRS optical (ΔOD)',
    prv: 'Optical PRV (RMSSD)',
    stillness: 'Head stillness (IMU)',
    fusion: 'Athena 4-sensor fusion',
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const median = values => {
    const a = [...values].sort((x, y) => x - y), i = a.length >> 1;
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  };
  const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.slice(0, 350) : fallback;

  function createEEGDrive(options = {}) {
    const config = options.config === undefined ? global.__BODY_EEG_RELAY__ : options.config;
    // Only a root-relative private path is accepted: never an arbitrary URL,
    // protocol-relative address, query, fragment, or redirect to another host.
    const available = !!(config && /^\/[A-Za-z0-9_-]{1,128}\/$/.test(config.base) &&
      typeof config.session === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(config.session) &&
      (config.simulated === undefined || typeof config.simulated === 'boolean'));
    const settings = available ? {base: config.base, session: config.session, simulated: config.simulated === true} : null;
    const now = options.now || (() => Date.now());
    const fetcher = options.fetch || (global.fetch && global.fetch.bind(global));
    const Events = options.EventSource || global.EventSource;
    const initialMessage = available ? 'Connect Muse, then keep your eyes open for a personal EEG reference.' :
      'A Muse S cannot connect to this page. Use the labeled synthetic preview.';
    let sensorMode = SENSOR_MODES.includes(options.sensorMode) ? options.sensorMode : 'eeg';
    const emptyAux = () => ({
      fnirs: {valid: false, phase: 'waiting', od: null, drift: null, channels: [], progress: 0, baseline: null, score: null, drive: 0, reason: 'Waiting for >=2 eligible forehead optical channels (64 Hz).', receivedAt: null},
      prv: {valid: false, phase: 'waiting', rmssd: null, sdnn: null, hr: null, progress: 0, baseline: null, score: null, drive: 0, reason: 'Waiting for 32 s forehead optical pulse window.', receivedAt: null},
      stillness: {valid: false, phase: 'waiting', motionG: null, score: null, drive: 0, reason: 'Waiting for 3-axis forehead IMU accelerometer.', receivedAt: null},
      fusion: {valid: false, phase: 'waiting', activeChannels: [], score: null, drive: 0, reason: 'Waiting for eligible Muse S / Athena sensors.'},
    });
    let aux = emptyAux();
    let fnirsSourceKey = null, fnirsSamples = [], fnirsLastSample = null, fnirsLastStamp = null;
    let prvSourceKey = null, prvSamples = [], prvLastSample = null, prvLastStamp = null;
    let stillnessLastStamp = null;
    const real = {available, phase: 'disconnected', message: initialMessage, transport: false,
      devices: [], deviceName: '', simulated: !!settings?.simulated, ratio: null,
      quality: {valid: false, reason: initialMessage}, baseline: null, progress: 0, score: null};
    const state = {...real, drive: 0, sensorMode, activeDrive: 0, activeScore: null, activeLabel: SENSOR_LABELS[sensorMode], sensors: {}}; // Stable public object; consumers read, not replace it.
    let active = false, stream = null, timer = null, generation = 0, action = 0;
    let offsetUpper = null, syncAt = null, lastSync = null, syncing = false, sequence = -1, lastContact = null;
    let sourceKey = null, samples = [], lastSampleStamp = null, lastFeatureStamp = null, featureAt = null;
    let demoOn = false, demoTime = 0, output = 0;
    const reads = new Set();

    function computeFusion(eegScore, eegValid) {
      const weights = [
        ['eeg', 0.40, eegValid && Number.isFinite(eegScore) ? eegScore : null],
        ['fnirs', 0.30, aux.fnirs.valid && Number.isFinite(aux.fnirs.score) ? aux.fnirs.score : null],
        ['prv', 0.15, aux.prv.valid && Number.isFinite(aux.prv.score) ? aux.prv.score : null],
        ['stillness', 0.15, aux.stillness.valid && Number.isFinite(aux.stillness.score) ? aux.stillness.score : null],
      ];
      let wSum = 0, valSum = 0;
      const activeList = [];
      for (const [k, w, v] of weights) {
        if (v !== null) { wSum += w; valSum += w * v; activeList.push(k); }
      }
      aux.fusion.activeChannels = activeList;
      if (wSum > 0) {
        aux.fusion.valid = true;
        aux.fusion.phase = 'ready';
        aux.fusion.score = clamp(valSum / wSum, 0, 1);
        aux.fusion.reason = `Blending ${activeList.join(' + ')} relative to personal reference.`;
      } else {
        aux.fusion.valid = false;
        aux.fusion.phase = 'waiting';
        aux.fusion.score = null;
        aux.fusion.reason = 'Waiting for at least one calibrated Muse S / Athena sensor.';
      }
    }

    function publish() {
      if (!demoOn) {
        computeFusion(real.score, !!(real.quality.valid && real.baseline && real.phase === 'ready'));
        const eegEntry = {valid: !!(real.quality.valid && real.baseline && real.phase === 'ready'), phase: real.phase, ratio: real.ratio, progress: real.progress, baseline: real.baseline, score: real.score, drive: output, reason: real.quality.reason};
        const sensors = {eeg: eegEntry, fnirs: {...aux.fnirs}, prv: {...aux.prv}, stillness: {...aux.stillness}, fusion: {...aux.fusion}};
        const chosen = sensors[sensorMode] || eegEntry;
        Object.assign(state, real, {drive: output, sensorMode, activeDrive: chosen.drive ?? output, activeScore: chosen.score ?? real.score, activeLabel: SENSOR_LABELS[sensorMode], sensors});
      } else {
        const fnirsScore = aux.fnirs.score ?? state.score;
        const prvScore = aux.prv.score ?? state.score;
        const stillScore = aux.stillness.score ?? 0.88;
        const fusionScore = clamp(0.40 * (state.score ?? 0.6) + 0.30 * fnirsScore + 0.15 * prvScore + 0.15 * stillScore, 0, 1);
        const sensors = {
          eeg: {valid: true, phase: 'ready', ratio: Math.exp((0.5 - state.score) * 0.9), progress: 1, baseline: null, score: state.score, drive: output, reason: 'Synthetic EEG demonstration.'},
          fnirs: {...aux.fnirs, valid: true, phase: 'ready', progress: 1, score: fnirsScore, reason: 'Synthetic fNIRS optical attenuation preview.'},
          prv: {...aux.prv, valid: true, phase: 'ready', progress: 1, score: prvScore, reason: 'Synthetic forehead optical PRV preview.'},
          stillness: {...aux.stillness, valid: true, phase: 'ready', score: stillScore, reason: 'Synthetic 3-axis IMU head stillness preview.'},
          fusion: {...aux.fusion, valid: true, phase: 'ready', activeChannels: ['eeg', 'fnirs', 'prv', 'stillness'], score: fusionScore, reason: 'Synthetic 4-sensor Athena fusion preview.'},
        };
        const chosen = sensors[sensorMode] || sensors.eeg;
        Object.assign(state, real, {phase: 'ready', message: 'Demo EEG · synthetic brainwave ride; no headset measurement.',
          simulated: true, ratio: Math.exp((0.5 - state.score) * 0.9),
          quality: {valid: true, reason: 'Synthetic EEG demonstration.', source_kind: 'synthetic'},
          baseline: null, progress: 1, score: state.score, drive: output,
          sensorMode, activeDrive: chosen.drive ?? output, activeScore: chosen.score ?? state.score, activeLabel: SENSOR_LABELS[sensorMode], sensors});
      }
    }
    function invalidate(reason, phase = 'waiting') {
      real.phase = phase; real.message = reason; real.ratio = null; real.score = null;
      real.quality = {...real.quality, valid: false, reason}; featureAt = null;
      publish();
    }
    function resetAuxReferences() {
      fnirsSamples = []; fnirsLastSample = null; aux.fnirs.baseline = null; aux.fnirs.progress = 0; aux.fnirs.score = null; aux.fnirs.valid = false;
      prvSamples = []; prvLastSample = null; aux.prv.baseline = null; aux.prv.progress = 0; aux.prv.score = null; aux.prv.valid = false;
      aux.stillness.score = null; aux.stillness.valid = false;
    }
    function resetReference(reason) {
      samples = []; lastSampleStamp = null; real.baseline = null; real.progress = 0; real.score = null;
      if (reason) { real.message = reason; real.phase = 'calibrating'; }
    }
    function resetInput(reason) {
      resetReference(); resetAuxReferences();
      sourceKey = null; lastFeatureStamp = null;
      fnirsSourceKey = null; fnirsLastStamp = null;
      prvSourceKey = null; prvLastStamp = null; stillnessLastStamp = null;
      aux = emptyAux();
      invalidate(reason, 'disconnected');
    }
    function stopTransport() {
      active = false; generation++; action++;
      if (stream) { stream.onmessage = stream.onerror = null; stream.close(); stream = null; }
      if (timer !== null) global.clearInterval(timer);
      timer = null; reads.forEach(controller => controller.abort()); reads.clear();
      real.transport = false; offsetUpper = syncAt = lastSync = lastContact = null; syncing = false; sequence = -1;
    }
    function failSession() {
      stopTransport(); resetInput('The Mac bridge session changed. Open its new cockpit link.');
      real.phase = 'error'; publish();
    }
    async function request(path, init = {}, isRead = false) {
      const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
      if (isRead && controller) reads.add(controller);
      const timeout = controller ? global.setTimeout(() => controller.abort(), 10000) : null;
      try {
        const response = await fetcher(settings.base + path, {cache: 'no-store', credentials: 'same-origin',
          redirect: 'error', ...init, ...(controller ? {signal: controller.signal} : {})});
        if (!response.ok) throw Error('The Mac EEG bridge could not complete that request.');
        return response;
      } finally {
        if (timeout !== null) global.clearTimeout(timeout);
        if (controller) reads.delete(controller);
      }
    }
    function devices(payload) {
      if (!payload || typeof payload !== 'object') return;
      if (Array.isArray(payload.devices)) real.devices = payload.devices.filter(d => d && d.kind === 'muse' &&
        typeof d.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(d.id)).slice(0, 50)
        .map(d => ({id: d.id, name: text(d.name, 'Muse')}));
      if (payload.error) invalidate(text(payload.error, 'Bluetooth scan failed.'), 'error');
      else if (payload.scanning && !real.quality.valid) { real.phase = 'waiting'; real.message = 'Looking for nearby Muse headbands…'; }
      publish();
    }
    function status(payload) {
      if (!payload || payload.device !== 'muse') return;
      if (typeof payload.deviceName === 'string' && payload.deviceName !== real.deviceName) {
        if (real.deviceName) resetInput('Muse changed. A new eyes-open EEG reference is needed.');
        real.deviceName = text(payload.deviceName, 'Muse');
      }
      const phase = payload.phase || payload.state;
      if (phase === 'disconnected' || phase === 'idle') resetInput(text(payload.message, 'Muse disconnected.'));
      else if (phase === 'error') { resetInput(text(payload.message, 'Muse could not connect.')); real.phase = 'error'; }
      else if (phase === 'stale') invalidate(text(payload.message, 'Waiting for fresh Muse EEG.'), 'stale');
      else if (['connecting', 'waiting', 'streaming'].includes(phase) && !real.quality.valid) {
        real.phase = 'waiting'; real.message = text(payload.message, 'Waiting for eligible Muse EEG.');
      }
      publish();
    }
    function snapshot(payload) {
      if (!payload || payload.session !== settings.session || payload.simulated !== settings.simulated) { failSession(); return false; }
      for (const device of Object.values(payload.devices || {})) status(device);
      devices(payload.discovery);
      return true;
    }
    async function synchronize(g) {
      if (syncing) return false;
      syncing = true; const begin = now(); lastSync = begin;
      try {
        const response = await request('api/state', {}, true), payload = await response.json();
        if (!active || generation !== g) return false;
        if (!Number.isFinite(payload.server_now) || !snapshot(payload)) {
          if (active) failSession(); return false;
        }
        // Request START overestimates age by outbound transit; response arrival
        // would make delayed data look fresher. Mac/browser clock skew cancels.
        offsetUpper = payload.server_now - begin; syncAt = now();
        return true;
      } finally { if (generation === g) syncing = false; }
    }
    function age(stamp) { return Number.isFinite(stamp) && offsetUpper !== null ? now() + offsetUpper - stamp : Infinity; }
    function fresh(stamp) { const value = age(stamp); return value >= -100 && value <= FRESH_MS; }
    function clockReady() { return syncAt !== null && now() >= syncAt && now() - syncAt <= 60000; }

    function consumeAuxFeatures(payload) {
      if (!clockReady() || !fresh(payload.received_at)) return;
      const kind = settings.simulated ? 'synthetic' : 'device-reported';
      if (payload.source !== kind) return;

      // 1. fNIRS / slow optical attenuation (<0.18 Hz) across >=2 optical channels
      const qf = payload.quality?.optical_od;
      if (qf && fresh(qf.received_at) && qf.received_at <= payload.received_at + 100 && qf.valid === true && qf.source_kind === kind &&
          Number.isFinite(payload.optical_od) && payload.optical_od > 0 && payload.optical_od < 16) {
        const src = typeof qf.source === 'string' ? /^muse:(classic|athena):fnirs:([0-9]+(?:,[0-9]+)+)$/.exec(qf.source) : null;
        const ch = Array.isArray(qf.channels) ? qf.channels : [];
        if (src && ch.length >= 2 && qf.sample_rate_hz === 64) {
          const fKey = src[1] + ':' + [...ch].sort((a, b) => a - b).join(',') + ':' + kind;
          if (fnirsSourceKey !== null && fKey !== fnirsSourceKey) {
            fnirsSamples = []; fnirsLastSample = null; aux.fnirs.baseline = null; aux.fnirs.progress = 0; aux.fnirs.score = null;
            fnirsLastStamp = null;
          }
          if (fnirsLastStamp === null || qf.received_at > fnirsLastStamp) {
            fnirsSourceKey = fKey; fnirsLastStamp = qf.received_at;
            aux.fnirs.receivedAt = now() - Math.max(0, age(qf.received_at));
            aux.fnirs.od = payload.optical_od;
            aux.fnirs.drift = Number.isFinite(payload.optical_drift) ? payload.optical_drift : 0;
            aux.fnirs.channels = [...ch];
            aux.fnirs.reason = text(qf.reason, 'Slow optical density gates passed.');
            if (!aux.fnirs.baseline && !demoOn && (fnirsLastSample === null || qf.received_at - fnirsLastSample >= SAMPLE_SPACING_MS)) {
              fnirsSamples.push(payload.optical_od); fnirsLastSample = qf.received_at;
              aux.fnirs.progress = Math.min(1, fnirsSamples.length / FNIRS_REF_SAMPLES);
              if (fnirsSamples.length >= FNIRS_REF_SAMPLES) {
                const center = median(fnirsSamples), spread = Math.max(0.008, 1.4826 * median(fnirsSamples.map(v => Math.abs(v - center))));
                aux.fnirs.baseline = {center, spread, samples: fnirsSamples.length, source: fKey};
              }
            }
            if (aux.fnirs.baseline) {
              aux.fnirs.score = clamp(0.5 + (payload.optical_od - aux.fnirs.baseline.center) / (6 * aux.fnirs.baseline.spread), 0, 1);
              aux.fnirs.valid = true; aux.fnirs.phase = 'ready';
            } else {
              aux.fnirs.score = null; aux.fnirs.valid = false; aux.fnirs.phase = 'calibrating';
            }
          }
        }
      } else if (qf && !qf.valid) {
        aux.fnirs.valid = false; aux.fnirs.score = null; aux.fnirs.phase = 'waiting';
        aux.fnirs.reason = text(qf.reason, 'Waiting for >=2 eligible forehead optical channels.');
      }

      // 2. Forehead optical pulse variability (PRV RMSSD & HR)
      const qp = payload.quality?.pulse_rmssd_ms;
      if (qp && fresh(qp.received_at) && qp.received_at <= payload.received_at + 100 && qp.valid === true && qp.source_kind === kind &&
          Number.isFinite(payload.pulse_rmssd_ms) && payload.pulse_rmssd_ms > 0 && payload.pulse_rmssd_ms <= 250) {
        const pKey = text(qp.source, 'muse:optical') + ':' + kind;
        if (prvSourceKey !== null && pKey !== prvSourceKey) {
          prvSamples = []; prvLastSample = null; aux.prv.baseline = null; aux.prv.progress = 0; aux.prv.score = null;
          prvLastStamp = null;
        }
        if (prvLastStamp === null || qp.received_at > prvLastStamp) {
          prvSourceKey = pKey; prvLastStamp = qp.received_at;
          aux.prv.receivedAt = now() - Math.max(0, age(qp.received_at));
          aux.prv.rmssd = payload.pulse_rmssd_ms;
          aux.prv.sdnn = Number.isFinite(payload.pulse_sdnn_ms) ? payload.pulse_sdnn_ms : null;
          aux.prv.hr = Number.isFinite(payload.heart_rate_bpm) ? payload.heart_rate_bpm : (Number.isFinite(qp.pulse_rate_bpm) ? qp.pulse_rate_bpm : null);
          aux.prv.reason = text(qp.reason, 'Forehead optical pulse gates passed.');
          const logRmssd = Math.log(Math.max(1, payload.pulse_rmssd_ms));
          if (!aux.prv.baseline && !demoOn && (prvLastSample === null || qp.received_at - prvLastSample >= SAMPLE_SPACING_MS)) {
            prvSamples.push(logRmssd); prvLastSample = qp.received_at;
            aux.prv.progress = Math.min(1, prvSamples.length / PRV_REF_SAMPLES);
            if (prvSamples.length >= PRV_REF_SAMPLES) {
              const center = median(prvSamples), spread = Math.max(0.08, 1.4826 * median(prvSamples.map(v => Math.abs(v - center))));
              aux.prv.baseline = {center, spread, rmssd: Math.exp(center), samples: prvSamples.length, source: pKey};
            }
          }
          if (aux.prv.baseline) {
            aux.prv.score = clamp(0.5 + (logRmssd - aux.prv.baseline.center) / (6 * aux.prv.baseline.spread), 0, 1);
            aux.prv.valid = true; aux.prv.phase = 'ready';
          } else {
            aux.prv.score = null; aux.prv.valid = false; aux.prv.phase = 'calibrating';
          }
        }
      } else if (qp && !qp.valid) {
        aux.prv.valid = false; aux.prv.score = null; aux.prv.phase = 'waiting';
        aux.prv.reason = text(qp.reason, 'Waiting for 32 s forehead optical pulse window.');
      }

      // 3. Forehead 3-axis IMU accelerometer head stillness
      const qm = payload.quality?.motion;
      if (qm && fresh(qm.received_at) && qm.received_at <= payload.received_at + 100 && qm.source_kind === kind && Number.isFinite(payload.motion) && payload.motion >= 0) {
        if (stillnessLastStamp === null || qm.received_at > stillnessLastStamp) {
          stillnessLastStamp = qm.received_at;
          aux.stillness.receivedAt = now() - Math.max(0, age(qm.received_at));
          aux.stillness.motionG = payload.motion;
          aux.stillness.reason = text(qm.reason, 'Head accelerometer stillness gate.');
          if (qm.valid === true) {
            aux.stillness.valid = true; aux.stillness.phase = 'ready';
            aux.stillness.score = clamp(1 - (payload.motion - 0.002) / 0.038, 0, 1);
          } else {
            aux.stillness.valid = false; aux.stillness.phase = 'waiting'; aux.stillness.score = 0;
          }
        }
      }
    }

    function features(payload) {
      if (!payload || payload.type !== 'features') return;
      consumeAuxFeatures(payload);
      const q = payload.quality?.eeg_beta_alpha;
      const reason = text(q?.reason, 'Waiting for eligible EEG from at least two channels.');
      if (!clockReady() || !fresh(payload.received_at) || !q || !fresh(q.received_at) || q.received_at > payload.received_at + 100) {
        invalidate('EEG is stale or its timestamp cannot be verified. ' + reason, 'stale'); return;
      }
      const channels = q.channels, kind = settings.simulated ? 'synthetic' : 'device-reported';
      const source = typeof q.source === 'string' ? /^muse:(classic|athena):eeg:([0-3](?:,[0-3]){1,3})$/.exec(q.source) : null;
      const validChannels = Array.isArray(channels) && channels.length >= 2 && channels.length <= 4 &&
        channels.every(c => Number.isInteger(c) && c >= 0 && c <= 3) && new Set(channels).size === channels.length;
      const sorted = validChannels ? [...channels].sort().join(',') : '';
      if (q.valid !== true) { invalidate(reason); return; }
      if (payload.source !== kind || q.source_kind !== kind) {
        invalidate('EEG source labeling does not match this bridge session.', 'error'); return;
      }
      if (!validChannels || !source || [...source[2].split(',')].sort().join(',') !== sorted ||
          q.sample_rate_hz !== 256 || q.window_seconds !== 4 || !Number.isFinite(payload.eeg_beta_alpha) ||
          payload.eeg_beta_alpha < 0 || payload.eeg_beta_alpha > 50) {
        invalidate('The EEG channel metadata or ratio is not eligible. ' + reason); return;
      }
      const key = source[1] + ':' + sorted + ':' + kind;
      let changed = false;
      if (sourceKey !== null && key !== sourceKey) {
        resetReference('EEG channels or protocol changed. Keep your eyes open for a new reference.');
        lastFeatureStamp = null; changed = true;
      }
      // New event envelopes cannot rejuvenate an old supporting EEG window.
      if (lastFeatureStamp !== null && q.received_at <= lastFeatureStamp) return;
      sourceKey = key; lastFeatureStamp = q.received_at;
      featureAt = now() - Math.max(0, age(q.received_at));
      real.ratio = payload.eeg_beta_alpha;
      real.quality = {...q, channels: [...channels], received_at: featureAt, origin_received_at: q.received_at};
      // A small positive floor makes a valid zero-beta window finite. The
      // logarithm and fixed robust scale are declared game-design choices.
      const value = Math.log(Math.max(0.000001, real.ratio));
      if (!real.baseline && !demoOn && (lastSampleStamp === null || q.received_at - lastSampleStamp >= SAMPLE_SPACING_MS)) {
        samples.push(value); lastSampleStamp = q.received_at;
        real.progress = Math.min(1, samples.length / REFERENCE_SAMPLES);
        if (samples.length >= REFERENCE_SAMPLES) {
          const center = median(samples), spread = Math.max(0.15, 1.4826 * median(samples.map(v => Math.abs(v - center))));
          real.baseline = {center, spread, ratio: Math.exp(center), samples: samples.length, source: key};
        }
      }
      if (real.baseline) {
        real.score = clamp(0.5 + (real.baseline.center - value) / (6 * real.baseline.spread), 0, 1);
        real.phase = 'ready'; real.message = settings.simulated ? 'Synthetic bridge EEG · experimental game mapping.' :
          'Live EEG · experimental game mapping relative to your eyes-open reference.';
      } else {
        real.score = null; real.phase = 'calibrating';
        real.message = changed ? 'EEG channels or protocol changed. A new eyes-open reference has started.' :
          `Keep your eyes open and sit still · ${samples.length} of ${REFERENCE_SAMPLES} eligible EEG samples.`;
      }
      publish();
    }
    async function control(command, id) {
      if (!active || !settings) return false;
      const g = generation, a = ++action;
      try {
        await request('api/control', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({action: command, ...(command === 'scan' ? {} : {device: 'muse'}), ...(id ? {id} : {})})});
        return active && generation === g && action === a;
      } catch (error) {
        if (active && generation === g && action === a) invalidate(text(error.message, 'The Mac EEG bridge could not be reached.'), 'error');
        return false;
      }
    }
    function expire() {
      if (!active) return;
      if (lastContact !== null && now() - lastContact > 4500) {
        real.transport = false;
        aux.fnirs.valid = false; aux.fnirs.score = null; aux.fnirs.phase = 'stale';
        aux.prv.valid = false; aux.prv.score = null; aux.prv.phase = 'stale';
        aux.stillness.valid = false; aux.stillness.score = null; aux.stillness.phase = 'stale';
        if (real.phase !== 'error') invalidate('The Mac EEG connection paused. Waiting for fresh data.', 'stale');
      } else {
        if (real.quality.valid && (featureAt === null || now() < featureAt - 100 || now() - featureAt > FRESH_MS || !clockReady())) {
          invalidate('EEG is stale. Waiting for a fresh eligible window.', 'stale');
        }
        if (aux.fnirs.valid && (aux.fnirs.receivedAt === null || now() - aux.fnirs.receivedAt > FRESH_MS || !clockReady())) {
          aux.fnirs.valid = false; aux.fnirs.score = null; aux.fnirs.phase = 'stale';
        }
        if (aux.prv.valid && (aux.prv.receivedAt === null || now() - aux.prv.receivedAt > FRESH_MS || !clockReady())) {
          aux.prv.valid = false; aux.prv.score = null; aux.prv.phase = 'stale';
        }
        if (aux.stillness.valid && (aux.stillness.receivedAt === null || now() - aux.stillness.receivedAt > FRESH_MS || !clockReady())) {
          aux.stillness.valid = false; aux.stillness.score = null; aux.stillness.phase = 'stale';
        }
      }
    }
    function maintain() {
      expire();
      if (active && !syncing && (lastSync === null || now() - lastSync >= 30000)) {
        const g = generation;
        synchronize(g).catch(() => { if (active && generation === g) invalidate('The Mac EEG bridge could not be reached.', 'stale'); });
      }
    }
    async function start() {
      if (!available) { invalidate(initialMessage, 'disconnected'); return false; }
      if (!fetcher || !Events) { invalidate('This browser cannot open the local EEG event stream.', 'error'); return false; }
      if (active) return stream ? scan() : false;
      stopTransport(); active = true; const g = generation;
      invalidate('Connecting to the Mac EEG bridge…');
      try {
        if (!await synchronize(g) || !active || generation !== g) return false;
        lastContact = now();
        stream = new Events(settings.base + 'api/events');
        stream.onmessage = event => {
          if (!active || generation !== g) return;
          let message; try { message = JSON.parse(event.data); } catch (_) { return; }
          if (!message || typeof message !== 'object') return;
          if (message.session !== settings.session) { if (message.kind === 'hello') failSession(); return; }
          if (!clockReady() || !fresh(message.server_sent_at)) return;
          if (message.kind === 'hello') {
            if (!snapshot(message.payload)) return;
            if (Number.isSafeInteger(message.sequence)) sequence = Math.max(sequence, message.sequence);
          } else if (message.kind !== 'heartbeat') {
            if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence) return;
            sequence = message.sequence;
          }
          lastContact = now(); real.transport = true;
          if (message.kind === 'features') features(message.payload);
          else if (message.kind === 'status') status(message.payload);
          else if (message.kind === 'devices') devices(message.payload);
          publish();
        };
        stream.onerror = () => {
          if (!active || generation !== g) return;
          real.transport = false; invalidate('The Mac EEG connection paused. Waiting to reconnect.', 'stale');
        };
        timer = global.setInterval(maintain, 1000);
        return await scan();
      } catch (error) {
        if (active && generation === g) { stopTransport(); invalidate(text(error.message, 'Could not connect to the Mac EEG bridge.'), 'error'); }
        return false;
      }
    }
    async function scan() { return control('scan'); }
    async function pair(id) {
      const device = real.devices.find(d => d.id === id);
      if (!active || !device) return false;
      resetInput('Connecting Muse. A new eyes-open EEG reference will start when its signal is eligible.');
      real.deviceName = device.name; real.phase = 'waiting'; publish();
      return control('connect', id);
    }
    async function disconnect() {
      const wasActive = active;
      // Issue the explicit device stop before closing the local stream. Control
      // requests have their own timeout and remain deliverable during cleanup.
      const pending = wasActive ? request('api/control', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'disconnect', device: 'muse'})}).then(() => true, () => false) : Promise.resolve(true);
      stopTransport(); resetInput('Muse disconnected.'); real.deviceName = ''; publish();
      const g = generation, stopped = await pending;
      if (!stopped && !active && generation === g) {
        real.message = 'Cockpit disconnected. Could not confirm the Muse stop; disconnect it in the Mac bridge.';
        real.quality = {...real.quality, reason: real.message}; publish();
      }
      return stopped;
    }
    function calibrate() {
      if (demoOn || !active) return false;
      resetReference('Keep your eyes open and sit still for 20 eligible EEG samples.');
      resetAuxReferences();
      lastSampleStamp = lastFeatureStamp; // Reusing the current frame cannot advance the new reference.
      fnirsLastSample = fnirsLastStamp;
      prvLastSample = prvLastStamp;
      publish(); return true;
    }
    function setSensorMode(mode) {
      if (!SENSOR_MODES.includes(mode)) return false;
      sensorMode = mode;
      publish();
      return true;
    }
    function activeDrive(mode = sensorMode) {
      const m = SENSOR_MODES.includes(mode) ? mode : sensorMode;
      if (m === 'eeg') return output;
      return state.sensors?.[m]?.drive ?? output;
    }
    function smoothStep(cur, tgt, seconds, tauUp = 2, tauDown = 1.5) {
      const tau = tgt > cur ? tauUp : tauDown;
      let next = cur + (tgt - cur) * (1 - Math.exp(-seconds / tau));
      if (tgt === 0 && next < 0.0001) next = 0;
      return next;
    }
    function tick(dt, demo = false) {
      const seconds = Number.isFinite(dt) ? clamp(dt, 0, 5) : 0;
      if (!!demo !== demoOn) {
        demoOn = !!demo; demoTime = 0;
        if (!demoOn) {
          aux.fnirs.score = aux.fnirs.valid && aux.fnirs.baseline ? aux.fnirs.score : null;
          aux.prv.score = aux.prv.valid && aux.prv.baseline ? aux.prv.score : null;
          aux.stillness.score = aux.stillness.valid ? aux.stillness.score : null;
        }
      }
      expire();
      let target = real.quality.valid && real.baseline && real.phase === 'ready' ? real.score : 0;
      let fnirsTarget = aux.fnirs.valid && aux.fnirs.baseline && Number.isFinite(aux.fnirs.score) ? aux.fnirs.score : 0;
      let prvTarget = aux.prv.valid && aux.prv.baseline && Number.isFinite(aux.prv.score) ? aux.prv.score : 0;
      let stillTarget = aux.stillness.valid && Number.isFinite(aux.stillness.score) ? aux.stillness.score : 0;
      if (demoOn) {
        demoTime += seconds;
        state.score = target = clamp(0.58 + 0.22 * Math.sin(demoTime / 8) + 0.07 * Math.sin(demoTime / 2.7), 0, 1);
        fnirsTarget = clamp(0.62 + 0.25 * Math.sin(demoTime / 14 - 0.6) + 0.05 * Math.cos(demoTime / 4.5), 0, 1);
        prvTarget = clamp(0.60 + 0.20 * Math.sin(demoTime / 10.5 + 0.8) + 0.06 * Math.sin(demoTime / 3.2), 0, 1);
        stillTarget = clamp(0.84 + 0.12 * Math.cos(demoTime / 9.2), 0, 1);
        aux.fnirs.score = fnirsTarget; aux.fnirs.od = 2.35 + (fnirsTarget - 0.5) * 0.08; aux.fnirs.drift = 0.004 * Math.cos(demoTime / 14 - 0.6); aux.fnirs.channels = [0, 1, 2, 3];
        aux.prv.score = prvTarget; aux.prv.rmssd = Math.round(42 + prvTarget * 28); aux.prv.hr = Math.round(68 - (prvTarget - 0.5) * 10);
        aux.stillness.score = stillTarget; aux.stillness.motionG = +(0.004 + (1 - stillTarget) * 0.025).toFixed(4);
      }
      output = smoothStep(output, target, seconds, 2, 1.5);
      aux.fnirs.drive = smoothStep(aux.fnirs.drive, fnirsTarget, seconds, 2.6, 1.8);
      aux.prv.drive = smoothStep(aux.prv.drive, prvTarget, seconds, 2.2, 1.6);
      aux.stillness.drive = smoothStep(aux.stillness.drive, stillTarget, seconds, 1.4, 1.2);
      computeFusion(demoOn ? target : real.score, demoOn ? true : !!(real.quality.valid && real.baseline && real.phase === 'ready'));
      const fusionTarget = aux.fusion.valid && Number.isFinite(aux.fusion.score) ? aux.fusion.score : 0;
      aux.fusion.drive = smoothStep(aux.fusion.drive, fusionTarget, seconds, 2.0, 1.5);
      publish(); return output;
    }
    return {state, start, scan, pair, disconnect, calibrate, tick, setSensorMode, activeDrive, SENSOR_MODES, SENSOR_LABELS};
  }
  global.createEEGDrive = createEEGDrive;
})(typeof window === 'undefined' ? globalThis : window);
