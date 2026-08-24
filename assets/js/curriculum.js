/* ============================================================
   curriculum.js — the ordered course.
   Every lesson: explanation → worked example → tasks the
   simulator verifies → quiz. Content follows herdr.dev/docs.
   ============================================================ */
(function (global) {
  'use strict';

  /* helpers for building lesson bodies */
  const code = (title, lines, runCmd) =>
    '<div class="code"><div class="code-head"><span>' + title + '</span>' +
    (runCmd ? '<button class="btn-run" data-run="' + runCmd.replace(/"/g, '&quot;') + '">run it →</button>' : '') +
    '</div><pre>' + lines.map(l =>
      l[0] === '$' ? '<span class="c-cmd">' + l.slice(1).trim() + '</span>'
        : l[0] === '#' ? '<span class="c-com">' + l + '</span>'
          : '<span class="c-out">' + l + '</span>'
    ).join('\n') + '</pre></div>';

  const note = (title, html, warn) =>
    '<div class="note' + (warn ? ' warn' : '') + '"><span class="note-t">' + title + '</span>' + html + '</div>';

  const table = (head, rows) =>
    '<div class="tbl-wrap"><table class="ref"><thead><tr>' +
    head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';

  /* ============================================================ */
  const MODULES = [

    /* ───────────────────────── MODULE 1 ───────────────────────── */
    {
      name: 'Ground rules',
      lessons: [
        {
          id: 'what-is-herdr',
          title: 'What Herdr actually is',
          body:
            '<p class="eyebrow">Lesson 01 · Ground rules</p>' +
            '<h1>What Herdr actually is</h1>' +
            '<p class="lede">Herdr is the runtime your coding agents live on. It holds real terminals open in a background server, so the agents inside them keep working after you close the lid.</p>' +

            '<h2>Two processes, not one</h2>' +
            '<p>Every time you type <code>herdr</code>, two things are involved:</p>' +
            '<ul>' +
            '<li><strong>The server</strong> — a background process that owns the panes, the shells, and every process running inside them. It has no screen.</li>' +
            '<li><strong>The client</strong> — the terminal you are looking at. It draws the UI and sends your keystrokes to the server.</li>' +
            '</ul>' +
            '<p>Detaching the client does not touch the server. That single split is the whole product: close your laptop, lose the network, switch machines — the agents keep going because they were never attached to <em>your</em> terminal in the first place.</p>' +

            note('Why this matters', '<p>A coding agent that dies when your SSH connection drops is an agent you have to babysit. Under Herdr the connection is disposable and the work is not.</p>') +

            '<h2>What it is not</h2>' +
            '<p>Herdr does not wrap or replace your agents. Claude Code, Codex, OpenCode, Cursor Agent and friends run as themselves — normal processes in normal terminals. Herdr watches them, gives them structure, and exposes them to scripts.</p>' +

            '<h2>Your first command</h2>' +
            '<p>The terminal on the right is a real simulation of a Herdr client attached to a running server. Ask it what it is up to:</p>' +
            code('inside a herdr pane', [
              '$ herdr status',
              'server      running (pid 4821, uptime 12s)',
              'socket      ~/.config/herdr/herdr.sock',
              'session     default  (attached)',
              'workspaces  1   panes  1   agents  0'
            ], 'herdr status'),

          tasks: [
            { id: 't1', text: 'Run <code>herdr status</code> in the pane on the right.', hint: 'click the terminal first, then type',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'status' },
            { id: 't2', text: 'Print the current directory with <code>pwd</code>, then list it with <code>ls</code>.', hint: 'you start inside ~/projects/api-gateway',
              check: (ev, s) => { if (ev.type === 'cmd' && ev.cmd === 'pwd') s.pwd = true; return !!(s.pwd && ev.type === 'cmd' && ev.cmd === 'ls'); } }
          ],
          quiz: [
            { q: 'You close your laptop lid mid-run. What happens to an agent working in a Herdr pane?',
              options: ['It keeps running — the server owns the process, not your client', 'It pauses until you reattach', 'It is killed and restarted on reattach', 'It keeps running only if you passed a --daemon flag'],
              answer: 0, why: 'Panes live in the background server. The client is just a view onto it, so detaching (deliberately or by accident) leaves the processes untouched.' },
            { q: 'Which statement describes the client/server split correctly?',
              options: ['The client owns the shells; the server only draws the UI', 'The server owns pane and process state; the client draws the UI and sends keys', 'Both hold a copy of the state and sync over SSH', 'There is one process; "server" is just a mode'],
              answer: 1, why: 'The background server holds pane and process state. One or more attached clients render it.' },
            { q: 'How does Herdr run Claude Code or Codex?',
              options: ['It wraps them in its own protocol adapter', 'It reimplements their CLIs', 'It runs them as ordinary processes in ordinary panes and observes them', 'It requires a plugin per agent before they will start'],
              answer: 2, why: 'No wrapping. Agents run as themselves; integrations only add state reporting and session resume on top.' },
            { q: 'Herdr ships for which platforms?',
              options: ['macOS only', 'macOS and Linux', 'macOS, Linux and Windows, as a single binary', 'Linux only, with a Windows port planned'],
              answer: 2, why: 'One binary, three platforms — macOS, Linux and Windows.' }
          ]
        },

        {
          id: 'anatomy',
          title: 'Session, workspace, tab, pane',
          body:
            '<p class="eyebrow">Lesson 02 · Ground rules</p>' +
            '<h1>Session, workspace, tab, pane</h1>' +
            '<p class="lede">Four containers, nested. Learn them once and every command, target string and keybinding stops needing explanation.</p>' +

            table(['Thing', 'What it is', 'Rule of thumb'], [
              ['<strong>Session</strong>', 'A persistent server namespace. <code>herdr</code> attaches the default one; <code>herdr session attach work</code> creates or attaches a separate one with its own socket.', 'One per machine, usually'],
              ['<strong>Workspace</strong>', 'The top-level project container. Owns tabs and panes, and rolls their agent states up into the sidebar.', 'One per repo, task or investigation'],
              ['<strong>Tab</strong>', 'A layout inside a workspace — agents in one, logs in another, a server in a third.', 'One per concern'],
              ['<strong>Pane</strong>', 'An actual terminal with an actual process in it. Splits right or down.', 'One per running thing']
            ]) +

            '<h2>Targets: how you name things</h2>' +
            '<p>Anything scriptable is addressed as <code>workspace:pane</code>. The first workspace is <code>w1</code>, its first pane is <code>w1:p1</code>, the pane you split off it is <code>w1:p2</code>.</p>' +
            code('addressing', [
              '# every CLI verb takes a target',
              '$ herdr pane read w1:p2 --lines 20',
              '$ herdr pane split w1:p1 --direction down',
              '$ herdr agent wait w1:p2 --until done'
            ], 'herdr pane list') +

            '<h2>Agent states</h2>' +
            '<p>An agent is a process Herdr recognises inside a pane. It always carries one of five states, and this is the vocabulary the whole sidebar speaks:</p>' +
            table(['State', 'Icon', 'Meaning'], [
              ['<code>blocked</code>', '<span class="s-blocked">◉</span>', 'Waiting on you — an approval, a question, a permission prompt'],
              ['<code>working</code>', '<span class="s-working">●</span>', 'Actively running'],
              ['<code>done</code>', '<span class="s-done">●</span>', 'Finished, and you have not looked at it yet'],
              ['<code>idle</code>', '<span class="s-idle">○</span>', 'Finished or waiting, and you have already seen it'],
              ['<code>unknown</code>', '<span class="s-unknown">◍</span>', 'Herdr cannot classify it with confidence']
            ]) +
            note('done vs idle', '<p>The only difference is whether <em>you</em> have looked. Focus a done pane and it drops to idle — which is exactly why the sidebar is worth scanning: everything still marked done is news.</p>'),

          tasks: [
            { id: 't1', text: 'List the workspaces with <code>herdr workspace list</code>.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && (ev.sub === 'workspace' || ev.sub === 'space') && (ev.rest[1] === 'list' || !ev.rest[1]) },
            { id: 't2', text: 'List every pane with <code>herdr pane list</code> and read the TARGET column.', hint: 'targets look like w1:p1',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'pane' && (ev.rest[1] === 'list' || !ev.rest[1]) },
            { id: 't3', text: 'Explore the project: <code>tree ~/projects</code>.', hint: 'three real projects live there',
              check: (ev) => ev.type === 'cmd' && ev.cmd === 'tree' }
          ],
          quiz: [
            { q: 'What does the target <code>w2:p3</code> address?',
              options: ['Tab 2, pane 3', 'Workspace 2, pane 3', 'Window 2, process 3', 'Session 2, pane 3'],
              answer: 1, why: 'Targets are workspace:pane. Tabs are addressed by their own ids.' },
            { q: 'You are debugging one flaky test in one repo. How many workspaces?',
              options: ['One per test file', 'One — a workspace is per repo, task or investigation', 'One per pane you plan to open', 'None; use a tab in an existing workspace'],
              answer: 1, why: 'A workspace is the project container. One investigation is exactly the unit it is sized for.' },
            { q: 'An agent finished ten minutes ago and you have not opened its pane. Its state is:',
              options: ['idle', 'done', 'unknown', 'working'],
              answer: 1, why: 'done means finished-and-unseen. It becomes idle once you focus it.' },
            { q: 'Which one is a separate server namespace with its own socket?',
              options: ['A workspace', 'A tab', 'A named session', 'A pane group'],
              answer: 2, why: 'Named sessions are separate runtimes — separate socket path, separate workspaces.' }
          ]
        }
      ]
    },

    /* ───────────────────────── MODULE 2 ───────────────────────── */
    {
      name: 'Panes and tabs',
      lessons: [
        {
          id: 'splitting',
          title: 'Splitting panes',
          body:
            '<p class="eyebrow">Lesson 03 · Panes and tabs</p>' +
            '<h1>Splitting panes</h1>' +
            '<p class="lede">A pane is one terminal. You will want several: the agent, its test run, a log tail. Splitting is how you get them, and it is the first keybinding worth muscle memory.</p>' +

            '<h2>Prefix mode</h2>' +
            '<p>Herdr has three input modes. Normally you are in <strong>terminal mode</strong> and every key goes straight to the focused pane — which is why an agent can use <kbd>shift+tab</kbd> or arrow keys without Herdr stealing them.</p>' +
            '<p>Press <kbd>ctrl+b</kbd> and you enter <strong>prefix mode</strong> for exactly one keystroke. The next key is an action, not input. Watch the mode chip above the terminal change as you do it.</p>' +

            table(['Keys', 'Action'], [
              ['<kbd>ctrl+b</kbd> <kbd>v</kbd>', 'Split right'],
              ['<kbd>ctrl+b</kbd> <kbd>-</kbd>', 'Split down'],
              ['<kbd>ctrl+b</kbd> <kbd>x</kbd>', 'Close the focused pane'],
              ['<kbd>ctrl+b</kbd> <kbd>g</kbd>', 'Move focus to the next pane'],
              ['<kbd>ctrl+b</kbd> <kbd>z</kbd>', 'Zoom the focused pane, and back'],
              ['<kbd>esc</kbd>', 'Leave prefix mode without doing anything']
            ]) +

            '<h2>The same thing from a script</h2>' +
            '<p>Every keybinding has a CLI twin. This matters more than it looks: it is how an agent gives itself a second pane.</p>' +
            code('splitting without touching the keyboard', [
              '$ herdr pane split w1:p1 --direction right',
              'split w1:p1 right → w1:p2',
              '$ herdr pane split w1:p2 --direction down',
              'split w1:p2 down → w1:p3'
            ], 'herdr pane split w1:p1 --direction right') +

            note('Mouse is first-class', '<p>Click any pane to focus it, drag a split border to resize it, hit the ✕ in a pane header to close it. Keyboard and mouse are both supported paths, not one grudging fallback.</p>'),

          tasks: [
            { id: 't1', text: 'Split right with <kbd>ctrl+b</kbd> then <kbd>v</kbd>.', hint: 'the mode chip flips to PREFIX between the two keys',
              check: (ev) => ev.type === 'pane.split' && ev.direction === 'right' },
            { id: 't2', text: 'Split down with <kbd>ctrl+b</kbd> then <kbd>-</kbd>.', hint: 'minus, not underscore',
              check: (ev) => ev.type === 'pane.split' && ev.direction === 'down' },
            { id: 't3', text: 'Drag a split border to resize a pane.', hint: 'grab the thin line between two panes',
              check: (ev) => ev.type === 'pane.resize' },
            { id: 't4', text: 'Close a pane again — <kbd>ctrl+b</kbd> <kbd>x</kbd>, or the ✕ in its header.', hint: '',
              check: (ev) => ev.type === 'pane.close' }
          ],
          quiz: [
            { q: 'Why does Herdr use a prefix key instead of plain shortcuts?',
              options: ['To support older terminals', 'So every other key reaches the process in the pane untouched', 'Because ctrl combinations are reserved by the OS', 'To make bindings configurable'],
              answer: 1, why: 'Terminal mode passes keys straight through. Without a prefix, Herdr would eat shortcuts the agent inside the pane needs.' },
            { q: 'Which pair splits the focused pane downward?',
              options: ['<kbd>ctrl+b</kbd> <kbd>d</kbd>', '<kbd>ctrl+b</kbd> <kbd>-</kbd>', '<kbd>ctrl+b</kbd> <kbd>j</kbd>', '<kbd>ctrl+b</kbd> <kbd>s</kbd>'],
              answer: 1, why: 'prefix + minus splits down; prefix + v splits right.' },
            { q: 'You pressed <kbd>ctrl+b</kbd> by mistake. How do you back out?',
              options: ['Press <kbd>ctrl+b</kbd> again', 'Press <kbd>esc</kbd>', 'Wait for the timeout', 'Press <kbd>ctrl+c</kbd>'],
              answer: 1, why: 'Escape leaves prefix mode as a no-op.' },
            { q: 'An agent wants a second pane for a test run. What does it use?',
              options: ['Nothing — only humans can split', 'The keybinding, sent as raw keystrokes', '<code>herdr pane split &lt;target&gt; --direction right</code>', 'A config file entry'],
              answer: 2, why: 'The CLI and socket API mirror the keybindings, so agents can restructure their own workspace.' }
          ]
        },

        {
          id: 'tabs',
          title: 'Tabs: one layout per concern',
          body:
            '<p class="eyebrow">Lesson 04 · Panes and tabs</p>' +
            '<h1>Tabs: one layout per concern</h1>' +
            '<p class="lede">Panes divide a screen. Tabs give you several screens inside one workspace, so the log tail is not permanently stealing space from the agent.</p>' +

            '<h2>The keys</h2>' +
            table(['Keys', 'Action'], [
              ['<kbd>ctrl+b</kbd> <kbd>c</kbd>', 'Create a tab'],
              ['<kbd>ctrl+b</kbd> <kbd>n</kbd>', 'Next tab'],
              ['<kbd>ctrl+b</kbd> <kbd>p</kbd>', 'Previous tab']
            ]) +

            '<h2>Name them, or lose them</h2>' +
            '<p>Three tabs called tab1, tab2, tab3 are three tabs you will open one at a time to find out what they are. Rename as you create:</p>' +
            code('naming a layout', [
              '$ herdr tab create --name tests',
              'created t2 (tests)',
              '$ herdr tab list',
              'ID    NAME            PANES',
              't1*   main            2',
              't2    tests           1'
            ], 'herdr tab create --name tests') +

            '<p>A tab whose pane holds a blocked agent shows a <span class="s-blocked">◉</span> in the tab bar — you can see which layout is waiting on you without switching to it.</p>' +
            note('A useful default split', '<p>One tab named <em>agents</em> for the agents, one named <em>run</em> for the dev server and tests, one named <em>scratch</em> for whatever you are grepping this minute. Layout stability is worth more than layout cleverness.</p>'),

          tasks: [
            { id: 't1', text: 'Create a tab with <kbd>ctrl+b</kbd> <kbd>c</kbd>.', hint: '',
              check: (ev) => ev.type === 'tab.create' },
            { id: 't2', text: 'Cycle between tabs with <kbd>ctrl+b</kbd> <kbd>n</kbd> and <kbd>ctrl+b</kbd> <kbd>p</kbd>.', hint: '',
              check: (ev, s) => { if (ev.type === 'tab.focus') s.n = (s.n || 0) + 1; return (s.n || 0) >= 2; } },
            { id: 't3', text: 'Rename the current tab: <code>herdr tab rename t1 agents</code>.', hint: 'run herdr tab list first if you need the id',
              check: (ev) => ev.type === 'tab.rename' }
          ],
          quiz: [
            { q: 'What is a tab, exactly?',
              options: ['A second workspace', 'A layout subdivision inside one workspace', 'A saved pane arrangement you load on demand', 'A window in your terminal emulator'],
              answer: 1, why: 'Tabs subdivide a workspace into layouts. The workspace is still the project container.' },
            { q: 'You are in tab 3 and want tab 2. Which keys?',
              options: ['<kbd>ctrl+b</kbd> <kbd>p</kbd>', '<kbd>ctrl+b</kbd> <kbd>2</kbd> only', '<kbd>ctrl+b</kbd> <kbd>b</kbd>', '<kbd>ctrl+b</kbd> <kbd>left</kbd> only'],
              answer: 0, why: 'prefix n and prefix p cycle forward and back.' },
            { q: 'A tab in the tab bar shows a red dot. That means:',
              options: ['A pane in it crashed', 'It has unsaved changes', 'An agent inside it is blocked and waiting on you', 'It is running in the background'],
              answer: 2, why: 'State rolls up: a blocked agent marks its pane, its tab and its workspace, so you can find the one waiting on you without hunting.' }
          ]
        }
      ]
    },

    /* ───────────────────────── MODULE 3 ───────────────────────── */
    {
      name: 'Workspaces and projects',
      lessons: [
        {
          id: 'workspaces',
          title: 'A workspace per project',
          body:
            '<p class="eyebrow">Lesson 05 · Workspaces and projects</p>' +
            '<h1>A workspace per project</h1>' +
            '<p class="lede">The sidebar is only readable if workspaces mean something. Give each repo, task or investigation its own — and give it a name a tired version of you will recognise.</p>' +

            '<h2>Open one on a project</h2>' +
            '<p>The sandbox on the right has three projects under <code>~/projects</code>: <code>api-gateway</code>, <code>web-dashboard</code> and <code>data-pipeline</code>. Open a workspace on the dashboard:</p>' +
            code('a workspace rooted in a project', [
              '$ herdr workspace create --cwd ~/projects/web-dashboard --label dashboard',
              'created w2  dashboard  ~/projects/web-dashboard',
              '$ herdr workspace list',
              'ID    NAME              TABS  PANES  STATE',
              'w1    api-gateway       1     2      ● working',
              'w2*   dashboard         1     1      —'
            ], 'herdr workspace create --cwd ~/projects/web-dashboard --label dashboard') +

            '<p>Every pane created inside that workspace starts in its directory. That is the entire trick: the workspace carries the project, so nothing you open later needs a <code>cd</code>.</p>' +

            '<h2>The state column</h2>' +
            '<p>Workspace state is a rollup of the agents inside it, and blocked wins over working. A workspace showing <span class="s-blocked">◉ blocked</span> has at least one agent waiting on a human — you, specifically.</p>' +

            note('Naming', '<p><code>--label</code> sets what you see in the sidebar. Repo name is a fine default; <em>gateway-auth-bug</em> is better when two workspaces share a repo.</p>'),

          tasks: [
            { id: 't1', text: 'Move into the dashboard project: <code>cd ~/projects/web-dashboard</code>.', hint: 'Tab completes paths',
              check: (ev) => ev.type === 'pane.cwd' && /web-dashboard/.test(ev.cwd) },
            { id: 't2', text: 'Open a workspace on it with <code>--cwd</code> and <code>--label dashboard</code>.', hint: 'herdr workspace create --cwd ~/projects/web-dashboard --label dashboard',
              check: (ev) => ev.type === 'workspace.create' && /dashboard/.test(ev.ws.name) },
            { id: 't3', text: 'Confirm with <code>herdr workspace list</code> — you should see two.', hint: '',
              check: (ev, s, eng) => ev.type === 'herdr.cmd' && ev.sub === 'workspace' && eng.workspaces.length >= 2 },
            { id: 't4', text: 'Read the project README: <code>cat README.md</code>.', hint: 'you are already in its directory',
              check: (ev) => ev.type === 'cmd' && ev.cmd === 'cat' && /README/i.test(ev.argv[1] || '') }
          ],
          quiz: [
            { q: 'Which flag roots a new workspace in a directory?',
              options: ['<code>--path</code>', '<code>--cwd</code>', '<code>--dir</code>', '<code>--root</code>'],
              answer: 1, why: '<code>herdr workspace create --cwd ~/project --label api</code>.' },
            { q: 'A workspace holds one blocked agent and two working ones. The sidebar shows it as:',
              options: ['working', 'blocked', 'mixed', 'unknown'],
              answer: 1, why: 'Blocked outranks working in the rollup, because blocked is the state that needs you.' },
            { q: 'Two workspaces on the same repo — sensible or not?',
              options: ['Never; one workspace per repo is the hard rule', 'Yes, when they are different tasks — name them for the task, not the repo', 'Only with named sessions', 'Only if they use different tabs'],
              answer: 1, why: 'The unit is repo, task <em>or</em> investigation. Two tasks in one repo are two workspaces; the labels are what keep them readable.' },
            { q: 'You open a new pane in a workspace rooted at <code>~/projects/api-gateway</code>. Where does it start?',
              options: ['In your home directory', 'In the last directory you visited anywhere', 'In <code>~/projects/api-gateway</code>', 'Wherever the server was launched'],
              answer: 2, why: 'New panes inherit the workspace directory — that is what makes the container worth having.' }
          ]
        },

        {
          id: 'navigate',
          title: 'Navigate mode',
          body:
            '<p class="eyebrow">Lesson 06 · Workspaces and projects</p>' +
            '<h1>Navigate mode</h1>' +
            '<p class="lede">The third input mode. Prefix mode lasts one keystroke; navigate mode stays open so you can move between workspaces and tabs without re-pressing the prefix each time.</p>' +

            table(['Mode', 'What keys do'], [
              ['<strong>terminal</strong>', 'Everything goes to the focused pane. The default.'],
              ['<strong>prefix</strong>', 'Entered with <kbd>ctrl+b</kbd>. Waits for exactly one action key, then returns to terminal.'],
              ['<strong>navigate</strong>', 'Entered with <kbd>ctrl+b</kbd> <kbd>w</kbd>. Plain keys move you around until you press <kbd>enter</kbd> or <kbd>esc</kbd>.']
            ]) +

            '<h2>Moving</h2>' +
            code('navigate mode keys', [
              '# ctrl+b w   enter navigate mode',
              '#   j / k    down / up the workspace list',
              '#   h / l    previous / next tab',
              '#   enter    jump there and return to terminal mode',
              '#   esc      leave without moving'
            ]) +

            '<p>Two more you will use constantly:</p>' +
            table(['Keys', 'Action'], [
              ['<kbd>ctrl+b</kbd> <kbd>shift+N</kbd>', 'New workspace, rooted in the current pane directory'],
              ['<kbd>ctrl+b</kbd> <kbd>w</kbd>', 'Navigate mode — the workspace switcher']
            ]) +

            note('Or just click', '<p>Clicking a workspace in the sidebar does the same thing. Navigate mode exists for when your hands are already on the keys, not because clicking is second-class.</p>'),

          tasks: [
            { id: 't1', text: 'Create a second workspace with <kbd>ctrl+b</kbd> <kbd>shift+N</kbd> if you do not have one yet.', hint: 'hold shift for the capital N',
              check: (ev, s, eng) => ev.type === 'workspace.create' || eng.workspaces.length >= 2 },
            { id: 't2', text: 'Enter navigate mode with <kbd>ctrl+b</kbd> <kbd>w</kbd> and move with <kbd>j</kbd> / <kbd>k</kbd>.', hint: 'the mode chip turns purple',
              check: (ev, s, eng) => eng.mode === 'navigate' },
            { id: 't3', text: 'Press <kbd>enter</kbd> to switch to another workspace.', hint: '',
              check: (ev) => ev.type === 'workspace.focus' }
          ],
          quiz: [
            { q: 'How long does prefix mode last?',
              options: ['Until you press <kbd>ctrl+b</kbd> again', 'Exactly one keystroke', 'Five seconds', 'Until you press <kbd>enter</kbd>'],
              answer: 1, why: 'One action key and you are back in terminal mode — which is why it never blocks the pane for long.' },
            { q: 'Which mode keeps plain <kbd>j</kbd> and <kbd>k</kbd> as movement keys?',
              options: ['terminal', 'prefix', 'navigate', 'all three'],
              answer: 2, why: 'Navigate mode stays open and takes unmodified keys until you leave it.' },
            { q: 'In terminal mode you press <kbd>j</kbd>. What happens?',
              options: ['You move down the workspace list', 'The letter j is typed into the focused pane', 'Nothing', 'Herdr asks which pane you meant'],
              answer: 1, why: 'Terminal mode is a pass-through. That is what lets agents keep their own shortcuts.' }
          ]
        }
      ]
    },

    /* ───────────────────────── MODULE 4 ───────────────────────── */
    {
      name: 'Agents',
      lessons: [
        {
          id: 'run-agent',
          title: 'Running your first agent',
          body:
            '<p class="eyebrow">Lesson 07 · Agents</p>' +
            '<h1>Running your first agent</h1>' +
            '<p class="lede">There is no special launch command. You start an agent by running it, in a pane, the way you always have. Herdr notices.</p>' +

            code('start it like any other program', [
              '$ claude',
              '╭─ Claude Code ────────────────╮',
              '│ cwd  ~/projects/api-gateway  │',
              '╰──────────────────────────────╯',
              '· thinking…'
            ], 'claude') +

            '<p>Within a second or two the sidebar grows an <strong>Agents</strong> entry with a state dot. Keep an eye on it while the agent runs — it will go <span class="s-working">● working</span>, then <span class="s-blocked">◉ blocked</span> when it wants permission to run the tests.</p>' +

            '<h2>Blocked is the state that matters</h2>' +
            '<p>Herdr only marks an agent blocked when the live bottom-buffer snapshot matches a known approval, question or permission UI. It is not guessing from silence — which is why a blocked dot is worth interrupting yourself for.</p>' +
            '<p>Answer the prompt with <kbd>y</kbd> or <kbd>n</kbd> and watch it move back to working, then to <span class="s-done">● done</span>.</p>' +

            note('Supported agents in this sandbox', '<p><code>claude</code>, <code>codex</code>, <code>opencode</code>, <code>pi</code>, <code>cursor-agent</code>, <code>copilot</code>, <code>gemini</code>. Herdr detects 16+ CLIs; anything it does not know still runs perfectly well as a plain process.</p>') +

            '<h2>Starting one from elsewhere</h2>' +
            code('into another pane, without leaving this one', [
              '$ herdr pane split w1:p1 --direction right',
              'split w1:p1 right → w1:p2',
              '$ herdr agent start w1:p2 codex',
              'started codex in w1:p2'
            ]),

          tasks: [
            { id: 't1', text: 'Start an agent: type <code>claude</code> in a pane.', hint: 'or codex, or opencode',
              check: (ev) => ev.type === 'agent.start' },
            { id: 't2', text: 'Wait for it to go <span class="s-blocked">blocked</span> and watch the sidebar dot change.', hint: 'takes a few seconds',
              check: (ev) => ev.type === 'agent.state' && ev.state === 'blocked' },
            { id: 't3', text: 'Answer its approval prompt with <kbd>y</kbd>.', hint: 'just press y in the focused pane',
              check: (ev) => ev.type === 'agent.state' && ev.state === 'working' && /test/.test(ev.agent.message || '') },
            { id: 't4', text: 'Let it reach <span class="s-done">done</span>, then focus its pane and watch it drop to idle.', hint: 'done means finished-and-unseen',
              check: (ev) => ev.type === 'agent.state' && ev.state === 'idle' }
          ],
          quiz: [
            { q: 'How do you start Claude Code under Herdr?',
              options: ['<code>herdr run claude</code> only', 'Type <code>claude</code> in a pane, like anywhere else', 'Register it in config.toml first', 'Install a plugin for it first'],
              answer: 1, why: 'No wrapping. You run the CLI; Herdr detects it. (<code>herdr agent start</code> exists for driving other panes.)' },
            { q: 'When does Herdr mark an agent blocked?',
              options: ['After 30 seconds of no output', 'When the process stops writing to stdout', 'When the live bottom-buffer matches a known approval, question or permission UI', 'When the agent exits non-zero'],
              answer: 2, why: 'It matches the visible prompt, rather than inferring from silence — so the signal stays trustworthy.' },
            { q: 'Which state means "finished, and you have not seen it yet"?',
              options: ['idle', 'done', 'unknown', 'blocked'],
              answer: 1, why: 'done → idle happens the moment you focus the pane.' },
            { q: 'You run an unsupported CLI in a pane. What happens?',
              options: ['Herdr refuses to start it', 'It runs normally; it just gets no agent state', 'It is marked blocked forever', 'Herdr wraps it in a compatibility shim'],
              answer: 1, why: 'Unsupported tools are ordinary processes in ordinary terminals. Detection is a bonus layer, not a gate.' }
          ]
        },

        {
          id: 'agent-status',
          title: 'Detection, labels and custom state',
          body:
            '<p class="eyebrow">Lesson 08 · Agents</p>' +
            '<h1>Detection, labels and custom state</h1>' +
            '<p class="lede">Three tools for when the sidebar is not telling you what you need: explain it, rename it, or report state yourself.</p>' +

            '<h2>Why is it in that state?</h2>' +
            code('diagnosing detection', [
              '$ herdr agent explain w1:p2',
              'w1:p2: Claude Code',
              '  detected via     : screen manifest',
              '  state            : ◉ blocked',
              '  reason           : bottom-buffer matches a known approval prompt',
              '  session ref      : sess_9fa21c'
            ], 'herdr agent explain w1:p2') +

            '<p>Two things drive detection: the <strong>foreground process</strong> in the pane, and an <strong>integration</strong> the agent itself reports through. Integrations are what make state reliable and let sessions resume after a restart:</p>' +
            code('wiring an integration', ['$ herdr integration install claude'], 'herdr integration install claude') +

            '<h2>What the sidebar is actually showing</h2>' +
            '<p>Both sidebar sections are row layouts you can configure, and the defaults tell you what herdr thinks matters. A <strong>space</strong> shows its state and name, then its git branch and ahead/behind counts. An <strong>agent</strong> shows state, workspace and tab, then the agent name underneath:</p>' +
            code('config.toml — the sidebar defaults', [
              '[ui.sidebar.spaces]',
              'rows = [',
              '  ["state_icon", "workspace"],',
              '  ["branch", "git_status"],',
              ']',
              '',
              '[ui.sidebar.agents]',
              'rows = [',
              '  ["state_icon", "workspace", "tab"],',
              '  ["agent"],',
              ']'
            ]) +
            '<p>Other tokens you can drop into a row: <code>state_text</code>, <code>pane</code>, <code>terminal_title</code>, and <code>$name</code> for your own pane metadata. Compare the sidebar on the right with that config — it is rendering exactly these rows.</p>' +

            '<h2>Rename, so the sidebar reads like a team</h2>' +
            '<p>Four panes labelled <em>claude</em> tell you nothing. Four labelled <em>reviewer</em>, <em>migrator</em>, <em>flake-hunter</em> and <em>docs</em> tell you everything:</p>' +
            code('labels', ['$ herdr agent rename w1:p2 reviewer', 'renamed w1:p2 → reviewer'], 'herdr agent rename w1:p2 reviewer') +

            '<h2>Your own scripts can be agents</h2>' +
            '<p>Anything that takes time and sometimes needs you can report itself. A long migration, a deploy script, a docs build:</p>' +
            code('reporting custom state', [
              '$ herdr pane report-agent w1:p3 --agent docs-bot --state working --message "building docs"',
              'reported w1:p3 → working'
            ]) +
            note('Same over the socket', '<p>The raw method is <code>pane.report_agent</code>, with params <code>pane_id</code>, <code>source</code>, <code>agent</code>, <code>state</code>, <code>message</code>. Same model, no privileged path for built-ins.</p>'),

          tasks: [
            { id: 't1', text: 'Run <code>herdr agent list</code> to see everything running.', hint: 'run this from a pane with no agent in it — ctrl+b v splits one off',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'agent' && (ev.rest[1] === 'list' || !ev.rest[1]) },
            { id: 't2', text: 'Explain one: <code>herdr agent explain w1:p2</code> (use a target that has an agent).', hint: 'from a shell pane; herdr agent list shows valid targets',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'agent' && ev.rest[1] === 'explain' },
            { id: 't3', text: 'Give it a job title: <code>herdr agent rename &lt;target&gt; reviewer</code>.', hint: '',
              check: (ev) => ev.type === 'agent.rename' },
            { id: 't4', text: 'Report a custom agent with <code>herdr pane report-agent &lt;target&gt; --agent docs-bot --state working</code>.', hint: 'split a fresh pane (ctrl+b v) and use its target',
              check: (ev) => ev.type === 'agent.state' && ev.agent && ev.agent.integration === 'custom' }
          ],
          quiz: [
            { q: '<code>herdr agent explain</code> is for:',
              options: ['Asking the agent to explain its code', 'Understanding why Herdr classified a pane the way it did', 'Printing the agent changelog', 'Explaining a keybinding'],
              answer: 1, why: 'It is a detection diagnostic: what was detected, via what, and why that state.' },
            { q: 'What does installing an integration buy you?',
              options: ['Faster startup', 'Reliable state reporting and native session resume', 'A separate socket', 'Automatic pane splitting'],
              answer: 1, why: 'Integrations report lifecycle state and a session reference the agent can resume from after a restart.' },
            { q: 'A long migration script wants a blocked dot when it needs confirmation. It should:',
              options: ['Be rewritten as a plugin', 'Print a prompt and hope Herdr guesses', 'Call <code>herdr pane report-agent --state blocked</code>', 'Nothing — only known agents get states'],
              answer: 2, why: 'report-agent (socket: <code>pane.report_agent</code>) puts any process on the same footing as a built-in agent.' },
            { q: 'Why rename agents?',
              options: ['To pin them to a workspace', 'Because duplicate names are rejected', 'So the sidebar says what each one is doing, not just what binary it is', 'To let them message each other'],
              answer: 2, why: 'The sidebar is a status board. Labels are what make it scannable at four agents deep.' }
          ]
        }
      ]
    },

    /* ───────────────────────── MODULE 5 ───────────────────────── */
    {
      name: 'Staying alive',
      lessons: [
        {
          id: 'detach',
          title: 'Detach, reattach, survive',
          body:
            '<p class="eyebrow">Lesson 09 · Staying alive</p>' +
            '<h1>Detach, reattach, survive</h1>' +
            '<p class="lede">The feature everything else is built on. Detaching is a client operation — the server never hears about it.</p>' +

            table(['Keys / command', 'What happens'], [
              ['<kbd>ctrl+b</kbd> <kbd>q</kbd>', 'Detach. Panes, shells, agents, servers and test runs keep going.'],
              ['Closing your terminal', 'Same as detaching. Nothing inside dies.'],
              ['<code>herdr</code>', 'Reattach, from any tty, on any machine that can reach the server.'],
              ['<code>herdr server stop</code>', 'The one that actually kills things: server plus every pane in the session.']
            ]) +

            '<h2>What survives what</h2>' +
            table(['Scenario', 'Processes', 'Layout', 'Agent conversations'], [
              ['Detach / reattach', '<span class="s-done">live</span>', '<span class="s-done">kept</span>', '<span class="s-done">untouched</span>'],
              ['Server restart', '<span class="s-blocked">gone</span>', '<span class="s-done">restored from snapshot</span>', '<span class="s-working">resumable, with an integration</span>'],
              ['<code>herdr server stop</code>', '<span class="s-blocked">gone</span>', '<span class="s-done">restored next start</span>', '<span class="s-working">resumable</span>']
            ]) +

            '<p>A snapshot restore brings back workspaces, tabs, panes, working directories, layout and focus — but not the processes that were running. With <code>resume_agents_on_restore</code> on and an integration installed, supported agents pick their own conversation back up.</p>' +

            note('Pane screen history', '<p>Replaying terminal contents after a full restart is off by default, and deliberately so: scrollback holds tokens and secrets. Turn it on knowing what you are storing.</p>', true) +

            '<h2>Live handoff</h2>' +
            code('updating without killing anything', [
              '$ herdr update --handoff',
              'live handoff: moving running panes to the new server…',
              '✓ updated — the running panes stayed alive'
            ], 'herdr update --handoff'),

          tasks: [
            { id: 't1', text: 'Start an agent, then detach with <kbd>ctrl+b</kbd> <kbd>q</kbd>.', hint: 'the whole screen goes to the detached notice',
              check: (ev) => ev.type === 'session.detach' },
            { id: 't2', text: 'Reattach — press <kbd>enter</kbd> or click Reattach. Your agent is still there.', hint: '',
              check: (ev) => ev.type === 'session.attach' },
            { id: 't3', text: 'Try <code>herdr update --handoff</code> and read what it claims to keep alive.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'update' }
          ],
          quiz: [
            { q: 'What does <kbd>ctrl+b</kbd> <kbd>q</kbd> do to a running test suite in a pane?',
              options: ['Kills it', 'Pauses it until reattach', 'Nothing — it keeps running in the server', 'Backgrounds it and drops its output'],
              answer: 2, why: 'Detach is client-side. The server and everything in it carry on.' },
            { q: 'Which command actually stops the panes?',
              options: ['<code>herdr detach</code>', '<code>herdr server stop</code>', '<kbd>ctrl+b</kbd> <kbd>q</kbd>', 'Closing the terminal window'],
              answer: 1, why: 'server stop ends the session and everything running in it. Everything else is just detaching.' },
            { q: 'After a server restart, snapshot restore brings back:',
              options: ['Processes, layout and scrollback', 'Workspaces, tabs, panes, cwd, layout and focus — but not the processes', 'Only the workspace list', 'Nothing; you rebuild by hand'],
              answer: 1, why: 'Structure is restored; processes are not. Supported agents can resume their own sessions on top of that.' },
            { q: 'Why is pane screen history replay disabled by default?',
              options: ['It is slow', 'Stored scrollback can contain secrets and tokens', 'It breaks agent detection', 'It only works on Linux'],
              answer: 1, why: 'It is a deliberate security default — persisting terminal contents persists whatever was printed into them.' }
          ]
        },

        {
          id: 'sessions',
          title: 'Named sessions',
          body:
            '<p class="eyebrow">Lesson 10 · Staying alive</p>' +
            '<h1>Named sessions</h1>' +
            '<p class="lede">One server is usually enough. When it is not, a named session gives you a second runtime that shares nothing with the first.</p>' +

            code('sessions', [
              '$ herdr session list',
              '* default  (attached)',
              '$ herdr session attach work',
              'attached to session work',
              '# separate socket, separate workspaces, separate agents'
            ], 'herdr session attach work') +

            '<h2>Where the socket lives</h2>' +
            table(['Session', 'Socket path'], [
              ['default', '<code>~/.config/herdr/herdr.sock</code>'],
              ['named', '<code>~/.config/herdr/sessions/&lt;name&gt;/herdr.sock</code>']
            ]) +

            '<p>Resolution order when a command has to pick a session:</p>' +
            '<ol>' +
            '<li>The <code>--session</code> flag on the command</li>' +
            '<li><code>HERDR_SOCKET_PATH</code></li>' +
            '<li><code>HERDR_SESSION</code></li>' +
            '<li>The default session socket</li>' +
            '</ol>' +

            note('When to bother', '<p>Client work you must keep quarantined from personal work; a demo you do not want your real agents wandering into; a throwaway runtime you can <code>server stop</code> without touching anything else.</p>'),

          tasks: [
            { id: 't1', text: 'List sessions: <code>herdr session list</code>.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'session' && (ev.rest[1] === 'list' || !ev.rest[1]) },
            { id: 't2', text: 'Attach a named one: <code>herdr session attach work</code>.', hint: '',
              check: (ev) => ev.type === 'session.attach' && ev.session === 'work' },
            { id: 't3', text: 'Check <code>herdr server info</code> for the socket and log paths.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'server' && ev.rest[1] === 'info' }
          ],
          quiz: [
            { q: 'Two named sessions on one machine share:',
              options: ['Their workspaces', 'Their socket', 'Nothing — separate namespaces, separate sockets', 'Their agent list'],
              answer: 2, why: 'A named session is a separate runtime namespace with its own socket path.' },
            { q: 'Which wins: the <code>--session</code> flag or <code>HERDR_SESSION</code>?',
              options: ['The environment variable', 'The flag', 'Whichever was set last', 'They conflict and error'],
              answer: 1, why: 'Order is: --session, then HERDR_SOCKET_PATH, then HERDR_SESSION, then the default socket.' },
            { q: 'Where does a session called <code>work</code> put its socket?',
              options: ['<code>~/.config/herdr/herdr.sock</code>', '<code>~/.config/herdr/sessions/work/herdr.sock</code>', '<code>/tmp/herdr-work.sock</code>', '<code>~/.herdr/work.sock</code>'],
              answer: 1, why: 'Named sessions nest under <code>sessions/&lt;name&gt;/</code>.' }
          ]
        }
      ]
    },

    /* ───────────────────────── MODULE 6 ───────────────────────── */
    {
      name: 'Automation',
      lessons: [
        {
          id: 'cli-api',
          title: 'Driving Herdr from a script',
          body:
            '<p class="eyebrow">Lesson 11 · Automation</p>' +
            '<h1>Driving Herdr from a script</h1>' +
            '<p class="lede">Everything the UI does is available to a script — and therefore to an agent. This is the part that turns a multiplexer into a runtime.</p>' +

            '<h2>Three layers</h2>' +
            table(['Layer', 'Use it for'], [
              ['<strong>Agent skill</strong>', 'Teaching a coding agent to drive Herdr from inside its own pane'],
              ['<strong>CLI wrappers</strong>', 'Shell scripts, orchestration, debugging — start here'],
              ['<strong>Raw socket API</strong>', 'Custom tools that need request/response control or long-lived event subscriptions']
            ]) +

            '<h2>The four verbs worth memorising</h2>' +
            code('a supervisor loop in four lines', [
              '$ herdr pane split w1:p1 --direction down',
              'split w1:p1 down → w1:p2',
              '$ herdr pane run w1:p2 "npm test"',
              'sent to w1:p2: npm test',
              '$ herdr pane read w1:p2 --source recent --lines 20',
              '$ herdr agent wait w1:p1 --until done'
            ], 'herdr pane run w1:p2 "npm test"') +

            '<p><code>read</code> pulls a pane back as text — the primitive an agent uses to see what another agent did. <code>wait</code> blocks until a state is reached, which is what makes sequencing possible at all.</p>' +

            '<h2>The raw protocol</h2>' +
            '<p>Newline-delimited JSON over a Unix domain socket (a named pipe on Windows):</p>' +
            code('request and response', [
              '{"id":"req_1","method":"ping","params":{}}',
              '{"id":"req_1","result":{"type":"pong"}}'
            ]) +
            code('a long-lived subscription', [
              '{"id":"sub_1","method":"events.subscribe","params":{',
              '  "subscriptions":[{"type":"pane.agent_status_changed",',
              '                    "pane_id":"w1:p1","agent_status":"blocked"}]}}'
            ]) +

            '<p>Print the whole surface with <code>herdr api schema</code>, or <code>--json</code> to feed it to something else.</p>' +
            note('Version defensively', '<p>Check the protocol with <code>ping</code> or <code>herdr status</code> before relying on new behaviour, and ignore fields you do not recognise rather than erroring on them.</p>'),

          tasks: [
            { id: 't1', text: 'Split a pane, then send it work: <code>herdr pane run &lt;target&gt; "npm test"</code>.', hint: 'herdr pane list gives you targets',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'pane' && (ev.rest[1] === 'run' || ev.rest[1] === 'send') },
            { id: 't2', text: 'Read it back: <code>herdr pane read &lt;target&gt; --lines 20</code>.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'pane' && ev.rest[1] === 'read' },
            { id: 't3', text: 'Wait on an agent: <code>herdr agent wait &lt;target&gt; --until done</code>.', hint: 'start an agent first — the wait resolves when it finishes',
              check: (ev) => ev.type === 'agent.waited' },
            { id: 't4', text: 'Print the protocol surface: <code>herdr api schema</code>.', hint: 'try --json too',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'api' }
          ],
          quiz: [
            { q: 'What transport does the socket API use?',
              options: ['HTTP on localhost', 'gRPC', 'Newline-delimited JSON over a local socket', 'Protobuf over a TCP port'],
              answer: 2, why: 'Unix domain socket on Unix, named pipe on Windows; NDJSON either way.' },
            { q: 'An agent needs to know what another agent printed. It uses:',
              options: ['<code>herdr pane read</code>', '<code>herdr pane send</code>', '<code>herdr agent explain</code>', '<code>herdr status</code>'],
              answer: 0, why: 'read returns pane contents as text — the observation primitive.' },
            { q: 'Which call blocks until a pane\'s agent reaches a state?',
              options: ['<code>herdr agent poll</code>', '<code>herdr agent wait &lt;target&gt; --until done</code>', '<code>herdr pane watch</code>', '<code>herdr status --follow</code>'],
              answer: 1, why: 'wait is how you sequence steps without a sleep loop.' },
            { q: 'Which layer should a plain shell script start with?',
              options: ['The raw socket API', 'The CLI wrappers', 'An agent skill', 'A plugin'],
              answer: 1, why: 'The docs are explicit: start with the CLI; drop to the raw socket only for custom tools or event subscriptions.' }
          ]
        },

        {
          id: 'config',
          title: 'Configuration and plugins',
          body:
            '<p class="eyebrow">Lesson 12 · Automation</p>' +
            '<h1>Configuration and plugins</h1>' +
            '<p class="lede">One TOML file, reloadable without restarting your panes. Then the last step: teaching Herdr to react on its own.</p>' +

            table(['Platform', 'Config path'], [
              ['Linux / macOS', '<code>~/.config/herdr/config.toml</code>'],
              ['Windows', '<code>%APPDATA%\\herdr\\config.toml</code>']
            ]) +
            '<p>Generate a starter with <code>herdr --default-config</code>.</p>' +

            '<h2>The sections you will actually touch</h2>' +
            code('config.toml', [
              '[keys]',
              'prefix = "ctrl+b"',
              'next_tab = "prefix+n"',
              'split_horizontal = "prefix+minus"',
              '',
              '[theme]',
              'name = "catppuccin"',
              'auto_switch = true',
              'light_name = "catppuccin-latte"',
              '',
              '[session]',
              'resume_agents_on_restore = true'
            ], 'cat ~/.config/herdr/config.toml') +

            '<p>Bindings accept modifiers (<code>ctrl</code>, <code>shift</code>, <code>alt</code>, <code>cmd</code>) and named keys (<code>enter</code>, <code>tab</code>, <code>esc</code>, arrows). Navigate-mode bindings are plain keys with no prefix.</p>' +

            '<h2>Custom commands</h2>' +
            code('a key that opens lazygit in a popup', [
              '[[keys.command]]',
              'key = "prefix+alt+g"',
              'type = "popup"       # or pane / shell / plugin_action',
              'command = "lazygit"',
              'width = "80%"',
              'height = "80%"'
            ]) +
            '<p>Custom commands receive <code>HERDR_ACTIVE_PANE_ID</code> and <code>HERDR_ACTIVE_PANE_CWD</code>, so the thing you launch knows where it was launched from.</p>' +

            '<h2>Apply it</h2>' +
            code('no restart needed', ['$ herdr server reload-config', 'reloaded ~/.config/herdr/config.toml'], 'herdr server reload-config') +

            '<h2>Plugins</h2>' +
            '<p>A plugin is a local executable plus a manifest, hooked to events like <code>agent_status_changed</code> or <code>workspace_created</code>. Publish one to GitHub and it can be listed in the marketplace.</p>' +
            note('Where to go next', '<p>You have the whole model now: server and client, the four containers, agent states, detach, the CLI and the config. The docs at <a href="https://herdr.dev/docs/" target="_blank" rel="noopener">herdr.dev/docs</a> go deeper on remote boxes, worktrees and the plugin manifest format.</p>'),

          tasks: [
            { id: 't1', text: 'Read the config: <code>cat ~/.config/herdr/config.toml</code>.', hint: '',
              check: (ev) => ev.type === 'cmd' && ev.cmd === 'cat' && /config\.toml/.test((ev.argv[1] || '')) },
            { id: 't2', text: 'Print a starter config with <code>herdr --default-config</code>.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && ev.flags && ev.flags['default-config'] },
            { id: 't3', text: 'Reload it: <code>herdr server reload-config</code>.', hint: '',
              check: (ev) => ev.type === 'server.reload' },
            { id: 't4', text: 'See what is installed: <code>herdr plugin list</code>.', hint: '',
              check: (ev) => ev.type === 'herdr.cmd' && ev.sub === 'plugin' }
          ],
          quiz: [
            { q: 'Where does Herdr read config on Linux?',
              options: ['<code>~/.herdrrc</code>', '<code>~/.config/herdr/config.toml</code>', '<code>/etc/herdr.conf</code>', '<code>~/.herdr/settings.json</code>'],
              answer: 1, why: 'TOML, under <code>~/.config/herdr/</code>. On Windows it is <code>%APPDATA%\\herdr\\config.toml</code>.' },
            { q: 'You changed a keybinding. What applies it?',
              options: ['Restarting every pane', '<code>herdr server reload-config</code>', 'Rebooting the machine', 'Nothing; keys are compile-time'],
              answer: 1, why: 'Reload applies UI and key changes live. Only startup-only settings need a restart.' },
            { q: 'How is a navigate-mode binding written?',
              options: ['With a <code>prefix+</code> prefix, like the others', 'As a plain key, no prefix', 'As a <code>[[keys.command]]</code> block', 'It cannot be rebound'],
              answer: 1, why: 'Navigate mode takes unmodified keys, so its bindings are written as plain keys.' },
            { q: 'A plugin is:',
              options: ['A Rust crate compiled into the binary', 'A local executable plus a manifest, hooked to events', 'A config section', 'A hosted service'],
              answer: 1, why: 'Executable + manifest + event hooks, optionally published to the marketplace.' }
          ]
        }
      ]
    }
  ];

  /* flatten into an ordered lesson list */
  const LESSONS = [];
  MODULES.forEach((m, mi) => {
    m.lessons.forEach((l, li) => {
      LESSONS.push(Object.assign({}, l, { module: m.name, moduleIndex: mi, indexInModule: li, index: LESSONS.length }));
    });
  });

  global.HERDR_MODULES = MODULES;
  global.HERDR_LESSONS = LESSONS;
})(window);
