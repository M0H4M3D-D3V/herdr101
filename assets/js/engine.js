/* ============================================================
   engine.js — the Herdr model.
   session > workspace > tab > pane, plus agents attached to panes.
   Everything the UI shows and every CLI verb goes through here,
   and every mutation emits an event the lesson checker listens to.
   ============================================================ */
(function (global) {
  'use strict';

  const V = global.HerdrVFS;

  const AGENT_KINDS = {
    claude:        { label: 'Claude Code',       bin: 'claude',       integration: 'screen manifest' },
    codex:         { label: 'Codex',             bin: 'codex',        integration: 'screen manifest' },
    opencode:      { label: 'OpenCode',          bin: 'opencode',     integration: 'lifecycle plugin' },
    pi:            { label: 'Pi',                bin: 'pi',           integration: 'lifecycle hooks' },
    'cursor-agent':{ label: 'Cursor Agent',      bin: 'cursor-agent', integration: 'screen manifest' },
    copilot:       { label: 'GitHub Copilot CLI',bin: 'copilot',      integration: 'screen manifest' },
    gemini:        { label: 'Gemini CLI',        bin: 'gemini',       integration: 'partial' }
  };

  /* icons as herdr draws them: ● working, ◉ blocked, ○ idle.
     done shares ● with working and is told apart by colour, as in the app. */
  const STATE_ICON = { working: '●', blocked: '◉', done: '●', idle: '○', unknown: '◍' };
  const STATE_ORDER = ['blocked', 'working', 'done', 'idle', 'unknown'];

  /* ---------------- event bus ---------------- */
  function Bus() { this.subs = []; }
  Bus.prototype.on = function (fn) { this.subs.push(fn); };
  Bus.prototype.emit = function (type, data) {
    const ev = Object.assign({ type: type, at: Date.now() }, data || {});
    this.subs.slice().forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } });
  };

  /* ---------------- engine ---------------- */
  function Engine() {
    this.bus = new Bus();
    this.reset();
  }

  Engine.prototype.reset = function () {
    if (this._timers) this._timers.forEach(clearTimeout);
    this._timers = [];
    this.fs = new V.FS();
    this.sessionName = 'default';
    this.sessions = ['default'];
    this.attached = true;
    this.serverUp = true;
    this.mode = 'terminal';           // terminal | prefix | navigate
    this.workspaces = [];
    this.wsSeq = 0;
    this.tabSeq = 0;
    this.paneSeq = 0;
    this.activeWs = null;
    this.startedAt = Date.now();

    const ws = this.createWorkspace({ cwd: V.HOME + '/projects/api-gateway', name: 'api-gateway', silent: true });
    this.activeWs = ws.id;
    this.bus.emit('server.start', {});
  };

  Engine.prototype.on = function (fn) { this.bus.on(fn); };
  Engine.prototype.emit = function (t, d) { this.bus.emit(t, d); };
  Engine.prototype.later = function (fn, ms) { const id = setTimeout(fn, ms); this._timers.push(id); return id; };

  /* ---------------- lookups ---------------- */
  Engine.prototype.ws = function (id) { return this.workspaces.find(w => w.id === id) || null; };
  Engine.prototype.activeWorkspace = function () { return this.ws(this.activeWs); };
  Engine.prototype.activeTab = function () {
    const w = this.activeWorkspace();
    return w ? w.tabs.find(t => t.id === w.activeTab) || null : null;
  };
  Engine.prototype.activePane = function () {
    const t = this.activeTab();
    return t ? this.pane(t.activePane) : null;
  };
  Engine.prototype.pane = function (gid) {
    for (const w of this.workspaces) {
      for (const t of w.tabs) {
        for (const p of t.panes) if (p.gid === gid) return p;
      }
    }
    return null;
  };
  Engine.prototype.allPanes = function () {
    const out = [];
    this.workspaces.forEach(w => w.tabs.forEach(t => t.panes.forEach(p => out.push(p))));
    return out;
  };
  Engine.prototype.agents = function () {
    return this.allPanes().filter(p => p.agent).map(p => ({ pane: p, agent: p.agent }));
  };
  Engine.prototype.tabOfPane = function (p) {
    for (const w of this.workspaces) for (const t of w.tabs) if (t.panes.indexOf(p) >= 0) return { ws: w, tab: t };
    return null;
  };

  /* resolve "w1:p2" | "p2" | agent label | "" -> pane */
  Engine.prototype.resolve = function (target) {
    if (!target) return this.activePane();
    const t = String(target).trim();
    let p = this.pane(t);
    if (p) return p;
    if (/^p\d+$/.test(t)) {
      const w = this.activeWorkspace();
      p = this.pane(w.id + ':' + t);
      if (p) return p;
    }
    const byAgent = this.allPanes().find(x => x.agent && (x.agent.name === t || x.agent.label === t));
    return byAgent || null;
  };

  /* ---------------- workspaces ---------------- */
  Engine.prototype.createWorkspace = function (opts) {
    opts = opts || {};
    this.wsSeq += 1;
    const id = 'w' + this.wsSeq;
    const cwd = opts.cwd || V.HOME;
    const ws = {
      id: id,
      name: opts.name || opts.label || V.basename(cwd) || ('space-' + this.wsSeq),
      cwd: cwd,
      tabs: [],
      activeTab: null,
      paneSeq: 0
    };
    this.workspaces.push(ws);
    const tab = this.createTab(ws, { name: 'main', silent: true });
    ws.activeTab = tab.id;
    if (!opts.silent) this.emit('workspace.create', { ws: ws });
    return ws;
  };

  Engine.prototype.focusWorkspace = function (id) {
    const w = this.ws(id);
    if (!w) return { err: 'no such workspace: ' + id };
    this.activeWs = w.id;
    this.emit('workspace.focus', { ws: w });
    return { ok: true, ws: w };
  };

  Engine.prototype.renameWorkspace = function (id, name) {
    const w = this.ws(id);
    if (!w) return { err: 'no such workspace: ' + id };
    w.name = name;
    this.emit('workspace.rename', { ws: w, name: name });
    return { ok: true };
  };

  Engine.prototype.closeWorkspace = function (id) {
    if (this.workspaces.length === 1) return { err: 'cannot close the last workspace' };
    const i = this.workspaces.findIndex(w => w.id === id);
    if (i < 0) return { err: 'no such workspace: ' + id };
    const [gone] = this.workspaces.splice(i, 1);
    if (this.activeWs === gone.id) this.activeWs = this.workspaces[Math.max(0, i - 1)].id;
    this.emit('workspace.close', { id: id });
    return { ok: true };
  };

  /* ---------------- tabs ---------------- */
  Engine.prototype.createTab = function (ws, opts) {
    ws = ws || this.activeWorkspace();
    opts = opts || {};
    this.tabSeq += 1;
    const tab = { id: 't' + this.tabSeq, name: opts.name || ('tab' + (ws.tabs.length + 1)), panes: [], layout: null, activePane: null };
    const pane = this.newPane(ws, tab, opts.cwd || ws.cwd);
    tab.layout = { t: 'p', gid: pane.gid };
    tab.activePane = pane.gid;
    ws.tabs.push(tab);
    ws.activeTab = tab.id;
    if (!opts.silent) this.emit('tab.create', { ws: ws, tab: tab });
    return tab;
  };

  Engine.prototype.focusTab = function (idOrIndex) {
    const w = this.activeWorkspace();
    let tab = w.tabs.find(t => t.id === idOrIndex);
    if (!tab && /^\d+$/.test(String(idOrIndex))) tab = w.tabs[parseInt(idOrIndex, 10) - 1];
    if (!tab) return { err: 'no such tab: ' + idOrIndex };
    w.activeTab = tab.id;
    this.emit('tab.focus', { tab: tab });
    return { ok: true, tab: tab };
  };

  Engine.prototype.cycleTab = function (dir) {
    const w = this.activeWorkspace();
    const i = w.tabs.findIndex(t => t.id === w.activeTab);
    const n = (i + dir + w.tabs.length) % w.tabs.length;
    return this.focusTab(w.tabs[n].id);
  };

  Engine.prototype.renameTab = function (idOrName, name) {
    const w = this.activeWorkspace();
    const tab = w.tabs.find(t => t.id === idOrName) || this.activeTab();
    if (!tab) return { err: 'no such tab' };
    tab.name = name;
    this.emit('tab.rename', { tab: tab, name: name });
    return { ok: true };
  };

  Engine.prototype.closeTab = function (id) {
    const w = this.activeWorkspace();
    const tab = id ? w.tabs.find(t => t.id === id) : this.activeTab();
    if (!tab) return { err: 'no such tab' };
    if (w.tabs.length === 1) return { err: 'cannot close the last tab in a workspace' };
    const i = w.tabs.indexOf(tab);
    w.tabs.splice(i, 1);
    if (w.activeTab === tab.id) w.activeTab = w.tabs[Math.max(0, i - 1)].id;
    this.emit('tab.close', { id: tab.id });
    return { ok: true };
  };

  /* ---------------- panes ---------------- */
  Engine.prototype.newPane = function (ws, tab, cwd) {
    ws.paneSeq += 1;
    const pane = {
      gid: ws.id + ':p' + ws.paneSeq,
      id: 'p' + ws.paneSeq,
      wsId: ws.id,
      title: 'bash',
      cwd: cwd || ws.cwd,
      lines: [],
      input: '',
      history: [],
      histIdx: -1,
      agent: null,
      busy: false,
      pending: null           // an interactive prompt waiting on y/n
    };
    tab.panes.push(pane);
    this.write(pane, 'Herdr pane ' + pane.gid + ' · ' + V.pretty(pane.cwd), 'o-dim');
    this.write(pane, "type 'help' for shell commands, 'herdr --help' for the CLI", 'o-dim');
    this.write(pane, '');
    return pane;
  };

  Engine.prototype.split = function (target, direction) {
    const pane = this.resolve(target);
    if (!pane) return { err: 'no such pane: ' + target };
    const loc = this.tabOfPane(pane);
    if (!loc) return { err: 'pane not in a tab' };
    const ws = loc.ws, tab = loc.tab;
    if (tab.panes.length >= 6) return { err: 'pane limit reached in this tab (6)' };

    const fresh = this.newPane(ws, tab, pane.cwd);
    const dirNode = (direction === 'down' || direction === 'below') ? 'col' : 'row';

    const replace = (node) => {
      if (node.t === 'p') {
        if (node.gid !== pane.gid) return node;
        return { t: 's', dir: dirNode, ratio: 0.5, a: { t: 'p', gid: pane.gid }, b: { t: 'p', gid: fresh.gid } };
      }
      node.a = replace(node.a);
      node.b = replace(node.b);
      return node;
    };
    tab.layout = replace(tab.layout);
    tab.activePane = fresh.gid;
    this.emit('pane.split', { from: pane.gid, pane: fresh, direction: dirNode === 'col' ? 'down' : 'right', ws: ws, tab: tab });
    return { ok: true, pane: fresh };
  };

  Engine.prototype.focusPane = function (gid) {
    const pane = this.pane(gid);
    if (!pane) return { err: 'no such pane: ' + gid };
    const loc = this.tabOfPane(pane);
    this.activeWs = loc.ws.id;
    loc.ws.activeTab = loc.tab.id;
    loc.tab.activePane = gid;
    if (pane.agent && pane.agent.state === 'done') this.setAgentState(pane, 'idle', pane.agent.message);
    this.emit('pane.focus', { pane: pane });
    return { ok: true, pane: pane };
  };

  Engine.prototype.cyclePane = function (dir) {
    const tab = this.activeTab();
    if (!tab) return;
    const i = tab.panes.findIndex(p => p.gid === tab.activePane);
    const n = (i + dir + tab.panes.length) % tab.panes.length;
    return this.focusPane(tab.panes[n].gid);
  };

  Engine.prototype.closePane = function (target) {
    const pane = this.resolve(target);
    if (!pane) return { err: 'no such pane: ' + target };
    const loc = this.tabOfPane(pane);
    const tab = loc.tab;
    if (tab.panes.length === 1) {
      if (loc.ws.tabs.length === 1) return { err: 'cannot close the last pane of the last tab' };
      return this.closeTab(tab.id);
    }
    const prune = (node) => {
      if (node.t === 'p') return node.gid === pane.gid ? null : node;
      const a = prune(node.a), b = prune(node.b);
      if (!a) return b;
      if (!b) return a;
      node.a = a; node.b = b;
      return node;
    };
    tab.layout = prune(tab.layout);
    tab.panes = tab.panes.filter(p => p.gid !== pane.gid);
    if (tab.activePane === pane.gid) tab.activePane = tab.panes[0].gid;
    this.emit('pane.close', { gid: pane.gid });
    return { ok: true };
  };

  Engine.prototype.resizeSplit = function (tab, path, ratio) {
    let node = tab.layout;
    for (const step of path) node = node[step];
    node.ratio = Math.min(0.85, Math.max(0.15, ratio));
    this.emit('pane.resize', { ratio: node.ratio });
  };

  Engine.prototype.swapPanes = function (aTarget, bTarget) {
    const a = this.resolve(aTarget), b = this.resolve(bTarget);
    if (!a || !b) return { err: 'no such pane' };
    const la = this.tabOfPane(a), lb = this.tabOfPane(b);
    if (la.tab !== lb.tab) return { err: 'panes must be in the same tab' };
    const swap = (node) => {
      if (node.t === 'p') {
        if (node.gid === a.gid) return { t: 'p', gid: b.gid };
        if (node.gid === b.gid) return { t: 'p', gid: a.gid };
        return node;
      }
      node.a = swap(node.a); node.b = swap(node.b);
      return node;
    };
    la.tab.layout = swap(la.tab.layout);
    this.emit('pane.swap', { a: a.gid, b: b.gid });
    return { ok: true };
  };

  Engine.prototype.renamePane = function (target, title) {
    const p = this.resolve(target);
    if (!p) return { err: 'no such pane: ' + target };
    p.title = title;
    this.emit('pane.rename', { pane: p, title: title });
    return { ok: true };
  };

  /* ---------------- pane output ---------------- */
  Engine.prototype.write = function (pane, text, cls) {
    pane.lines.push({ text: text == null ? '' : String(text), cls: cls || '' });
    if (pane.lines.length > 600) pane.lines.splice(0, pane.lines.length - 600);
    this.emit('pane.write', { pane: pane });
  };
  Engine.prototype.clearPane = function (pane) {
    pane.lines = [];
    this.emit('pane.write', { pane: pane });
  };

  /* ---------------- agents ---------------- */
  Engine.prototype.startAgent = function (pane, kindKey, opts) {
    opts = opts || {};
    const kind = AGENT_KINDS[kindKey];
    if (!kind) return { err: 'unknown agent: ' + kindKey };
    if (pane.agent) return { err: 'pane already runs ' + pane.agent.label };

    pane.agent = {
      kind: kindKey,
      label: kind.label,
      name: opts.name || kindKey,
      state: 'working',
      message: opts.prompt ? opts.prompt.slice(0, 46) : 'starting up',
      integration: kind.integration,
      ctx: 3,                            // context used, shown in the agent footer
      sessionRef: 'sess_' + Math.random().toString(36).slice(2, 8)
    };
    pane.title = kind.bin;

    // the agent draws its own startup banner — herdr does not decorate the pane
    const git = this.fs.gitInfo(pane.cwd);
    this.write(pane, '');
    if (kindKey === 'claude') {
      this.write(pane, ' ▐▛███▜▌', 'o-logo');
      this.write(pane, ' ▝▜█████▛▘', 'o-logo');
      this.write(pane, '   ▘▘ ▝▝', 'o-logo');
      this.write(pane, '');
      this.write(pane, ' ' + kind.label, 'o-head');
    } else {
      this.write(pane, ' ' + kind.label, 'o-head');
    }
    this.write(pane, ' ' + V.pretty(pane.cwd) + (git ? '  ' + git.branch + (git.status ? ' ' + git.status : '') : ''), 'o-dim');
    this.write(pane, '');
    if (opts.prompt) this.write(pane, '> ' + opts.prompt, 'o-acc');
    this.write(pane, '· thinking…', 'o-warn');

    this.emit('agent.start', { pane: pane, agent: pane.agent, kind: kindKey });
    this.emit('agent.state', { pane: pane, agent: pane.agent, state: 'working' });

    // lifecycle: working -> blocked (approval) -> working -> done
    this.later(() => {
      if (!pane.agent || pane.agent.state !== 'working') return;
      this.write(pane, '· read ' + V.pretty(pane.cwd) + '/README.md', 'o-dim');
      this.write(pane, '');
      this.write(pane, '┌─ Permission required', 'o-warn');
      this.write(pane, '│  Run tests in ' + V.basename(pane.cwd) + '?', 'o-box');
      this.write(pane, '│  [y] allow   [n] deny', 'o-box');
      this.write(pane, '└─', 'o-box');
      pane.pending = { kind: 'approval' };
      this.setAgentState(pane, 'blocked', 'needs approval to run tests');
    }, 3200 + Math.random() * 1200);

    return { ok: true };
  };

  Engine.prototype.answerAgent = function (pane, answer) {
    if (!pane.agent || !pane.pending) return false;
    pane.pending = null;
    if (answer === 'y') {
      this.write(pane, '> y', 'o-ok');
      this.write(pane, '· running tests…', 'o-warn');
      this.setAgentState(pane, 'working', 'running tests');
      this.later(() => {
        if (!pane.agent) return;
        this.write(pane, '  ✓ 14 passed  ✗ 0 failed', 'o-ok');
        this.write(pane, '· done — waiting for your next instruction', 'o-dim');
        this.setAgentState(pane, 'done', 'tests green, awaiting input');
      }, 3400);
    } else {
      this.write(pane, '> n', 'o-dim');
      this.write(pane, '· skipped tests — waiting for your next instruction', 'o-dim');
      this.setAgentState(pane, 'done', 'skipped tests, awaiting input');
    }
    return true;
  };

  Engine.prototype.bumpCtx = function (pane, n) {
    if (pane.agent) pane.agent.ctx = Math.min(94, (pane.agent.ctx || 3) + (n || 4));
  };

  Engine.prototype.setAgentState = function (pane, state, message) {
    if (!pane.agent) return { err: 'no agent in ' + pane.gid };
    pane.agent.state = state;
    if (message != null) pane.agent.message = message;
    this.emit('agent.state', { pane: pane, agent: pane.agent, state: state });
    return { ok: true };
  };

  Engine.prototype.stopAgent = function (pane) {
    if (!pane.agent) return { err: 'no agent in ' + pane.gid };
    const label = pane.agent.label;
    pane.agent = null;
    pane.pending = null;
    pane.title = 'bash';
    this.write(pane, '[' + label + ' exited]', 'o-dim');
    this.emit('agent.stop', { pane: pane });
    return { ok: true };
  };

  /* pane/workspace state rollup: blocked wins, then working, then done */
  Engine.prototype.wsState = function (ws) {
    let best = null;
    ws.tabs.forEach(t => t.panes.forEach(p => {
      if (!p.agent) return;
      if (best === null || STATE_ORDER.indexOf(p.agent.state) < STATE_ORDER.indexOf(best)) best = p.agent.state;
    }));
    return best;
  };

  /* the sidebar's branch / git_status tokens, read from the workspace directory */
  Engine.prototype.wsGit = function (ws) {
    return this.fs.gitInfo(ws.cwd) || { branch: '', status: '' };
  };

  /* ---------------- session / server ---------------- */
  Engine.prototype.detach = function () {
    this.attached = false;
    this.mode = 'terminal';
    this.emit('session.detach', {});
    return { ok: true };
  };
  Engine.prototype.attach = function (name) {
    if (name && name !== this.sessionName) {
      if (this.sessions.indexOf(name) < 0) this.sessions.push(name);
      this.sessionName = name;
    }
    this.attached = true;
    this.emit('session.attach', { session: this.sessionName });
    return { ok: true };
  };
  Engine.prototype.stopServer = function () {
    this.emit('server.stop', {});
    this.reset();
    return { ok: true };
  };

  Engine.prototype.STATE_ICON = STATE_ICON;
  Engine.prototype.AGENT_KINDS = AGENT_KINDS;

  global.HerdrEngine = Engine;
  global.HERDR_AGENT_KINDS = AGENT_KINDS;
  global.HERDR_STATE_ICON = STATE_ICON;
})(window);
