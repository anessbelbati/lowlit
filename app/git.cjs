'use strict';
// Which git project a folder is in, read from git's own small files: a folder can be asked about on every redraw,
// so that look never starts the git program. What the person asks for from a chat's branch menu (how its copy
// stands, its branches, a switch to another one) does start git, in the background and only then.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const COPIES_MAX = 30;
const SMALL = 4096;
const CONFIG_MAX = 65536;
const GIT_MS = 10000;
const OUT_MAX = 2 * 1024 * 1024;
const BRANCHES_MAX = 200;

/** One of git's small files, or '' (a large one is not git's, and is not read). */
function read(file, max = SMALL) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    if (size > max) return '';
    const buf = Buffer.allocUnsafe(size);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, size, 0)).trim();
  } catch { return ''; } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** The branch a git directory's HEAD is on, or the first characters of the commit it stands on. */
function branchIn(gitDir) {
  const m = /^ref:\s*refs\/heads\/(.+)$/.exec(read(path.join(gitDir, 'HEAD')));
  return m ? m[1] : read(path.join(gitDir, 'HEAD')).slice(0, 7);
}

/**
 * The copy of a git project a folder is in: { top, copy, branch, main, common }. top: the copy's own top folder;
 * copy: '' for the main copy, else the worktree's name; main: the main copy's folder; common: the git directory all
 * copies share. null outside git.
 */
function copyOf(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  let top = '';
  for (let dir = path.resolve(cwd);;) {
    if (fs.existsSync(path.join(dir, '.git'))) { top = dir; break; }
    const above = path.dirname(dir);
    if (above === dir) return null;
    dir = above;
  }
  let gitDir = path.join(top, '.git');
  let common = gitDir;
  let copy = '';
  if (!isDir(gitDir)) {
    // a worktree: its .git is a file naming its own git directory, which sits inside the main copy's .git
    const m = /^gitdir:\s*(.+)$/m.exec(read(gitDir));
    if (!m) return null;
    gitDir = path.resolve(top, m[1].trim());
    if (!isDir(gitDir)) return null;
    copy = path.basename(gitDir);
    const shared = read(path.join(gitDir, 'commondir'));
    common = shared ? path.resolve(gitDir, shared) : path.dirname(path.dirname(gitDir));
  }
  return { top, copy, branch: branchIn(gitDir), main: path.dirname(common), common };
}

/** copyOf, and every copy of the project with its folder and branch (the main one first): what a new chat may run in. */
function repoOf(cwd) {
  if (!isDir(cwd)) return null;
  const at = copyOf(cwd);
  if (!at) return null;
  const copies = [{ name: '', path: at.main, branch: branchIn(at.common) }];
  let names = [];
  try { names = fs.readdirSync(path.join(at.common, 'worktrees')); } catch { /* no other copies */ }
  for (const name of names.slice(0, COPIES_MAX)) {
    const own = path.join(at.common, 'worktrees', name);
    const where = read(path.join(own, 'gitdir'));
    // a copy whose folder was deleted stays listed by git until it is pruned: it is not offered
    const folder = where ? path.dirname(path.resolve(own, where)) : '';
    if (folder && isDir(folder)) copies.push({ name, path: folder, branch: branchIn(own) });
  }
  return { top: at.top, copy: at.copy, branch: at.branch, copies };
}

/**
 * owner/name of a project from the address of one of its remotes, whatever its form (https, ssh, host:path, a
 * folder). Only the path after the host is read: a login or a key written before the host never comes out of here.
 */
function nameOfUrl(url) {
  let rest = String(url).replace(/[?#].*$/, '');
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest);
  if (scheme) {
    rest = rest.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    rest = slash < 0 ? '' : rest.slice(slash + 1);
  } else if (/^[^/\\:]+@[^/\\:]+:/.test(rest) || /^[^/\\:]{2,}:(?![/\\])/.test(rest)) {
    rest = rest.slice(rest.indexOf(':') + 1);
  }
  const parts = rest.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = (parts.pop() || '').replace(/\.git$/i, '');
  const owner = parts.pop() || '';
  return name ? (owner && !/:$/.test(owner) ? `${owner}/${name}` : name) : '';
}

/** The project's name as its host knows it (owner/name), from git's config: origin first, else the first remote. */
function originOf(common) {
  let section = null;
  let first = '';
  for (const raw of read(path.join(common, 'config'), CONFIG_MAX).split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
    if (head) { section = head[1].toLowerCase() === 'remote' ? head[2] || '' : null; continue; }
    const m = section !== null && /^url\s*=\s*(.+)$/i.exec(line);
    if (!m) continue;
    const name = nameOfUrl(m[1].trim());
    if (section === 'origin' && name) return name;
    if (!first) first = name;
  }
  return first;
}

/** The project a folder is in, by the name it goes by: its origin's owner/name, or else the main copy's folder. */
function projectName(at) {
  return originOf(at.common) || path.basename(at.main);
}

const sameFolder = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
/** True when `folder` is `top` or inside it. */
function inside(folder, top) {
  const rel = path.relative(path.resolve(top).toLowerCase(), path.resolve(folder).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Runs git in `cwd` in the background: { code, out, err }, code -1 when git could not be started or took too long.
 * It never waits on the person (no password prompt). reads: what it does only reads, so it takes none of git's
 * optional locks, which an agent's own git call in the same copy would otherwise find taken. A program started
 * elsewhere in the app at the same moment can take a copy of git's output pipe and hold it open as long as it
 * runs: git having ended is enough, and what it printed by then is the answer.
 */
function run(cwd, args, reads = true) {
  return new Promise((done) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (reads) env.GIT_OPTIONAL_LOCKS = '0';
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name];
    let child;
    try {
      child = spawn('git', args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { done({ code: -1, out: '', err: 'git could not be started' }); return; }
    let out = '';
    let err = '';
    let over = false;
    const end = (code) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      if (child.stdout) child.stdout.destroy();
      if (child.stderr) child.stderr.destroy();
      done({ code, out, err });
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (out.length < OUT_MAX) out += d; });
    child.stderr.on('data', (d) => { if (err.length < OUT_MAX) err += d; });
    child.on('error', () => end(-1));
    child.on('close', (code) => end(code === null ? -1 : code));
    child.on('exit', (code) => setTimeout(() => end(code === null ? -1 : code), 150));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } end(-1); }, GIT_MS);
  });
}

/**
 * How a copy stands: its branch (or none, when it stands on a commit), the branch it follows elsewhere and how far
 * ahead and behind, and how many files hold changes not committed (changed) and how many git does not know (fresh).
 * null when git could not tell.
 */
async function statusOf(top) {
  const r = await run(top, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']);
  if (r.code !== 0) return null;
  const lines = r.out.split('\n').filter(Boolean);
  const head = lines[0] && lines[0].startsWith('## ') ? lines.shift().slice(3) : '';
  const s = { branch: '', upstream: '', ahead: 0, behind: 0, detached: false, gone: false, empty: false, changed: 0, fresh: 0, cut: r.out.length >= OUT_MAX };
  let m;
  if ((m = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(head))) { s.branch = m[1]; s.empty = true; }
  else if (/^HEAD \(no branch\)/.test(head)) s.detached = true;
  else if ((m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(head))) {
    s.branch = m[1];
    s.upstream = m[2] || '';
    const track = m[3] || '';
    s.ahead = Number((/ahead (\d+)/.exec(track) || [])[1]) || 0;
    s.behind = Number((/behind (\d+)/.exec(track) || [])[1]) || 0;
    s.gone = /\bgone\b/.test(track);
  }
  for (const l of lines) {
    if (l.startsWith('?? ')) s.fresh++;
    else if (!l.startsWith('!! ')) s.changed++;
  }
  return s;
}

/** The project's own branches, the one with the newest commit first: { name, elsewhere } (the folder of another copy that has it open). */
async function branchesOf(top) {
  const r = await run(top, ['for-each-ref', '--sort=-committerdate', `--count=${BRANCHES_MAX}`, '--format=%(refname:short)%00%(worktreepath)', 'refs/heads/']);
  if (r.code !== 0) return null;
  return r.out.split('\n').filter(Boolean).map((line) => {
    const [name, where = ''] = line.split('\0');
    return { name, elsewhere: where && !sameFolder(where, top) ? path.resolve(where) : '' };
  });
}

/** Puts the copy at `top` on branch `name`: { ok } or { error } in git's own first words. */
async function switchTo(top, name) {
  const r = await run(top, ['switch', '--no-guess', name], false);
  if (r.code === 0) return { ok: true };
  const said = r.err.split('\n').map((l) => l.replace(/^(fatal|error):\s*/i, '').trim()).find(Boolean);
  return { error: r.code === -1 && !said ? 'git did not answer.' : said || `git ended with code ${r.code}.` };
}

module.exports = { copyOf, repoOf, projectName, originOf, nameOfUrl, inside, sameFolder, statusOf, branchesOf, switchTo };
