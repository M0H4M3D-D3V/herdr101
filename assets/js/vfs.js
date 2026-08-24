/* ============================================================
   vfs.js — a tiny in-memory POSIX-ish filesystem.
   Gives the simulator real paths to cd into, real files to cat,
   and real projects to open a workspace on.
   ============================================================ */
(function (global) {
  'use strict';

  const HOME = '/home/dev';

  function dir(children) { return { type: 'dir', children: children || {} }; }
  function file(content) { return { type: 'file', content: content || '' }; }

  /* ---------- the seed tree: three believable projects ---------- */
  function seed() {
    return dir({
      home: dir({
        dev: dir({
          projects: dir({
            'api-gateway': dir({
              '.git': dir({ HEAD: file('ref: refs/heads/refactor/auth\n'), UPSTREAM: file('*↑1\n') }),
              'README.md': file(
                '# api-gateway\n\n' +
                'Edge router for the platform. Rust + axum.\n\n' +
                '  cargo run -- --port 8080\n\n' +
                'Owned by the platform team.\n'),
              'Cargo.toml': file('[package]\nname = "api-gateway"\nversion = "0.4.1"\nedition = "2021"\n'),
              src: dir({
                'main.rs': file('fn main() {\n    api_gateway::serve();\n}\n'),
                'router.rs': file('pub fn routes() -> Router {\n    Router::new().route("/health", get(health))\n}\n'),
                'auth.rs': file('pub fn verify(token: &str) -> bool {\n    !token.is_empty()\n}\n')
              }),
              tests: dir({
                'router_test.rs': file('#[test]\nfn health_returns_200() { assert!(true); }\n'),
                'auth_test.rs': file('#[test]\nfn rejects_empty_token() { assert!(!verify("")); }\n')
              })
            }),

            'web-dashboard': dir({
              '.git': dir({ HEAD: file('ref: refs/heads/feat/usage-charts\n'), UPSTREAM: file('↑2\n') }),
              'README.md': file(
                '# web-dashboard\n\n' +
                'Operator dashboard. React + Vite.\n\n' +
                '  npm install && npm run dev\n'),
              'package.json': file(
                '{\n  "name": "web-dashboard",\n  "version": "2.1.0",\n' +
                '  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "test": "vitest run"\n  }\n}\n'),
              src: dir({
                'App.jsx': file('export default function App() {\n  return <Shell><PaneGrid /></Shell>;\n}\n'),
                components: dir({
                  'PaneGrid.jsx': file('export function PaneGrid({ panes }) {\n  return panes.map(p => <Pane key={p.id} {...p} />);\n}\n'),
                  'Sidebar.jsx': file('export function Sidebar({ agents }) { /* ... */ }\n')
                })
              }),
              tests: dir({
                'App.test.jsx': file("test('renders shell', () => { /* ... */ });\n"),
                'PaneGrid.test.jsx': file("test('splits right', () => { /* ... */ });\n")
              })
            }),

            'data-pipeline': dir({
              '.git': dir({ HEAD: file('ref: refs/heads/backfill/events-v2\n'), UPSTREAM: file('↓3\n') }),
              'README.md': file('# data-pipeline\n\nNightly ETL jobs. Python 3.12.\n\n  pytest -q\n'),
              'pyproject.toml': file('[project]\nname = "data-pipeline"\nversion = "0.9.0"\n'),
              jobs: dir({
                'ingest.py': file('def ingest(source):\n    """Pull raw events."""\n    return source.read()\n'),
                'transform.py': file('def transform(rows):\n    return [normalise(r) for r in rows]\n'),
                'load.py': file('def load(rows, sink):\n    sink.write(rows)\n')
              }),
              tests: dir({
                'test_ingest.py': file('def test_ingest_reads_source():\n    assert True\n'),
                'test_transform.py': file('def test_transform_normalises():\n    assert True\n')
              })
            })
          }),

          notes: dir({
            'standup.md': file('## Standup\n\n- gateway: auth refactor in review\n- dashboard: pane grid rewrite\n- pipeline: ingest flake\n'),
            'herdr-cheatsheet.md': file(
              'prefix          ctrl+b\n' +
              'split right     prefix v\n' +
              'split down      prefix -\n' +
              'new tab         prefix c\n' +
              'next / prev tab prefix n / prefix p\n' +
              'workspaces      prefix w\n' +
              'new workspace   prefix shift+n\n' +
              'detach          prefix q\n')
          }),

          '.config': dir({
            herdr: dir({
              'config.toml': file(
                '# ~/.config/herdr/config.toml\n' +
                '[keys]\n' +
                'prefix = "ctrl+b"\n\n' +
                '[theme]\n' +
                'name = "catppuccin"\n' +
                'auto_switch = true\n\n' +
                '[session]\n' +
                'resume_agents_on_restore = true\n')
            })
          }),

          '.bashrc': file('export EDITOR=nvim\nexport HERDR_SESSION=default\n')
        })
      }),
      tmp: dir({}),
      etc: dir({ hostname: file('workbox\n') })
    });
  }

  /* ---------- path helpers ---------- */
  function normalize(path, cwd) {
    let p = String(path == null ? '' : path).trim();
    if (p === '' || p === '~') p = HOME;
    else if (p === '-') p = cwd;
    else if (p.startsWith('~/')) p = HOME + '/' + p.slice(2);
    if (!p.startsWith('/')) p = (cwd === '/' ? '' : cwd) + '/' + p;

    const out = [];
    for (const part of p.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return '/' + out.join('/');
  }

  function pretty(path) {
    if (path === HOME) return '~';
    if (path.startsWith(HOME + '/')) return '~/' + path.slice(HOME.length + 1);
    return path;
  }

  function basename(path) {
    const parts = path.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '/';
  }

  function dirname(path) {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
  }

  /* ---------- the FS object ---------- */
  function FS() { this.root = seed(); }

  FS.prototype.node = function (abs) {
    if (abs === '/') return this.root;
    let n = this.root;
    for (const part of abs.split('/').filter(Boolean)) {
      if (!n || n.type !== 'dir' || !n.children[part]) return null;
      n = n.children[part];
    }
    return n;
  };

  FS.prototype.isDir = function (abs) { const n = this.node(abs); return !!n && n.type === 'dir'; };
  FS.prototype.isFile = function (abs) { const n = this.node(abs); return !!n && n.type === 'file'; };
  FS.prototype.exists = function (abs) { return !!this.node(abs); };

  FS.prototype.list = function (abs, showHidden) {
    const n = this.node(abs);
    if (!n || n.type !== 'dir') return null;
    return Object.keys(n.children)
      .filter(k => showHidden || !k.startsWith('.'))
      .sort((a, b) => {
        const ad = n.children[a].type === 'dir', bd = n.children[b].type === 'dir';
        if (ad !== bd) return ad ? -1 : 1;
        return a.localeCompare(b);
      })
      .map(name => ({ name: name, type: n.children[name].type }));
  };

  FS.prototype.read = function (abs) {
    const n = this.node(abs);
    return n && n.type === 'file' ? n.content : null;
  };

  FS.prototype.mkdir = function (abs, parents) {
    const parts = abs.split('/').filter(Boolean);
    let n = this.root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], last = i === parts.length - 1;
      if (!n.children[part]) {
        if (!parents && !last) return { err: 'no such file or directory' };
        n.children[part] = dir();
      } else if (last && !parents) {
        return { err: 'File exists' };
      }
      n = n.children[part];
      if (n.type !== 'dir') return { err: 'Not a directory' };
    }
    return { ok: true };
  };

  FS.prototype.write = function (abs, content) {
    const parent = this.node(dirname(abs));
    if (!parent || parent.type !== 'dir') return { err: 'no such file or directory' };
    const name = basename(abs);
    if (parent.children[name] && parent.children[name].type === 'dir') return { err: 'Is a directory' };
    parent.children[name] = file(content);
    return { ok: true };
  };

  FS.prototype.touch = function (abs) {
    if (this.exists(abs)) return { ok: true };
    return this.write(abs, '');
  };

  FS.prototype.remove = function (abs, recursive) {
    const n = this.node(abs);
    if (!n) return { err: 'no such file or directory' };
    if (n.type === 'dir' && !recursive) return { err: 'is a directory' };
    const parent = this.node(dirname(abs));
    delete parent.children[basename(abs)];
    return { ok: true };
  };

  FS.prototype.move = function (from, to) {
    const src = this.node(from);
    if (!src) return { err: 'cannot stat ' + pretty(from) };
    let dest = to;
    if (this.isDir(to)) dest = (to === '/' ? '' : to) + '/' + basename(from);
    const destParent = this.node(dirname(dest));
    if (!destParent || destParent.type !== 'dir') return { err: 'no such file or directory' };
    destParent.children[basename(dest)] = src;
    delete this.node(dirname(from)).children[basename(from)];
    return { ok: true, dest: dest };
  };

  FS.prototype.copy = function (from, to, recursive) {
    const src = this.node(from);
    if (!src) return { err: 'cannot stat ' + pretty(from) };
    if (src.type === 'dir' && !recursive) return { err: '-r not specified; omitting directory' };
    let dest = to;
    if (this.isDir(to)) dest = (to === '/' ? '' : to) + '/' + basename(from);
    const destParent = this.node(dirname(dest));
    if (!destParent || destParent.type !== 'dir') return { err: 'no such file or directory' };
    destParent.children[basename(dest)] = JSON.parse(JSON.stringify(src));
    return { ok: true, dest: dest };
  };

  /* nearest enclosing repo: {root, branch, status} — drives the sidebar's
     branch / git_status tokens and the git command stubs */
  FS.prototype.gitInfo = function (abs) {
    let path = abs;
    for (;;) {
      const g = this.node((path === '/' ? '' : path) + '/.git');
      if (g && g.type === 'dir') {
        const head = (g.children.HEAD && g.children.HEAD.content) || '';
        const m = head.match(/ref:\s*refs\/heads\/(.+)/);
        return {
          root: path,
          branch: m ? m[1].trim() : 'HEAD',
          status: ((g.children.UPSTREAM && g.children.UPSTREAM.content) || '').trim()
        };
      }
      if (path === '/' || path === '') return null;
      path = dirname(path);
    }
  };

  FS.prototype.tree = function (abs, depth) {
    const out = [];
    const walk = (path, prefix, level) => {
      if (level > (depth || 2)) return;
      const items = this.list(path, false) || [];
      items.forEach((it, i) => {
        const last = i === items.length - 1;
        out.push({ text: prefix + (last ? '└── ' : '├── ') + it.name, type: it.type });
        if (it.type === 'dir') {
          walk((path === '/' ? '' : path) + '/' + it.name, prefix + (last ? '    ' : '│   '), level + 1);
        }
      });
    };
    walk(abs, '', 1);
    return out;
  };

  global.HerdrVFS = { FS: FS, HOME: HOME, normalize: normalize, pretty: pretty, basename: basename, dirname: dirname };
})(window);
