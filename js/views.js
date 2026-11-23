// Vues : chaque fonction renvoie du HTML à partir de l'état. Aucune logique d'événement ici.

import { icon } from './icons.js';
import { PRESETS, DURATIONS, UNLIMITED, durationLabel, getPreset, patternLabel, sessionPlan } from './breath.js';
import {
  BADGES, LEVELS, levelInfo, weekKeys, minutesOn, formatDuration, parseKey, dayKey, earnedBadgeIds,
} from './stats.js';
import { DAY_LETTERS, MONTHS, FEELINGS, greeting, moment } from './content.js';
import { journeyLayout, STEPS } from './journey.js';
import { GUIDE_STYLES } from './track.js';
import { formatCode } from './sync.js';
import { qrSvg } from './qr.js';
import { memberView, sortMembers, canSend, SIGNS, MAX_MEMBERS, circleSeries, weekOverview, missingText, todayLine, withMe, inviteLink } from './circle.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const count = (n, one, many = `${one}s`) => `${n} ${n >= 2 ? many : one}`;
const MILESTONES = [3, 7, 14, 30, 60, 100];
const GOALS = [3, 5, 10, 15];

// ---------- Briques ----------

export const orb = (cls = '') => `
  <div class="orb-stage ${cls}" aria-hidden="true">
    <div class="orb-halo"></div>
    <i class="orb-ripple r1"></i><i class="orb-ripple r2"></i><i class="orb-ripple r3"></i>
    <div class="orb"><span class="orb-cool"></span><span class="orb-warm"></span><span class="orb-gloss"></span></div>
  </div>`;

export function ring({ value, size = 92, stroke = 9, id = 'ring', inner = '' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value));
  const half = size / 2;
  return `
  <div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/>
      </linearGradient></defs>
      <circle class="ring-track" cx="${half}" cy="${half}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring-bar" cx="${half}" cy="${half}" r="${r}" stroke-width="${stroke}" stroke="url(#${id})"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}" style="--c:${c.toFixed(2)}" transform="rotate(-90 ${half} ${half})"/>
    </svg>
    <div class="ring-inner">${inner}</div>
  </div>`;
}

const toggle = (pref, checked, label, hint = '') => `
  <label class="row toggle-row">
    <span class="row-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>
    <input class="switch" type="checkbox" data-pref="${pref}" ${checked ? 'checked' : ''} role="switch" />
  </label>`;

// ---------- Accueil ----------

const ordinal = (n) => (n === 1 ? '1er' : `${n}e`);

function lede({ stats, hour }) {
  const st = stats.streak;
  if (st.todayDone) return st.current >= 2 ? `${ordinal(st.current)} jour de suite. Bravo.` : 'Premier jour validé. Bravo.';
  if (st.atRisk) return `Ton ${ordinal(st.current + 1)} jour t’attend.`;
  return moment(hour);
}

function nudge({ stats, hour, minToday, goal }) {
  const st = stats.streak;
  if (stats.sessions === 0) {
    return { tone: 'calm', ico: icon.leaf(22), text: '<b>Ta première session dure une minute.</b> C’est tout ce qu’il faut pour commencer.' };
  }
  if (st.todayDone) {
    if (minToday >= goal) return { tone: 'good', ico: icon.check(22), text: '<b>Objectif du jour atteint.</b> Reviens demain pour prolonger ta série.' };
    return { tone: 'good', ico: icon.check(22), text: `<b>Série validée pour aujourd’hui.</b> Encore ${Math.ceil(goal - minToday)} min pour atteindre ton objectif.` };
  }
  if (st.atRisk) {
    if (st.yesterdayRest) {
      return { tone: 'warn', ico: icon.moon(22), text: `<b>Dernier jour de grâce.</b> Hier était ton jour de repos : une minute aujourd’hui sauve ta série de ${count(st.current, 'jour')}.` };
    }
    if (hour >= 18) return { tone: 'warn', ico: icon.flame(22), text: `<b>Ta série de ${count(st.current, 'jour')} t’attend.</b> Une minute suffit, il te reste la soirée.` };
    return { tone: 'calm', ico: icon.flame(22), text: `<b>Série de ${count(st.current, 'jour')} en cours.</b> Fais ta session du jour quand tu veux.` };
  }
  return { tone: 'calm', ico: icon.leaf(22), text: '<b>On repart doucement.</b> Une minute aujourd’hui suffit pour relancer ta série.' };
}

function weekStrip({ today, state, st }) {
  const keys = weekKeys(today);
  return keys.map((key, i) => {
    let status = 'missed';
    if (key > today) status = 'future';
    else if (st.active.has(key)) status = key === today ? 'done today' : 'done';
    else if (key === today) status = 'today';
    else if (st.rest.has(key)) status = 'rest';
    const mark = status.startsWith('done') ? icon.check(16) : status === 'rest' ? icon.moon(15) : '';
    const label = status.startsWith('done') ? 'fait' : status === 'rest' ? 'jour de repos' : status === 'today' ? 'aujourd’hui' : '';
    return `<li class="day ${status}" ${label ? `aria-label="${label}"` : ''}><span class="day-dot">${mark}</span><span class="day-letter">${DAY_LETTERS[i]}</span></li>`;
  }).join('');
}

export function homeView(c) {
  const { state, stats, today, now, tip } = c;
  const st = stats.streak;
  const preset = getPreset(state.settings.presetId);
  const minutes = state.settings.minutes;
  const goal = state.settings.goalMin;
  const minToday = minutesOn(state.sessions, today);
  const next = MILESTONES.find((m) => m > st.current) || null;
  const prev = [...MILESTONES].reverse().find((m) => m <= st.current) || 0;
  const milestonePct = next ? (st.current - prev) / (next - prev) : 1;
  const nd = nudge({ stats, hour: now.getHours(), minToday, goal });
  const showNudge = nd.tone === 'warn' || stats.sessions === 0;
  const doneDays = weekKeys(today).filter((k) => st.active.has(k)).length;

  return `
  <header class="home-head rise">
    <div class="brand"><span class="brand-orb"></span>Respire</div>
    <button class="streak-pill ${st.current > 0 ? 'lit' : ''}" data-action="tab" data-tab="progress" aria-label="Série en cours : ${count(st.current, 'jour')}">
      ${icon.flame(18)}<b>${st.current}</b>
    </button>
  </header>

  <section class="hero rise">
    <h1 class="hero-title">${state.name ? `<span class="hi">${greeting(now.getHours())}</span>${esc(state.name)}` : greeting(now.getHours())}</h1>
    <p class="lede">${lede({ stats, hour: now.getHours() })}</p>
    <button class="hero-orb" data-action="start" aria-label="Commencer une session">${orb('idle')}</button>
    <button class="hero-hint" data-action="start" tabindex="-1" aria-hidden="true">Touche la bulle pour respirer</button>
    <button class="session-chip" data-action="open-sheet" aria-label="Modifier la session : ${esc(preset.name)}, ${patternLabel(preset)}, ${durationLabel(minutes)}">
      <span><b>${esc(preset.name)}</b> <i>·</i> ${patternLabel(preset)} <i>·</i> ${durationLabel(minutes)}</span>${icon.settings(16)}
    </button>
  </section>

  ${showNudge ? `<section class="nudge tone-${nd.tone} rise" aria-live="polite">
    <span class="nudge-ico">${nd.ico}</span>
    <p>${nd.text}</p>
  </section>` : ''}

  <div data-slot="circle-card">${circleCardView(c)}</div>

  <section class="tiles rise">
    <article class="card tile tile-streak ${st.current > 0 ? 'is-lit' : ''}">
      <div class="tile-head"><span class="flame ${st.todayDone ? 'burning' : ''}">${icon.flame(30)}</span><span class="kicker">Série</span></div>
      <div class="tile-value"><span class="num" data-count="${st.current}" data-count-key="home-streak">${st.current}</span><span class="unit">${st.current >= 2 ? 'jours' : 'jour'}</span></div>
      <p class="tile-sub">${st.current === 0 ? 'Lance ta série aujourd’hui' : next ? `Prochain palier : ${next} jours` : 'Palier maximal atteint'}</p>
      <div class="mini-bar" aria-hidden="true"><i style="width:${Math.round(milestonePct * 100)}%"></i></div>
    </article>

    <article class="card tile tile-goal">
      <div class="tile-head"><span class="kicker">Aujourd’hui</span></div>
      ${ring({
        value: minToday / goal,
        id: 'ringGoal',
        size: 96,
        stroke: 10,
        inner: minToday >= goal ? `<span class="ring-check">${icon.check(30)}</span>` : `<b>${Math.floor(minToday)}</b><small>/ ${goal} min</small>`,
      })}
      <p class="tile-sub">${minToday >= goal ? 'Objectif atteint' : 'Objectif du jour'}</p>
    </article>
  </section>

  <section class="card week rise">
    <div class="card-head"><h2>Cette semaine</h2><span class="muted">${doneDays}/7 jours</span></div>
    <ol class="week-strip">${weekStrip({ today, state, st })}</ol>
    ${st.rest.size ? `<p class="fine"><span class="fine-ico">${icon.moon(14)}</span>Un jour manqué par semaine est offert : ta série continue.</p>` : ''}
  </section>

  <section class="card tip rise">
    <p class="kicker">À savoir</p>
    <h3>${esc(tip.title)}</h3>
    <p>${esc(tip.text)}</p>
  </section>`;
}

// ---------- Cercle de proches ----------

const hueOf = (mid) => parseInt(String(mid).slice(0, 4), 16) % 360;
const initialOf = (name) => esc((Array.from(name || '?')[0] || '?').toUpperCase());

const avatar = (mid, name, done = false) =>
  `<span class="avatar ${done ? 'done' : ''}" style="--h:${hueOf(mid)}" aria-hidden="true">${initialOf(name)}${done ? `<i class="av-check">${icon.check(11)}</i>` : ''}</span>`;

const joinNames = (names) => (names.length <= 1 ? names[0] || '' : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`);

/** Les signes reçus (« Léa t'a fait un petit signe ») : un bandeau discret qu'on ferme d'un toucher. */
function eventBanners(events) {
  if (!events.length) return '';
  return `<div class="sign-list" role="status">${events
    .slice(-3)
    .map((e) => `<p class="sign"><span class="sign-emoji" aria-hidden="true">${SIGNS[e.kind].emoji}</span>${esc(SIGNS[e.kind].text(e.name))}</p>`)
    .join('')}<button class="icon-btn small" data-action="circle-dismiss" aria-label="Fermer">${icon.close(16)}</button></div>`;
}

/** La carte de l'accueil : qui, parmi les proches, a respiré aujourd'hui, et où en est la série du cercle. */
export function circleCardView(c) {
  const { state, ui, today } = c;
  const cs = ui.circle;
  const banners = state.circle ? eventBanners(cs.events) : '';
  if (!state.circle) {
    // Une invitation discrète, seulement une fois qu'on a pris goût à l'app, et qu'on peut fermer.
    if (state.circleHint || state.sessions.length < 1) return '';
    return `<section class="card circle-card teaser rise">
      <button class="cc-main" data-action="tab" data-tab="circle">
        <span class="avatars" aria-hidden="true">${[260, 330, 190].map((h, i) => `<span class="avatar ${i < 2 ? 'done' : ''}" style="--h:${h}">${i < 2 ? `<i class="av-check">${icon.check(11)}</i>` : ''}</span>`).join('')}</span>
        <span class="cc-text"><b>Respire avec tes proches</b><small>Voyez qui a respiré aujourd’hui, et gardez une série ensemble.</small></span>
      </button>
      <button class="icon-btn small" data-action="circle-hint" aria-label="Fermer cette suggestion">${icon.close(16)}</button>
    </section>`;
  }
  const members = sortMembers(withMe(state, cs.members, today), today);
  const views = members.map((m) => ({ m, v: memberView(m.status, today) }));
  const others = views.filter(({ m }) => !m.me);
  const series = circleSeries(members, today);
  // Deux lignes courtes : la série du cercle, puis ce qu'il reste à faire aujourd'hui.
  const title = !others.length ? 'Invite tes proches' : series.days > 0 ? `Série du cercle : ${count(series.days, 'jour')}` : 'Série du cercle';
  const todo = series && !series.todayValid ? missingText(series.missing) : '';
  const sub = !others.length
    ? 'Ton cercle est encore vide'
    : series.total < 2
      ? `Elle démarre dès que quelqu’un d’autre respire${cs.error ? ' · hors ligne' : ''}`
      : `${series.todayValid ? 'Tout le monde a respiré ✨' : `${todo.charAt(0).toUpperCase()}${todo.slice(1)}`}${cs.error ? ' · hors ligne' : ''}`;
  const faces = views.slice(0, 5).map(({ m, v }) => avatar(m.mid, v.name, v.state === 'done')).join('');
  return `${banners}<section class="card circle-card rise ${series?.todayValid ? 'valid' : ''}">
    <button class="cc-main" data-action="tab" data-tab="circle">
      <span class="avatars" aria-hidden="true">${faces || avatar(state.circle.mid, state.name)}</span>
      <span class="cc-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
      <span class="cc-chev" aria-hidden="true">${icon.chevronRight(18)}</span>
    </button>
  </section>`;
}

/** Ce que l'on trouve derrière le code : le cercle et ses membres (ou la raison pour laquelle le code ne marche pas). */
export function circlePreviewView(cs) {
  const p = cs.preview;
  if (!p) return '';
  if (p.loading) return '<p class="circle-preview muted">Recherche du cercle…</p>';
  if (p.error) return `<p class="fine err" role="alert">${esc(p.error)}</p>`;
  const names = p.names.length ? joinNames(p.names.slice(0, 4)) + (p.names.length > 4 ? ` et ${p.names.length - 4} autre${p.names.length - 4 > 1 ? 's' : ''}` : '') : '';
  return `<div class="circle-preview found">
    <span class="avatars" aria-hidden="true">${p.names.slice(0, 4).map((n, i) => `<span class="avatar" style="--h:${(i * 83 + 40) % 360}">${initialOf(n)}</span>`).join('')}</span>
    <p><b>${esc(p.cn || 'Un cercle de proches')}</b>${names ? `<small>${esc(names)}</small>` : ''}${p.full ? '<small class="err-text">Ce cercle est complet.</small>' : ''}</p>
  </div>`;
}

const STATE_TEXT = {
  done: ['A respiré aujourd’hui', 'Tu as respiré aujourd’hui'],
  pending: ['Pas encore aujourd’hui', 'Pas encore aujourd’hui'],
  risk: ['Sa série ne tient qu’à un fil', 'Ta série ne tient qu’à un fil'],
  lapsed: ['Série interrompue', 'Série interrompue'],
  new: ['Pas encore commencé', 'Pas encore commencé'],
};

/** Ce qui se lit sous le prénom : l'état du jour, et depuis quand pour ceux qui ont décroché. */
function stateText(v, me) {
  const base = STATE_TEXT[v.state][me ? 1 : 0];
  if (v.state === 'lapsed' && v.lastLabel) return v.paused ? `En pause · dernière séance ${v.lastLabel}` : `Dernière séance ${v.lastLabel}`;
  return base;
}

/** Ce que l'on peut faire pour quelqu'un : un bravo s'il a respiré, un petit signe sinon (une fois par jour). */
function memberAction(m, v, c) {
  if (m.me) return '';
  const kind = v.state === 'done' ? 'cheer' : 'nudge';
  const sent = !canSend(c.state.circle, m.mid, kind, c.today);
  return `<button class="btn small ghost m-action" data-action="circle-sign" data-mid="${m.mid}" data-kind="${kind}" ${sent ? 'disabled' : ''}>${sent ? '✓ Envoyé' : `${SIGNS[kind].emoji} ${SIGNS[kind].label}`}</button>`;
}

function memberRow(m, c) {
  const { state, today } = c;
  const v = memberView(m.status, today);
  const days = weekKeys(today);
  const n = v.week.filter(Boolean).length;
  return `<li class="member card state-${v.state} ${m.me ? 'me' : ''}">
    ${avatar(m.mid, v.name, v.state === 'done')}
    <div class="m-main">
      <p class="m-name"><b>${esc(m.me ? state.name || v.name : v.name)}</b>${m.me ? '<em class="tag-me">Toi</em>' : ''}</p>
      <p class="m-state">${esc(stateText(v, m.me))}</p>
      <span class="m-week" role="img" aria-label="Cette semaine : ${n} jour${n > 1 ? 's' : ''} sur 7">${v.week.map((on, i) => `<i class="${on ? 'on' : ''} ${days[i] === today ? 'today' : ''}"></i>`).join('')}</span>
      ${memberAction(m, v, c)}
    </div>
    <span class="m-streak ${v.streak > 0 ? 'lit' : ''}" aria-label="Série : ${count(v.streak, 'jour')}">${icon.flame(18)}<b>${v.streak}</b></span>
  </li>`;
}

/** La série du cercle : le compteur, ce qu'il reste à faire aujourd'hui, et la semaine en sept anneaux. */
function seriesCard(series, week) {
  const line = todayLine(series);
  return `<section class="card series rise ${series.todayValid ? 'valid' : ''}" aria-label="Série du cercle">
    <p class="kicker">Série du cercle</p>
    <div class="series-top">
      <p class="series-num"><span class="flame ${series.days > 0 ? 'lit' : ''} ${series.todayValid ? 'burning' : ''}">${icon.flame(30)}</span><span data-count="${series.days}" data-count-key="series">${series.days}</span><small>${series.days > 1 ? 'jours' : 'jour'}</small></p>
    </div>
    <p class="series-line">${esc(line)}</p>
    <ol class="series-week">${week
      .map((d, i) => `<li class="wk ${d.valid ? 'valid' : ''} ${d.today ? 'today' : ''} ${d.future ? 'future' : ''}" ${d.valid ? 'aria-label="Jour validé"' : ''}>
        <span class="wk-dot" style="--p:${d.fill.toFixed(3)};--k:${i}"><i class="ring"></i>${d.valid ? icon.check(15) : ''}</span>
        <span class="letter">${DAY_LETTERS[i]}</span></li>`)
      .join('')}</ol>
  </section>`;
}

/** L'invitation : une ligne discrète quand le cercle existe, un appel plus franc quand on est seul. */
function inviteBlock(cs, circle, alone) {
  const code = cs.showCode
    ? `<div class="code-box"><span class="code" aria-label="Code du cercle">${esc(formatCode(circle.code))}</span><p class="fine">Quelqu’un qui a ce code peut rejoindre le cercle et lire les statuts. Ne le partage qu’avec tes proches.</p></div>`
    : '';
  // Le QR code encode le même lien que « Inviter » : un proche à côté de toi le scanne avec l'appareil photo.
  const qr = cs.showQr
    ? `<div class="qr-box"><div class="qr">${qrSvg(inviteLink(circle.code), { label: 'QR code pour rejoindre le cercle' })}</div><p class="fine">Il lui suffit de le scanner avec l’appareil photo de son téléphone. Ne le montre qu’à tes proches.</p></div>`
    : '';
  if (alone) {
    return `<section class="card invite first rise">
      <p class="list-title">Invite tes proches</p>
      <p class="muted">Ton cercle est encore vide. Envoie-leur le lien : il suffit de le toucher pour rejoindre.</p>
      <button class="cta" data-action="circle-share">Inviter par lien</button>
      <div class="invite-links">
        <button class="link-btn" data-action="circle-copy">${cs.copied ? '✓ Lien copié' : 'Copier le lien'}</button>
        <button class="link-btn" data-action="circle-qr">${cs.showQr ? 'Masquer le QR' : 'QR code'}</button>
        <button class="link-btn" data-action="circle-show-code">${cs.showCode ? 'Masquer le code' : 'Afficher le code'}</button>
      </div>
      ${qr}${code}
    </section>`;
  }
  return `<section class="invite-row rise">
      <button class="ir-main" data-action="circle-share">
        <span class="ir-text"><b>Inviter un proche</b><small>Un lien, et il rejoint en un geste</small></span>
      </button>
      <button class="icon-btn ${cs.showQr ? 'on' : ''}" data-action="circle-qr" aria-label="${cs.showQr ? 'Masquer le QR code' : 'Afficher le QR code'}" aria-pressed="${!!cs.showQr}">${icon.qr(20)}</button>
      <button class="icon-btn" data-action="circle-copy" aria-label="Copier le lien">${cs.copied ? icon.check(20) : icon.copy(20)}</button>
    </section>${qr}${code}`;
}

export function circleView(c) {
  const { state, ui, today } = c;
  const cs = ui.circle;
  const circle = state.circle;
  const head = '<header class="page-head rise"><h1>Cercle</h1></header>';
  const err = (text) => (text ? `<p class="fine err" role="alert">${esc(text)}</p>` : '');

  // ----- Formulaires : créer, rejoindre -----
  if (!circle && cs.form === 'create') {
    return `${head}
    <form class="card circle-form rise" data-form="circle-create" novalidate>
      <h2>Créer un cercle</h2>
      <p class="muted">Tu recevras un lien à envoyer à tes proches. Jusqu’à ${MAX_MEMBERS} personnes.</p>
      <label class="field"><span>Ton prénom</span>
        <input class="text-input wide" type="text" maxlength="24" autocomplete="given-name" placeholder="Ton prénom" value="${esc(cs.name)}" data-input="circle-name" />
      </label>
      <label class="field"><span>Nom du cercle <small>(facultatif)</small></span>
        <input class="text-input wide" type="text" maxlength="24" placeholder="La famille, les copains…" value="${esc(cs.cname)}" data-input="circle-cname" />
      </label>
      ${err(cs.error)}
      <button class="cta" type="submit" ${cs.busy ? 'disabled' : ''}>${cs.busy ? 'Création…' : 'Créer le cercle'}</button>
      <button class="link-btn" type="button" data-action="circle-cancel">Annuler</button>
    </form>`;
  }
  if (!circle && cs.form === 'join') {
    return `${head}
    <form class="card circle-form rise" data-form="circle-join" novalidate>
      <h2>${cs.invited ? 'Tu es invité' : 'Rejoindre un cercle'}</h2>
      <div data-slot="circle-preview">${circlePreviewView(cs)}</div>
      <p class="muted">${cs.invited ? 'Indique ton prénom pour que tes proches te reconnaissent.' : 'Saisis le code reçu de la personne qui t’invite.'}</p>
      ${cs.invited ? '' : `<label class="field"><span>Code du cercle</span>
        <input class="text-input wide code-in" type="text" inputmode="numeric" autocomplete="off" placeholder="0000 0000 0000 0000" value="${esc(cs.code)}" data-input="circle-code" />
      </label>`}
      <label class="field"><span>Ton prénom</span>
        <input class="text-input wide" type="text" maxlength="24" autocomplete="given-name" placeholder="Ton prénom" value="${esc(cs.name)}" data-input="circle-name" />
      </label>
      ${err(cs.error)}
      <button class="cta" type="submit" ${cs.busy ? 'disabled' : ''}>${cs.busy ? 'Connexion…' : 'Rejoindre'}</button>
      <button class="link-btn" type="button" data-action="circle-cancel">Annuler</button>
    </form>`;
  }

  // ----- Pas encore de cercle -----
  if (!circle) {
    return `${head}
    <section class="card circle-hero rise">
      <span class="avatars big" aria-hidden="true">${[260, 330, 190].map((h, i) => `<span class="avatar ${i < 2 ? 'done' : ''}" style="--h:${h}">${i < 2 ? `<i class="av-check">${icon.check(13)}</i>` : ''}</span>`).join('')}</span>
      <h2>Respirez ensemble</h2>
      <p class="lede">Gardez une série à plusieurs : chaque jour où tout le monde respire, le cercle avance.</p>
      <button class="cta" data-action="circle-form" data-form="create">Créer mon cercle</button>
      <button class="btn wide" data-action="circle-form" data-form="join">J’ai une invitation</button>
    </section>
    <section class="card list rise">
      <p class="list-title">Ce qui est partagé</p>
      <p class="circle-note"><b>Seulement :</b> ton prénom, ta série et les jours où tu as respiré (oui ou non, sur quatre semaines). Jamais tes durées, tes ressentis ni le détail de tes séances.</p>
      <p class="circle-note">Tout est chiffré avec le code du cercle : le serveur ne peut rien lire. Pas de compte, pas d’e-mail. Tu peux quitter quand tu veux.</p>
    </section>`;
  }

  // ----- Dans un cercle -----
  const members = sortMembers(withMe(state, cs.members, today), today);
  const series = circleSeries(members, today);
  const done = members.filter((m) => memberView(m.status, today).state === 'done').length;
  const others = members.filter((m) => !m.me).length;
  const title = circle.cn || members.map((m) => m.status.cn).find(Boolean) || 'Ton cercle';
  const sub = !members.length
    ? cs.loading ? 'Chargement…' : cs.error ? 'Hors ligne' : ''
    : `${count(members.length, 'personne')} · ${done} ${done > 1 ? 'ont' : 'a'} respiré aujourd’hui`;
  const updated = cs.at ? `Mis à jour ${ago(cs.at)}` : '';
  return `${head}
    <section class="circle-top rise">
      <div><h2>${esc(title)}</h2><p class="muted">${esc(sub)}</p></div>
      <button class="icon-btn ${cs.loading ? 'spin' : ''}" data-action="circle-refresh" aria-label="Actualiser" ${cs.loading ? 'disabled' : ''}>${icon.refresh(20)}</button>
    </section>
    ${series ? seriesCard(series, weekOverview(members, today)) : ''}
    ${eventBanners(cs.events)}
    ${err(cs.error)}
    ${members.length ? `<ul class="member-list rise">${members.map((m) => memberRow(m, c)).join('')}</ul>` : cs.loading ? '<p class="muted center rise">Chargement du cercle…</p>' : ''}
    ${inviteBlock(cs, circle, !others)}
    <div class="circle-foot rise">
      ${updated ? `<p class="fine center">${esc(updated)}</p>` : ''}
      <div class="foot-links">
        ${others ? `<button class="link-btn" data-action="circle-show-code">${cs.showCode ? 'Masquer le code' : 'Afficher le code'}</button>` : ''}
        <button class="link-btn danger" data-action="circle-leave">Quitter le cercle</button>
      </div>
    </div>`;
}

// ---------- Progrès ----------

const STEP_NAMES = ['Départ', 'Trois jours', 'Une semaine', 'Deux semaines', 'Un mois', 'Deux mois', 'Cent jours'];

function journeyCard(stats) {
  const L = journeyLayout(stats.current);
  const best = Math.max(stats.best, stats.current);
  const pos = (p) => `left:${((p.x / L.W) * 100).toFixed(2)}%;top:${((p.y / L.H) * 100).toFixed(2)}%`;
  const next = STEPS.find((v) => v > stats.current);
  const atNode = STEPS.includes(stats.current);

  const nodes = L.pts.map((p, i) => {
    const reached = i === 0 || best >= p.value;
    const side = p.x > 150 ? 'left' : 'right';
    const left = p.value - stats.current;
    const sub = i === 0 ? 'Ton premier souffle' : stats.current >= p.value ? 'Atteint' : best >= p.value ? 'Déjà atteint' : `Encore ${count(left, 'jour')}`;
    const dot = i === 0 ? icon.leaf(22) : `<b>${p.value}</b><small>jours</small>`;
    return `<div class="j-node ${reached ? 'reached' : ''} ${i === 0 ? 'start' : ''} ${side}" style="${pos(p)}">
      <div class="j-dot">${dot}</div>
      <div class="j-label"><b>${STEP_NAMES[i]}</b><span>${sub}</span></div>
    </div>`;
  }).join('');

  const hasDone = / C /.test(L.done);
  return `
  <section class="card journey-card rise">
    <div class="card-head">
      <h2>Ton ascension</h2>
      <span class="muted">${next ? `Prochain palier : ${next} jours` : 'Sommet atteint'}</span>
    </div>
    <div class="journey">
      <svg class="journey-svg" viewBox="0 0 ${L.W} ${L.H}" aria-hidden="true">
        <defs><linearGradient id="jGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style="stop-color:var(--accent-2)"/><stop offset="1" style="stop-color:var(--accent)"/>
        </linearGradient></defs>
        <path class="j-base" d="${L.full}"/>
        <path class="j-dash" d="${L.full}"/>
        ${hasDone ? `<path class="j-done" d="${L.done}"/>` : ''}
      </svg>
      ${nodes}
      <div class="j-you ${L.marker.x > 150 ? 'left' : 'right'} ${atNode ? 'at-node' : ''}" style="${pos(L.marker)}"><i></i><span>Tu es ici</span></div>
    </div>
  </section>`;
}

export function progressView(c) {
  const { state, stats, today, ui } = c;
  const goal = state.settings.goalMin;
  const lvl = levelInfo(stats.totalMinutes);
  const earned = new Set(earnedBadgeIds(stats));

  // Semaine
  const wk = weekKeys(today);
  const mins = wk.map((k) => minutesOn(state.sessions, k));
  const maxMin = Math.max(goal * 1.4, ...mins, 1);
  const bars = wk.map((k, i) => `
    <li class="bar-col ${k === today ? 'today' : ''}" style="--k:${i}">
      <em>${mins[i] >= 1 ? Math.round(mins[i]) : ''}</em>
      <div class="bar-track"><i class="bar-fill ${mins[i] >= goal ? 'full' : ''}" style="height:${(mins[i] / maxMin) * 100}%"></i></div>
      <span>${DAY_LETTERS[i]}</span>
    </li>`).join('');

  // Mois
  const base = parseKey(today);
  const first = new Date(base.getFullYear(), base.getMonth() + ui.cal, 1);
  const y = first.getFullYear();
  const m = first.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  let practiced = 0;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<i class="cal-blank"></i>');
  for (let d = 1; d <= daysIn; d++) {
    const key = dayKey(new Date(y, m, d));
    const mm = minutesOn(state.sessions, key);
    if (mm >= 1) practiced++;
    const cls = key > today ? 'future' : mm >= goal ? 'full' : mm >= 1 ? 'part' : '';
    cells.push(`<li class="cal-day ${cls} ${key === today ? 'today' : ''}"><span>${d}</span></li>`);
  }

  const history = [...state.sessions].reverse().slice(0, 8).map((s) => {
    const p = getPreset(s.preset);
    const f = FEELINGS.find((x) => x.id === s.feeling);
    const when = new Date(s.ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<li class="hist-row"><span class="hist-when">${esc(when)}</span><span class="hist-what">${esc(p.name)}</span><span class="hist-dur">${formatDuration(s.seconds)}</span><span class="hist-feel" title="${f ? f.label : ''}">${f ? f.emoji : ''}</span></li>`;
  }).join('');

  return `
  <header class="page-head rise"><h1>Mes progrès</h1></header>

  <section class="card level rise">
    <div class="level-top">
      <div>
        <p class="kicker">Niveau ${lvl.index + 1} sur ${LEVELS.length}</p>
        <h2 class="level-name">${lvl.level.name}</h2>
        <p class="muted">${lvl.level.blurb}</p>
      </div>
      <div class="level-orb">${orb('mini')}</div>
    </div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lvl.progress * 100)}"><i style="width:${Math.round(lvl.progress * 100)}%"></i></div>
    <p class="bar-caption">${lvl.next ? `Encore ${lvl.toNext} min pour devenir « ${lvl.next.name} »` : 'Niveau maximal atteint'}</p>
  </section>

  <section class="stat-grid rise">
    <article class="card stat"><span class="stat-num">${formatDuration(stats.totalSeconds)}</span><span class="stat-label">de respiration</span></article>
    <article class="card stat"><span class="stat-num" data-count="${stats.sessions}" data-count-key="stat-sessions">${stats.sessions}</span><span class="stat-label">${stats.sessions >= 2 ? 'sessions' : 'session'}</span></article>
    <article class="card stat"><span class="stat-num" data-count="${stats.current}" data-count-key="stat-current">${stats.current}</span><span class="stat-label">${stats.current >= 2 ? 'jours' : 'jour'} de série</span></article>
    <article class="card stat"><span class="stat-num" data-count="${stats.best}" data-count-key="stat-best">${stats.best}</span><span class="stat-label">${stats.best >= 2 ? 'jours' : 'jour'} · record</span></article>
  </section>

  <section class="card rise">
    <div class="card-head"><h2>Cette semaine</h2><span class="muted">objectif ${goal} min</span></div>
    <ul class="bars" style="--goal:${(goal / maxMin) * 100}%">${bars}</ul>
  </section>

  <section class="card rise">
    <div class="card-head cal-head">
      <button class="icon-btn small" data-action="cal-prev" aria-label="Mois précédent">${icon.chevronLeft(20)}</button>
      <h2 class="cal-title">${MONTHS[m]} ${y}</h2>
      <button class="icon-btn small" data-action="cal-next" aria-label="Mois suivant" ${ui.cal >= 0 ? 'disabled' : ''}>${icon.chevronRight(20)}</button>
    </div>
    <ul class="cal-week" aria-hidden="true">${DAY_LETTERS.map((l) => `<li>${l}</li>`).join('')}</ul>
    <ul class="cal">${cells.join('')}</ul>
    <p class="fine center">${practiced === 0 ? 'Aucune session ce mois-ci' : `${count(practiced, 'jour pratiqué', 'jours pratiqués')} ce mois-ci`}</p>
  </section>

  ${journeyCard(stats)}

  <section class="rise">
    <div class="card-head flat"><h2>Trophées</h2><span class="muted">${earned.size}/${BADGES.length}</span></div>
    <ul class="badges">
      ${BADGES.filter((b) => !b.id.startsWith('streak')).map((b) => `
        <li class="badge ${earned.has(b.id) ? 'on' : 'off'} kind-${b.id.split('-')[0]}">
          <div class="medal"><span>${b.glyph}</span></div>
          <b>${b.title}</b><small>${b.desc}</small>
        </li>`).join('')}
    </ul>
  </section>

  ${history ? `<section class="card rise"><div class="card-head"><h2>Dernières sessions</h2></div><ul class="hist">${history}</ul></section>` : ''}`;
}

// ---------- Réglages ----------

const ago = (ts) => {
  if (!ts) return 'jamais';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
};

function syncSection({ state, ui }) {
  const sy = state.sync;
  const u = ui.sync;
  const error = u.error ? `<p class="fine left err" role="alert">${esc(u.error)}</p>` : '';
  if (!sy) {
    return `
  <section class="card list rise">
    <p class="list-title">Synchronisation</p>
    <p class="fine left">Retrouve ton historique sur tous tes appareils, sans compte ni e-mail. Un code de 16 chiffres suffit, et tes données sont chiffrées : le serveur ne peut pas les lire.</p>
    ${u.entering ? `
    <form class="pw-form" data-form="sync-join" autocomplete="on" novalidate>
      <div class="code-wrap">
        <input class="text-input wide code-input" type="password" name="password" inputmode="numeric" autocomplete="current-password" spellcheck="false" maxlength="19" placeholder="Code à 16 chiffres" value="${esc(u.draft)}" data-input="sync-code" aria-label="Code de synchronisation" />
        <button type="button" class="eye" data-action="sync-peek" aria-label="Afficher ou masquer le code">${icon.eye(20)}</button>
      </div>
      ${error}
      <div class="btn-row">
        <button type="button" class="btn small ghost" data-action="sync-cancel">Annuler</button>
        <button type="submit" class="btn small accent" ${u.busy ? 'disabled' : ''}>${u.busy ? 'Connexion…' : 'Se connecter'}</button>
      </div>
    </form>` : `
    ${error}
    <div class="btn-row">
      <button class="btn small accent" data-action="sync-enable" ${u.busy ? 'disabled' : ''}>${u.busy ? 'Activation…' : 'Activer'}</button>
      <button class="btn small" data-action="sync-enter">J’ai un code</button>
    </div>`}
  </section>`;
  }
  return `
  <section class="card list rise">
    <p class="list-title">Synchronisation</p>
    <p class="sync-status"><i class="dot"></i>Active · ${u.busy ? 'synchronisation en cours…' : `à jour ${ago(sy.lastSync)}`}</p>
    <form id="sync-save-form" class="pw-form" data-form="sync-save" autocomplete="on" novalidate>
      <div class="code-wrap">
        <input class="code-field" type="password" name="password" value="${formatCode(sy.code)}" autocomplete="new-password" readonly aria-label="Code de synchronisation" />
        <button type="button" class="eye" data-action="sync-peek" aria-label="Afficher ou masquer le code">${icon.eye(20)}</button>
      </div>
    </form>
    <div class="btn-row">
      <button type="button" class="btn small" data-action="sync-copy">Copier</button>
      <button type="submit" form="sync-save-form" class="btn small">Enregistrer</button>
    </div>
    <p class="fine left">${ui.ios ? 'Sur iPhone : touche « Copier », puis ajoute le code dans l’app Mots de passe. ' : ''}Sans ce code, tu ne pourras pas retrouver tes données sur un autre appareil, et personne ne peut le récupérer à ta place. Ne le partage pas.</p>
    ${error}
    <button class="btn small wide" data-action="sync-now" ${u.busy ? 'disabled' : ''}>Synchroniser</button>
    <div class="link-stack">
      <button class="link-btn" data-action="sync-disable">Désactiver sur cet appareil</button>
      <button class="link-btn danger" data-action="sync-delete">Supprimer mes données du serveur</button>
    </div>
  </section>`;
}

export function settingsView(c) {
  const { state, ui } = c;
  const s = state.settings;
  const seg = (items, current, action, dataKey) => `
    <div class="seg" role="radiogroup">
      ${items.map(([value, label]) => `<button role="radio" aria-checked="${String(value) === String(current)}" class="${String(value) === String(current) ? 'on' : ''}" data-action="${action}" data-${dataKey}="${value}">${label}</button>`).join('')}
    </div>`;
  return `
  <header class="page-head rise"><h1>Réglages</h1></header>

  <section class="card list rise">
    <label class="row stack">
      <span class="row-text"><b>Prénom</b><small>Pour que l’accueil te salue</small></span>
      <input class="text-input wide" type="text" inputmode="text" autocomplete="given-name" maxlength="24" placeholder="Ton prénom (optionnel)" value="${esc(state.name)}" data-input="name" />
    </label>
    <div class="row stack">
      <span class="row-text"><b>Objectif quotidien</b><small>Une minute suffit pour garder ta série ; l’objectif te donne un cap.</small></span>
      ${seg(GOALS.map((g) => [g, `${g} min`]), s.goalMin, 'set-goal', 'min')}
    </div>
  </section>

  <section class="card list rise">
    <p class="list-title">Pendant la session</p>
    ${toggle('sound', s.sound, 'Son', 'Une piste douce guide ton souffle. Elle continue si tu verrouilles ton téléphone : écouteurs, Bluetooth, voiture.')}
    ${s.sound ? `<div class="row stack">
      <span class="row-text"><b>Guidage</b><small>${esc((GUIDE_STYLES.find((g) => g.id === s.soundStyle) || GUIDE_STYLES[0]).blurb)}</small></span>
      ${seg(GUIDE_STYLES.map((g) => [g.id, g.name]), s.soundStyle, 'set-sound-style', 'style')}
      <button class="btn wide ghost" data-action="preview-sound">${icon.volume(18)} Écouter un aperçu</button>
    </div>
    <p class="fine left">Le volume se règle avec les boutons de ton téléphone. En voiture, lance la séance à l’arrêt et évite les rythmes avec une pause (4-7-8, Calme profond) : ils détendent beaucoup.</p>` : ''}
    ${ui.canVibrate
      ? toggle('haptics', s.haptics, 'Vibrations', 'Une légère impulsion à chaque changement de phase')
      : ui.touch
        ? '<div class="row"><span class="row-text"><b>Vibrations</b><small>Indisponibles ici : l’iPhone ne les permet pas aux applications web. Le son suffit à guider ton souffle.</small></span></div>'
        : ''}
    ${ui.pipSupported ? toggle('pipAuto', s.pipAuto, 'Fenêtre flottante', 'Ouvre la session dans une petite fenêtre toujours visible : tu respires pendant que tu travailles') : ''}
    ${ui.pipSupported && ui.linux ? '<p class="fine left">Sous GNOME (Wayland), le navigateur ne peut pas la garder au premier plan. L’extension « PiP on top » le fait, mais seulement quand Respire est ouverte dans un onglet du navigateur, pas dans l’application installée.</p>' : ''}
  </section>

  <section class="card list rise">
    <p class="list-title">Rappel quotidien</p>
    <div class="row">
      <span class="row-text"><b>Heure habituelle</b><small>Ajoute un événement récurrent à ton calendrier : il te prévient tous les jours.</small></span>
      <input class="time-input" type="time" value="${esc(s.reminder)}" data-input="reminder" />
    </div>
    <button class="btn wide" data-action="add-reminder">${icon.bell(18)} Ajouter le rappel au calendrier</button>
  </section>

  ${syncSection(c)}

  <section class="card list rise">
    <p class="list-title">Apparence</p>
    ${seg([['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']], s.theme, 'set-theme', 'theme')}
  </section>

  ${ui.canInstall ? `<section class="card list rise"><p class="list-title">Application</p><button class="btn wide" data-action="install">${icon.download(18)} Installer sur l’écran d’accueil</button></section>`
    : ui.iosHint ? `<section class="card list rise"><p class="list-title">Application</p><p class="fine left">Sur iPhone : touche <b>Partager</b>, puis <b>Sur l’écran d’accueil</b> pour installer Respire comme une vraie application.</p></section>` : ''}

  <section class="card list rise">
    <p class="list-title">Tes données</p>
    <p class="fine left">Tout reste sur cet appareil. Aucun compte, aucun envoi.</p>
    <div class="btn-row">
      <button class="btn" data-action="export">${icon.download(18)} Exporter</button>
      <button class="btn danger" data-action="reset">Tout effacer</button>
    </div>
  </section>

  <section class="card list rise">
    <p class="list-title">À propos</p>
    <p class="fine left">Respire t’aide à réapprendre une respiration calme : par le nez, sans forcer, avec une expiration plus longue que l’inspiration. Si tu ressens des vertiges ou une gêne, reprends une respiration normale. Cette application ne remplace pas un avis médical.</p>
    <button class="btn wide ghost" data-action="replay-intro">Revoir la présentation</button>
  </section>`;
}

// ---------- Choix de la session (feuille) ----------

/** `dir` : sens du dernier changement de rythme (+1 vers la droite, -1 vers la gauche, 0 aucun) pour l'animation. */
export function sheetView(c, { dir = 0 } = {}) {
  const { state } = c;
  const s = state.settings;
  const preset = getPreset(s.presetId);
  const plan = sessionPlan(preset, s.minutes);
  const swap = dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : '';
  const dots = PRESETS.map((p) => {
    const on = p.id === preset.id;
    return `<button role="radio" aria-checked="${on}" class="rdot ${on ? 'on' : ''}" data-action="pick-preset" data-id="${p.id}" aria-label="${esc(p.name)}, ${patternLabel(p)}"><i></i></button>`;
  }).join('');
  return `
  <div class="sheet-grip" aria-hidden="true"></div>
  <header class="sheet-head">
    <h2 id="sheet-title">Ta session</h2>
    <button class="icon-btn small" data-action="close-sheet" aria-label="Fermer">${icon.close(20)}</button>
  </header>

  <section class="rhythm" data-rhythm="${preset.id}" aria-roledescription="carrousel" aria-label="Rythme de respiration">
    <div class="rhythm-stage">
      <button class="rz-arrow prev" data-action="rhythm-prev" aria-label="Rythme précédent">${icon.chevronLeft(20)}</button>
      <div class="rhythm-orb">${orb('idle')}</div>
      <button class="rz-arrow next" data-action="rhythm-next" aria-label="Rythme suivant">${icon.chevronRight(20)}</button>
    </div>
    <div class="rhythm-info ${swap}" aria-live="polite">
      <h3 class="rhythm-name">${esc(preset.name)}</h3>
      <p class="rhythm-pattern" aria-label="Inspire ${preset.inhale}${preset.hold1 ? `, retiens ${preset.hold1}` : ''}, expire ${preset.exhale}${preset.hold2 ? `, retiens ${preset.hold2}` : ''}">${patternLabel(preset)}</p>
      <p class="rhythm-tag">${esc(preset.tagline)}</p>
    </div>
    <div class="rhythm-dots" role="radiogroup" aria-label="Rythme">${dots}</div>
  </section>

  <div class="sheet-body">
    <div class="seg big dense" role="radiogroup" aria-label="Durée">
      ${DURATIONS.map((d) => `<button role="radio" aria-checked="${d === s.minutes}" class="${d === s.minutes ? 'on' : ''}" data-action="pick-minutes" data-min="${d}" ${d === UNLIMITED ? 'aria-label="Sans limite"' : ''}>${d === UNLIMITED ? 'Libre' : durationLabel(d)}</button>`).join('')}
    </div>
  </div>

  <footer class="sheet-foot">
    <button class="cta" data-action="start-from-sheet">Commencer${Number.isFinite(plan.totalSeconds) ? ` · ${formatDuration(plan.totalSeconds)}` : ''}<span class="cta-ico">${icon.chevronRight(20)}</span></button>
  </footer>`;
}

// ---------- Fin de session ----------

export function doneView(d) {
  const feelings = FEELINGS.map((f) => `<button class="feel" data-action="feeling" data-id="${f.id}" aria-pressed="false"><span>${f.emoji}</span><small>${f.label}</small></button>`).join('');
  const badges = d.newBadges.map((b) => `
    <li class="unlock kind-${b.id.split('-')[0]}">
      <div class="medal small"><span>${b.glyph}</span></div>
      <div><p class="kicker">Nouveau trophée</p><b>${b.title}</b><small>${b.desc}</small></div>
    </li>`).join('');
  return `
  <div class="done-inner">
    <div class="petals" aria-hidden="true"></div>
    <div class="done-top">
      <div class="done-orb" aria-hidden="true">${orb('done')}<span class="done-check">${icon.check(44)}</span></div>
      <h2 class="done-title">${d.completed ? 'Session terminée' : 'Session enregistrée'}</h2>
      <p class="muted">${formatDuration(d.seconds)} · ${count(d.cycles, 'respiration')} · ${esc(d.presetName)}</p>
    </div>

    <div class="done-streak ${d.streakIncreased ? 'up' : ''}">
      <span class="flame burning">${icon.flame(46)}</span>
      <div><span class="num" data-from="${d.streakBefore}" data-to="${d.streakAfter}">${d.streakAfter}</span>
      <span class="unit">${d.streakAfter >= 2 ? 'jours de suite' : 'jour de suite'}</span></div>
    </div>

    ${d.circleLine ? `<p class="done-circle ${d.circleLine.valid ? 'valid' : ''}">${esc(d.circleLine.text)}</p>` : ''}

    <div class="done-goal">
      ${ring({ value: d.minutesToday / d.goal, id: 'ringDone', size: 54, stroke: 6, inner: d.minutesToday >= d.goal ? icon.check(20) : '' })}
      <p><b>${Math.floor(d.minutesToday)} / ${d.goal} min</b> aujourd’hui<br><span class="muted">${d.minutesToday >= d.goal ? 'Objectif atteint' : `Encore ${Math.ceil(d.goal - d.minutesToday)} min pour l’objectif`}</span></p>
    </div>

    <p class="done-msg">${esc(d.message)}</p>

    ${d.levelUp ? `<div class="level-up"><p class="kicker">Nouveau niveau</p><b>${d.levelUp.name}</b><small>${d.levelUp.blurb}</small></div>` : ''}
    ${badges ? `<ul class="unlocks">${badges}</ul>` : ''}

    <div class="feel-box">
      <p class="muted">Comment te sens-tu ?</p>
      <div class="feel-row">${feelings}</div>
    </div>
  </div>
  <div class="done-foot"><button class="cta" data-action="done-close">Terminer</button></div>`;
}

// ---------- Présentation (première ouverture) ----------

export function onboardingView(ob) {
  const dots = [0, 1, 2].map((i) => `<i class="${i === ob.step ? 'on' : ''}"></i>`).join('');
  let body = '';
  if (ob.step === 0) {
    body = `
      <div class="ob-orb">${orb('idle big')}</div>
      <h1 class="ob-title">Respire.</h1>
      <p class="ob-text">Quelques minutes par jour pour réapprendre à respirer calmement, jusqu’à ce que ça redevienne naturel.</p>
      <button class="cta" data-action="ob-next">Découvrir</button>`;
  } else if (ob.step === 1) {
    body = `
      <h1 class="ob-title small">Trois repères</h1>
      <ul class="ob-points">
        <li><span class="pt">1</span><div><b>Par le nez</b><p>Bouche fermée, langue posée contre le palais.</p></div></li>
        <li><span class="pt">2</span><div><b>Léger et silencieux</b><p>Un souffle doux, sans effort : ton corps sait respirer, laisse-le faire.</p></div></li>
        <li><span class="pt">3</span><div><b>Expirer plus longtemps</b><p>Une expiration lente est ce qui apaise le corps.</p></div></li>
      </ul>
      <p class="ob-reassure">Au début, suivre le rythme peut être difficile : c’est normal, ton corps a pris d’autres habitudes. En respirant consciemment, tu travailles aussi ta respiration inconsciente : à force, il la retrouve sans que tu y penses.</p>
      <button class="cta" data-action="ob-next">Continuer</button>`;
  } else {
    body = `
      <h1 class="ob-title small">À toi de jouer</h1>
      <label class="ob-field"><span>Comment t’appelles-tu ? <em>(facultatif)</em></span>
        <input class="text-input wide" type="text" maxlength="24" autocomplete="given-name" placeholder="Ton prénom" value="${esc(ob.name)}" data-input="ob-name" />
      </label>
      <div class="ob-field"><span>Ton objectif quotidien</span>
        <div class="seg big" role="radiogroup">
          ${[3, 5, 10].map((g) => `<button role="radio" aria-checked="${g === ob.goal}" class="${g === ob.goal ? 'on' : ''}" data-action="ob-goal" data-min="${g}">${g} min</button>`).join('')}
        </div>
        <small>5 minutes par jour, c’est un excellent départ.</small>
      </div>
      <p class="ob-note">Respire sans forcer. En cas de vertiges ou de gêne, reprends une respiration normale. Cette application ne remplace pas un avis médical.</p>
      <button class="cta" data-action="ob-finish">C’est parti</button>`;
  }
  return `<div class="ob-card step-${ob.step}"><div class="ob-body">${body}</div><div class="ob-dots" aria-hidden="true">${dots}</div></div>`;
}
