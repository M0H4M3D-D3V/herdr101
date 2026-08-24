/* ============================================================
   app.js — the lesson side: rendering, progress, quizzes and the
   task checker that watches the simulator's event stream.
   ============================================================ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LESSONS = global.HERDR_LESSONS;
  const MODULES = global.HERDR_MODULES;
  const STORE = 'herdr101-progress-v1';

  const engine = new global.HerdrEngine();
  const shell = new global.HerdrShell(engine);
  const sim = new global.HerdrSim(engine, shell);

  /* ---------------- persisted progress ---------------- */
  let state = { current: 0, lessons: {} };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) { /* private mode: run without persistence */ }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function lessonState(id) {
    if (!state.lessons[id]) state.lessons[id] = { tasks: {}, quiz: {} };
    return state.lessons[id];
  }
  function lessonComplete(l) {
    const ls = lessonState(l.id);
    const tasksOk = (l.tasks || []).every(t => ls.tasks[t.id]);
    const quizOk = (l.quiz || []).every((q, i) => ls.quiz[i] === true);
    return tasksOk && quizOk;
  }
  function overallPercent() {
    let total = 0, done = 0;
    LESSONS.forEach(l => {
      const n = (l.tasks || []).length + (l.quiz || []).length;
      const ls = lessonState(l.id);
      total += n;
      done += (l.tasks || []).filter(t => ls.tasks[t.id]).length +
              (l.quiz || []).filter((q, i) => ls.quiz[i] === true).length;
    });
    return total ? Math.round((done / total) * 100) : 0;
  }

  /* ---------------- task checking ---------------- */
  const scratch = {};   // per-task scratch memory for multi-step checks

  engine.on((ev) => {
    let changed = false;
    LESSONS.forEach(l => {
      const ls = lessonState(l.id);
      (l.tasks || []).forEach(t => {
        if (ls.tasks[t.id]) return;
        const key = l.id + '::' + t.id;
        if (!scratch[key]) scratch[key] = {};
        let ok = false;
        try { ok = !!t.check(ev, scratch[key], engine); } catch (e) { ok = false; }
        if (ok) {
          ls.tasks[t.id] = true;
          changed = true;
          if (l.index === state.current) {
            sim.toast('<b>✓</b> ' + stripTags(t.text), 'ok');
          }
        }
      });
    });
    if (changed) { save(); renderTasks(); renderProgress(); }
  });

  function stripTags(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent.slice(0, 70);
  }

  /* ---------------- lesson rendering ---------------- */
  function current() { return LESSONS[state.current]; }

  function renderLesson() {
    const l = current();
    $('crumb-module').textContent = l.module;
    $('crumb-lesson').textContent = l.title;
    $('lesson-count').textContent = (l.index + 1) + ' / ' + LESSONS.length;
    $('lesson-body').innerHTML = l.body;

    $('btn-prev').disabled = $('btn-prev-2').disabled = l.index === 0;
    $('btn-next').disabled = $('btn-next-2').disabled = l.index === LESSONS.length - 1;
    $('btn-next-2').textContent = l.index === LESSONS.length - 1 ? 'Course complete' : 'Next lesson →';

    // wire the "run it" buttons inside code blocks
    $('lesson-body').querySelectorAll('[data-run]').forEach(b => {
      b.addEventListener('click', () => {
        showView('sim');
        sim.type(b.dataset.run, true);
      });
    });

    renderTasks();
    renderQuiz();
    $('rail-scroll').scrollTop = 0;
    renderProgress();
    renderDrawer();
  }

  function renderTasks() {
    const l = current();
    const block = $('tasks-block');
    if (!l.tasks || !l.tasks.length) { block.hidden = true; return; }
    block.hidden = false;
    const ls = lessonState(l.id);
    const done = l.tasks.filter(t => ls.tasks[t.id]).length;
    $('tasks-meta').textContent = done + ' / ' + l.tasks.length;
    $('task-list').innerHTML = l.tasks.map(t => {
      const ok = !!ls.tasks[t.id];
      return '<li class="task ' + (ok ? 'done' : '') + '">' +
        '<span class="task-box">✓</span>' +
        '<span class="task-txt">' + t.text +
        (t.hint && !ok ? '<span class="task-hint">' + t.hint + '</span>' : '') +
        '</span></li>';
    }).join('');
    renderDoneBanner();
  }

  function renderQuiz() {
    const l = current();
    const block = $('quiz-block');
    if (!l.quiz || !l.quiz.length) { block.hidden = true; return; }
    block.hidden = false;
    const ls = lessonState(l.id);
    const right = l.quiz.filter((q, i) => ls.quiz[i] === true).length;
    $('quiz-meta').textContent = right + ' / ' + l.quiz.length + ' correct';

    $('quiz-list').innerHTML = l.quiz.map((q, qi) => {
      const solved = ls.quiz[qi] === true;
      const letters = 'ABCD';
      return '<div class="q" data-q="' + qi + '">' +
        '<div class="q-num">Q' + (qi + 1) + '</div>' +
        '<p class="q-text">' + q.q + '</p>' +
        '<div class="opts">' +
        q.options.map((o, oi) =>
          '<button class="opt ' + (solved && oi === q.answer ? 'right' : '') + '" data-opt="' + oi + '"' +
          (solved ? ' disabled' : '') + '>' +
          '<span class="opt-key">' + letters[oi] + '</span><span>' + o + '</span></button>'
        ).join('') +
        '</div>' +
        (solved ? '<div class="q-why ok"><b>Correct.</b> ' + q.why + '</div>' : '<div class="q-why" hidden></div>') +
        '</div>';
    }).join('');

    $('quiz-list').querySelectorAll('.q').forEach(qEl => {
      const qi = parseInt(qEl.dataset.q, 10);
      const q = l.quiz[qi];
      qEl.querySelectorAll('.opt').forEach(btn => {
        btn.addEventListener('click', () => {
          const oi = parseInt(btn.dataset.opt, 10);
          const why = qEl.querySelector('.q-why');
          if (oi === q.answer) {
            btn.classList.add('right');
            qEl.querySelectorAll('.opt').forEach(b => { b.disabled = true; });
            why.hidden = false;
            why.className = 'q-why ok';
            why.innerHTML = '<b>Correct.</b> ' + q.why;
            lessonState(l.id).quiz[qi] = true;
            save();
            $('quiz-meta').textContent =
              l.quiz.filter((x, i) => lessonState(l.id).quiz[i] === true).length + ' / ' + l.quiz.length + ' correct';
            renderProgress();
            renderDoneBanner();
            renderDrawer();
          } else {
            btn.classList.add('wrong');
            btn.disabled = true;
            why.hidden = false;
            why.className = 'q-why no';
            why.innerHTML = '<b>Not quite.</b> Try another one.';
          }
        });
      });
    });
  }

  function renderDoneBanner() {
    const l = current();
    const old = document.querySelector('.done-banner');
    if (old) old.remove();
    if (!lessonComplete(l)) return;
    const last = l.index === LESSONS.length - 1;
    const div = document.createElement('div');
    div.className = 'done-banner';
    div.innerHTML = '<h3>' + (last ? 'Course complete' : 'Lesson complete') + '</h3>' +
      '<p>' + (last
        ? 'You have the whole model: server and client, the four containers, agent states, detach, the CLI and the config. Keep the simulator open and try breaking it.'
        : 'Tasks done and quiz clean. On to <strong>' + LESSONS[l.index + 1].title + '</strong>.') + '</p>';
    $('quiz-block').insertAdjacentElement('afterend', div);
  }

  function renderProgress() {
    const pct = overallPercent();
    $('progress-fill').style.width = pct + '%';
    $('progress-label').textContent = pct + '%';
  }

  /* ---------------- curriculum drawer ---------------- */
  function renderDrawer() {
    let h = '';
    MODULES.forEach((m, mi) => {
      const mine = LESSONS.filter(l => l.moduleIndex === mi);
      const doneCount = mine.filter(lessonComplete).length;
      h += '<div class="mod"><div class="mod-h"><span class="mn">' + String(mi + 1).padStart(2, '0') + '</span>' +
        m.name + '<span class="mod-bar"><i style="width:' + Math.round((doneCount / mine.length) * 100) + '%"></i></span>' +
        '<span>' + doneCount + '/' + mine.length + '</span></div>';
      mine.forEach(l => {
        h += '<button class="les-item ' + (l.index === state.current ? 'on' : '') + ' ' + (lessonComplete(l) ? 'ok' : '') +
          '" data-goto="' + l.index + '">' +
          '<span class="les-mark">✓</span>' +
          '<span><span class="les-num">' + String(l.index + 1).padStart(2, '0') + '</span> ' + l.title + '</span></button>';
      });
      h += '</div>';
    });
    $('drawer-body').innerHTML = h;
    $('drawer-body').querySelectorAll('[data-goto]').forEach(b =>
      b.addEventListener('click', () => { go(parseInt(b.dataset.goto, 10)); closeDrawer(); }));
  }

  function openDrawer() { $('drawer').hidden = false; $('drawer-veil').hidden = false; renderDrawer(); }
  function closeDrawer() { $('drawer').hidden = true; $('drawer-veil').hidden = true; }

  /* ---------------- keys sheet ---------------- */
  function renderKeys() {
    const P = global.HERDR_PREFIX_KEYS;
    const row = (k, d) => '<tr><td><kbd>' + k + '</kbd></td><td>' + d + '</td></tr>';
    let h = '<div class="keys-grp"><h3>Prefix — ctrl+b, then</h3><div class="tbl-wrap"><table class="ref"><tbody>';
    Object.keys(P).forEach(k => { h += row('ctrl+b ' + (k === 'N' ? 'shift+N' : k), P[k].label); });
    h += '</tbody></table></div></div>';

    h += '<div class="keys-grp"><h3>Navigate mode (ctrl+b w)</h3><div class="tbl-wrap"><table class="ref"><tbody>' +
      row('j / k', 'Down / up the workspace list') +
      row('h / l', 'Previous / next tab') +
      row('enter', 'Jump there') +
      row('esc', 'Leave navigate mode') +
      '</tbody></table></div></div>';

    h += '<div class="keys-grp"><h3>In a pane</h3><div class="tbl-wrap"><table class="ref"><tbody>' +
      row('tab', 'Complete a path or command') +
      row('↑ / ↓', 'Shell history') +
      row('ctrl+c', 'Interrupt (stops an agent)') +
      row('ctrl+l', 'Clear the pane') +
      row('y / n', 'Answer an agent approval prompt') +
      '</tbody></table></div></div>';

    h += '<div class="keys-grp"><h3>CLI cheat sheet</h3><div class="tbl-wrap"><table class="ref"><tbody>' +
      ['herdr status',
        'herdr workspace create --cwd ~/p --label api',
        'herdr tab create --name tests',
        'herdr pane split w1:p1 --direction right',
        'herdr pane run w1:p2 "npm test"',
        'herdr pane read w1:p2 --lines 20',
        'herdr agent list',
        'herdr agent wait w1:p1 --until done',
        'herdr agent explain w1:p2',
        'herdr session attach work',
        'herdr server reload-config',
        'herdr api schema --json'
      ].map(c => '<tr><td colspan="2"><code>' + c.replace(/"/g, '&quot;') + '</code></td></tr>').join('') +
      '</tbody></table></div></div>';

    $('keys-body').innerHTML = h;
  }

  /* ---------------- navigation ---------------- */
  function go(i) {
    state.current = Math.max(0, Math.min(LESSONS.length - 1, i));
    save();
    renderLesson();
    showView('learn');
  }

  function showView(which) {
    if (window.innerWidth > 1000) return;
    document.querySelectorAll('.vs-btn').forEach(b => {
      const on = b.dataset.view === which;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelector('.rail').classList.toggle('show', which === 'learn');
    document.querySelector('.simwrap').classList.toggle('show', which === 'sim');
  }

  /* ---------------- wiring ---------------- */
  $('btn-next').addEventListener('click', () => go(state.current + 1));
  $('btn-next-2').addEventListener('click', () => go(state.current + 1));
  $('btn-prev').addEventListener('click', () => go(state.current - 1));
  $('btn-prev-2').addEventListener('click', () => go(state.current - 1));

  $('btn-curriculum').addEventListener('click', openDrawer);
  $('btn-drawer-close').addEventListener('click', closeDrawer);
  $('drawer-veil').addEventListener('click', closeDrawer);

  $('btn-keys').addEventListener('click', () => { $('keys-sheet').hidden = false; $('keys-veil').hidden = false; });
  $('btn-keys-close').addEventListener('click', () => { $('keys-sheet').hidden = true; $('keys-veil').hidden = true; });
  $('keys-veil').addEventListener('click', () => { $('keys-sheet').hidden = true; $('keys-veil').hidden = true; });

  $('btn-reset').addEventListener('click', () => {
    sim.dialog({
      title: 'reset', input: false, danger: true, confirm: 'reset', fixed: true,
      body: 'Clear every finished task and quiz answer, and restart the simulated server?',
      onConfirm: () => {
        state = { current: 0, lessons: {} };
        Object.keys(scratch).forEach(k => delete scratch[k]);
        save();
        engine.reset();
        renderLesson();
        sim.toast('progress cleared');
      }
    });
  });

  document.querySelectorAll('.vs-btn').forEach(b =>
    b.addEventListener('click', () => showView(b.dataset.view)));

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { closeDrawer(); $('keys-sheet').hidden = true; $('keys-veil').hidden = true; }
    if (ev.target && ev.target.closest && ev.target.closest('#term')) return;
    if (ev.altKey && ev.key === 'ArrowRight') go(state.current + 1);
    if (ev.altKey && ev.key === 'ArrowLeft') go(state.current - 1);
  });

  /* draggable gutter between lesson and simulator */
  (function gutter() {
    const g = $('gutter'), ws = $('workspace');
    g.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      document.body.style.cursor = 'col-resize';
      const move = (m) => {
        const pct = Math.min(68, Math.max(26, (m.clientX / window.innerWidth) * 100));
        ws.style.setProperty('--rail-w', pct + '%');
      };
      const up = () => {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  })();

  /* ---------------- boot ---------------- */
  renderKeys();
  renderLesson();
  showView('learn');

  const tour = new global.HerdrTour({ sim: sim, go: go, showView: showView });
  $('btn-tour').addEventListener('click', () => tour.start());
  setTimeout(() => tour.offer(), 450);   // offered once, dismissible, never forced
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1000) {
      document.querySelector('.rail').classList.remove('show');
      document.querySelector('.simwrap').classList.remove('show');
    } else {
      const learnOn = document.querySelector('.vs-btn.is-on');
      showView(learnOn ? learnOn.dataset.view : 'learn');
    }
  });

  global.herdr101 = { engine: engine, shell: shell, sim: sim, go: go, tour: tour, showView: showView };
})(window);
