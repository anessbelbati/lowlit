'use strict';
// Animated GIFs of a page of the browser, made one frame at a time. A frame keeps only the box that changed since the
// frame before (the rest stays on screen from before), with 256 colours of its own picked from that box, so text stays
// sharp; a frame like the one before is not kept, the one before shows longer. browser.cjs runs this file as a thread
// of its own, so the window never waits on a frame being made; GifStream also works where this file is required.

const fs = require('node:fs');
const { parentPort, workerData, isMainThread } = require('node:worker_threads');

const MIN_CS = 2;                    // the shortest a frame shows, in hundredths of a second (browsers draw less as 10)
const MAX_CS = 200;                  // a page that did not change for longer still shows 2 s: a GIF is watched, not waited through
const END_CS = 200;                  // the last frame, before it plays again

/** The box where two pictures of the same size differ, or null when they do not. */
function changed(a, b, w, h) {
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) if (a[r + x] !== b[r + x]) { top = y; break; }
  }
  if (top < 0) return null;
  let bottom = top;
  for (let y = h - 1; y > top; y--) {
    const r = y * w;
    let hit = false;
    for (let x = 0; x < w; x++) if (a[r + x] !== b[r + x]) { hit = true; break; }
    if (hit) { bottom = y; break; }
  }
  let left = w;
  let right = -1;
  for (let y = top; y <= bottom; y++) {
    const r = y * w;
    for (let x = 0; x < left; x++) if (a[r + x] !== b[r + x]) { left = x; break; }
    for (let x = w - 1; x > right; x--) if (a[r + x] !== b[r + x]) { right = x; break; }
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * At most 256 colours for the pixels of a box (each a number: blue, green and red from its lowest byte up), and each
 * pixel's colour among them. Colours are first gathered at 5 bits a channel; when more than 256 are left, the group
 * that holds the most pixels over the widest spread is cut in two at its middle pixel, until there are 256 groups.
 * Each group's colour is the mean of its pixels.
 */
function colours(px, width, box) {
  const n = box.w * box.h;
  const keys = new Uint16Array(n);
  const count = new Uint32Array(32768);
  const sr = new Float64Array(32768);
  const sg = new Float64Array(32768);
  const sb = new Float64Array(32768);
  const used = [];
  let k = 0;
  for (let y = 0; y < box.h; y++) {
    const row = (box.y + y) * width + box.x;
    for (let x = 0; x < box.w; x++) {
      const v = px[row + x];
      const b = v & 255;
      const g = (v >>> 8) & 255;
      const r = (v >>> 16) & 255;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if (!count[key]) used.push(key);
      count[key]++;
      sr[key] += r;
      sg[key] += g;
      sb[key] += b;
      keys[k++] = key;
    }
  }
  let groups = [used];
  if (used.length > 256) {
    const chan = (key, c) => (c === 0 ? key >> 10 : c === 1 ? (key >> 5) & 31 : key & 31);
    const spread = (list) => {
      let best = 0;
      let at = 0;
      let pixels = 0;
      for (let c = 0; c < 3; c++) {
        let lo = 31;
        let hi = 0;
        for (const key of list) { const v = chan(key, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > best) { best = hi - lo; at = c; }
      }
      for (const key of list) pixels += count[key];
      return { range: best, c: at, pixels };
    };
    const info = [spread(used)];
    while (groups.length < 256) {
      let pick = -1;
      let score = 0;
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].length < 2 || !info[i].range) continue;
        const s = info[i].pixels * info[i].range;
        if (s > score) { score = s; pick = i; }
      }
      if (pick < 0) break;
      const list = groups[pick];
      const c = info[pick].c;
      list.sort((a, b) => chan(a, c) - chan(b, c));
      const half = info[pick].pixels / 2;
      let sum = 0;
      let cut = 1;
      for (let i = 0; i < list.length - 1; i++) {
        sum += count[list[i]];
        if (sum >= half) { cut = i + 1; break; }
        cut = i + 1;
      }
      const a = list.slice(0, cut);
      const b = list.slice(cut);
      groups[pick] = a;
      info[pick] = spread(a);
      groups.push(b);
      info.push(spread(b));
    }
  } else {
    groups = used.map((key) => [key]);
  }
  const table = new Uint8Array(768);
  const lut = new Uint8Array(32768);
  groups.forEach((list, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let m = 0;
    for (const key of list) { r += sr[key]; g += sg[key]; b += sb[key]; m += count[key]; lut[key] = i; }
    table[i * 3] = Math.round(r / m);
    table[i * 3 + 1] = Math.round(g / m);
    table[i * 3 + 2] = Math.round(b / m);
  });
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) index[i] = lut[keys[i]];
  return { table, index };
}

// LZW as GIF wants it: codes from 9 to 12 bits, a table cleared when full, written in blocks of at most 255 bytes.
const BITS = 12;
const HSIZE = 5003;
const MASKS = [0x0000, 0x0001, 0x0003, 0x0007, 0x000F, 0x001F, 0x003F, 0x007F, 0x00FF, 0x01FF, 0x03FF, 0x07FF, 0x0FFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF];

function lzw(pixels) {
  const out = [];
  const initCodeSize = 8;
  out.push(initCodeSize);
  const accum = new Uint8Array(256);
  let aCount = 0;
  const htab = new Int32Array(HSIZE);
  const codetab = new Int32Array(HSIZE);
  const initBits = initCodeSize + 1;
  const maxmaxcode = 1 << BITS;
  const clearCode = 1 << initCodeSize;
  const eofCode = clearCode + 1;
  let nBits = initBits;
  let maxcode = (1 << nBits) - 1;
  let freeEnt = clearCode + 2;
  let clearFlag = false;
  let curAccum = 0;
  let curBits = 0;
  const flushChar = () => {
    if (aCount > 0) {
      out.push(aCount);
      for (let i = 0; i < aCount; i++) out.push(accum[i]);
      aCount = 0;
    }
  };
  const charOut = (c) => { accum[aCount++] = c; if (aCount >= 254) flushChar(); };
  const output = (code) => {
    curAccum &= MASKS[curBits];
    curAccum = curBits > 0 ? curAccum | (code << curBits) : code;
    curBits += nBits;
    while (curBits >= 8) { charOut(curAccum & 0xff); curAccum >>= 8; curBits -= 8; }
    if (freeEnt > maxcode || clearFlag) {
      if (clearFlag) { nBits = initBits; maxcode = (1 << nBits) - 1; clearFlag = false; } else { nBits++; maxcode = nBits === BITS ? maxmaxcode : (1 << nBits) - 1; }
    }
    if (code === eofCode) {
      while (curBits > 0) { charOut(curAccum & 0xff); curAccum >>= 8; curBits -= 8; }
      flushChar();
    }
  };
  let hshift = 0;
  for (let f = HSIZE; f < 65536; f *= 2) hshift++;
  hshift = 8 - hshift;
  htab.fill(-1);
  output(clearCode);
  let ent = pixels[0];
  next: for (let p = 1; p < pixels.length; p++) {
    const c = pixels[p];
    const fcode = (c << BITS) + ent;
    let i = (c << hshift) ^ ent;
    if (htab[i] === fcode) { ent = codetab[i]; continue; }
    if (htab[i] >= 0) {
      const disp = i === 0 ? 1 : HSIZE - i;
      do {
        if ((i -= disp) < 0) i += HSIZE;
        if (htab[i] === fcode) { ent = codetab[i]; continue next; }
      } while (htab[i] >= 0);
    }
    output(ent);
    ent = c;
    if (freeEnt < maxmaxcode) {
      codetab[i] = freeEnt++;
      htab[i] = fcode;
    } else {
      htab.fill(-1);
      freeEnt = clearCode + 2;
      clearFlag = true;
      output(clearCode);
    }
  }
  output(ent);
  output(eofCode);
  out.push(0);
  return Buffer.from(out);
}

class GifStream {
  constructor() {
    this.parts = [];
    this.width = 0;
    this.height = 0;
    this.prev = null;                // the last frame taken, to tell what the next one changed
    this.pending = null;             // the last frame made, waiting to know how long it shows: { bytes, at }
    this.frames = 0;
  }

  /**
   * A frame: its pixels 4 bytes each, blue first (as a picture of a page is handed over on Windows), rows of `stride`
   * bytes, taken at `at` (ms). Every frame has the size of the first. false: like the one before, not kept.
   */
  frame(bytes, width, height, at, stride = width * 4) {
    if (!this.width) this.start(width, height);
    if (width !== this.width || height !== this.height) throw new Error(`a frame of ${width}x${height} in a GIF of ${this.width}x${this.height}`);
    let px;
    if (stride === width * 4 && bytes.byteOffset % 4 === 0) {
      px = new Uint32Array(bytes.buffer, bytes.byteOffset, width * height);
    } else {
      px = new Uint32Array(width * height);
      const view = new Uint8Array(px.buffer);
      for (let y = 0; y < height; y++) view.set(bytes.subarray(y * stride, y * stride + width * 4), y * width * 4);
    }
    const box = this.prev ? changed(this.prev, px, width, height) : { x: 0, y: 0, w: width, h: height };
    if (!box) return false;
    this.flush(at);
    const { table, index } = colours(px, width, box);
    const d = Buffer.alloc(10 + 768);
    d[0] = 0x2c;
    d.writeUInt16LE(box.x, 1);
    d.writeUInt16LE(box.y, 3);
    d.writeUInt16LE(box.w, 5);
    d.writeUInt16LE(box.h, 7);
    d[9] = 0x87;                     // a table of its own, 256 colours
    Buffer.from(table.buffer, table.byteOffset, 768).copy(d, 10);
    this.pending = { bytes: [d, lzw(index)], at };
    this.prev = px;
    this.frames++;
    return true;
  }

  start(width, height) {
    this.width = width;
    this.height = height;
    const head = Buffer.alloc(13);
    head.write('GIF89a', 0, 'ascii');
    head.writeUInt16LE(width, 6);
    head.writeUInt16LE(height, 8);
    head[10] = 0x70;                 // no table for the whole picture: each frame has its own
    // plays again and again (the NETSCAPE2.0 block every browser reads)
    this.parts.push(head, Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00]));
  }

  flush(at) {
    if (this.pending) this.write(Math.max(MIN_CS, Math.min(MAX_CS, Math.round((at - this.pending.at) / 10))));
  }

  write(cs) {
    // left on screen under the next frame (disposal 1), shown for cs hundredths of a second
    this.parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x04, cs & 0xff, cs >> 8, 0x00, 0x00]), ...this.pending.bytes);
    this.pending = null;
  }

  /** The GIF as it is now, closed: the last frame shows END_CS before it plays again. */
  end() {
    if (this.pending) this.write(END_CS);
    return Buffer.concat([...this.parts, Buffer.from([0x3b])]);
  }
}

// as a thread: frames come in as they are taken; at the end the GIF is written where it was asked for
if (!isMainThread && workerData && workerData.gif) {
  const gif = new GifStream();
  let failed = '';
  parentPort.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'frame') {
      if (failed) return;
      try {
        const bytes = new Uint8Array(m.data);
        gif.frame(bytes, m.width, m.height, m.at, Math.floor(bytes.byteLength / m.height));
      } catch (err) {
        failed = String(err && err.message || err);
      }
    } else if (m.t === 'end') {
      try {
        if (failed) throw new Error(failed);
        if (!gif.frames) { parentPort.postMessage({ t: 'done', frames: 0, bytes: 0, width: 0, height: 0, file: '' }); return; }
        const out = gif.end();
        fs.writeFileSync(m.file, out);
        parentPort.postMessage({ t: 'done', frames: gif.frames, bytes: out.length, width: gif.width, height: gif.height, file: m.file });
      } catch (err) {
        parentPort.postMessage({ t: 'error', message: String(err && err.message || err) });
      }
    }
  });
}

module.exports = { GifStream, changed, colours, lzw };
