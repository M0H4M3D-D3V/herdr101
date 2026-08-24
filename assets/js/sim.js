/* ============================================================
   sim.js — the Herdr client: sidebar, tabs, pane grid, status bar,
   three input modes (terminal / prefix / navigate), mouse focus
   and draggable split borders.
   ============================================================ */
(function (global) {
  'use strict';

  const V = global.HerdrVFS;
  const ICON = global.HERDR_STATE_ICON;

  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* prefix-mode keymap: key -> {action, label} */
  const PREFIX_KEYS = {
    v:        { act: 'split-right',   label: 'split right' },
    '-':      { act: 'split-down',    label: 'split down' },
    c:        { act: 'new-tab',       label: 'new tab' },
    n:        { act: 'next-tab',      label: 'next tab' },
    p:        { act: 'prev-tab',      label: 'previous tab' },
    w:        { act: 'navigate',      label: 'navigate spaces' },
    N:        { act: 'new-workspace', label: 'new workspace' },
    q:        { act: 'detach',        label: 'detach' },
    x:        { act: 'close-pane',    label: 'close pane' },
    g:        { act: 'goto-pane',     label: 'next pane' },
    o:        { act: 'goto-pane',     label: 'next pane' },
    z:        { act: 'zoom',          label: 'zoom pane' }
  };

  function Sim(engine, shell) {
    this.e = engine;
    this.sh = shell;
    this.el = {
      term: $('term'), side: $('side'), tabbar: $('tabbar'), grid: $('grid'),
      status: $('statusbar'), veil: $('term-veil'), detached: $('detached'),
      chipMode: $('chip-mode'), chipSession: $('chip-session')
    };
    this.focused = false;
    this.zoom = null;
    this.navSel = 0;
    this.hint = '';
    this.bind();
    this.e.on(() => this.render());
    this.render();
  }

  /* ---------------- input ---------------- */
  Sim.prototype.bind = function () {
    const el = this.el.term;

    el.addEventListener('focus', () => { this.focused = true; el.classList.add('focused'); this.render(); });
    el.addEventListener('blur', () => { this.focused = false; el.classList.remove('focused'); this.render(); });
    this.el.veil.addEventListener('click', () => el.focus());
    el.addEventListener('mousedown', (ev) => {
      if (!this.focused && !(ev.target && ev.target.closest && ev.target.closest('button'))) el.focus();
    });

    el.addEventListener('keydown', (ev) => this.onKey(ev));

    document.addEventListener('mousedown', (ev) => {
      // ev.target can be the document itself, which has no closest()
      if (!(ev.target && ev.target.closest && ev.target.closest('.ctx'))) this.closeMenu();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') this.closeMenu(); });
    window.addEventListener('blur', () => this.closeMenu());

    $('btn-attach').addEventListener('click', () => { this.e.attach(); el.focus(); });
    $('btn-sim-reset').addEventListener('click', () => {
      this.e.reset();
      this.toast('server restarted — fresh session');
    });
  };

  Sim.prototype.setMode = function (mode) {
    if (this.e.mode === mode) return;
    this.e.mode = mode;
    this.e.emit('mode.change', { mode: mode });
  };

  Sim.prototype.onKey = function (ev) {
    const e = this.e;
    if (this.dialogOpen) return;            // the dialog's input has the keys
    if (!e.attached) {
      if (ev.key === 'Enter') { e.attach(); ev.preventDefault(); }
      return;
    }

    // ── prefix mode ──────────────────────────────────────────
    if (e.mode === 'prefix') {
      ev.preventDefault();
      if (ev.key === 'Escape') { this.setMode('terminal'); this.hint = ''; return this.render(); }
      const k = ev.shiftKey && /^[a-z]$/i.test(ev.key) ? ev.key.toUpperCase() : ev.key;
      const binding = PREFIX_KEYS[k] || PREFIX_KEYS[ev.key];
      this.setMode('terminal');
      if (!binding) { this.hint = 'no binding for ' + k; return this.render(); }
      return this.doAction(binding.act);
    }

    // ── navigate mode ────────────────────────────────────────
    if (e.mode === 'navigate') {
      ev.preventDefault();
      const ws = e.workspaces;
      if (ev.key === 'Escape' || ev.key === 'q') { this.setMode('terminal'); return this.render(); }
      if (ev.key === 'j' || ev.key === 'ArrowDown') { this.navSel = Math.min(ws.length - 1, this.navSel + 1); return this.render(); }
      if (ev.key === 'k' || ev.key === 'ArrowUp') { this.navSel = Math.max(0, this.navSel - 1); return this.render(); }
      if (ev.key === 'l' || ev.key === 'ArrowRight') { e.cycleTab(1); return; }
      if (ev.key === 'h' || ev.key === 'ArrowLeft') { e.cycleTab(-1); return; }
      if (ev.key === 'Enter') {
        this.setMode('terminal');
        e.focusWorkspace(ws[this.navSel].id);
        return;
      }
      return this.render();
    }

    // ── terminal mode ────────────────────────────────────────
    if (ev.ctrlKey && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      this.setMode('prefix');
      this.hint = 'prefix: v split right · - split down · c tab · n/p tabs · w spaces · N space · x close · q detach';
      return this.render();
    }

    const pane = e.activePane();
    if (!pane) return;

    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      if (ev.ctrlKey && ev.key.toLowerCase() === 'c') {
        ev.preventDefault();
        this.e.write(pane, this.promptLine(pane) + pane.input + '^C', '');
        pane.input = '';
        if (pane.agent) this.e.stopAgent(pane);
        return this.render();
      }
      if (ev.ctrlKey && ev.key.toLowerCase() === 'l') { ev.preventDefault(); return this.e.clearPane(pane); }
      return;
    }

    if (ev.key === 'Enter') {
      ev.preventDefault();
      const line = pane.input;
      this.e.write(pane, this.promptLine(pane) + line, '');
      pane.input = '';
      this.sh.run(pane, line);
      return this.render();
    }
    if (ev.key === 'Backspace') { ev.preventDefault(); pane.input = pane.input.slice(0, -1); return this.render(); }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      pane.input = this.complete(pane, pane.input);
      return this.render();
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!pane.history.length) return;
      pane.histIdx = pane.histIdx < 0 ? pane.history.length - 1 : Math.max(0, pane.histIdx - 1);
      pane.input = pane.history[pane.histIdx];
      return this.render();
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (pane.histIdx < 0) return;
      pane.histIdx += 1;
      if (pane.histIdx >= pane.history.length) { pane.histIdx = -1; pane.input = ''; }
      else pane.input = pane.history[pane.histIdx];
      return this.render();
    }
    if (ev.key.length === 1) {
      ev.preventDefault();
      // an agent waiting on approval takes single keys directly
      if (pane.agent && pane.pending && (ev.key === 'y' || ev.key === 'n')) {
        this.e.answerAgent(pane, ev.key);
        return this.render();
      }
      pane.input += ev.key;
      return this.render();
    }
  };

  /* tab-completion over the filesystem and command names */
  Sim.prototype.complete = function (pane, input) {
    const parts = input.split(' ');
    const frag = parts[parts.length - 1];
    if (parts.length === 1) {
      const cmds = ['ls', 'cd', 'cat', 'tree', 'pwd', 'mkdir', 'touch', 'mv', 'cp', 'rm', 'echo', 'clear',
        'help', 'exit', 'git', 'npm', 'pytest', 'cargo', 'herdr', 'claude', 'codex', 'opencode', 'pi'];
      const hit = cmds.filter(c => c.startsWith(frag));
      return hit.length === 1 ? hit[0] + ' ' : input;
    }
    const slash = frag.lastIndexOf('/');
    const dirPart = slash >= 0 ? frag.slice(0, slash + 1) : '';
    const namePart = slash >= 0 ? frag.slice(slash + 1) : frag;
    const base = V.normalize(dirPart || '.', pane.cwd);
    const items = this.e.fs.list(base, namePart.startsWith('.')) || [];
    const hits = items.filter(i => i.name.startsWith(namePart));
    if (hits.length !== 1) return input;
    parts[parts.length - 1] = dirPart + hits[0].name + (hits[0].type === 'dir' ? '/' : '');
    return parts.join(' ');
  };

  /* ---------------- prefix actions ---------------- */
  Sim.prototype.doAction = function (act) {
    const e = this.e;
    const pane = e.activePane();
    let r;
    switch (act) {
      case 'split-right': r = e.split(pane.gid, 'right'); break;
      case 'split-down':  r = e.split(pane.gid, 'down'); break;
      case 'new-tab':     e.createTab(e.activeWorkspace(), {}); break;
      case 'next-tab':    e.cycleTab(1); break;
      case 'prev-tab':    e.cycleTab(-1); break;
      case 'goto-pane':   e.cyclePane(1); break;
      case 'close-pane':  r = e.closePane(pane.gid); break;
      case 'detach':      e.detach(); break;
      case 'zoom':
        this.zoom = this.zoom ? null : pane.gid;
        this.hint = this.zoom ? 'pane zoomed — prefix z to restore' : '';
        break;
      case 'navigate':
        this.setMode('navigate');
        this.navSel = Math.max(0, e.workspaces.findIndex(w => w.id === e.activeWs));
        this.hint = 'navigate: j/k space · h/l tab · enter select · esc exit';
        break;
      case 'new-workspace': {
        const ws = e.createWorkspace({ cwd: pane ? pane.cwd : V.HOME });
        e.focusWorkspace(ws.id);
        break;
      }
    }
    if (r && r.err) this.toast(r.err);
    this.render();
  };

  Sim.prototype.promptLine = function (pane) {
    return 'dev@workbox ' + V.pretty(pane.cwd) + ' $ ';
  };

  /* ---------------- render ---------------- */
  Sim.prototype.render = function () {
    const e = this.e;
    this.el.detached.hidden = e.attached;
    this.el.chipSession.textContent = 'session: ' + e.sessionName;
    const modeName = e.mode.toUpperCase();
    this.el.chipMode.textContent = modeName;
    this.el.chipMode.dataset.mode = modeName;

    this.renderSide();
    this.renderTabs();
    this.renderGrid();
    this.renderStatus();
    this.scrollPanes();
  };

  /* Sidebar rows follow herdr's documented defaults:
       [ui.sidebar.spaces] rows = [["state_icon","workspace"], ["branch","git_status"]]
       [ui.sidebar.agents] rows = [["state_icon","workspace","tab"], ["agent"]]   */
  Sim.prototype.renderSide = function () {
    const e = this.e;

    /* top half — spaces, with the new / menu actions pinned at its bottom */
    let h = '<div class="side-half spaces">' +
      '<div class="side-h"><span>spaces</span><span class="side-n">' + e.workspaces.length + '</span></div>' +
      '<div class="side-list">';
    e.workspaces.forEach((w, i) => {
      const st = e.wsState(w);
      const git = e.wsGit(w);
      const sel = e.mode === 'navigate' && i === this.navSel;
      h += '<div class="row ws-row' + (w.id === e.activeWs ? ' on' : '') + (sel ? ' sel' : '') +
        '" data-ws="' + w.id + '">' +
        '<span class="dotstate ' + (st ? 's-' + st : 's-none') + '"></span>' +
        '<div><span class="t-workspace">' + esc(w.name) + '</span>' +
        (git.branch
          ? '<div class="r-sub"><span class="t-branch">' + esc(git.branch) + '</span>' +
            (git.status ? '<span class="t-git">' + esc(git.status) + '</span>' : '') + '</div>'
          : '') +
        '</div></div>';
    });
    h += '</div>' +
      '<div class="side-foot">' +
      '<button class="side-act" data-act="new" title="new space (ctrl+b shift+N)">' +
      '<span class="sa-ico">＋</span>new</button>' +
      '<button class="side-act" data-act="menu" title="herdr menu">' +
      '<span class="sa-ico">☰</span>menu</button>' +
      '</div></div>';

    /* bottom half — agents */
    const agents = e.agents();
    h += '<div class="side-half agents">' +
      '<div class="side-h"><span>agents</span><span class="side-tag">grouped</span>' +
      '<span class="side-n">' + agents.length + '</span></div><div class="side-list">';
    if (!agents.length) h += '<div class="side-empty">none running</div>';
    agents.forEach(a => {
      const ws = e.ws(a.pane.wsId);
      const loc = e.tabOfPane(a.pane);
      const on = a.pane.gid === (e.activeTab() || {}).activePane;
      h += '<div class="row ag-row' + (on ? ' on' : '') + '" data-pane="' + a.pane.gid + '">' +
        '<span class="dotstate s-' + a.agent.state + '"></span>' +
        '<div><span class="t-workspace">' + esc(ws ? ws.name : '') +
        '<span class="t-tab"> ' + esc(loc ? loc.tab.name : '') + '</span></span>' +
        '<div class="r-sub"><span class="t-agent">' + esc(a.agent.name) + '</span></div>' +
        '</div></div>';
    });
    h += '</div></div>';

    this.el.side.innerHTML = h;
    const foot = this.el.side.querySelector('[data-act="new"]');
    if (foot) foot.addEventListener('click', () => {
      const p = e.activePane();
      this.dialog({
        title: 'new space', label: 'directory', confirm: 'create',
        value: V.pretty(p ? p.cwd : V.HOME),
        onConfirm: (dir) => {
          const abs = V.normalize(dir || '~', p ? p.cwd : V.HOME);
          if (!e.fs.isDir(abs)) return this.toast('no such directory: ' + esc(dir));
          const ws = e.createWorkspace({ cwd: abs });
          e.focusWorkspace(ws.id);
        }
      });
    });
    const menuBtn = this.el.side.querySelector('[data-act="menu"]');
    if (menuBtn) menuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      this.menuHerdr({ clientX: Math.round(r.left), clientY: Math.round(r.top) });
    });
    this.el.side.querySelectorAll('[data-ws]').forEach(n => {
      n.addEventListener('mousedown', () => { this.e.focusWorkspace(n.dataset.ws); this.el.term.focus(); });
      n.addEventListener('contextmenu', (ev) => this.menuWorkspace(ev, n.dataset.ws));
    });
    this.el.side.querySelectorAll('[data-pane]').forEach(n => {
      n.addEventListener('mousedown', () => { this.e.focusPane(n.dataset.pane); this.el.term.focus(); });
      n.addEventListener('contextmenu', (ev) => this.menuPane(ev, n.dataset.pane));
    });
  };

  Sim.prototype.renderTabs = function () {
    const e = this.e, w = e.activeWorkspace();
    if (!w) return;
    let h = '';
    w.tabs.forEach((t, i) => {
      const blocked = t.panes.some(p => p.agent && p.agent.state === 'blocked');
      h += '<div class="tab ' + (t.id === w.activeTab ? 'on' : '') + '" data-tab="' + t.id + '">' +
        '<span class="tnum">' + (i + 1) + '</span>' + esc(t.name) +
        (blocked ? ' <span class="dotstate s-blocked">' + ICON.blocked + '</span>' : '') + '</div>';
    });
    h += '<div class="tab-add" data-add="1" title="new tab (ctrl+b c)">+</div>';

    /* [ui] tab_bar_right = [ zoom, hostname, datetime ] · separator " · " */
    const now = new Date();
    const clock = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const right = (this.zoom ? ['ZOOM'] : []).concat(['workbox', clock]);
    h += '<div class="tabbar-right">' +
      right.map((x, i) => '<span class="' + (i === 0 && this.zoom ? 'tb-zoom' : '') + '">' + esc(x) + '</span>')
        .join('<span class="tb-sep">·</span>') + '</div>';

    this.el.tabbar.innerHTML = h;
    this.el.tabbar.querySelectorAll('[data-tab]').forEach(n => {
      n.addEventListener('mousedown', (ev) => {
        if (ev.button === 2) return;
        this.e.focusTab(n.dataset.tab); this.el.term.focus();
      });
      n.addEventListener('contextmenu', (ev) => this.menuTab(ev, n.dataset.tab));
    });
    const add = this.el.tabbar.querySelector('[data-add]');
    if (add) add.addEventListener('mousedown', () => { this.e.createTab(w, {}); this.el.term.focus(); });
  };

  Sim.prototype.paneHTML = function (pane, active) {
    const a = pane.agent;
    let body = '';
    pane.lines.forEach(l => { body += '<div class="ln ' + (l.cls || '') + '">' + (esc(l.text) || '&nbsp;') + '</div>'; });
    if (!pane.busy) {
      body += '<div class="promptline"><span class="ps1">' +
        (a ? '<span class="o-acc">' + esc(a.name) + ' &gt;</span>' :
          'dev@workbox <span class="p-cwd">' + esc(V.pretty(pane.cwd)) + '</span> $') +
        '</span><span class="typed">' + esc(pane.input) + '</span><span class="cursor"></span></div>';
    }

    /* an agent draws its own footer at the bottom of the pane, as in herdr's mock:
       ~/path > branch * ↑1 > ctx ────── 3% 31k/1M                                  */
    let footer = '';
    if (a) {
      const git = this.e.fs.gitInfo(pane.cwd);
      const pct = Math.min(94, a.ctx || 3);
      const filled = Math.round(pct / 14);
      footer = '<div class="agent-footer">' +
        '<span class="af-cwd">' + esc(V.pretty(pane.cwd)) + '</span>' +
        (git ? '<span class="af-sep">&gt;</span><span class="af-branch">' + esc(git.branch) + '</span>' +
          (git.status ? '<span class="af-git">' + esc(git.status) + '</span>' : '') : '') +
        '<span class="af-sep">&gt;</span><span class="af-ctx">ctx ' +
        '─'.repeat(filled) + '<span class="af-dim">' + '─'.repeat(Math.max(0, 7 - filled)) + '</span> ' +
        pct + '% ' + Math.round(pct * 10.3) + 'k/1M</span></div>';
    }
    /* herdr draws a pane as a bordered box and nothing else — no title bar and
       no state label. Which pane is focused is the border colour; which pane
       you are in is the status bar; agent state is the sidebar's job. */
    return '<div class="pane ' + (active ? 'on' : '') + '" data-pgid="' + pane.gid +
      '" title="' + pane.gid + ' ' + esc(pane.title) + '">' +
      '<div class="pane-body">' + body + '</div>' + footer + '</div>';
  };

  Sim.prototype.renderGrid = function () {
    const e = this.e, tab = e.activeTab();
    if (!tab) { this.el.grid.innerHTML = ''; return; }

    /* herdr draws no pane border when the tab holds one pane — the terminal
       frame is the boundary. Its own stylesheet does the same:
       .mock-panes.single .mock-pane::before { content: none } */
    const solo = tab.panes.length === 1 || !!this.zoom;
    this.el.grid.classList.toggle('single', solo);

    if (this.zoom && tab.panes.some(p => p.gid === this.zoom)) {
      this.el.grid.innerHTML = this.paneHTML(e.pane(this.zoom), true);
    } else {
      const build = (node, path) => {
        if (node.t === 'p') {
          const p = e.pane(node.gid);
          return p ? this.paneHTML(p, p.gid === tab.activePane) : '';
        }
        const cls = node.dir === 'col' ? 'node--col' : 'node--row';
        const dcls = node.dir === 'col' ? 'h' : 'v';
        return '<div class="node ' + cls + '" style="flex:1 1 0">' +
          '<div class="node-cell" style="flex:' + node.ratio + ' 1 0">' + build(node.a, path.concat('a')) + '</div>' +
          '<div class="divider ' + dcls + '" data-path=\'' + JSON.stringify(path) + '\'></div>' +
          '<div class="node-cell" style="flex:' + (1 - node.ratio) + ' 1 0">' + build(node.b, path.concat('b')) + '</div>' +
          '</div>';
      };
      this.el.grid.innerHTML = build(tab.layout, []);
    }

    this.el.grid.querySelectorAll('[data-pgid]').forEach(n => {
      n.addEventListener('mousedown', (ev) => {
        if (ev.button === 2) return;                 // right-click focuses via the menu
        this.e.focusPane(n.dataset.pgid);
        this.el.term.focus();
      });
      n.addEventListener('contextmenu', (ev) => this.menuPane(ev, n.dataset.pgid));
      // double-click a token to copy it, without needing ctrl+c
      n.addEventListener('dblclick', () => {
        const sel = String(window.getSelection());
        if (sel.trim()) this.copy(sel.trim(), 'copied "' + sel.trim().slice(0, 28) + '"');
      });
    });
    this.el.grid.querySelectorAll('.divider').forEach(d => this.bindDivider(d, tab));
  };

  Sim.prototype.bindDivider = function (d, tab) {
    d.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const path = JSON.parse(d.dataset.path);
      const parent = d.parentElement;
      const vertical = d.classList.contains('v');
      const rect = parent.getBoundingClientRect();
      if (!rect.width || !rect.height) return;      // nothing laid out yet
      const move = (m) => {
        const ratio = vertical
          ? (m.clientX - rect.left) / rect.width
          : (m.clientY - rect.top) / rect.height;
        this.e.resizeSplit(tab, path, ratio);
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  };

  Sim.prototype.renderStatus = function () {
    const e = this.e, w = e.activeWorkspace(), t = e.activeTab(), p = e.activePane();
    const agents = e.agents();
    const blocked = agents.filter(a => a.agent.state === 'blocked').length;
    const working = agents.filter(a => a.agent.state === 'working').length;
    const mode = e.mode.toUpperCase();
    this.el.status.innerHTML =
      '<span class="sb-mode" data-mode="' + mode + '">' + mode + '</span>' +
      '<span>' + esc(w ? w.name : '—') + ' · ' + esc(t ? t.name : '—') + ' · ' + (p ? p.gid : '—') + '</span>' +
      (this.hint ? '<span class="o-dim">' + esc(this.hint) + '</span>' : '') +
      '<span class="sb-right">' +
      (blocked ? '<span class="sb-count s-blocked"><span class="dotstate"></span>' + blocked + ' blocked</span>' : '') +
      (working ? '<span class="sb-count s-working"><span class="dotstate"></span>' + working + ' working</span>' : '') +
      '<span>' + e.workspaces.length + ' spaces</span>' +
      '<span>ctrl+b</span></span>';
  };

  /* ---------------- right-click context menus ----------------
     herdr is mouse-native: click to focus, right-click for a menu,
     drag a border to resize, double-click a token to copy it.      */
  Sim.prototype.closeMenu = function () {
    const old = document.querySelector('.ctx');
    if (old) old.remove();
  };

  Sim.prototype.openMenu = function (ev, head, items) {
    if (ev && ev.preventDefault) { ev.preventDefault(); ev.stopPropagation(); }
    this.closeMenu();
    const m = document.createElement('div');
    m.className = 'ctx';
    m.innerHTML = (head ? '<div class="ctx-head">' + esc(head) + '</div>' : '') +
      items.map((it, i) => it.sep
        ? '<div class="ctx-sep"></div>'
        : '<button data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' +
          '<span>' + esc(it.label) + '</span>' +
          (it.key ? '<span class="ctx-key">' + esc(it.key) + '</span>' : '') + '</button>'
      ).join('');
    document.body.appendChild(m);

    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(ev.clientX, window.innerWidth - w - 8) + 'px';
    m.style.top = Math.min(ev.clientY, window.innerHeight - h - 8) + 'px';

    m.querySelectorAll('button[data-i]').forEach(b => {
      b.addEventListener('click', () => {
        const it = items[parseInt(b.dataset.i, 10)];
        this.closeMenu();
        if (it && it.run) it.run();
        this.el.term.focus();
        this.render();
      });
    });
  };

  /* ---------------- dialogs ----------------
     herdr draws its own prompts inside the terminal, so nothing here uses
     the browser's prompt()/confirm() chrome. */
  Sim.prototype.closeDialog = function () {
    const old = document.querySelector('.tdialog-veil');
    if (old) old.remove();
    this.dialogOpen = false;
  };

  Sim.prototype.dialog = function (opts) {
    opts = opts || {};
    this.closeDialog();
    this.closeMenu();
    this.dialogOpen = true;

    const host = opts.fixed ? document.body : this.el.term;
    const veil = document.createElement('div');
    veil.className = 'tdialog-veil' + (opts.fixed ? ' fixed' : '');
    const isInput = opts.input !== false;
    veil.innerHTML = '<div class="tdialog" role="dialog" aria-modal="true">' +
      '<div class="td-head">' + esc(opts.title || 'herdr') + '</div>' +
      (opts.body ? '<div class="td-body">' + esc(opts.body) + '</div>' : '') +
      (isInput
        ? (opts.label ? '<label class="td-label" for="td-in">' + esc(opts.label) + '</label>' : '') +
          '<input class="td-input" id="td-in" type="text" spellcheck="false" autocomplete="off">'
        : '') +
      '<div class="td-foot"><span class="td-hint"><b>enter</b> ' + esc(opts.confirm || 'confirm') +
      ' · <b>esc</b> cancel</span><span class="td-actions">' +
      '<button class="td-btn" data-x="cancel">cancel</button>' +
      '<button class="td-btn primary' + (opts.danger ? ' danger' : '') + '" data-x="ok">' +
      esc(opts.confirm || 'ok') + '</button></span></div></div>';
    host.appendChild(veil);

    const input = veil.querySelector('.td-input');
    if (input) {
      input.value = opts.value == null ? '' : opts.value;
      if (opts.placeholder) input.placeholder = opts.placeholder;
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    const done = (ok) => {
      const val = input ? input.value.trim() : '';
      this.closeDialog();
      this.el.term.focus();
      if (ok && opts.onConfirm) opts.onConfirm(val);
      this.render();
    };

    veil.addEventListener('mousedown', (ev) => { if (ev.target === veil) done(false); });
    veil.querySelector('[data-x="cancel"]').addEventListener('click', () => done(false));
    veil.querySelector('[data-x="ok"]').addEventListener('click', () => done(true));
    veil.addEventListener('keydown', (ev) => {
      ev.stopPropagation();                 // the pane must not see these keys
      if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
    });
    if (!input) veil.querySelector('[data-x="ok"]').focus();
  };

  /* the herdr menu behind the sidebar's "menu" action: session-level things */
  Sim.prototype.menuHerdr = function (at) {
    const e = this.e, pane = e.activePane();
    this.openMenu(at, 'herdr · session ' + e.sessionName, [
      { label: 'New space', key: 'ctrl+b N', run: () => {
          const ws = e.createWorkspace({ cwd: pane ? pane.cwd : undefined });
          e.focusWorkspace(ws.id);
        } },
      { label: 'New tab', key: 'ctrl+b c', run: () => e.createTab(e.activeWorkspace(), {}) },
      { label: 'Split right', key: 'ctrl+b v', disabled: !pane, run: () => e.split(pane.gid, 'right') },
      { label: 'Split down', key: 'ctrl+b -', disabled: !pane, run: () => e.split(pane.gid, 'down') },
      { sep: true },
      { label: 'Keybindings…', run: () => {
          document.getElementById('keys-sheet').hidden = false;
          document.getElementById('keys-veil').hidden = false;
        } },
      { label: 'Reload config', run: () => {
          if (pane) this.sh.run(pane, 'herdr server reload-config');
        } },
      { sep: true },
      { label: 'Detach', key: 'ctrl+b q', run: () => e.detach() },
      { label: 'Stop server', run: () => {
          if (pane) this.sh.run(pane, 'herdr server stop');
        } }
    ]);
  };

  Sim.prototype.menuPane = function (ev, gid) {
    const e = this.e, pane = e.pane(gid);
    if (!pane) return;
    e.focusPane(gid);
    this.openMenu(ev, gid + '  ' + pane.title, [
      { label: 'Split right', key: 'ctrl+b v', run: () => e.split(gid, 'right') },
      { label: 'Split down', key: 'ctrl+b -', run: () => e.split(gid, 'down') },
      { sep: true },
      { label: this.zoom === gid ? 'Unzoom pane' : 'Zoom pane', key: 'ctrl+b z',
        run: () => { this.zoom = this.zoom === gid ? null : gid; } },
      { label: 'Rename pane…', run: () => this.dialog({
          title: 'rename pane ' + gid, label: 'pane title', value: pane.title,
          confirm: 'rename', onConfirm: (t) => { if (t) e.renamePane(gid, t); }
        }) },
      { label: 'Copy pane text', run: () => {
          this.copy(pane.lines.map(l => l.text).join('\n'), 'pane text copied');
        } },
      { sep: true },
      pane.agent
        ? { label: 'Stop ' + pane.agent.label, run: () => e.stopAgent(pane) }
        : { label: 'Start claude here', run: () => e.startAgent(pane, 'claude', {}) },
      { label: 'Close pane', key: 'ctrl+b x', run: () => {
          const r = e.closePane(gid);
          if (r && r.err) this.toast(r.err);
        } }
    ]);
  };

  Sim.prototype.menuTab = function (ev, tabId) {
    const e = this.e, w = e.activeWorkspace();
    const tab = w.tabs.find(t => t.id === tabId);
    if (!tab) return;
    e.focusTab(tabId);
    this.openMenu(ev, tab.name, [
      { label: 'New tab', key: 'ctrl+b c', run: () => e.createTab(w, {}) },
      { label: 'Rename tab…', run: () => this.dialog({
          title: 'rename tab ' + tabId, label: 'tab name', value: tab.name,
          confirm: 'rename', onConfirm: (n) => { if (n) e.renameTab(tabId, n); }
        }) },
      { sep: true },
      { label: 'Close tab', disabled: w.tabs.length === 1, run: () => {
          const r = e.closeTab(tabId);
          if (r && r.err) this.toast(r.err);
        } }
    ]);
  };

  Sim.prototype.menuWorkspace = function (ev, wsId) {
    const e = this.e, ws = e.ws(wsId);
    if (!ws) return;
    this.openMenu(ev, ws.name + '  ' + wsId, [
      { label: 'Focus space', key: 'ctrl+b w', run: () => e.focusWorkspace(wsId) },
      { label: 'New space here', key: 'ctrl+b N', run: () => {
          const n = e.createWorkspace({ cwd: ws.cwd });
          e.focusWorkspace(n.id);
        } },
      { label: 'Rename space…', run: () => this.dialog({
          title: 'rename space ' + wsId, label: 'space name', value: ws.name,
          confirm: 'rename', onConfirm: (n) => { if (n) e.renameWorkspace(wsId, n); }
        }) },
      { sep: true },
      { label: 'Close space', disabled: e.workspaces.length === 1, run: () => this.dialog({
          title: 'close space ' + wsId, input: false, danger: true, confirm: 'close',
          body: 'Close ' + ws.name + '? Its tabs and panes go with it.',
          onConfirm: () => {
            const r = e.closeWorkspace(wsId);
            if (r && r.err) this.toast(r.err);
          }
        }) }
    ]);
  };

  Sim.prototype.copy = function (text, msg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    } catch (err) { /* clipboard blocked — the toast still says what happened */ }
    this.toast(msg || 'copied');
  };

  Sim.prototype.scrollPanes = function () {
    this.el.grid.querySelectorAll('.pane-body').forEach(b => { b.scrollTop = b.scrollHeight; });
  };

  /* ---------------- helpers used by the lesson side ---------------- */
  Sim.prototype.type = function (text, run) {
    const e = this.e;
    if (!e.attached) e.attach();
    let pane = e.activePane();
    if (!pane) return;

    // a herdr command needs a shell: an agent-owned pane would swallow it,
    // so land in a free pane the way you would in the real thing.
    if (pane.agent && /^herdr\b/.test(text)) {
      const tab = e.activeTab();
      const free = tab.panes.find(p => !p.agent);
      if (free) { e.focusPane(free.gid); }
      else { const r = e.split(pane.gid, 'right'); if (r.pane) e.focusPane(r.pane.gid); }
      pane = e.activePane();
    }
    this.el.term.focus();
    let i = 0;
    pane.input = '';
    const step = () => {
      if (i >= text.length) {
        if (run) {
          e.write(pane, this.promptLine(pane) + pane.input, '');
          const line = pane.input;
          pane.input = '';
          this.sh.run(pane, line);
        }
        return this.render();
      }
      pane.input += text[i++];
      this.render();
      setTimeout(step, 16);
    };
    step();
  };

  Sim.prototype.toast = function (msg, kind) {
    const stack = $('toasts');
    const n = document.createElement('div');
    n.className = 'toast' + (kind ? ' ' + kind : '');
    n.innerHTML = msg;
    stack.appendChild(n);
    setTimeout(() => { n.style.opacity = '0'; n.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => n.remove(), 3000);
  };

  Sim.prototype.PREFIX_KEYS = PREFIX_KEYS;
  global.HerdrSim = Sim;
  global.HERDR_PREFIX_KEYS = PREFIX_KEYS;
})(window);
