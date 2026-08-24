/* ============================================================
   tour.js — the offer on first open, and the guided walkthrough.
   Spotlights one part of the page at a time and explains it.
   Offered, never forced: dismissing it is one click and it does
   not come back unless asked for from the header.
   ============================================================ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SEEN = 'herdr101-tour-v1';
  const esc = (s) => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function Tour(lab) {
    this.lab = lab;              // { sim, go, showView }
    this.i = 0;
    this.el = null;
    this.steps = [
      { target: '#lesson-body', title: 'The lesson',
        text: 'Twelve lessons in order, built from the Herdr docs — what it is, panes and tabs, spaces, agents, detaching, then the CLI and config.',
        view: 'learn' },
      { target: '#tasks-block', title: 'Do it, do not just read it',
        text: 'Each lesson asks you to run something. The simulator watches what you actually do and ticks these off itself — you cannot click your way past them.',
        view: 'learn' },
      { target: '#quiz-block', title: 'Check yourself',
        text: 'A short quiz per lesson. A wrong answer explains itself and lets you try again; progress is saved in this browser.',
        view: 'learn' },
      { target: '#term', title: 'A working Herdr client',
        text: 'Not a screenshot. Click it, then type — try herdr status, or ls. It has a filesystem with three projects, real panes, and agents with real states.',
        view: 'sim' },
      { target: '#side', title: 'spaces on top, agents below',
        text: 'The sidebar is split in half, exactly as Herdr splits it. Spaces show their git branch; agents show their space, tab and name, colour-coded by state.',
        view: 'sim' },
      { target: '#tabbar', title: 'Tabs, and the mouse',
        text: 'Click a tab, drag a split border, right-click a pane or tab for its menu, double-click a token to copy it. Herdr is mouse-native and so is this.',
        view: 'sim' },
      { target: '#statusbar', title: 'ctrl+b is the prefix',
        text: 'Press ctrl+b then v to split right, - to split down, c for a tab, w for spaces, q to detach. The mode indicator here tells you which mode you are in.',
        view: 'sim' },
      { target: '#btn-curriculum', title: 'Jump around',
        text: 'Curriculum lists all twelve lessons with your progress against each, so you can skip ahead or go back to one you want to redo.',
        view: 'learn' },
      { target: '.progress', title: 'Your progress',
        text: 'This fills as you finish tasks and answer quiz questions — 86 of them across the course. It is saved in this browser, so you can close the tab and come back.',
        view: 'learn' },
      { target: '.topbar-right', title: 'And the tools up here',
        text: 'Keys is the full keybinding and CLI cheat sheet. Docs opens the real herdr.dev. Tour replays this walkthrough. Reset clears your progress and restarts the simulated server.',
        view: 'learn' }
    ];
  }

  /* ---------- the opening offer ---------- */
  Tour.prototype.offer = function (force) {
    let seen = false;
    try { seen = localStorage.getItem(SEEN) === '1'; } catch (e) { /* private mode */ }
    if (seen && !force) return;

    const card = document.createElement('div');
    card.className = 'tour-offer';
    card.innerHTML =
      '<div class="to-eyebrow">herdr101 · unofficial</div>' +
      '<h2>Learn Herdr by doing</h2>' +
      '<p>Lessons on the left, a working Herdr terminal on the right. This is an unofficial course — nothing here talks to a real Herdr server. Want a quick tour?</p>' +
      '<div class="to-actions">' +
      '<button class="btn primary" data-x="start">Show me around</button>' +
      '<button class="btn" data-x="skip">No thanks, I will explore</button>' +
      '</div>';
    const veil = document.createElement('div');
    veil.className = 'tour-offer-veil';
    veil.appendChild(card);
    document.body.appendChild(veil);

    const close = () => { veil.remove(); this.remember(); };
    card.querySelector('[data-x="start"]').addEventListener('click', () => { close(); this.start(); });
    card.querySelector('[data-x="skip"]').addEventListener('click', close);
    veil.addEventListener('mousedown', (ev) => { if (ev.target === veil) close(); });
    setTimeout(() => card.querySelector('[data-x="start"]').focus(), 30);
  };

  Tour.prototype.remember = function () {
    try { localStorage.setItem(SEEN, '1'); } catch (e) { /* ignore */ }
  };

  /* ---------- the walkthrough ---------- */
  Tour.prototype.start = function () {
    this.remember();
    this.i = 0;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'tour';
      this.el.innerHTML =
        '<div class="tour-hole"></div>' +
        '<div class="tour-pop">' +
        '<div class="tp-head"><span class="tp-step"></span><button class="tp-x" aria-label="End tour">esc</button></div>' +
        '<h3 class="tp-title"></h3><p class="tp-text"></p>' +
        '<div class="tp-foot"><span class="tp-dots"></span>' +
        '<span class="tp-nav"><button class="btn tiny" data-x="back">Back</button>' +
        '<button class="btn tiny primary" data-x="next">Next</button></span></div></div>';
      document.body.appendChild(this.el);

      this.el.querySelector('.tp-x').addEventListener('click', () => this.stop());
      this.el.querySelector('[data-x="next"]').addEventListener('click', () => this.go(1));
      this.el.querySelector('[data-x="back"]').addEventListener('click', () => this.go(-1));
      this._key = (ev) => {
        if (!this.el || this.el.hidden) return;
        if (ev.key === 'Escape') { ev.preventDefault(); this.stop(); }
        if (ev.key === 'ArrowRight' || ev.key === 'Enter') { ev.preventDefault(); this.go(1); }
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.go(-1); }
      };
      document.addEventListener('keydown', this._key, true);
      this._resize = () => this.place();
      window.addEventListener('resize', this._resize);
    }
    this.el.hidden = false;
    document.body.classList.add('tour-on');
    this.place();
  };

  Tour.prototype.stop = function () {
    if (!this.el) return;
    this.el.hidden = true;
    document.body.classList.remove('tour-on');
    const t = this.lab.sim;
    if (t && t.el && t.el.term) t.el.term.focus();
  };

  Tour.prototype.go = function (d) {
    const n = this.i + d;
    if (n < 0) return;
    if (n >= this.steps.length) return this.stop();
    this.i = n;
    this.place(d);
  };

  /* Is this target actually rendered? Checked by computed style rather than by
     measured size: a box can measure zero mid-layout, and the things we skip
     (the progress bar on a phone) are hidden with display:none anyway. */
  Tour.prototype.shown = function (sel) {
    let el = document.querySelector(sel);
    if (!el) return false;
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.hidden) return false;
      const st = window.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
      el = el.parentElement;
    }
    return true;
  };

  Tour.prototype.place = function (dir) {
    const step = this.steps[this.i];
    if (this.lab.showView) this.lab.showView(step.view);

    // skip anything this viewport hides (the progress bar on a phone, say)
    if (!this.shown(step.target)) {
      const d = dir || 1;
      const n = this.i + d;
      if (n < 0 || n >= this.steps.length) return this.stop();
      this.i = n;
      return this.place(d);
    }

    const target = document.querySelector(step.target);
    const hole = this.el.querySelector('.tour-hole');
    const pop = this.el.querySelector('.tour-pop');

    this.el.querySelector('.tp-step').textContent =
      'Step ' + (this.i + 1) + ' of ' + this.steps.length;
    this.el.querySelector('.tp-title').textContent = step.title;
    this.el.querySelector('.tp-text').textContent = step.text;
    this.el.querySelector('.tp-dots').innerHTML =
      this.steps.map((s, i) => '<i class="' + (i === this.i ? 'on' : '') + '"></i>').join('');
    this.el.querySelector('[data-x="back"]').disabled = this.i === 0;
    this.el.querySelector('[data-x="next"]').textContent =
      this.i === this.steps.length - 1 ? 'Done' : 'Next';

    if (!target || !target.offsetParent && target.offsetHeight === 0) {
      hole.style.display = 'none';
      pop.style.left = '50%'; pop.style.top = '50%';
      pop.style.transform = 'translate(-50%,-50%)';
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = 6;
    hole.style.display = 'block';
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (Math.min(r.height, window.innerHeight - r.top - 20) + pad * 2) + 'px';

    /* park the bubble on whichever side has room */
    pop.style.transform = 'none';
    const pw = 330, ph = pop.offsetHeight || 190, gap = 14;
    let left = r.left + r.width / 2 - pw / 2;
    let top = r.bottom + gap;
    if (top + ph > window.innerHeight - 10) top = Math.max(10, r.top - ph - gap);
    if (r.width > window.innerWidth * 0.45 && r.left > pw + gap * 2) left = r.left - pw - gap;
    left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
    top = Math.max(10, Math.min(top, window.innerHeight - ph - 10));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  };

  global.HerdrTour = Tour;
})(window);
