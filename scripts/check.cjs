'use strict';
// What CI checks on every push: every script of the app compiles, and the window's scripts never declare one name
// twice (they share one global scope, so a second declaration stops the whole page from loading).
//   node scripts/check.cjs      after npm install, or npm ci --prefix app --ignore-scripts
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const app = path.join(__dirname, '..', 'app');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules') return [];
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return /\.c?js$/.test(e.name) ? [p] : [];
});

let bad = 0;
const files = walk(app);
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    bad++;
    console.log(`${path.relative(app, f)} does not compile:\n${String(err.stderr).trim()}`);
  }
}
console.log(`${files.length} scripts compile${bad ? `, except ${bad}` : ''}`);
try {
  console.log(execFileSync(process.execPath, [path.join(app, 'dev', 'page-names.cjs')], { encoding: 'utf8' }).trim());
} catch (err) {
  bad++;
  console.log(String(err.stdout || err.message).trim());
}
process.exitCode = bad ? 1 : 0;
