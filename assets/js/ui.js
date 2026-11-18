/* Atlas UI helpers: (i) tooltips, theme switcher, segmented controls backed by hidden <select>s. */
(function () {
  'use strict';
  const ICON = {
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  // ---------- tooltips ----------
  const bubble = document.createElement('div');
  bubble.id = 'tipBubble'; bubble.className = 'glass'; bubble.setAttribute('role', 'tooltip'); bubble.hidden = true;
  document.body.appendChild(bubble);
  let openBtn = null, pinned = false;
  function place(btn) {
    const r = btn.getBoundingClientRect(), b = bubble.getBoundingClientRect(), m = 12;
    let left = Math.min(Math.max(m, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - m);
    let top = r.bottom + 8;
    if (top + b.height > innerHeight - m && r.top - 8 - b.height > m) top = r.top - 8 - b.height;
    bubble.style.left = left + 'px'; bubble.style.top = Math.max(m, top) + 'px';
  }
  function show(btn) {
    const html = btn.dataset.tip;
    if (!html) return;
    if (openBtn && openBtn !== btn) openBtn.setAttribute('aria-expanded', 'false');
    openBtn = btn; btn.setAttribute('aria-expanded', 'true');
    bubble.innerHTML = html; bubble.hidden = false;
    bubble.style.left = '0px'; bubble.style.top = '0px';
    place(btn);
  }
  function hide() {
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    openBtn = null; pinned = false; bubble.hidden = true;
  }
  function wireTip(btn) {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.type = 'button';
    btn.innerHTML = icon('info');
    if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', 'More information');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('mouseenter', () => { if (!pinned) show(btn); });
    btn.addEventListener('mouseleave', () => { if (!pinned && openBtn === btn) hide(); });
    btn.addEventListener('focus', () => { if (!pinned) show(btn); });
    btn.addEventListener('blur', () => { if (!pinned && openBtn === btn) hide(); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinned && openBtn === btn) { hide(); return; }
      show(btn); pinned = true;
    });
  }
  document.addEventListener('click', (e) => { if (openBtn && !bubble.contains(e.target)) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (openBtn) hide(); }, true);
  window.addEventListener('resize', () => { if (openBtn) hide(); });
  function setTip(idOrEl, html) {
    const btn = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!btn) return;
    if (btn.dataset.tip === html) return;
    btn.dataset.tip = html || '';
    btn.hidden = !html;
    if (openBtn === btn) { if (html) { bubble.innerHTML = html; place(btn); } else hide(); }
  }

  // ---------- theme ----------
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    try { if (t === 'light' || t === 'dark') localStorage.setItem('atlas-theme', t); else localStorage.removeItem('atlas-theme'); } catch (e) { /* storage blocked */ }
    document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === (t || 'system')));
  }
  function wireTheme() {
    const seg = document.getElementById('themeSeg');
    if (!seg) return;
    const cur = document.documentElement.getAttribute('data-theme') || 'system';
    seg.innerHTML = [['system', 'monitor', 'System theme'], ['light', 'sun', 'Light theme'], ['dark', 'moon', 'Dark theme']]
      .map(([t, ic, lab]) => `<button type="button" data-theme="${t}" aria-label="${lab}" title="${lab}" class="${t === cur ? 'on' : ''}">${icon(ic)}</button>`).join('');
    seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applyTheme(b.dataset.theme === 'system' ? null : b.dataset.theme); });
  }

  // ---------- segmented controls ----------
  // <div class="seg" data-select="id"></div> mirrors <select id="id" hidden>. Option text comes from data-short or the option text.
  const segs = [];
  function wireSeg(seg) {
    const sel = document.getElementById(seg.dataset.select);
    seg.setAttribute('role', 'group');
    seg.innerHTML = [...sel.options].map((o) =>
      `<button type="button" data-v="${o.value}" title="${o.title || o.textContent}"><span>${o.dataset.short || o.textContent}</span></button>`).join('');
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || sel.value === b.dataset.v) return;
      sel.value = b.dataset.v;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      syncSegs();
    });
    segs.push([seg, sel]);
  }
  function syncSegs() {
    for (const [seg, sel] of segs) {
      const opts = sel.options;
      seg.querySelectorAll('button').forEach((b, i) => {
        b.hidden = !!opts[i].hidden;
        const on = opts[i].value === sel.value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
    }
  }

  // toggle buttons with an icon and a label that changes
  function setToggle(btn, on, labelOn, labelOff, iconOn, iconOff) {
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = icon(on ? iconOn : iconOff) + `<span>${on ? labelOn : labelOff}</span>`;
  }

  function init() {
    document.querySelectorAll('.tip').forEach(wireTip);
    document.querySelectorAll('.seg[data-select]').forEach(wireSeg);
    document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
    wireTheme();
    syncSegs();
  }
  window.AtlasUI = { init, setTip, syncSegs, setToggle, icon };
})();
