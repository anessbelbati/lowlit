'use strict';
// The window's scripts share one global scope: a name declared at the top of two of them stops the whole page from
// loading (seen 4 Oct: a second "held"). This compiles every script each page loads, in its order, as one script,
// the way the page meets them, in a second and without a window.
//   node dev\page-names.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = path.resolve(__dirname, '..');
let bad = 0;
for (const page of ['index.html', 'float.html']) {
  const file = path.join(app, page);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  let all = '';
  for (const src of srcs) {
    const p = path.join(app, src);
    if (!fs.existsSync(p)) { console.log(`${page}: ${src} is missing`); bad++; continue; }
    all += `\n${fs.readFileSync(p, 'utf8')}\n`;
  }
  try {
    new vm.Script(all, { filename: page });
    console.log(`${page}: ${srcs.length} scripts, no name declared twice`);
  } catch (err) {
    console.log(`${page}: ${err.message}`);
    bad++;
  }
}
process.exitCode = bad ? 1 : 0;
