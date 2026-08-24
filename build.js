/* build.js — inline the CSS and JS into one self-contained page.
   node build.js
     → dist/index.html      a standalone file you can open or host anywhere
     → dist/artifact.html   the same page as an Artifact body (no <html>/<head>)
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

/* artifact form: page content only — the host supplies the document skeleton */
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const keep = head.split('\n')
  .filter(l => /<title>|fonts\.googleapis|fonts\.gstatic|<style>|<\/style>/.test(l) || l.includes('--ground'))
  .join('\n');
const styleBlock = head.slice(head.indexOf('<style>'), head.indexOf('</style>') + 8);
const titleTag = head.match(/<title>[^<]*<\/title>/)[0];
const fontLink = head.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^>]*>/)[0];

fs.writeFileSync(path.join(root, 'dist/artifact.html'),
  titleTag + '\n' + fontLink + '\n' + styleBlock + '\n' + body);

const kb = (s) => Math.round(s.length / 1024) + ' KB';
console.log('dist/index.html    ' + kb(html));
console.log('dist/artifact.html ' + kb(titleTag + styleBlock + body));
