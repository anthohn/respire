// Point d'entrée : état, navigation, événements.

import { load, save, reset } from './store.js';
import { dayKey, buildStats, levelInfo, earnedBadgeIds, minutesOn, BADGES } from './stats.js';
import { PRESETS, getPreset, phaseAt } from './breath.js';
import { tipOfTheDay, finishMessage } from './content.js';
import { homeView, progressView, circleView, circleCardView, circlePreviewView, settingsView, sheetView, doneView, onboardingView } from './views.js';
import { Session } from './session.js';
import { renderTrack, wavBlob, TRACK_RATE } from './track.js';
import { icon } from './icons.js';
import { pipSupported } from './pip.js';
import { Aura, readPalette } from './aura.js';
import {
  createCircle, joinCircle, publish as publishCircle, fetchCircle, sendSign, ackEvents, leaveCircle, parseInvite, inviteLink,
  parseStatus, peekCircle, circleSeries, seriesLine, withMe, CircleError, CIRCLE_MESSAGES, formatCode as formatCircleCode, normalizeCode as normalizeCircleCode,
} from './circle.js';
import { syncNow, enableSync, joinWithCode, deleteRemote, normalizeCode, formatCode, SyncError, SYNC_MESSAGES } from './sync.js';

let state = load();
const ui = {
  tab: 'home',
  cal: 0,
  sync: { entering: false, busy: false, error: '', draft: '' },
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
  pipSupported: pipSupported(),
  linux: /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent),
  canInstall: false,
  iosHint: /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone,
  ob: { step: 0, name: '', goal: 5 },
  // Le cercle de proches : formulaire ouvert, dernier état connu du serveur.
  circle: { form: null, busy: false, loading: false, error: '', members: [], events: [], at: 0, name: '', cname: '', code: '', invited: false, showCode: false, copied: false, preview: null },
};
let session = null;
let installEvent = null;
let lastSessionId = null;

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const sheetEl = $('#sheet');
const sessionEl = $('#session');
const obEl = $('#onboarding');
const toastEl = $('#toast');
const tabbarEl = $('.tabbar');
const dialogEl = $('#dialog');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Rendu ----------

function context() {
  const now = new Date();
  const today = dayKey(now);
  const [y, m, d] = today.split('-').map(Number);
  return {
    state,
    stats: buildStats(state.sessions, today),
    today,
    now,
    ui,
    tip: tipOfTheDay(Math.floor(Date.UTC(y, m - 1, d) / 86400000)),
  };
}

const views = { home: homeView, progress: progressView, circle: circleView, settings: settingsView };

const TABS = ['home', 'progress', 'circle', 'settings'];
let tabTimer = 0;

/** Barre du bas : l'onglet actif change tout de suite, la pastille glisse. */
function syncTabBar() {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === ui.tab;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-current', on ? 'page' : 'false');
  });
  tabbarEl.style.setProperty('--i', Math.max(0, TABS.indexOf(ui.tab)));
}

/** Change d'onglet : l'ancien écran s'efface en glissant, puis le nouveau arrive du même côté. */
function goTab(next) {
  const prev = ui.tab;
  clearTimeout(tabTimer);
  ui.tab = next;
  syncTabBar();
  if (next === prev || reduceMotion || session) {
    render();
    return;
  }
  const dir = TABS.indexOf(next) > TABS.indexOf(prev) ? 1 : -1;
  view.style.setProperty('--out', `${-14 * dir}px`);
  view.classList.add('leaving');
  tabTimer = setTimeout(() => render({ dir }), 140);
}

function render({ animate = true, keepScroll = false, dir = 0 } = {}) {
  clearTimeout(tabTimer);
  view.classList.remove('leaving');
  const scroll = window.scrollY;
  unmountHero();
  applyMoment();
  view.classList.toggle('no-anim', !animate);
  if (dir) view.style.setProperty('--dx', `${16 * dir}px`);
  else view.style.removeProperty('--dx');
  view.innerHTML = views[ui.tab](context());
  syncTabBar();
  window.scrollTo(0, keepScroll ? scroll : 0);
  if (ui.tab === 'home') mountHero();
  countNumbers(view, animate);
}

// Les chiffres comptent jusqu'à leur valeur : la première fois, ou quand ils ont changé depuis la dernière fois qu'on les a vus.
const shownCounts = new Map();

function countNumbers(root, animate) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const key = el.dataset.countKey;
    const to = Number(el.dataset.count);
    const known = shownCounts.has(key);
    const from = known ? shownCounts.get(key) : 0;
    shownCounts.set(key, to);
    if (reduceMotion || from === to) return;
    if (!animate && !known) return; // rafraîchissement discret d'un chiffre qu'on n'a pas encore vu : on l'affiche tel quel
    el.textContent = from;
    const start = performance.now() + 250;
    const step = (now) => {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - start) / 800));
      el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Petite vibration (téléphones qui la permettent, et si les vibrations sont activées). */
function buzz(ms = 10) {
  if (!state.settings.haptics || !navigator.vibrate) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* tant pis */
  }
}

// ---------- Aperçu du guidage sonore ----------

let guidePreview = null;

function stopGuidePreview() {
  if (!guidePreview) return;
  const { audio, urls } = guidePreview;
  guidePreview = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  urls.forEach((u) => URL.revokeObjectURL(u));
}

/** Joue une respiration complète avec le guidage choisi. À appeler depuis un clic. */
async function previewGuide() {
  stopGuidePreview();
  const audio = new Audio();
  audio.setAttribute('playsinline', '');
  const silence = URL.createObjectURL(wavBlob(new Int16Array(TRACK_RATE / 10)));
  const me = (guidePreview = { audio, urls: [silence] });
  audio.src = silence;
  const fail = (e) => {
    if (guidePreview === me) stopGuidePreview();
    toast(`Le son n’a pas pu démarrer (${e?.name || 'lecture impossible'}).`);
  };
  try {
    await audio.play(); // pendant le clic : débloque la lecture sur iPhone
    audio.pause();
  } catch (e) {
    return fail(e);
  }
  const { pcm, rate } = await renderTrack({ preset: getPreset(state.settings.presetId), cycles: 1, lead: 1, tail: 2, style: state.settings.soundStyle });
  if (guidePreview !== me) return;
  const url = URL.createObjectURL(wavBlob(pcm, rate));
  me.urls.push(url);
  audio.src = url;
  audio.addEventListener('ended', () => guidePreview === me && stopGuidePreview());
  try {
    await audio.play();
  } catch (e) {
    fail(e);
  }
}

// ---------- Bulle de l'accueil ----------

let hero = null;

function unmountHero() {
  if (!hero) return;
  cancelAnimationFrame(hero.raf);
  hero.aura.destroy();
  hero = null;
}

function mountHero() {
  const host = view.querySelector('.hero-orb');
  if (!host) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-aura';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const aura = Aura.create(canvas, { full: false, pixelRatio: 1 });
  if (!aura) {
    canvas.remove();
    return;
  }
  host.classList.add('webgl');
  const preset = getPreset(state.settings.presetId);
  const t0 = performance.now();
  let size = '';
  let phase = '';
  const state_ = (hero = { aura, raf: 0 });
  const loop = () => {
    state_.raf = requestAnimationFrame(loop);
    if (document.hidden || session || sheetEl.classList.contains('open')) return; // pas de calcul inutile quand on ne la voit pas
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (`${w}x${h}` !== size) {
      size = `${w}x${h}`;
      aura.resize(w, h, window.devicePixelRatio || 1);
    }
    const p = phaseAt(preset, (performance.now() - t0) / 1000);
    if (p.phase !== phase) {
      phase = p.phase;
      if (phase === 'inhale') aura.pulse(1);
      else if (phase === 'exhale') aura.pulse(-1);
    }
    aura.setBubble(w / 2, h / 2, host.clientWidth * 0.5 * (0.52 + 0.4 * p.breath));
    aura.draw(p.breath);
  };
  loop();
}

function applyTheme() {
  const theme = state.settings.theme;
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#070b18' : '#fbf6f1');
}

/** La couleur de l'aura suit le moment de la journée. */
function applyMoment(date = new Date()) {
  const h = date.getHours();
  document.documentElement.dataset.tod = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'night';
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function askConfirm({ title, text, ok = 'Confirmer' }) {
  return new Promise((resolve) => {
    dialogEl.querySelector('h3').textContent = title;
    dialogEl.querySelector('p').textContent = text;
    dialogEl.querySelector('button[value="ok"]').textContent = ok;
    dialogEl.returnValue = '';
    dialogEl.addEventListener('close', () => resolve(dialogEl.returnValue === 'ok'), { once: true });
    if (dialogEl.showModal) dialogEl.showModal();
    else resolve(window.confirm(`${title}\n\n${text}`));
  });
}

// ---------- Feuille « Ta session » ----------

// Une bulle vivante respire au rythme choisi : on sent le rythme avant de le lancer.
let sheetLive = null; // { aura, canvas, raf, t0, preset, cur, from, to, mix, size, phase }

const mixPalette = (a, b, k) => Object.fromEntries(Object.keys(a).map((n) => [n, a[n].map((v, i) => v + (b[n][i] - v) * k)]));
const easeOutCubic = (x) => 1 - (1 - x) ** 3;

function openSheet() {
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${sheetView(context())}</div>`;
  void sheetEl.offsetWidth;
  sheetEl.classList.add('open');
  document.body.classList.add('sheet-open'); // la page derrière ne défile plus
  mountSheetOrb();
}

function mountSheetOrb() {
  const host = sheetEl.querySelector('.rhythm-orb');
  if (!host) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-aura';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const aura = Aura.create(canvas, { full: false, pixelRatio: 1 });
  if (aura) host.classList.add('webgl');
  else canvas.remove(); // sans WebGL, la bulle en CSS reste affichée
  const pal = readPalette(host);
  aura?.setPalette(pal);
  const live = (sheetLive = {
    aura,
    canvas: aura ? canvas : null,
    raf: 0,
    t0: performance.now(),
    preset: getPreset(state.settings.presetId),
    cur: pal,
    from: pal,
    to: pal,
    mix: 1,
    size: '',
    phase: '',
  });
  let last = performance.now();
  const loop = () => {
    live.raf = requestAnimationFrame(loop);
    if (document.hidden || session) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    const t = (now - live.t0) / 1000;
    const p = phaseAt(live.preset, t);
    if (live.aura && live.canvas) {
      const w = live.canvas.clientWidth;
      const h = live.canvas.clientHeight;
      if (w && h) {
        if (`${w}x${h}` !== live.size) {
          live.size = `${w}x${h}`;
          live.aura.resize(w, h, window.devicePixelRatio || 1);
        }
        if (p.phase !== live.phase) {
          live.phase = p.phase;
          if (p.phase === 'inhale') live.aura.pulse(1);
          else if (p.phase === 'exhale') live.aura.pulse(-1);
        }
        if (live.mix < 1) {
          live.mix = Math.min(1, live.mix + dt / 900);
          live.cur = mixPalette(live.from, live.to, easeOutCubic(live.mix));
          live.aura.setPalette(live.cur);
        }
        live.aura.setBubble(w / 2, h / 2, live.canvas.parentElement.clientWidth * 0.5 * (0.52 + 0.4 * p.breath));
        live.aura.draw(p.breath);
      }
    }
  };
  loop();
}

function unmountSheetOrb() {
  if (!sheetLive) return;
  cancelAnimationFrame(sheetLive.raf);
  sheetLive.aura?.destroy();
  sheetLive = null;
}

/** Redessine la feuille en gardant la même bulle (le canvas WebGL est simplement déplacé dans le nouveau décor). */
function refreshSheet({ dir = 0 } = {}) {
  const panel = sheetEl.querySelector('.sheet-panel');
  if (!panel) return;
  const top = panel.querySelector('.sheet-body')?.scrollTop || 0;
  const f = document.activeElement;
  const focus = f && panel.contains(f) && f.dataset?.action ? { ...f.dataset } : null;
  sheetLive?.canvas?.remove();
  panel.innerHTML = sheetView(context(), { dir });
  panel.querySelector('.sheet-body').scrollTop = top;

  const live = sheetLive;
  if (live) {
    const host = panel.querySelector('.rhythm-orb');
    if (live.canvas) {
      host.append(live.canvas);
      host.classList.add('webgl');
    }
    const preset = getPreset(state.settings.presetId);
    if (preset.id !== live.preset.id) {
      // Nouveau rythme : la bulle repart d'une inspiration, et ses couleurs glissent vers celles du rythme.
      live.preset = preset;
      live.t0 = performance.now();
      live.phase = '';
      live.from = live.cur;
      live.to = readPalette(host);
      live.mix = 0;
    }
  }
  if (focus) {
    const sel = Object.entries(focus).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('');
    panel.querySelector(sel)?.focus({ preventScroll: true });
  }
}

function setRhythm(id, dir) {
  if (id === state.settings.presetId) return;
  state.settings.presetId = id;
  touchPrefs();
  save(state);
  scheduleSync();
  refreshSheet({ dir });
}

/** +1 : rythme suivant, -1 : précédent (on boucle). */
function stepRhythm(dir) {
  const i = PRESETS.findIndex((p) => p.id === getPreset(state.settings.presetId).id);
  setRhythm(PRESETS[(i + dir + PRESETS.length) % PRESETS.length].id, dir);
}

function closeSheet({ instant = false } = {}) {
  sheetEl.classList.remove('open');
  document.body.classList.remove('sheet-open');
  const done = () => {
    unmountSheetOrb();
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
  };
  if (instant || reduceMotion) done();
  else setTimeout(done, 320);
  render({ animate: false, keepScroll: true });
}

// ---------- Cercle de proches ----------

let circleTimer = 0;

/** Le dernier état connu s'affiche tout de suite (même sans réseau) ; il est relu et nettoyé comme tout ce qui vient des autres. */
function restoreCircleCache() {
  const cache = state.circle?.cache;
  if (!cache || !Array.isArray(cache.members)) return;
  const members = cache.members
    .map((m) => ({ mid: m.mid, at: m.at, me: m.mid === state.circle.mid, status: parseStatus(m.status) }))
    .filter((m) => m.status && typeof m.mid === 'string');
  ui.circle.members = members;
  ui.circle.at = Number.isFinite(cache.at) ? cache.at : 0;
}

/** Affiche l'état du cercle sans tout redessiner : sur l'accueil, seule la carte change (la bulle ne doit pas être recréée). */
function rerenderCircle() {
  if (session || view.classList.contains('leaving')) return; // le changement d'onglet en cours affichera l'état à jour
  if (ui.tab === 'circle') {
    if (document.activeElement?.closest?.('.circle-form')) return; // on est en train de saisir : on ne touche à rien
    render({ animate: false, keepScroll: true });
  } else if (ui.tab === 'home') {
    const slot = view.querySelector('[data-slot="circle-card"]');
    if (slot) slot.innerHTML = circleCardView(context());
  }
}

const circleMessage = (e) => (e instanceof CircleError ? CIRCLE_MESSAGES[e.code] || CIRCLE_MESSAGES.server : CIRCLE_MESSAGES.server);

/** Publie mon statut, puis lit celui des autres. `silent` : sans effacer ce qui est affiché pendant le chargement. */
async function refreshCircle({ silent = false, force = false } = {}) {
  const cs = ui.circle;
  if (!state.circle || cs.loading) return;
  cs.loading = true;
  if (!silent) {
    cs.error = '';
    rerenderCircle();
  }
  try {
    await publishCircle(state, dayKey(), { force });
    let got = await fetchCircle(state);
    if (!got.members.some((m) => m.me)) {
      // Ma fiche a disparu (cercle resté inactif trop longtemps) : je me réinscris.
      await publishCircle(state, dayKey(), { force: true });
      got = await fetchCircle(state);
    }
    cs.members = got.members;
    cs.events = got.events;
    cs.at = Date.now();
    cs.error = '';
    state.circle.cache = { at: cs.at, members: got.members };
    save(state);
  } catch (e) {
    cs.error = circleMessage(e);
  } finally {
    cs.loading = false;
    rerenderCircle();
  }
}

/** Le cercle derrière un code : son nom et qui s'y trouve. Valide aussi le code dès qu'il est complet. */
let previewToken = 0;
async function loadPreview() {
  const cs = ui.circle;
  const token = ++previewToken;
  cs.preview = null;
  if (!normalizeCircleCode(cs.code)) {
    rerenderPreview();
    return;
  }
  cs.preview = { loading: true };
  rerenderPreview();
  try {
    const info = await peekCircle(cs.code);
    if (token === previewToken) cs.preview = info;
  } catch (e) {
    if (token === previewToken) cs.preview = { error: circleMessage(e) };
  }
  if (token === previewToken) rerenderPreview();
}

function rerenderPreview() {
  const slot = view.querySelector('[data-slot="circle-preview"]');
  if (slot) slot.innerHTML = circlePreviewView(ui.circle);
}

/** Un lien d'invitation (…#cercle=code) ouvre directement l'écran « rejoindre ». */
function checkInvite() {
  if (!/cercle=/i.test(location.hash)) return;
  const code = parseInvite(location.hash);
  history.replaceState(null, '', location.pathname + location.search); // le code ne reste pas dans la barre d'adresse
  if (!code) {
    toast('Ce lien d’invitation est incomplet.');
    return;
  }
  ui.tab = 'circle';
  if (state.circle?.code === code) return;
  if (state.circle) {
    toast('Tu es déjà dans un cercle. Quitte-le d’abord pour en rejoindre un autre.');
    return;
  }
  Object.assign(ui.circle, { form: 'join', code: formatCircleCode(code), invited: true, name: state.name, error: '', preview: null });
  loadPreview();
}

/** Une action du cercle qui change l'appartenance : on l'enregistre, et elle suit la synchronisation. */
function circleChanged() {
  touchPrefs();
  save(state);
  scheduleSync();
}

// ---------- Session ----------

/** Où est la bulle de l'accueil à l'écran : la bulle de la séance part de là et grandit vers sa place. */
function heroOrigin() {
  if (reduceMotion || ui.tab !== 'home' || state.settings.pipAuto) return null;
  const r = view.querySelector('.hero-orb')?.getBoundingClientRect();
  if (!r || !r.width || r.bottom < 0 || r.top > innerHeight) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}

function startSession() {
  if (session) return;
  const preset = getPreset(state.settings.presetId);
  stopGuidePreview();
  session = new Session(sessionEl, {
    from: heroOrigin(),
    preset,
    minutes: state.settings.minutes,
    sound: state.settings.sound,
    soundStyle: state.settings.soundStyle,
    haptics: state.settings.haptics,
    pipAuto: state.settings.pipAuto && ui.pipSupported,
    onNotice: toast,
    onFinish: handleFinish,
    onPrefs: ({ sound, haptics }) => {
      state.settings.sound = sound;
      state.settings.haptics = haptics;
      save(state);
    },
    onExit: () => {
      session = null;
      render({ animate: false, keepScroll: true });
    },
  });
  session.open();
}

function handleFinish({ seconds, cycles, completed }) {
  const today = dayKey();
  const preset = getPreset(state.settings.presetId);
  const before = buildStats(state.sessions, today);
  const levelBefore = levelInfo(before.totalMinutes);
  const badgesBefore = new Set(earnedBadgeIds(before));

  // Où en est la série du cercle, avant et après cette séance (avec ce que l'on sait des autres).
  const circleBefore = state.circle && ui.circle.members.length >= 2 ? circleSeries(withMe(state, ui.circle.members, today), today) : null;

  const record = {
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    date: today,
    seconds,
    cycles,
    preset: preset.id,
    completed,
  };
  state.sessions.push(record);
  lastSessionId = record.id;

  const after = buildStats(state.sessions, today);
  const levelAfter = levelInfo(after.totalMinutes);
  const earnedAfter = earnedBadgeIds(after);
  const goal = state.settings.goalMin;
  const minutesToday = minutesOn(state.sessions, today);
  const goalReached = minutesToday >= goal;
  const streakIncreased = after.current > before.current;
  state.seenBadges = [...new Set([...state.seenBadges, ...earnedAfter])];
  save(state);
  scheduleSync(1500);

  const circleAfter = circleBefore ? circleSeries(withMe(state, ui.circle.members, today), today) : null;
  const circleLine = circleAfter
    ? {
        valid: circleAfter.todayValid,
        text: !circleBefore.todayValid && circleAfter.todayValid
          ? `Jour du cercle validé ✨${circleAfter.days > 1 ? ` · série : ${circleAfter.days} jours` : ''}`
          : seriesLine(circleAfter),
      }
    : null;

  const data = {
    circleLine,
    seconds,
    cycles,
    completed,
    presetName: preset.name,
    streakBefore: before.current,
    streakAfter: after.current,
    streakIncreased,
    goal,
    minutesToday,
    newBadges: BADGES.filter((b) => earnedAfter.includes(b.id) && !badgesBefore.has(b.id)),
    levelUp: levelAfter.index > levelBefore.index ? levelAfter.level : null,
    message: finishMessage({ streak: after.current, streakIncreased, goalReached, firstEver: before.sessions === 0 }),
  };
  session.showDone(doneView(data), () => celebrate(data));
  if (state.circle) setTimeout(() => refreshCircle({ silent: true, force: true }), 1200); // tes proches voient ta série
}

function celebrate(d) {
  if (reduceMotion) return;
  const num = sessionEl.querySelector('.done-streak .num');
  if (d.streakIncreased && num) countUp(num, d.streakBefore, d.streakAfter);
  if (d.streakIncreased || d.newBadges.length || d.levelUp) petals(sessionEl.querySelector('.petals'));
}

function countUp(el, from, to) {
  el.textContent = from;
  const start = performance.now() + 700;
  const step = (now) => {
    const k = Math.min(1, Math.max(0, (now - start) / 900));
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function petals(host) {
  if (!host) return;
  const colors = ['#5eead4', '#8b9cff', '#ffb454', '#ff8fa3', '#c4b5fd'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    p.style.setProperty('--delay', `${Math.random() * 1.2}s`);
    p.style.setProperty('--dur', `${3.6 + Math.random() * 2.6}s`);
    p.style.setProperty('--size', `${5 + Math.random() * 9}px`);
    p.style.setProperty('--color', colors[i % colors.length]);
    host.appendChild(p);
  }
}

// ---------- Première ouverture ----------

function showOnboarding() {
  obEl.hidden = false;
  renderOnboarding();
  void obEl.offsetWidth;
  obEl.classList.add('open');
}

function renderOnboarding() {
  obEl.innerHTML = onboardingView(ui.ob);
}

function finishOnboarding() {
  state.onboarded = true;
  state.name = ui.ob.name.trim();
  state.settings.goalMin = ui.ob.goal;
  if (ui.circle.form === 'join' && !ui.circle.name) ui.circle.name = state.name; // arrivé par une invitation : le prénom est déjà là
  touchPrefs();
  save(state);
  scheduleSync();
  obEl.classList.remove('open');
  setTimeout(() => {
    obEl.hidden = true;
    obEl.innerHTML = '';
  }, reduceMotion ? 0 : 400);
  render();
}

// ---------- Export, rappel ----------

function download(filename, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildReminder(time) {
  const [h, m] = (time || '08:00').split(':');
  const start = `${dayKey().replace(/-/g, '')}T${h}${m}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const link = location.href.split('#')[0];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Respire//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:respire-rappel-${Date.now()}@respire`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:Respire - ta session du jour',
    `DESCRIPTION:Quelques minutes pour respirer calmement.\\n${link}`,
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Respire - ta session du jour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// ---------- Synchronisation ----------

let syncTimer = 0;

const refreshSettings = () => {
  if (ui.tab === 'settings') render({ animate: false, keepScroll: true });
};

/** Les préférences qui voyagent (prénom, objectif, rythme, durée) : la modification la plus récente gagne. */
function touchPrefs() {
  state.prefsAt = Date.now();
}

/** Synchronise bientôt (regroupe plusieurs changements rapprochés en une seule synchronisation). */
function scheduleSync(delay = 2500) {
  if (!state.sync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(), delay);
}

function syncFailure(e) {
  return e instanceof SyncError ? SYNC_MESSAGES[e.code] || SYNC_MESSAGES.server : SYNC_MESSAGES.server;
}

async function runSync({ manual = false } = {}) {
  if (!state.sync || ui.sync.busy) return;
  ui.sync.busy = true;
  ui.sync.error = '';
  refreshSettings();
  try {
    const { changed } = await syncNow(state);
    save(state);
    if (changed) render({ animate: false, keepScroll: true });
    if (manual) toast(changed ? 'Données mises à jour' : 'Tout est à jour');
  } catch (e) {
    // Hors connexion : on réessaiera tout seul, sans déranger.
    if (manual || !(e instanceof SyncError && e.code === 'offline')) ui.sync.error = syncFailure(e);
  }
  ui.sync.busy = false;
  refreshSettings();
}

// ---------- Actions (clics) ----------

const actions = {
  tab(el) {
    goTab(el.dataset.tab);
    if (ui.tab === 'circle' && state.circle && Date.now() - ui.circle.at > 30000) refreshCircle({ silent: ui.circle.members.length > 0 });
  },
  start: () => startSession(),
  'open-sheet': () => openSheet(),
  'close-sheet': () => closeSheet(),
  'start-from-sheet': () => {
    closeSheet({ instant: true });
    startSession();
  },
  'pick-preset'(el) {
    const index = (id) => PRESETS.findIndex((p) => p.id === getPreset(id).id);
    setRhythm(el.dataset.id, Math.sign(index(el.dataset.id) - index(state.settings.presetId)));
  },
  'rhythm-prev': () => stepRhythm(-1),
  'rhythm-next': () => stepRhythm(1),
  'pick-minutes'(el) {
    state.settings.minutes = Number(el.dataset.min);
    touchPrefs();
    save(state);
    scheduleSync();
    refreshSheet();
  },
  'set-goal'(el) {
    state.settings.goalMin = Number(el.dataset.min);
    touchPrefs();
    save(state);
    scheduleSync();
    render({ animate: false, keepScroll: true });
  },
  'set-sound-style'(el) {
    state.settings.soundStyle = el.dataset.style;
    save(state);
    render({ animate: false, keepScroll: true });
    previewGuide();
  },
  'preview-sound': () => previewGuide(),
  'set-theme'(el) {
    state.settings.theme = el.dataset.theme;
    save(state);
    applyTheme();
    render({ animate: false, keepScroll: true });
  },
  async 'sync-enable'() {
    ui.sync.busy = true;
    ui.sync.error = '';
    refreshSettings();
    try {
      await enableSync(state);
      save(state);
    } catch (e) {
      ui.sync.error = syncFailure(e);
    }
    ui.sync.busy = false;
    refreshSettings();
    // Le code vient d'être créé : on propose tout de suite de l'enregistrer dans le gestionnaire de mots de passe.
    if (state.sync && !ui.ios) requestAnimationFrame(() => document.querySelector('form[data-form="sync-save"]')?.requestSubmit());
  },
  'sync-enter'() {
    ui.sync.entering = true;
    ui.sync.error = '';
    refreshSettings();
    // Champ actif tout de suite : le gestionnaire de mots de passe propose le code enregistré.
    requestAnimationFrame(() => document.querySelector('[data-input="sync-code"]')?.focus());
    useStoredCredential();
  },
  'sync-cancel'() {
    ui.sync.entering = false;
    ui.sync.error = '';
    refreshSettings();
  },
  async 'sync-join'() {
    const input = document.querySelector('[data-input="sync-code"]');
    ui.sync.draft = input?.value || ui.sync.draft;
    if (!normalizeCode(ui.sync.draft)) {
      ui.sync.error = SYNC_MESSAGES.invalid;
      refreshSettings();
      return;
    }
    ui.sync.busy = true;
    ui.sync.error = '';
    refreshSettings();
    try {
      await joinWithCode(state, ui.sync.draft);
      save(state);
      ui.sync.entering = false;
      ui.sync.draft = '';
      toast('Synchronisation activée');
      render({ animate: false, keepScroll: true });
    } catch (e) {
      ui.sync.error = syncFailure(e);
    }
    ui.sync.busy = false;
    refreshSettings();
  },
  'sync-peek'(el) {
    const input = el.closest('.code-wrap')?.querySelector('input');
    if (!input) return;
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    el.innerHTML = hidden ? icon.eyeOff(20) : icon.eye(20);
  },
  'sync-now': () => runSync({ manual: true }),
  async 'sync-copy'() {
    try {
      await navigator.clipboard.writeText(state.sync.code);
      toast('Code copié');
    } catch {
      toast('Copie impossible : sélectionne le code à la main');
    }
  },
  async 'sync-disable'() {
    const ok = await askConfirm({
      title: 'Désactiver la synchronisation ?',
      text: 'Tes données restent sur cet appareil et sur le serveur. Tu pourras réactiver la synchronisation avec ton code.',
      ok: 'Désactiver',
    });
    if (!ok) return;
    state.sync = null;
    save(state);
    refreshSettings();
  },
  async 'sync-delete'() {
    const ok = await askConfirm({
      title: 'Supprimer du serveur ?',
      text: 'Tes données du serveur seront effacées pour de bon. Elles restent sur cet appareil, mais ne seront plus synchronisées avec les autres.',
      ok: 'Supprimer',
    });
    if (!ok) return;
    try {
      await deleteRemote(state);
      state.sync = null;
      save(state);
      toast('Données supprimées du serveur');
    } catch (e) {
      ui.sync.error = syncFailure(e);
    }
    refreshSettings();
  },
  'cal-prev'() {
    ui.cal -= 1;
    render({ animate: false, keepScroll: true });
  },
  'cal-next'() {
    if (ui.cal < 0) ui.cal += 1;
    render({ animate: false, keepScroll: true });
  },
  'add-reminder'() {
    download('respire-rappel.ics', 'text/calendar;charset=utf-8', buildReminder(state.settings.reminder));
    toast('Rappel prêt : ouvre le fichier pour l’ajouter à ton calendrier');
  },
  export() {
    const { sync, circle, ...exportable } = state; // ni le code de synchronisation ni les clés du cercle ne sont exportés
    download('respire-donnees.json', 'application/json', JSON.stringify(exportable, null, 2));
    toast('Données exportées');
  },
  async reset() {
    const ok = await askConfirm({
      title: 'Tout effacer ?',
      text: (state.sync
        ? 'Ton historique, ta série et tes trophées seront supprimés de cet appareil, et la synchronisation sera désactivée ici. Les données restent sur le serveur : tu pourras les retrouver avec ton code.'
        : 'Ton historique, ta série et tes trophées seront supprimés de cet appareil. Cette action est définitive.') +
        (state.circle && !state.sync ? ' Tu quitteras aussi ton cercle.' : ''),
      ok: 'Effacer',
    });
    if (!ok) return;
    // Sans synchronisation, ma fiche disparaît du cercle (au mieux). Avec elle, mes autres appareils restent dans le cercle.
    if (state.circle && !state.sync) await leaveCircle(state, { force: true }).catch(() => {});
    state = reset();
    Object.assign(ui.circle, { form: null, members: [], events: [], at: 0, error: '', showCode: false, invited: false, name: '', cname: '', code: '' });
    applyTheme();
    ui.tab = 'home';
    ui.ob = { step: 0, name: '', goal: 5 };
    render();
    showOnboarding();
  },
  async install() {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    ui.canInstall = false;
    render({ animate: false, keepScroll: true });
  },
  'replay-intro'() {
    ui.ob = { step: 0, name: state.name, goal: state.settings.goalMin };
    showOnboarding();
  },
  'ob-next'() {
    ui.ob.step = Math.min(2, ui.ob.step + 1);
    renderOnboarding();
  },
  'ob-goal'(el) {
    ui.ob.goal = Number(el.dataset.min);
    renderOnboarding();
  },
  'ob-finish': () => finishOnboarding(),
  feeling(el) {
    const rec = state.sessions.find((s) => s.id === lastSessionId);
    if (!rec) return;
    rec.feeling = el.dataset.id;
    save(state);
    scheduleSync();
    sessionEl.querySelectorAll('.feel').forEach((b) => {
      const on = b === el;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  },
  'done-close'() {
    session?.destroy();
  },

  // ----- Cercle de proches -----
  'circle-form'(el) {
    Object.assign(ui.circle, { form: el.dataset.form, error: '', name: ui.circle.name || state.name, invited: false });
    if (el.dataset.form === 'join') Object.assign(ui.circle, { code: '', preview: null });
    render({ animate: false, keepScroll: true });
  },
  'circle-cancel'() {
    Object.assign(ui.circle, { form: null, error: '', invited: false });
    render({ animate: false, keepScroll: true });
  },
  async 'circle-create'() {
    const cs = ui.circle;
    if (cs.busy) return;
    cs.busy = true;
    cs.error = '';
    render({ animate: false, keepScroll: true });
    try {
      await createCircle(state, { name: cs.name, circleName: cs.cname }, dayKey());
      Object.assign(cs, { form: null, members: [], events: [], at: 0, showCode: false });
      circleChanged();
      cs.busy = false;
      await refreshCircle({ force: true });
    } catch (e) {
      cs.error = circleMessage(e);
    } finally {
      cs.busy = false;
      render({ animate: false, keepScroll: true });
    }
  },
  async 'circle-join'() {
    const cs = ui.circle;
    if (cs.busy) return;
    cs.busy = true;
    cs.error = '';
    render({ animate: false, keepScroll: true });
    try {
      await joinCircle(state, cs.code, { name: cs.name }, dayKey());
      Object.assign(cs, { form: null, members: [], events: [], at: 0, invited: false, showCode: false });
      circleChanged();
      cs.busy = false;
      await refreshCircle({ force: true });
    } catch (e) {
      cs.error = circleMessage(e);
    } finally {
      cs.busy = false;
      render({ animate: false, keepScroll: true });
    }
  },
  'circle-refresh': () => refreshCircle({ force: true }),
  'circle-hint'() {
    state.circleHint = true;
    save(state);
    rerenderCircle();
  },
  async 'circle-share'() {
    if (!state.circle) return;
    const url = inviteLink(state.circle.code);
    const name = state.name || 'Un proche';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Respire', text: `${name} t’invite à respirer ensemble sur Respire. Voyez qui a respiré aujourd’hui !`, url });
        return;
      }
      throw new Error('partage indisponible');
    } catch (e) {
      if (e?.name === 'AbortError') return; // fenêtre de partage fermée : rien à faire
      actions['circle-copy']();
    }
  },
  async 'circle-copy'() {
    if (!state.circle) return;
    try {
      await navigator.clipboard.writeText(inviteLink(state.circle.code));
      ui.circle.copied = true;
    } catch {
      ui.circle.showCode = true; // la copie est refusée : on montre le code, à recopier à la main
    }
    render({ animate: false, keepScroll: true });
    setTimeout(() => {
      ui.circle.copied = false;
      if (ui.tab === 'circle') render({ animate: false, keepScroll: true });
    }, 2500);
  },
  'circle-show-code'() {
    ui.circle.showCode = !ui.circle.showCode;
    render({ animate: false, keepScroll: true });
  },
  async 'circle-sign'(el) {
    if (!state.circle) return;
    const { mid, kind } = el.dataset;
    try {
      await sendSign(state, mid, kind, dayKey());
      save(state);
    } catch (e) {
      if (e instanceof CircleError && e.code === 'too_soon') {
        // Un signe est déjà parti récemment : on le marque comme envoyé pour aujourd'hui.
        state.circle.sent = { ...(state.circle.sent || {}), [`${mid}:${kind}`]: dayKey() };
        save(state);
      } else {
        ui.circle.error = circleMessage(e);
      }
    }
    buzz(12);
    rerenderCircle();
    view
      .querySelector(`[data-action="circle-sign"][data-mid="${mid}"][data-kind="${kind}"]`)
      ?.classList.add('just-sent');
  },
  async 'circle-dismiss'() {
    const upTo = Math.max(0, ...ui.circle.events.map((e) => e.at));
    ui.circle.events = [];
    rerenderCircle();
    try {
      await ackEvents(state, upTo);
    } catch {
      /* ils réapparaîtront au prochain passage : pas grave */
    }
  },
  async 'circle-leave'() {
    if (!state.circle) return;
    const ok = await askConfirm({
      title: 'Quitter le cercle ?',
      text: 'Ta fiche disparaît du cercle : tes proches ne voient plus ta série. Tu pourras le rejoindre de nouveau avec le code.',
      ok: 'Quitter',
    });
    if (!ok) return;
    try {
      await leaveCircle(state);
    } catch (e) {
      const force = await askConfirm({
        title: 'Pas de connexion',
        text: 'Impossible de prévenir le cercle. Tu peux quitter quand même : ta fiche restera visible de tes proches pendant quelques semaines.',
        ok: 'Quitter quand même',
      });
      if (!force) return;
      await leaveCircle(state, { force: true });
    }
    Object.assign(ui.circle, { members: [], events: [], at: 0, form: null, showCode: false, error: '' });
    circleChanged();
    render({ animate: false, keepScroll: true });
  },
};

// Le contour de focus n'est utile qu'au clavier : un toucher ou un clic ne doit pas en laisser un (voir le CSS).
document.addEventListener('pointerdown', () => { document.documentElement.dataset.input = 'pointer'; }, true);
document.addEventListener('keydown', () => { document.documentElement.dataset.input = 'key'; }, true);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  actions[el.dataset.action]?.(el, e);
});

// Les formulaires sont de vrais formulaires (identifiant + code) : les gestionnaires de mots de passe
// savent proposer d'enregistrer le code, puis le remplir sur l'autre appareil.
document.addEventListener('submit', async (e) => {
  const form = e.target.closest?.('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'circle-create') actions['circle-create']();
  else if (form.dataset.form === 'circle-join') actions['circle-join']();
  else if (form.dataset.form === 'sync-join') actions['sync-join']();
  else if (form.dataset.form === 'sync-save') await saveToPasswordManager();
});

/** Chrome, Brave, Edge : le sélecteur de mots de passe du navigateur propose le code enregistré, puis on se connecte. */
async function useStoredCredential() {
  if (!window.PasswordCredential || !navigator.credentials?.get) return;
  try {
    const cred = await navigator.credentials.get({ password: true, mediation: 'optional' });
    const code = normalizeCode(cred?.password);
    if (!code || !ui.sync.entering) return;
    ui.sync.draft = formatCode(code);
    const input = document.querySelector('[data-input="sync-code"]');
    if (input) input.value = ui.sync.draft;
    await actions['sync-join']();
  } catch {
    /* pas de mot de passe enregistré, ou refus : saisie ou remplissage du gestionnaire */
  }
}

async function saveToPasswordManager() {
  const code = state.sync?.code;
  if (!code) return;
  try {
    // Navigateurs basés sur Chromium (Chrome, Brave, Edge) : demande d'enregistrement directe.
    if (window.PasswordCredential && navigator.credentials?.store) {
      await navigator.credentials.store(new PasswordCredential({ id: 'Respire', name: 'Respire', password: formatCode(code) }));
      toast('Demande envoyée : valide-la dans ton gestionnaire de mots de passe');
      return;
    }
  } catch {
    /* on retombe sur le message ci-dessous */
  }
  toast(ui.ios ? 'Copie le code, puis ajoute-le dans l’app Mots de passe.' : 'Ton gestionnaire de mots de passe devrait te proposer d’enregistrer le code. Sinon, copie-le.');
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.pref) {
    state.settings[t.dataset.pref] = t.checked;
    save(state);
    if (t.dataset.pref === 'sound') {
      if (!t.checked) stopGuidePreview();
      if (ui.tab === 'settings') render({ animate: false, keepScroll: true });
    }
  } else if (t.dataset.input === 'reminder') {
    state.settings.reminder = t.value || '08:00';
    save(state);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.input === 'name') {
    state.name = t.value.trim();
    touchPrefs();
    save(state);
    scheduleSync();
    if (state.circle) {
      clearTimeout(circleTimer);
      circleTimer = setTimeout(() => refreshCircle({ silent: true, force: true }), 1500);
    }
  } else if (t.dataset.input === 'sync-code') {
    t.value = formatCode(t.value.replace(/\D/g, '').slice(0, 16));
    ui.sync.draft = t.value;
    // Code complet (saisi ou rempli par le gestionnaire de mots de passe) : on se connecte sans rien demander de plus.
    if (normalizeCode(t.value) && !ui.sync.busy) actions['sync-join']();
  } else if (t.dataset.input === 'circle-name') {
    ui.circle.name = t.value;
  } else if (t.dataset.input === 'circle-cname') {
    ui.circle.cname = t.value;
  } else if (t.dataset.input === 'circle-code') {
    t.value = formatCircleCode(t.value.replace(/\D/g, '').slice(0, 16));
    ui.circle.code = t.value;
    ui.circle.error = '';
    loadPreview();
  } else if (t.dataset.input === 'ob-name') {
    ui.ob.name = t.value;
  }
});

document.addEventListener('keydown', (e) => {
  if (sheetEl.hidden || session) return;
  if (e.key === 'Escape') closeSheet();
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('input, textarea, select')) {
    e.preventDefault();
    stepRhythm(e.key === 'ArrowRight' ? 1 : -1);
  }
});

// Balayage sur la bulle : rythme précédent ou suivant (la bulle suit le doigt, puis revient).
let swipe = null;
document.addEventListener('pointerdown', (e) => {
  const rhythm = e.target.closest?.('.rhythm');
  if (!rhythm || e.target.closest('.rz-arrow, .rdot')) return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, rhythm };
});
document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  swipe.dx = e.clientX - swipe.x;
  if (Math.abs(swipe.dx) < 8) return;
  swipe.rhythm.classList.add('dragging');
  swipe.rhythm.style.setProperty('--drag', `${Math.max(-70, Math.min(70, swipe.dx * 0.45))}px`);
});
const endSwipe = (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const { dx, rhythm } = swipe;
  swipe = null;
  rhythm.classList.remove('dragging');
  rhythm.style.removeProperty('--drag');
  if (e.type === 'pointerup' && Math.abs(dx) > 44) stepRhythm(dx < 0 ? 1 : -1);
};
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  ui.canInstall = true;
  if (ui.tab === 'settings') render({ animate: false, keepScroll: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!session) render({ animate: false, keepScroll: true });
  if (state.sync && Date.now() - state.sync.lastSync > 60000) scheduleSync(300);
  if (state.circle && Date.now() - ui.circle.at > 60000) refreshCircle({ silent: true });
});

window.addEventListener('online', () => scheduleSync(500));

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- Démarrage ----------

applyTheme();
applyMoment();
restoreCircleCache();
checkInvite();
render();
scheduleSync(600);
if (state.circle) setTimeout(() => refreshCircle({ silent: true }), 900);
window.addEventListener('hashchange', () => {
  checkInvite();
  render();
});
if (!state.onboarded) {
  ui.ob = { step: 0, name: state.name, goal: state.settings.goalMin };
  showOnboarding();
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
