/* PWM Explorer for EJ2311.
   One fundamental period is sampled at NS points. Units follow Holmes & Lipo: the dc link is 2Vdc,
   so every phase output lies in [−Vdc, +Vdc] (per unit of Vdc). Because exactly one period is
   analysed, the FFT bins are the harmonic orders h = 0, 1, 2, ... with no leakage. */
(function () {
  'use strict';

  const NS = 16384;
  const TWO_PI = 2 * Math.PI;
  const SQRT3 = Math.sqrt(3);
  const fft = new FFT(NS);
  const $ = (id) => document.getElementById(id);

  const CARRIER_BASED = new Set(['spwm', 'thi', 'svm', 'dpwm1']);
  const LINEAR_LIMIT = { spwm: 1, thi: 2 / SQRT3, svm: 2 / SQRT3, dpwm1: 2 / SQRT3 };
  const STRATS = {
    '2l': ['spwm', 'thi', 'svm', 'dpwm1', 'sixstep', 'she', 'dtc'],
    hb: ['spwm'],
    npc: ['spwm', 'thi', 'svm', 'she'],
    chb: ['spwm', 'thi', 'svm'],
    fc: ['spwm', 'thi', 'svm'],
    mmc: ['spwm', 'thi', 'svm'],
  };
  const ARRS = { npc: ['pd', 'pod'], chb: ['ps', 'pd', 'pod', 'apod'] };
  const OUTS = { '2l': ['vaz', 'vab', 'van', 'ia'], hb: ['vaz', 'vab', 'ia'], npc: ['vaz', 'vab', 'van', 'ia'], chb: ['vaz', 'vab', 'van', 'ia'], fc: ['vaz', 'vab', 'van', 'ia'], mmc: ['vaz', 'vab', 'van', 'ia'] };
  const TOPO_TEXT = {
    '2l': 'Two switches per leg. Each phase connects to +V<sub>dc</sub> or −V<sub>dc</sub>.',
    hb: 'Two legs feed one load between a and b. v<sub>ab</sub> = v<sub>az</sub> − v<sub>bz</sub> can take ±2V<sub>dc</sub> and 0.',
    npc: 'Four switches and two clamp diodes per leg. Each phase connects to +V<sub>dc</sub>, the midpoint z, or −V<sub>dc</sub>.',
    chb: 'N H-bridge cells in series per phase, each with its own dc source V<sub>dc</sub>/N. 2N + 1 levels per phase.',
    fc: 'N complementary switch pairs per leg with N − 1 flying capacitors charged to 2V<sub>dc</sub>·k/N. N + 1 levels per phase. Phase-shifted carriers, one per switch pair.',
    mmc: 'Each phase leg has an upper and a lower arm of N half-bridge submodules (capacitor 2V<sub>dc</sub>/N each) and an arm inductor. An inserted submodule adds its capacitor voltage, a bypassed one adds 0. With n<sub>u</sub> and n<sub>l</sub> inserted, v<sub>az</sub> = (n<sub>l</sub> − n<sub>u</sub>)·V<sub>dc</sub>/N. Capacitor voltages are assumed constant and circulating current is ignored.',
  };
  const DESCRIPTION = {
    spwm: () => 'v*<sub>x</sub> = M cos(ωt − φ<sub>x</sub>). Linear up to M = 1.',
    thi: () => 'v*<sub>x</sub> = M cos(ωt − φ<sub>x</sub>) − (M/6) cos 3ωt. Linear up to M = 2/√3 ≈ 1.155.',
    svm: (t) => 'Adds the zero sequence −(max + min)/2. ' + (t === '2l'
      ? 'This centres the zero vectors in each carrier period and is equivalent to SVM.'
      : 'For two levels this is SVM with centred zero vectors.') + ' Linear up to M ≈ 1.155.',
    dpwm1: () => 'Clamps the phase with the largest |v*| to the dc rail for 60° around its peak. One third fewer commutations. Linear up to M ≈ 1.155.',
    dtc: () => '<p>Direct torque control of a PMSM, as in the course DTC exercise: 4 pole pairs, L<sub>s</sub> = 4 mH, R<sub>s</sub> = 60 mΩ, ψ<sub>m</sub> = 1 Vs, 1500 V dc link, controller sampled at 200 kHz.</p><p>A two-level flux comparator and a three-level torque comparator pick a voltage vector from Takahashi\'s switching table, by the sector of the stator flux. There is no modulator and no carrier, so the switching frequency varies and the spectrum is spread rather than grouped.</p>',
    sixstep: () => 'Each leg is a square wave, giving the largest fundamental, 4/π · V<sub>dc</sub> ≈ 1.27.',
    she: (t) => t === 'npc'
      ? 'Three-level, quarter-wave symmetric pattern (0 ↔ ±V<sub>dc</sub>) with N angles. Sets V<sub>1</sub> = M and removes the first N − 1 non-triplen harmonics.'
      : 'Two-level, quarter-wave symmetric pattern with N angles. Sets V<sub>1</sub> = M and removes the first N − 1 non-triplen harmonics (5, 7, 11, 13, …). Triplens cancel between the phases.',
  };
  const OUT_LABEL = { vaz: 'v_az', vab: 'v_ab', van: 'v_an', ia: 'i_a' };

  const DEFAULTS = {
    topo: '2l', cells: '2', fcn: '2', smn: '4', mmcmod: 'ps1', arr: 'pd', hbmod: 'uni', strat: 'spwm', carrier: 'tri', samp: 'nat', nshe: '5',
    M: '0.8', p: '21', cph: '0', tmin: '0', out: 'vaz', phi: '70', view: '360', hmax: 'auto', cur: '30',
    tq: '300', psr: '1.05', dtb: '20', dpb: '0.02', rpm: '1000', tstep: 'const',
  };
  const ctlIds = Object.keys(DEFAULTS);
  const numeric = new Set(['M', 'p', 'cph', 'tmin', 'phi', 'nshe', 'view', 'cells', 'fcn', 'smn', 'cur', 'tq', 'psr', 'dtb', 'dpb', 'rpm']);
  const computeKeys = ['topo', 'cells', 'fcn', 'smn', 'mmcmod', 'arr', 'hbmod', 'strat', 'carrier', 'samp', 'nshe', 'M', 'p', 'cph', 'tmin', 'out', 'phi', 'tq', 'psr', 'dtb', 'dpb', 'rpm', 'tstep'];
  let allPhases = false, dbScale = false, sweeping = false, playing = false, hoverX = null;

  function params() {
    const p = {};
    for (const id of ctlIds) p[id] = numeric.has(id) ? parseFloat($(id).value) : $(id).value;
    return p;
  }

  // ---------- buffers ----------
  const sw = [new Float64Array(NS), new Float64Array(NS), new Float64Array(NS)];  // phase (or leg) output, −1 … +1
  const ref = [new Float64Array(NS), new Float64Array(NS), new Float64Array(NS)]; // references as compared
  const cars = Array.from({ length: 16 }, () => new Float64Array(NS));           // carriers
  const cellA = [0, 1, 2].map(() => Array.from({ length: 8 }, () => new Int8Array(NS))); // CHB leg A upper on / FC pair on / MMC upper-arm SM inserted
  const cellB = [0, 1, 2].map(() => Array.from({ length: 8 }, () => new Int8Array(NS))); // CHB leg B upper on / MMC lower-arm SM inserted
  const y = new Float64Array(NS);       // selected output
  const fund = new Float64Array(NS);    // its fundamental
  const re = new Float64Array(NS), im = new Float64Array(NS);
  const amp = new Float64Array(NS / 2 + 1);
  const psiA = new Float64Array(NS), psiB = new Float64Array(NS);
  const dtcT = new Float64Array(NS), dtcTref = new Float64Array(NS), dtcI = new Float64Array(NS); // DTC torque, reference, phase current
  const DTC = { Ls: 4e-3, Rs: 60e-3, psim: 1, pp: 4, vdc: 1500, fs: 2e5 };  // course DTC model (sim_settings.m)
  const VEC = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]];  // V1 … V6, V_k at (k−1)·60°

  function carrierAt(type, u) { // u in [0, 1): one carrier period, positive peak at u = 0
    if (type === 'sawr') return 2 * u - 1;
    if (type === 'sawf') return 1 - 2 * u;
    return Math.abs(4 * u - 2) - 1;
  }
  // comparator; a reference on (or beyond) a rail clamps, avoiding 1-sample glitches where the carrier touches ±1
  const gt = (r, c) => (r >= 1 - 1e-12 ? 1 : r <= -1 + 1e-12 ? 0 : r > c ? 1 : 0);

  function zeroSequence(strat, a, b, c, M) {
    switch (strat) {
      case 'svm': return -(Math.max(a, b, c) + Math.min(a, b, c)) / 2;
      case 'dpwm1': {
        const hi = Math.max(a, b, c), lo = Math.min(a, b, c);
        return Math.abs(hi) >= Math.abs(lo) ? 1 - hi : -1 - lo;
      }
      default: return 0;
    }
  }

  // ---------- selective harmonic elimination ----------
  function nonTriplenOdd(count) {
    const r = [];
    for (let n = 5; r.length < count; n += 2) if (n % 3) r.push(n);
    return r;
  }
  function solveLinear(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-14) return null;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  }
  // Two-level: +1 on [0, α1), −1 on [α1, α2), … from the positive peak (cosine frame), quarter-wave symmetric.
  // a_n = 4/(nπ) [ (−1)^N sin(nπ/2) + 2 Σ_k (−1)^(k+1) sin(n α_k) ]
  const SHE2 = {
    coef(n, a) {
      let s = (a.length % 2 ? -1 : 1) * Math.sin((n * Math.PI) / 2);
      for (let j = 0; j < a.length; j++) s += 2 * (j % 2 ? -1 : 1) * Math.sin(n * a[j]);
      return (4 / (n * Math.PI)) * s;
    },
    deriv: (n, aj, j) => (8 / Math.PI) * (j % 2 ? -1 : 1) * Math.cos(n * aj),
    seeds: () => [],
  };
  // Three-level: 0 on [0, α1), +1 on [α1, α2), 0 … from the zero crossing (sine frame), quarter-wave symmetric.
  // b_n = 4/(nπ) Σ_k (−1)^(k+1) cos(n α_k)
  const SHE3 = {
    coef(n, a) {
      let s = 0;
      for (let j = 0; j < a.length; j++) s += (j % 2 ? -1 : 1) * Math.cos(n * a[j]);
      return (4 / (n * Math.PI)) * s;
    },
    deriv: (n, aj, j) => -(4 / Math.PI) * (j % 2 ? -1 : 1) * Math.sin(n * aj),
    seeds: (N) => (N === 5 ? [[0.8114, 0.9055, 1.1069, 1.2935, 1.4223]] : []), // CA2 tip, M = 0.5
  };
  function newton(S, H, M, guess) {
    const N = guess.length, a = guess.slice();
    const resid = () => H.map((n, r) => S.coef(n, a) - (r === 0 ? M : 0));
    for (let it = 0; it < 80; it++) {
      const F = resid();
      if (Math.max(...F.map(Math.abs)) < 1e-11) break;
      const J = H.map((n) => a.map((aj, j) => S.deriv(n, aj, j)));
      const d = solveLinear(J, F.map((v) => -v));
      if (!d) return null;
      const big = Math.max(...d.map(Math.abs));
      const k = big > 0.15 ? 0.15 / big : 1; // damped step
      for (let j = 0; j < N; j++) a[j] += k * d[j];
    }
    if (Math.max(...resid().map(Math.abs)) > 1e-8) return null;
    for (let j = 0; j < N; j++) {
      const lo = j ? a[j - 1] : 0;
      if (!(a[j] > lo + 1e-4) || !(a[j] < Math.PI / 2 - 1e-4)) return null;
    }
    return a;
  }
  const sheCache = new Map(), sheLast = {};
  function sheSolve(kind, N, M) {
    const key = kind + N + ':' + M.toFixed(3);
    if (sheCache.has(key)) return sheCache.get(key);
    const S = kind === 3 ? SHE3 : SHE2;
    const H = [1, ...nonTriplenOdd(N - 1)];
    let rng = 0x2545f491;
    const rand = () => ((rng = (Math.imul(rng ^ (rng >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
    const guesses = [];
    if (sheLast[kind + N]) guesses.push(sheLast[kind + N]);
    guesses.push(...S.seeds(N));
    guesses.push(Array.from({ length: N }, (_, j) => ((j + 1) * Math.PI) / (2 * (N + 1))));
    for (let t = 0; t < 300; t++) guesses.push(Array.from({ length: N }, () => (rand() * Math.PI) / 2).sort((x, z) => x - z));
    let sol = null;
    for (const g of guesses) { sol = newton(S, H, M, g); if (sol) break; }
    if (sol) sheLast[kind + N] = sol;
    sheCache.set(key, sol);
    return sol;
  }
  function she2Value(x, angles) { // cosine frame
    x = ((x % TWO_PI) + TWO_PI) % TWO_PI;
    if (x > Math.PI) x = TWO_PI - x;
    let sign = 1;
    if (x > Math.PI / 2) { x = Math.PI - x; sign = -1; }
    let k = 0;
    while (k < angles.length && angles[k] <= x) k++;
    return sign * (k % 2 ? -1 : 1);
  }
  function she3Value(x, angles) { // sine frame
    x = ((x % TWO_PI) + TWO_PI) % TWO_PI;
    let sign = 1;
    if (x >= Math.PI) { x -= Math.PI; sign = -1; }
    if (x > Math.PI / 2) x = Math.PI - x;
    let k = 0;
    while (k < angles.length && angles[k] <= x) k++;
    return sign * (k % 2);
  }

  // cancel runs shorter than wmin samples (cyclic), merging them into the preceding run
  function dropShortPulses(arr, wmin) {
    let start = -1;
    for (let i = 0; i < NS; i++) if (arr[i] !== arr[(i + NS - 1) % NS]) { start = i; break; }
    if (start < 0) return 0;
    const runs = [];
    let i = start;
    do {
      const v = arr[i];
      let len = 0;
      while (len < NS && arr[(i + len) % NS] === v) len++;
      runs.push([i, len, v]);
      i = (i + len) % NS;
    } while (i !== start && runs.length < NS);
    let dropped = 0;
    for (let r = 0; r < runs.length; r++) {
      const [s0, len, v] = runs[r];
      const prev = runs[(r - 1 + runs.length) % runs.length][2];
      if (len < wmin && prev !== v) {
        for (let q = 0; q < len; q++) arr[(s0 + q) % NS] = prev;
        runs[r][2] = prev; dropped++;
      }
    }
    return dropped;
  }

  // Direct torque control of the course PMSM at constant speed. Two periods of warm-up, then one period recorded.
  function simulateDTC(p, res) {
    const { Ls, Rs, psim, pp, vdc, fs } = DTC;
    const we = (p.rpm / 60) * TWO_PI * pp, Te = TWO_PI / we, dt = Te / NS, Tc = 1 / fs, Ud = vdc / 2;
    const step = p.tstep === 'step';
    const Tfinal = p.tq, Tstart = step ? 100 : p.tq;
    const B = p.dtb, psr = p.psr, db = p.dpb;
    // start on the flux circle at the steady-state load angle
    const sd = Math.max(-0.99, Math.min(0.99, (Tstart * Ls) / (1.5 * pp * psim * psr)));
    let psa = psr * Math.cos(Math.asin(sd)), psb = psr * Math.sin(Math.asin(sd));
    let s = [1, 0, 0], dpsi = 1, dT = 1, lastCtl = -1;
    for (let n = 0; n < 3 * NS; n++) {
      const t = n * dt, th = we * t, rec = n >= 2 * NS, i = n - 2 * NS;
      const Tref = rec && step && i >= NS / 2 ? Tfinal : Tstart;
      const ia = (psa - psim * Math.cos(th)) / Ls, ib = (psb - psim * Math.sin(th)) / Ls;
      const T = 1.5 * pp * (psa * ib - psb * ia), mag = Math.hypot(psa, psb);
      const ctl = Math.floor(t / Tc);
      if (ctl !== lastCtl) { // sampled hysteresis controllers and switching table
        lastCtl = ctl;
        if (mag < psr - db / 2) dpsi = 1; else if (mag > psr + db / 2) dpsi = 0;
        const e = Tref - T;
        if (dT === 1) { if (e < -B / 2) dT = 0; }
        else if (dT === 0) { if (e > B / 2) dT = 1; else if (e < -B) dT = -1; }
        else if (e > 0) dT = 0;
        const ang = Math.atan2(psb, psa);
        const sector = Math.floor((((ang + Math.PI / 6) % TWO_PI) + TWO_PI) % TWO_PI / (Math.PI / 3)) % 6;
        if (dT === 0) s = s[0] + s[1] + s[2] >= 2 ? [1, 1, 1] : [0, 0, 0];
        else s = VEC[(sector + (dpsi ? 1 : 2) * dT + 12) % 6].slice();
      }
      if (rec) {
        for (let k = 0; k < 3; k++) { sw[k][i] = 2 * s[k] - 1; ref[k][i] = NaN; }
        dtcT[i] = T; dtcTref[i] = Tref; dtcI[i] = ia; psiA[i] = psa; psiB[i] = psb;
      }
      const va = (2 * s[0] - 1) * Ud, vb = (2 * s[1] - 1) * Ud, vc = (2 * s[2] - 1) * Ud;
      const ua = (2 / 3) * (va - 0.5 * vb - 0.5 * vc), ub = (vb - vc) / SQRT3;
      psa += (ua - Rs * ia) * dt; psb += (ub - Rs * ib) * dt;
    }
    // figures for the readout
    let tmin = Infinity, tmax = -Infinity, tsum = 0, fmin = Infinity, fmax = -Infinity, n0 = step ? NS / 2 + Math.round(NS / 8) : 0;
    for (let i = n0; i < NS; i++) {
      tmin = Math.min(tmin, dtcT[i]); tmax = Math.max(tmax, dtcT[i]); tsum += dtcT[i];
      const m = Math.hypot(psiA[i], psiB[i]); fmin = Math.min(fmin, m); fmax = Math.max(fmax, m);
    }
    res.dtc = { Te, Tmean: tsum / (NS - n0), Tpp: tmax - tmin, psiPP: fmax - fmin, f1: 1 / Te, step };
    res.info.push(`One fundamental period at ${p.rpm} rpm (f<sub>1</sub> = ${(1 / Te).toFixed(1)} Hz) after two periods of settling.` +
      (step ? ' The torque reference steps from 100 Nm to the set value halfway through; the figures in the readout are taken after the step.' : '') +
      ' The switching is not synchronised with f<sub>1</sub>, so the spectrum of one period shows a spread (non-characteristic) spectrum.');
  }

  // ---------- compute one period ----------
  function compute(p) {
    const res = { notes: [], info: [], nCars: 0, levels: 2, cellComm: null };
    const phase = [0, -TWO_PI / 3, TWO_PI / 3];
    const M = p.M, topo = p.topo, N = p.cells, Nf = p.fcn, fc = topo === 'fc';
    const mmc = topo === 'mmc', Nm = p.smn, mm = p.mmcmod;
    const threePh = topo !== 'hb';
    res.levels = topo === 'npc' ? 3 : topo === 'chb' ? 2 * N + 1 : fc ? Nf + 1 : mmc ? (mm === 'ps2' ? 2 * Nm + 1 : Nm + 1)
      : topo === 'hb' && p.hbmod === 'uni' ? 3 : 2;
    res.fc = fc; res.mmc = mmc;
    for (let k = 0; k < 3; k++) { ref[k].fill(NaN); }

    if (CARRIER_BASED.has(p.strat)) {
      const twoLevelCarrier = topo === '2l' || topo === 'hb';
      const ctype = twoLevelCarrier ? p.carrier : 'tri';
      let samp = twoLevelCarrier ? p.samp : 'nat';
      if (samp === 'asym' && ctype !== 'tri') {
        samp = 'sym';
        res.info.push('Asymmetrical sampling needs a triangular carrier, so symmetrical sampling is used.');
      }
      const ps = topo === 'chb' && p.arr === 'ps';
      const arr = topo === 'npc' ? (p.arr === 'pod' ? 'pod' : 'pd') : p.arr;
      const K = twoLevelCarrier ? 1 : topo === 'npc' ? 2 : fc ? Nf : mmc ? (mm === 'nlm' ? 0 : mm === 'ps1' ? Nm : 2 * Nm) : ps ? N : 2 * N;
      res.nCars = K; res.ps = ps;
      const cv = new Float64Array(K);
      for (let i = 0; i < NS; i++) {
        const off = twoLevelCarrier ? p.cph / 360 : 0; // carrier phase, in carrier periods
        const u = (p.p * i) / NS + off, fu = u - Math.floor(u);
        if (twoLevelCarrier) cv[0] = carrierAt(ctype, fu);
        else if (fc) for (let j = 0; j < Nf; j++) { const v = u + j / Nf; cv[j] = carrierAt('tri', v - Math.floor(v)); }
        else if (mmc) { // upper-arm carriers 360°/N apart; for 2N + 1 levels the lower arm's set is shifted by a further 180°/N
          for (let j = 0; j < K; j++) { const v = u + (j % Nm) / Nm + (j >= Nm ? 1 / (2 * Nm) : 0); cv[j] = carrierAt('tri', v - Math.floor(v)); }
        }
        else if (ps) for (let j = 0; j < N; j++) { const v = u + j / (2 * N); cv[j] = carrierAt('tri', v - Math.floor(v)); }
        else {
          const t = carrierAt('tri', fu);
          for (let j = 0; j < K; j++) {
            const inv = arr === 'pod' ? j < K / 2 : arr === 'apod' ? j % 2 === 1 : false;
            cv[j] = -1 + (2 * j + 1 + (inv ? -t : t)) / K;
          }
        }
        for (let j = 0; j < K; j++) cars[j][i] = cv[j];
        const th = samp === 'nat' ? (TWO_PI * i) / NS
          : samp === 'sym' ? (TWO_PI * (Math.floor(u) - off)) / p.p
          : (TWO_PI * (Math.floor(2 * u) / 2 - off)) / p.p;

        if (topo === 'hb') {
          const r = M * Math.cos(th);
          ref[0][i] = r;
          const sA = 2 * gt(r, cv[0]) - 1;
          sw[0][i] = sA;
          if (p.hbmod === 'uni') { ref[1][i] = -r; sw[1][i] = 2 * gt(-r, cv[0]) - 1; } else sw[1][i] = -sA;
          sw[2][i] = 0;
          continue;
        }
        const a = M * Math.cos(th + phase[0]), b = M * Math.cos(th + phase[1]), cc = M * Math.cos(th + phase[2]);
        // cosine reference: the injected third harmonic is −(M/6) cos 3θ (flattens the peaks)
        const z = p.strat === 'thi' ? -(M / 6) * Math.cos(3 * th) : zeroSequence(p.strat, a, b, cc, M);
        const rr = [a + z, b + z, cc + z];
        for (let k = 0; k < 3; k++) {
          const r = rr[k];
          ref[k][i] = r;
          if (topo === '2l') sw[k][i] = 2 * gt(r, cv[0]) - 1;
          else if (topo === 'npc') sw[k][i] = -1 + gt(r, cv[0]) + gt(r, cv[1]);
          else if (mmc) { // upper arm inserts ≈ N(1 − v*)/2 submodules, lower arm ≈ N(1 + v*)/2
            let nu = 0, nl = 0;
            if (mm === 'nlm') {
              nl = Math.max(0, Math.min(Nm, Math.round((Nm * (1 + r)) / 2))); nu = Nm - nl;
              for (let j = 0; j < Nm; j++) { cellA[k][j][i] = j < nu ? 1 : 0; cellB[k][j][i] = j < nl ? 1 : 0; }
            } else {
              for (let j = 0; j < Nm; j++) {
                const U = gt(-r, cv[j]), Lw = mm === 'ps1' ? 1 - U : gt(r, cv[Nm + j]);
                cellA[k][j][i] = U; cellB[k][j][i] = Lw; nu += U; nl += Lw;
              }
            }
            sw[k][i] = (nl - nu) / Nm;
          } else if (fc) { // switch pair j (outermost first) follows its own phase-shifted carrier
            let s = 0;
            for (let j = 0; j < Nf; j++) { const A = gt(r, cv[j]); cellA[k][j][i] = A; s += A; }
            sw[k][i] = -1 + (2 * s) / Nf;
          } else {
            let s = 0;
            for (let j = 0; j < N; j++) {
              let A, B;
              if (ps) { A = gt(r, cv[j]); B = gt(-r, cv[j]); }
              else { A = gt(r, cv[N + j]); B = 1 - gt(r, cv[N - 1 - j]); }
              cellA[k][j][i] = A; cellB[k][j][i] = B;
              s += A - B;
            }
            sw[k][i] = s / N;
          }
        }
      }
      if (twoLevelCarrier && p.tmin > 0) { // pulses shorter than tmin (at f1 = 50 Hz) are cancelled
        const wmin = p.tmin * 1e-6 * 50 * NS;
        let dropped = 0;
        for (let k = 0; k < (topo === 'hb' ? 2 : 3); k++) dropped += dropShortPulses(sw[k], wmin);
        res.notes.push(`${dropped} short pulses removed`);
        res.info.push(`Pulses shorter than ${p.tmin} µs (${(p.tmin * 0.018).toFixed(2)}° at f<sub>1</sub> = 50 Hz) are cancelled, as when dead time limits the minimum pulse width. Near the reference peaks this removes whole pulses, so the fundamental no longer follows M linearly.`);
      }
      if (p.cph && twoLevelCarrier) res.info.push(`The carrier is shifted by ${p.cph}° of a carrier period. With a sawtooth carrier and low p the fundamental depends on this phase (see Ratio to linear value).`);
      if (p.strat === 'dpwm1' && samp === 'nat')
        res.info.push('With natural sampling the clamp transitions fall inside carrier periods, so parts of pulses are lost and the fundamental drops. Regular sampling avoids this.');
      if (M > LINEAR_LIMIT[p.strat] + 1e-9) {
        res.notes.push(`Overmodulation: M > ${LINEAR_LIMIT[p.strat].toFixed(3)}`);
        res.info.push(`M is above the linear limit (${LINEAR_LIMIT[p.strat].toFixed(3)}): pulses are dropped near the peaks and low-order harmonics appear.`);
      }
      if (fc) res.info.push(`The switch pairs' carriers are shifted by ${(360 / Nf).toFixed(0)}°, so each pair switches equally and the flying capacitors stay balanced on average (their voltages are assumed constant). The first harmonic group of v_az is at h = ${Nf}p = ${Nf * p.p}.`);
      if (mmc && mm === 'nlm') res.info.push(`Nearest level modulation: each arm inserts the whole number of submodules closest to N(1 ∓ v*)/2. No carrier is used, so p has no effect; v_az is a staircase with N + 1 = ${Nm + 1} levels. A real converter picks which submodules to insert by sorting the capacitor voltages; here they are taken in a fixed order.`);
      if (mmc && mm === 'ps1') res.info.push(`Phase-shifted carriers 360°/N apart, one per submodule. The lower arm is the complement of the upper, so N submodules are inserted per leg at all times and v_az has N + 1 = ${Nm + 1} levels. The first harmonic group of v_az is at h = Np = ${Nm * p.p}.`);
      if (mmc && mm === 'ps2') res.info.push(`The lower-arm carriers are shifted a further 180°/N against the upper arm. The number of inserted submodules per leg then varies between N − 1 and N + 1 (the arm inductors take the difference), and v_az has 2N + 1 = ${2 * Nm + 1} levels.`);
      if (ps) res.info.push(`Each cell's carrier is shifted by ${(180 / N).toFixed(0)}°. Cell harmonics cancel below h = 2Np = ${2 * N * p.p}.`);
      if (topo === 'hb' && p.hbmod === 'uni') res.info.push('In v_ab the harmonic groups around odd multiples of p cancel; the first group is around 2p.');
    } else if (p.strat === 'dtc') {
      simulateDTC(p, res);
    } else if (p.strat === 'sixstep') {
      for (let i = 0; i < NS; i++) {
        const th = (TWO_PI * i) / NS;
        for (let k = 0; k < 3; k++) {
          const v = Math.cos(th + phase[k]);
          ref[k][i] = (4 / Math.PI) * v;
          sw[k][i] = v >= 0 ? 1 : -1;
        }
      }
    } else { // she, two- or three-level
      const kind = topo === 'npc' ? 3 : 2;
      const angles = sheSolve(kind, p.nshe, M);
      res.angles = angles;
      if (!angles) {
        res.notes.push(`No solution at M = ${M.toFixed(2)}`);
        res.info.push(`No switching angles were found for M = ${M.toFixed(2)} with ${p.nshe} angles. Try a smaller M.`);
        for (let k = 0; k < 3; k++) { sw[k].fill(0); ref[k].fill(0); }
        res.failed = true;
        return res;
      }
      for (let i = 0; i < NS; i++) {
        const th = (TWO_PI * i) / NS;
        for (let k = 0; k < 3; k++) {
          ref[k][i] = M * Math.cos(th + phase[k]);
          sw[k][i] = kind === 3 ? she3Value(th + phase[k] + Math.PI / 2, angles) : she2Value(th + phase[k], angles);
        }
      }
      res.eliminated = nonTriplenOdd(p.nshe - 1);
    }

    // selected output
    for (let i = 0; i < NS; i++) {
      const a = sw[0][i], b = sw[1][i], c = sw[2][i];
      if (!threePh) y[i] = p.out === 'vaz' ? a : a - b;
      else y[i] = p.out === 'vaz' ? a : p.out === 'vab' ? a - b : a - (a + b + c) / 3;
    }
    if (p.out === 'ia' && res.dtc) y.set(dtcI);
    else if (p.out === 'ia') {
      // i = v / Z(h), Z(h) = cos φ + j h sin φ (|Z| = 1 at the fundamental)
      re.set(y); im.fill(0);
      fft.forward(re, im);
      const cphi = Math.cos((p.phi * Math.PI) / 180), sphi = Math.sin((p.phi * Math.PI) / 180);
      re[0] = 0; im[0] = 0;
      for (let h = 1; h <= NS / 2; h++) {
        const zr = cphi, zi = h * sphi, d = zr * zr + zi * zi;
        for (const [idx, s] of [[h, 1], [NS - h, -1]]) {
          if (h === NS / 2 && s === -1) continue;
          const xr = re[idx], xi = im[idx], zii = s * zi;
          re[idx] = (xr * zr + xi * zii) / d;
          im[idx] = (xi * zr - xr * zii) / d;
        }
      }
      fft.inverse(re, im);
      y.set(re);
    }

    // spectrum of the selected output
    re.set(y); im.fill(0);
    fft.forward(re, im);
    for (let h = 0; h <= NS / 2; h++) amp[h] = ((h === 0 || h === NS / 2 ? 1 : 2) * Math.hypot(re[h], im[h])) / NS;
    const r1 = re[1], i1 = im[1];
    for (let i = 0; i < NS; i++) {
      const th = (TWO_PI * i) / NS;
      fund[i] = (2 / NS) * (r1 * Math.cos(th) - i1 * Math.sin(th));
    }

    // figures of merit
    let s2 = 0, w2 = 0;
    for (let h = 2; h <= NS / 2; h++) { s2 += amp[h] * amp[h]; w2 += (amp[h] / h) ** 2; }
    res.V1 = amp[1];
    res.thd = Math.sqrt(s2) / amp[1];
    const base = p.out === 'vab' ? (threePh ? SQRT3 : 2) : 1;
    res.wthd0 = Math.sqrt(w2) / base;
    res.wthd = Math.sqrt(w2) / amp[1];
    const transitions = (arr) => { let n = 0; for (let i = 0; i < NS; i++) if (arr[i] !== arr[(i + NS - 1) % NS]) n++; return n; };
    res.commutations = transitions(sw[0]);
    if (res.dtc) res.dtc.fsw = res.commutations / 2 / res.dtc.Te;
    if (mmc && CARRIER_BASED.has(p.strat)) res.cellComm = Array.from({ length: Nm }, (_, j) => transitions(cellA[0][j]));
    if (fc && CARRIER_BASED.has(p.strat)) res.cellComm = Array.from({ length: Nf }, (_, j) => transitions(cellA[0][j]));
    if (topo === 'chb' && CARRIER_BASED.has(p.strat)) res.cellComm = Array.from({ length: N }, (_, j) => transitions(cellA[0][j]) + transitions(cellB[0][j]));

    // space vectors: v_αβ = 2/3 (v_a + a v_b + a² v_c), flux = ∫ v dθ
    if (threePh) {
      const dw = new Map();
      let pa = 0, pb = 0, ma = 0, mb = 0;
      const dth = TWO_PI / NS;
      for (let i = 0; i < NS; i++) {
        const a = sw[0][i], b = sw[1][i], c = sw[2][i];
        const va = (2 / 3) * (a - 0.5 * b - 0.5 * c), vb = (b - c) / SQRT3;
        pa += va * dth; pb += vb * dth;
        if (!res.dtc) { psiA[i] = pa; psiB[i] = pb; } ma += pa; mb += pb;
        const key = Math.round(va * 1e4) + ',' + Math.round(vb * 1e4);
        const e = dw.get(key);
        if (e) e.d += 1 / NS; else dw.set(key, { va, vb, d: 1 / NS });
      }
      res.dwell = [...dw.values()];
      ma /= NS; mb /= NS;
      if (!res.dtc) for (let i = 0; i < NS; i++) { psiA[i] -= ma; psiB[i] -= mb; }
      let cr = 0, ci = 0;
      for (let i = 0; i < NS; i++) {
        const a = sw[0][i], v = a - (a + sw[1][i] + sw[2][i]) / 3, th = (TWO_PI * i) / NS;
        cr += v * Math.cos(th); ci += v * Math.sin(th);
      }
      res.V1an = (2 / NS) * Math.hypot(cr, ci);
    }

    if (threePh && p.out !== 'vaz' && CARRIER_BASED.has(p.strat))
      res.info.push('Harmonics common to all three phases (carrier harmonics and sidebands with offset a multiple of 3) cancel in line quantities.');
    return res;
  }

  // ---------- drawing helpers ----------
  // Plot colours come from the theme tokens. A probe element resolves var()/calc()/oklch() to a usable colour.
  const colors = {};
  const TOKEN_MAP = {
    text: '--text', muted: '--text-3', border: '--border-2', surface: '--surface', bg: '--surface-2',
    'c-signal': '--series-1', 'c-message': '--series-2', 'c-aux': '--series-3', 'c-third': '--series-7',
    'c-carrier': '--text-faint', 'c-grid': '--border',
  };
  function tokenColor(name) {
    const i = document.createElement('i');
    i.style.display = 'none'; i.style.color = `var(${name})`;
    document.body.appendChild(i);
    const c = getComputedStyle(i).color;
    i.remove();
    return c;
  }
  let FONT = 'system-ui, sans-serif';
  function readColors() {
    for (const [k, t] of Object.entries(TOKEN_MAP)) colors[k] = tokenColor(t);
    FONT = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || FONT;
  }
  const font = (size, weight) => `${weight ? weight + ' ' : ''}${size}px ${FONT}`;
  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.font = font(11);
    return { ctx, w: r.width, h: r.height };
  }
  function niceStep(range, count) {
    const raw = range / count, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }
  function niceCeil(v) {
    for (const c of [0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= c) return c;
    return Math.ceil(v);
  }
  function axes(ctx, box, x0, x1, y0, y1, o = {}) {
    ctx.save();
    ctx.strokeStyle = colors['c-grid']; ctx.fillStyle = colors.muted; ctx.lineWidth = 1;
    const xs = o.xStep || niceStep(x1 - x0, Math.max(2, box.w / 80));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = Math.ceil(x0 / xs - 1e-9) * xs; x <= x1 + 1e-9; x += xs) {
      const px = Math.round(box.x + ((x - x0) / (x1 - x0)) * box.w) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, box.y); ctx.lineTo(px, box.y + box.h); ctx.stroke();
      if (o.xLabels !== false && px < box.x + box.w - 100) ctx.fillText(o.xFmt ? o.xFmt(x) : String(+x.toFixed(6)), px, box.y + box.h + 5);
    }
    const ys = o.yStep || niceStep(y1 - y0, Math.max(2, box.h / 36));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(y0 / ys - 1e-9) * ys; v <= y1 + 1e-9; v += ys) {
      const py = Math.round(box.y + box.h - ((v - y0) / (y1 - y0)) * box.h) + 0.5;
      ctx.beginPath(); ctx.moveTo(box.x, py); ctx.lineTo(box.x + box.w, py); ctx.stroke();
      ctx.fillText(o.yFmt ? o.yFmt(v, ys) : String(+v.toFixed(3)), box.x - 6, py);
    }
    ctx.strokeStyle = colors.border;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.restore();
  }
  function trace(ctx, box, arr, i0, i1, y0, y1, color, width, dash) {
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    const n = i1 - i0;
    for (let i = i0; i <= i1; i++) {
      const v = arr[i % NS];
      if (Number.isNaN(v)) { pen = false; continue; }
      const px = box.x + ((i - i0) / n) * box.w, py = box.y + box.h - ((v - y0) / (y1 - y0)) * box.h;
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke();
    ctx.restore();
  }
  // Title plus legend on a backing box so traces never hide it
  function header(ctx, box, title, items) {
    ctx.save();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = font(12, 600);
    const tw = ctx.measureText(title).width;
    ctx.font = font(11);
    let width = tw + 12;
    for (const [label] of items) width += 28 + ctx.measureText(label).width;
    const x0 = box.x + 4, y0 = box.y + 4, yy = y0 + 10;
    ctx.fillStyle = colors.surface; ctx.globalAlpha = 0.92;
    ctx.fillRect(x0, y0, Math.min(width + 4, box.w - 8), 20);
    ctx.globalAlpha = 1;
    ctx.font = font(12, 600); ctx.fillStyle = colors.text;
    ctx.fillText(title, x0 + 6, yy);
    ctx.font = font(11);
    let x = x0 + tw + 18;
    for (const [label, color, dash] of items) {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 16, yy); ctx.stroke();
      ctx.fillStyle = colors.muted; ctx.fillText(label, x + 20, yy);
      x += 28 + ctx.measureText(label).width;
    }
    ctx.restore();
  }
  const cursorIndex = (p) => Math.round(((p.cur % 360) / 360) * NS) % NS;

  // ---------- plots ----------
  const TIME_L = 44, TIME_R = 12;
  function drawTime(p, res) {
    const { ctx, w, h } = prep($('timeCanvas'));
    const T = 8, B = 24, G = 18;
    const avail = h - T - B - G;
    const top = { x: TIME_L, y: T, w: w - TIME_L - TIME_R, h: Math.round(avail * 0.42) };
    const bot = { x: TIME_L, y: top.y + top.h + G, w: w - TIME_L - TIME_R, h: avail - top.h };
    const i1 = Math.round((NS * p.view) / 360);
    const degStep = p.view === 360 ? 60 : p.view === 180 ? 30 : 15;
    const xFmt = (x) => x + '°';
    const threePh = p.topo !== 'hb';

    if (res.dtc) drawTorque(ctx, top, p, i1, degStep);
    else {
    // top: carriers and references
    let rmax = 1;
    for (let k = 0; k < 3; k++) for (let i = 0; i < NS; i += 8) if (!Number.isNaN(ref[k][i])) rmax = Math.max(rmax, Math.abs(ref[k][i]));
    const ry = Math.max(1.25, niceCeil(rmax * 1.08));
    axes(ctx, top, 0, p.view, -ry, ry, { xStep: degStep, xLabels: false, yStep: ry > 1.5 ? 1 : 0.5 });
    const carrierShown = CARRIER_BASED.has(p.strat);
    if (res.nCars) for (let j = 0; j < res.nCars; j++) trace(ctx, top, cars[j], 0, i1, -ry, ry, colors['c-carrier'], 1);
    const tItems = [[threePh ? 'v*a' : 'v*', colors['c-message']]];
    if (threePh && allPhases) {
      trace(ctx, top, ref[1], 0, i1, -ry, ry, colors['c-aux'], 1.6);
      trace(ctx, top, ref[2], 0, i1, -ry, ry, colors['c-third'], 1.6);
      tItems.push(['v*b', colors['c-aux']], ['v*c', colors['c-third']]);
    }
    if (!threePh && p.hbmod === 'uni') { trace(ctx, top, ref[1], 0, i1, -ry, ry, colors['c-aux'], 1.6); tItems.push(['−v*', colors['c-aux']]); }
    trace(ctx, top, ref[0], 0, i1, -ry, ry, colors['c-message'], 1.8, carrierShown ? null : [6, 4]);
    if (res.nCars) tItems.push([res.nCars > 1 ? 'carriers' : 'carrier', colors['c-carrier']]);
    header(ctx, top, !carrierShown ? 'Fundamental reference' : res.nCars ? 'Reference and carrier' : 'Reference', tItems);
    }

    // bottom: output
    let ymax;
    if (p.out === 'ia') { let m = 0; for (let i = 0; i < NS; i++) m = Math.max(m, Math.abs(y[i])); ymax = niceCeil(m * 1.15 || 1); }
    else ymax = { vaz: 1.25, vab: 2.5, van: 1.5 }[p.out];
    axes(ctx, bot, 0, p.view, -ymax, ymax, { xStep: degStep, xFmt, yStep: p.out === 'ia' ? undefined : ymax > 2 ? 1 : 0.5 });
    trace(ctx, bot, y, 0, i1, -ymax, ymax, colors['c-signal'], p.out === 'ia' ? 1.6 : 1.1);
    trace(ctx, bot, fund, 0, i1, -ymax, ymax, colors['c-message'], 1.6, [6, 4]);
    header(ctx, bot, OUT_LABEL[p.out] + (p.out === 'ia' ? (res.dtc ? ' (A)' : ' (pu)') : ' / Vdc'), [[OUT_LABEL[p.out], colors['c-signal']], ['fundamental', colors['c-message'], [6, 4]]]);
    ctx.fillStyle = colors.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('ω₁t', bot.x + bot.w, h - 1);

    // time cursor
    if (p.cur <= p.view) {
      const x = Math.round(TIME_L + (p.cur / p.view) * top.w) + 0.5;
      ctx.save();
      ctx.strokeStyle = colors.text; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, top.y); ctx.lineTo(x, top.y + top.h); ctx.moveTo(x, bot.y); ctx.lineTo(x, bot.y + bot.h); ctx.stroke();
      ctx.restore();
    }
  }

  function drawTorque(ctx, box, p, i1, degStep) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < NS; i++) { lo = Math.min(lo, dtcT[i], dtcTref[i] - p.dtb); hi = Math.max(hi, dtcT[i], dtcTref[i] + p.dtb); }
    const pad = Math.max(10, 0.08 * (hi - lo));
    const st = niceStep(hi - lo + 2 * pad, 4), y0 = Math.floor((lo - pad) / st) * st, y1 = Math.ceil((hi + pad) / st) * st;
    axes(ctx, box, 0, p.view, y0, y1, { xStep: degStep, xLabels: false, yStep: st, yFmt: (v) => v.toFixed(0) });
    const band = (sgn) => { const a = new Float64Array(NS); for (let i = 0; i < NS; i++) a[i] = dtcTref[i] + (sgn * p.dtb) / 2; return a; };
    trace(ctx, box, band(1), 0, i1, y0, y1, colors['c-carrier'], 1, [2, 3]);
    trace(ctx, box, band(-1), 0, i1, y0, y1, colors['c-carrier'], 1, [2, 3]);
    trace(ctx, box, dtcTref, 0, i1, y0, y1, colors['c-message'], 1.6, [6, 4]);
    trace(ctx, box, dtcT, 0, i1, y0, y1, colors['c-signal'], 1.2);
    header(ctx, box, 'Torque (Nm)', [['T', colors['c-signal']], ['T*', colors['c-message'], [6, 4]], ['band', colors['c-carrier'], [2, 3]]]);
  }

  function hmaxFor(p, res) {
    if (p.hmax !== 'auto') return parseInt(p.hmax, 10);
    if (res.dtc) return 200;
    if (!CARRIER_BASED.has(p.strat)) return 50;
    if (res.mmc && p.mmcmod === 'nlm') return 50;
    const target = res.ps ? 2 * p.cells * p.p + 2 * p.p : res.fc ? p.fcn * p.p + 2 * p.p
      : res.mmc ? (p.mmcmod === 'ps2' ? 2 : 1) * p.smn * p.p + 2 * p.p : 3 * p.p;
    return Math.min(200, Math.max(40, Math.ceil((target + 8) / 10) * 10));
  }

  function drawSpectrum(p, res) {
    const { ctx, w, h } = prep($('specCanvas'));
    const L = 46, R = 12, T = 8, B = 24;
    const box = { x: L, y: T, w: w - L - R, h: h - T - B };
    const Hm = hmaxFor(p, res);
    let vmax = 0;
    for (let k = 1; k <= Hm; k++) vmax = Math.max(vmax, amp[k]);
    const y0 = dbScale ? -60 : 0, y1 = dbScale ? 10 : niceCeil(vmax * 1.08 || 1);
    const val = (k) => (dbScale ? 20 * Math.log10(Math.max(amp[k], 1e-6)) : amp[k]);
    axes(ctx, box, 0, Hm + 1, y0, y1, {
      xStep: niceStep(Hm, Math.max(2, box.w / 60)),
      yStep: dbScale ? 10 : undefined,
      yFmt: (v, st) => (dbScale ? v.toFixed(0) : v.toFixed(st < 0.1 ? 2 : 1)),
    });
    const X = (k) => box.x + (k / (Hm + 1)) * box.w;
    const Y = (v) => box.y + box.h - ((Math.max(v, y0) - y0) / (y1 - y0)) * box.h;
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();

    // carrier multiples
    if (res.nCars) {
      ctx.strokeStyle = colors['c-carrier']; ctx.fillStyle = colors.muted; ctx.setLineDash([3, 3]);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const showLabels = X(p.p) - X(0) > 16;
      for (let m = 1; m * p.p <= Hm; m++) {
        const x = Math.round(X(m * p.p)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, box.y + 22); ctx.lineTo(x, box.y + box.h); ctx.stroke();
        if (showLabels) ctx.fillText((m === 1 ? '' : m) + 'p', x, box.y + 21);
      }
      ctx.setLineDash([]);
    }
    // eliminated harmonics (SHE)
    if (res.eliminated) {
      ctx.fillStyle = colors['c-message']; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (const n of res.eliminated) if (n <= Hm) ctx.fillText('×', X(n), Y(y0) - 2);
    }
    // bars
    const bw = Math.max(1.5, Math.min(7, (box.w / (Hm + 1)) * 0.6));
    for (let k = 1; k <= Hm; k++) {
      const v = val(k);
      if (!dbScale && amp[k] < 1e-4) continue;
      const x = X(k), yy = Y(v);
      ctx.fillStyle = k === 1 ? colors['c-message'] : colors['c-signal'];
      ctx.fillRect(x - bw / 2, yy, bw, box.y + box.h - yy);
    }
    // hover
    if (hoverX !== null && hoverX >= box.x && hoverX <= box.x + box.w) {
      const k = Math.max(1, Math.min(Hm, Math.round(((hoverX - box.x) / box.w) * (Hm + 1))));
      const x = X(k);
      ctx.strokeStyle = colors.text; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, box.y); ctx.lineTo(Math.round(x) + 0.5, box.y + box.h); ctx.stroke();
      ctx.globalAlpha = 1;
      const pct = res.V1 > 1e-9 ? ` (${((100 * amp[k]) / res.V1).toFixed(1)} % of h=1)` : '';
      const label = `h = ${k}:  ${amp[k].toFixed(4)}${dbScale ? ' = ' + val(k).toFixed(1) + ' dB' : ''}${k > 1 ? pct : ''}`;
      const tw = ctx.measureText(label).width + 12;
      const lx = x + 8 + tw > box.x + box.w ? x - 8 - tw : x + 8;
      ctx.fillStyle = colors.surface; ctx.strokeStyle = colors.border;
      ctx.fillRect(lx, box.y + 28, tw, 20); ctx.strokeRect(lx + 0.5, box.y + 28.5, tw - 1, 19);
      ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 6, box.y + 38);
    }
    ctx.restore();
    ctx.fillStyle = colors.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('harmonic order h', box.x + box.w, h - 1);
    ctx.save();
    ctx.translate(11, box.y + box.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(dbScale ? 'dB re Vdc' : (p.out === 'ia' ? (res.dtc ? 'amplitude (A)' : 'amplitude (pu)') : 'amplitude / Vdc'), 0, 0);
    ctx.restore();
  }

  const alphaBeta = (a, b, c) => [(2 / 3) * (a - 0.5 * b - 0.5 * c), (b - c) / SQRT3];
  function drawSpaceVectors(p, res) {
    if (p.topo === 'hb' || !res.dwell) return;
    const { ctx, w, h } = prep($('svCanvas'));
    const gap = 16, size = Math.min(h - 10, (w - gap) / 2);
    if (size < 60) return; // not laid out (hidden tab or tiny window)
    const boxes = [
      { x: (w - 2 * size - gap) / 2, y: (h - size) / 2, s: size },
      { x: (w - 2 * size - gap) / 2 + size + gap, y: (h - size) / 2, s: size },
    ];
    for (const b of boxes) {
      ctx.fillStyle = colors.bg; ctx.fillRect(b.x, b.y, b.s, b.s);
      ctx.strokeStyle = colors.border; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.s - 1, b.s - 1);
    }
    const plotIn = (b, R) => ({
      X: (v) => b.x + b.s / 2 + (v / R) * (b.s / 2 - 14),
      Y: (v) => b.y + b.s / 2 - (v / R) * (b.s / 2 - 14),
      k: (b.s / 2 - 14) / R,
    });
    const axesCross = (b) => {
      ctx.strokeStyle = colors['c-grid']; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x + 8, b.y + b.s / 2 + 0.5); ctx.lineTo(b.x + b.s - 8, b.y + b.s / 2 + 0.5);
      ctx.moveTo(b.x + b.s / 2 + 0.5, b.y + 8); ctx.lineTo(b.x + b.s / 2 + 0.5, b.y + b.s - 8);
      ctx.stroke();
    };
    const ic = cursorIndex(p);

    // left: voltage vectors
    const b0 = boxes[0], P0 = plotIn(b0, 1.85);
    axesCross(b0);
    ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = (4 / 3) * Math.cos((k * Math.PI) / 3), b = (4 / 3) * Math.sin((k * Math.PI) / 3);
      if (k) ctx.lineTo(P0.X(a), P0.Y(b)); else ctx.moveTo(P0.X(a), P0.Y(b));
    }
    ctx.stroke();
    // all available vectors of an L-level converter
    const L = res.levels, lv = Array.from({ length: L }, (_, i) => -1 + (2 * i) / (L - 1));
    ctx.fillStyle = colors.muted;
    const seen = new Set();
    for (const a of lv) for (const b of lv) for (const c of lv) {
      const [va, vb] = alphaBeta(a, b, c), key = Math.round(va * 1e3) + ',' + Math.round(vb * 1e3);
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.beginPath(); ctx.arc(P0.X(va), P0.Y(vb), 1.6, 0, TWO_PI); ctx.fill();
    }
    ctx.setLineDash([2, 3]); ctx.strokeStyle = colors['c-carrier'];
    ctx.beginPath(); ctx.arc(P0.X(0), P0.Y(0), (2 / SQRT3) * P0.k, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([6, 4]); ctx.strokeStyle = colors['c-message']; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(P0.X(0), P0.Y(0), res.V1an * P0.k, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([]);
    // dot area ∝ dwell time
    const rScale = L > 2 ? 14 : 22;
    for (const { va, vb, d } of res.dwell) {
      const r = 2.5 + Math.sqrt(d) * rScale;
      ctx.fillStyle = colors['c-signal']; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(P0.X(va), P0.Y(vb), r, 0, TWO_PI); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (L === 2 && b0.s > 170) {
      ctx.font = font(10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.muted;
      for (const [a, b, c] of [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]]) {
        const [va, vb] = alphaBeta(2 * a - 1, 2 * b - 1, 2 * c - 1);
        ctx.fillText(`${a}${b}${c}`, P0.X(va * 1.3), P0.Y(vb * 1.3));
      }
      ctx.fillText('000/111', P0.X(0), P0.Y(0) + 16);
    }
    // vector at the time cursor
    const [ca, cb] = alphaBeta(sw[0][ic], sw[1][ic], sw[2][ic]);
    ctx.strokeStyle = colors['c-message']; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P0.X(0), P0.Y(0)); ctx.lineTo(P0.X(ca), P0.Y(cb)); ctx.stroke();
    ctx.beginPath(); ctx.arc(P0.X(ca), P0.Y(cb), 6, 0, TWO_PI); ctx.stroke();
    ctx.font = font(11);
    header(ctx, { x: b0.x, y: b0.y, w: b0.s }, 'Voltage vectors', []);

    // right: flux
    const b1 = boxes[1];
    let R = 0.2;
    for (let i = 0; i < NS; i += 4) R = Math.max(R, Math.hypot(psiA[i], psiB[i]));
    const P1 = plotIn(b1, R * 1.1);
    axesCross(b1);
    if (res.dtc) { // hysteresis band and the six sectors
      ctx.strokeStyle = colors['c-grid']; ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        ctx.beginPath(); ctx.moveTo(P1.X(0), P1.Y(0)); ctx.lineTo(P1.X(R * 1.05 * Math.cos(a)), P1.Y(R * 1.05 * Math.sin(a))); ctx.stroke();
      }
      ctx.setLineDash([2, 3]); ctx.strokeStyle = colors['c-message']; ctx.lineWidth = 1.2;
      for (const r of [p.psr - p.dpb / 2, p.psr + p.dpb / 2]) { ctx.beginPath(); ctx.arc(P1.X(0), P1.Y(0), r * P1.k, 0, TWO_PI); ctx.stroke(); }
    } else {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = colors['c-message']; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(P1.X(0), P1.Y(0), res.V1an * P1.k, 0, TWO_PI); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = colors['c-signal']; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= NS; i += 2) {
      const j = i % NS;
      if (i) ctx.lineTo(P1.X(psiA[j]), P1.Y(psiB[j])); else ctx.moveTo(P1.X(psiA[j]), P1.Y(psiB[j]));
    }
    ctx.stroke();
    ctx.fillStyle = colors['c-message'];
    ctx.beginPath(); ctx.arc(P1.X(psiA[ic]), P1.Y(psiB[ic]), 4, 0, TWO_PI); ctx.fill();
    header(ctx, { x: b1.x, y: b1.y, w: b1.s }, res.dtc ? 'Stator flux ψ (Vs)' : 'Stator flux ψ', []);

    ctx.fillStyle = colors.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = font(10);
    ctx.fillText(res.dtc ? 'dotted: flux band ψ* ± Δψ/2' : 'dashed: fundamental', b1.x + 6, b1.y + b1.s - 4);
    ctx.fillText('dot size: dwell time', b0.x + 6, b0.y + b0.s - 4);
  }

  // ---------- circuit schematic (SVG) ----------
  const W = (x1, y1, x2, y2, c = 'sch-w') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${c}"/>`;
  const DOT = (x, y) => `<circle cx="${x}" cy="${y}" r="2.6" class="sch-dot"/>`;
  const TX = (x, y, s, c = 'sch-t', a = 'middle') => `<text x="${x}" y="${y}" class="${c}" text-anchor="${a}">${s}</text>`;
  function SW(x, y1, y2, on, label, side = -1) { // ideal switch on a vertical branch y1 < y2
    const hgt = y2 - y1, a = y1 + hgt * 0.3, b = y2 - hgt * 0.3;
    let s = W(x, y1, x, a) + W(x, b, x, y2);
    s += on ? W(x, b, x, a, 'sch-on') : W(x, b, x + side * -0.5 * (b - a), a + 0.12 * (b - a), 'sch-off');
    s += `<circle cx="${x}" cy="${a}" r="2.2" class="sch-c"/><circle cx="${x}" cy="${b}" r="2.2" class="sch-c"/>`;
    if (label) s += TX(x + side * 9, (a + b) / 2 + 4, label, 'sch-s', side < 0 ? 'end' : 'start');
    return s;
  }
  function CAP(x, y1, y2) {
    const m = (y1 + y2) / 2;
    return W(x, y1, x, m - 4) + W(x, m + 4, x, y2) + W(x - 11, m - 4, x + 11, m - 4, 'sch-p') + W(x - 11, m + 4, x + 11, m + 4, 'sch-p');
  }
  function DIODE(x, yTop, yBot) { // conducts upwards: anode at yBot, cathode at yTop
    const m = (yTop + yBot) / 2;
    return W(x, yTop, x, m - 6) + W(x, m + 6, x, yBot) + `<path d="M${x - 7} ${m + 6} L${x + 7} ${m + 6} L${x} ${m - 6} Z" class="sch-d"/>` + W(x - 7, m - 6, x + 7, m - 6, 'sch-p');
  }
  function COIL(x, yy, len) {
    const n = 4, step = len / n;
    let d = `M${x} ${yy}`;
    for (let i = 0; i < n; i++) d += ` a${step / 2} ${step / 2} 0 0 1 ${step} 0`;
    return `<path d="${d}" class="sch-w"/>`;
  }
  function COILV(x, y0, len) { // vertical inductor from y0 down to y0+len
    const n = 4, step = len / n;
    let d = `M${x} ${y0}`;
    for (let i = 0; i < n; i++) d += ` a${step / 2} ${step / 2} 0 0 1 0 ${step}`;
    return `<path d="${d}" class="sch-w"/>`;
  }
  function RL(x, yy) { // resistor + inductor from x to x+76
    return `<rect x="${x}" y="${yy - 5}" width="26" height="10" class="sch-r"/>` + W(x + 26, yy, x + 36, yy) + COIL(x + 36, yy, 40);
  }
  function LOAD3(x, ys) { // star-connected R-L load with terminals a, b, c at x
    let s = '';
    const xn = x + 110;
    ['a', 'b', 'c'].forEach((n, k) => {
      const yy = ys[k];
      s += TX(x - 6, yy + 4, n, 'sch-l', 'end') + DOT(x, yy) + W(x, yy, x + 12, yy) + RL(x + 12, yy) + W(x + 88, yy, xn, yy);
    });
    s += W(xn, ys[0], xn, ys[2]) + DOT(xn, ys[1]) + TX(xn + 6, ys[1] + 4, 'n', 'sch-l', 'start');
    s += TX(x + 50, ys[0] - 14, 'R-L load', 'sch-s');
    return s;
  }
  function DCLINK(x, yTop, yBot) {
    const m = (yTop + yBot) / 2;
    return CAP(x, yTop, m) + CAP(x, m, yBot) + DOT(x, m) + TX(x - 8, m + 4, 'z', 'sch-l', 'end') +
      TX(x + 16, (yTop + m) / 2 + 4, 'V<tspan class="sch-sub" dy="3">dc</tspan>', 'sch-t', 'start') +
      TX(x + 16, (m + yBot) / 2 + 4, 'V<tspan class="sch-sub" dy="3">dc</tspan>', 'sch-t', 'start') +
      TX(x, yTop - 8, '+', 'sch-l') + TX(x, yBot + 16, '−', 'sch-l');
  }
  function fmtLevel(v, N) {
    if (Math.abs(v) < 1e-9) return '0';
    const sgn = v > 0 ? '+' : '−', a = Math.abs(v);
    if (Math.abs(a - 1) < 1e-9) return sgn + 'V<sub>dc</sub>';
    if (Math.abs(a - 2) < 1e-9) return sgn + '2V<sub>dc</sub>';
    let n = Math.round(a * N), d = N;
    for (let g = n; g > 1; g--) if (n % g === 0 && d % g === 0) { n /= g; d /= g; break; }
    return d === 1 ? `${sgn}${n}V<sub>dc</sub>` : `${sgn}${n === 1 ? '' : n}V<sub>dc</sub>/${d}`;
  }
  const fmtSvg = (s) => s.replace(/<sub>(.*?)<\/sub>(.*)$/, '<tspan class="sch-sub" dy="3">$1</tspan><tspan dy="-3">$2</tspan>');

  function drawCircuit(p, res) {
    const ic = cursorIndex(p), topo = p.topo, N = p.cells;
    const lvl = [sw[0][ic], sw[1][ic], sw[2][ic]];
    let svg = '', vb = '0 0 640 300', status = '';
    if (topo === '2l') {
      svg += DCLINK(40, 40, 260) + W(40, 40, 330, 40) + W(40, 260, 330, 260);
      ['a', 'b', 'c'].forEach((n, k) => {
        const x = 130 + 100 * k, on = lvl[k] > 0;
        svg += DOT(x, 40) + DOT(x, 260) + SW(x, 40, 150, on, k ? '' : 'S<tspan class="sch-sub" dy="3">a+</tspan>') + SW(x, 150, 260, !on, k ? '' : 'S<tspan class="sch-sub" dy="3">a−</tspan>');
        svg += DOT(x, 150) + W(x, 150, x + 26, 150) + TX(x + 31, 154, n, 'sch-l', 'start') + TX(x + 31, 172, fmtSvg(fmtLevel(lvl[k], 1)), 'sch-v', 'start');
      });
      svg += LOAD3(460, [110, 150, 190]);
      const bits = lvl.map((v) => (v > 0 ? 1 : 0)).join('');
      status = `Switching state ${bits}: v<sub>az</sub> = ${fmtLevel(lvl[0], 1)}, v<sub>bz</sub> = ${fmtLevel(lvl[1], 1)}, v<sub>cz</sub> = ${fmtLevel(lvl[2], 1)}`;
    } else if (topo === 'hb') {
      svg += DCLINK(60, 40, 260) + W(60, 40, 440, 40) + W(60, 260, 440, 260);
      [['a', 220], ['b', 440]].forEach(([n, x], k) => {
        const on = lvl[k] > 0;
        svg += DOT(x, 40) + DOT(x, 260) + SW(x, 40, 150, on) + SW(x, 150, 260, !on) + DOT(x, 150);
        svg += TX(x + 10, 140, n, 'sch-l', 'start') + TX(x + 10, 178, fmtSvg(fmtLevel(lvl[k], 1)), 'sch-v', 'start');
      });
      svg += W(220, 150, 290, 150) + RL(290, 150) + W(366, 150, 440, 150) + TX(330, 132, 'R-L load', 'sch-s');
      status = `v<sub>az</sub> = ${fmtLevel(lvl[0], 1)}, v<sub>bz</sub> = ${fmtLevel(lvl[1], 1)}, load voltage v<sub>ab</sub> = ${fmtLevel(lvl[0] - lvl[1], 1)}`;
    } else if (topo === 'npc') {
      vb = '0 0 640 320';
      svg += DCLINK(40, 30, 290) + W(40, 30, 430, 30) + W(40, 290, 430, 290);
      ['a', 'b', 'c'].forEach((n, k) => {
        const x = 170 + 130 * k, xd = x - 36, l = Math.round(lvl[k]);
        const on = [l === 1, l >= 0, l <= 0, l === -1];
        const lab = (i) => (k ? '' : `S<tspan class="sch-sub" dy="3">${i}</tspan>`);
        svg += DOT(x, 30) + DOT(x, 290);
        svg += SW(x, 30, 95, on[0], lab(1), 1) + SW(x, 95, 160, on[1], lab(2), 1) + SW(x, 160, 225, on[2], lab(3), 1) + SW(x, 225, 290, on[3], lab(4), 1);
        svg += DOT(x, 95) + DOT(x, 225) + W(x, 95, xd, 95) + W(x, 225, xd, 225);
        svg += DIODE(xd, 95, 160) + DIODE(xd, 160, 225) + DOT(xd, 160) + W(xd, 160, xd - 10, 160) + TX(xd - 13, 164, 'z', 'sch-s', 'end');
        svg += DOT(x, 160) + W(x, 160, x + 40, 160) + TX(x + 44, 164, n, 'sch-l', 'start') + TX(x + 44, 182, fmtSvg(fmtLevel(lvl[k], 1)), 'sch-v', 'start');
      });
      svg += LOAD3(512, [120, 160, 200]);
      status = `v<sub>az</sub> = ${fmtLevel(lvl[0], 1)}, v<sub>bz</sub> = ${fmtLevel(lvl[1], 1)}, v<sub>cz</sub> = ${fmtLevel(lvl[2], 1)}`;
    } else if (topo === 'fc') {
      vb = '0 0 700 320';
      const Nf = p.fcn, carrierBased = CARRIER_BASED.has(p.strat);
      const yy = (i) => 30 + (i * 260) / (2 * Nf); // node positions along the leg, P at 0, output at Nf, N at 2Nf
      svg += DCLINK(40, 30, 290) + W(40, 30, 470, 30) + W(40, 290, 470, 290);
      ['a', 'b', 'c'].forEach((n, k) => {
        const x = 170 + 150 * k;
        const lab = (s) => (k ? '' : `S<tspan class="sch-sub" dy="3">${s}</tspan>`);
        svg += DOT(x, 30) + DOT(x, 290);
        for (let j = 0; j < Nf; j++) {
          const on = carrierBased && cellA[k][j][ic] === 1;
          svg += SW(x, yy(j), yy(j + 1), on, lab(j + 1), 1) + SW(x, yy(2 * Nf - j - 1), yy(2 * Nf - j), !on, lab(j + 1 + '′'), 1);
        }
        for (let j = 1; j < Nf; j++) { // C_j joins the node below S_j and the node above S_j′
          const xc = x - 30 * (Nf - j), y1 = yy(j), y2 = yy(2 * Nf - j);
          svg += DOT(x, y1) + DOT(x, y2) + W(x, y1, xc, y1) + W(x, y2, xc, y2) + CAP(xc, y1, y2);
          if (k === 0) { // capacitor voltages, stacked left of the outermost capacitor
            const v = fmtSvg(fmtLevel((2 * (Nf - j)) / Nf, Nf).replace('+', ''));
            svg += Nf === 2 ? TX(xc - 14, 150, v, 'sch-s', 'end')
              : TX(x - 30 * (Nf - 1) - 14, 146 + 30 * (j - 1), `C<tspan class="sch-sub" dy="3">${j}</tspan><tspan dy="-3"> </tspan>` + v, 'sch-s', 'end');
          }
        }
        svg += DOT(x, 160) + W(x, 160, x + 24, 160) + TX(x + 28, 164, n, 'sch-l', 'start') + TX(x + 28, 182, fmtSvg(fmtLevel(lvl[k], Nf)), 'sch-v', 'start');
      });
      svg += LOAD3(572, [120, 160, 200]);
      status = `v<sub>az</sub> = ${fmtLevel(lvl[0], Nf)}, v<sub>bz</sub> = ${fmtLevel(lvl[1], Nf)}, v<sub>cz</sub> = ${fmtLevel(lvl[2], Nf)}`;
    } else if (topo === 'chb') {
      const top = 46, pitch = 100, H = top + N * pitch + 24;
      vb = `0 0 640 ${H}`;
      const ybus = top + N * pitch - 6;
      const carrierBased = CARRIER_BASED.has(p.strat);
      ['a', 'b', 'c'].forEach((n, k) => {
        const cx = 20 + 160 * k;
        svg += DOT(cx + 4, 22) + TX(cx + 4, 14, n, 'sch-l') + W(cx + 4, 22, cx + 4, top + 40);
        for (let j = 0; j < N; j++) {
          const cy = top + j * pitch;
          const A = carrierBased ? cellA[k][j][ic] : 0, B = carrierBased ? cellB[k][j][ic] : 0;
          const xa = cx + 16, xc = cx + 46, xb = cx + 140, xo = cx + 152; // leg A, capacitor, leg B, output stub
          svg += W(xa, cy, xb, cy) + W(xa, cy + 80, xb, cy + 80) + CAP(xc, cy, cy + 80);
          svg += SW(xa, cy, cy + 40, A === 1) + SW(xa, cy + 40, cy + 80, A !== 1) + SW(xb, cy, cy + 40, B === 1, '', 1) + SW(xb, cy + 40, cy + 80, B !== 1, '', 1);
          svg += DOT(xa, cy + 40) + DOT(xb, cy + 40) + W(xa, cy + 40, cx + 4, cy + 40) + W(xb, cy + 40, xo, cy + 40);
          svg += TX(xc + 16, cy + 30, `V<tspan class="sch-sub" dy="3">dc</tspan><tspan dy="-3">/${N}</tspan>`, 'sch-s', 'start');
          svg += TX(xc + 16, cy + 60, fmtSvg((A - B > 0 ? '+' : A - B < 0 ? '−' : '') + (A - B ? 'V<sub>dc</sub>/' + N : '0')), 'sch-v', 'start');
          if (j < N - 1) svg += W(xo, cy + 40, xo, cy + 90) + W(xo, cy + 90, cx + 4, cy + 90) + W(cx + 4, cy + 90, cx + 4, cy + pitch + 40);
          else svg += W(xo, cy + 40, xo, ybus) + DOT(xo, ybus);
        }
      });
      svg += W(172, ybus, 492, ybus) + TX(496, ybus + 4, 'z', 'sch-l', 'start');
      svg += LOAD3(512, [60, 100, 140]);
      status = `v<sub>az</sub> = ${fmtLevel(lvl[0], N)}, v<sub>bz</sub> = ${fmtLevel(lvl[1], N)}, v<sub>cz</sub> = ${fmtLevel(lvl[2], N)}`;
    }
    if (topo === 'mmc') {
      // per phase: P rail, upper arm of N submodules, arm inductor, output, arm inductor, lower arm, N rail
      const Nm = p.smn, A = Nm * 20, yP = 30, yUe = yP + 10 + A, ym = yUe + 40, yL = ym + 46, yN = yL + A + 10;
      const den = p.mmcmod === 'ps2' ? Nm : Nm;
      svg = DCLINK(40, yP, yN) + W(40, yP, 450, yP) + W(40, yN, 450, yN);
      const counts = [];
      ['a', 'b', 'c'].forEach((n, k) => {
        const x = 190 + 130 * k;
        let nu = 0, nl = 0;
        svg += DOT(x, yP) + DOT(x, yN) + W(x, yP, x, yUe + 4) + COILV(x, yUe + 4, 24) + W(x, yUe + 28, x, ym + 12) + COILV(x, ym + 12, 24) + W(x, ym + 36, x, yN);
        for (let j = 0; j < Nm; j++) {
          const U = cellA[k][j][ic] === 1, L = cellB[k][j][ic] === 1;
          nu += U; nl += L;
          svg += `<rect x="${x - 15}" y="${yP + 13 + 20 * j}" width="30" height="14" rx="3" class="sch-sm${U ? ' on' : ''}"/>`;
          svg += `<rect x="${x - 15}" y="${yL + 3 + 20 * j}" width="30" height="14" rx="3" class="sch-sm${L ? ' on' : ''}"/>`;
        }
        counts.push([nu, nl]);
        svg += TX(x + 21, yP + 14 + A / 2, `${nu}/${Nm}`, 'sch-s', 'start') + TX(x + 21, yL + 4 + A / 2, `${nl}/${Nm}`, 'sch-s', 'start');
        svg += DOT(x, ym) + W(x, ym, x + 24, ym) + TX(x + 28, ym + 4, n, 'sch-l', 'start') + TX(x + 28, ym + 22, fmtSvg(fmtLevel(lvl[k], den)), 'sch-v', 'start');
        if (k === 0) {
          svg += TX(x - 22, yP + 14 + A / 2, 'upper', 'sch-s', 'end') + TX(x - 22, yL + 4 + A / 2, 'lower', 'sch-s', 'end');
          svg += TX(x - 14, yUe + 20, 'L', 'sch-s', 'end') + TX(x - 14, ym + 28, 'L', 'sch-s', 'end');
        }
      });
      svg += LOAD3(540, [ym - 40, ym, ym + 40]);
      svg += `<rect x="540" y="${yN - 14}" width="12" height="9" rx="2" class="sch-sm on"/>` + TX(558, yN - 6, 'inserted', 'sch-s', 'start') +
        `<rect x="612" y="${yN - 14}" width="12" height="9" rx="2" class="sch-sm"/>` + TX(630, yN - 6, 'bypassed', 'sch-s', 'start');
      vb = `0 0 690 ${yN + 22}`;
      status = `Phase a: ${counts[0][0]} of ${Nm} upper and ${counts[0][1]} of ${Nm} lower submodules inserted, v<sub>az</sub> = ${fmtLevel(lvl[0], den)}`;
    }
    $('circuit').innerHTML = `<svg viewBox="${vb}" class="${topo === 'mmc' && p.smn > 4 ? 'tall' : ''}" role="img" aria-label="Converter circuit with switch states at the time cursor">${svg}</svg>`;
    $('circuitStatus').innerHTML = `At ω₁t = ${p.cur.toFixed(0)}°: ${status}`;
  }

  // ---------- readout ----------
  function updateReadout(p, res) {
    const rows = [];
    const pct = (v) => (Number.isFinite(v) ? (100 * v).toFixed(2) + ' %' : '—');
    const threePh = p.topo !== 'hb';
    if (!res.failed) {
      const unit = p.out === 'ia' ? (res.dtc ? ' A' : ' pu') : ' Vdc';
      rows.push(['Fundamental ' + OUT_LABEL[p.out] + ',1', res.V1.toFixed(3) + unit]);
      if (p.strat !== 'sixstep' && !res.dtc) {
        const lin = threePh ? { vaz: p.M, van: p.M, vab: SQRT3 * p.M, ia: p.M }[p.out] : { vaz: p.M, vab: 2 * p.M, ia: 2 * p.M }[p.out];
        if (lin > 0) rows.push(['Ratio to linear value', (res.V1 / lin).toFixed(3)]);
      }
      if (res.dtc) {
        rows.push(['Torque, mean' + (res.dtc.step ? ' after step' : ''), res.dtc.Tmean.toFixed(0) + ' Nm']);
        rows.push(['Torque ripple, peak to peak', res.dtc.Tpp.toFixed(0) + ' Nm']);
        rows.push(['Flux ripple, peak to peak', (1000 * res.dtc.psiPP).toFixed(0) + ' mVs']);
        rows.push(['Average switching frequency', (res.dtc.fsw / 1000).toFixed(2) + ' kHz']);
      }
      rows.push(['THD', pct(res.thd)]);
      if (p.out !== 'ia') {
        rows.push(['WTHD0', pct(res.wthd0)]);
        rows.push(['WTHD', pct(res.wthd)]);
      }
      if (p.topo === '2l' || p.topo === 'hb') rows.push(['Commutations / period (leg a)', String(res.commutations)]);
      else rows.push(['Level changes / period (phase a)', String(res.commutations)]);
      if (res.cellComm) rows.push([{ fc: 'Commutations / period, switch pairs of phase a', mmc: 'Commutations / period, upper-arm submodules of phase a' }[p.topo] || 'Commutations / period, cells of phase a', res.cellComm.join(', ')]);
      if (res.angles) rows.push(['Angles (°)', res.angles.map((a) => ((a * 180) / Math.PI).toFixed(2)).join(', ')]);
    }
    $('readout').innerHTML = rows.map(([k, v]) => `<div><dt>${k.replace(/_(\w+)/, '<sub>$1</sub>')}</dt><dd>${v}</dd></div>`).join('');
    $('note').innerHTML = res.notes.length ? window.AtlasUI.icon('alert') + `<span>${res.notes.join(' · ')}</span>` : '';
    const sub = (s) => s.replace(/\b([vi])_(\w+)/g, '$1<sub>$2</sub>');
    window.AtlasUI.setTip('outTip', OUT_TIP + res.info.map((s) => `<p>${sub(s)}</p>`).join(''));
  }
  const OUT_TIP = '<p><b>v<sub>az</sub></b> phase output to the dc midpoint z · <b>v<sub>ab</sub></b> line-to-line (the load voltage for the H-bridge) · <b>v<sub>an</sub></b> load phase voltage · <b>i<sub>a</sub></b> current in an R-L load with angle φ<sub>1</sub>.</p>';

  // ---------- UI ----------
  // keep select values consistent with the chosen converter
  function constrain() {
    const topo = $('topo').value;
    const fix = (id, allowed, fallback) => {
      for (const o of $(id).querySelectorAll('option')) { const ok = allowed.includes(o.value); o.hidden = !ok; o.disabled = !ok; }
      if (!allowed.includes($(id).value)) $(id).value = fallback;
    };
    fix('strat', STRATS[topo], 'spwm');
    fix('out', OUTS[topo], 'vab');
    if (ARRS[topo]) fix('arr', ARRS[topo], 'pd');
    for (const g of $('strat').querySelectorAll('optgroup')) g.hidden = ![...g.children].some((o) => !o.hidden);
  }
  function syncUI(p) {
    window.AtlasUI.setTip('stratTip', DESCRIPTION[p.strat](p.topo));
    window.AtlasUI.setTip('topoTip', TOPO_TEXT[p.topo]);
    document.querySelectorAll('[data-for], [data-topo]').forEach((el) => {
      const okS = !el.dataset.for || el.dataset.for.split(' ').includes(p.strat);
      const okT = !el.dataset.topo || el.dataset.topo.split(' ').includes(p.topo);
      el.hidden = !(okS && okT);
    });
    $('phi-ctl').hidden = p.out !== 'ia' || p.strat === 'dtc'; // DTC drives the machine model, not the R-L load
    if (p.topo === 'mmc' && p.mmcmod === 'nlm') $('p-ctl').hidden = true; // no carrier
    $('M-out').textContent = p.M.toFixed(2);
    $('p-out').textContent = String(p.p);
    $('phi-out').textContent = p.phi + '°';
    $('cur-out').textContent = p.cur.toFixed(0) + '°';
    $('cph-out').textContent = p.cph + '°';
    $('tmin-out').textContent = p.tmin ? p.tmin + ' µs' : 'off';
    $('tq-out').textContent = p.tq + ' Nm';
    $('dtb-out').textContent = p.dtb + ' Nm';
    $('psr-out').textContent = p.psr.toFixed(2) + ' Vs';
    $('dpb-out').textContent = (1000 * p.dpb).toFixed(0) + ' mVs';
    $('rpm-out').textContent = p.rpm + ' rpm';
  }

  let lastKey = '', lastRes = null;
  function render() {
    constrain();
    window.AtlasUI.syncSegs();
    const p = params();
    syncUI(p);
    const key = computeKeys.map((k) => p[k]).join('|');
    if (key !== lastKey || !lastRes) { lastRes = compute(p); lastKey = key; }
    const res = lastRes;
    drawTime(p, res);
    drawSpectrum(p, res);
    drawSpaceVectors(p, res);
    drawCircuit(p, res);
    updateReadout(p, res);
  }
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  function writeHash() {
    const q = new URLSearchParams();
    for (const id of ctlIds) q.set(id, $(id).value);
    if ($('exSrc').value) q.set('src', $('exSrc').value);
    if ($('example').value) q.set('ex', $('example').value);
    history.replaceState(null, '', '#' + q.toString());
  }
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    for (const id of ctlIds) if (q.has(id)) $(id).value = q.get(id);
    const raw = q.get('src') || '', src = (window.PWM_SOURCE_ALIAS || {})[raw] || raw;
    $('exSrc').value = SOURCES.some((s) => s.id === src) ? src : '';
    fillExamples();
    showExample(q.get('ex') || '');
  }

  // ---------- examples, filtered by lecture or assignment ----------
  const SOURCES = window.PWM_SOURCES || [];
  const SRC = new Map(SOURCES.map((s) => [s.id, s]));
  const EXAMPLES = new Map();
  for (const g of window.PWM_EXAMPLES || []) for (const it of g.items) EXAMPLES.set(it.id, { ...it, group: g.group });
  function fillExamples() {
    const src = $('exSrc').value, sel = $('example'), cur = sel.value;
    sel.innerHTML = '';
    const head = document.createElement('option');
    head.value = ''; head.textContent = src ? `${SRC.get(src).label}: choose…` : 'Examples…';
    sel.appendChild(head);
    for (const s of src ? [SRC.get(src)] : SOURCES) {
      const og = document.createElement('optgroup');
      og.label = `${s.label} · ${s.topic}`;
      for (const ex of EXAMPLES.values()) if (ex.tags.includes(s.id)) {
        const o = document.createElement('option'); o.value = ex.id; o.textContent = ex.title; og.appendChild(o);
      }
      if (og.children.length) sel.appendChild(og);
    }
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  }
  function showExample(id) {
    const ex = EXAMPLES.get(id);
    if (ex && $('exSrc').value && !ex.tags.includes($('exSrc').value)) { $('exSrc').value = ''; fillExamples(); }
    $('example').value = ex ? id : '';
    const where = ex ? ex.tags.map((t) => `${SRC.get(t).label} (${SRC.get(t).topic})`).join(' · ') : '';
    window.AtlasUI.setTip('exTip', ex ? `<p><b>${ex.title}</b><br>${ex.text.replace(/\b([vi])_(\w+)/g, '$1<sub>$2</sub>')}</p><p style="color:var(--text-3)">${where}</p>` : '');
  }
  function loadExample(id) {
    const ex = EXAMPLES.get(id);
    if (!ex) { showExample(''); writeHash(); return; }
    for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'cur' && k !== 'view') $(k).value = v;
    for (const [k, v] of Object.entries(ex.cfg)) $(k).value = v;
    showExample(id);
    writeHash(); schedule();
  }

  function init() {
    window.AtlasUI.init();
    readColors();
    const UI = window.AtlasUI;
    UI.setToggle($('sweep'), false, 'Stop sweep', 'Sweep M', 'pause', 'activity');
    UI.setToggle($('play'), false, 'Pause', 'Animate', 'pause', 'play');
    const sel = $('example'), srcSel = $('exSrc');
    for (const sr of SOURCES) { const o = document.createElement('option'); o.value = sr.id; o.textContent = sr.label; o.title = sr.topic; srcSel.appendChild(o); }
    readHash();
    sel.addEventListener('change', () => loadExample(sel.value));
    srcSel.addEventListener('change', () => { fillExamples(); showExample(sel.value); writeHash(); });
    for (const id of ctlIds) $(id).addEventListener('input', () => { writeHash(); schedule(); });
    $('allph').addEventListener('click', (e) => { allPhases = !allPhases; e.currentTarget.setAttribute('aria-pressed', allPhases); schedule(); });
    $('scale').addEventListener('click', (e) => { dbScale = !dbScale; e.currentTarget.setAttribute('aria-pressed', dbScale); schedule(); });
    $('share').addEventListener('click', async (e) => {
      writeHash();
      const btn = e.currentTarget;
      let ok = true;
      try { await navigator.clipboard.writeText(location.href); } catch { ok = false; }
      btn.innerHTML = UI.icon(ok ? 'check' : 'alert');
      btn.title = ok ? 'Link copied' : 'Copy the address from the address bar';
      setTimeout(() => { btn.innerHTML = UI.icon('link'); btn.title = 'Copy link'; }, 1600);
    });

    // animation: sweep M back and forth, and/or move the time cursor
    let dir = 1, last = 0, running = false;
    function frame(ts) {
      if (!sweeping && !playing) { running = false; return; }
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      if (sweeping) {
        const el = $('M'), topM = $('strat').value === 'she' ? 1.2 : 2;
        let M = parseFloat(el.value) + dir * 0.2 * dt;
        if (M >= topM) { M = topM; dir = -1; }
        if (M <= 0.05) { M = 0.05; dir = 1; }
        el.value = M.toFixed(2);
      }
      if (playing) {
        const el = $('cur'), view = parseFloat($('view').value);
        let c = parseFloat(el.value) + 36 * dt;
        if (c > Math.min(359, view)) c = 0;
        el.value = c.toFixed(1);
      }
      render();
      requestAnimationFrame(frame);
    }
    const startLoop = () => { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } };
    $('sweep').addEventListener('click', (e) => {
      sweeping = !sweeping;
      const b = e.currentTarget;
      UI.setToggle(b, sweeping, 'Stop sweep', 'Sweep M', 'pause', 'activity');
      if (sweeping) startLoop(); else { writeHash(); schedule(); }
    });
    $('play').addEventListener('click', (e) => {
      playing = !playing;
      const b = e.currentTarget;
      UI.setToggle(b, playing, 'Pause', 'Animate', 'pause', 'play');
      if (playing) startLoop(); else { writeHash(); schedule(); }
    });

    // click or drag on the waveform plot to move the time cursor
    const tc = $('timeCanvas');
    const setCursor = (e) => {
      const r = tc.getBoundingClientRect(), view = parseFloat($('view').value);
      const f = (e.clientX - r.left - TIME_L) / (r.width - TIME_L - TIME_R);
      $('cur').value = Math.max(0, Math.min(359, f * view)).toFixed(0);
      schedule();
    };
    tc.addEventListener('pointerdown', (e) => { tc.setPointerCapture(e.pointerId); setCursor(e); });
    tc.addEventListener('pointermove', (e) => { if (e.buttons) setCursor(e); });
    tc.addEventListener('pointerup', writeHash);

    const sc = $('specCanvas');
    sc.addEventListener('pointermove', (e) => { hoverX = e.clientX - sc.getBoundingClientRect().left; schedule(); });
    sc.addEventListener('pointerleave', () => { hoverX = null; schedule(); });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', () => { readHash(); schedule(); });
    const recolor = () => { readColors(); lastKey = ''; schedule(); };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
    new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    render();
  }

  init();
})();
