// Aura : un champ de couleurs fluide (shader WebGL) et une bulle de savon irisée qui gonfle avec le souffle.
// Si WebGL n'est pas disponible, Aura.create() renvoie null et l'application garde l'orbe CSS.

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uBreath, uPulse, uPulseDir, uFull;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uC1, uC2, uC3, uC4, uC5, uTint;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}

// Champ de couleurs : plusieurs teintes qui se mélangent comme un liquide.
vec3 aura(vec2 p, float t) {
  vec2 q = vec2(fbm(p * 1.2 + vec2(0.0, t)), fbm(p * 1.2 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 1.5 + 2.0 * q + vec2(1.7, 9.2) + 0.5 * t), fbm(p * 1.5 + 2.0 * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p * 1.3 + 2.0 * r);
  vec3 col = mix(uC1, uC2, clamp(f * 1.7, 0.0, 1.0));
  col = mix(col, uC3, clamp(dot(q, q) * 1.6, 0.0, 1.0));
  col = mix(col, uC4, smoothstep(0.45, 0.95, r.x));
  col = mix(col, uC5, smoothstep(0.52, 0.92, r.y) * smoothstep(0.30, 0.75, f) * 0.85);
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float m = min(uRes.x, uRes.y);
  vec2 p = (frag - 0.5 * uRes) / m;
  vec2 c = (uCenter - 0.5 * uRes) / m;
  vec2 v0 = p - c;
  float t = uTime * 0.05;
  float breath = uBreath;

  // Bulle : contour légèrement ondulant, comme une membrane vivante.
  float ang = atan(v0.y, v0.x);
  float wob = (noise(vec2(cos(ang), sin(ang)) * 1.6 + uTime * 0.35) - 0.5) * 0.04 + sin(ang * 3.0 + uTime * 0.9) * 0.006;
  float R = (uRadius / m) * (1.0 + wob * (0.5 + 0.9 * breath));
  float dist = length(v0);
  float rad = dist / R;

  // La bulle déforme légèrement ce qu'on voit à travers, comme une lentille.
  vec3 nrm = vec3(v0 / R, 0.0);
  nrm.z = sqrt(max(0.0, 1.0 - dot(nrm.xy, nrm.xy)));
  float inside = 1.0 - smoothstep(0.88, 1.0, rad);
  vec3 bg = aura(p + nrm.xy * 0.035 * (1.0 - nrm.z) * inside, t);

  // Portée de la lumière : elle s'étend à l'inspiration et se retire à l'expiration.
  float reach = mix(0.30, 0.98, breath);
  float win = uFull > 0.5 ? 1.0 : 1.0 - smoothstep(0.26, 0.48, length(p));
  float glow = exp(-pow(dist / reach, 1.5) * 2.1) * win;
  vec3 lit = mix(bg, uTint, breath * 0.30);

  vec3 col;
  float alpha = 1.0;
  if (uFull > 0.5) {
    float vig = 1.0 - 0.55 * smoothstep(0.35, 1.05, length(p));
    col = vec3(0.020, 0.032, 0.075) + lit * (0.14 + 1.55 * glow * (0.45 + 0.55 * breath)) * vig;
    col += vec3(1.0) * pow(glow, 3.0) * 0.20 * breath;
  } else {
    col = lit * glow * 0.55 * (0.35 + 0.65 * breath);
    alpha = glow * 0.55 * (0.35 + 0.65 * breath);
  }

  // Bulle de savon : film irisé, reflets, voile lumineux.
  float aa = 1.5 / (R * m);
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, rad);
  float fres = pow(1.0 - nrm.z, 2.4);
  float th = fbm(nrm.xy * 1.25 + vec2(uTime * 0.06, -uTime * 0.045)) * 1.8 + (1.0 - nrm.z) * 1.0 + breath * 0.4;
  vec3 film = 0.5 + 0.5 * cos(6.28318 * (th + vec3(0.0, 0.33, 0.67)));
  vec3 iri = film * (fres * 1.15 + 0.05);
  vec2 h1 = nrm.xy - vec2(-0.36, 0.42);
  vec2 h2 = nrm.xy - vec2(0.46, -0.40);
  float spec = exp(-dot(h1, h1) * 30.0) * 0.85 + exp(-dot(h2, h2) * 85.0) * 0.35;
  float rim = smoothstep(0.80, 1.0, rad) * (1.0 - smoothstep(1.0, 1.03, rad));
  vec3 veil = mix(uTint, vec3(1.0), 0.35) * (0.04 + 0.08 * breath) * (1.0 - fres);
  vec3 bub = iri + vec3(spec) + veil + rim * 0.35 * mix(uTint, vec3(1.0), 0.5);

  if (uFull > 0.5) {
    col = col * (1.0 - (0.34 * (1.0 - fres) + 0.10) * mask) + bub * mask;
  } else {
    float ba = mask * clamp(0.10 + fres * 0.90 + spec, 0.0, 1.0);
    col = bub * ba + col * (1.0 - ba);
    alpha = ba + alpha * (1.0 - ba);
  }

  // Halo autour de la bulle.
  float outside = smoothstep(0.98, 1.0, rad);
  float halo = exp(-max(rad - 1.0, 0.0) * 3.2) * 0.32 * (0.4 + 0.6 * breath) * outside * win;
  vec3 haloCol = mix(uTint, uC2, 0.4) * halo;
  col += haloCol;
  alpha = clamp(alpha + halo * 0.8, 0.0, 1.0);

  // Onde qui part de la bulle à chaque changement de phase.
  if (uPulse >= 0.0) {
    float k = uPulse;
    float rho = uPulseDir > 0.0 ? 1.0 + k * 0.45 : 1.0 + (1.0 - smoothstep(0.0, 1.5, k)) * 0.85;
    float fade = uPulseDir > 0.0 ? exp(-k * 1.3) : smoothstep(1.7, 0.9, k) * smoothstep(0.0, 0.12, k);
    float ring = exp(-pow((rad - rho) / 0.035, 2.0)) * fade * 0.24 * win;
    col += ring * mix(uTint, vec3(1.0), 0.5);
    alpha = clamp(alpha + ring, 0.0, 1.0);
  }

  // Poussières de lumière.
  vec2 g = p * 7.0 + vec2(uTime * 0.02, -uTime * 0.045 * (0.4 + breath));
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float hh = hash(id);
  vec2 off = 0.3 * vec2(sin(uTime * 0.6 + hh * 40.0), cos(uTime * 0.5 + hh * 31.0));
  float mote = smoothstep(0.07, 0.0, length(f - off * 0.5)) * step(0.86, hh) * (0.5 + 0.5 * sin(uTime * 0.8 + hh * 60.0));
  float moteLight = mote * (0.25 + 0.5 * breath) * (0.3 + glow) * win;
  col += mix(uTint, vec3(1.0), 0.5) * moteLight;
  alpha = clamp(alpha + moteLight, 0.0, 1.0);

  // Épaule douce + grain de pellicule (évite aussi les bandes dans les dégradés sombres).
  col = 1.0 - exp(-col * 1.25);
  float grain = hash(frag + fract(uTime) * vec2(91.7, 113.3)) - 0.5;
  col += grain * 0.035 * (uFull > 0.5 ? 1.0 : alpha);

  if (uFull > 0.5) {
    gl_FragColor = vec4(col, 1.0);
  } else {
    // la couleur est déjà prémultipliée par l'opacité : on la borne pour qu'elle ne dépasse jamais l'opacité
    gl_FragColor = vec4(clamp(col, 0.0, alpha), alpha);
  }
}`;

const hexToRgb = (hex, fallback) => {
  const m = String(hex || '').trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};

/** Palette du moment de la journée (variables CSS de la page). */
export function readPalette(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const get = (name, fb) => hexToRgb(cs.getPropertyValue(name), fb);
  return {
    c1: get('--v1', [0.18, 0.48, 1.0]),
    c2: get('--v2', [0.48, 0.36, 1.0]),
    c3: get('--v3', [0.1, 0.76, 0.76]),
    c4: get('--v4', [0.29, 0.66, 1.0]),
    c5: get('--v5', [1.0, 0.62, 0.48]),
    tint: get('--core2', [0.38, 0.85, 1.0]),
  };
}

export class Aura {
  /** Renvoie null si WebGL (ou la précision des nombres) n'est pas disponible. */
  static create(canvas, opts) {
    try {
      return new Aura(canvas, opts);
    } catch {
      return null;
    }
  }

  constructor(canvas, { full = true, pixelRatio = 0.65 } = {}) {
    this.canvas = canvas;
    this.full = full;
    this.base = pixelRatio;
    this.scale = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.bubble = { cx: 0, cy: 0, r: 40 };
    this.pulseAt = -1;
    this.pulseDir = 0;
    this.lost = false;
    this.onLost = null;
    this.lastDraw = 0;
    this.avg = 16;
    this.slow = 0;
    this.clock = 0;
    // Sur écran tactile, ~30 images par seconde suffisent pour une aura douce et ménagent la batterie.
    this.minDt = matchMedia('(pointer: coarse)').matches ? 30 : 0;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.12 : 1;

    const gl = canvas.getContext('webgl', { alpha: !full, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl indisponible');
    const prec = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!prec || prec.precision < 16) throw new Error('précision insuffisante');
    this.gl = gl;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('liaison du programme');
    gl.useProgram(prog);
    this.prog = prog;

    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const n of ['uRes', 'uTime', 'uBreath', 'uPulse', 'uPulseDir', 'uFull', 'uCenter', 'uRadius', 'uC1', 'uC2', 'uC3', 'uC4', 'uC5', 'uTint']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    this.setPalette(readPalette());

    this.onContextLost = (e) => {
      e.preventDefault();
      this.lost = true;
      this.onLost?.();
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  setPalette(p) {
    const gl = this.gl;
    gl.uniform3fv(this.u.uC1, p.c1);
    gl.uniform3fv(this.u.uC2, p.c2);
    gl.uniform3fv(this.u.uC3, p.c3);
    gl.uniform3fv(this.u.uC4, p.c4);
    gl.uniform3fv(this.u.uC5, p.c5);
    gl.uniform3fv(this.u.uTint, p.tint);
  }

  /** Taille de la zone (en pixels CSS) et densité de pixels de l'écran. */
  resize(cssW, cssH, dpr = 1) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.applySize();
  }

  applySize() {
    const k = Math.min(this.dpr || 1, 2) * this.base * this.scale;
    const w = Math.max(2, Math.round(this.cssW * k));
    const h = Math.max(2, Math.round(this.cssH * k));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  /** Position et rayon de la bulle, en pixels CSS (origine en haut à gauche). */
  setBubble(cx, cy, r) {
    this.bubble.cx = cx;
    this.bubble.cy = cy;
    this.bubble.r = r;
  }

  /** Lance une onde : +1 vers l'extérieur (inspiration), -1 vers la bulle (expiration). */
  pulse(dir) {
    if (this.motion < 1) return; // pas d'onde si l'on a demandé moins d'animations
    this.pulseAt = this.clock;
    this.pulseDir = dir;
  }

  draw(breath) {
    if (this.lost) return;
    const gl = this.gl;
    const now = performance.now();
    if (this.minDt && now - this.lastDraw < this.minDt) return;
    const dtFrame = now - this.lastDraw;
    this.lastDraw = now;
    // Qualité adaptative : si l'appareil peine, on réduit la résolution (l'aura est douce, ça ne se voit presque pas).
    if (dtFrame < 200) this.avg = this.avg * 0.92 + dtFrame * 0.08;
    const slowLimit = this.minDt ? this.minDt * 1.6 : 27;
    if (this.avg > slowLimit && this.scale > 0.5 && ++this.slow > 40) {
      this.scale = Math.max(0.5, this.scale - 0.15);
      this.slow = 0;
      this.applySize();
    }

    if (dtFrame < 200) this.clock += (dtFrame / 1000) * this.motion;
    const t = this.clock;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const sx = w / this.cssW;
    const sy = h / this.cssH;
    gl.uniform2f(this.u.uRes, w, h);
    gl.uniform1f(this.u.uTime, t % 2000);
    gl.uniform1f(this.u.uBreath, breath);
    gl.uniform1f(this.u.uFull, this.full ? 1 : 0);
    gl.uniform2f(this.u.uCenter, this.bubble.cx * sx, (this.cssH - this.bubble.cy) * sy);
    gl.uniform1f(this.u.uRadius, this.bubble.r * sx);
    const since = this.pulseAt >= 0 ? t - this.pulseAt : -1;
    gl.uniform1f(this.u.uPulse, since >= 0 && since < 2 ? since : -1);
    gl.uniform1f(this.u.uPulseDir, this.pulseDir);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    try {
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* déjà libéré */
    }
    this.lost = true;
  }
}
