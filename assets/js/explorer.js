/* PWM Explorer for EJ2311.
   One fundamental period is sampled at NS points. Phase legs switch between ±1 (per unit of Vdc,
   Holmes & Lipo convention: dc link 2Vdc). Because exactly one period is analysed, the FFT bins
   are the harmonic orders h = 0, 1, 2, ... with no leakage. */
(function () {
  'use strict';

  const NS = 16384;
  const TWO_PI = 2 * Math.PI;
  const SQRT3 = Math.sqrt(3);
  const fft = new FFT(NS);
  const $ = (id) => document.getElementById(id);

  const CARRIER_BASED = new Set(['spwm', 'thi', 'svm', 'dpwm1']);
  const LINEAR_LIMIT = { spwm: 1, thi: 2 / SQRT3, svm: 2 / SQRT3, dpwm1: 2 / SQRT3, she: Infinity };
  const DESCRIPTION = {
    spwm: 'v*<sub>x</sub> = M cos(ωt − φ<sub>x</sub>). Linear up to M = 1.',
    thi: 'v*<sub>x</sub> = M cos(ωt − φ<sub>x</sub>) − (M/6) cos 3ωt. Linear up to M = 2/√3 ≈ 1.155.',
    svm: 'Adds the zero sequence −(max + min)/2, which centres the zero vectors in each carrier period. Equivalent to SVM. Linear up to M ≈ 1.155.',
    dpwm1: 'Clamps the phase with the largest |v*| to the dc rail for 60° around its peak. One third fewer commutations. Linear up to M ≈ 1.155.',
    sixstep: 'Each leg is a square wave, giving the largest fundamental, 4/π · V<sub>dc</sub> ≈ 1.27.',
    she: 'Quarter-wave symmetric pattern with N angles. Sets V<sub>1</sub> = M and removes the first N − 1 non-triplen harmonics (5, 7, 11, 13, …). Triplens cancel between the phases.',
  };
  const OUT_LABEL = { vaz: 'v_az', vab: 'v_ab', van: 'v_an', ia: 'i_a' };

  const ctlIds = ['strat', 'carrier', 'samp', 'nshe', 'M', 'p', 'out', 'phi', 'view', 'hmax'];
  const numeric = new Set(['M', 'p', 'phi', 'nshe', 'view']);
  let allPhases = false, dbScale = false, sweeping = false, hoverX = null;

  function params() {
    const p = {};
    for (const id of ctlIds) p[id] = numeric.has(id) ? parseFloat($(id).value) : $(id).value;
    return p;
  }

  // ---------- buffers ----------
  const sw = [new Float64Array(NS), new Float64Array(NS), new Float64Array(NS)];  // leg states ±1
  const ref = [new Float64Array(NS), new Float64Array(NS), new Float64Array(NS)]; // references as compared
  const car = new Float64Array(NS);
  const y = new Float64Array(NS);       // selected output
  const fund = new Float64Array(NS);    // its fundamental
  const re = new Float64Array(NS), im = new Float64Array(NS);
  const amp = new Float64Array(NS / 2 + 1);
  const psiA = new Float64Array(NS), psiB = new Float64Array(NS);
  const dwell = new Float64Array(8);

  function carrierAt(type, u) { // u in [0, 1): one carrier period, positive peak at u = 0
    if (type === 'sawr') return 2 * u - 1;
    if (type === 'sawf') return 1 - 2 * u;
    return Math.abs(4 * u - 2) - 1;
  }

  function zeroSequence(strat, a, b, c, M) {
    switch (strat) {
      case 'thi': return 0; // added separately as −(M/6) cos 3θ
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
  // Waveform: +1 on [0, α1), −1 on [α1, α2), ... over the first quarter period, then quarter-wave symmetric.
  // Its cosine coefficients are a_n = 4/(nπ) [ (−1)^N sin(nπ/2) + 2 Σ_k (−1)^(k+1) sin(n α_k) ].
  function sheCoef(n, a) {
    let s = (a.length % 2 ? -1 : 1) * Math.sin((n * Math.PI) / 2);
    for (let j = 0; j < a.length; j++) s += 2 * (j % 2 ? -1 : 1) * Math.sin(n * a[j]);
    return (4 / (n * Math.PI)) * s;
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
  function newton(H, M, guess) {
    const N = guess.length, a = guess.slice();
    for (let it = 0; it < 60; it++) {
      const F = H.map((n, r) => sheCoef(n, a) - (r === 0 ? M : 0));
      if (Math.max(...F.map(Math.abs)) < 1e-11) break;
      const J = H.map((n) => a.map((aj, j) => (8 / Math.PI) * (j % 2 ? -1 : 1) * Math.cos(n * aj)));
      const d = solveLinear(J, F.map((v) => -v));
      if (!d) return null;
      const big = Math.max(...d.map(Math.abs));
      const k = big > 0.15 ? 0.15 / big : 1; // damped step
      for (let j = 0; j < N; j++) a[j] += k * d[j];
    }
    const F = H.map((n, r) => sheCoef(n, a) - (r === 0 ? M : 0));
    if (Math.max(...F.map(Math.abs)) > 1e-8) return null;
    for (let j = 0; j < N; j++) {
      const lo = j ? a[j - 1] : 0;
      if (!(a[j] > lo + 1e-4) || !(a[j] < Math.PI / 2 - 1e-4)) return null;
    }
    return a;
  }
  const sheCache = new Map();
  let sheLast = {};
  function sheSolve(N, M) {
    const key = N + ':' + M.toFixed(3);
    if (sheCache.has(key)) return sheCache.get(key);
    const H = [1, ...nonTriplenOdd(N - 1)];
    let rng = 0x2545f491;
    const rand = () => ((rng = (Math.imul(rng ^ (rng >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
    const guesses = [];
    if (sheLast[N]) guesses.push(sheLast[N]);
    guesses.push(Array.from({ length: N }, (_, j) => ((j + 1) * Math.PI) / (2 * (N + 1))));
    for (let t = 0; t < 300; t++) guesses.push(Array.from({ length: N }, () => rand() * Math.PI / 2).sort((x, z) => x - z));
    let sol = null;
    for (const g of guesses) { sol = newton(H, M, g); if (sol) break; }
    if (sol) sheLast[N] = sol;
    sheCache.set(key, sol);
    return sol;
  }
  function sheValue(x, angles) {
    x = ((x % TWO_PI) + TWO_PI) % TWO_PI;
    if (x > Math.PI) x = TWO_PI - x;
    let sign = 1;
    if (x > Math.PI / 2) { x = Math.PI - x; sign = -1; }
    let k = 0;
    while (k < angles.length && angles[k] <= x) k++;
    return sign * (k % 2 ? -1 : 1);
  }

  // ---------- compute one period ----------
  function compute(p) {
    const res = { notes: [], info: [] };
    const phase = [0, -TWO_PI / 3, TWO_PI / 3];
    const M = p.M;

    if (CARRIER_BASED.has(p.strat)) {
      let samp = p.samp;
      if (samp === 'asym' && p.carrier !== 'tri') {
        samp = 'sym';
        res.info.push('Asymmetrical sampling needs a triangular carrier, so symmetrical sampling is used.');
      }
      for (let i = 0; i < NS; i++) {
        const u = (p.p * i) / NS;                  // carrier periods elapsed
        const c = carrierAt(p.carrier, u - Math.floor(u));
        const th = samp === 'nat' ? (TWO_PI * i) / NS
          : samp === 'sym' ? (TWO_PI * Math.floor(u)) / p.p
          : (TWO_PI * Math.floor(2 * u)) / (2 * p.p);
        const a = M * Math.cos(th + phase[0]), b = M * Math.cos(th + phase[1]), cc = M * Math.cos(th + phase[2]);
        // cosine reference: the injected third harmonic is −(M/6) cos 3θ (flattens the peaks)
        const z = p.strat === 'thi' ? -(M / 6) * Math.cos(3 * th) : zeroSequence(p.strat, a, b, cc, M);
        const r = [a + z, b + z, cc + z];
        car[i] = c;
        for (let k = 0; k < 3; k++) {
          ref[k][i] = r[k];
          // a reference on (or beyond) a rail clamps the leg; avoids 1-sample glitches where the carrier touches ±1
          sw[k][i] = r[k] >= 1 - 1e-12 ? 1 : r[k] <= -1 + 1e-12 ? -1 : r[k] > c ? 1 : -1;
        }
      }
      if (p.strat === 'dpwm1' && samp === 'nat')
        res.info.push('With natural sampling the clamp transitions fall inside carrier periods, so parts of pulses are lost and the fundamental drops. Regular sampling avoids this.');
      if (M > LINEAR_LIMIT[p.strat] + 1e-9)
        res.notes.push(`M is above the linear limit (${LINEAR_LIMIT[p.strat].toFixed(3)}): pulses are dropped and low-order harmonics appear (overmodulation).`);
    } else if (p.strat === 'sixstep') {
      for (let i = 0; i < NS; i++) {
        const th = (TWO_PI * i) / NS;
        for (let k = 0; k < 3; k++) {
          const v = Math.cos(th + phase[k]);
          ref[k][i] = (4 / Math.PI) * v;
          sw[k][i] = v >= 0 ? 1 : -1;
        }
        car[i] = NaN;
      }
    } else { // she
      const angles = sheSolve(p.nshe, M);
      res.angles = angles;
      if (!angles) {
        res.notes.push(`No switching angles found for M = ${M.toFixed(2)} with ${p.nshe} angles. Try a smaller M.`);
        for (let k = 0; k < 3; k++) { sw[k].fill(0); ref[k].fill(0); }
        car.fill(NaN);
        res.failed = true;
        return res;
      }
      for (let i = 0; i < NS; i++) {
        const th = (TWO_PI * i) / NS;
        for (let k = 0; k < 3; k++) {
          ref[k][i] = M * Math.cos(th + phase[k]);
          sw[k][i] = sheValue(th + phase[k], angles);
        }
        car[i] = NaN;
      }
      res.eliminated = nonTriplenOdd(p.nshe - 1);
    }

    // selected output
    for (let i = 0; i < NS; i++) {
      const a = sw[0][i], b = sw[1][i], c = sw[2][i];
      y[i] = p.out === 'vaz' ? a : p.out === 'vab' ? a - b : a - (a + b + c) / 3;
    }
    if (p.out === 'ia') {
      // i = v_an / Z(h), Z(h) = cos φ + j h sin φ (|Z| = 1 at the fundamental)
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
    const base = p.out === 'vab' ? SQRT3 : 1;
    res.wthd0 = Math.sqrt(w2) / base;
    res.wthd = Math.sqrt(w2) / amp[1];
    let comm = 0;
    for (let i = 0; i < NS; i++) if (sw[0][i] !== sw[0][(i + NS - 1) % NS]) comm++;
    res.commutations = comm;

    // space vectors: v_αβ = 2/3 (v_a + a v_b + a² v_c), flux = ∫ v dθ
    dwell.fill(0);
    let pa = 0, pb = 0, ma = 0, mb = 0;
    const dth = TWO_PI / NS;
    for (let i = 0; i < NS; i++) {
      const a = sw[0][i], b = sw[1][i], c = sw[2][i];
      const va = (2 / 3) * (a - 0.5 * b - 0.5 * c), vb = (b - c) / SQRT3;
      pa += va * dth; pb += vb * dth;
      psiA[i] = pa; psiB[i] = pb; ma += pa; mb += pb;
      dwell[(a > 0 ? 4 : 0) + (b > 0 ? 2 : 0) + (c > 0 ? 1 : 0)] += 1 / NS;
    }
    ma /= NS; mb /= NS;
    for (let i = 0; i < NS; i++) { psiA[i] -= ma; psiB[i] -= mb; }
    // fundamental amplitude of the load phase voltage, for reference circles
    let cr = 0, ci = 0;
    for (let i = 0; i < NS; i++) {
      const a = sw[0][i], v = a - (a + sw[1][i] + sw[2][i]) / 3, th = (TWO_PI * i) / NS;
      cr += v * Math.cos(th); ci += v * Math.sin(th);
    }
    res.V1an = (2 / NS) * Math.hypot(cr, ci);

    if (p.out !== 'vaz' && CARRIER_BASED.has(p.strat))
      res.info.push('Harmonics common to all three legs (the carrier harmonics h = p, 2p, … and sidebands with n a multiple of 3) cancel in line quantities.');
    return res;
  }

  // ---------- drawing helpers ----------
  const colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['text', 'muted', 'border', 'surface', 'bg', 'c-signal', 'c-message', 'c-aux', 'c-third', 'c-carrier', 'c-grid'])
      colors[k] = cs.getPropertyValue('--' + k).trim();
  }
  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.font = '11px system-ui, sans-serif';
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
    ctx.font = '600 12px system-ui, sans-serif';
    const tw = ctx.measureText(title).width;
    ctx.font = '11px system-ui, sans-serif';
    let width = tw + 12;
    for (const [label] of items) width += 28 + ctx.measureText(label).width;
    const x0 = box.x + 4, y0 = box.y + 4, yy = y0 + 10;
    ctx.fillStyle = colors.surface; ctx.globalAlpha = 0.92;
    ctx.fillRect(x0, y0, Math.min(width + 4, box.w - 8), 20);
    ctx.globalAlpha = 1;
    ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = colors.text;
    ctx.fillText(title, x0 + 6, yy);
    ctx.font = '11px system-ui, sans-serif';
    let x = x0 + tw + 18;
    for (const [label, color, dash] of items) {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 16, yy); ctx.stroke();
      ctx.fillStyle = colors.muted; ctx.fillText(label, x + 20, yy);
      x += 28 + ctx.measureText(label).width;
    }
    ctx.restore();
  }

  // ---------- plots ----------
  function drawTime(p, res) {
    const { ctx, w, h } = prep($('timeCanvas'));
    const L = 44, R = 12, T = 8, B = 24, G = 18;
    const avail = h - T - B - G;
    const top = { x: L, y: T, w: w - L - R, h: Math.round(avail * 0.42) };
    const bot = { x: L, y: top.y + top.h + G, w: w - L - R, h: avail - top.h };
    const i1 = Math.round((NS * p.view) / 360);
    const degStep = p.view === 360 ? 60 : p.view === 180 ? 30 : 15;
    const xFmt = (x) => x + '°';

    // top: carrier and references
    let rmax = 1;
    for (let k = 0; k < 3; k++) for (let i = 0; i < NS; i += 8) rmax = Math.max(rmax, Math.abs(ref[k][i]));
    const ry = Math.max(1.25, niceCeil(rmax * 1.08));
    axes(ctx, top, 0, p.view, -ry, ry, { xStep: degStep, xLabels: false, yStep: ry > 1.5 ? 1 : 0.5 });
    const carrierShown = CARRIER_BASED.has(p.strat);
    if (carrierShown) trace(ctx, top, car, 0, i1, -ry, ry, colors['c-carrier'], 1);
    if (allPhases) {
      trace(ctx, top, ref[1], 0, i1, -ry, ry, colors['c-aux'], 1.6);
      trace(ctx, top, ref[2], 0, i1, -ry, ry, colors['c-third'], 1.6);
    }
    trace(ctx, top, ref[0], 0, i1, -ry, ry, colors['c-message'], 1.8, carrierShown ? null : [6, 4]);
    const tItems = [['v*a', colors['c-message']]];
    if (allPhases) tItems.push(['v*b', colors['c-aux']], ['v*c', colors['c-third']]);
    if (carrierShown) tItems.push(['carrier', colors['c-carrier']]);
    header(ctx, top, carrierShown ? 'Reference and carrier' : 'Fundamental reference', tItems);

    // bottom: output
    let ymax;
    if (p.out === 'ia') { let m = 0; for (let i = 0; i < NS; i++) m = Math.max(m, Math.abs(y[i])); ymax = niceCeil(m * 1.15 || 1); }
    else ymax = { vaz: 1.25, vab: 2.5, van: 1.5 }[p.out];
    axes(ctx, bot, 0, p.view, -ymax, ymax, { xStep: degStep, xFmt, yStep: ymax > 2 ? 1 : 0.5 });
    trace(ctx, bot, y, 0, i1, -ymax, ymax, colors['c-signal'], p.out === 'ia' ? 1.6 : 1.1);
    trace(ctx, bot, fund, 0, i1, -ymax, ymax, colors['c-message'], 1.6, [6, 4]);
    header(ctx, bot, OUT_LABEL[p.out] + (p.out === 'ia' ? ' (pu)' : ' / Vdc'), [[OUT_LABEL[p.out], colors['c-signal']], ['fundamental', colors['c-message'], [6, 4]]]);
    ctx.fillStyle = colors.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('ω₁t', bot.x + bot.w, h - 1);
  }

  function hmaxFor(p) {
    if (p.hmax !== 'auto') return parseInt(p.hmax, 10);
    if (!CARRIER_BASED.has(p.strat)) return 50;
    return Math.min(200, Math.max(40, Math.ceil((3 * p.p + 8) / 10) * 10));
  }

  function drawSpectrum(p, res) {
    const { ctx, w, h } = prep($('specCanvas'));
    const L = 46, R = 12, T = 8, B = 24;
    const box = { x: L, y: T, w: w - L - R, h: h - T - B };
    const Hm = hmaxFor(p);
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

    // carrier group markers
    if (CARRIER_BASED.has(p.strat)) {
      ctx.strokeStyle = colors['c-carrier']; ctx.fillStyle = colors.muted; ctx.setLineDash([3, 3]);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (let m = 1; m * p.p <= Hm; m++) {
        const x = Math.round(X(m * p.p)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, box.y + 22); ctx.lineTo(x, box.y + box.h); ctx.stroke();
        ctx.fillText((m === 1 ? '' : m) + 'p', x, box.y + 21);
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
    ctx.fillText(dbScale ? 'dB re Vdc' : (p.out === 'ia' ? 'amplitude (pu)' : 'amplitude / Vdc'), 0, 0);
    ctx.restore();
  }

  function drawSpaceVectors(p, res) {
    const { ctx, w, h } = prep($('svCanvas'));
    const gap = 16, size = Math.min(h - 10, (w - gap) / 2);
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

    // left: voltage vectors
    const b0 = boxes[0], P0 = plotIn(b0, 1.85);
    axesCross(b0);
    const vert = [];
    for (let k = 0; k < 6; k++) vert.push([(4 / 3) * Math.cos((k * Math.PI) / 3), (4 / 3) * Math.sin((k * Math.PI) / 3)]);
    ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
    ctx.beginPath();
    vert.forEach(([a, b], i) => (i ? ctx.lineTo(P0.X(a), P0.Y(b)) : ctx.moveTo(P0.X(a), P0.Y(b))));
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash([2, 3]); ctx.strokeStyle = colors['c-carrier'];
    ctx.beginPath(); ctx.arc(P0.X(0), P0.Y(0), (2 / SQRT3) * P0.k, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([6, 4]); ctx.strokeStyle = colors['c-message']; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(P0.X(0), P0.Y(0), res.V1an * P0.k, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([]);
    // vectors, dot area ∝ dwell time
    const states = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]];
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [a, b, c] of states) {
      const idx = a * 4 + b * 2 + c;
      const sa = 2 * a - 1, sb = 2 * b - 1, sc = 2 * c - 1;
      const va = (2 / 3) * (sa - 0.5 * sb - 0.5 * sc), vb = (sb - sc) / SQRT3;
      const zero = idx === 0 || idx === 7;
      const d = zero ? dwell[0] + dwell[7] : dwell[idx];
      if (idx === 7) continue;
      const r = d > 0 ? 3 + Math.sqrt(d) * 22 : 0;
      ctx.fillStyle = colors['c-signal'];
      if (r) { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(P0.X(va), P0.Y(vb), r, 0, TWO_PI); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = colors.muted;
      const lx = zero ? P0.X(0) : P0.X(va * 1.3), ly = zero ? P0.Y(0) + Math.max(r, 4) + 8 : P0.Y(vb * 1.3);
      if (b0.s > 170 && (!zero || d > 0)) ctx.fillText(zero ? '000/111' : `${a}${b}${c}`, lx, ly);
    }
    ctx.font = '11px system-ui, sans-serif';
    header(ctx, { x: b0.x, y: b0.y, w: b0.s }, 'Voltage vectors', []);

    // right: flux
    const b1 = boxes[1];
    let R = 0.2;
    for (let i = 0; i < NS; i += 4) R = Math.max(R, Math.hypot(psiA[i], psiB[i]));
    const P1 = plotIn(b1, R * 1.1);
    axesCross(b1);
    ctx.setLineDash([6, 4]); ctx.strokeStyle = colors['c-message']; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(P1.X(0), P1.Y(0), res.V1an * P1.k, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = colors['c-signal']; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= NS; i += 2) {
      const j = i % NS;
      if (i) ctx.lineTo(P1.X(psiA[j]), P1.Y(psiB[j])); else ctx.moveTo(P1.X(psiA[j]), P1.Y(psiB[j]));
    }
    ctx.stroke();
    header(ctx, { x: b1.x, y: b1.y, w: b1.s }, 'Stator flux ψ', []);

    // shared legend below the boxes is implicit: dashed = fundamental circle
    ctx.fillStyle = colors.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('dashed: fundamental', b1.x + 6, b1.y + b1.s - 4);
    ctx.fillText('dot size: dwell time', b0.x + 6, b0.y + b0.s - 4);
  }

  // ---------- readout ----------
  function updateReadout(p, res) {
    const rows = [];
    const pct = (v) => (Number.isFinite(v) ? (100 * v).toFixed(2) + ' %' : '—');
    if (!res.failed) {
      const unit = p.out === 'ia' ? ' pu' : ' Vdc';
      rows.push(['Fundamental ' + OUT_LABEL[p.out] + ',1', res.V1.toFixed(3) + unit]);
      if (CARRIER_BASED.has(p.strat) || p.strat === 'she') {
        const lin = { vaz: p.M, van: p.M, vab: SQRT3 * p.M, ia: p.M }[p.out];
        if (lin > 0) rows.push(['Ratio to linear value', (res.V1 / lin).toFixed(3)]);
      }
      rows.push(['THD', pct(res.thd)]);
      if (p.out !== 'ia') {
        rows.push(['WTHD0', pct(res.wthd0)]);
        rows.push(['WTHD', pct(res.wthd)]);
      }
      rows.push(['Commutations / period (leg a)', String(res.commutations)]);
      if (res.angles) rows.push(['Angles (°)', res.angles.map((a) => ((a * 180) / Math.PI).toFixed(2)).join(', ')]);
    }
    $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k.replace(/_(\w+)/, '<sub>$1</sub>')}</dt><dd>${v}</dd>`).join('');
    $('note').textContent = res.notes.join(' ');
    $('info').textContent = res.info.join(' ');
  }

  // ---------- UI ----------
  function syncUI(p) {
    $('equation').innerHTML = DESCRIPTION[p.strat];
    document.querySelectorAll('.ctl[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(p.strat); });
    $('phi-ctl').hidden = p.out !== 'ia';
    $('M-out').textContent = p.M.toFixed(2);
    $('p-out').textContent = String(p.p);
    $('phi-out').textContent = p.phi + '°';
  }

  function render() {
    const p = params();
    syncUI(p);
    const res = compute(p);
    drawTime(p, res);
    drawSpectrum(p, res);
    drawSpaceVectors(p, res);
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
    history.replaceState(null, '', '#' + q.toString());
  }
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    for (const id of ctlIds) if (q.has(id)) $(id).value = q.get(id);
  }

  const PRESETS = [
    ['CA1: sawtooth, M = 0.75, p = 11', { strat: 'spwm', carrier: 'sawr', samp: 'nat', M: 0.75, p: 11, out: 'vaz' }],
    ['Lab 3.1: current, p = 9', { strat: 'spwm', carrier: 'tri', samp: 'asym', M: 0.8, p: 9, out: 'ia' }],
    ['Lab 3.1: current, p = 39', { strat: 'spwm', carrier: 'tri', samp: 'asym', M: 0.8, p: 39, out: 'ia' }],
    ['Lab 3.2: SPWM, p = 22', { strat: 'spwm', carrier: 'tri', samp: 'asym', M: 0.8, p: 22, out: 'vaz' }],
    ['Lab 3.2: 1/6 third harmonic', { strat: 'thi', carrier: 'tri', samp: 'asym', M: 0.8, p: 22, out: 'vaz' }],
    ['Lab 3.2: SVM, M = 1, p = 9', { strat: 'svm', carrier: 'tri', samp: 'asym', M: 1, p: 9, out: 'vab' }],
    ['Lab 3.3: overmodulation', { strat: 'spwm', carrier: 'tri', samp: 'asym', M: 1.15, p: 22, out: 'vab' }],
    ['Lab 3.4: six-step', { strat: 'sixstep', out: 'vab' }],
    ['Lab 3.5: SHE, 5 angles', { strat: 'she', nshe: 5, M: 0.8, out: 'vaz' }],
  ];

  function init() {
    readColors();
    readHash();
    for (const [label, cfg] of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => {
        for (const [k, v] of Object.entries(cfg)) $(k).value = v;
        writeHash(); schedule();
      });
      $('presets').appendChild(b);
    }
    for (const id of ctlIds) $(id).addEventListener('input', () => { writeHash(); schedule(); });
    $('allph').addEventListener('click', (e) => { allPhases = !allPhases; e.currentTarget.setAttribute('aria-pressed', allPhases); schedule(); });
    $('scale').addEventListener('click', (e) => { dbScale = !dbScale; e.currentTarget.setAttribute('aria-pressed', dbScale); schedule(); });
    $('share').addEventListener('click', async (e) => {
      writeHash();
      const btn = e.currentTarget;
      try { await navigator.clipboard.writeText(location.href); btn.textContent = 'Copied ✓'; }
      catch { btn.textContent = 'Copy from address bar'; }
      setTimeout(() => (btn.textContent = 'Copy link'), 1600);
    });

    // sweep M back and forth
    let dir = 1, last = 0;
    function frame(ts) {
      if (!sweeping) return;
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      const el = $('M'), top = $('strat').value === 'she' ? 1.2 : 2;
      let M = parseFloat(el.value) + dir * 0.2 * dt;
      if (M >= top) { M = top; dir = -1; }
      if (M <= 0.05) { M = 0.05; dir = 1; }
      el.value = M.toFixed(2);
      render();
      requestAnimationFrame(frame);
    }
    $('sweep').addEventListener('click', (e) => {
      sweeping = !sweeping;
      const b = e.currentTarget;
      b.setAttribute('aria-pressed', sweeping);
      b.textContent = sweeping ? '❚❚ Stop sweep' : '▶ Sweep M';
      if (sweeping) { last = 0; requestAnimationFrame(frame); } else { writeHash(); schedule(); }
    });

    const sc = $('specCanvas');
    sc.addEventListener('pointermove', (e) => { hoverX = e.clientX - sc.getBoundingClientRect().left; schedule(); });
    sc.addEventListener('pointerleave', () => { hoverX = null; schedule(); });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', () => { readHash(); schedule(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); schedule(); });
    render();
  }

  init();
})();
