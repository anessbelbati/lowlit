'use strict';
// The ground of the Noir look, a dithered light. Two passes: the scene
// (a lamp in the top left corner, its rays turning slowly through a drifting fog) drawn at a quarter of the width and
// height; then ordered dithering at the screen's own pixels, so the light reads as fine dots on black. Silver, never
// purple: colour is kept for what it means. The light turns gold while a chat waits for the person, and flares green
// for a moment when a chat finishes.
// What it costs: at most 24 frames a second, and none at all while the window is not in front, is hidden, the look is
// Grey, Settings stopped it, or the person asked for less motion (one still frame then).
// Chromium paints a canvas whose graphics context is gone white all over, and this one fills the window: the canvas is
// on the screen only from its first frame, and off it whenever its context goes (the graphics process ended, the
// driver restarted), so the ground stays black until the light is back.

const Noir = (() => {
  const FPS = 24;
  const SCALE = 4;
  const SILVER = [0.86, 0.88, 0.92];
  const AMBER = [1.0, 0.74, 0.3];
  const GREEN = [0.45, 1.0, 0.72];
  // a frame that stands still is always the same one: a moment when the beam is full
  const STILL_AT = 12;
  const VERT = 'attribute vec2 a; varying vec2 v; void main() { v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  // A lamp just outside the top left corner, behind the name of the app. Its rays fan out through a slow fog: down the
  // list of chats they fall nearly straight, along the title bar they run nearly flat, and they fade to black with
  // distance, so the lower list and the account stay dark. The panel in the middle hides the rest.
  const SCENE = `${HEAD}
    uniform sampler2D u_noise;
    uniform float u_aspect;
    uniform vec4 u_lamp;    // xy where the lamp is (in heights of the window, x from the left), z how far its light reaches, w lift
    uniform vec4 u_move;    // x the rays' slow turn, yz the fog's drift (wrapped every 256), w breath
    varying vec2 v;
    float n(vec2 p) { return texture2D(u_noise, p * 0.00390625).r; }
    float fbm2(vec2 p) { return 0.5 * n(p) + 0.25 * n(p * 2.0); }
    float fbm3(vec2 p) { return 0.5 * n(p) + 0.25 * n(p * 2.0) + 0.125 * n(p * 4.0); }
    void main() {
      vec2 p = vec2(v.x * u_aspect, v.y);
      vec2 d = p - u_lamp.xy;
      float dist = length(d);
      // every point of the window lies below and right of the lamp: the angle never crosses its seam
      float ang = atan(d.y, d.x);
      float rays = smoothstep(0.36, 0.6, fbm2(vec2(ang * 12.0 + u_move.x, dist * 0.35)));
      rays *= 0.75 + 0.5 * n(vec2(ang * 46.0 - u_move.x * 2.3, dist * 2.0 - u_move.x * 3.0));
      float fog = fbm3(p * 2.4 + u_move.yz);
      float fall = exp2(-dist * 1.6 / u_lamp.z);
      float lamp = exp2(-dist * 6.0) * 0.55;
      float light = (rays * mix(0.75, 1.25, fog) * fall * 1.15 + lamp) * u_move.w * (1.0 + u_lamp.w * 0.9);
      // what is handed on is the share of dots to light here
      gl_FragColor = vec4(clamp(light, 0.0, 1.0) * 0.7, 0.0, 0.0, 1.0);
    }`;
  // Each dot is lit or not, by its place in an 8 by 8 pattern: where the scene asks for a third of them, a third are
  // lit. Lit dots are dim silver, brighter where the light is thick.
  const DITHER = `${HEAD}
    uniform sampler2D u_scene;
    uniform sampler2D u_bayer;
    uniform vec3 u_tint;
    uniform float u_alpha;
    uniform float u_cell;
    varying vec2 v;
    void main() {
      float share = texture2D(u_scene, v).r;
      vec2 cell = floor(gl_FragCoord.xy / u_cell);
      float th = texture2D(u_bayer, (cell + 0.5) * 0.125).r;
      float d = step(th, share) * (0.2 + 0.28 * smoothstep(0.45, 0.9, share));
      gl_FragColor = vec4(d * u_tint, max(u_alpha, d));
    }`;
  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

  let host = null;
  let canvas = null;
  let gl = null;
  let scene = null;
  let dither = null;
  let fbo = null;
  let sceneTex = null;
  let noiseTex = null;
  let bayerTex = null;
  let w = 0;
  let h = 0;
  let sw = 0;
  let sh = 0;
  let on = false;
  let awake = document.hasFocus();
  let moving = true;
  let glass = false;
  let timer = 0;
  let raf = 0;
  let frames = 0;
  let failed = '';
  let warm = 0;
  let warmTo = 0;
  let lift = 0;
  // the time of the light: it only goes on while the light moves, so it never jumps after a pause
  let elapsed = STILL_AT;
  let last = 0;
  let sizeTimer = 0;
  let dprQuery = null;
  // the person is typing: the light holds where it is, and every frame drawn is one of the terminals'
  let typing = false;
  let typingTimer = 0;
  const TYPING_REST_MS = 1500;
  // A context Chromium has not given back by then is not waited for: the light starts again on a new canvas, and
  // again less and less often while the graphics chip cannot be had.
  const RENEW_MS = 5000;
  const RENEW_MAX_MS = 60000;
  let lostSince = 0;
  let renewTimer = 0;
  let renewTries = 0;
  let renewals = 0;

  const still = () => document.documentElement.classList.contains('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const live = () => on && awake && moving && !typing && !still() && !document.hidden && Boolean(gl) && !failed && !gl.isContextLost();
  const note = (text) => { if (typeof desk === 'object' && desk && typeof desk.slow === 'function') desk.slow(text); };

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'a shader did not compile');
    return s;
  }
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'a program did not link');
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  function texture(width, height, format, data, filter, wrap) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  /** Everything the GPU holds, made again: at the start, and when Windows took the GPU away and gave it back. */
  function build() {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) { failed = 'no WebGL'; return; }
    try {
      scene = program(SCENE);
      dither = program(DITHER);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      // the same grain at every start: a fixed seed
      const noise = new Uint8Array(256 * 256);
      let seed = 0x9e3779b9;
      for (let i = 0; i < noise.length; i++) {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        noise[i] = ((t ^ (t >>> 14)) >>> 0) & 255;
      }
      noiseTex = texture(256, 256, gl.LUMINANCE, noise, gl.LINEAR, gl.REPEAT);
      bayerTex = texture(8, 8, gl.LUMINANCE, new Uint8Array(BAYER.map((x) => Math.round(((x + 0.5) / 64) * 255))), gl.NEAREST, gl.REPEAT);
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      fbo = gl.createFramebuffer();
      sceneTex = null;
      w = 0;
      failed = '';
      size();
    } catch (err) {
      failed = err.message;
    }
  }

  /** The canvas in the screen's own pixels (a window at 125% has more of them than it says): each dot one pixel. */
  function size() {
    if (!gl || failed) return;
    const dpr = window.devicePixelRatio || 1;
    const nw = Math.max(1, Math.round(host.clientWidth * dpr));
    const nh = Math.max(1, Math.round(host.clientHeight * dpr));
    if (nw === w && nh === h && sceneTex) return;
    w = nw;
    h = nh;
    sw = Math.ceil(w / SCALE);
    sh = Math.ceil(h / SCALE);
    canvas.width = w;
    canvas.height = h;
    if (sceneTex) gl.deleteTexture(sceneTex);
    sceneTex = texture(sw, sh, gl.RGBA, null, gl.LINEAR, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Moved to a screen at another scaling: the window keeps its size in points, its pixels change. */
  function watchScale() {
    if (dprQuery) dprQuery.removeEventListener('change', rescale);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', rescale);
  }
  function rescale() {
    watchScale();
    size();
    if (!live()) wake();
  }

  /** One frame, at a time in seconds: the scene at a quarter size, then the dots at full size. */
  function draw(t) {
    if (!gl || failed || gl.isContextLost()) return;
    // the size is checked every time: a window that draws no frames of its own hears of a resize late, or not at all
    size();
    const wrap = (x) => ((x % 256) + 256) % 256;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, sw, sh);
    gl.useProgram(scene.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.uniform1i(scene.u.u_noise, 0);
    gl.uniform1f(scene.u.u_aspect, w / h);
    gl.uniform4f(scene.u.u_lamp, -0.05, 1.08, 1, lift);
    gl.uniform4f(scene.u.u_move, wrap(t * 0.05), wrap(t * 0.02), wrap(t * 0.013), 0.85 + 0.15 * Math.sin(t * 0.4));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(dither.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(dither.u.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bayerTex);
    gl.uniform1i(dither.u.u_bayer, 1);
    // a dim orange dot reads as brown: warm and green dots are lit brighter, so they read as light
    const tint = SILVER.map((x, i) => {
      const warmed = x + (AMBER[i] * 1.35 - x) * warm * 0.75;
      return warmed + (GREEN[i] * 1.3 - warmed) * lift * 0.7;
    });
    gl.uniform3f(dither.u.u_tint, tint[0], tint[1], tint[2]);
    // see-through: between the dots the blur Windows draws shows, darkened by the page's own ground
    gl.uniform1f(dither.u.u_alpha, glass ? 0 : 1);
    // a dot is about one point wide on any screen
    gl.uniform1f(dither.u.u_cell, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frames++;
    if (canvas.classList.contains('off')) canvas.classList.remove('off');
    if (lostSince) {
      note(`Noir's light is drawn again, ${Math.round((Date.now() - lostSince) / 1000)} s after its graphics context went${renewTries ? ` (a new canvas, after ${renewTries} ${renewTries === 1 ? 'try' : 'tries'})` : ''}`);
      lostSince = 0;
      renewTries = 0;
      clearTimeout(renewTimer);
      renewTimer = 0;
    }
  }

  function makeCanvas() {
    const c = document.createElement('canvas');
    c.className = 'noir off';
    c.setAttribute('aria-hidden', 'true');
    c.addEventListener('webglcontextlost', (e) => { if (c === canvas) { e.preventDefault(); lose(); } });
    c.addEventListener('webglcontextrestored', () => {
      if (c !== canvas) return;
      build();
      if (gl && !failed) { clearTimeout(renewTimer); renewTimer = 0; }
      wake();
    });
    return c;
  }
  function lose() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    timer = 0;
    raf = 0;
    canvas.classList.add('off');
    if (!lostSince) {
      lostSince = Date.now();
      note('Noir\'s light lost its graphics context: a black ground until it is back');
    }
    renewLater();
  }
  function renewLater() {
    clearTimeout(renewTimer);
    renewTimer = setTimeout(renew, Math.min(RENEW_MAX_MS, RENEW_MS * 2 ** Math.min(4, renewTries)));
  }
  /** A new canvas in place of the one whose context never came back, drawn as soon as it has one. */
  function renew() {
    renewTimer = 0;
    if (!lostSince) return;
    renewTries++;
    renewals++;
    const fresh = makeCanvas();
    canvas.replaceWith(fresh);
    canvas = fresh;
    gl = null;
    sceneTex = null;
    w = 0;
    h = 0;
    build();
    if (!gl || failed) { renewLater(); return; }
    wake();
  }

  function tick() {
    timer = 0;
    if (!live()) return;
    raf = requestAnimationFrame((now) => {
      raf = 0;
      if (!live()) return;
      elapsed += last ? Math.min((now - last) / 1000, 0.25) : 0;
      last = now;
      warm += (warmTo - warm) * 0.08;
      lift *= 0.93;
      if (lift < 0.01) lift = 0;
      draw(elapsed);
      timer = setTimeout(tick, 1000 / FPS);
    });
  }
  /** Runs while it should; otherwise draws once, so what stands is up to date. */
  function wake() {
    if (!on || !gl || failed) {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      timer = 0;
      raf = 0;
      return;
    }
    if (live()) {
      if (!timer && !raf) { last = 0; tick(); }
      return;
    }
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    timer = 0;
    raf = 0;
    warm = warmTo;
    lift = 0;
    draw(moving && !still() ? elapsed : STILL_AT);
  }

  function init(el, options = {}) {
    host = el;
    glass = Boolean(options.glass);
    canvas = makeCanvas();
    host.append(canvas);
    build();
    if (!gl || failed) {
      lostSince = Date.now();
      renewLater();
    }
    watchScale();
    // while it moves, the next frame takes the new size; standing still, it is drawn again once the resizing settles
    window.addEventListener('resize', () => {
      if (live()) return;
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(wake, 120);
    });
    document.addEventListener('visibilitychange', wake);
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', wake);
    window.addEventListener('keydown', () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { typing = false; wake(); }, TYPING_REST_MS);
      if (typing) return;
      typing = true;
      wake();
    }, true);
  }

  return {
    init,
    /** The look is Noir (true) or Grey. */
    setOn(value) { on = Boolean(value); wake(); },
    /** The window is in front. */
    setAwake(value) { awake = Boolean(value); wake(); },
    /** Settings: the light drifts (true) or stands still. */
    setMoving(value) { moving = value !== false; wake(); },
    /** Something waits for the person: the light warms. */
    setWarm(value) {
      const next = value ? 1 : 0;
      if (next === warmTo) return;
      warmTo = next;
      if (!live()) wake();
    },
    /** A chat finished: the light flares green for a moment (only seen while the window is in front). */
    pulse() { if (live()) lift = 1; },
    /** For the self-test: what it is doing, and one frame drawn at once with how long the GPU took for it, in ms. */
    state: () => ({ on, awake, moving, typing, still: still(), hidden: document.hidden, running: Boolean(timer || raf), frames, failed, size: [w, h], scene: [sw, sh], warm: warmTo, glass, lost: Boolean(lostSince), renewals }),
    drawNow(t = STILL_AT, look = {}) {
      if (!gl || failed) return -1;
      const kept = [warm, lift, glass];
      if ('warm' in look) warm = look.warm;
      if ('lift' in look) lift = look.lift;
      if ('glass' in look) glass = Boolean(look.glass);
      const at = performance.now();
      draw(t);
      // reading one pixel back waits until the GPU has drawn the whole picture (finish() alone does not, here)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      const ms = performance.now() - at;
      [warm, lift, glass] = kept;
      return ms;
    },
    /** For the self-test: the share of pixels lit, how bright they are on average (0 to 1), and how warm and how green the lit ones are. */
    sample() {
      if (!gl || failed) return null;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      let sum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] + px[i + 1] + px[i + 2];
        sum += v;
        if (v > 0) { lit++; red += px[i]; green += px[i + 1]; blue += px[i + 2]; }
      }
      const n = px.length / 4;
      return { lit: lit / n, mean: sum / n / 765, warmth: lit ? (red - blue) / lit / 255 : 0, greenness: lit ? (green - (red + blue) / 2) / lit / 255 : 0 };
    },
    renderer() {
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    },
  };
})();
