/* ============================================================
   shell.js — what a pane understands.
   A small POSIX-ish shell (so paths and projects are real to move
   around in) plus the herdr CLI surface documented at
   herdr.dev/docs/socket-api and /docs/agents.
   ============================================================ */
(function (global) {
  'use strict';

  const V = global.HerdrVFS;
  const KINDS = global.HERDR_AGENT_KINDS;
  const ICON = global.HERDR_STATE_ICON;

  /* ---------- argv parsing with quotes ---------- */
  function tokenize(line) {
    const out = [];
    let cur = '', q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === q) q = null; else cur += c;
      } else if (c === '"' || c === "'") {
        q = c;
      } else if (/\s/.test(c)) {
        if (cur) { out.push(cur); cur = ''; }
      } else cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }

  function flags(argv) {
    const f = {}, rest = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        if (eq > 0) f[a.slice(2, eq)] = a.slice(eq + 1);
        else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { f[a.slice(2)] = argv[++i]; }
        else f[a.slice(2)] = true;
      } else rest.push(a);
    }
    return { f: f, rest: rest };
  }

  function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(1, n - s.length)); }

  /* ============================================================
     Shell
     ============================================================ */
  function Shell(engine) { this.e = engine; }

  Shell.prototype.run = function (pane, rawLine) {
    const e = this.e;
    const line = rawLine.trim();
    if (!line) return;

    if (pane.history[pane.history.length - 1] !== line) pane.history.push(line);
    pane.histIdx = -1;

    // an agent is in the foreground: keys go to it, not the shell
    if (pane.agent && pane.pending) {
      const a = line.toLowerCase();
      if (a === 'y' || a === 'yes' || a === 'n' || a === 'no') {
        e.answerAgent(pane, a[0]);
        return;
      }
    }
    if (pane.agent && (line === 'exit' || line === '/exit' || line === 'quit')) { e.stopAgent(pane); return; }
    if (pane.agent) {
      e.write(pane, '> ' + line, 'o-acc');
      if (/^herdr\b/.test(line)) {
        // faithful: an agent owns this pane, so the keys reached the agent, not a shell.
        e.write(pane, '· note: ' + pane.agent.label + ' is in the foreground here, so that went to it.', 'o-warn');
        e.write(pane, '  run the herdr CLI from another pane — ctrl+b v to split one off.', 'o-dim');
      }
      e.write(pane, '· working…', 'o-warn');
      e.bumpCtx(pane, 5);
      e.setAgentState(pane, 'working', line.slice(0, 46));
      e.later(() => {
        if (!pane.agent) return;
        e.write(pane, '· done — awaiting input', 'o-dim');
        e.setAgentState(pane, 'done', 'replied, awaiting input');
      }, 2600);
      e.emit('agent.prompt', { pane: pane, text: line });
      return;
    }

    const argv = tokenize(line);
    const cmd = argv[0];
    e.emit('cmd', { pane: pane, line: line, argv: argv, cmd: cmd });

    const fn = this['cmd_' + cmd.replace(/-/g, '_')];
    if (cmd === 'herdr') return this.herdr(pane, argv.slice(1), line);
    if (KINDS[cmd]) return this.launchAgent(pane, cmd, argv.slice(1));
    if (typeof fn === 'function') return fn.call(this, pane, argv.slice(1), line);
    e.write(pane, cmd + ': command not found', 'o-err');
    e.write(pane, "try 'help'", 'o-dim');
  };

  Shell.prototype.abs = function (pane, p) { return V.normalize(p, pane.cwd); };
  Shell.prototype.out = function (pane, s, cls) { this.e.write(pane, s, cls); };

  /* ---------------- shell builtins ---------------- */

  Shell.prototype.cmd_help = function (pane) {
    const rows = [
      ['ls [-a] [path]', 'list a directory'],
      ['cd <path>', 'change directory (~, .., - all work)'],
      ['pwd', 'print the working directory'],
      ['cat <file>', 'print a file'],
      ['tree [path]', 'show the tree, two levels deep'],
      ['mkdir [-p] <dir>', 'make a directory'],
      ['touch <file>', 'create an empty file'],
      ['mv <src> <dst>', 'move or rename'],
      ['cp [-r] <src> <dst>', 'copy'],
      ['rm [-r] <path>', 'remove'],
      ['echo <text> [> file]', 'print, or write to a file'],
      ['git <status|log|branch>', 'a small git stub'],
      ['npm <test|run dev>', 'a small npm stub'],
      ['pytest / cargo test', 'run the project test stub'],
      ['clear', 'clear this pane'],
      ['exit', 'close this pane']
    ];
    this.out(pane, 'shell commands', 'o-head');
    rows.forEach(r => this.out(pane, '  ' + pad(r[0], 24) + r[1], 'o-dim'));
    this.out(pane, '');
    this.out(pane, 'agents: ' + Object.keys(KINDS).join(', '), 'o-dim');
    this.out(pane, "herdr CLI: 'herdr --help'", 'o-dim');
  };

  Shell.prototype.cmd_pwd = function (pane) { this.out(pane, pane.cwd); };

  Shell.prototype.cmd_ls = function (pane, args) {
    const p = flags(args);
    const showAll = !!(p.f.all || args.indexOf('-a') >= 0);
    const target = this.abs(pane, p.rest.filter(a => !a.startsWith('-'))[0] || '.');
    if (!this.e.fs.exists(target)) return this.out(pane, 'ls: ' + V.pretty(target) + ': No such file or directory', 'o-err');
    if (this.e.fs.isFile(target)) return this.out(pane, V.basename(target));
    const items = this.e.fs.list(target, showAll);
    if (!items.length) return this.out(pane, '(empty)', 'o-dim');
    items.forEach(it => this.out(pane, it.type === 'dir' ? it.name + '/' : it.name, it.type === 'dir' ? 'o-dir' : ''));
  };

  Shell.prototype.cmd_cd = function (pane, args) {
    const target = this.abs(pane, args[0] || '~');
    if (!this.e.fs.exists(target)) return this.out(pane, 'cd: ' + (args[0] || '~') + ': No such file or directory', 'o-err');
    if (!this.e.fs.isDir(target)) return this.out(pane, 'cd: ' + (args[0] || '') + ': Not a directory', 'o-err');
    pane.cwd = target;
    this.e.emit('pane.cwd', { pane: pane, cwd: target });
  };

  Shell.prototype.cmd_cat = function (pane, args) {
    if (!args.length) return this.out(pane, 'cat: missing operand', 'o-err');
    const target = this.abs(pane, args[0]);
    const content = this.e.fs.read(target);
    if (content == null) {
      return this.out(pane, 'cat: ' + args[0] + (this.e.fs.isDir(target) ? ': Is a directory' : ': No such file or directory'), 'o-err');
    }
    content.replace(/\n$/, '').split('\n').forEach(l => this.out(pane, l));
  };

  Shell.prototype.cmd_tree = function (pane, args) {
    const target = this.abs(pane, args[0] || '.');
    if (!this.e.fs.isDir(target)) return this.out(pane, 'tree: ' + (args[0] || '.') + ': not a directory', 'o-err');
    this.out(pane, V.pretty(target), 'o-dir');
    this.e.fs.tree(target, 2).forEach(row => this.out(pane, row.text, row.type === 'dir' ? 'o-dir' : 'o-dim'));
  };

  Shell.prototype.cmd_mkdir = function (pane, args) {
    const p = flags(args);
    const parents = !!p.f.parents || args.indexOf('-p') >= 0;
    const names = p.rest.filter(a => !a.startsWith('-'));
    if (!names.length) return this.out(pane, 'mkdir: missing operand', 'o-err');
    names.forEach(n => {
      const r = this.e.fs.mkdir(this.abs(pane, n), parents);
      if (r.err) this.out(pane, 'mkdir: ' + n + ': ' + r.err, 'o-err');
      else this.e.emit('fs.change', { op: 'mkdir', path: this.abs(pane, n) });
    });
  };

  Shell.prototype.cmd_touch = function (pane, args) {
    if (!args.length) return this.out(pane, 'touch: missing file operand', 'o-err');
    args.forEach(n => {
      const r = this.e.fs.touch(this.abs(pane, n));
      if (r.err) this.out(pane, 'touch: ' + n + ': ' + r.err, 'o-err');
      else this.e.emit('fs.change', { op: 'touch', path: this.abs(pane, n) });
    });
  };

  Shell.prototype.cmd_mv = function (pane, args) {
    const names = args.filter(a => !a.startsWith('-'));
    if (names.length < 2) return this.out(pane, 'mv: missing destination file operand', 'o-err');
    const from = this.abs(pane, names[0]), to = this.abs(pane, names[1]);
    const r = this.e.fs.move(from, to);
    if (r.err) return this.out(pane, 'mv: ' + r.err, 'o-err');
    this.e.emit('fs.change', { op: 'mv', from: from, to: r.dest });
  };

  Shell.prototype.cmd_cp = function (pane, args) {
    const rec = args.indexOf('-r') >= 0 || args.indexOf('-R') >= 0;
    const names = args.filter(a => !a.startsWith('-'));
    if (names.length < 2) return this.out(pane, 'cp: missing destination file operand', 'o-err');
    const from = this.abs(pane, names[0]), to = this.abs(pane, names[1]);
    const r = this.e.fs.copy(from, to, rec);
    if (r.err) return this.out(pane, 'cp: ' + r.err, 'o-err');
    this.e.emit('fs.change', { op: 'cp', from: from, to: r.dest });
  };

  Shell.prototype.cmd_rm = function (pane, args) {
    const rec = args.some(a => /^-[rRf]+$/.test(a) && /[rR]/.test(a));
    const names = args.filter(a => !a.startsWith('-'));
    if (!names.length) return this.out(pane, 'rm: missing operand', 'o-err');
    names.forEach(n => {
      const abs = this.abs(pane, n);
      const r = this.e.fs.remove(abs, rec);
      if (r.err) this.out(pane, 'rm: ' + n + ': ' + r.err, 'o-err');
      else this.e.emit('fs.change', { op: 'rm', path: abs });
    });
  };

  Shell.prototype.cmd_echo = function (pane, args, raw) {
    const gt = args.indexOf('>');
    if (gt >= 0) {
      const text = args.slice(0, gt).join(' ');
      const target = this.abs(pane, args[gt + 1] || '');
      const r = this.e.fs.write(target, text + '\n');
      if (r.err) return this.out(pane, 'echo: ' + r.err, 'o-err');
      this.e.emit('fs.change', { op: 'write', path: target });
      return;
    }
    this.out(pane, args.join(' '));
  };

  Shell.prototype.cmd_clear = function (pane) { this.e.clearPane(pane); };
  Shell.prototype.cmd_whoami = function (pane) { this.out(pane, 'dev'); };
  Shell.prototype.cmd_hostname = function (pane) { this.out(pane, 'workbox'); };
  Shell.prototype.cmd_exit = function (pane) {
    const r = this.e.closePane(pane.gid);
    if (r && r.err) this.out(pane, r.err, 'o-err');
  };

  Shell.prototype.cmd_git = function (pane, args) {
    const sub = args[0] || 'status';
    const repo = V.basename(pane.cwd);
    const g = this.e.fs.gitInfo(pane.cwd);
    if (!g) return this.out(pane, 'fatal: not a git repository', 'o-err');
    if (sub === 'status') {
      this.out(pane, 'On branch ' + g.branch);
      this.out(pane, g.status
        ? "Your branch is out of sync with 'origin/" + g.branch + "'  " + g.status
        : "Your branch is up to date with 'origin/" + g.branch + "'.");
      this.out(pane, '');
      this.out(pane, g.status.indexOf('*') >= 0
        ? 'Changes not staged for commit' : 'nothing to commit, working tree clean', 'o-dim');
    } else if (sub === 'branch') {
      this.out(pane, '* ' + g.branch, 'o-ok');
      this.out(pane, '  main', 'o-dim');
    } else if (sub === 'log') {
      this.out(pane, 'c41f9ad  harden token verification', 'o-dim');
      this.out(pane, '9b2e70c  split router into modules', 'o-dim');
      this.out(pane, '77ac001  init ' + repo, 'o-dim');
    } else this.out(pane, "git: '" + sub + "' is not a command in this sandbox", 'o-err');
  };

  Shell.prototype.testRun = function (pane, label) {
    const e = this.e;
    pane.busy = true;
    e.write(pane, label + ' running…', 'o-warn');
    e.later(() => {
      e.write(pane, '  ✓ 14 passed   ✗ 0 failed   (2.1s)', 'o-ok');
      pane.busy = false;
      e.emit('pane.write', { pane: pane });
      e.emit('cmd.finish', { pane: pane, label: label });
    }, 1800);
  };
  Shell.prototype.cmd_npm = function (pane, args) {
    if (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test')) return this.testRun(pane, 'vitest');
    if (args[0] === 'run' && args[1] === 'dev') {
      this.out(pane, 'VITE v5.4.0  ready in 412 ms', 'o-ok');
      this.out(pane, '  ➜  Local:   http://localhost:5173/', 'o-acc');
      this.out(pane, '  (this pane keeps running — that is the point of herdr)', 'o-dim');
      this.e.renamePane(pane.gid, 'vite dev');
      return;
    }
    this.out(pane, 'npm: only "npm test" and "npm run dev" are stubbed here', 'o-dim');
  };
  Shell.prototype.cmd_pytest = function (pane) { this.testRun(pane, 'pytest'); };
  Shell.prototype.cmd_cargo = function (pane, args) {
    if (args[0] === 'test') return this.testRun(pane, 'cargo test');
    this.out(pane, 'cargo: only "cargo test" is stubbed here', 'o-dim');
  };

  /* ---------------- agent launchers ---------------- */
  Shell.prototype.launchAgent = function (pane, kind, args) {
    const p = flags(args);
    const prompt = p.rest.join(' ');
    const r = this.e.startAgent(pane, kind, { prompt: prompt, name: p.f.name });
    if (r.err) this.out(pane, kind + ': ' + r.err, 'o-err');
  };

  /* ============================================================
     herdr CLI
     ============================================================ */
  Shell.prototype.herdr = function (pane, argv, raw) {
    const e = this.e;
    const p = flags(argv);
    const sub = p.rest[0];
    e.emit('herdr.cmd', { pane: pane, argv: argv, sub: sub, rest: p.rest, flags: p.f, line: raw });

    if (!sub) {
      if (p.f.help) return this.herdrHelp(pane);
      if (p.f['default-config']) return this.defaultConfig(pane);
      if (p.f.version) {
        this.out(pane, 'herdr101 simulator — this models no specific Herdr release', 'o-warn');
        this.out(pane, 'run `herdr --version` on a real install for the actual version', 'o-dim');
        return;
      }
      this.out(pane, 'already attached to session ' + e.sessionName, 'o-dim');
      this.out(pane, '(running herdr from inside herdr attaches to the running server)', 'o-dim');
      return;
    }

    const table = {
      status: this.hStatus, workspace: this.hWorkspace, space: this.hWorkspace,
      tab: this.hTab, pane: this.hPane, agent: this.hAgent, session: this.hSession,
      server: this.hServer, api: this.hApi, integration: this.hIntegration,
      plugin: this.hPlugin, help: this.herdrHelp, update: this.hUpdate
    };
    const fn = table[sub];
    if (!fn) {
      this.out(pane, "herdr: unknown command '" + sub + "'", 'o-err');
      this.out(pane, "try 'herdr --help'", 'o-dim');
      return;
    }
    fn.call(this, pane, p.rest.slice(1), p.f);
  };

  Shell.prototype.herdrHelp = function (pane) {
    const rows = [
      ['herdr', 'attach the default session (or start the server)'],
      ['herdr status', 'server, session, workspaces, agents at a glance'],
      ['herdr workspace <list|create|focus|rename|close>', ''],
      ['herdr tab <list|create|focus|rename|close>', ''],
      ['herdr pane <list|split|focus|read|run|send|rename|swap|close>', ''],
      ['herdr agent <list|start|prompt|wait|rename|explain|attach|stop>', ''],
      ['herdr session <list|attach|new>', ''],
      ['herdr server <stop|reload-config|info>', ''],
      ['herdr api schema [--json]', 'print the socket API schema'],
      ['herdr integration install <agent>', 'wire an agent up for state + session'],
      ['herdr plugin list', 'installed plugins'],
      ['herdr --default-config', 'print a starter config.toml']
    ];
    this.out(pane, 'herdr — the runtime your coding agents live on  (simulated)', 'o-head');
    this.out(pane, '');
    rows.forEach(r => {
      this.out(pane, '  ' + (r[1] ? pad(r[0], 44) + r[1] : r[0]), r[1] ? 'o-dim' : 'o-dim');
    });
    this.out(pane, '');
    this.out(pane, 'targets look like w1:p2  (workspace : pane)', 'o-acc');
  };

  Shell.prototype.hStatus = function (pane) {
    const e = this.e;
    const agents = e.agents();
    const up = Math.max(1, Math.round((Date.now() - e.startedAt) / 1000));
    this.out(pane, 'server      running (pid 4821, uptime ' + up + 's)', 'o-ok');
    this.out(pane, 'socket      ~/.config/herdr/herdr.sock', 'o-dim');
    this.out(pane, 'session     ' + e.sessionName + (e.attached ? '  (attached)' : '  (detached)'));
    this.out(pane, 'workspaces  ' + e.workspaces.length + '   panes  ' + e.allPanes().length + '   agents  ' + agents.length);
    if (agents.length) {
      this.out(pane, '');
      agents.forEach(a => {
        this.out(pane, '  ' + ICON[a.agent.state] + ' ' + pad(a.pane.gid, 7) + pad(a.agent.name, 14) +
          pad(a.agent.state, 9) + a.agent.message, 's-' + a.agent.state);
      });
    }
  };

  /* ---------- workspace ---------- */
  Shell.prototype.hWorkspace = function (pane, rest, f) {
    const e = this.e, verb = rest[0] || 'list';
    if (verb === 'list') {
      this.out(pane, pad('ID', 6) + pad('NAME', 18) + pad('TABS', 6) + pad('PANES', 7) + 'STATE', 'o-head');
      e.workspaces.forEach(w => {
        const panes = w.tabs.reduce((n, t) => n + t.panes.length, 0);
        const st = e.wsState(w);
        this.out(pane, pad(w.id + (w.id === e.activeWs ? '*' : ''), 6) + pad(w.name, 18) +
          pad(w.tabs.length, 6) + pad(panes, 7) + (st ? ICON[st] + ' ' + st : '—'), st ? 's-' + st : 'o-dim');
      });
      return;
    }
    if (verb === 'create' || verb === 'new') {
      const cwd = f.cwd ? V.normalize(f.cwd, pane.cwd) : pane.cwd;
      if (!e.fs.isDir(cwd)) return this.out(pane, 'herdr: no such directory: ' + f.cwd, 'o-err');
      const ws = e.createWorkspace({ cwd: cwd, name: f.label || f.name || V.basename(cwd) });
      e.focusWorkspace(ws.id);
      this.out(pane, 'created ' + ws.id + '  ' + ws.name + '  ' + V.pretty(cwd), 'o-ok');
      return;
    }
    if (verb === 'focus') {
      const r = e.focusWorkspace(rest[1]);
      return this.out(pane, r.err || 'focused ' + rest[1], r.err ? 'o-err' : 'o-ok');
    }
    if (verb === 'rename') {
      const r = e.renameWorkspace(rest[1], rest.slice(2).join(' '));
      return this.out(pane, r.err || 'renamed ' + rest[1], r.err ? 'o-err' : 'o-ok');
    }
    if (verb === 'close') {
      const r = e.closeWorkspace(rest[1]);
      return this.out(pane, r.err || 'closed ' + rest[1], r.err ? 'o-err' : 'o-ok');
    }
    this.out(pane, 'herdr workspace <list|create|focus|rename|close>', 'o-dim');
  };

  /* ---------- tab ---------- */
  Shell.prototype.hTab = function (pane, rest, f) {
    const e = this.e, verb = rest[0] || 'list';
    const w = e.activeWorkspace();
    if (verb === 'list') {
      this.out(pane, pad('ID', 6) + pad('NAME', 16) + 'PANES', 'o-head');
      w.tabs.forEach(t => this.out(pane, pad(t.id + (t.id === w.activeTab ? '*' : ''), 6) + pad(t.name, 16) + t.panes.length));
      return;
    }
    if (verb === 'create' || verb === 'new') {
      const t = e.createTab(w, { name: f.name || f.label || rest[1] });
      return this.out(pane, 'created ' + t.id + ' (' + t.name + ')', 'o-ok');
    }
    if (verb === 'focus') { const r = e.focusTab(rest[1]); return this.out(pane, r.err || 'focused ' + rest[1], r.err ? 'o-err' : 'o-ok'); }
    if (verb === 'rename') { const r = e.renameTab(rest[1], rest.slice(2).join(' ')); return this.out(pane, r.err || 'renamed', r.err ? 'o-err' : 'o-ok'); }
    if (verb === 'close') { const r = e.closeTab(rest[1]); return this.out(pane, r.err || 'closed', r.err ? 'o-err' : 'o-ok'); }
    this.out(pane, 'herdr tab <list|create|focus|rename|close>', 'o-dim');
  };

  /* ---------- pane ---------- */
  Shell.prototype.hPane = function (self, rest, f) {
    const pane = self, e = this.e, verb = rest[0] || 'list';
    if (verb === 'list') {
      this.out(pane, pad('TARGET', 9) + pad('TITLE', 14) + pad('AGENT', 14) + 'CWD', 'o-head');
      e.allPanes().forEach(p => {
        this.out(pane, pad(p.gid + (p.gid === (e.activeTab() || {}).activePane ? '*' : ''), 9) +
          pad(p.title, 14) + pad(p.agent ? ICON[p.agent.state] + ' ' + p.agent.name : '—', 14) + V.pretty(p.cwd));
      });
      return;
    }
    if (verb === 'split') {
      const target = rest[1] || pane.gid;
      const dir = f.direction || f.dir || 'right';
      const r = e.split(target, dir === 'down' || dir === 'below' ? 'down' : 'right');
      return this.out(pane, r.err || ('split ' + target + ' ' + dir + ' → ' + r.pane.gid), r.err ? 'o-err' : 'o-ok');
    }
    if (verb === 'focus') { const r = e.focusPane(e.resolve(rest[1]) ? e.resolve(rest[1]).gid : rest[1]); return this.out(pane, r.err || 'focused ' + rest[1], r.err ? 'o-err' : 'o-ok'); }
    if (verb === 'close') { const r = e.closePane(rest[1]); return this.out(pane, r.err || 'closed ' + rest[1], r.err ? 'o-err' : 'o-ok'); }
    if (verb === 'rename') { const r = e.renamePane(rest[1], rest.slice(2).join(' ')); return this.out(pane, r.err || 'renamed', r.err ? 'o-err' : 'o-ok'); }
    if (verb === 'swap') { const r = e.swapPanes(rest[1], rest[2]); return this.out(pane, r.err || 'swapped', r.err ? 'o-err' : 'o-ok'); }
    if (verb === 'read') {
      const target = e.resolve(rest[1]);
      if (!target) return this.out(pane, 'herdr: no such pane: ' + rest[1], 'o-err');
      const n = parseInt(f.lines || 20, 10);
      const src = f.source || 'recent';
      this.out(pane, '── ' + target.gid + ' (' + src + ', last ' + n + ') ──', 'o-dim');
      target.lines.slice(-n).forEach(l => this.out(pane, '  ' + l.text, l.cls || 'o-dim'));
      this.out(pane, '── end ──', 'o-dim');
      return;
    }
    if (verb === 'run' || verb === 'send') {
      const target = e.resolve(rest[1]);
      if (!target) return this.out(pane, 'herdr: no such pane: ' + rest[1], 'o-err');
      const text = rest.slice(2).join(' ');
      if (!text) return this.out(pane, 'herdr pane ' + verb + ' <target> "<command>"', 'o-err');
      this.out(pane, 'sent to ' + target.gid + ': ' + text, 'o-ok');
      e.write(target, promptString(target) + text, '');
      if (verb === 'run') this.run(target, text);
      return;
    }
    if (verb === 'report-agent') {
      const target = e.resolve(rest[1]);
      if (!target) return this.out(pane, 'herdr: no such pane: ' + rest[1], 'o-err');
      if (!target.agent) {
        target.agent = { kind: 'custom', label: f.agent || 'custom', name: f.agent || 'custom',
          state: f.state || 'working', message: f.message || 'reported by script', integration: 'custom' };
        e.emit('agent.start', { pane: target, agent: target.agent, kind: 'custom' });
      }
      e.setAgentState(target, f.state || 'working', f.message || target.agent.message);
      return this.out(pane, 'reported ' + target.gid + ' → ' + (f.state || 'working'), 'o-ok');
    }
    this.out(pane, 'herdr pane <list|split|focus|read|run|send|rename|swap|close|report-agent>', 'o-dim');
  };

  /* ---------- agent ---------- */
  Shell.prototype.hAgent = function (pane, rest, f) {
    const e = this.e, verb = rest[0] || 'list';
    if (verb === 'list') {
      const rows = e.agents();
      if (!rows.length) return this.out(pane, 'no agents running', 'o-dim');
      this.out(pane, pad('TARGET', 9) + pad('NAME', 14) + pad('STATE', 10) + 'MESSAGE', 'o-head');
      rows.forEach(a => this.out(pane, pad(a.pane.gid, 9) + pad(a.agent.name, 14) +
        pad(ICON[a.agent.state] + ' ' + a.agent.state, 10) + a.agent.message, 's-' + a.agent.state));
      return;
    }
    if (verb === 'start') {
      const target = e.resolve(rest[1]);
      const kind = rest[2] || 'claude';
      if (!target) return this.out(pane, 'herdr: no such pane: ' + rest[1], 'o-err');
      const r = e.startAgent(target, kind, { prompt: f.prompt, name: f.name });
      return this.out(pane, r.err || ('started ' + kind + ' in ' + target.gid), r.err ? 'o-err' : 'o-ok');
    }
    if (verb === 'prompt') {
      const target = e.resolve(rest[1]);
      if (!target || !target.agent) return this.out(pane, 'herdr: no agent at ' + rest[1], 'o-err');
      const text = rest.slice(2).join(' ') || f.text || '';
      e.write(target, '> ' + text, 'o-acc');
      e.bumpCtx(target, 5);
      e.setAgentState(target, 'working', text.slice(0, 46));
      e.later(() => { if (target.agent) { e.write(target, '· done', 'o-dim'); e.setAgentState(target, 'done', 'replied'); } }, 2400);
      return this.out(pane, 'prompted ' + target.gid, 'o-ok');
    }
    if (verb === 'wait') {
      const target = e.resolve(rest[1]);
      if (!target || !target.agent) return this.out(pane, 'herdr: no agent at ' + rest[1], 'o-err');
      const until = f.until || 'done';
      this.out(pane, 'waiting for ' + target.gid + ' until ' + until + ' …', 'o-warn');
      const started = Date.now();
      const poll = () => {
        if (!target.agent) return this.out(pane, 'agent exited', 'o-dim');
        if (target.agent.state === until) {
          this.out(pane, '✓ ' + target.gid + ' is ' + until + ' after ' + Math.round((Date.now() - started) / 1000) + 's', 'o-ok');
          this.e.emit('agent.waited', { pane: target, until: until });
          return;
        }
        if (Date.now() - started > 30000) return this.out(pane, 'timed out', 'o-err');
        e.later(poll, 500);
      };
      poll();
      return;
    }
    if (verb === 'rename') {
      const target = e.resolve(rest[1]);
      if (!target || !target.agent) return this.out(pane, 'herdr: no agent at ' + rest[1], 'o-err');
      target.agent.name = rest[2] || target.agent.name;
      e.emit('agent.rename', { pane: target, name: target.agent.name });
      return this.out(pane, 'renamed ' + target.gid + ' → ' + target.agent.name, 'o-ok');
    }
    if (verb === 'explain') {
      const target = e.resolve(rest[1]);
      if (!target) return this.out(pane, 'herdr: no such pane: ' + rest[1], 'o-err');
      if (!target.agent) {
        this.out(pane, target.gid + ': no agent detected', 'o-warn');
        this.out(pane, '  foreground process : ' + target.title, 'o-dim');
        this.out(pane, '  screen manifest    : none', 'o-dim');
        this.out(pane, '  → run a supported agent, or report state with herdr pane report-agent', 'o-dim');
        return;
      }
      this.out(pane, target.gid + ': ' + target.agent.label, 'o-head');
      this.out(pane, '  detected via     : ' + target.agent.integration, 'o-dim');
      this.out(pane, '  state            : ' + ICON[target.agent.state] + ' ' + target.agent.state, 's-' + target.agent.state);
      this.out(pane, '  reason           : ' + (target.agent.state === 'blocked'
        ? 'bottom-buffer matches a known approval prompt'
        : 'lifecycle event from the integration'), 'o-dim');
      this.out(pane, '  session ref      : ' + target.agent.sessionRef, 'o-dim');
      return;
    }
    if (verb === 'attach') {
      const target = e.resolve(rest[1]);
      if (!target) return this.out(pane, 'herdr: no agent named ' + rest[1], 'o-err');
      e.focusPane(target.gid);
      return this.out(pane, 'attached to ' + target.gid + ' (ctrl+b q to detach)', 'o-ok');
    }
    if (verb === 'stop') {
      const target = e.resolve(rest[1]);
      if (!target) return this.out(pane, 'herdr: no such pane', 'o-err');
      const r = e.stopAgent(target);
      return this.out(pane, r.err || 'stopped', r.err ? 'o-err' : 'o-ok');
    }
    this.out(pane, 'herdr agent <list|start|prompt|wait|rename|explain|attach|stop>', 'o-dim');
  };

  /* ---------- session / server / api ---------- */
  Shell.prototype.hSession = function (pane, rest, f) {
    const e = this.e, verb = rest[0] || 'list';
    if (verb === 'list') {
      e.sessions.forEach(s => this.out(pane, (s === e.sessionName ? '* ' : '  ') + s + (s === e.sessionName ? '  (attached)' : ''),
        s === e.sessionName ? 'o-ok' : 'o-dim'));
      return;
    }
    if (verb === 'attach' || verb === 'new') {
      const name = rest[1] || 'default';
      e.attach(name);
      this.out(pane, 'attached to session ' + name, 'o-ok');
      this.out(pane, '(a named session is a separate server namespace — its own socket, its own workspaces)', 'o-dim');
      return;
    }
    this.out(pane, 'herdr session <list|attach|new>', 'o-dim');
  };

  Shell.prototype.hServer = function (pane, rest) {
    const e = this.e, verb = rest[0];
    if (verb === 'stop') {
      this.out(pane, 'stopping server — every pane and agent in this session goes with it', 'o-warn');
      e.later(() => e.stopServer(), 600);
      return;
    }
    if (verb === 'reload-config') {
      this.out(pane, 'reloaded ~/.config/herdr/config.toml', 'o-ok');
      this.out(pane, 'ui + keybindings applied; startup-only settings need a restart', 'o-dim');
      e.emit('server.reload', {});
      return;
    }
    if (verb === 'info') {
      this.out(pane, 'version   simulated — no specific Herdr release is modelled', 'o-warn');
      this.out(pane, 'protocol  v3');
      this.out(pane, 'socket    ~/.config/herdr/herdr.sock', 'o-dim');
      this.out(pane, 'logs      ~/.config/herdr/herdr-server.log', 'o-dim');
      return;
    }
    this.out(pane, 'herdr server <stop|reload-config|info>', 'o-dim');
  };

  Shell.prototype.hApi = function (pane, rest, f) {
    if (rest[0] !== 'schema') return this.out(pane, 'herdr api schema [--json]', 'o-dim');
    if (f.json) {
      this.out(pane, '{');
      this.out(pane, '  "transport": "newline-delimited JSON over a local socket",', 'o-dim');
      this.out(pane, '  "methods": ["ping","workspace.list","tab.create","pane.split",', 'o-dim');
      this.out(pane, '              "pane.read","pane.send","pane.report_agent",', 'o-dim');
      this.out(pane, '              "agent.list","agent.wait","events.subscribe"]', 'o-dim');
      this.out(pane, '}');
      return;
    }
    this.out(pane, 'herdr socket API  (simulated surface)', 'o-head');
    this.out(pane, 'request   {"id":"req_1","method":"ping","params":{}}', 'o-acc');
    this.out(pane, 'response  {"id":"req_1","result":{"type":"pong"}}', 'o-acc');
    this.out(pane, '');
    this.out(pane, 'areas: server, session, workspace, tab, pane, agent, events, plugins', 'o-dim');
    this.out(pane, 'socket: ~/.config/herdr/herdr.sock  (named: sessions/<name>/herdr.sock)', 'o-dim');
  };

  Shell.prototype.hIntegration = function (pane, rest) {
    if (rest[0] !== 'install') return this.out(pane, 'herdr integration install <agent>', 'o-dim');
    const kind = rest[1];
    if (!KINDS[kind]) return this.out(pane, 'unknown agent: ' + rest[1], 'o-err');
    this.out(pane, 'installed the ' + KINDS[kind].label + ' integration (' + KINDS[kind].integration + ')', 'o-ok');
    this.out(pane, 'herdr can now report its state and resume its session after a restart', 'o-dim');
    this.e.emit('integration.install', { kind: kind });
  };

  Shell.prototype.hPlugin = function (pane, rest) {
    this.out(pane, pad('NAME', 16) + pad('EVENTS', 26) + 'SOURCE', 'o-head');
    this.out(pane, pad('standup', 16) + pad('agent_status_changed', 26) + 'local', 'o-dim');
    this.out(pane, pad('worktree', 16) + pad('workspace_created', 26) + 'marketplace', 'o-dim');
  };

  Shell.prototype.hUpdate = function (pane, rest, f) {
    if (f.handoff) {
      this.out(pane, 'live handoff: moving running panes to the new server…', 'o-warn');
      this.e.later(() => this.out(pane, '✓ updated — the running panes stayed alive', 'o-ok'), 1400);
      return;
    }
    this.out(pane, 'this simulator does not model releases or updates', 'o-warn');
    this.out(pane, 'tip: herdr update --handoff keeps running panes alive across the swap', 'o-dim');
  };

  Shell.prototype.defaultConfig = function (pane) {
    const cfg = this.e.fs.read(V.HOME + '/.config/herdr/config.toml') || '';
    cfg.replace(/\n$/, '').split('\n').forEach(l => this.out(pane, l, l.startsWith('#') ? 'o-dim' : ''));
  };

  function promptString(pane) { return 'dev@workbox ' + V.pretty(pane.cwd) + ' $ '; }

  global.HerdrShell = Shell;
  global.herdrPromptString = promptString;
})(window);
