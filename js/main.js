// Point d'entrée : état, navigation, événements.

import { load, save, reset } from './store.js';
import { dayKey, buildStats, levelInfo, earnedBadgeIds, minutesOn, BADGES } from './stats.js';
import { getPreset, phaseAt } from './breath.js';
import { tipOfTheDay, finishMessage } from './content.js';
import { homeView, progressView, settingsView, sheetView, doneView, onboardingView } from './views.js';
import { Session } from './session.js';
import { pipSupported } from './pip.js';
import { Aura } from './aura.js';
import { Sound, scheduleDemo } from './audio.js';
import { syncNow, enableSync, joinWithCode, deleteRemote, normalizeCode, formatCode, SyncError, SYNC_MESSAGES } from './sync.js';

let state = load();
const ui = {
  tab: 'home',
  cal: 0,
  sync: { entering: false, revealed: false, busy: false, error: '', draft: '' },
  pipSupported: pipSupported(),
  linux: /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent),
  canInstall: false,
  iosHint: /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone,
  ob: { step: 0, name: '', goal: 5 },
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

const views = { home: homeView, progress: progressView, settings: settingsView };

function render({ animate = true, keepScroll = false } = {}) {
  const scroll = window.scrollY;
  unmountHero();
  applyMoment();
  view.classList.toggle('no-anim', !animate);
  view.innerHTML = views[ui.tab](context());
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === ui.tab;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-current', on ? 'page' : 'false');
  });
  window.scrollTo(0, keepScroll ? scroll : 0);
  if (ui.tab === 'home') mountHero();
}

// ---------- Aperçu du son ----------

let preview = null;

function stopPreview() {
  if (!preview) return;
  const { sound } = preview;
  preview = null;
  sound.ctx?.close().catch(() => {});
}

/** Joue environ une respiration complète avec l'ambiance choisie. À appeler depuis un clic. */
async function previewSound() {
  stopPreview();
  const sound = new Sound();
  sound.setMode(state.settings.soundMode);
  sound.setVolume(state.settings.soundVolume);
  preview = { sound };
  if (!(await sound.unlock())) {
    stopPreview();
    toast('Le son n’est pas disponible sur cet appareil.');
    return;
  }
  const seconds = 12;
  scheduleDemo(sound, getPreset(state.settings.presetId), seconds, sound.ctx.currentTime + 0.05);
  setTimeout(() => {
    if (preview && preview.sound === sound) stopPreview();
  }, (seconds + 3) * 1000);
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
    if (document.hidden || session) return; // pas de calcul inutile quand on ne la voit pas
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

function openSheet() {
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${sheetView(context())}</div>`;
  void sheetEl.offsetWidth;
  sheetEl.classList.add('open');
}

function refreshSheet() {
  const panel = sheetEl.querySelector('.sheet-panel');
  if (!panel) return;
  const top = panel.querySelector('.sheet-body')?.scrollTop || 0;
  panel.innerHTML = sheetView(context());
  panel.querySelector('.sheet-body').scrollTop = top;
}

function closeSheet({ instant = false } = {}) {
  sheetEl.classList.remove('open');
  const done = () => {
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
  };
  if (instant || reduceMotion) done();
  else setTimeout(done, 320);
  render({ animate: false, keepScroll: true });
}

// ---------- Session ----------

function startSession() {
  if (session) return;
  const preset = getPreset(state.settings.presetId);
  session = new Session(sessionEl, {
    preset,
    minutes: state.settings.minutes,
    sound: state.settings.sound,
    soundMode: state.settings.soundMode,
    soundVolume: state.settings.soundVolume,
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

  const data = {
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
    ui.tab = el.dataset.tab;
    render();
  },
  start: () => startSession(),
  'open-sheet': () => openSheet(),
  'close-sheet': () => closeSheet(),
  'start-from-sheet': () => {
    closeSheet({ instant: true });
    startSession();
  },
  'pick-preset'(el) {
    state.settings.presetId = el.dataset.id;
    touchPrefs();
    save(state);
    scheduleSync();
    refreshSheet();
  },
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
  'set-sound-mode'(el) {
    state.settings.soundMode = el.dataset.mode;
    save(state);
    render({ animate: false, keepScroll: true });
    previewSound();
  },
  'preview-sound': () => previewSound(),
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
      ui.sync.revealed = true; // on montre le code tout de suite, pour qu'il soit rangé
    } catch (e) {
      ui.sync.error = syncFailure(e);
    }
    ui.sync.busy = false;
    refreshSettings();
    // Le code vient d'être créé : on propose tout de suite de l'enregistrer dans le gestionnaire de mots de passe.
    if (state.sync) requestAnimationFrame(() => document.querySelector('form[data-form="sync-save"]')?.requestSubmit());
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
    const input = document.querySelector('[data-input="sync-code"]');
    if (!input) return;
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    el.textContent = hidden ? 'Masquer le code' : 'Afficher le code';
  },
  'sync-now': () => runSync({ manual: true }),
  'sync-reveal'() {
    ui.sync.revealed = !ui.sync.revealed;
    refreshSettings();
  },
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
    ui.sync.revealed = false;
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
      ui.sync.revealed = false;
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
    const { sync, ...exportable } = state; // le code de synchronisation n'est jamais exporté
    download('respire-donnees.json', 'application/json', JSON.stringify(exportable, null, 2));
    toast('Données exportées');
  },
  async reset() {
    const ok = await askConfirm({
      title: 'Tout effacer ?',
      text: state.sync
        ? 'Ton historique, ta série et tes trophées seront supprimés de cet appareil, et la synchronisation sera désactivée ici. Les données restent sur le serveur : tu pourras les retrouver avec ton code.'
        : 'Ton historique, ta série et tes trophées seront supprimés de cet appareil. Cette action est définitive.',
      ok: 'Effacer',
    });
    if (!ok) return;
    state = reset();
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
};

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
  if (form.dataset.form === 'sync-join') actions['sync-join']();
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
      await navigator.credentials.store(new PasswordCredential({ id: 'Respire', name: 'Respire', password: code }));
      toast('Demande envoyée : valide-la dans ton gestionnaire de mots de passe');
      return;
    }
  } catch {
    /* on retombe sur le message ci-dessous */
  }
  toast('Ton gestionnaire de mots de passe devrait te proposer d’enregistrer le code. Sinon, copie-le.');
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.pref) {
    state.settings[t.dataset.pref] = t.checked;
    save(state);
    if (t.dataset.pref === 'sound') {
      if (!t.checked) stopPreview();
      if (ui.tab === 'settings') render({ animate: false, keepScroll: true });
    }
  } else if (t.dataset.input === 'volume') {
    state.settings.soundVolume = Number(t.value);
    save(state);
    previewSound(); // on entend tout de suite le nouveau volume
  } else if (t.dataset.input === 'reminder') {
    state.settings.reminder = t.value || '08:00';
    save(state);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.input === 'volume') {
    const label = t.closest('.range-row')?.querySelector('.vol-val');
    if (label) label.textContent = `${t.value} %`;
  } else if (t.dataset.input === 'name') {
    state.name = t.value.trim();
    touchPrefs();
    save(state);
    scheduleSync();
  } else if (t.dataset.input === 'sync-code') {
    t.value = formatCode(t.value.replace(/\D/g, '').slice(0, 16));
    ui.sync.draft = t.value;
    // Code complet (saisi ou rempli par le gestionnaire de mots de passe) : on se connecte sans rien demander de plus.
    if (normalizeCode(t.value) && !ui.sync.busy) actions['sync-join']();
  } else if (t.dataset.input === 'ob-name') {
    ui.ob.name = t.value;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sheetEl.hidden && !session) closeSheet();
});

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
});

window.addEventListener('online', () => scheduleSync(500));

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- Démarrage ----------

applyTheme();
applyMoment();
render();
scheduleSync(600);
if (!state.onboarded) {
  ui.ob = { step: 0, name: state.name, goal: state.settings.goalMin };
  showOnboarding();
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
