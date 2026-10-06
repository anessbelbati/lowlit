'use strict';
// The Viewer: pictures, videos and sounds shown to the person beside a chat, in the window's own page (viewer.js). A
// chat shows them through the Browser's door (browser-mcp.cjs: show_media, media_control, media_look); the person
// opens them from the palette, or drops them on the panel. The page plays what Chromium plays by itself; anything
// else is copied once into a form it plays, by ffmpeg when this computer has it (and pictures from cameras by
// Windows' own decoders). The page reaches a file only by the name given to it here (lowlit-media://o/<name>), never
// by its path. The person also flips through the other pictures, videos and sounds of the folder of the file in front:
// only the files beside it, never one in a folder below, one whose name starts with a dot or one named as keys.
// Nothing leaves this computer.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { Say, secretPath, really } = require('./browser.cjs');

const SCHEME = 'lowlit-media';
const ITEMS_MAX = 60;                   // a chat's Viewer keeps its newest this many files
const SHOW_MAX = 24;                    // files at a time
const CACHE_MAX = 2 * 1024 ** 3;        // the copies and small pictures made here, all together
const PROBE_MS = 10000;
const ASK_MS = 15000;
const THUMBS_AT_ONCE = 2;
const ADD_AT_ONCE = 4;                  // files a show adds together (ffprobe reads the videos and sounds)
const FOLDER_MAX = 200;                 // a folder flipped through: its files nearest by name to the one in front
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

// What Chromium shows by itself, by the file's ending; the rest is copied first.
const NATIVE = {
  image: ['png', 'apng', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg'],
  video: ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'weba'],
};
// Pictures from cameras and Windows' own kinds: read by Windows' decoders first (those that are installed).
const RAW = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw', 'iiq', 'jxr', 'wdp', 'hdp'];
const COPIED = {
  image: ['tif', 'tiff', 'heic', 'heif', 'psd', 'exr', 'tga', 'dds', 'jxl', 'jp2', 'j2k', 'hdr', 'pcx', 'ppm', 'pgm', 'pbm', 'pam', 'qoi', 'dpx', 'sgi', 'xbm', 'xpm', 'wbmp', ...RAW],
  video: ['avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm2v', 'ts', 'mts', 'm2ts', '3gp', '3g2', 'vob', 'mxf', 'f4v', 'divx', 'asf', 'rm', 'rmvb', 'y4m', 'ivf', 'mjpeg', 'h264', 'h265', 'hevc'],
  audio: ['wma', 'aif', 'aiff', 'aifc', 'ape', 'amr', 'mka', 'ac3', 'eac3', 'dts', 'caf', 'au', 'snd', 'wv', 'tta', 'spx', 'mp2'],
};
const MIME = {
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', pjp: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', cur: 'image/x-icon', svg: 'image/svg+xml',
  // Chromium's own reader takes QuickTime and Matroska files under the names of the kinds it knows
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm',
};
// What Chromium decodes inside a video or sound file (as ffprobe names it): anything else is copied first.
const PLAYS_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'theora']);
const PLAYS_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8']);

const kindOf = (ext) => ['image', 'video', 'audio'].find((k) => NATIVE[k].includes(ext) || COPIED[k].includes(ext)) || '';
const sizeWords = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const timeWords = (s) => { const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
const rate = (text) => { const [a, b] = String(text || '').split('/').map(Number); return a && b ? Math.round((a / b) * 100) / 100 : 0; };

/** What a file is from its first bytes, when its name does not say. */
function sniff(file) {
  let b;
  try {
    const fd = fs.openSync(file, 'r');
    b = Buffer.alloc(32);
    fs.readSync(fd, b, 0, 32, 0);
    fs.closeSync(fd);
  } catch { return null; }
  const at = (s, i = 0) => b.toString('latin1', i, i + s.length) === s;
  if (at('\x89PNG')) return { kind: 'image', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg' };
  if (at('GIF8')) return { kind: 'image', ext: 'gif' };
  if (at('BM')) return { kind: 'image', ext: 'bmp' };
  if (at('RIFF') && at('WEBP', 8)) return { kind: 'image', ext: 'webp' };
  if (at('RIFF') && at('WAVE', 8)) return { kind: 'audio', ext: 'wav' };
  if (at('RIFF') && at('AVI ', 8)) return { kind: 'video', ext: 'avi' };
  if (at('ftyp', 4)) {
    const brand = b.toString('latin1', 8, 12);
    if (/^(avif|avis)/.test(brand)) return { kind: 'image', ext: 'avif' };
    if (/^(heic|heix|mif1|msf1)/.test(brand)) return { kind: 'image', ext: 'heic' };
    if (/^M4A /.test(brand)) return { kind: 'audio', ext: 'm4a' };
    if (/^qt  /.test(brand)) return { kind: 'video', ext: 'mov' };
    return { kind: 'video', ext: 'mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', ext: 'mkv' };
  if (at('OggS')) return { kind: 'audio', ext: 'ogg' };
  if (at('fLaC')) return { kind: 'audio', ext: 'flac' };
  if (at('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', ext: 'mp3' };
  if (at('<svg') || at('<?xml')) return { kind: 'image', ext: 'svg' };
  return null;
}

/** Windows' own decoders, for pictures ffmpeg cannot read (cameras' raw files, HEIC with its extension installed). */
const WIC = `param([string]$src, [string]$out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$s = [IO.File]::OpenRead($src)
try {
  $d = [Windows.Media.Imaging.BitmapDecoder]::Create($s, [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $f = $d.Frames[0]
  $k = [Math]::Min(1.0, 4096.0 / [Math]::Max($f.PixelWidth, $f.PixelHeight))
  $b = $f
  if ($k -lt 1.0) { $b = New-Object Windows.Media.Imaging.TransformedBitmap($f, (New-Object Windows.Media.ScaleTransform($k, $k))) }
  $e = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $e.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($b))
  $o = [IO.File]::Create($out)
  try { $e.Save($o) } finally { $o.Close() }
} finally { $s.Close() }
`;

class Viewer {
  /**
   * send(channel, ...): to the window's page. dir: where copies and small pictures are kept. record(): the person's
   * record folders, never opened here. where(drv): the folder of the chat behind a door session, for paths it gives
   * from there.
   */
  constructor({ send, log, dir, record, where }) {
    this.send = send;
    this.log = log || (() => {});
    this.dir = dir;
    this.record = record || (() => []);
    this.where = where || (() => '');
    this.homes = new Map();          // a chat's Viewer ('' none, a chat id, 's:' and a session) -> what it shows
    this.byToken = new Map();
    this.n = 0;
    this.shows = 0;
    this.waiting = new Map();        // a question to the page -> how it is answered
    this.asked = 0;
    this.timer = null;
    this.tools = null;               // { ffmpeg, ffprobe }: their paths once looked for
    this.queue = Promise.resolve();  // copies are made one at a time
    this.thumbs = new Map();         // token -> the small picture being made
    this.running = 0;
    this.waitingJobs = [];
    this.children = new Set();       // ffmpeg and Windows' decoders at work: stopped with the app
    this.stopped = false;
    this.adding = new Map();         // a file being added to a Viewer -> the same item, for a second ask meanwhile
    this.dirs = new Map();           // a folder -> its number: the page knows a folder by it, never by its path
    // copies a closing app left half made, from before this start
    setTimeout(() => this.prune(), 30000).unref();
  }

  // ---- what may be opened ----

  /** A file asked for, made whole and checked: never one that holds keys, never one of the person's record. */
  place(asked, cwd) {
    const t = String(asked || '').trim().replace(/^"(.*)"$/, '$1');
    if (!t) throw new Say('A file was named with nothing in it.');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^file:/i.test(t)) throw new Say(`${t}: the Viewer opens files on this computer; open web addresses with navigate.`);
    const plain = /^file:/i.test(t) ? decodeURIComponent(t.replace(/^file:\/*/i, '')) : t;
    const full = path.isAbsolute(plain) ? path.resolve(plain) : cwd ? path.resolve(cwd, plain) : '';
    if (!full) throw new Say(`${t}: give a whole path (this chat's folder is not known here).`);
    const name = path.basename(full);
    if (secretPath(full)) throw new Say(`${name} is not opened: the Viewer never opens a file in a folder whose name starts with a dot, in AppData or on another computer, or a file that holds keys.`);
    if (this.inRecord(full)) throw new Say(`${name} is in the user's record folder: the Viewer does not open files from there.`);
    let st;
    try { st = fs.statSync(full); } catch { throw new Say(`There is no file ${full}.`); }
    if (st.isDirectory()) throw new Say(`${full} is a folder: name the files in it.`);
    if (!st.isFile()) throw new Say(`${full} is not a file.`);
    return { full, name, st };
  }

  inRecord(full) {
    const low = (p) => p.toLowerCase().replace(/[\\/]+$/, '');
    const mine = [low(full), low(really(full))];
    return this.record().filter(Boolean).some((f) => [low(f), low(really(f))].some((r) => mine.some((m) => m === r || m.startsWith(`${r}\\`) || m.startsWith(`${r}/`))));
  }

  /** A file as an item of a chat's Viewer: the same file unchanged is the same item. */
  async add(asked, { cwd, home, by }) {
    const { full, name, st } = this.place(asked, cwd);
    const h = this.home(home);
    const same = (it) => it.file.toLowerCase() === full.toLowerCase() && it.size === st.size && it.mtime === st.mtimeMs;
    const had = h.items.find(same);
    if (had) return had;
    // a file of the folder being flipped through becomes one of the chat's, ffprobe's word on it first
    const near = h.folder ? h.folder.items.find((it) => it.near && same(it)) : null;
    if (near) {
      Object.assign(near, { near: false, by, at: Date.now() });
      await this.ready(near);
      return near;
    }
    const key = `${home}\n${full.toLowerCase()}\n${st.size}\n${st.mtimeMs}`;
    let making = this.adding.get(key);
    if (!making) {
      making = this.make(full, name, st, by).finally(() => this.adding.delete(key));
      this.adding.set(key, making);
    }
    return making;
  }

  async make(full, name, st, by) {
    let ext = path.extname(full).slice(1).toLowerCase();
    let kind = kindOf(ext);
    if (!kind) {
      const s = sniff(full);
      if (s) ({ kind, ext } = { kind: s.kind, ext: s.ext });
    }
    // a picture the window shows as it is waits for nothing: ffprobe's word on it (its size) comes meanwhile
    const plain = kind === 'image' && NATIVE.image.includes(ext);
    const info = plain ? null : await this.probe(full).catch(() => null);
    if (!kind && info) kind = info.w && info.duration > 0.05 ? 'video' : info.w ? 'image' : info.audio ? 'audio' : '';
    if (!kind) throw new Say(`${name} is not a picture, a video or a sound the Viewer knows.`);
    const item = this.item(full, ext, kind, st, by, info);
    if (plain) item.sizing = this.probe(full).then((i) => { if (i) { item.info = i; this.changed(); } }, () => {});
    const how = this.plan(item);
    if (how) this.makeCopy(item, how);
    return item;
  }

  /** A new item, by the name the page reaches it by. near: one of a folder flipped through, which no chat showed. */
  item(full, ext, kind, st, by, info, near = false) {
    const token = crypto.randomBytes(12).toString('base64url');
    const it = { id: `m${++this.n}`, token, file: full, name: path.basename(full), ext, kind, size: st.size, mtime: st.mtimeMs, mime: MIME[ext] || '', info: info || {}, by,
      at: Date.now(), copy: null, failed: '', near, probed: Boolean(info), dir: this.dirOf(full) };
    this.byToken.set(token, it);
    return it;
  }

  dirOf(full) {
    const d = path.dirname(full).toLowerCase();
    let n = this.dirs.get(d);
    if (!n) this.dirs.set(d, n = this.dirs.size + 1);
    return n;
  }

  /** Files added ADD_AT_ONCE at a time, in the order asked: each item, or why it was not added. */
  async addAll(list, o) {
    const out = [];
    for (let i = 0; i < list.length; i += ADD_AT_ONCE) {
      out.push(...await Promise.all(list.slice(i, i + ADD_AT_ONCE).map((f) => this.add(f, o).then((it) => ({ it }), (err) => ({ err })))));
    }
    return out;
  }

  /** A file put in front that ffprobe never read (one of a folder): what it is, and the copy the window plays when it needs one. */
  async ready(item) {
    if (!item.probed && item.kind !== 'image') {
      item.probed = true;
      const info = await this.probe(item.file).catch(() => null);
      if (info) { item.info = info; this.changed(); }
    }
    const how = this.plan(item);
    if (how) this.makeCopy(item, how);
  }

  /**
   * The files the person flips through beside one of a Viewer's: the pictures, videos and sounds of its folder, by
   * name, the FOLDER_MAX nearest to it. Only one folder is kept at a time, for the Viewer in front.
   */
  async folder(key, id) {
    const h = this.homes.get(key);
    const of = h && (h.items.find((it) => it.id === id) || (h.folder && h.folder.items.find((it) => it.id === id)));
    if (!of) return { error: 'That file is no longer in the Viewer.' };
    if (this.inRecord(of.file)) return { error: 'The Viewer does not open files from the user\'s record folder.' };
    const seq = h.folderSeq = (h.folderSeq || 0) + 1;
    const dir = path.dirname(of.file);
    let names = [];
    try {
      names = (await fs.promises.readdir(dir, { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name[0] !== '.' && kindOf(path.extname(d.name).slice(1).toLowerCase())).map((d) => d.name);
    } catch { names = []; }
    const own = (n) => n.toLowerCase() === of.name.toLowerCase();
    if (!names.some(own)) names.push(of.name);
    names.sort(byName);
    const total = names.length;
    if (total > FOLDER_MAX) {
      const from = Math.max(0, Math.min(total - FOLDER_MAX, names.findIndex(own) - FOLDER_MAX / 2));
      names = names.slice(from, from + FOLDER_MAX);
    }
    const sig = (file, size, mtime) => `${file.toLowerCase()}\n${size}\n${mtime}`;
    const known = new Map([...h.items, ...(h.folder ? h.folder.items : [])].map((it) => [sig(it.file, it.size, it.mtime), it]));
    const fresh = [];
    const found = await Promise.all(names.map(async (name) => {
      if (own(name)) return of;
      const full = path.join(dir, name);
      if (secretPath(full)) return null;
      let st;
      try { st = await fs.promises.stat(full); } catch { return null; }
      if (!st.isFile()) return null;
      const had = known.get(sig(full, st.size, st.mtimeMs));
      if (had) return had;
      const ext = path.extname(name).slice(1).toLowerCase();
      const it = this.item(full, ext, kindOf(ext), st, '', null, true);
      fresh.push(it);
      return it;
    }));
    // a newer listing of this Viewer's folder won meanwhile
    if (seq !== h.folderSeq || this.homes.get(key) !== h) {
      for (const it of fresh) this.byToken.delete(it.token);
      return { ok: false };
    }
    const items = found.filter(Boolean);
    for (const [k, other] of this.homes) {
      if (!other.folder) continue;
      for (const it of other.folder.items) if (it.near && !items.includes(it)) this.byToken.delete(it.token);
      if (k !== key) other.folder = null;
    }
    h.folder = { dir: of.dir, name: path.basename(dir), total, items };
    this.changed();
    return { ok: true, files: items.length };
  }

  /** How a file is made playable here, or null when the page plays it as it is. */
  plan(item) {
    const { ext, kind, info } = item;
    if (kind === 'image') return NATIVE.image.includes(ext) ? null : RAW.includes(ext) ? 'wic' : 'image';
    if (kind === 'audio') return NATIVE.audio.includes(ext) && (!info.audio || PLAYS_AUDIO.has(info.audio)) ? null : 'audio';
    const videoOk = !info.codec || PLAYS_VIDEO.has(info.codec);
    const audioOk = !info.audio || PLAYS_AUDIO.has(info.audio);
    if (NATIVE.video.includes(ext) && ext !== 'mkv' && videoOk && audioOk) return null;
    if (videoOk && info.codec) return audioOk ? 'remux' : 'reaudio';
    if (NATIVE.video.includes(ext) && !info.codec) return null;
    return 'video';
  }

  // ---- ffmpeg, ffprobe ----

  find() {
    if (!this.tools) {
      const look = (name) => new Promise((done) => {
        execFile('where', [name], { windowsHide: true, timeout: 5000 }, (err, out) => {
          const first = !err && String(out).split(/\r?\n/).find((l) => l.trim());
          if (first) { done(first.trim()); return; }
          const usual = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', `${name}.exe`);
          done(fs.existsSync(usual) ? usual : '');
        });
      });
      this.tools = Promise.all([look('ffmpeg'), look('ffprobe')]).then(([ffmpeg, ffprobe]) => ({ ffmpeg, ffprobe }));
    }
    return this.tools;
  }

  /** What ffprobe says of a file: its size in pixels, length, frame rate and what it is coded in. */
  async probe(file) {
    const { ffprobe } = await this.find();
    if (!ffprobe) return null;
    const out = await new Promise((done, fail) => {
      execFile(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true, timeout: PROBE_MS, maxBuffer: 8 * 1024 * 1024 },
        (err, text) => (err ? fail(err) : done(text)));
    });
    const j = JSON.parse(out);
    const streams = Array.isArray(j.streams) ? j.streams : [];
    const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const a = streams.find((s) => s.codec_type === 'audio');
    const f = j.format || {};
    const turn = v && Array.isArray(v.side_data_list) ? (v.side_data_list.find((d) => d.rotation !== undefined) || {}).rotation : v && v.tags && v.tags.rotate;
    return {
      w: v ? Number(v.width) || 0 : 0, h: v ? Number(v.height) || 0 : 0, codec: v ? String(v.codec_name || '') : '', fps: v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : 0,
      duration: Number(f.duration) || Number(v && v.duration) || Number(a && a.duration) || 0, audio: a ? String(a.codec_name || '') : '',
      rate: a ? Number(a.sample_rate) || 0 : 0, channels: a ? Number(a.channels) || 0 : 0, turn: Number(turn) || 0, format: String(f.format_name || ''),
    };
  }

  /** Runs ffmpeg below the person's own programs; onTime(seconds done) as it goes. */
  ffmpeg(args, onTime) {
    return this.find().then(({ ffmpeg }) => new Promise((done, fail) => {
      if (!ffmpeg) { fail(new Say('This computer has no ffmpeg: only what the window plays by itself can be shown. ffmpeg.org has it.')); return; }
      if (this.stopped) { fail(new Error('the app is closing')); return; }
      const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { windowsHide: true });
      this.children.add(child);
      child.on('close', () => this.children.delete(child));
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* it ended already */ }
      let said = '';
      let line = '';
      child.stdout.on('data', (d) => {
        line += d.toString('utf8');
        const parts = line.split(/\r?\n/);
        line = parts.pop();
        for (const l of parts) { const m = /^out_time_us=(\d+)/.exec(l); if (m && onTime) onTime(Number(m[1]) / 1e6); }
      });
      child.stderr.on('data', (d) => { said = (said + d.toString('utf8')).slice(-600); });
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? done() : fail(new Error(said.trim().split(/\r?\n/).pop() || `ffmpeg ended with ${code}`))));
    }));
  }

  wic(src, out) {
    const script = path.join(this.dir, 'viewer-wic.ps1');
    try {
      let had = '';
      try { had = fs.readFileSync(script, 'utf8'); } catch { /* not written yet */ }
      if (had !== WIC) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(script, WIC); }
    } catch { /* written next time */ }
    return new Promise((done, fail) => {
      if (this.stopped) { fail(new Error('the app is closing')); return; }
      const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-src', src, '-out', out], { windowsHide: true, timeout: 60000 },
        (err, _o, e) => (err ? fail(new Error(String(e || err.message).trim().split(/\r?\n/)[0] || 'Windows could not read it')) : done()));
      this.children.add(child);
      child.on('close', () => this.children.delete(child));
    });
  }

  /** The app is closing: what is being made stops, its part-made file is cleared at the next start. */
  stop() {
    this.stopped = true;
    for (const child of this.children) { try { child.kill(); } catch { /* ended meanwhile */ } }
    this.children.clear();
  }

  /** Where a copy or a small picture of an item is kept: named after the file as it is now. */
  cached(item, ending) {
    const key = crypto.createHash('sha1').update(`${item.file}|${item.size}|${item.mtime}`).digest('hex').slice(0, 20);
    return path.join(this.dir, `${key}.${ending}`);
  }

  /** Makes, one at a time, the copy the page plays: the item says how far along it is. */
  makeCopy(item, how) {
    if (item.copy && item.copy.state !== 'failed') return;
    const ending = item.kind === 'image' ? 'png' : item.kind === 'audio' ? 'm4a' : 'mp4';
    const out = this.cached(item, `${how}.${ending}`);
    item.copy = { state: 'waiting', progress: 0, said: '', file: out, mime: ending === 'png' ? 'image/png' : ending === 'm4a' ? 'audio/mp4' : 'video/mp4', how };
    this.changed();
    if (fs.existsSync(out)) { item.copy.state = 'ready'; item.copy.progress = 1; this.changed(); return; }
    const part = `${out}.part.${ending}`;
    const time = (s) => { if (item.info.duration > 0) { item.copy.progress = Math.min(0.99, s / item.info.duration); this.changed(); } };
    const progress = ['-progress', 'pipe:1', '-nostats'];
    const runs = {
      image: () => this.ffmpeg(['-i', item.file, '-frames:v', '1', '-vf', "scale='min(4096,iw)':-1", '-update', '1', part]).catch((err) => this.wic(item.file, part).catch(() => { throw err; })),
      wic: () => this.wic(item.file, part).catch((err) => this.ffmpeg(['-i', item.file, '-frames:v', '1', '-update', '1', part]).catch(() => { throw err; })),
      audio: () => this.ffmpeg(['-i', item.file, ...progress, '-vn', '-c:a', 'aac', '-b:a', '192k', part], time),
      remux: () => this.ffmpeg(['-i', item.file, ...progress, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', part], time)
        .catch(() => runs.video()),
      reaudio: () => this.ffmpeg(['-i', item.file, ...progress, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', part], time)
        .catch(() => runs.video()),
      video: () => this.ffmpeg(['-i', item.file, ...progress, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-vf', "scale='trunc(min(1920,iw)/2)*2':-2", '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', part], time),
    };
    this.queue = this.queue.then(async () => {
      if (!this.byToken.has(item.token)) return;
      item.copy.state = 'making';
      this.changed();
      const t0 = Date.now();
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        await runs[how]();
        fs.renameSync(part, out);
        item.copy.state = 'ready';
        item.copy.progress = 1;
        this.log(`viewer: a ${item.kind} copied to play here in ${((Date.now() - t0) / 1000).toFixed(1)} s (${how})`);
        this.prune();
      } catch (err) {
        try { fs.rmSync(part, { force: true }); } catch { /* not there */ }
        item.copy.state = 'failed';
        item.copy.said = err instanceof Say ? err.message : `It could not be made playable here: ${String(err && err.message).slice(0, 200)}`;
        this.log(`viewer: a ${item.kind} (.${item.ext}) could not be copied: ${String(err && err.message).slice(0, 200)}`);
      }
      this.changed();
    });
  }

  /** The small picture for a file's place in the strip or the grid, made once, two at a time. Empty: none can be made. */
  thumb(item) {
    if (item.kind === 'audio') return Promise.resolve('');
    const out = this.cached(item, 'thumb.jpg');
    if (fs.existsSync(out)) return Promise.resolve(out);
    if (this.thumbs.has(item.token)) return this.thumbs.get(item.token);
    const src = item.copy && item.copy.state === 'ready' ? item.copy.file : item.file;
    const at = item.kind === 'video' && item.info.duration > 2 ? ['-ss', String(Math.min(1, item.info.duration / 10))] : [];
    const made = this.slot(async () => {
      if (fs.existsSync(out)) return out;
      fs.mkdirSync(this.dir, { recursive: true });
      const part = `${out}.part.jpg`;
      try {
        await this.ffmpeg([...at, '-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', '-update', '1', part]);
        fs.renameSync(part, out);
        return out;
      } catch {
        try { fs.rmSync(part, { force: true }); } catch { /* not there */ }
        return '';
      }
    }).finally(() => this.thumbs.delete(item.token));
    this.thumbs.set(item.token, made);
    return made;
  }

  /** Runs job when one of THUMBS_AT_ONCE places is free: a grid of 24 files never starts 24 programs at once. */
  slot(job) {
    return new Promise((done) => {
      const go = () => {
        this.running++;
        Promise.resolve().then(job).then(done, () => done('')).finally(() => {
          this.running--;
          const next = this.waitingJobs.shift();
          if (next) next();
        });
      };
      if (this.running < THUMBS_AT_ONCE) go(); else this.waitingJobs.push(go);
    });
  }

  /** The copies and small pictures stay under CACHE_MAX together: the oldest go. A part-made copy an hour old was left by a closing app. */
  prune() {
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => !f.endsWith('.ps1')).map((f) => {
        const p = path.join(this.dir, f);
        const st = fs.statSync(p);
        return { p, size: st.size, at: st.mtimeMs, part: f.includes('.part.') };
      });
    } catch { return; }
    for (const f of files) if (f.part && Date.now() - f.at > 60 * 60e3) { try { fs.rmSync(f.p, { force: true }); } catch { /* in use */ } }
    files = files.filter((f) => !f.part);
    let total = files.reduce((n, f) => n + f.size, 0);
    const inUse = new Set([...this.byToken.values()].flatMap((it) => [it.copy && it.copy.file].filter(Boolean)));
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= CACHE_MAX) break;
      if (inUse.has(f.p)) continue;
      try { fs.rmSync(f.p, { force: true }); total -= f.size; } catch { /* in use */ }
    }
  }

  // ---- the files, to the page ----

  /** Serves lowlit-media://o/<name> (the file), c/<name> (its copy) and t/<name> (its small picture), in ranges for video. */
  async serve(request) {
    let u;
    try { u = new URL(request.url); } catch { return new Response('Not here.', { status: 404 }); }
    const item = this.byToken.get(u.pathname.replace(/^\/+/, '').split('/')[0]);
    if (!item) return new Response('Not here.', { status: 404 });
    let file = '';
    let mime = '';
    if (u.host === 'o') { file = item.file; mime = item.mime || 'application/octet-stream'; }
    else if (u.host === 'c' && item.copy && item.copy.state === 'ready') { file = item.copy.file; mime = item.copy.mime; }
    else if (u.host === 't') { file = await this.thumb(item); mime = 'image/jpeg'; }
    if (!file) return new Response('Not here.', { status: 404 });
    let size = 0;
    try { size = (await fs.promises.stat(file)).size; } catch { return new Response('Gone.', { status: 404 }); }
    // a name stands for one file as it was when it was named, and for its small picture: the page keeps what it read
    // (a picture shown again, or loaded ahead for the arrows, is not read again); a copy can be made anew, of another kind
    const head = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
      'Cache-Control': u.host === 'c' ? 'no-cache' : 'private, max-age=31536000, immutable' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.get('range') || '').trim());
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...head, 'Content-Range': `bytes */${size}` } });
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206,
        headers: { ...head, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...head, 'Content-Length': String(size) } });
  }

  home(key) {
    let h = this.homes.get(key);
    if (!h) this.homes.set(key, h = { items: [], shown: [], mode: 'one', title: '', note: '', by: '', at: 0, seq: 0, start: 0, play: null, loop: null });
    return h;
  }

  /** What the page is told: each chat's Viewer, without a path in it (a folder is a number, and its last name). */
  view() {
    const homes = {};
    const shape = (it) => ({ id: it.id, token: it.token, name: it.name, ext: it.ext, kind: it.kind, size: it.size, info: it.info, by: it.by, at: it.at, dir: it.dir,
      native: !this.plan(it), copy: it.copy ? { state: it.copy.state, progress: it.copy.progress, said: it.copy.said } : null, failed: it.failed });
    for (const [key, h] of this.homes) {
      homes[key] = { ...h, items: h.items.map(shape),
        folder: h.folder ? { dir: h.folder.dir, name: h.folder.name, total: h.folder.total, items: h.folder.items.map(shape) } : null };
    }
    return { homes };
  }

  changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.send('desk:viewer', this.view()); }, 60);
  }

  /** What the page is told, at once: a question about a show must not reach it before the show does. */
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.send('desk:viewer', this.view());
  }

  /** Files put in front in a chat's Viewer: the page opens it there, or says so when that chat is not in front. */
  present(key, items, o) {
    const h = this.home(key);
    for (const it of items) {
      h.items = h.items.filter((x) => x.id !== it.id);
      h.items.push(it);
    }
    while (h.items.length > ITEMS_MAX) {
      const old = h.items.shift();
      // one of the folder being flipped through stays there
      if (h.folder && h.folder.items.includes(old)) old.near = true;
      else this.byToken.delete(old.token);
    }
    // a file new to the folder being flipped through (a chat made it since): the folder is read again
    const added = h.folder ? items.find((it) => it.dir === h.folder.dir && !h.folder.items.includes(it)) : null;
    if (added) this.folder(key, added.id).catch(() => {});
    Object.assign(h, { shown: items.map((it) => it.id), mode: o.mode, title: String(o.title || '').slice(0, 120), note: String(o.note || '').slice(0, 400), by: o.by,
      at: Date.now(), seq: ++this.shows, start: Math.max(0, Number(o.start) || 0), play: typeof o.play === 'boolean' ? o.play : null, loop: typeof o.loop === 'boolean' ? o.loop : null });
    this.changed();
  }

  /** A question to the page, answered by answer(). */
  ask(what, args, ms = ASK_MS) {
    return new Promise((done, fail) => {
      const id = ++this.asked;
      const timer = setTimeout(() => { this.waiting.delete(id); fail(new Say('The window did not answer in time. Is Lowlit open?')); }, ms);
      this.waiting.set(id, { done, fail, timer });
      this.send('desk:viewer-ask', { id, what, args });
    });
  }

  answer(id, result) {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    clearTimeout(w.timer);
    if (result && typeof result.error === 'string') w.fail(new Say(result.error));
    else w.done(result || {});
  }

  /** The person's side, from the page: files opened from a dialog or dropped, a copy asked for, a file shown in its folder. */
  async request(what, a, b) {
    if (what === 'open') {
      const key = typeof b === 'string' ? b : '';
      const list = Array.isArray(a) ? a.slice(0, SHOW_MAX) : [];
      const made = [];
      const refused = [];
      for (const r of await this.addAll(list, { cwd: '', home: key, by: 'you' })) {
        if (r.it) made.push(r.it); else refused.push(r.err instanceof Say ? r.err.message : String(r.err && r.err.message));
      }
      if (made.length) this.present(key, made, { mode: made.length === 2 ? 'compare' : made.length > 2 ? 'grid' : 'one', by: 'you' });
      return { shown: made.length, refused };
    }
    // the folder of a Viewer's file, to flip through (a: the file, b: the Viewer)
    if (what === 'folder') return this.folder(typeof b === 'string' ? b : '', a);
    const item = [...this.byToken.values()].find((it) => it.id === a);
    if (!item) return { error: 'That file is no longer in the Viewer.' };
    // a file of the folder put in front, which the window cannot show as it is: its copy is made
    if (what === 'make') { await this.ready(item); return { ok: true }; }
    if (what === 'copy') {
      // the window could not play it as it is, or a copy that only changed its wrapping: a copy made anew, the
      // plainest kind there is; a plain copy it could not play either is given up on
      item.failed = String(b || 'not played').slice(0, 120);
      const had = item.copy && item.copy.state === 'ready' ? item.copy.how : '';
      if (had && had !== 'remux' && had !== 'reaudio') {
        item.copy = { ...item.copy, state: 'failed', said: `The window could not play ${item.name}, even from a copy made to play here.` };
        this.log(`viewer: a ${item.kind} (.${item.ext}) did not play even from its copy (${had})`);
        this.changed();
        return { ok: false };
      }
      item.copy = null;
      this.makeCopy(item, item.kind === 'image' ? (RAW.includes(item.ext) ? 'wic' : 'image') : item.kind);
      return { ok: true };
    }
    // only a file whose own name says it is a picture, a video or a sound is handed to the program Windows opens it with
    if (what === 'path') return { path: item.file, known: Boolean(kindOf(path.extname(item.file).slice(1).toLowerCase())) };
    return { error: `No ${what} here.` };
  }

  // ---- what a chat asks for, through the door ----

  /** Whose Viewer a chat's files go to: its chat of this window, or its session running elsewhere; never a guess. */
  homeOf(drv) {
    const key = drv.chat || (drv.key ? `s:${drv.key}` : '');
    if (!key) throw new Say('Lowlit could not tell which chat is asking, so it shows nothing rather than show it beside another chat. Try again in a few seconds.');
    return key;
  }

  describe(it, seen) {
    const s = seen || {};
    const i = it.info || {};
    const w = i.w || s.w;
    const h = i.h || s.h;
    const duration = i.duration || s.duration;
    const parts = [it.kind, w && h ? `${w} × ${h}` : '', it.kind !== 'image' && duration ? timeWords(duration) : '', i.fps && it.kind === 'video' ? `${i.fps} fps` : '',
      i.codec && it.kind !== 'image' ? i.codec : '', i.audio && it.kind === 'video' ? `sound ${i.audio}` : '', sizeWords(it.size)].filter(Boolean);
    const copy = it.copy ? (it.copy.state === 'ready' ? ' (shown from a copy made to play here)' : it.copy.state === 'failed' ? `; ${it.copy.said}` : ' (a copy that plays here is being made; it shows when done)') : '';
    return `${it.name}: ${parts.join(', ')}${copy}${s.error ? `; the window could not show it: ${s.error}` : ''}`;
  }

  async showTool(drv, args) {
    const key = this.homeOf(drv);
    const list = Array.isArray(args.files) ? args.files : typeof args.files === 'string' ? [args.files] : [];
    if (!list.length) throw new Say('Name the files to show: files is a list of paths, whole or from this chat\'s folder.');
    if (list.length > SHOW_MAX) throw new Say(`At most ${SHOW_MAX} files at a time.`);
    const cwd = this.where(drv);
    const made = [];
    const refused = [];
    for (const r of await this.addAll(list, { cwd, home: key, by: drv.name || 'A chat' })) {
      if (r.it) made.push(r.it); else if (r.err instanceof Say) refused.push(r.err.message); else throw r.err;
    }
    if (!made.length) throw new Say(refused.join('\n'));
    const mode = ['one', 'compare', 'grid'].includes(args.mode) ? args.mode : made.length === 2 ? 'compare' : made.length > 2 ? 'grid' : 'one';
    this.present(key, made, { mode, title: args.title, note: args.note, by: drv.name || 'A chat', start: args.at, play: args.play, loop: args.loop });
    this.flush();
    const seen = await this.ask('shown', { home: key, ids: made.map((it) => it.id) }).catch(() => null);
    // what ffprobe says of the pictures, read meanwhile: their size when the window could not say it
    await Promise.all(made.map((it) => it.sizing));
    const lines = made.map((it, n) => `${n + 1}. ${this.describe(it, seen && seen.items && seen.items[it.id])}`);
    const where = !seen ? 'The window did not answer: it shows them once it does.'
      : seen.open ? `The user sees ${made.length === 1 ? 'it' : 'them'} now in the Viewer beside this chat${made.length > 1 ? ` (${mode === 'compare' ? 'side by side' : mode === 'grid' ? 'as a grid' : 'one at a time'})` : ''}.`
        : 'This chat is not the one in front: the user is told, and the Viewer opens when they go to it.';
    return { text: [`Showing ${made.length} file${made.length === 1 ? '' : 's'}. ${where}`, ...lines, ...refused.map((r) => `Not shown: ${r}`),
      'media_control plays, pauses, seeks or steps a frame; media_look hands back a picture of what is shown.'].join('\n') };
  }

  async controlTool(drv, args) {
    const action = String(args.action || '').trim();
    const ACTIONS = ['play', 'pause', 'seek', 'step', 'speed', 'loop', 'mute', 'volume', 'zoom', 'select', 'next', 'previous', 'mode', 'close', 'state'];
    if (!ACTIONS.includes(action)) throw new Say(`Say what to do: ${ACTIONS.join(', ')}.`);
    const r = await this.ask('control', { home: this.homeOf(drv), action, value: args.value });
    return { text: r.said || 'Done.' };
  }

  async lookTool(drv, args) {
    const at = args.at === undefined || args.at === null || args.at === '' ? null : Number(args.at);
    if (at !== null && !(at >= 0)) throw new Say('at is a second of the video: 0 or more.');
    const r = await this.ask('look', { home: this.homeOf(drv), at, file: args.file === undefined ? null : Number(args.file) }, 30000);
    if (!r.data) throw new Say(r.said || 'There was nothing to look at.');
    return { text: r.said, image: { data: r.data, mimeType: 'image/jpeg' } };
  }
}

/** Every file ending the Viewer opens, for the box that picks files. */
const EXTENSIONS = [...new Set(Object.values(NATIVE).concat(Object.values(COPIED)).flat())];

module.exports = { Viewer, SCHEME, EXTENSIONS, kindOf };
