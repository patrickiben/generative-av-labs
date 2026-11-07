/* Autonomic Telemetry research calculations. Pure, dependency-free, no storage,
 * network, fabricated channels, physiological classification, or device decoding.
 * Browser: TelemetryResearch. Node: import this file, then globalThis.TelemetryResearch. */
(function (root) {
  "use strict";
  const VERSION = 1;
  const FIELDS = [
    "heart_rate_bpm",
    "rmssd_ms",
    "resp_rate_brpm",
    "eeg_beta_alpha",
    "motion_g",
  ];
  const LIMITS = {
    heart_rate_bpm: [25, 240],
    rmssd_ms: [0, 500],
    resp_rate_brpm: [3, 60],
    eeg_beta_alpha: [0, 100],
    motion_g: [0, 16],
  };
  const finite = (x) => typeof x === "number" && Number.isFinite(x);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const variance = (a) => {
    if (a.length < 2) return null;
    const m = mean(a);
    return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  };
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const unavailable = (reason) => ({ available: false, reason });
  function numericArray(values, min = 1) {
    return (
      Array.isArray(values) && values.length >= min && values.every(finite)
    );
  }
  function covariance(rows) {
    if (!Array.isArray(rows) || rows.length < 2 || !numericArray(rows[0]))
      return unavailable("At least two complete numeric rows are required.");
    const k = rows[0].length;
    if (k > 20 || rows.some((r) => !numericArray(r) || r.length !== k))
      return unavailable("Rows must have equal lengths and finite values.");
    const means = Array.from({ length: k }, (_, j) =>
      mean(rows.map((r) => r[j])),
    );
    const matrix = Array.from({ length: k }, () => Array(k).fill(0));
    for (let i = 0; i < k; i++)
      for (let j = i; j < k; j++) {
        matrix[i][j] = matrix[j][i] =
          rows.reduce((s, r) => s + (r[i] - means[i]) * (r[j] - means[j]), 0) /
          (rows.length - 1);
      }
    return { available: true, matrix, means, n: rows.length };
  }
  // Deterministic Jacobi diagonalization of a real symmetric matrix.
  function eigenSymmetric(matrix) {
    if (!Array.isArray(matrix) || !matrix.length || matrix.length > 20)
      return unavailable("A symmetric matrix of size 1–20 is required.");
    const n = matrix.length;
    if (matrix.some((r) => !numericArray(r) || r.length !== n))
      return unavailable("Invalid matrix.");
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-9)
          return unavailable("Matrix must be symmetric.");
    const a = matrix.map((r) => r.slice()),
      v = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => +(i === j)),
      );
    const tolerance = 1e-12 * Math.max(1, ...matrix.flat().map(Math.abs));
    let converged = false;
    for (
      let iteration = 0;
      iteration < Math.max(20, 100 * n * n);
      iteration++
    ) {
      let p = 0,
        q = 0,
        max = 0;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          if (Math.abs(a[i][j]) > max) {
            max = Math.abs(a[i][j]);
            p = i;
            q = j;
          }
      if (max < tolerance) {
        converged = true;
        break;
      }
      const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]),
        c = Math.cos(angle),
        s = Math.sin(angle);
      const app = a[p][p],
        aqq = a[q][q],
        apq = a[p][q];
      for (let i = 0; i < n; i++)
        if (i !== p && i !== q) {
          const aip = a[i][p],
            aiq = a[i][q];
          a[i][p] = a[p][i] = c * aip - s * aiq;
          a[i][q] = a[q][i] = s * aip + c * aiq;
        }
      a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
      a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
      a[p][q] = a[q][p] = 0;
      for (let i = 0; i < n; i++) {
        const vip = v[i][p],
          viq = v[i][q];
        v[i][p] = c * vip - s * viq;
        v[i][q] = s * vip + c * viq;
      }
    }
    if (!converged) return unavailable("Eigenvalue solver did not converge.");
    const pairs = Array.from({ length: n }, (_, j) => ({
      value: a[j][j],
      vector: v.map((r) => r[j]),
    })).sort((a, b) => b.value - a.value);
    for (const p of pairs) {
      const index = p.vector.reduce(
        (best, x, i) => (Math.abs(x) > Math.abs(p.vector[best]) ? i : best),
        0,
      );
      if (p.vector[index] < 0) p.vector = p.vector.map((x) => -x);
    }
    return {
      available: true,
      values: pairs.map((p) => p.value),
      vectors: pairs.map((p) => p.vector),
    };
  }
  function principalComponents(rows) {
    const c = covariance(rows);
    if (!c.available) return c;
    const scales = c.matrix.map((r, j) => Math.sqrt(Math.max(0, r[j]))),
      columns = scales
        .map((s, j) => (s > 1e-12 ? j : null))
        .filter((j) => j !== null);
    if (!columns.length)
      return unavailable("All supplied channels are constant.");
    const z = rows.map((r) =>
      columns.map((j) => (r[j] - c.means[j]) / scales[j]),
    );
    const correlation = covariance(z).matrix,
      eigen = eigenSymmetric(correlation);
    if (!eigen.available) return eigen;
    const values = eigen.values.map((x) => Math.max(0, x)),
      total = values.reduce((s, x) => s + x, 0);
    return {
      available: true,
      n: rows.length,
      columns,
      means: c.means,
      scales,
      correlation,
      eigenvalues: values,
      loadings: eigen.vectors,
      explainedVariance: values.map((x) => x / total),
      absorptionRatio: values[0] / total,
      dimensions: Math.min(2, columns.length),
      coordinates: z.map((row) => [
        dot(row, eigen.vectors[0]),
        eigen.vectors[1] ? dot(row, eigen.vectors[1]) : 0,
      ]),
      definition:
        "PCA of standardized supplied channels; largest eigenvalue / sum of eigenvalues. Constant channels are omitted.",
    };
  }
  function makeReference(rows, keys = FIELDS.slice(0, rows?.[0]?.length || 0)) {
    const c = covariance(rows);
    if (!c.available) return c;
    if (
      !Array.isArray(keys) ||
      keys.length !== c.means.length ||
      new Set(keys).size !== keys.length ||
      keys.some((k) => !FIELDS.includes(k))
    )
      return unavailable(
        "Reference keys must be unique supported field names.",
      );
    const columns = c.matrix
      .map((r, j) => (r[j] > 1e-18 ? j : null))
      .filter((j) => j !== null);
    if (!columns.length)
      return unavailable("A reference needs at least one nonconstant channel.");
    const scales = columns.map((j) => Math.sqrt(c.matrix[j][j]));
    const matrix = columns.map((i, a) =>
      columns.map((j, b) => c.matrix[i][j] / (scales[a] * scales[b])),
    );
    return {
      available: true,
      schema: "autonomic-research-reference",
      version: VERSION,
      n: rows.length,
      keys: columns.map((j) => keys[j]),
      means: columns.map((j) => c.means[j]),
      scales,
      correlation: matrix,
      definition:
        "User-supplied reference statistics, not a physiological resting baseline.",
    };
  }
  function validateReference(ref) {
    if (
      !ref ||
      ref.schema !== "autonomic-research-reference" ||
      ref.version !== VERSION ||
      !Number.isSafeInteger(ref.n) ||
      ref.n < 2 ||
      ref.n > 20000
    )
      return unavailable("Unsupported reference schema or sample count.");
    const keys = ref.keys;
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > FIELDS.length ||
      new Set(keys).size !== keys.length ||
      keys.some((k) => !FIELDS.includes(k))
    )
      return unavailable("Invalid reference channels.");
    if (
      !numericArray(ref.means) ||
      !numericArray(ref.scales) ||
      ref.means.length !== keys.length ||
      ref.scales.length !== keys.length ||
      ref.scales.some((x) => x <= 0)
    )
      return unavailable("Invalid reference means or scales.");
    const e = eigenSymmetric(ref.correlation);
    if (
      !e.available ||
      ref.correlation.length !== keys.length ||
      e.values.some((x) => x < -1e-12)
    )
      return unavailable(
        "Reference correlation must be positive semidefinite.",
      );
    if (
      ref.correlation.some(
        (r, i) =>
          Math.abs(r[i] - 1) > 1e-8 || r.some((x) => Math.abs(x) > 1 + 1e-8),
      )
    )
      return unavailable("Invalid reference correlation values.");
    return {
      available: true,
      schema: ref.schema,
      version: VERSION,
      n: ref.n,
      keys: keys.slice(),
      means: ref.means.slice(),
      scales: ref.scales.slice(),
      correlation: ref.correlation.map((r) => r.slice()),
    };
  }
  function exportReference(reference) {
    const valid = validateReference(reference);
    if (!valid.available) return valid;
    return { available: true, json: JSON.stringify(valid, null, 2) };
  }
  function importReference(text) {
    try {
      return validateReference(
        typeof text === "string" ? JSON.parse(text) : text,
      );
    } catch {
      return unavailable("Reference is not valid JSON.");
    }
  }
  function mahalanobis(values, reference, shrinkage = 0.2) {
    const ref = validateReference(reference);
    if (!ref.available) return ref;
    if (
      !numericArray(values) ||
      values.length !== ref.keys.length ||
      !finite(shrinkage) ||
      shrinkage < 1e-6 ||
      shrinkage > 1
    )
      return unavailable(
        "Complete matching values and shrinkage in [0.000001,1] are required.",
      );
    const c = ref.correlation.map((r, i) =>
        r.map((x, j) => (1 - shrinkage) * x + (i === j ? shrinkage : 0)),
      ),
      e = eigenSymmetric(c);
    if (!e.available) return e;
    if (e.values.some((v) => !finite(v) || v <= 1e-12))
      return unavailable(
        "Regularized covariance is not numerically positive definite.",
      );
    const z = values.map((x, i) => (x - ref.means[i]) / ref.scales[i]),
      squared = e.values.reduce(
        (sum, value, i) => sum + dot(z, e.vectors[i]) ** 2 / value,
        0,
      );
    if (!finite(squared) || squared < 0)
      return unavailable(
        "Distance is not finite and nonnegative at this numerical scale.",
      );
    return {
      available: true,
      distance: Math.sqrt(Math.max(0, squared)),
      squaredDistance: squared,
      shrinkage,
      keys: ref.keys,
      n: ref.n,
      definition:
        "Distance from supplied reference after per-channel scaling and correlation shrinkage toward identity.",
    };
  }
  function sampleEntropy(values, { m = 2, r = 0.2, minSamples = 20 } = {}) {
    if (
      !numericArray(values) ||
      !Number.isInteger(m) ||
      m < 1 ||
      m > 5 ||
      !finite(r) ||
      r < 0
    )
      return unavailable(
        "Finite samples, embedding dimension 1–5, and nonnegative relative tolerance are required.",
      );
    if (values.length < Math.max(minSamples, m + 2))
      return unavailable(
        "Insufficient samples for the requested entropy window.",
      );
    if (values.length > 1000)
      return unavailable("Entropy windows are limited to 1,000 samples.");
    const tolerance = r * Math.sqrt(variance(values)),
      n = values.length - m;
    let matchesM = 0,
      matchesM1 = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let match = true;
        for (let k = 0; k < m; k++)
          if (Math.abs(values[i + k] - values[j + k]) > tolerance) {
            match = false;
            break;
          }
        if (match) {
          matchesM++;
          if (Math.abs(values[i + m] - values[j + m]) <= tolerance) matchesM1++;
        }
      }
    const base = {
      n: values.length,
      m,
      r,
      tolerance,
      matchesM,
      matchesM1,
      constant: tolerance === 0 && variance(values) === 0,
    };
    if (!matchesM || !matchesM1)
      return {
        ...base,
        ...unavailable(
          !matchesM
            ? "No length-m template matches."
            : "No extended template matches; entropy is unbounded for this sample, not a finite fallback.",
        ),
      };
    return {
      ...base,
      available: true,
      value: -Math.log(matchesM1 / matchesM),
      definition:
        "Sample entropy using identical template populations, no self-matches, tolerance r × sample SD. Constant input gives zero.",
    };
  }
  function pearson(a, b) {
    if (!numericArray(a, 3) || !numericArray(b, 3) || a.length !== b.length)
      return null;
    const am = mean(a),
      bm = mean(b),
      aa = a.reduce((s, x) => s + (x - am) ** 2, 0),
      bb = b.reduce((s, x) => s + (x - bm) ** 2, 0);
    return aa > 0 && bb > 0
      ? clamp(
          a.reduce((s, x, i) => s + (x - am) * (b[i] - bm), 0) /
            Math.sqrt(aa * bb),
          -1,
          1,
        )
      : null;
  }
  function crossLag(a, b, { maxLag = 8, minPairs = 20 } = {}) {
    if (
      !numericArray(a) ||
      !numericArray(b) ||
      a.length !== b.length ||
      !Number.isInteger(maxLag) ||
      maxLag < 0 ||
      maxLag > 100
    )
      return unavailable(
        "Equal complete arrays and an integer lag bound 0–100 are required.",
      );
    const candidates = [];
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const x = [],
        y = [];
      for (let i = 0; i < a.length; i++) {
        const j = i + lag;
        if (j >= 0 && j < b.length) {
          x.push(a[i]);
          y.push(b[j]);
        }
      }
      if (x.length < minPairs) continue;
      const correlation = pearson(x, y);
      if (correlation !== null)
        candidates.push({ lagSamples: lag, correlation, n: x.length });
    }
    if (!candidates.length)
      return unavailable("Too few paired samples or constant input.");
    candidates.sort(
      (x, y) =>
        Math.abs(y.correlation) - Math.abs(x.correlation) ||
        Math.abs(x.lagSamples) - Math.abs(y.lagSamples) ||
        x.lagSamples - y.lagSamples,
    );
    return {
      available: true,
      ...candidates[0],
      candidates,
      definition:
        "Largest absolute overlap-specific Pearson correlation. Positive lag means the first channel precedes the second. Association only; no causal direction.",
    };
  }
  // Rolling AR(1) fit uses only previous observations. Standardized residuals are
  // computed before updating the residual EWMA; no future sample can alter history.
  function ar1Surprise(
    values,
    {
      window = 60,
      minSamples = 12,
      alpha = 0.04,
      varianceFloor = 1e-8,
      maxGapMs = 10000,
      timestamps = null,
    } = {},
  ) {
    if (
      !Array.isArray(values) ||
      values.length > 20000 ||
      !Number.isInteger(window) ||
      window < minSamples ||
      window > 1000 ||
      !Number.isInteger(minSamples) ||
      minSamples < 4 ||
      !finite(alpha) ||
      alpha <= 0 ||
      alpha > 1 ||
      !finite(varianceFloor) ||
      varianceFloor <= 0
    )
      return unavailable("Invalid prediction configuration.");
    if (
      timestamps &&
      (!numericArray(timestamps) ||
        timestamps.length !== values.length ||
        timestamps.some((t, i) => i && t <= timestamps[i - 1]))
    )
      return unavailable("Prediction timestamps must increase strictly.");
    let history = [],
      ewma = null;
    const series = [];
    for (let i = 0; i < values.length; i++) {
      const x = values[i],
        gap = timestamps && i ? timestamps[i] - timestamps[i - 1] : 0;
      if (!finite(x) || gap > maxGapMs) {
        history = [];
        ewma = null;
        if (!finite(x)) {
          series.push(null);
          continue;
        }
      }
      let result = null;
      if (history.length >= minSamples) {
        const xx = history.slice(0, -1),
          yy = history.slice(1),
          xm = mean(xx),
          ym = mean(yy),
          den = xx.reduce((s, v) => s + (v - xm) ** 2, 0);
        const phi =
            den > varianceFloor
              ? clamp(
                  xx.reduce((s, v, j) => s + (v - xm) * (yy[j] - ym), 0) / den,
                  -0.98,
                  0.98,
                )
              : 0,
          intercept = ym - phi * xm;
        const prediction = intercept + phi * history.at(-1);
        if (ewma === null)
          ewma = Math.max(
            varianceFloor,
            mean(yy.map((v, j) => (v - intercept - phi * xx[j]) ** 2)),
          );
        const usedVariance = Math.max(varianceFloor, ewma),
          residual = x - prediction,
          standardizedResidual = residual / Math.sqrt(usedVariance);
        result = {
          prediction,
          residual,
          standardizedResidual,
          halfSquaredError: 0.5 * standardizedResidual ** 2,
          phi,
          intercept,
          variance: usedVariance,
          trainingSamples: history.length,
        };
        ewma = (1 - alpha) * usedVariance + alpha * residual ** 2;
      }
      history.push(x);
      if (history.length > window) history.shift();
      series.push(result);
    }
    return {
      available: series.some(Boolean),
      series,
      latest: series.at(-1) || null,
      definition:
        "Per-channel rolling AR(1), followed by EWMA residual variance. Half squared standardized residual; not Gaussian likelihood, calibrated probability, or a clinical signal.",
      reason: series.some(Boolean)
        ? undefined
        : "Not enough consecutive prior observations.",
    };
  }
  function rrMetrics(intervals, { minIntervals = 20 } = {}) {
    if (
      !Number.isInteger(minIntervals) ||
      minIntervals < 20 ||
      minIntervals > 20000
    )
      return unavailable(
        "The RR minimum must be an integer from 20 to 20,000 intervals.",
      );
    if (Array.isArray(intervals) && intervals.length > 20000)
      return unavailable(
        "RR analysis is limited to 20,000 supplied intervals.",
      );
    if (!numericArray(intervals, 2))
      return unavailable(
        "Supply real RR intervals in milliseconds; no intervals are inferred from heart rate or optical samples.",
      );
    if (intervals.some((x) => x < 250 || x > 2500))
      return unavailable(
        "Intervals outside the declared 250–2500 ms analysis range require upstream review. No beats were silently removed.",
      );
    if (intervals.length < minIntervals)
      return unavailable(
        "At least " + minIntervals + " supplied intervals are required.",
      );
    const diffs = intervals.slice(1).map((x, i) => x - intervals[i]),
      diffVariance = variance(diffs),
      rrVariance = variance(intervals),
      rmssd = Math.sqrt(mean(diffs.map((x) => x * x))),
      sd1 = Math.sqrt(diffVariance / 2),
      sd2Squared =
        variance(intervals.slice(1).map((x, i) => x + intervals[i])) / 2;
    return {
      available: true,
      n: intervals.length,
      durationSeconds: intervals.reduce((s, x) => s + x, 0) / 1000,
      meanRRms: mean(intervals),
      meanRateBpm: 60000 / mean(intervals),
      rmssdMs: rmssd,
      pnn50Percent:
        (100 * diffs.filter((x) => Math.abs(x) > 50).length) / diffs.length,
      sdnnMs: Math.sqrt(rrVariance),
      sd1Ms: sd1,
      sd2Ms: sd2Squared >= -1e-9 ? Math.sqrt(Math.max(0, sd2Squared)) : null,
      definition:
        "Descriptive statistics of supplied intervals, without artifact correction. SDNN uses sample variance. SD1 and SD2 use sample variances of successive differences and sums divided by two, respectively. SD1 is not forced to RMSSD/√2 when the mean difference is nonzero.",
    };
  }
  function rrSpectrum() {
    return unavailable(
      "Spectral RR analysis is preserved as an explicit unavailable interface. Validated beat timestamps, artifact handling, interpolation, windowing, duration criteria, and spectral normalization are required before LF/HF or respiratory-band concentration can be reported. No physiological ratio is fabricated.",
    );
  }
  function eventSummary(
    series,
    timestamps,
    {
      threshold = 3,
      recoveryThreshold = 1,
      refractoryMs = 20000,
      maxGapMs = 10000,
    } = {},
  ) {
    if (
      !Array.isArray(series) ||
      !numericArray(timestamps) ||
      series.length !== timestamps.length ||
      timestamps.some((t, i) => i && t <= timestamps[i - 1]) ||
      !finite(threshold) ||
      !finite(recoveryThreshold) ||
      recoveryThreshold < 0 ||
      recoveryThreshold >= threshold
    )
      return unavailable(
        "Increasing timestamps and valid descriptive thresholds are required.",
      );
    const events = [];
    let active = null,
      lastOnset = -Infinity;
    for (let i = 0; i < series.length; i++) {
      if (i && timestamps[i] - timestamps[i - 1] > maxGapMs && active) {
        active.censored = true;
        active.endReason = "timestamp gap";
        active = null;
      }
      const x = series[i];
      if (!finite(x)) {
        if (active) {
          active.censored = true;
          active.endReason = "missing signal";
          active = null;
        }
        continue;
      }
      if (active) {
        active.peak = Math.max(active.peak, x);
        if (x <= recoveryThreshold) {
          active.recoveryMs = timestamps[i] - active.timestamp;
          active.endTimestamp = timestamps[i];
          active.censored = false;
          active = null;
        }
      } else if (x >= threshold && timestamps[i] - lastOnset >= refractoryMs) {
        active = {
          index: i,
          timestamp: timestamps[i],
          peak: x,
          recoveryMs: null,
          censored: true,
          endReason: "recording ended",
        };
        events.push(active);
        lastOnset = timestamps[i];
      }
    }
    return {
      available: true,
      events,
      threshold,
      recoveryThreshold,
      definition:
        "Threshold episodes in a supplied mathematical series. Recovery is return below the lower threshold, not physiological recovery; missing data censor an episode.",
    };
  }
  function evaluate(samples, options = {}) {
    if (!Array.isArray(samples) || samples.length < 2 || samples.length > 20000)
      return unavailable("Provide 2–20,000 normalized feature samples.");
    if (
      samples.some(
        (s, i) =>
          !s ||
          !finite(s.timestamp) ||
          (i && s.timestamp <= samples[i - 1].timestamp),
      )
    )
      return unavailable(
        "Sample timestamps must be finite epoch milliseconds and strictly increasing.",
      );
    const maxGapMs = 10000,
      referenceCount = options.referenceCount ?? 60;
    if (
      !Number.isInteger(referenceCount) ||
      referenceCount < 20 ||
      referenceCount > 1000
    )
      return unavailable(
        "Reference count must be an integer from 20 to 1,000.",
      );
    const good = (s) =>
      s.quality === "good" &&
      (s.motion_g === null ||
        s.motion_g === undefined ||
        (finite(s.motion_g) && s.motion_g >= 0 && s.motion_g <= 0.25));
    const present = (s, k) =>
      finite(s[k]) && s[k] >= LIMITS[k][0] && s[k] <= LIMITS[k][1];
    const keys = FIELDS.filter((k) =>
      samples.some((s) => good(s) && present(s, k)),
    );
    const times = samples.map((s) => s.timestamp),
      seriesByChannel = {};
    for (const key of keys)
      seriesByChannel[key] = ar1Surprise(
        samples.map((s) => (good(s) && present(s, key) ? s[key] : null)),
        { timestamps: times },
      );
    const surpriseSeries = samples.map((s, i) => {
      const entries = keys
        .map((k) => ({ key: k, value: seriesByChannel[k].series[i] }))
        .filter((x) => x.value);
      return entries.length
        ? {
            timestamp: s.timestamp,
            value: mean(entries.map((e) => e.value.halfSquaredError)),
            channels: entries.map((e) => e.key),
          }
        : null;
    });
    const surprise = {
      available: surpriseSeries.some(Boolean),
      latest: surpriseSeries.at(-1),
      series: surpriseSeries,
      byChannel: seriesByChannel,
      definition:
        "Mean half squared standardized prediction error over available eligible channels. Each forecast precedes its observation update; channel count is reported.",
    };
    function endingWindow(windowKeys, max = 120) {
      const out = [];
      for (let i = samples.length - 1; i >= 0 && out.length < max; i--) {
        const s = samples[i];
        if (
          !good(s) ||
          !windowKeys.every((k) => present(s, k)) ||
          (i < samples.length - 1 &&
            samples[i + 1].timestamp - s.timestamp > maxGapMs)
        )
          break;
        out.unshift(s);
      }
      return out;
    }
    let reference = null;
    if (options.reference) {
      const imported = importReference(options.reference);
      if (imported.available) reference = imported;
      else return imported;
    } else {
      let run = [],
        runKeys = [];
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i],
          available = keys.filter((k) => present(s, k));
        if (!good(s) || !available.length) {
          run = [];
          runKeys = [];
          continue;
        }
        if (
          !run.length ||
          s.timestamp - run.at(-1).timestamp > maxGapMs ||
          available.join() !== runKeys.join()
        ) {
          run = [];
          runKeys = available;
        }
        run.push(s);
        if (run.length >= referenceCount) {
          const r = makeReference(
            run.map((s) => runKeys.map((k) => s[k])),
            runKeys,
          );
          if (r.available) {
            reference = { ...r, start: run[0].timestamp, end: s.timestamp };
            break;
          }
          run.shift();
        }
      }
    }
    const last = samples.at(-1),
      turbulence =
        reference && good(last) && reference.keys.every((k) => present(last, k))
          ? mahalanobis(
              reference.keys.map((k) => last[k]),
              reference,
            )
          : unavailable(
              "No complete eligible current sample and nonconstant reference.",
            );
    const currentKeys = keys.filter((k) => endingWindow([k]).length >= 20),
      window = endingWindow(currentKeys);
    const manifold =
      currentKeys.length >= 2 && window.length >= 20
        ? principalComponents(window.map((s) => currentKeys.map((k) => s[k])))
        : unavailable(
            "PCA needs at least two complete channels and 20 consecutive eligible samples.",
          );
    if (manifold.available) {
      manifold.keys = manifold.columns.map((i) => currentKeys[i]);
      manifold.timestamps = window.map((s) => s.timestamp);
    }
    const coupling =
      manifold.available && manifold.columns.length >= 2
        ? {
            available: true,
            n: manifold.n,
            keys: manifold.keys,
            absorptionRatio: manifold.absorptionRatio,
            eigenvalues: manifold.eigenvalues,
            correlation: manifold.correlation,
            definition:
              "Fraction of standardized channel variation captured by the leading eigenvector; not evidence of a shared cause.",
          }
        : unavailable("Coupling needs two nonconstant aligned channels.");
    const entropyKey = ["rmssd_ms", "heart_rate_bpm"].find(
        (k) => endingWindow([k], 90).length >= 20,
      ),
      entropy = entropyKey
        ? {
            ...sampleEntropy(
              endingWindow([entropyKey], 90).map((s) => s[entropyKey]),
            ),
            key: entropyKey,
          }
        : unavailable(
            "Entropy needs 20 consecutive eligible variability or heart-rate samples.",
          );
    const pairs = [
        ["resp_rate_brpm", "heart_rate_bpm"],
        ["heart_rate_bpm", "rmssd_ms"],
        ["eeg_beta_alpha", "heart_rate_bpm"],
        ["motion_g", "heart_rate_bpm"],
      ],
      crosslags = [];
    for (const [from, to] of pairs) {
      const w = endingWindow([from, to]);
      if (w.length < 20) {
        crosslags.push({
          from,
          to,
          ...unavailable("Needs 20 aligned consecutive eligible samples."),
        });
        continue;
      }
      const dts = w.slice(1).map((s, i) => s.timestamp - w[i].timestamp),
        cadence = mean(dts),
        regular = dts.every(
          (x) => Math.abs(x - cadence) <= Math.max(1, cadence * 0.01),
        );
      if (!regular) {
        crosslags.push({
          from,
          to,
          ...unavailable(
            "Signed sample lags require uniform cadence; irregular intervals are not relabeled as seconds.",
          ),
        });
        continue;
      }
      const lag = crossLag(
        w.map((s) => s[from]),
        w.map((s) => s[to]),
        { maxLag: options.maxLag ?? 8 },
      );
      crosslags.push({
        ...lag,
        from,
        to,
        ...(lag.available
          ? {
              lagSeconds: (lag.lagSamples * cadence) / 1000,
              cadenceMs: cadence,
            }
          : {}),
      });
    }
    const rr = options.rrIntervals
        ? rrMetrics(options.rrIntervals)
        : unavailable("No independently supplied RR intervals."),
      episodes = eventSummary(
        surpriseSeries.map((s) => s?.value ?? null),
        times,
      );
    const result = {
      available: true,
      version: VERSION,
      n: samples.length,
      eligibleSamples: samples.filter(good).length,
      keys,
      reference,
      surprise,
      turbulence,
      coupling,
      entropy,
      crosslags,
      manifold,
      rr,
      spectrum: rrSpectrum(),
      events: episodes.events || [],
      eventDefinition: episodes.definition,
      unavailable: [],
    };
    for (const name of [
      "turbulence",
      "coupling",
      "entropy",
      "manifold",
      "rr",
      "spectrum",
    ])
      if (!result[name].available)
        result.unavailable.push({ module: name, reason: result[name].reason });
    return result;
  }
  function parseTimestamp(value) {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
        value,
      );
    if (!match) return null;
    const [, ys, mos, ds, hs, mis, ss, fraction, zone, sign, ohs, oms] = match;
    const y = Number(ys),
      mo = Number(mos),
      d = Number(ds),
      h = Number(hs),
      mi = Number(mis),
      sec = Number(ss),
      ms = Number((fraction || "").padEnd(3, "0").slice(0, 3)),
      oh = Number(ohs || 0),
      om = Number(oms || 0);
    if (
      mo < 1 ||
      mo > 12 ||
      d < 1 ||
      d > 31 ||
      h > 23 ||
      mi > 59 ||
      sec > 59 ||
      oh > 14 ||
      om > 59 ||
      (oh === 14 && om !== 0)
    )
      return null;
    const date = new Date(0);
    date.setUTCFullYear(y, mo - 1, d);
    date.setUTCHours(h, mi, sec, ms);
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== mo - 1 ||
      date.getUTCDate() !== d
    )
      return null;
    const offset =
      (zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (oh * 60 + om)) * 60000;
    const timestamp = date.getTime() - offset;
    return finite(timestamp) ? timestamp : null;
  }
  // Context-only adapter for the documented Health Auto Export metrics structure.
  // An unspecified exported HRV metric remains unspecified; it is never RMSSD.
  function healthAutoExport(input) {
    let obj;
    try {
      obj = typeof input === "string" ? JSON.parse(input) : input;
    } catch {
      return unavailable("Health Auto Export input is not valid JSON.");
    }
    const metrics = obj?.data?.metrics ?? obj?.metrics;
    if (!Array.isArray(metrics) || metrics.length > 1000)
      return unavailable("Expected a metrics array.");
    const map = {
      resting_heart_rate: "restHR",
      heart_rate: "heartRate",
      heart_rate_variability: "hrv",
      heart_rate_variability_sdnn: "sdnn",
      respiratory_rate: "resp",
      blood_oxygen_saturation: "spo2",
    };
    const records = [],
      rejected = [];
    for (const metric of metrics) {
      if (!metric || !map[metric.name] || !Array.isArray(metric.data)) continue;
      if (metric.data.length > 20000)
        return unavailable("Each context metric is limited to 20,000 records.");
      for (const entry of metric.data) {
        if (!entry || typeof entry !== "object") {
          rejected.push("Invalid context record.");
          continue;
        }
        const value =
          metric.name === "heart_rate" ? (entry.Avg ?? entry.qty) : entry.qty;
        const raw = String(entry.date || ""),
          dated = raw.replace(
            /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)[ ]([+-]\d\d)(\d\d)$/,
            "$1T$2$3:$4",
          );
        if (!/(?:Z|[+-]\d\d:\d\d)$/.test(dated)) {
          rejected.push("Context timestamp needs an explicit timezone.");
          continue;
        }
        const timestamp = parseTimestamp(dated),
          unit = String(metric.units || "");
        if (!finite(value) || value < 0 || !finite(timestamp) || !unit) {
          rejected.push("Context value, date, or unit is missing.");
          continue;
        }
        records.push({
          metric: map[metric.name],
          value,
          timestamp,
          unit,
          source: String(
            entry.source ||
              metric.source ||
              "Health Auto Export · source unspecified",
          ).slice(0, 160),
          originalMetric: metric.name,
        });
      }
    }
    return {
      available: records.length > 0,
      kind: "health-auto-export",
      contextOnly: true,
      records: records.sort((a, b) => a.timestamp - b.timestamp),
      rejected,
      reason: records.length
        ? undefined
        : "No supported context records with explicit units and timezone.",
      definition:
        "Exported context only. Original units and source are retained; no values are inserted into session channels.",
    };
  }
  function mindMonitorCSV(text, options = {}) {
    if (typeof text !== "string" || text.length > 20 * 1024 * 1024)
      return unavailable("Provide CSV text no larger than 20 MiB.");
    const rows = [];
    let row = [],
      value = "",
      quoted = false,
      afterQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (afterQuote && c !== "," && c !== "\n" && c !== "\r")
        return unavailable("Unexpected characters after a closing CSV quote.");
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          value += '"';
          i++;
        } else if (!quoted && value.length)
          return unavailable("Malformed quoted CSV field.");
        else {
          quoted = !quoted;
          afterQuote = !quoted;
        }
      } else if (c === "," && !quoted) {
        row.push(value);
        value = "";
        afterQuote = false;
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(value);
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
        value = "";
        afterQuote = false;
      } else value += c;
    }
    if (quoted) return unavailable("CSV has an unclosed quoted field.");
    row.push(value);
    if (row.some((x) => x.trim())) rows.push(row);
    if (rows.length < 2)
      return unavailable("CSV needs a header and at least one sample.");
    const headers = rows.shift().map((x) => x.replace(/^\uFEFF/, "").trim());
    if (
      new Set(headers).size !== headers.length ||
      !headers.includes("TimeStamp")
    )
      return unavailable("CSV requires unique columns including TimeStamp.");
    if (rows.some((r) => r.length !== headers.length))
      return unavailable("CSV rows must match the header column count.");
    return mindMonitorRows(
      rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]))),
      options,
    );
  }
  function mindMonitorRows(rows, { bandScale, timezoneOffset } = {}) {
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      rows.length > 20000 ||
      !["bel", "linear"].includes(bandScale)
    )
      return unavailable(
        "Provide parsed rows and declare bandScale as bel (log10 power) or linear.",
      );
    const sensors = ["TP9", "AF7", "AF8", "TP10"],
      samples = [],
      rejected = [];
    const number = (x) =>
      x === null || x === undefined || String(x).trim() === ""
        ? null
        : Number(x);
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        rejected.push("Invalid row.");
        continue;
      }
      let stamp = String(row.TimeStamp || "")
        .trim()
        .replace(" ", "T");
      if (!/(?:Z|[+-]\d\d:\d\d)$/.test(stamp)) {
        if (!/^[+-]\d\d:\d\d$/.test(timezoneOffset || "")) {
          rejected.push("Timestamp needs an explicit timezone.");
          continue;
        }
        stamp += timezoneOffset;
      }
      const timestamp = parseTimestamp(stamp);
      if (!finite(timestamp)) {
        rejected.push("Invalid timestamp.");
        continue;
      }
      const alpha = sensors.map((s) => number(row["Alpha_" + s])),
        beta = sensors.map((s) => number(row["Beta_" + s]));
      const toPower = (v) =>
        !finite(v) ? null : bandScale === "bel" ? 10 ** v : v >= 0 ? v : null;
      const a = alpha.map(toPower),
        b = beta.map(toPower),
        complete = a.every(finite) && b.every(finite) && mean(a) > 0;
      const xyz = ["X", "Y", "Z"].map((k) => number(row["Accelerometer_" + k])),
        motion = xyz.every(finite) ? Math.abs(Math.hypot(...xyz) - 1) : null;
      const hsi = sensors.map((s) => number(row["HSI_" + s])),
        head = number(row.HeadBandOn);
      const quality =
        head === 0 || hsi.some((v) => finite(v) && v > 1)
          ? "poor"
          : head === 1 && hsi.every((v) => v === 1)
            ? "good"
            : "unknown";
      samples.push({
        timestamp,
        quality,
        heart_rate_bpm: null,
        rmssd_ms: null,
        resp_rate_brpm: null,
        eeg_beta_alpha: complete ? mean(b) / mean(a) : null,
        motion_g: motion,
        suppliedBands: { scale: bandScale, alpha, beta, sensors },
        frontalAlphaLogRatio:
          finite(a[2]) && finite(a[1]) && a[2] > 0 && a[1] > 0
            ? Math.log10(a[2] / a[1])
            : null,
      });
    }
    if (samples.some((s, i) => i && s.timestamp <= samples[i - 1].timestamp))
      return unavailable(
        "Mind Monitor timestamps must increase strictly; merge or aggregate duplicate timestamps explicitly.",
      );
    return {
      available: samples.length > 0,
      samples,
      rejected,
      provenance: {
        kind: "user-supplied",
        label: "Mind Monitor supplied bands; " + bandScale + " scale",
      },
      definition:
        "Bel powers are converted with 10^x before averaging and forming ratios. No HR, RR, or breathing is inferred. Fit remains unknown unless the supplied indicators support it.",
    };
  }
  root.TelemetryResearch = Object.freeze({
    version: VERSION,
    evaluate,
    covariance,
    eigenSymmetric,
    principalComponents,
    makeReference,
    validateReference,
    exportReference,
    importReference,
    mahalanobis,
    sampleEntropy,
    pearson,
    crossLag,
    ar1Surprise,
    rrMetrics,
    rrSpectrum,
    eventSummary,
    healthAutoExport,
    mindMonitorCSV,
    mindMonitorRows,
  });
})(globalThis);
