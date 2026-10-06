'use strict';
// Lowlit's site: the Copy button, and the light.
// The light is the app's own (app/noir.js) in one pass: a lamp just past the top left corner, its rays turning slowly
// through a drifting fog, drawn in fine dots by ordered dithering. Silver on black, never a colour.
// What it costs: at most 24 frames a second, and none while it is off the screen or the tab is hidden; one still
// frame for whoever asked for less motion. Where WebGL cannot be had the stylesheet draws a still lamp (.light.flat).

(() => {
  for (const b of document.querySelectorAll('.copy')) {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Select and copy';
      }
      setTimeout(() => { b.textContent = 'Copy'; }, 1800);
    });
  }

  const host = document.querySelector('.light');
  if (!host) return;

  const FPS = 24;
  // a frame that stands still is always the same one: a moment when the beam is full
  const STILL_AT = 12;
  const VERT = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';
  const FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D u_noise;
    uniform sampler2D u_bayer;
    uniform vec2 u_res;     // the canvas, in its own pixels
    uniform float u_cell;   // the side of a dot, in those pixels
    uniform vec4 u_move;    // x the rays' slow turn, yz the fog's drift (wrapped every 256), w breath
    float n(vec2 p) { return texture2D(u_noise, p * 0.00390625).r; }
    float fbm2(vec2 p) { return 0.5 * n(p) + 0.25 * n(p * 2.0); }
    float fbm3(vec2 p) { return 0.5 * n(p) + 0.25 * n(p * 2.0) + 0.125 * n(p * 4.0); }
    void main() {
      // every pixel of a dot asks for the light at the dot's middle, so a dot is lit whole or not at all
      vec2 cell = floor(gl_FragCoord.xy / u_cell);
      vec2 v = (cell + 0.5) * u_cell / u_res;
      // in heights of the canvas, x from the left: the lamp stands just outside the top left corner
      vec2 p = vec2(v.x * u_res.x / u_res.y, v.y);
      vec2 d = p - vec2(-0.05, 1.08);
      float dist = length(d);
      // every point of the canvas lies below and right of the lamp: the angle never crosses its seam
      float ang = atan(d.y, d.x);
      float rays = smoothstep(0.36, 0.6, fbm2(vec2(ang * 12.0 + u_move.x, dist * 0.35)));
      rays *= 0.75 + 0.5 * n(vec2(ang * 46.0 - u_move.x * 2.3, dist * 2.0 - u_move.x * 3.0));
      float fog = fbm3(p * 2.4 + u_move.yz);
      float fall = exp2(-dist * 1.6 / 0.72);
      float lamp = exp2(-dist * 6.0) * 0.55;
      float light = (rays * mix(0.75, 1.25, fog) * fall * 1.15 + lamp) * u_move.w;
      // the page under the canvas is black: the light is gone before the canvas ends
      light *= smoothstep(0.0, 0.34, v.y);
      // each dot is lit or not by its place in an 8 by 8 pattern: where a third of the light is asked for, a third are
      float share = clamp(light, 0.0, 1.0) * 0.7;
      float th = texture2D(u_bayer, (cell + 0.5) * 0.125).r;
      float lit = step(th, share) * (0.2 + 0.28 * smoothstep(0.45, 0.9, share));
      gl_FragColor = vec4(lit * vec3(0.86, 0.88, 0.92), 1.0);
    }`;
  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  let gl = null;
  let uni = null;
  let w = 0;
  let h = 0;
  let cell = 1;
  let seen = true;
  let timer = 0;
  let raf = 0;
  let sizeTimer = 0;
  // the time of the light: it only goes on while the light moves, so it never jumps after a pause
  let elapsed = STILL_AT;
  let last = 0;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'a shader did not compile');
    return s;
  }
  function texture(unit, side, data, filter) {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, side, side, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  /** Everything the graphics chip holds, made again: at the start, and when the browser took it away and gave it back. */
  function build() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return false;
    try {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.bindAttribLocation(p, 0, 'a');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'the program did not link');
      gl.useProgram(p);
      uni = Object.fromEntries(['u_noise', 'u_bayer', 'u_res', 'u_cell', 'u_move'].map((name) => [name, gl.getUniformLocation(p, name)]));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      // the same grain at every visit: a fixed seed
      const noise = new Uint8Array(256 * 256);
      let seed = 0x9e3779b9;
      for (let i = 0; i < noise.length; i++) {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        noise[i] = ((t ^ (t >>> 14)) >>> 0) & 255;
      }
      texture(gl.TEXTURE0, 256, noise, gl.LINEAR);
      texture(gl.TEXTURE1, 8, new Uint8Array(BAYER.map((x) => Math.round(((x + 0.5) / 64) * 255))), gl.NEAREST);
      gl.uniform1i(uni.u_noise, 0);
      gl.uniform1i(uni.u_bayer, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      w = 0;
      return true;
    } catch {
      gl = null;
      return false;
    }
  }

  /** The canvas in the screen's own pixels, up to two a point: a dot is about one point wide on any screen. */
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.max(1, Math.round(host.clientWidth * dpr));
    const nh = Math.max(1, Math.round(host.clientHeight * dpr));
    cell = Math.max(1, Math.round(dpr));
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  /** One frame, at a time in seconds. */
  function draw(t) {
    if (!gl || gl.isContextLost()) return;
    // the size is checked every time: a resize may be heard of late
    size();
    const wrap = (x) => ((x % 256) + 256) % 256;
    gl.uniform2f(uni.u_res, w, h);
    gl.uniform1f(uni.u_cell, cell);
    gl.uniform4f(uni.u_move, wrap(t * 0.05), wrap(t * 0.02), wrap(t * 0.013), 0.85 + 0.15 * Math.sin(t * 0.4));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    host.classList.add('live');
  }

  const live = () => Boolean(gl) && seen && !document.hidden && !still.matches && !gl.isContextLost();

  function stop() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    timer = 0;
    raf = 0;
  }
  function tick() {
    timer = 0;
    if (!live()) return;
    raf = requestAnimationFrame((now) => {
      raf = 0;
      if (!live()) return;
      elapsed += last ? Math.min((now - last) / 1000, 0.25) : 0;
      last = now;
      draw(elapsed);
      timer = setTimeout(tick, 1000 / FPS);
    });
  }
  /** Runs while it should; otherwise draws once where it can be seen, so what stands is up to date. */
  function wake() {
    if (!gl) return;
    if (live()) {
      if (!timer && !raf) { last = 0; tick(); }
      return;
    }
    stop();
    if (seen && !document.hidden) draw(still.matches ? STILL_AT : elapsed);
  }

  if (!build()) {
    host.classList.add('flat');
    return;
  }
  host.append(canvas);
  // a canvas whose graphics context is gone is painted white by some browsers: it is off the page until it draws again
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    host.classList.remove('live');
    host.classList.add('lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!build()) { host.classList.add('flat'); return; }
    host.classList.remove('lost');
    wake();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      seen = entries[entries.length - 1].isIntersecting;
      wake();
    }).observe(host);
  }
  document.addEventListener('visibilitychange', wake);
  still.addEventListener('change', wake);
  // while it moves, the next frame takes the new size; standing still, it is drawn again once the resizing settles
  window.addEventListener('resize', () => {
    if (live()) return;
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(wake, 120);
  });
  wake();
})();
