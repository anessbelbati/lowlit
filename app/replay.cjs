'use strict';
// What a chat's console printed lately, kept in the main process for a page that starts over (it was loaded again
// for new code, or its program died): the new page draws each chat from this, then carries on with what comes next.
//
// A terminal handed old output answers the questions in it (what are you, where is the cursor, what colour is your
// ground), and those answers would be typed into the chat as junk: questions are left out here as they pass. What
// the programs switched on in the terminal (the second screen of a full-screen program, the mouse, pasting in one
// piece) was said once, long before what is kept: it is remembered from the first byte on and said again first.

const KEPT = 1024 * 1024;        // bytes kept for each console; older output is dropped a piece at a time
const PIECE = 16 * 1024;         // what arrives is joined into pieces of about this size
const OPEN_MAX = 64 * 1024;      // an unfinished control longer than this is let through as it stands

// The terminal switches that hold until they are switched off (cursor keys, wrapping, the cursor shown, the second
// screen, the mouse and how it reports, focus reports, pasting in one piece). One that lasts a frame (2026) is not.
const SWITCHES = new Set([1, 7, 9, 25, 47, 1000, 1002, 1003, 1004, 1005, 1006, 1007, 1015, 1016, 1047, 1049, 2004]);
const ON_AT_START = new Set([7, 25]);

/**
 * Where the control that starts with ESC at `at` ends (the index after it), or -1 when the text stops before it
 * does. Strings (OSC, DCS and their kin) end at ST or BEL; CAN and SUB cut any control short.
 */
function controlEnd(s, at) {
  const kind = s[at + 1];
  if (kind === undefined) return -1;
  if (kind === '[') {
    for (let i = at + 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return i + 1;
      if (c < 0x20 || c > 0x3f) return i;
    }
    return -1;
  }
  if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
    for (let i = at + 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x07 && kind === ']') return i + 1;
      if (c === 0x18 || c === 0x1a) return i + 1;
      if (c === 0x1b) return i + 1 >= s.length ? -1 : s[i + 1] === '\\' ? i + 2 : i;
    }
    return -1;
  }
  for (let i = at + 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30 && c <= 0x7e) return i + 1;
    if (c < 0x20 || c > 0x2f) return i;
  }
  return -1;
}

/** A control the terminal answers: device status and attributes, its version, a mode, keyboard flags, a colour, a setting. */
function isQuestion(control) {
  const kind = control[1];
  if (kind === '[') {
    const last = control[control.length - 1];
    if (last === 'c') return true;
    if (last === 'n') return control[2] !== '>';
    if (last === 'q') return control[2] === '>';
    if (last === 'u') return control[2] === '?';
    return last === 'p' && control[control.length - 2] === '$';
  }
  if (kind === ']') return /^\x1b\](?:4|1\d);(?:.*;)?\?(?:\x07|\x1b\\)?$/s.test(control);
  if (kind === 'P') return control.startsWith('\x1bP$q') || control.startsWith('\x1bP+q');
  return false;
}

/** The switches a control turns on or off: [[number, on]]. */
function switchesIn(control) {
  const m = /^\x1b\[\?([\d;]+)([hl])$/.exec(control);
  if (!m) return [];
  return m[1].split(';').map(Number).filter((n) => SWITCHES.has(n)).map((n) => [n, m[2] === 'h']);
}

class Tail {
  constructor() {
    this.seq = 0;              // how many times output arrived: a page skips what it already has by this number
    this.pieces = [];          // [{ bytes, switches }], oldest first
    this.size = 0;
    this.fresh = [];           // what arrived since the newest piece was sealed, not yet joined
    this.freshLength = 0;
    this.freshSwitches = [];
    this.open = '';            // a control that has begun and not ended yet
    this.before = new Map();   // switch -> on, as it stood where the kept output begins
  }

  append(text) {
    this.seq++;
    const work = this.open + text;
    this.open = '';
    let keep = '';
    let from = 0;
    for (;;) {
      const at = work.indexOf('\x1b', from);
      if (at < 0) { keep += work.slice(from); break; }
      keep += work.slice(from, at);
      const end = controlEnd(work, at);
      if (end < 0) {
        const rest = work.slice(at);
        if (rest.length > OPEN_MAX) keep += rest; else this.open = rest;
        break;
      }
      const control = work.slice(at, end);
      if (!isQuestion(control)) {
        keep += control;
        if (control[2] === '?' && control[1] === '[') this.freshSwitches.push(...switchesIn(control));
      }
      from = end;
    }
    if (!keep) return;
    this.fresh.push(keep);
    this.freshLength += keep.length;
    if (this.freshLength >= PIECE) this.seal();
  }

  seal() {
    if (!this.fresh.length) return;
    const bytes = Buffer.from(this.fresh.join(''), 'utf8');
    this.pieces.push({ bytes, switches: this.freshSwitches });
    this.size += bytes.length;
    this.fresh = [];
    this.freshLength = 0;
    this.freshSwitches = [];
    while (this.pieces.length > 1 && this.size - this.pieces[0].bytes.length >= KEPT) {
      const gone = this.pieces.shift();
      this.size -= gone.bytes.length;
      for (const [n, on] of gone.switches) this.before.set(n, on);
    }
  }

  /** What a new terminal is given: the switches as they stood, then what was printed. seq: the last arrival in it. */
  snapshot() {
    let lead = '';
    for (const [n, on] of this.before) if (on !== ON_AT_START.has(n)) lead += `\x1b[?${n}${on ? 'h' : 'l'}`;
    const kept = Buffer.concat(this.pieces.map((p) => p.bytes)).toString('utf8');
    return { data: lead + kept + this.fresh.join('') + this.open, seq: this.seq };
  }
}

module.exports = { Tail, controlEnd, isQuestion, switchesIn };
