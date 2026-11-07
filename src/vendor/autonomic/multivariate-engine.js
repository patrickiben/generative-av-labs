/* Live reference-relative multivariate heuristic, not a clinical model.
 * Restores the original composite architecture with causal prediction errors,
 * actual supplied pulse SDNN, fixed coverage, and quality holds. Motion gates
 * observations; unlike the original prototype it is not a covariance channel.
 * Pulse HR/RMSSD/SDNN can share an optical source and are not independent votes
 * proving a mental state. No storage, discovery, network, or timers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    if (!root.TelemetryResearch) require("./research-math.js");
    module.exports = factory(root.TelemetryResearch);
  } else root.TelemetryMultivariate = factory(root.TelemetryResearch);
})(typeof globalThis !== "undefined" ? globalThis : this, function (R) {
  "use strict";
  const MODEL_VERSION = "multivariate-1";
  const SPEC = {
    heart_rate_bpm: { label: "Heart rate", unit: "bpm", weight: 20, sign: 1, floor: 3, range: [25, 240] },
    pulse_rmssd_ms: { label: "Pulse RMSSD · PRV", unit: "ms", weight: 30, sign: -1, floor: 5, range: [0, 500] },
    resp_rate_brpm: { label: "Respiratory rate", unit: "breaths/min", weight: 15, sign: 1, floor: 1, range: [3, 60] },
    eeg_beta_alpha: { label: "EEG beta / alpha", unit: "ratio", weight: 10, sign: 1, floor: .15, range: [.000001, 1000] },
    pulse_sdnn_ms: { label: "Pulse SDNN · PRV", unit: "ms", weight: 10, sign: -1, floor: 5, range: [0, 500] },
  };
  const KEYS = Object.keys(SPEC), NOMINAL = { ...Object.fromEntries(KEYS.map(k => [k, SPEC[k].weight])), turbulence: 15 };
  const finite = x => typeof x === "number" && Number.isFinite(x);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const variance = a => a.length < 2 ? 0 : a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1);
  const median = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length ? b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 : null; };
  const copy = x => JSON.parse(JSON.stringify(x));
  const unavailable = reason => ({ available: false, value: null, reason });
  const fresh = (at, stamp) => finite(at) && finite(stamp) && at <= stamp + 100 && stamp - at <= 5000;
  const motionGood = (frame, stamp) => {
    const q = frame.quality?.motion;
    if (frame.motion == null) return !q || (q.received_at == null && q.valid !== true);
    return finite(frame.motion) && frame.motion >= 0 && frame.motion <= .12 &&
      (!q || (q.valid === true && fresh(q.received_at, stamp)));
  };
  const valid = (frame, key, stamp) => {
    const q = frame?.quality?.[key], v = frame?.[key], s = SPEC[key];
    return finite(v) && v >= s.range[0] && v <= s.range[1] && q?.valid === true &&
      typeof q.source === "string" && Boolean(q.source.trim()) && q.source.length <= 200 && fresh(q.received_at, stamp);
  };
  function weights(keys, frozen = false) {
    const active = [...keys, ...(keys.length >= 2 ? ["turbulence"] : [])];
    const coveredNominal = active.reduce((s, k) => s + NOMINAL[k], 0);
    return { nominal: { ...NOMINAL }, effective: Object.fromEntries(Object.keys(NOMINAL).map(k => [k, active.includes(k) ? 100 * NOMINAL[k] / coveredNominal : 0])), coveredNominal, totalNominal: 100, frozen };
  }
  function emptyResearch(reason) {
    return { received_at: null, surprise: { ...unavailable(reason), series: [], byChannel: {}, threshold: null },
      turbulence: { ...unavailable(reason), distance: null }, coupling: unavailable(reason), entropy: unavailable(reason),
      autocorrelation: unavailable(reason), crosslags: [], manifold: unavailable(reason),
      fragility: { ...unavailable(reason), multiplier: 1 }, lead: { ...unavailable(reason), multiplier: 1 }, modifierMultiplier: 1 };
  }
  function basis(correlation) {
    if (!R?.eigenSymmetric) throw Error("Load research-math.js before the multivariate engine.");
    const e = R.eigenSymmetric(correlation.map((row, i) => row.map((v, j) => .8 * v + (i === j ? .2 : 0))));
    if (!e.available || e.values.some(x => !finite(x) || x <= 1e-12)) throw Error("Reference covariance is not positive definite after shrinkage.");
    return e;
  }
  function distance(row, reference) {
    const z = reference.profile.map(k => (row[k] - reference.stats[k].mean) / reference.stats[k].sd);
    const squared = reference.basis.values.reduce((s, eigenvalue, i) => s + reference.basis.vectors[i].reduce((v, x, j) => v + x * z[j], 0) ** 2 / eigenvalue, 0);
    return Math.sqrt(Math.max(0, squared));
  }
  function create(options = {}) {
    if (!R?.ar1Surprise) throw Error("Load research-math.js before the multivariate engine.");
    if (options.profile !== undefined && !["auto", "hr"].includes(options.profile)) throw Error("Profile must be auto or hr.");
    const now = typeof options.now === "function" ? options.now : Date.now;
    const synthetic = options.synthetic === true, explicitHR = options.profile === "hr";
    let reference, candidate, candidateKeys, observations, models, surpriseSeries, latest, latestAt,
      origins, events, activeEvent, lastOnset, history, raw, lastObservationAt, cached, lastResetReason;
    function reset(reason = "Reference cleared.") {
      reference = null; candidate = []; candidateKeys = []; observations = []; models = {}; surpriseSeries = [];
      latest = null; latestAt = null; origins = {}; events = []; activeEvent = null; lastOnset = -Infinity;
      history = []; raw = []; lastObservationAt = null; lastResetReason = reason;
      cached = { value: null, baseScore: null, rawScore: null, modifierMultiplier: 1, contributions: {}, research: emptyResearch("Waiting for eligible observations."), aboveSince: 0 };
    }
    reset();
    function interrupt(reason) {
      if (activeEvent) { activeEvent.censored = true; activeEvent.endReason = reason; activeEvent = null; }
      candidate = []; candidateKeys = []; observations = []; models = {}; surpriseSeries = []; raw = []; history = [];
      lastObservationAt = null; cached.aboveSince = 0;
      cached.research = emptyResearch(reason);
    }
    function installReference(profile, stats, correlation, meta = {}) {
      reference = { profile: profile.slice(), stats: copy(stats), correlation: copy(correlation), basis: basis(correlation),
        weights: weights(profile, true), surpriseThreshold: meta.surpriseThreshold ?? .5,
        start: meta.start ?? null, end: meta.end ?? null, count: meta.count ?? 0,
        synthetic, imported: Boolean(meta.imported) };
    }
    function freezeReference() {
      const c = R.covariance(candidate.map(row => candidateKeys.map(k => row[k]))), stats = {};
      candidateKeys.forEach((key, j) => { stats[key] = { mean: c.means[j], sd: Math.max(SPEC[key].floor, Math.sqrt(Math.max(0, c.matrix[j][j]))), floor: SPEC[key].floor, source: origins[key] }; });
      const correlation = c.matrix.map((row, i) => row.map((v, j) => i === j ? 1 : v / (stats[candidateKeys[i]].sd * stats[candidateKeys[j]].sd)));
      const errors = surpriseSeries.map(s => s.value).filter(finite), mu = errors.length ? mean(errors) : 0, sd = Math.sqrt(variance(errors));
      installReference(candidateKeys, stats, correlation, { start: candidate[0].timestamp, end: candidate.at(-1).timestamp,
        count: candidate.length, surpriseThreshold: Math.max(mu + 1.5 * sd, mu + .5) });
      candidate = [];
    }
    function forecast(key, x) {
      const model = models[key] ||= { history: [], ewma: null }, floor = (SPEC[key].floor * .1) ** 2;
      // The reused predictor fits strictly prior observations. Persisting its
      // residual variance separately avoids changing past errors as buffers trim.
      const result = R.ar1Surprise([...model.history, x], { window: 60, minSamples: 12, varianceFloor: floor }).latest;
      let out = null;
      if (result) {
        const usedVariance = Math.max(floor, model.ewma ?? result.variance), residual = x - result.prediction;
        out = { prediction: result.prediction, residual, standardizedResidual: residual / Math.sqrt(usedVariance),
          halfSquaredError: .5 * residual ** 2 / usedVariance, variance: usedVariance, phi: result.phi };
        model.ewma = .96 * usedVariance + .04 * residual ** 2;
      }
      model.history.push(x); if (model.history.length > 60) model.history.shift();
      return out;
    }
    function researchFor(row, profile, byChannel) {
      const recent = observations.filter(s => row.timestamp - s.timestamp <= 60000), matrixRows = observations.filter(s => row.timestamp - s.timestamp <= 120000);
      const out = emptyResearch("More consecutive eligible observations are needed.");
      out.received_at = row.timestamp;
      const errors = Object.values(byChannel).filter(Boolean);
      out.surprise = { available: Boolean(errors.length), value: errors.length ? mean(errors.map(x => x.halfSquaredError)) : null,
        byChannel, series: surpriseSeries.slice(), threshold: reference?.surpriseThreshold ?? null,
        definition: "Mean causal half-squared standardized AR(1) residual; not likelihood or a calibrated probability." };
      if (reference && profile.length >= 2) out.turbulence = { available: true, distance: distance(row, reference),
        shrinkage: .2, keys: profile.slice(), definition: "Floor-scaled physiological covariance distance; motion is a gate, not a channel." };
      if (recent.length >= 20) {
        const hr = recent.map(s => s.heart_rate_bpm), ac = R.pearson(hr.slice(0, -1), hr.slice(1));
        out.autocorrelation = ac === null ? unavailable("Heart rate is constant.") : { available: true, value: ac, definition: "Lag-one sample correlation, not a recovery forecast." };
        const entropyKey = profile.includes("pulse_rmssd_ms") ? "pulse_rmssd_ms" : "heart_rate_bpm";
        out.entropy = { ...R.sampleEntropy(recent.map(s => s[entropyKey])), key: entropyKey };
        if (entropyKey === "pulse_rmssd_ms" && out.autocorrelation.available && out.entropy.available) {
          const value = .6 * clamp((ac - .2) / .7, 0, 1) + .4 * clamp((1.6 - out.entropy.value) / 1.6, 0, 1);
          out.fragility = { available: true, value, multiplier: 1 + .05 * value,
            definition: "Original bounded HR-autocorrelation/RMSSD-entropy modifier; descriptive, not validated fragility." };
        }
      }
      if (profile.length >= 2 && matrixRows.length >= 20) {
        const pca = R.principalComponents(matrixRows.map(s => profile.map(k => s[k])));
        out.manifold = { ...pca, ...(pca.available ? { keys: pca.columns.map(j => profile[j]), timestamps: matrixRows.map(s => s.timestamp) } : {}) };
        if (pca.available && pca.columns.length >= 2) out.coupling = { available: true, absorptionRatio: pca.absorptionRatio,
          eigenvalues: pca.eigenvalues, keys: out.manifold.keys, n: matrixRows.length };
      }
      const pairs = [["resp_rate_brpm", "heart_rate_bpm"], ["heart_rate_bpm", "pulse_rmssd_ms"], ["eeg_beta_alpha", "heart_rate_bpm"]];
      for (const [from, to] of pairs) {
        let result = { from, to, ...unavailable("Both fixed-profile channels and 20 consecutive observations are needed.") };
        if (profile.includes(from) && profile.includes(to) && recent.length >= 20) {
          const dts = recent.slice(1).map((s, i) => s.timestamp - recent[i].timestamp), cadence = mean(dts);
          if (!dts.every(dt => Math.abs(dt - cadence) <= Math.max(1, cadence * .01))) result.reason = "Uniform feature cadence is required; irregular sample lags are not labeled seconds.";
          else {
            const lag = R.crossLag(recent.map(s => s[from]), recent.map(s => s[to]), { maxLag: 8, minPairs: 20 });
            result = { from, to, ...lag, ...(lag.available ? { lagSeconds: lag.lagSamples * cadence / 1000, cadenceMs: cadence } : {}) };
            if (from === "resp_rate_brpm" && lag.available) {
              // Original lead modifier used the largest positive correlation,
              // rather than the research lens's largest absolute correlation.
              const best = lag.candidates.filter(x => x.correlation > 0).sort((a, b) => b.correlation - a.correlation || Math.abs(a.lagSamples) - Math.abs(b.lagSamples))[0];
              const value = best?.lagSamples > 0 ? clamp(best.correlation, 0, 1) : 0;
              out.lead = { available: true, value, multiplier: 1 + .05 * value,
                lagSeconds: best ? best.lagSamples * cadence / 1000 : null,
                definition: "Positive breath-leading-HR association only; not proof of RSA or causation." };
            }
          }
        }
        out.crosslags.push(result);
      }
      out.modifierMultiplier = 1 + .05 * (out.fragility.available ? out.fragility.value : 0) + .05 * (out.lead.available ? out.lead.value : 0);
      return out;
    }
    function updateEvents(row, research) {
      if (!reference) return;
      const segment = observations.slice(-20), drivers = [];
      if (segment.length >= 20) for (const key of ["heart_rate_bpm", "pulse_rmssd_ms", "resp_rate_brpm"]) {
        if (!reference.profile.includes(key)) continue;
        const x = segment.map(s => s[key]), scale = Math.max(SPEC[key].floor, Math.sqrt(variance(x)));
        if (SPEC[key].sign * (mean(x.slice(-4)) - mean(x.slice(0, 16))) / scale > 1) drivers.push(key);
      }
      const high = research.surprise.available && research.surprise.value > reference.surpriseThreshold;
      if (activeEvent) {
        activeEvent.peak = Math.max(activeEvent.peak, research.surprise.value ?? 0);
        if (!high || drivers.length < 1) { activeEvent.recoveryMs = row.timestamp - activeEvent.timestamp; activeEvent.endTimestamp = row.timestamp;
          activeEvent.censored = false; activeEvent.endReason = "Observed onset transient subsided"; activeEvent = null; }
      } else if (high && drivers.length >= 2 && row.timestamp - lastOnset >= 20000) {
        activeEvent = { timestamp: row.timestamp, drivers, peak: research.surprise.value, recoveryMs: null, censored: true,
          endReason: "Ongoing observed episode", classification: "Observed convergence", source: synthetic ? "synthetic" : "device-reported",
          definition: "Prediction error plus at least two directional HR/RMSSD/respiratory step votes; related streams are not independent causal evidence." };
        events.push(activeEvent); if (events.length > 200) events.shift(); lastOnset = row.timestamp;
      }
    }
    function ingest(frame) {
      const stamp = now();
      if (!frame || !fresh(frame.received_at, stamp) || (latestAt !== null && frame.received_at <= latestAt) || frame.source !== (synthetic ? "synthetic" : "device-reported")) return false;
      const motionEligible = motionGood(frame, stamp), available = KEYS.filter(k => valid(frame, k, stamp));
      const tracked = reference ? reference.profile : explicitHR ? ["heart_rate_bpm"] : available;
      if (motionEligible && tracked.some(k => available.includes(k) && origins[k] && origins[k] !== frame.quality[k].source.trim())) reset("A physiological source changed; build a new reference.");
      latestAt = frame.received_at;
      latest = { received_at: latestAt, motionEligible, quality: {}, source: frame.source };
      for (const key of KEYS) {
        const q = frame.quality?.[key];
        latest[key] = finite(frame[key]) ? frame[key] : null;
        latest.quality[key] = { valid: valid(frame, key, stamp), received_at: finite(q?.received_at) ? q.received_at : null,
          source: typeof q?.source === "string" ? q.source.trim().slice(0, 200) : "", reason: typeof q?.reason === "string" ? q.reason.slice(0, 300) : "" };
      }
      if (!motionEligible || !available.includes("heart_rate_bpm")) { interrupt(!motionEligible ? "Movement is invalid or excessive; observation excluded." : "A fresh usable heart-rate input is required."); return true; }
      for (const key of available) if (!reference && !explicitHR || (reference?.profile || ["heart_rate_bpm"]).includes(key)) origins[key] = latest.quality[key].source;
      const profile = reference ? reference.profile : explicitHR ? ["heart_rate_bpm"] : available;
      if (reference && profile.some(k => !available.includes(k))) { interrupt("A fixed-reference channel is unavailable; coverage is held, not rescaled."); return true; }
      if (lastObservationAt !== null && latestAt - lastObservationAt > 5000) interrupt("Signal gap; rolling analysis restarted.");
      if (!reference && candidateKeys.join() !== profile.join()) { interrupt("Calibration channel set changed; contiguous reference restarted."); candidateKeys = profile.slice(); }
      if (lastObservationAt !== null && latestAt - lastObservationAt < 500) return true;
      const row = { timestamp: latestAt, ...Object.fromEntries(profile.map(k => [k, latest[k]])) };
      lastObservationAt = latestAt; observations.push(row);
      observations = observations.filter(s => latestAt - s.timestamp <= 180000).slice(-360);
      const byChannel = Object.fromEntries(profile.map(k => [k, forecast(k, row[k])])), errors = Object.values(byChannel).filter(Boolean);
      if (errors.length) surpriseSeries.push({ timestamp: latestAt, value: mean(errors.map(x => x.halfSquaredError)), channels: profile.slice() });
      surpriseSeries = surpriseSeries.filter(s => latestAt - s.timestamp <= 600000).slice(-1200);
      if (!reference) {
        candidate.push(row);
        if (candidate.length >= 60 && latestAt - candidate[0].timestamp >= 120000) freezeReference();
      }
      const research = researchFor(row, profile, byChannel);
      if (reference) {
        const effective = reference.weights.effective, contributions = {};
        for (const key of profile) { const z = SPEC[key].sign * (row[key] - reference.stats[key].mean) / reference.stats[key].sd;
          contributions[key] = effective[key] * clamp(z, 0, 4) / 4; }
        if (profile.length >= 2) contributions.turbulence = effective.turbulence * clamp((research.turbulence.distance - 2.5) / 6, 0, 1);
        const baseScore = Object.values(contributions).reduce((s, x) => s + x, 0), rawScore = clamp(baseScore * research.modifierMultiplier, 0, 100);
        raw = raw.filter(s => latestAt - s.timestamp <= 5000); raw.push({ timestamp: latestAt, value: rawScore });
        const value = median(raw.map(s => s.value)), priorAt = history.at(-1)?.timestamp;
        cached.aboveSince = value >= 68 ? priorAt && latestAt - priorAt <= 5000 && cached.aboveSince ? cached.aboveSince : latestAt : 0;
        history.push({ timestamp: latestAt, value, baseScore, rawScore });
        history = history.filter(s => latestAt - s.timestamp <= 600000).slice(-1200);
        cached = { ...cached, value, baseScore, rawScore, modifierMultiplier: research.modifierMultiplier, contributions, research };
        updateEvents(row, research);
      } else cached.research = research;
      return true;
    }
    function snapshot(stamp = now()) {
      const isFresh = latest && fresh(latest.received_at, stamp), profile = reference?.profile || candidateKeys;
      const eligible = isFresh && latest.motionEligible && profile.includes("heart_rate_bpm") && profile.every(k => valid(latest, k, stamp));
      let phase = !latest ? "waiting" : !isFresh ? "stale" : !eligible ? "held" : !reference ? "calibrating" : "ready";
      if (phase === "ready" && (!finite(cached.value) || lastObservationAt === null || !fresh(lastObservationAt, stamp))) phase = "held";
      const ready = phase === "ready", w = reference?.weights || weights(profile), seconds = reference ? 120 : candidate.length ? Math.max(0, (candidate.at(-1).timestamp - candidate[0].timestamp) / 1000) : 0;
      const resetNeeded = reference && !explicitHR && latest && latest.motionEligible ? KEYS.filter(k => !profile.includes(k) && valid(latest, k, stamp)) : [];
      const components = KEYS.map(key => {
        const s = SPEC[key], included = profile.includes(key), ok = Boolean(isFresh && latest.motionEligible && valid(latest, key, stamp)), ref = reference?.stats[key];
        return { key, label: s.label, unit: s.unit, included, value: ok ? latest[key] : null, reference: ref?.mean ?? null,
          delta: ok && ref ? latest[key] - ref.mean : null, z: ok && ref ? s.sign * (latest[key] - ref.mean) / ref.sd : null,
          nominalWeight: s.weight, effectiveWeight: w.effective[key], contribution: ready && included ? cached.contributions[key] : null,
          valid: ok, source: latest?.quality[key]?.source || ref?.source || "", reason: !included ? "Not in the fixed profile; a new reference is required to include it." : !ok ? latest?.quality[key]?.reason || "A fresh eligible fixed-reference input is required." : "" };
      });
      components.push({ key: "turbulence", label: "Multivariate turbulence", unit: "distance", included: profile.length >= 2,
        value: ready ? cached.research.turbulence.distance : null, reference: 0, delta: null, z: null,
        nominalWeight: 15, effectiveWeight: w.effective.turbulence, contribution: ready ? cached.contributions.turbulence ?? null : null,
        valid: ready && profile.length >= 2, source: "Derived from the fixed physiological profile", reason: profile.length < 2 ? "At least two physiological channels are required." : "" });
      const currentHistory = ready ? history.filter(s => stamp - s.timestamp <= 600000) : [], tail = currentHistory.filter(s => stamp - s.timestamp <= 10000), before = currentHistory.filter(s => stamp - s.timestamp >= 50000 && stamp - s.timestamp <= 70000);
      const delta = tail.length >= 3 && before.length >= 3 ? median(tail.map(s => s.value)) - median(before.map(s => s.value)) : null;
      const value = ready ? cached.value : null, limited = w.coveredNominal < 100;
      const visibleEvents = events.map(e => !isFresh && e === activeEvent ? { ...e, censored: true, endReason: "Supporting signal became stale; episode censored" } : e);
      return copy({ phase, value, label: value === null ? "" : value >= 68 ? "Elevated model response" : value >= 46 ? "Raised model response" : value >= 25 ? "Mild model response" : "Low model response",
        track: profile.length === 1 ? "hr" : "multivariate", source: synthetic ? "synthetic" : "device-reported", modelVersion: MODEL_VERSION,
        reference: { ready: Boolean(reference), value: 0, progress: reference ? 1 : Math.min(clamp(seconds / 120, 0, 1), candidate.length / 60), seconds, requiredSeconds: 120, requiredSamples: 60,
          channels: profile.slice(), profile: profile.slice(), stats: reference?.stats || {}, resetNeeded, start: reference?.start ?? candidate[0]?.timestamp ?? null,
          end: reference?.end ?? null, count: reference?.count ?? candidate.length, imported: reference?.imported ?? false },
        coverage: profile.length === 1 ? "HR-only · explicitly limited profile" : `${profile.length} physiological channels · ${w.coveredNominal}/100 nominal coverage`,
        limited, weights: w, components, history: currentHistory, trend: { direction: delta === null || Math.abs(delta) < 3 ? "steady" : delta > 0 ? "rising" : "falling", delta },
        sustainedSeconds: ready && cached.aboveSince ? Math.max(0, (stamp - cached.aboveSince) / 1000) : 0,
        baseScore: ready ? cached.baseScore : null, rawScore: ready ? cached.rawScore : null, modifierMultiplier: ready ? cached.modifierMultiplier : 1,
        research: eligible ? cached.research : emptyResearch(phase === "stale" ? "Supporting inputs are stale." : "Analysis held until fixed-profile inputs are eligible."), events: visibleEvents,
        reason: phase === "waiting" ? lastResetReason : phase === "stale" ? "Fresh physiological inputs are unavailable; no score is shown." : phase === "held" ? latest && !latest.motionEligible ? "Invalid or excessive movement; values are withheld, not lowered." : "A fixed-reference channel is missing or invalid; no silent coverage change." : phase === "calibrating" ? "Collect at least 60 observations across 120 elapsed seconds of contiguous eligible fixed-profile data." : resetNeeded.length ? "New channels are available. Reset the reference to include them; current weights remain fixed." : limited ? "Partial physiological coverage; fixed original weights are normalized and shown." : "Experimental multivariate personal heuristic; zero means no contribution under this model, not proof of calm." });
    }
    function exportReference() {
      if (!reference) return null;
      return copy({ schema: "autonomic-live-multivariate-reference", modelVersion: MODEL_VERSION, synthetic,
        profile: reference.profile, stats: reference.stats, correlation: reference.correlation,
        start: reference.start, end: reference.end, count: reference.count, surpriseThreshold: reference.surpriseThreshold,
        definition: "Fixed supplied-sensor reference. Import requires the same source/protocol labels; no score or current quality is restored." });
    }
    function importReference(input) {
      try {
        const ref = typeof input === "string" ? JSON.parse(input) : input;
        if (!ref || ref.schema !== "autonomic-live-multivariate-reference" || ref.modelVersion !== MODEL_VERSION || ref.synthetic !== synthetic ||
            !Array.isArray(ref.profile) || !ref.profile.length || !ref.profile.includes("heart_rate_bpm") || new Set(ref.profile).size !== ref.profile.length ||
            ref.profile.some(k => !KEYS.includes(k)) || (explicitHR && (ref.profile.length !== 1 || ref.profile[0] !== "heart_rate_bpm")) ||
            !finite(ref.surpriseThreshold) || ref.surpriseThreshold < .5 || !Number.isInteger(ref.count) || ref.count < 0 || ref.count > 20000 ||
            (!synthetic && (ref.count < 60 || !finite(ref.start) || !finite(ref.end) || ref.end - ref.start < 120000))) return false;
        const profile = KEYS.filter(k => ref.profile.includes(k)), stats = {};
        for (const key of profile) {
          const s = ref.stats?.[key];
          if (!s || !finite(s.mean) || s.mean < SPEC[key].range[0] || s.mean > SPEC[key].range[1] || !finite(s.sd) || s.sd < SPEC[key].floor || s.sd > SPEC[key].range[1] - SPEC[key].range[0] ||
              typeof s.source !== "string" || !s.source.trim() || s.source.length > 200) return false;
          stats[key] = { mean: s.mean, sd: s.sd, floor: SPEC[key].floor, source: s.source.trim() };
        }
        if (profile.join() !== ref.profile.join()) return false;
        const c = ref.correlation, e = R.eigenSymmetric(c);
        if (!e.available || c.length !== profile.length || e.values.some(v => v < -1e-10) || c.some((row, i) => row.some((v, j) => !finite(v) || Math.abs(v) > 1 + 1e-10 || (i === j && Math.abs(v - 1) > 1e-10)))) return false;
        const b = basis(c); // Validate before mutating a working reference.
        if (!b) return false;
        reset("An explicitly imported fixed reference is ready; waiting for fresh matching-source inputs.");
        installReference(profile, stats, c, { start: finite(ref.start) ? ref.start : null, end: finite(ref.end) ? ref.end : null,
          count: ref.count, surpriseThreshold: ref.surpriseThreshold, imported: true });
        origins = Object.fromEntries(profile.map(k => [k, stats[k].source]));
        return true;
      } catch { return false; }
    }
    function loadDemoReference() {
      if (!synthetic) return false;
      const center = { heart_rate_bpm: 68, pulse_rmssd_ms: 45, resp_rate_brpm: 13, eeg_beta_alpha: 1, pulse_sdnn_ms: 55 };
      const profile = explicitHR ? ["heart_rate_bpm"] : KEYS;
      reset("Synthetic demonstration reference loaded.");
      installReference(profile, Object.fromEntries(profile.map(k => [k, { mean: center[k], sd: SPEC[k].floor, floor: SPEC[k].floor, source: "Synthetic demo" }])),
        profile.map((_, i) => profile.map((_, j) => i === j ? 1 : 0)), { count: 121 });
      origins = Object.fromEntries(profile.map(k => [k, "Synthetic demo"]));
      return true;
    }
    return Object.freeze({ ingest, snapshot, reset, resetReference: reset, loadDemoReference, exportReference, importReference });
  }
  function demoFrame(timestamp, seconds = 0) {
    if (!finite(timestamp) || !finite(seconds)) throw Error("Synthetic demo time must be finite.");
    const wave = Math.sin(seconds / 24);
    return { type: "features", source: "synthetic", received_at: timestamp, heart_rate_bpm: 68 + 9 * wave,
      pulse_rmssd_ms: 45 - 15 * wave, resp_rate_brpm: 13 + 3 * wave, eeg_beta_alpha: 1 + .45 * wave,
      pulse_sdnn_ms: 55 - 15 * wave, motion: .01,
      quality: Object.fromEntries(KEYS.map(k => [k, { valid: true, received_at: timestamp, source: "Synthetic demo", reason: "Invented demonstration feature; no wearable measurement." }])) };
  }
  return Object.freeze({ create, demoFrame, modelVersion: MODEL_VERSION, nominalWeights: { ...NOMINAL } });
});
