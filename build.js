/* build.js — inline the CSS and JS into a single self-contained page.
 *
 *   node build.js  →  dist/index.html
 *
 * The result is one file you can host anywhere. It still links the two images
 * in assets/img/ (favicon and touch icon), so copy that directory alongside it.
 * Serving the repository root directly works too — the build is only for
 * deployments that prefer a single file.
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SCRIPTS = ['assets/js/vfs.js', 'assets/js/engine.js', 'assets/js/shell.js',
                 'assets/js/sim.js', 'assets/js/tour.js', 'assets/js/curriculum.js', 'assets/js/app.js'];

const css = read('assets/css/app.css');
const js = SCRIPTS.map(f => '/* ---- ' + f + ' ---- */\n' + read(f)).join('\n');
if (js.includes('</scr' + 'ipt>')) throw new Error('a script contains a closing script tag; escape it first');

/* NOTE: replacement STRINGS would treat $&, $', $` in the CSS/JS as patterns
   (sim.js really does contain "$'"), so every replacement here is a function. */
let html = read('index.html');
html = html
  .replace('<link rel="stylesheet" href="assets/css/app.css">', () => '<style>\n' + css + '\n</style>')
  .replace(/\n\s*<script src="assets\/js\/[^"]+"><\/script>/g, () => '')
  .replace('</body>', () => '<script>\n' + js + '\n</script>\n</body>');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);

const kb = (s) => Math.round(s.length / 1024) + ' KB';
console.log('dist/index.html  ' + kb(html));
