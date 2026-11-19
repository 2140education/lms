// C21 Online: app shell, router and all views.
import * as N from './nostr.js';
import { S, restoreSession, loginLocal, loginExtension, loginBunker, createLocalAccount, logout, savedNcryptsec, loadAccount, saveSettings, saveLearner,
  createLearner, updateLearnerSettings, weeklyVideos, videoInfo, c21Calendar, defaultWeekEvents, publishWeek, reposOf, activityOf, announceRepo, postDevlog, devlogsOf, GIT_READ } from './store.js';
import { PROGRAMS, ALL_LESSONS, lessonById, programById, DEFAULT_WEEK } from './lessons.js';
import { PLANS, SITE, NOSTRGIT_PROFILE_URL, NOSTRGIT_REPO_URL, RELAYS } from './config.js';
import { $, $$, esc, linkify, fmtDate, fmtWhen, toast, avatar, qr, safetyCheck, nickname, icsFile, download, animateIn, typeLines, mondayOf, ymd } from './ui.js';
import { audToSats, requestInvoice } from './pay.js';

const app = $('#app');
const view = (html) => { app.innerHTML = html; window.scrollTo(0, 0); animateIn(app); };
const loading = (msg = 'Loading from relays…') => view(`<section class="wrap pad"><div class="loader"><span></span><span></span><span></span></div><p class="muted center">${msg}</p></section>`);
const STAGES = [['discover', 'Discover'], ['design', 'Design'], ['build', 'Build'], ['launch', 'Launch']];
const TYPE_COLOUR = { explore: '#3aa65a', core: '#2f6fde', pbl: '#1fa6a0', sip: '#f2c230', community: '#e0533d', fit: '#7a5cd6', live: '#f7931a', mine: '#9fb6c8' };
const ytEmbed = (url) => { const m = url?.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/); return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null; };

function videoHtml(info) {
  if (!info.url) return '';
  const yt = ytEmbed(info.url);
  return yt ? `<div class="video"><iframe src="${yt}" allowfullscreen loading="lazy" title="${esc(info.title)}"></iframe></div>`
    : `<div class="video"><video controls preload="metadata" src="${esc(info.url)}"></video></div>`;
}

// ---------- modal ----------
function modal(html, { onMount } = {}) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-card">${html}</div>`;
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('show'));
    const close = (v) => { m.classList.remove('show'); setTimeout(() => m.remove(), 250); resolve(v); };
    m.addEventListener('click', (e) => { if (e.target === m || e.target.dataset.close !== undefined) close(null); });
    onMount?.(m, close);
  });
}
const askPassword = (title = 'Unlock your account', note = 'Your key is locked on this device with your password.') => modal(`
  <h3>${esc(title)}</h3><p class="muted">${esc(note)}</p>
  <form id="pwf"><input id="pw" type="password" placeholder="Password" autocomplete="current-password" required>
  <div class="row mt"><button class="btn">Unlock</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
{ onMount: (m, close) => { $('#pw', m).focus(); $('#pwf', m).onsubmit = (e) => { e.preventDefault(); close($('#pw', m).value); }; } });

// ---------- nav ----------
function renderNav() {
  const r = S.role;
  const links = !S.signer ? [['#/lessons', 'Lessons'], ['#/#week', 'The week'], ['#/#portfolio', 'Portfolio'], ['#/pay', 'Plans'], ['#/#safety', 'Safety']]
    : [['#/home', 'Home'], ['#/lessons', 'Lessons'], ['#/calendar', 'Calendar'], ['#/me', 'Portfolio'], ['#/messages', 'Messages'],
      ...(r === 'parent' ? [['#/family', 'Family']] : []), ...(r === 'staff' ? [['#/studio', 'Studio']] : []), ['#/pay', 'Plans']];
  $('#nav').innerHTML = links.map(([h, l]) => `<a href="${h}" class="${location.hash.startsWith(h) && h !== '#/' ? 'on' : ''}">${l}</a>`).join('');
  $('#navcta').innerHTML = S.signer ? `<a href="#/account" class="me">${avatar(S.signer.pubkey, 30)}<span>${esc(S.settings?.name || (r === 'staff' ? 'Kieran' : 'Account'))}</span></a>`
    : `<a class="btn small" href="#/login">Log in</a>`;
}
$('#burger').onclick = () => document.body.classList.toggle('navopen');

// ---------- router ----------
const routes = {
  '': landing, lessons: lessonsView, lesson: lessonView, u: portfolioView, pay: payView, login: loginView,
  home: needLogin(homeView), calendar: needLogin(calendarView), me: needLogin(() => portfolioView(N.npub(S.signer.pubkey))),
  messages: needLogin(messagesView), family: needLogin(familyView), studio: needLogin(studioView), account: needLogin(accountView), welcome: needLogin(onboardView),
};
function needLogin(fn) { return (...a) => (S.signer ? (S.role ? fn(...a) : onboardView()) : (location.hash = '#/login')); }
async function route() {
  document.body.classList.remove('navopen');
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('#')) { renderNav(); await landing(); const el = document.getElementById(h.slice(1)); if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 150); return; }
  const [path, query] = h.split('?');
  const [page, ...args] = path.split('/');
  renderNav();
  Q = new URLSearchParams(query || '');
  try { await (routes[page] || landing)(...args.map(decodeURIComponent)); }
  catch (e) { console.error(e); view(`<section class="wrap pad"><div class="card bad">Something went wrong: ${esc(e.message)}</div></section>`); }
}
window.addEventListener('hashchange', route);
let Q = new URLSearchParams();

// ================= PUBLIC =================
async function landing() {
  const totalLessons = ALL_LESSONS.length;
  view(`
  <section class="hero">
    <div class="blob b1"></div><div class="blob b2"></div>
    <div class="wrap hero-grid">
      <div class="reveal">
        <div class="eyebrow">Open learning protocol · Online · Ages 5 to 21</div>
        <h1>School, rewritten as open source.<br><span class="grad">Now online.</span></h1>
        <p class="lead">C21 Online brings the Consensus21 week to home educators everywhere. Real projects, mentors instead of teachers, a calendar you run yourself, and a portfolio that lives on Nostr, owned by you.</p>
        <div class="row mt"><a class="btn" href="#/login">Start your learning journey</a><a class="btn ghost" href="#/#week">See the week</a></div>
        <div class="stats">
          <div><b data-count="21" data-suffix="">0</b><span>max learner age</span></div>
          <div><b data-count="0">0</b><span>exams</span></div>
          <div><b data-count="${totalLessons}">0</b><span>lessons</span></div>
          <div><b data-count="${RELAYS.length}">0</b><span>relays, zero servers</span></div>
        </div>
      </div>
      <div class="cube-stage reveal" aria-hidden="true"><div class="cube3d">
        ${[['Lessons', 0], ['Calendar', 1], ['Portfolio', 2], ['Nostr', 3], ['Weekly video', 4], ['Parents', 5]].map(([label, f]) => `<div class="face f${f}">${[...Array(9)].map((_, i) => `<i style="--d:${(i * 0.07).toFixed(2)}s"></i>`).join('')}<span>${label}</span></div>`).join('')}
      </div></div>
    </div>
  </section>

  <section class="wrap pad" id="why">
    <div class="eyebrow reveal">Why C21 Online</div>
    <h2 class="reveal">Less like a school. More like a protocol.</h2>
    <div class="grid g3 mt">
      ${[['🗳️', 'Student voice', 'Learners write Improvement Proposals and vote on how C21 runs. Your ideas change the rules.'],
         ['🔑', 'You own your stuff', 'Your login is a Nostr key. Your work lives on public relays and git, not in a company database.'],
         ['🤝', 'A community that builds', 'Mentors, older learners and parents help every project grow, holidays after holidays.']]
        .map(([i, t, d], k) => `<div class="card lift reveal" style="--delay:${k * 0.1}s"><div class="icon">${i}</div><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
    </div>
  </section>

  <section class="band" id="week"><div class="wrap pad">
    <div class="eyebrow reveal">The week</div>
    <h2 class="reveal">A week at Consensus21</h2>
    <p class="lead reveal">Published by Kieran on Nostr (NIP-52) and shown in your own time zone.</p>
    <div class="weekgrid mt" id="weekgrid"><div class="loader"><span></span><span></span><span></span></div></div>
    <div class="row mt"><button class="btn" id="ics">Add to my calendar</button><a class="btn ghost light" href="#/login">Make it yours</a></div>
  </div></section>

  <section class="wrap pad" id="video">
    <div class="eyebrow reveal">This week from Kieran</div>
    <div id="latestvideo" class="reveal"><div class="card">Loading the latest video from relays…</div></div>
  </section>

  <section class="wrap pad" id="journey">
    <div class="eyebrow reveal">Learning journey</div>
    <h2 class="reveal">It starts with <code>git init</code></h2>
    <div class="grid g2 mt">
      <div class="steps">${['Get your key. A parent creates your login, locked with a password.', 'Plan your week. The C21 calendar drops into yours.', 'Pick a project and a program. Lessons walk you through it.', 'git init your portfolio on Nostr.', 'Log each Explorers Day Out.', 'Commit a reflection every Friday.', 'Bring a SIP to Thursday discussion.']
        .map((s, i) => `<div class="step reveal" style="--delay:${i * 0.06}s"><b>${String(i + 1).padStart(2, '0')}</b><span>${s}</span></div>`).join('')}</div>
      <div class="terminal reveal"><div class="tbar"><i></i><i></i><i></i><span>~/my-c21</span></div><pre id="term"></pre></div>
    </div>
  </section>

  <section class="band" id="portfolio"><div class="wrap pad grid g2 center-y">
    <div>
      <div class="eyebrow reveal">Portfolio</div>
      <h2 class="reveal">Your profile is your report card</h2>
      <ul class="ticks reveal"><li>Repositories announced on Nostr (NIP-34), viewable on NostrGit</li><li>A contribution graph that fills up as you build</li><li>Devlog entries every Friday instead of grades</li><li>Pseudonymous by default: no real names, faces or schools</li></ul>
      <a class="btn mt" href="#/u/${N.npub(N.STAFF[0])}">See Kieran's profile</a>
    </div>
    <div class="card dark reveal"><div class="row">${avatar('a3f19c22be0177d5e8', 56)}<div><b>SwiftBuilder42</b><div class="muted small">npub1swift…builder</div></div></div>
      <div class="heat demo mt">${[...Array(7 * 26)].map((_, i) => `<i class="l${(i * 7919) % 11 > 6 ? ((i * 31) % 4) + 1 : 0}" style="--d:${(i * 0.006).toFixed(3)}s"></i>`).join('')}</div>
      <div class="repo mini mt"><b>garden-sensor</b><p class="muted small">Soil moisture alerts for the veggie patch.</p></div></div>
  </div></section>

  <section class="wrap pad" id="lessons">
    <div class="eyebrow reveal">Lessons</div>
    <h2 class="reveal">Everything Kieran runs in person, now online</h2>
    <div class="grid g3 mt">${PROGRAMS.map((p, i) => programCard(p, i)).join('')}</div>
  </section>

  <section class="band" id="protocol"><div class="wrap pad">
    <div class="eyebrow reveal">How it works</div>
    <h2 class="reveal">Built on Nostr, end to end</h2>
    <div class="flow mt reveal">
      <div class="node">👨‍👩‍👧 Parents<small>log in with an extension, remote signer or password-locked key</small></div><div class="arrow">⇄</div>
      <div class="node hub">🔐 Encrypted relays<small>NIP-44 progress, NIP-17 messages, NIP-49 keys</small></div><div class="arrow">⇄</div>
      <div class="node">🧑‍💻 Learners<small>lessons, calendar, NostrGit portfolio</small></div><div class="arrow">⇄</div>
      <div class="node">🧙 Mentors<small>weekly video (NIP-71), calendar (NIP-52)</small></div>
    </div>
    <p class="muted mt reveal">No database, no server. The site is static files on GitHub Pages. Everything else is Nostr. Payments go over Nostr too, with CLINK Lightning offers.</p>
  </div></section>

  <section class="wrap pad" id="safety">
    <div class="eyebrow reveal">Safety</div>
    <h2 class="reveal">Built for kids first</h2>
    <div class="grid g3 mt">${[
      ['Parents create every learner login', 'Learner keys are made by a parent and locked with a password the parent sets. Parents keep a backup.'],
      ['Progress is encrypted', 'Lesson progress, notes and calendars are encrypted so only the learner, their parent and (if you choose) their mentor can read them.'],
      ['No strangers', 'There is no public feed and no DMs from strangers. Learners can only message their family room with Kieran.'],
      ['Pseudonymous portfolios', 'Learners get a generated name and cube avatar. Public text is checked for emails, phone numbers, addresses and school names.'],
      ['Parents decide what is public', 'Public portfolio publishing is off until a parent switches it on.'],
      ['Open and auditable', 'Every line of this site is open source. Anyone can check what it does.']]
      .map(([t, d], i) => `<div class="card reveal" style="--delay:${i * 0.05}s"><h3>✓ ${t}</h3><p class="muted">${d}</p></div>`).join('')}</div>
  </section>

  <section class="band" id="plans"><div class="wrap pad">
    <div class="eyebrow reveal">Plans</div><h2 class="reveal">Lessons are free. Mentoring is paid.</h2>
    <p class="lead reveal">Every lesson is open to everyone. Plans add mentors, live sessions and the in-person Holiday Studio. Pay in sats over Nostr.</p>
    <div class="grid g4 mt">${PLANS.map((p, i) => planCard(p, i)).join('')}</div>
  </div></section>`);

  typeLines($('#term'), ['$ c21 login', '✓ key unlocked (NIP-49)', '$ c21 calendar import --week', '✓ 9 sessions added, shown in your time zone', '$ git init my-c21', '✓ repository announced on 6 relays (NIP-34)', '$ c21 reflect --friday', '✓ progress encrypted for your parent (NIP-44)', '$ c21 sip new "Minecraft build night"', '✓ see you Thursday']);

  const events = await c21Calendar();
  if (!$('#ics')) return;
  renderWeek($('#weekgrid'), events);
  $('#ics').onclick = () => icsFile(events, 'c21-week');
  const vids = await weeklyVideos();
  const box = $('#latestvideo');
  if (box) box.innerHTML = vids.length ? (() => { const v = videoInfo(vids[0]); return `<div class="card video-card"><h2>${esc(v.title)}</h2><p class="muted small">${fmtDate(v.at)}</p>${videoHtml(v)}<p>${linkify(v.notes)}</p></div>`; })()
    : `<div class="card"><h3>Weekly videos start soon</h3><p class="muted">Kieran posts a new video every week. It is published on Nostr, so it lives on every relay, not one website.</p></div>`;
}

function programCard(p, i = 0) {
  return `<a class="card lift program reveal" href="#/lessons/${p.id}" style="--accent:${p.colour};--delay:${(i % 3) * 0.08}s">
    <div class="pc-icon">${p.icon}</div><h3>${esc(p.title)}</h3><p class="muted">${esc(p.summary)}</p>
    <div class="pc-meta"><span class="pill">${p.lessons.length} lessons</span><span class="pill">Ages ${esc(p.ages)}</span></div></a>`;
}
function planCard(p, i = 0) {
  return `<div class="card plan ${p.featured ? 'featured' : ''} reveal" style="--delay:${i * 0.07}s">${p.featured ? '<span class="tag">Most popular</span>' : ''}
    <h3>${esc(p.name)}</h3><div class="price">A$${p.aud}<small>/${p.per}</small></div><p class="muted">${esc(p.blurb)}</p>
    <ul class="ticks small">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn ${p.featured ? '' : 'ghost'}" href="#/pay?plan=${p.id}">Pay in sats</a></div>`;
}

function renderWeek(el, events, mine = []) {
  if (!el) return;
  const monday = mondayOf();
  const days = [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const all = [...events, ...mine].filter((e) => e.start * 1000 >= monday.getTime() - 86400000 * 0 && e.start * 1000 < monday.getTime() + 7 * 86400000);
  const shown = all.length ? all : defaultWeekEvents(monday);
  el.innerHTML = days.slice(0, 5).concat(days.slice(5).filter((d) => shown.some((e) => new Date(e.start * 1000).toDateString() === d.toDateString())))
    .map((d) => {
      const evs = shown.filter((e) => new Date(e.start * 1000).toDateString() === d.toDateString()).sort((a, b) => a.start - b.start);
      return `<div class="day reveal in"><h4>${d.toLocaleDateString(undefined, { weekday: 'long' })}<small>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></h4>
        ${evs.map((e) => `<div class="blk" style="--c:${TYPE_COLOUR[e.type] || '#2f6fde'}"><div class="t">${new Date(e.start * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${e.end ? ' to ' + new Date(e.end * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</div><div class="n">${esc(e.title)}</div>${e.mine ? '<span class="mine">mine</span>' : ''}</div>`).join('') || '<p class="muted small">Free day</p>'}</div>`;
    }).join('');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  el.insertAdjacentHTML('afterend', el.nextElementSibling?.classList.contains('tznote') ? '' : `<p class="tznote small muted">Times shown in your time zone (${esc(tz)}). C21 runs on ${SITE.timezone.replace('_', ' ')} time.</p>`);
}

// ---------- lessons ----------
function lessonsView(programId) {
  if (programId) {
    const p = programById(programId);
    if (!p) return (location.hash = '#/lessons');
    const done = S.learner?.done || {};
    return view(`<section class="wrap pad">
      <a href="#/lessons" class="muted small">← All programs</a>
      <div class="phead reveal" style="--accent:${p.colour}"><div class="pc-icon big">${p.icon}</div><div><h1>${esc(p.title)}</h1><p class="lead">${esc(p.summary)}</p>
      <div class="pc-meta"><span class="pill">Ages ${esc(p.ages)}</span>${p.weeks ? `<span class="pill">${p.weeks} weeks</span>` : ''}${p.areas.map((a) => `<span class="pill soft">${esc(a)}</span>`).join('')}</div></div></div>
      <div class="lesson-list mt">${p.lessons.map((l, i) => `<a class="lrow reveal" href="#/lesson/${l.id}" style="--delay:${i * 0.05}s"><span class="num ${done[l.id] ? 'done' : ''}">${done[l.id] ? '✓' : i + 1}</span><span><b>${esc(l.title)}</b><small class="muted">${esc(l.goal)}</small></span><span class="pill">${esc(l.time)}</span></a>`).join('')}</div>
    </section>`);
  }
  const doneCount = Object.keys(S.learner?.done || {}).length;
  view(`<section class="wrap pad"><div class="eyebrow">Lessons</div><h1>Every program Kieran runs, online</h1>
    <p class="lead">${ALL_LESSONS.length} lessons across ${PROGRAMS.length} programs. Free for everyone. ${S.role === 'learner' ? `You've finished <b>${doneCount}</b>.` : 'Log in as a learner to track progress.'}</p>
    <div class="grid g3 mt">${PROGRAMS.map(programCard).join('')}</div></section>`);
}

function lessonView(id) {
  const l = lessonById(id);
  if (!l) return (location.hash = '#/lessons');
  const p = programById(l.program);
  const idx = p.lessons.findIndex((x) => x.id === id);
  const next = p.lessons[idx + 1];
  const isLearner = S.role === 'learner';
  const done = S.learner?.done?.[id];
  view(`<section class="wrap pad narrow">
    <a href="#/lessons/${p.id}" class="muted small">← ${esc(p.title)}</a>
    <div class="reveal"><span class="pill" style="background:${p.colour};color:#081b2a">${p.icon} Lesson ${idx + 1} of ${p.lessons.length}</span><h1 class="mt">${esc(l.title)}</h1><p class="lead">${esc(l.goal)}</p>
    <div class="pc-meta"><span class="pill">⏱ ${esc(l.time)}</span></div></div>
    <div class="grid g2 mt">
      <div class="card reveal"><h3>You'll need</h3><ul class="ticks">${l.need.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>${l.safety ? `<div class="safe">🛡️ ${esc(l.safety)}</div>` : ''}</div>
      <div class="card reveal"><h3>Commit to your portfolio</h3><p>${esc(l.commit)}</p><p class="muted small">Add it as a devlog entry on your portfolio repository.</p></div>
    </div>
    <h2 class="mt">Steps</h2>
    <ol class="steps-list">${l.steps.map((s, i) => `<li class="reveal" style="--delay:${i * 0.06}s"><span>${i + 1}</span><p>${esc(s)}</p></li>`).join('')}</ol>
    ${isLearner ? `<div class="card mt"><h3>My notes</h3><textarea id="note" placeholder="What did you try? What happened? (Only you, your parent and your mentor can read this.)">${esc(S.learner.notes?.[id] || '')}</textarea>
      <div class="row mt"><button class="btn" id="done">${done ? '✓ Done. Update notes' : 'Mark as done'}</button>${next ? `<a class="btn ghost" href="#/lesson/${next.id}">Next lesson →</a>` : ''}</div></div>`
    : `<div class="card mt"><p>${S.signer ? 'Parents: your learner tracks progress from their own login.' : '<a href="#/login">Log in</a> to track progress, keep notes and share them with your parent.'}</p>${next ? `<a class="btn ghost mt" href="#/lesson/${next.id}">Next lesson →</a>` : ''}</div>`}
  </section>`);
  if (isLearner) $('#done').onclick = () => {
    S.learner.notes = { ...S.learner.notes, [id]: $('#note').value };
    S.learner.done = { ...S.learner.done, [id]: N.now() };
    saveLearner(); toast('Saved and shared with your parent ✓');
    if (next) location.hash = '#/lesson/' + next.id; else lessonView(id);
  };
}

// ---------- portfolio (GitHub-style, from NIP-34) ----------
async function portfolioView(npubStr) {
  let pk;
  try { pk = N.toHexKey(npubStr); } catch { return view('<section class="wrap pad"><div class="card bad">That profile link is not valid.</div></section>'); }
  const own = S.signer?.pubkey === pk;
  loading('Loading portfolio from Nostr git relays…');
  const [prof, repos, activity, devlogs] = await Promise.all([N.profile(pk), reposOf(pk), activityOf(pk), devlogsOf(pk)]);
  const isLearner = own && S.role === 'learner';
  const canPublish = !isLearner || S.settings?.publicPortfolio;
  const counts = {};
  activity.forEach((e) => { const k = ymd(new Date(e.created_at * 1000)); counts[k] = (counts[k] || 0) + 1; });
  const total = activity.length;
  const start = mondayOf(new Date(Date.now() - 52 * 7 * 86400000));
  const cells = [...Array(53 * 7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); const c = counts[ymd(d)] || 0; return d > new Date() ? '<i class="future"></i>' : `<i class="l${c === 0 ? 0 : c < 2 ? 1 : c < 4 ? 2 : c < 7 ? 3 : 4}" title="${c} contributions on ${d.toDateString()}"></i>`; }).join('');
  const name = prof.display_name || prof.name || N.shortNpub(pk);
  const addr = (r) => `30617:${pk}:${r.tags.find((t) => t[0] === 'd')?.[1]}`;
  const tag = (e, n) => e.tags.find((t) => t[0] === n)?.[1];
  const nostrgit = (tpl, extra = {}) => tpl.replace('{npub}', N.npub(pk)).replace('{naddr}', extra.naddr || '');
  view(`<section class="wrap pad profile">
    <aside class="pside reveal">
      ${avatar(pk, 220)}
      <h1>${esc(name)}</h1><p class="muted mono small">${N.shortNpub(pk)}</p>
      ${prof.about ? `<p>${esc(prof.about)}</p>` : ''}
      <div class="row"><button class="btn small ghost" id="copy">Copy profile link</button><a class="btn small ghost" href="${esc(nostrgit(NOSTRGIT_PROFILE_URL))}" target="_blank" rel="noopener">View on NostrGit</a></div>
      <p class="muted small mt">📦 ${repos.length} repositories · ✏️ ${devlogs.length} devlog entries</p>
      ${N.STAFF.includes(pk) ? '<span class="pill" style="background:#f7931a;color:#081b2a">C21 mentor</span>' : ''}
    </aside>
    <div class="pmain">
      <h2 class="reveal">Repositories</h2>
      <div class="grid g2">${repos.map((r) => `<div class="repo card reveal"><div class="row between"><b>📘 ${esc(tag(r, 'name') || tag(r, 'd'))}</b><span class="pill soft">Public</span></div>
        <p class="muted small">${esc(tag(r, 'description') || 'No description yet.')}</p>
        <div class="row small">${r.tags.filter((t) => t[0] === 't' && !t[1].startsWith('c21')).map((t) => `<span class="pill soft">${esc(t[1])}</span>`).join('')}
        ${tag(r, 'web') ? `<a href="${esc(tag(r, 'web'))}" target="_blank" rel="noopener">Website</a>` : ''}<a href="${esc(nostrgit(NOSTRGIT_REPO_URL, { naddr: N.nip19.naddrEncode({ kind: 30617, pubkey: pk, identifier: tag(r, 'd'), relays: GIT_READ.slice(0, 2) }) }))}" target="_blank" rel="noopener">NostrGit</a>
        ${tag(r, 'clone') ? `<code class="clone" title="Clone URL">${esc(tag(r, 'clone'))}</code>` : ''}</div>
        <p class="muted small">Updated ${fmtDate(r.created_at)}</p></div>`).join('') || `<div class="card muted">No public repositories yet.${own ? ' Create your first one below.' : ''}</div>`}</div>
      <h2 class="mt reveal">${total} contributions in the last year</h2>
      <div class="card reveal"><div class="heat">${cells}</div><div class="row small muted between mt"><span>Learn how we count contributions: repos, devlogs, patches and issues on Nostr.</span><span class="legend">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</span></div></div>
      ${own ? `<div class="grid g2 mt">
        <div class="card"><h3>New repository</h3>${canPublish ? '' : '<p class="safe">🛡️ Your parent hasn\'t switched on public publishing yet. Your repo will be saved as a private draft your parent can see.</p>'}
          <label>Name</label><input id="rname" placeholder="my-c21" pattern="[a-z0-9-]+">
          <label>Description</label><input id="rdesc" placeholder="What are you building? (no real names or places)">
          <label>Website (optional)</label><input id="rweb" placeholder="https://">
          <label>Clone URL from NostrGit (optional)</label><input id="rclone" placeholder="paste after creating the repo on NostrGit">
          <button class="btn mt" id="rcreate">${canPublish ? 'Announce on Nostr' : 'Save draft'}</button></div>
        <div class="card"><h3>Friday devlog</h3><label>Repository</label><select id="dlrepo">${repos.map((r) => `<option value="${esc(addr(r))}">${esc(tag(r, 'name') || tag(r, 'd'))}</option>`).join('') || '<option value="">Create a repository first</option>'}</select>
          <label>What did you build? What did you learn? What's next?</label><textarea id="dltext"></textarea><button class="btn mt" id="dlpost" ${repos.length && canPublish ? '' : 'disabled'}>Post devlog</button></div></div>` : ''}
      <h2 class="mt reveal">Devlog</h2>
      <div class="timeline">${devlogs.slice(0, 30).map((d) => `<div class="tl reveal"><span class="dot"></span><div class="card"><p class="muted small">${fmtWhen(d.created_at)} · ${esc((d.tags.find((t) => t[0] === 'a')?.[1] || '').split(':')[2] || '')}</p><p>${linkify(d.content)}</p></div></div>`).join('') || '<p class="muted">No devlog entries yet.</p>'}</div>
    </div></section>`);
  $('#copy').onclick = () => navigator.clipboard.writeText(location.origin + location.pathname + '#/u/' + N.npub(pk)).then(() => toast('Profile link copied'));
  if (!own) return;
  $('#rcreate').onclick = async () => {
    const slug = $('#rname').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    const desc = $('#rdesc').value.trim();
    if (!slug) return toast('Give your repository a name', true);
    const bad = safetyCheck(slug, desc, $('#rweb').value);
    if (bad) return toast(bad, true);
    if (!canPublish) { S.learner.drafts = [...(S.learner.drafts || []), { slug, desc, at: N.now() }]; saveLearner(); return toast('Draft saved. Your parent can see it.'); }
    try { await announceRepo({ slug, name: slug, description: desc, web: $('#rweb').value.trim(), clone: $('#rclone').value.trim() }); toast('Repository announced on Nostr ✓'); portfolioView(npubStr); }
    catch (e) { toast(e.message, true); }
  };
  $('#dlpost').onclick = async () => {
    const t = $('#dltext').value.trim();
    if (!t || !$('#dlrepo').value) return;
    const bad = safetyCheck(t); if (bad) return toast(bad, true);
    try { await postDevlog($('#dlrepo').value, t); toast('Devlog posted ✓'); portfolioView(npubStr); } catch (e) { toast(e.message, true); }
  };
}

// ---------- payments ----------
async function payView() {
  const sel = Q.get('plan') || 'studio';
  const kids = S.settings?.children || [];
  view(`<section class="wrap pad"><div class="eyebrow">Plans</div><h1>Pay in sats, over Nostr</h1>
    <p class="lead">Lessons are free for everyone. Plans add mentoring, live sessions and the in-person Holiday Studio. Payments use a CLINK offer: your wallet gets a Lightning invoice straight from Kieran's node over Nostr.</p>
    <div class="grid g4 mt">${PLANS.map((p, i) => planCard(p, i)).join('')}</div>
    <div class="card mt" id="checkout"><h2>Checkout</h2>
      <div class="grid g3"><div><label>Plan</label><select id="plan">${PLANS.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}: A$${p.aud}/${p.per}</option>`).join('')}</select></div>
      <div><label>How many (months or days)</label><input id="qty" type="number" min="1" value="1"></div>
      <div><label>For</label>${kids.length ? `<select id="who">${kids.map((k) => `<option>${esc(k.name)}</option>`).join('')}</select>` : '<input id="who" placeholder="Learner nickname">'}</div></div>
      <div class="row mt"><button class="btn" id="go">Get invoice</button><span id="quote" class="muted"></span></div>
      <div id="invoice"></div></div></section>`);
  const plan = () => PLANS.find((p) => p.id === $('#plan').value);
  const quote = async () => { try { const sats = await audToSats(plan().aud * Number($('#qty').value || 1)); $('#quote').textContent = `≈ ${sats.toLocaleString()} sats at today's rate`; return sats; } catch { $('#quote').textContent = 'Could not get today\'s bitcoin price.'; return null; } };
  $('#plan').onchange = quote; $('#qty').oninput = quote; quote();
  $('#go').onclick = async () => {
    const sats = await quote(); if (!sats) return;
    const who = $('#who').value.trim();
    const desc = `C21 ${plan().name} x${$('#qty').value}${who ? ' for ' + who : ''}`;
    $('#invoice').innerHTML = '<div class="loader mt"><span></span><span></span><span></span></div><p class="muted center">Asking Kieran\'s offer for an invoice over Nostr…</p>';
    try {
      const bolt11 = await requestInvoice(sats, desc, async () => {
        $('#invoice').innerHTML = `<div class="paid">⚡ Paid. Thank you!</div>`;
        toast('Payment received ✓');
        if (S.signer) {
          try { await N.sendPrivate(S.signer, N.STAFF, `Payment: ${desc}, ${sats} sats.`, [['c21', 'payment']]); } catch {}
          if (S.role === 'learner') { S.learner.payments = [...(S.learner.payments || []), { desc, sats, at: N.now() }]; saveLearner(); }
        }
      });
      $('#invoice').innerHTML = `<div class="invoice mt"><div class="qr">${qr('lightning:' + bolt11)}</div><div>
        <p><b>${sats.toLocaleString()} sats</b> · ${esc(desc)}</p><p class="mono small break">${esc(bolt11)}</p>
        <div class="row"><a class="btn" href="lightning:${bolt11}">Open wallet</a><button class="btn ghost" id="cp">Copy invoice</button>${window.webln ? '<button class="btn ghost" id="wl">Pay with WebLN</button>' : ''}</div>
        <p class="muted small mt">Waiting for payment… this page updates when your payment lands.</p></div></div>`;
      $('#cp').onclick = () => navigator.clipboard.writeText(bolt11).then(() => toast('Invoice copied'));
      if (window.webln) $('#wl').onclick = async () => { try { await window.webln.enable(); await window.webln.sendPayment(bolt11); } catch (e) { toast(e.message, true); } };
    } catch (e) { $('#invoice').innerHTML = `<p class="bad card mt">${esc(e.message)}</p>`; }
  };
}

// ---------- login ----------
function loginView() {
  if (S.signer) return (location.hash = '#/home');
  const k = Q.get('k') || '';
  const saved = savedNcryptsec();
  view(`<section class="wrap pad narrow"><div class="eyebrow">Log in</div><h1>Your key is your login</h1>
    <p class="lead">C21 uses Nostr keys instead of passwords stored on a server. Your secret key never leaves your device or signer.</p>
    ${k || saved ? `<div class="card glow mt"><h3>🧑‍💻 Learner login</h3><p class="muted">Your parent gave you a login code. Enter the password they set.</p>
      <input id="lk" class="mono small" value="${esc(k || saved || '')}" placeholder="ncryptsec1…"><input id="lp" type="password" placeholder="Password" class="mt"><button class="btn mt" id="llogin">Log in</button></div>` : ''}
    <div class="grid g3 mt">
      <div class="card lift"><div class="icon">🧩</div><h3>Browser extension</h3><p class="muted small">Alby, nos2x or similar (NIP-07). Best for parents and mentors.</p><button class="btn" id="ext">Connect extension</button></div>
      <div class="card lift"><div class="icon">📱</div><h3>Remote signer</h3><p class="muted small">Amber, nsec.app or any NIP-46 bunker. Your key stays on your phone.</p><input id="bunker" placeholder="bunker://… or name@domain" class="small"><button class="btn mt" id="bk">Connect</button></div>
      <div class="card lift"><div class="icon">🔐</div><h3>Password-locked key</h3><p class="muted small">A key on this device, encrypted with your password (NIP-49).</p>
        <button class="btn" id="newacct">Create a new account</button><details class="mt"><summary class="small">I have an nsec or ncryptsec</summary><input id="imp" class="mono small" placeholder="nsec1… or ncryptsec1…"><input id="imppw" type="password" placeholder="Password" class="mt small"><button class="btn ghost mt" id="impgo">Import</button></details></div>
    </div>
    <p class="muted small mt">Learners don't sign up here. A parent creates each learner's login from the Family page.</p></section>`);
  const after = async () => { toast('Logged in ✓'); await loadAccount(); renderNav(); location.hash = S.role ? '#/home' : '#/welcome'; };
  const guard = (fn) => async () => { try { await fn(); await after(); } catch (e) { toast(e.message || 'Login failed', true); } };
  $('#ext').onclick = guard(loginExtension);
  $('#bk').onclick = guard(async () => { const v = $('#bunker').value.trim(); if (!v) throw new Error('Paste your bunker link first'); toast('Approve the connection in your signer…'); await loginBunker(v); });
  $('#newacct').onclick = async () => {
    const pw = await modal(`<h3>Choose a password</h3><p class="muted">It locks your new key on this device. If you forget it, your backup key is the only way back in.</p>
      <form id="f"><input id="a" type="password" minlength="8" placeholder="At least 8 characters" required><input id="b" type="password" placeholder="Again" class="mt" required><div class="row mt"><button class="btn">Create</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
    { onMount: (m, close) => { $('#f', m).onsubmit = (e) => { e.preventDefault(); if ($('#a', m).value !== $('#b', m).value) return toast('Passwords don\'t match', true); close($('#a', m).value); }; } });
    if (!pw) return;
    const ncryptsec = createLocalAccount(pw);
    await modal(`<h3>Save your backup</h3><p>This is your encrypted key. Keep it in a password manager. With your password, it gets you back in on any device.</p><p class="mono small break keybox">${ncryptsec}</p>
      <div class="row mt"><button class="btn" id="dl">Download</button><button class="btn ghost" data-close>I've saved it</button></div>`,
    { onMount: (m) => { $('#dl', m).onclick = () => download('c21-key-backup.txt', `C21 Online encrypted key (NIP-49)\n\n${ncryptsec}\n\nYou need your password to use it.\n`); } });
    await after();
  };
  $('#impgo').onclick = guard(async () => {
    const v = $('#imp').value.trim(); const pw = $('#imppw').value;
    if (!pw || pw.length < 8) throw new Error('Choose a password of at least 8 characters');
    if (v.startsWith('ncryptsec')) loginLocal(v, pw);
    else { const sk = N.nip19.decode(v).data; loginLocal(N.lockKey(sk, pw), pw); }
  });
  if ($('#llogin')) $('#llogin').onclick = guard(async () => loginLocal($('#lk').value.trim(), $('#lp').value));
}

function onboardView() {
  view(`<section class="wrap pad narrow"><h1>Welcome to C21 Online</h1><p class="lead">One quick question so we can set things up.</p>
    <div class="grid g2 mt"><button class="card lift choose" data-r="parent"><div class="icon">👨‍👩‍👧</div><h3>I'm a parent or guardian</h3><p class="muted">Create learner logins, see progress, talk to Kieran, pay for plans.</p></button>
    <div class="card"><div class="icon">🧑‍💻</div><h3>I'm a learner</h3><p class="muted">Ask your parent to create your login from their Family page. They'll give you a login code and password.</p></div></div>
    <label class="mt">Your display name (shown to Kieran)</label><input id="nm" placeholder="e.g. Sam (parent)"></section>`);
  $$('.choose').forEach((b) => b.onclick = async () => {
    try { await saveSettings({ role: b.dataset.r, name: $('#nm').value.trim() || 'Parent', children: [] }); S.role = b.dataset.r; renderNav(); location.hash = '#/family'; }
    catch (e) { toast(e.message, true); }
  });
}

// ================= LOGGED IN =================
async function homeView() {
  const r = S.role;
  const first = esc((S.settings?.name || 'Kieran').split(' ')[0]);
  view(`<section class="wrap pad"><h1 class="reveal">G'day ${first} 👋</h1>
    <div class="grid g2 mt"><div class="card reveal"><h3>This week from Kieran</h3><div id="vid"><p class="muted">Loading…</p></div></div>
    <div class="card reveal" id="side"></div></div>
    <h2 class="mt">This week</h2><div class="weekgrid light" id="weekgrid"></div></section>`);
  const side = $('#side');
  if (r === 'learner') {
    const done = Object.keys(S.learner.done || {}).length;
    const nextL = ALL_LESSONS.find((l) => !S.learner.done?.[l.id]);
    side.innerHTML = `<h3>Your progress</h3><div class="ring" style="--p:${Math.round((done / ALL_LESSONS.length) * 100)}"><span>${done}<small>/${ALL_LESSONS.length}</small></span></div>
      ${nextL ? `<p>Up next: <a href="#/lesson/${nextL.id}">${esc(nextL.title)}</a></p>` : '<p>You finished every lesson! 🎉</p>'}
      <h3 class="mt">My project</h3><input id="pt" value="${esc(S.learner.project.title)}" placeholder="Project name">
      <div class="stages mt">${STAGES.map(([id, l]) => `<button class="stage ${S.learner.project.stage === id ? 'on' : ''}" data-s="${id}">${l}</button>`).join('')}</div>
      <input id="pn" class="mt" value="${esc(S.learner.project.next)}" placeholder="Next milestone"><button class="btn mt" id="psave">Save project</button>`;
    $$('.stage', side).forEach((b) => b.onclick = () => { $$('.stage', side).forEach((x) => x.classList.remove('on')); b.classList.add('on'); S.learner.project.stage = b.dataset.s; });
    $('#psave').onclick = () => { S.learner.project = { ...S.learner.project, title: $('#pt').value, next: $('#pn').value }; saveLearner(); toast('Project saved and shared with your parent ✓'); };
  } else if (r === 'parent') {
    const kids = S.settings.children || [];
    side.innerHTML = `<h3>Your learners</h3>${kids.map((k) => `<div class="row kid">${avatar(k.pubkey, 40)}<div><b>${esc(k.name)}</b><div class="muted small">${k.publicPortfolio ? 'Public portfolio on' : 'Portfolio private'}</div></div></div>`).join('') || '<p class="muted">No learners yet.</p>'}
      <a class="btn mt" href="#/family">${kids.length ? 'See progress' : 'Add a learner'}</a>`;
  } else {
    side.innerHTML = `<h3>Mentor tools</h3><p class="muted">Post the weekly video, publish the C21 calendar and see learners who share progress with you.</p><a class="btn" href="#/studio">Open Studio</a>`;
  }
  const [vids, events] = await Promise.all([weeklyVideos(), c21Calendar()]);
  if (!$('#vid')) return;
  $('#vid').innerHTML = vids.length ? (() => { const v = videoInfo(vids[0]); return `<h2>${esc(v.title)}</h2>${videoHtml(v)}<p>${linkify(v.notes)}</p>${vids.length > 1 ? `<details><summary class="small">Earlier videos</summary>${vids.slice(1, 8).map((e) => { const x = videoInfo(e); return `<div class="mt"><b>${esc(x.title)}</b> <span class="muted small">${fmtDate(x.at)}</span>${videoHtml(x)}</div>`; }).join('')}</details>` : ''}`; })() : '<p class="muted">No video yet this week.</p>';
  renderWeek($('#weekgrid'), events, myBlocks());
}

function myBlocks() {
  if (S.role !== 'learner') return [];
  const monday = mondayOf();
  return (S.learner.calendar || []).map((b) => {
    const d = new Date(monday); d.setDate(d.getDate() + Number(b.day) - 1);
    const [sh, sm] = b.start.split(':').map(Number), [eh, em] = b.end.split(':').map(Number);
    const s = new Date(d); s.setHours(sh, sm); const e = new Date(d); e.setHours(eh, em);
    return { id: b.id, title: b.title, type: 'mine', mine: true, start: Math.floor(s / 1000), end: Math.floor(e / 1000) };
  });
}

async function calendarView() {
  loading();
  const events = await c21Calendar();
  const mine = S.role === 'learner';
  view(`<section class="wrap pad"><div class="eyebrow">Calendar</div><h1>Your week</h1>
    <p class="lead">The C21 week comes from Kieran's Nostr calendar (NIP-52).${mine ? ' Your own blocks are encrypted, so only you, your parent and your mentor can see them.' : ''}</p>
    <div class="weekgrid light mt" id="weekgrid"></div>
    <div class="row mt"><button class="btn" id="ics">Export to my calendar app (.ics)</button></div>
    ${mine ? `<div class="card mt"><h3>Add a block of my own</h3><div class="grid g4"><div><label>Day</label><select id="bd">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></div>
      <div><label>Start</label><input id="bs" type="time" value="13:00"></div><div><label>End</label><input id="be" type="time" value="14:00"></div><div><label>What</label><input id="bt" placeholder="Project time, footy, piano…"></div></div>
      <button class="btn mt" id="badd">Add every week</button>
      <div class="mt">${(S.learner.calendar || []).map((b) => `<span class="pill soft">${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][b.day]} ${b.start} ${esc(b.title)} <button class="x" data-id="${b.id}">×</button></span>`).join(' ')}</div></div>` : ''}
  </section>`);
  renderWeek($('#weekgrid'), events, myBlocks());
  $('#ics').onclick = () => icsFile([...events, ...myBlocks()], 'my-c21-week');
  if (!mine) return;
  $('#badd').onclick = () => {
    const t = $('#bt').value.trim(); if (!t) return toast('What is the block for?', true);
    S.learner.calendar = [...(S.learner.calendar || []), { id: Math.random().toString(36).slice(2, 9), day: $('#bd').value, start: $('#bs').value, end: $('#be').value, title: t }];
    saveLearner(); calendarView();
  };
  $$('.x').forEach((b) => b.onclick = () => { S.learner.calendar = S.learner.calendar.filter((x) => x.id !== b.dataset.id); saveLearner(); calendarView(); });
}

// ---------- messages: family rooms (NIP-17). Learners can only message their family room. ----------
async function messagesView() {
  const me = S.signer.pubkey;
  let defaultRoom;
  if (S.role === 'learner') defaultRoom = [me, S.settings.parent, ...N.STAFF];
  else if (S.role === 'parent') defaultRoom = [me, ...(S.settings.children || []).map((c) => c.pubkey), ...N.STAFF];
  view(`<section class="wrap pad"><div class="eyebrow">Messages</div><h1>${S.role === 'staff' ? 'Family rooms' : 'Family room with Kieran'}</h1>
    <p class="lead">${S.role === 'staff' ? 'Every conversation includes the learner\'s parent.' : 'Private and encrypted (NIP-17). Your parent, your learner(s) and Kieran are always in the room together.'}</p>
    <div class="msgs mt"><div class="rooms" id="rooms"></div><div class="card"><div class="thread" id="thread"><p class="muted">Loading messages…</p></div>
    <div id="compose" class="mt"><textarea id="mt" placeholder="Write a message"></textarea><button class="btn mt" id="send">Send</button></div></div></div></section>`);
  const rooms = new Map(); let current = defaultRoom ? key(defaultRoom) : null;
  function key(pks) { return [...new Set(pks)].sort().join(','); }
  const names = new Map([[me, 'You'], ...N.STAFF.map((s) => [s, 'Kieran']), ...(S.settings?.children || []).map((c) => [c.pubkey, c.name])]);
  if (S.settings?.parent) names.set(S.settings.parent, 'Parent');
  const nm = (pk) => names.get(pk) || N.shortNpub(pk);
  const draw = () => {
    $('#rooms').innerHTML = [...rooms.entries()].sort((a, b) => b[1].last - a[1].last).map(([k, r]) => `<button class="${k === current ? 'on' : ''}" data-k="${k}">${k.split(',').filter((p) => p !== me && !N.STAFF.includes(p)).map(nm).join(', ') || 'Mentors'}<small>${fmtWhen(r.last)}${r.flag ? ' · enrol' : ''}</small></button>`).join('') || (S.role === 'staff' ? '<p class="muted small">No messages yet.</p>' : '');
    const r = rooms.get(current);
    $('#thread').innerHTML = r ? r.msgs.sort((a, b) => a.created_at - b.created_at).map((m) => `<div class="msg ${m.pubkey === me ? 'me' : ''}"><div class="meta"><b>${esc(nm(m.pubkey))}</b> · ${fmtWhen(m.created_at)}</div><p>${linkify(m.content)}</p></div>`).join('') : '<p class="muted">No messages yet. Say hello!</p>';
    $('#thread').scrollTop = 1e9;
    $('#compose').style.display = current ? '' : 'none';
  };
  $('#rooms').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; current = b.dataset.k; draw(); };
  $('#send').onclick = async () => {
    const t = $('#mt').value.trim(); if (!t || !current) return;
    $('#send').disabled = true;
    try {
      const rumor = await N.sendPrivate(S.signer, current.split(',').filter((p) => p !== me), t);
      const r = rooms.get(current) || { msgs: [], last: 0 }; r.msgs.push(rumor); r.last = rumor.created_at; rooms.set(current, r);
      $('#mt').value = ''; draw();
    } catch (e) { toast(e.message, true); }
    $('#send').disabled = false;
  };
  draw();
  await N.query({ kinds: [1059], '#p': [me], limit: 500 }, { maxWait: 4000, onEvent: async (w) => {
    try {
      const m = await N.unwrap(S.signer, w);
      if (m.kind !== 14) return;
      const k = key([m.pubkey, ...m.tags.filter((t) => t[0] === 'p').map((t) => t[1])]);
      if (S.role === 'learner' && k !== key(defaultRoom)) return; // learners only ever see their family room
      const r = rooms.get(k) || { msgs: [], last: 0, flag: false };
      if (r.msgs.some((x) => x.id === m.id)) return;
      r.msgs.push(m); r.last = Math.max(r.last, m.created_at); r.flag ||= m.tags.some((t) => t[0] === 'c21');
      rooms.set(k, r); if (!current) current = k; draw();
    } catch {}
  } });
  draw();
}

// ---------- parents ----------
async function familyView() {
  if (S.role !== 'parent') return (location.hash = '#/home');
  const kids = S.settings.children || [];
  view(`<section class="wrap pad"><div class="eyebrow">Family</div><h1>Your learners</h1>
    <p class="lead">Progress is encrypted by each learner's app for you alone (NIP-44). Kieran only sees it if you allowed mentor sharing.</p>
    <div id="kids">${kids.length ? '<div class="loader"><span></span><span></span><span></span></div>' : '<div class="card muted">No learners yet. Add one below.</div>'}</div>
    <div class="card mt"><h2>Add a learner</h2><p class="muted">We'll make a new Nostr key for your learner, locked with a password you choose. Use a fun nickname, not their real name.</p>
      <div class="grid g4"><div><label>Nickname</label><input id="cn" value="${nickname()}"></div><div><label>Age</label><input id="ca" type="number" min="5" max="21"></div>
      <div><label>Password for your learner</label><input id="cp" type="password" minlength="6" placeholder="At least 6 characters"></div><div><label>&nbsp;</label><button class="btn" id="cadd">Create learner login</button></div></div>
      <label class="check"><input type="checkbox" id="cpub"> Allow a public portfolio on Nostr (repositories and devlogs anyone can see). You can change this later.</label>
      <label class="check"><input type="checkbox" id="cmen" checked> Share progress with Kieran (mentor) so he can help</label></div></section>`);
  $('#cadd').onclick = async () => {
    const name = $('#cn').value.trim(), pw = $('#cp').value;
    if (!name || pw.length < 6) return toast('Add a nickname and a password of at least 6 characters', true);
    const bad = safetyCheck(name); if (bad) return toast(bad, true);
    $('#cadd').disabled = true; $('#cadd').textContent = 'Creating…';
    try {
      const { ncryptsec } = await createLearner({ name, age: $('#ca').value, password: pw, publicPortfolio: $('#cpub').checked, shareMentor: $('#cmen').checked });
      await loginCard(name, ncryptsec);
      familyView();
    } catch (e) { toast(e.message, true); $('#cadd').disabled = false; $('#cadd').textContent = 'Create learner login'; }
  };
  if (!kids.length) return;
  const cards = await Promise.all(kids.map(async (k) => {
    const d = await N.readShare(S.signer, k.pubkey);
    const done = d ? Object.keys(d.done || {}) : [];
    const byProg = PROGRAMS.map((p) => ({ p, n: p.lessons.filter((l) => d?.done?.[l.id]).length })).filter((x) => x.n);
    const recent = done.sort((a, b) => d.done[b] - d.done[a]).slice(0, 5).map(lessonById).filter(Boolean);
    return `<div class="card kidcard reveal"><div class="row between"><div class="row">${avatar(k.pubkey, 56)}<div><h2>${esc(k.name)}</h2><p class="muted small">${d ? 'Updated ' + fmtWhen(d._updated) : 'No progress shared yet. Log in as your learner once to start.'}</p></div></div>
      <div class="row"><a class="btn small ghost" href="#/u/${N.npub(k.pubkey)}">Portfolio</a><button class="btn small ghost" data-login="${k.pubkey}">Login code</button><button class="btn small ghost" data-manage="${k.pubkey}">Manage</button></div></div>
      ${d ? `<div class="grid g3 mt"><div><div class="ring" style="--p:${Math.round((done.length / ALL_LESSONS.length) * 100)}"><span>${done.length}<small>/${ALL_LESSONS.length}</small></span></div><p class="center small muted">lessons done</p></div>
        <div><h3>Project</h3><p><b>${esc(d.project?.title || 'Not named yet')}</b></p><div class="stages">${STAGES.map(([id, l]) => `<span class="stage ${d.project?.stage === id ? 'on' : ''}">${l}</span>`).join('')}</div><p class="small muted mt">Next: ${esc(d.project?.next || '-')}</p></div>
        <div><h3>By program</h3>${byProg.map(({ p, n }) => `<div class="bar"><span>${p.icon} ${esc(p.title)}</span><i style="--w:${(n / p.lessons.length) * 100}%;--c:${p.colour}"></i></div>`).join('') || '<p class="muted small">Nothing yet.</p>'}</div></div>
        ${recent.length ? `<h3 class="mt">Recent lessons and notes</h3>${recent.map((l) => `<div class="note"><b>✓ ${esc(l.title)}</b> <span class="muted small">${fmtDate(d.done[l.id])}</span>${d.notes?.[l.id] ? `<p>${esc(d.notes[l.id])}</p>` : ''}</div>`).join('')}` : ''}
        ${(d.drafts || []).length ? `<h3 class="mt">Draft repositories (private)</h3>${d.drafts.map((x) => `<span class="pill soft">${esc(x.slug)}</span>`).join(' ')}` : ''}
        ${(d.calendar || []).length ? `<h3 class="mt">Their weekly blocks</h3>${d.calendar.map((b) => `<span class="pill soft">${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][b.day]} ${b.start} ${esc(b.title)}</span>`).join(' ')}` : ''}
        <div class="row mt"><button class="btn small ghost" data-csv="${k.pubkey}">Download learning record (CSV)</button></div>` : ''}</div>`;
  }));
  $('#kids').innerHTML = cards.join('');
  animateIn($('#kids'));
  $('#kids').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = kids.find((x) => x.pubkey === (b.dataset.login || b.dataset.manage || b.dataset.csv));
    if (b.dataset.login) return loginCard(k.name, k.ncryptsec);
    if (b.dataset.csv) {
      const d = await N.readShare(S.signer, k.pubkey);
      const rows = [['Date', 'Program', 'Lesson', 'Learning areas', 'Notes']];
      Object.entries(d?.done || {}).sort((a, x) => a[1] - x[1]).forEach(([id, ts]) => { const l = lessonById(id); const p = l && programById(l.program); if (l) rows.push([fmtDate(ts), p.title, l.title, p.areas.join('; '), d.notes?.[id] || '']); });
      return download(`learning-record-${k.name}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    }
    if (b.dataset.manage) {
      const res = await modal(`<h3>Manage ${esc(k.name)}</h3><p class="muted">Enter ${esc(k.name)}'s current password to change their settings.</p>
        <form id="f"><input id="op" type="password" placeholder="Current learner password" required>
        <label class="check"><input type="checkbox" id="mp" ${k.publicPortfolio ? 'checked' : ''}> Public portfolio on Nostr</label>
        <label class="check"><input type="checkbox" id="mm" ${k.shareMentor ? 'checked' : ''}> Share progress with Kieran</label>
        <input id="np" type="password" placeholder="New password (optional)" class="mt"><div class="row mt"><button class="btn">Save</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
      { onMount: (m, close) => { $('#f', m).onsubmit = (ev) => { ev.preventDefault(); close({ op: $('#op', m).value, publicPortfolio: $('#mp', m).checked, shareMentor: $('#mm', m).checked, np: $('#np', m).value }); }; } });
      if (!res) return;
      try { await updateLearnerSettings(k, res.op, { publicPortfolio: res.publicPortfolio, shareMentor: res.shareMentor }, res.np || null); toast('Saved ✓'); familyView(); }
      catch { toast('That password didn\'t unlock the learner key', true); }
    }
  };
}

function loginCard(name, ncryptsec) {
  const link = `${location.origin}${location.pathname}#/login?k=${ncryptsec}`;
  return modal(`<h3>${esc(name)}'s login</h3><p>On your learner's device, scan this or open the link, then type the password you chose. The code is encrypted, so it's useless without the password.</p>
    <div class="qr big">${qr(link, 3)}</div><p class="mono small break keybox">${esc(ncryptsec)}</p>
    <div class="row mt"><button class="btn" id="cl">Copy login link</button><button class="btn ghost" id="dl">Download backup</button><button class="btn ghost" data-close>Done</button></div>`,
  { onMount: (m) => { $('#cl', m).onclick = () => navigator.clipboard.writeText(link).then(() => toast('Link copied')); $('#dl', m).onclick = () => download(`c21-${name}-login.txt`, `C21 Online login for ${name}\n\nLogin link: ${link}\n\nEncrypted key (NIP-49): ${ncryptsec}\n\nYou also need the password you chose.\n`); } });
}

// ---------- staff studio ----------
async function studioView() {
  if (S.role !== 'staff') return (location.hash = '#/home');
  const monday = mondayOf(new Date(Date.now() + 3 * 86400000));
  view(`<section class="wrap pad"><div class="eyebrow">Studio</div><h1>Mentor studio</h1>
    <div class="grid g2 mt">
      <div class="card"><h2>📹 Post the weekly video</h2><p class="muted small">Published as a NIP-71 video event to every relay. Upload goes to a Blossom server.</p>
        <label>Title</label><input id="vt" placeholder="Week 12: keys, wallets and your first sats">
        <label>Upload video</label><input id="vf" type="file" accept="video/*">
        <label>…or a link (YouTube, mp4, PeerTube)</label><input id="vu" placeholder="https://">
        <label>Notes for families</label><textarea id="vn"></textarea>
        <button class="btn mt" id="vpost">Publish to Nostr</button><p class="muted small" id="vs"></p></div>
      <div class="card"><h2>🗓️ Publish the C21 week</h2><p class="muted small">Creates NIP-52 calendar events in ${SITE.timezone} time and updates the C21 calendar everyone sees.</p>
        <label>Week starting (Monday)</label><input id="wk" type="date" value="${ymd(monday)}">
        <div id="blocks">${DEFAULT_WEEK.map((b, i) => blockRow(b, i)).join('')}</div>
        <div class="row mt"><button class="btn ghost small" id="addb">+ Add session</button><button class="btn" id="wpub">Publish week</button></div></div>
    </div>
    <div class="card mt"><h2>🌐 Publish this site to Nostr</h2><p class="muted">C21 Online is hosted on Nostr itself (NIP-5A nsite). This copies every file of the site you're looking at to Blossom servers and signs a site manifest with your key, so it lives on relays under your npub.</p>
      <div class="row"><button class="btn" id="sitepub">Publish site update</button><a class="btn ghost" id="siteurl" target="_blank" rel="noopener" href="${N.nsiteUrl(S.signer.pubkey, 'c21')}">Open my nsite</a></div><p class="muted small mono break" id="sitestatus">${N.nsiteUrl(S.signer.pubkey, 'c21')}</p></div>
    <div class="card mt"><h2>🧑‍🎓 Learners sharing progress with you</h2><div id="roster"><div class="loader"><span></span><span></span><span></span></div></div></div></section>`);
  function blockRow(b, i) {
    return `<div class="brow" data-i="${i}"><select class="bday">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, j) => `<option value="${j + 1}" ${b.day === j + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <input class="bst" type="time" value="${b.start}"><input class="ben" type="time" value="${b.end}"><input class="btt" value="${esc(b.title)}"><select class="bty">${Object.keys(TYPE_COLOUR).filter((t) => t !== 'mine').map((t) => `<option ${b.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="x">×</button></div>`;
  }
  $('#blocks').onclick = (e) => { if (e.target.classList.contains('x')) e.target.parentElement.remove(); };
  $('#addb').onclick = () => $('#blocks').insertAdjacentHTML('beforeend', blockRow({ day: 2, start: '16:00', end: '17:00', title: 'Live session', type: 'live' }, Date.now()));
  $('#wpub').onclick = async () => {
    const blocks = $$('.brow').map((r) => ({ day: Number($('.bday', r).value), start: $('.bst', r).value, end: $('.ben', r).value, title: $('.btt', r).value, type: $('.bty', r).value }));
    const [y, m, d] = $('#wk').value.split('-').map(Number);
    $('#wpub').disabled = true; $('#wpub').textContent = 'Publishing…';
    try { await publishWeek(new Date(y, m - 1, d), blocks); toast('C21 week published ✓'); } catch (e) { toast(e.message, true); }
    $('#wpub').disabled = false; $('#wpub').textContent = 'Publish week';
  };
  $('#vpost').onclick = async () => {
    const title = $('#vt').value.trim(); if (!title) return toast('Add a title', true);
    try {
      let media = null; const f = $('#vf').files[0]; const link = $('#vu').value.trim();
      if (f) media = await N.blossomUpload(S.signer, f, (s) => ($('#vs').textContent = s));
      if (!media && !link) return toast('Upload a video or paste a link', true);
      $('#vs').textContent = 'Publishing…';
      const tags = [['title', title], ['published_at', String(N.now())], ['t', 'c21-weekly'], ['t', 'c21'], ['alt', `C21 weekly video: ${title}`]];
      if (media) tags.push(['imeta', `url ${media.url}`, `m ${media.type}`, `x ${media.sha256}`, `size ${media.size}`]);
      else tags.push(['imeta', `url ${link}`], ['r', link]);
      await N.publish(S.signer, { kind: 21, content: $('#vn').value, tags });
      $('#vs').textContent = ''; toast('Weekly video published to Nostr ✓');
    } catch (e) { $('#vs').textContent = ''; toast(e.message, true); }
  };
  $('#sitepub').onclick = async () => {
    const st = $('#sitestatus'); const btn = $('#sitepub'); btn.disabled = true;
    try {
      const files = [['/index.html', 'text/html'], ['/assets/app.js', 'text/javascript']];
      const tags = [['d', 'c21']];
      const servers = new Set();
      for (const [path, type] of files) {
        st.textContent = `Uploading ${path}…`;
        const buf = await fetch(new URL('.' + path, location.href.split('#')[0])).then((r) => { if (!r.ok) throw new Error('Could not read ' + path); return r.arrayBuffer(); });
        const up = await N.blossomMirror(S.signer, buf, type);
        up.servers.forEach((x) => servers.add(x));
        tags.push(['path', path, up.hash]);
      }
      servers.forEach((x) => tags.push(['server', x]));
      tags.push(['title', 'C21 Online'], ['description', SITE.tagline]);
      st.textContent = 'Signing the site manifest…';
      await N.publish(S.signer, { kind: 35128, content: '', tags });
      st.textContent = 'Published ✓ ' + N.nsiteUrl(S.signer.pubkey, 'c21');
      toast('Site published to Nostr ✓');
    } catch (e) { st.textContent = e.message; toast(e.message, true); }
    btn.disabled = false;
  };
  // Roster from enrolment messages, then each learner's shared progress.
  const learners = new Map();
  await N.query({ kinds: [1059], '#p': [S.signer.pubkey], limit: 500 }, { maxWait: 4000, onEvent: async (w) => {
    try { const m = await N.unwrap(S.signer, w); if (m.tags.some((t) => t[0] === 'c21' && t[1] === 'enrol')) learners.set(m.pubkey, m); } catch {}
  } });
  await new Promise((r) => setTimeout(r, 400));
  if (!$('#roster')) return;
  const rows = await Promise.all([...learners.keys()].map(async (pk) => {
    const d = await N.readShare(S.signer, pk);
    return `<tr><td>${avatar(pk, 28)}</td><td><b>${esc(d?.name || '')}</b><br><a class="small" href="#/u/${N.npub(pk)}">portfolio</a></td><td>${d ? Object.keys(d.done || {}).length : '-'}</td><td>${esc(d?.project?.title || '-')} <span class="pill soft">${esc(d?.project?.stage || '')}</span></td><td class="small muted">${d ? fmtWhen(d._updated) : 'not shared'}</td></tr>`;
  }));
  $('#roster').innerHTML = rows.length ? `<table><tr><th></th><th>Learner</th><th>Lessons</th><th>Project</th><th>Updated</th></tr>${rows.join('')}</table>` : '<p class="muted">No learners have enrolled with mentor sharing yet.</p>';
}

// ---------- account ----------
function accountView() {
  const pk = S.signer.pubkey;
  view(`<section class="wrap pad narrow"><h1>Account</h1><div class="card"><div class="row">${avatar(pk, 64)}<div><h2>${esc(S.settings?.name || (S.role === 'staff' ? 'Kieran' : ''))}</h2><p class="muted">${S.role} · signed in with ${S.signer.type === 'nip07' ? 'browser extension' : S.signer.type === 'nip46' ? 'remote signer' : 'password-locked key'}</p></div></div>
    <p class="mono small break mt">${N.npub(pk)}</p>
    <div class="row mt"><a class="btn ghost" href="#/u/${N.npub(pk)}">My public profile</a>${S.signer.type === 'local' ? '<button class="btn ghost" id="bk">Download key backup</button>' : ''}<button class="btn" id="out">Log out</button></div></div>
    <div class="card mt"><h3>Relays</h3><p class="muted small">C21 reads and writes to: ${RELAYS.map(esc).join(', ')}</p></div></section>`);
  if ($('#bk')) $('#bk').onclick = () => download('c21-key-backup.txt', `C21 Online encrypted key (NIP-49)\n\n${savedNcryptsec()}\n\nYou need your password to use it.\n`);
  $('#out').onclick = () => { if (S.signer.type === 'local' && !confirm('Log out? Make sure you have your key backup and password.')) return; logout(); renderNav(); location.hash = '#/'; };
}

// ---------- boot ----------
(async () => {
  renderNav();
  if (localStorage.getItem('c21_login')) {
    const ok = await restoreSession(() => askPassword());
    if (ok) { try { await loadAccount(); } catch (e) { console.warn(e); } }
  }
  renderNav();
  route();
})();
