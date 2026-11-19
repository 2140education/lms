// C21 Online: app shell, router and views.
import * as N from './nostr.js';
import { S, restoreSession, loginLocal, loginExtension, loginBunker, createLocalAccount, logout, savedNcryptsec, loadAccount, saveSettings, saveLearner,
  createLearner, updateLearnerSettings, acceptFamilyLinks, myLearners, learnerAccess, circleRumors, portfolioFrom, commit, makeDoc, MAIN_REPO, myCircle,
  weeklyVideos, videoInfo, c21Calendar, defaultWeekEvents, schoolWeek, weeklyBlocks, privateEvents, savePrivateEvent, cancelPrivateEvent, publishWeek } from './store.js';
import { PROGRAMS, ALL_LESSONS, lessonById, programById, DEFAULT_WEEK } from './lessons.js';
import { PLANS, SITE, RELAYS } from './config.js';
import { $, $$, esc, linkify, fmtDate, fmtWhen, toast, avatar, qr, safetyCheck, nickname, icsFile, download, animateIn, typeLines, mondayOf, ymd,
  timetable, wireTimetable, TT_COLOURS, TT_LABELS } from './ui.js';
import { view, loading, modal, askPassword, formModal } from './shell.js';
import { profileView, portfoliosView, demoView, DEMOS, demoModel, learnerRow } from './portfolio.js';
import { formsView, interestForm, renderForm, formsToDo } from './forms.js';
import { audToSats, requestInvoice } from './pay.js';

const STAGES = [['discover', 'Discover'], ['design', 'Design'], ['build', 'Build'], ['launch', 'Launch']];
const TYPE_COLOUR = { explore: '#3aa65a', core: '#2f6fde', pbl: '#1fa6a0', sip: '#f2c230', community: '#e0533d', fit: '#7a5cd6', live: '#f7931a', mine: '#9fb6c8' };
const ytEmbed = (url) => { const m = url?.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/); return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null; };
const isGuide = () => S.role === 'guide' || S.role === 'staff';

function videoHtml(info) {
  if (!info.url) return '';
  const yt = ytEmbed(info.url);
  return yt ? `<div class="video"><iframe src="${yt}" allowfullscreen loading="lazy" title="${esc(info.title)}"></iframe></div>`
    : `<div class="video"><video controls preload="metadata" src="${esc(info.url)}"></video></div>`;
}

// ---------- nav ----------
function renderNav() {
  const r = S.role;
  const links = !S.signer ? [['#/lessons', 'Lessons'], ['#/#week', 'The week'], ['#/#portfolio', 'Portfolios'], ['#/pay', 'Plans'], ['#/#safety', 'Safety']]
    : [['#/home', 'Home'], ['#/lessons', 'Lessons'], ['#/calendar', 'Calendar'], [r === 'learner' ? '#/me' : '#/portfolios', r === 'learner' ? 'Portfolio' : 'Portfolios'], ['#/forms', 'Forms'], ['#/messages', 'Messages'],
      ...(r === 'parent' ? [['#/family', 'Family']] : []), ...(isGuide() ? [['#/learners', 'Learners']] : []), ...(r === 'staff' ? [['#/studio', 'Studio']] : []), ['#/pay', 'Plans']];
  $('#nav').innerHTML = links.map(([h, l]) => `<a href="${h}" class="${location.hash.startsWith(h) && h !== '#/' ? 'on' : ''}">${l}</a>`).join('');
  $('#navcta').innerHTML = S.signer ? `<a href="#/account" class="me">${avatar(S.signer.pubkey, 30)}<span>${esc(S.settings?.name || (r === 'staff' ? 'Kieran' : 'Account'))}</span></a>`
    : `<a class="btn small" href="#/login">Log in</a>`;
}
$('#burger').onclick = () => document.body.classList.toggle('navopen');

// ---------- router ----------
const routes = {
  '': landing, lessons: lessonsView, lesson: lessonView, u: profileView, demo: demoView, pay: payView, login: loginView,
  home: needLogin(homeView), calendar: needLogin(calendarView), me: needLogin(() => profileView(N.npub(S.signer.pubkey))), portfolios: needLogin(portfoliosView),
  forms: (sub, ...a) => (sub === 'fill' ? formsView(sub, ...a) : needLogin(formsView)(sub, ...a)), // public forms can be filled without logging in
  messages: needLogin(messagesView), family: needLogin(familyView), learners: needLogin(learnersView), studio: needLogin(studioView), account: needLogin(accountView), welcome: needLogin(onboardView),
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
        <p class="lead">C21 Online brings the Consensus21 week to home educators everywhere. Real projects, guides instead of teachers, a calendar you run yourself, and a git portfolio on Nostr, encrypted so only you, your parents and your guide can read it.</p>
        <div class="row mt"><a class="btn" href="#/login">Start your learning journey</a><a class="btn ghost" href="#/#portfolio">See a portfolio</a></div>
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
      ${[['🗳️', 'Student voice', 'Learners write School Improvement Proposals (SIPs) and bring them to the council. Your ideas change the rules.'],
         ['🔑', 'You own your keys', 'Your login is a Nostr key pair. Parents make one for each child. Your work is encrypted on public relays, not in a company database.'],
         ['🤝', 'Guides, not teachers', 'Every learner has a guide. Roles are fluid: everyone is a learner and a mentor at different stages.']]
        .map(([i, t, d], k) => `<div class="card lift reveal" style="--delay:${k * 0.1}s"><div class="icon">${i}</div><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
    </div>
  </section>

  <section class="band" id="week"><div class="wrap pad">
    <div class="eyebrow reveal">The week</div>
    <h2 class="reveal">A week at Consensus21</h2>
    <p class="lead reveal">Published by Kieran on Nostr (NIP-52) and shown in your own time zone. Each learner adds their own private blocks on top.</p>
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
      <div class="steps">${['A parent makes your Nostr key pair and locks it with a password.', 'Your parent picks your guide. That is your circle.', 'Plan your week. The C21 calendar drops into yours.', 'Pick a project and a program. Lessons walk you through it.', 'git init your private portfolio on Nostr.', 'Log each Explorers Day and commit a reflection every Friday.', 'Bring a SIP to Thursday discussion.']
        .map((s, i) => `<div class="step reveal" style="--delay:${i * 0.06}s"><b>${String(i + 1).padStart(2, '0')}</b><span>${s}</span></div>`).join('')}</div>
      <div class="terminal reveal"><div class="tbar"><i></i><i></i><i></i><span>~/my-c21</span></div><pre id="term"></pre></div>
    </div>
  </section>

  <section class="band pfp-band" id="portfolio"><div class="wrap pf-intro">
    <div>
      <div class="eyebrow reveal">Learner profiles</div>
      <h2 class="h2 reveal">Your profile is your report card</h2>
      <p class="lede reveal">Every learner gets a profile built from their own git history on Nostr: pinned projects, a contribution graph, core program progress, Explorers Days, reflections and SIPs. Nothing to fill in twice. Just commit. And it's encrypted, so only the learner, their parents and their guide can open it.</p>
      <ul class="reveal">
        <li>Pinned projects straight from your private repositories</li>
        <li>A year of commits as a learning heatmap</li>
        <li>Your week, your SIPs, your Explorers Days</li>
        <li>Sealed with NIP-59 gift wraps for your circle only</li>
      </ul>
      <form class="lookup reveal" id="lookup">
        <input id="lookupU" placeholder="Learner npub1…" autocomplete="off" spellcheck="false" aria-label="Learner npub">
        <button class="btn" type="submit">View profile</button>
      </form>
      <p class="muted reveal small" style="margin-top:10px">Only works if you're in that learner's circle. Or browse the <a href="#/demo">example learners</a>.</p>
    </div>
    <div class="roster reveal" id="roster" aria-label="Example learners">${DEMOS.map((d) => { const m = demoModel(d, []); return learnerRow(`#/demo/${d.id}`, d.pk, d.name, d.age, d.tag, m.counts, d.colour); }).join('')}</div>
  </div></section>

  <section class="wrap pad" id="lessons">
    <div class="eyebrow reveal">Lessons</div>
    <h2 class="reveal">Everything Kieran runs in person, now online</h2>
    <div class="grid g3 mt">${PROGRAMS.map((p, i) => programCard(p, i)).join('')}</div>
  </section>

  <section class="band" id="protocol"><div class="wrap pad">
    <div class="eyebrow reveal">How it works</div>
    <h2 class="reveal">Built on Nostr, encrypted end to end</h2>
    <div class="flow mt reveal">
      <div class="node">👨‍👩‍👧 Parents<small>own a key pair, create one for each child, pick the guide</small></div><div class="arrow">⇄</div>
      <div class="node hub">🔐 ${RELAYS.length} public relays<small>only ciphertext: NIP-44 data, NIP-59 gift wraps, NIP-49 locked keys</small></div><div class="arrow">⇄</div>
      <div class="node">🧑‍💻 Learners<small>lessons, private calendar (NIP-52), private git portfolio (NIP-34)</small></div><div class="arrow">⇄</div>
      <div class="node">🧭 Guides<small>see their learners' circle, give feedback, add calendar events</small></div>
    </div>
    <p class="muted mt reveal">No database, no server. The site is static files. Everything else is Nostr. Payments go over Nostr too, with CLINK Lightning offers.</p>
  </div></section>

  <section class="wrap pad" id="safety">
    <div class="eyebrow reveal">Safety</div>
    <h2 class="reveal">Built for kids first</h2>
    <div class="grid g3 mt">${[
      ['Parents create every learner key', 'Learner keys are made in a parent\'s browser (or linked from a key they already have) and locked with a password the parent sets. Parents keep a backup.'],
      ['Everything personal is encrypted', 'Progress, notes, calendars and portfolios are encrypted before they leave the device. Relays only store ciphertext.'],
      ['A circle of three', 'Each learner\'s circle is the learner, their parents and their guide. Nobody else can read their work or message them.'],
      ['Nothing public about a child', 'Learners have no public profile at all. No names, no photos, no follower counts. Just a generated cube avatar.'],
      ['Metadata stays private too', 'Gift wraps hide who wrote what and when. A relay can\'t even tell a portfolio commit from a chat message.'],
      ['Open and auditable', 'Every line of this site is open source. Anyone can check what it does.']]
      .map(([t, d], i) => `<div class="card reveal" style="--delay:${i * 0.05}s"><h3>✓ ${t}</h3><p class="muted">${d}</p></div>`).join('')}</div>
  </section>

  <section class="band" id="plans"><div class="wrap pad">
    <div class="eyebrow reveal">Plans</div><h2 class="reveal">Lessons are free. Guiding is paid.</h2>
    <p class="lead reveal">Every lesson is open to everyone. Plans add a guide, live sessions and the in-person Holiday Studio. Pay in sats over Nostr. 10% of every fee is set aside for the learner's 18th birthday, as the white paper describes.</p>
    <div class="grid g4 mt">${PLANS.map((p, i) => planCard(p, i)).join('')}</div>
  </div></section>

  <section class="wrap pad narrow" id="register" hidden>
    <div class="eyebrow">Register interest</div><h2>Want in?</h2>
    <p class="lead">Built with Formstr. Your answers are encrypted in your browser to Kieran's form key before they're sent. Nobody else can read them.</p>
    <div class="card mt" id="interest"></div>
  </section>`);

  interestForm().then((f) => { const box = $('#interest'); if (!f || !box) return; $('#register').hidden = false; renderForm(box, f, { compact: true }); }).catch(() => {});
  typeLines($('#term'), ['$ c21 login', '✓ key unlocked (NIP-49)', '$ c21 calendar import --week', '✓ 9 sessions added, shown in your time zone', '$ git init my-c21', '✓ repo sealed for you, 2 parents and your guide (NIP-59)', '$ c21 reflect --friday', '✓ commit 3f9a1c2 encrypted, relays see only ciphertext', '$ c21 sip new "Minecraft build night"', '✓ see you Thursday']);
  $('#lookup').onsubmit = (e) => { e.preventDefault(); const v = $('#lookupU').value.trim(); if (!v.startsWith('npub1')) return toast('Paste a learner npub (starts with npub1)', true); location.hash = '#/u/' + v; };

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
  const all = [...schoolWeek(events, monday), ...mine].filter((e) => e.start * 1000 >= monday.getTime() && e.start * 1000 < monday.getTime() + 7 * 86400000);
  const shown = all.length ? all : defaultWeekEvents(monday);
  el.innerHTML = days.slice(0, 5).concat(days.slice(5).filter((d) => shown.some((e) => new Date(e.start * 1000).toDateString() === d.toDateString())))
    .map((d) => {
      const evs = shown.filter((e) => new Date(e.start * 1000).toDateString() === d.toDateString()).sort((a, b) => a.start - b.start);
      return `<div class="day reveal in"><h4>${d.toLocaleDateString(undefined, { weekday: 'long' })}<small>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></h4>
        ${evs.map((e) => `<div class="blk" style="--c:${TYPE_COLOUR[e.type] || TT_COLOURS[e.type] || '#2f6fde'}"><div class="t">${new Date(e.start * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${e.end ? ' to ' + new Date(e.end * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</div><div class="n">${e.private ? '🔒 ' : ''}${esc(e.title)}</div>${e.mine ? '<span class="mine">mine</span>' : ''}</div>`).join('') || '<p class="muted small">Free day</p>'}</div>`;
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
      <div class="lesson-list mt">${p.lessons.map((l, i) => `<a class="lrow-l reveal" href="#/lesson/${l.id}" style="--delay:${i * 0.05}s"><span class="num ${done[l.id] ? 'done' : ''}">${done[l.id] ? '✓' : i + 1}</span><span><b>${esc(l.title)}</b><small class="muted">${esc(l.goal)}</small></span><span class="pill">${esc(l.time)}</span></a>`).join('')}</div>
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
      <div class="card reveal"><h3>Commit to your portfolio</h3><p>${esc(l.commit)}</p><p class="muted small">Your notes are committed to <code>lessons/${esc(id)}.md</code> in your private portfolio when you mark the lesson done.</p></div>
    </div>
    <h2 class="mt">Steps</h2>
    <ol class="steps-list">${l.steps.map((s, i) => `<li class="reveal" style="--delay:${i * 0.06}s"><span>${i + 1}</span><p>${esc(s)}</p></li>`).join('')}</ol>
    ${isLearner ? `<div class="card mt"><h3>My notes</h3><textarea id="note" placeholder="What did you try? What happened? (Only you, your parents and your guide can read this.)">${esc(S.learner.notes?.[id] || '')}</textarea>
      <label class="check"><input type="checkbox" id="tocommit" checked> Also commit my notes to my portfolio</label>
      <div class="row mt"><button class="btn" id="done">${done ? '✓ Done. Update notes' : 'Mark as done'}</button>${next ? `<a class="btn ghost" href="#/lesson/${next.id}">Next lesson →</a>` : ''}</div></div>`
    : `<div class="card mt"><p>${S.signer ? 'Parents and guides: your learner tracks progress from their own login.' : '<a href="#/login">Log in</a> to track progress, keep notes and share them with your parents and guide.'}</p>${next ? `<a class="btn ghost mt" href="#/lesson/${next.id}">Next lesson →</a>` : ''}</div>`}
  </section>`);
  if (isLearner) $('#done').onclick = async () => {
    const note = $('#note').value;
    S.learner.notes = { ...S.learner.notes, [id]: note };
    S.learner.done = { ...S.learner.done, [id]: N.now() };
    saveLearner();
    if ($('#tocommit').checked) {
      try {
        const access = await learnerAccess(S.signer.pubkey);
        const pf = portfolioFrom(access, await circleRumors(access));
        await commit(access, pf, MAIN_REPO, `Lesson: ${l.title}`, [{ path: `lessons/${id}.md`, content: makeDoc({ title: l.title, date: ymd(new Date()), program: p.title }, note || '_Done._') }]);
      } catch (e) { toast(e.message, true); }
    }
    toast('Saved and encrypted for your circle ✓');
    if (next) location.hash = '#/lesson/' + next.id; else lessonView(id);
  };
}

// ---------- payments ----------
async function payView() {
  const sel = Q.get('plan') || 'studio';
  const kids = S.settings?.children || [];
  view(`<section class="wrap pad"><div class="eyebrow">Plans</div><h1>Pay in sats, over Nostr</h1>
    <p class="lead">Lessons are free for everyone. Plans add a guide, live sessions and the in-person Holiday Studio. Payments use a CLINK offer: your wallet gets a Lightning invoice straight from Kieran's node over Nostr.</p>
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
  view(`<section class="wrap pad narrow"><div class="eyebrow">Log in</div><h1>Your Nostr key is your login</h1>
    <p class="lead">C21 uses Nostr key pairs (<a href="https://github.com/nostr-protocol/nips" target="_blank" rel="noopener">NIPs</a>) instead of passwords stored on a server. Your secret key never leaves your device or signer.</p>
    ${k || saved ? `<div class="card glow mt"><h3>🧑‍💻 Learner login</h3><p class="muted">Your parent gave you a login code. Enter the password they set.</p>
      <input id="lk" class="mono small" value="${esc(k || saved || '')}" placeholder="ncryptsec1…"><input id="lp" type="password" placeholder="Password" class="mt"><button class="btn mt" id="llogin">Log in</button></div>` : ''}
    <div class="grid g3 mt">
      <div class="card lift"><div class="icon">🧩</div><h3>Browser extension</h3><p class="muted small">Alby, nos2x, Nostash or similar (NIP-07). Best for parents and guides.</p><button class="btn" id="ext">Connect extension</button></div>
      <div class="card lift"><div class="icon">📱</div><h3>Remote signer</h3><p class="muted small">Amber, nsec.app or any NIP-46 bunker. Your key stays on your phone.</p><input id="bunker" placeholder="bunker://… or name@domain" class="small"><button class="btn mt" id="bk">Connect</button></div>
      <div class="card lift"><div class="icon">🔐</div><h3>Password-locked key</h3><p class="muted small">A key on this device, encrypted with your password (NIP-49).</p>
        <button class="btn" id="newacct">Create a new key pair</button><details class="mt"><summary class="small">I have an nsec or ncryptsec</summary><input id="imp" class="mono small" placeholder="nsec1… or ncryptsec1…"><input id="imppw" type="password" placeholder="Password" class="mt small"><button class="btn ghost mt" id="impgo">Import</button></details></div>
    </div>
    <p class="muted small mt">Learners don't sign up here. A parent creates (or links) each learner's key pair from the Family page.</p></section>`);
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
    <div class="grid g3 mt"><button class="card lift choose" data-r="parent"><div class="icon">👨‍👩‍👧</div><h3>I'm a parent or guardian</h3><p class="muted">Create key pairs for your learners, choose their guide, see their encrypted portfolio and calendar.</p></button>
    <button class="card lift choose" data-r="guide"><div class="icon">🧭</div><h3>I'm a guide</h3><p class="muted">Mentor learners whose parents choose you. Give feedback, add 1:1s to their calendar.</p></button>
    <div class="card"><div class="icon">🧑‍💻</div><h3>I'm a learner</h3><p class="muted">Ask your parent to create your login from their Family page. They'll give you a login code and password.</p></div></div>
    <label class="mt">Your display name (shown to your circle)</label><input id="nm" placeholder="e.g. Sam (parent)">
    <p class="muted small mt">Your npub, to share with parents who want you as their guide: <span class="mono break">${N.npub(S.signer.pubkey)}</span></p></section>`);
  $$('.choose').forEach((b) => b.onclick = async () => {
    try {
      const role = b.dataset.r;
      await saveSettings({ role, name: $('#nm').value.trim() || (role === 'guide' ? 'Guide' : 'Parent'), children: [] });
      S.role = role; renderNav(); location.hash = role === 'parent' ? '#/family' : '#/learners';
    } catch (e) { toast(e.message, true); }
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
  let mine = [];
  if (r === 'learner') {
    const done = Object.keys(S.learner.done || {}).length;
    const nextL = ALL_LESSONS.find((l) => !S.learner.done?.[l.id]);
    side.innerHTML = `<h3>Your progress</h3><div class="ring" style="--p:${Math.round((done / ALL_LESSONS.length) * 100)}"><span>${done}<small>/${ALL_LESSONS.length}</small></span></div>
      ${nextL ? `<p>Up next: <a href="#/lesson/${nextL.id}">${esc(nextL.title)}</a></p>` : '<p>You finished every lesson! 🎉</p>'}
      <h3 class="mt">My project</h3><input id="pt" value="${esc(S.learner.project.title)}" placeholder="Project name">
      <div class="stages mt">${STAGES.map(([id, l]) => `<button class="stage ${S.learner.project.stage === id ? 'on' : ''}" data-s="${id}">${l}</button>`).join('')}</div>
      <input id="pn" class="mt" value="${esc(S.learner.project.next)}" placeholder="Next milestone"><div class="row mt"><button class="btn" id="psave">Save project</button><a class="btn ghost" href="#/me">My portfolio</a></div>
      <div id="formsdue"></div>`;
    formsToDo().then((n) => { const el = $('#formsdue'); if (el && n) el.innerHTML = `<a class="safe" style="display:block;text-decoration:none" href="#/forms">📝 You have <b>${n}</b> form${n > 1 ? 's' : ''} to fill in →</a>`; }).catch(() => {});
    $$('.stage', side).forEach((b) => b.onclick = () => { $$('.stage', side).forEach((x) => x.classList.remove('on')); b.classList.add('on'); S.learner.project.stage = b.dataset.s; });
    $('#psave').onclick = () => { S.learner.project = { ...S.learner.project, title: $('#pt').value, next: $('#pn').value }; saveLearner(); toast('Project saved and encrypted for your circle ✓'); };
    mine = weeklyBlocks(S.learner);
    learnerAccess(S.signer.pubkey).then(async (a) => { const evs = privateEvents(a, await circleRumors(a)); if ($('#weekgrid')) renderWeek($('#weekgrid'), await c21Calendar(), [...mine, ...evs]); });
  } else if (r === 'parent') {
    const kids = S.settings.children || [];
    side.innerHTML = `<h3>Your learners</h3>${kids.map((k) => `<a class="row kid" href="#/u/${N.npub(k.pubkey)}">${avatar(k.pubkey, 40)}<div><b>${esc(k.name)}</b><div class="muted small">Portfolio and calendar →</div></div></a>`).join('') || '<p class="muted">No learners yet.</p>'}
      <a class="btn mt" href="#/family">${kids.length ? 'Family and keys' : 'Add a learner'}</a>`;
  } else {
    side.innerHTML = `<h3>${r === 'staff' ? 'Mentor tools' : 'Guide tools'}</h3><p class="muted">See the learners whose parents chose you as guide, give feedback on their portfolios and add 1:1s to their calendars.</p><div class="row"><a class="btn" href="#/learners">Your learners</a>${r === 'staff' ? '<a class="btn ghost" href="#/studio">Studio</a>' : ''}</div>`;
  }
  const [vids, events] = await Promise.all([weeklyVideos(), c21Calendar()]);
  if (!$('#vid')) return;
  $('#vid').innerHTML = vids.length ? (() => { const v = videoInfo(vids[0]); return `<h2>${esc(v.title)}</h2>${videoHtml(v)}<p>${linkify(v.notes)}</p>${vids.length > 1 ? `<details><summary class="small">Earlier videos</summary>${vids.slice(1, 8).map((e) => { const x = videoInfo(e); return `<div class="mt"><b>${esc(x.title)}</b> <span class="muted small">${fmtDate(x.at)}</span>${videoHtml(x)}</div>`; }).join('')}</details>` : ''}`; })() : '<p class="muted">No video yet this week.</p>';
  renderWeek($('#weekgrid'), events, mine);
}

// ---------- calendar: the C21 week + the learner's private calendar (NIP-52 in gift wraps) ----------
async function calendarView() {
  loading('Decrypting calendar…');
  // Whose calendar? Learners see their own; parents and guides pick a learner.
  let options = [];
  if (S.role === 'learner') options = [S.signer.pubkey];
  else if (S.role === 'parent') options = (S.settings.children || []).map((c) => c.pubkey);
  else options = (await myLearners()).map((a) => a.pubkey);
  const wanted = Q.get('l') ? N.toHexKey(Q.get('l')) : options[0];
  const access = wanted ? await learnerAccess(wanted) : null;
  const accesses = S.role === 'learner' ? [access] : (await Promise.all(options.map((pk) => learnerAccess(pk)))).filter(Boolean);
  const school = await c21Calendar();
  const offset = Number(Q.get('w') || 0);
  const mode = Q.get('v') || 'week';
  const monday = mondayOf(new Date(Date.now() + offset * 7 * 86400000));
  const rumors = access ? await circleRumors(access) : [];
  const priv = access ? privateEvents(access, rumors) : [];
  const blocksFor = (m) => (access ? weeklyBlocks(access.data, m) : []);
  const weekEvents = [...schoolWeek(school, monday), ...blocksFor(monday), ...priv.filter((e) => e.start * 1000 >= monday.getTime() && e.start * 1000 < monday.getTime() + 7 * 86400000)];
  const me = S.signer.pubkey;
  const qs = (patch) => '#/calendar?' + new URLSearchParams({ ...(access ? { l: N.npub(access.pubkey) } : {}), w: offset, v: mode, ...patch }).toString();
  const upcoming = priv.filter((e) => e.start * 1000 > Date.now() - 86400000).slice(0, 12);

  // month grid
  const monthStart = new Date(monday.getFullYear(), monday.getMonth(), 1);
  const gridStart = mondayOf(monthStart);
  const monthCells = [...Array(42)].map((_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; });
  const monthEvents = (d) => {
    const wk = mondayOf(d);
    return [...schoolWeek(school, wk), ...blocksFor(wk), ...priv].filter((e) => new Date(e.start * 1000).toDateString() === d.toDateString()).sort((a, b) => a.start - b.start);
  };

  view(`<section class="wrap pad"><div class="eyebrow">Calendar</div>
    <div class="row between"><h1>${access ? (access.self ? 'Your calendar' : `${esc(access.name || 'Learner')}'s calendar`) : 'The C21 week'}</h1>
      ${accesses.length > 1 ? `<div class="row">${accesses.map((a) => `<a class="chip ${a.pubkey === access?.pubkey ? 'on' : ''}" href="#/calendar?l=${N.npub(a.pubkey)}">${avatar(a.pubkey, 22)} ${esc(a.name || 'Learner')}</a>`).join('')}</div>` : ''}</div>
    <p class="lead">${access ? `The C21 school week from Kieran (NIP-52), plus 🔒 private events encrypted for ${access.self ? 'you, your parents and your guide' : 'this learner\'s circle'}. Anyone in the circle can add to it.` : S.role === 'parent' ? 'Add a learner on your Family page to give them a private calendar.' : 'No learners in your circle yet.'}</p>
    <div class="cal-bar mt"><div class="row"><a class="btn small ghost" href="${qs({ w: offset - (mode === 'month' ? 4 : 1) })}">←</a><a class="btn small ghost" href="${qs({ w: 0 })}">Today</a><a class="btn small ghost" href="${qs({ w: offset + (mode === 'month' ? 4 : 1) })}">→</a>
      <b class="cal-title">${mode === 'month' ? monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Week of ' + monday.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</b></div>
      <div class="row"><a class="chip ${mode === 'week' ? 'on' : ''}" href="${qs({ v: 'week' })}">Week</a><a class="chip ${mode === 'month' ? 'on' : ''}" href="${qs({ v: 'month' })}">Month</a><button class="btn small ghost" id="ics">Export .ics</button>${access ? '<button class="btn small" id="addev">+ Event</button>' : ''}</div></div>
    ${mode === 'week' ? `<div class="pfp tt-wrap mt" id="tt">${timetable(weekEvents, monday)}</div>
      <div class="tt-legend mt">${Object.entries(TT_LABELS).map(([k, l]) => `<span class="tt-chip" style="--c:${TT_COLOURS[k]}"><i></i>${l}</span>`).join('')}</div>`
    : `<div class="month mt">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="mh">${d}</div>`).join('')}${monthCells.map((d) => { const evs = monthEvents(d); return `<div class="mc ${d.getMonth() !== monthStart.getMonth() ? 'out' : ''} ${d.toDateString() === new Date().toDateString() ? 'today' : ''}"><span class="mdn">${d.getDate()}</span>${evs.slice(0, 4).map((e) => `<button class="mev" style="--c:${TT_COLOURS[e.type] || TYPE_COLOUR[e.type] || '#38bdf8'}" data-ev="${esc(e.id)}">${e.private ? '🔒' : ''}${esc(e.title)}</button>`).join('')}${evs.length > 4 ? `<span class="muted small">+${evs.length - 4} more</span>` : ''}</div>`; }).join('')}</div>`}
    ${access ? `<div class="grid g2 mt">
      <div class="card"><h3>Upcoming private events</h3>${upcoming.map((e) => `<div class="uev"><span class="dot" style="--c:${TT_COLOURS[e.type] || '#94a3b8'}"></span><div><b>🔒 ${esc(e.title)}</b><div class="muted small">${fmtWhen(e.start)}${e.end ? ' to ' + new Date(e.end * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}${e.description ? ' · ' + esc(e.description) : ''}</div></div>${e.by === me || access.self ? `<button class="x" data-del="${esc(e.id)}" title="Remove">×</button>` : ''}</div>`).join('') || '<p class="muted">Nothing booked. Add a 1:1, an excursion or a family event.</p>'}</div>
      ${access.self ? `<div class="card"><h3>Weekly blocks of my own</h3><p class="muted small">These repeat every week.</p><div class="grid g4"><div><label>Day</label><select id="bd">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></div>
        <div><label>Start</label><input id="bs" type="time" value="13:00"></div><div><label>End</label><input id="be" type="time" value="14:00"></div><div><label>What</label><input id="bt" placeholder="Footy, piano…"></div></div>
        <button class="btn mt" id="badd">Add every week</button>
        <div class="mt">${(S.learner.calendar || []).map((b) => `<span class="pill soft">${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][b.day]} ${b.start} ${esc(b.title)} <button class="x" data-id="${b.id}">×</button></span>`).join(' ')}</div></div>`
      : `<div class="card"><h3>Their weekly blocks</h3>${(access.data?.calendar || []).map((b) => `<span class="pill soft">${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][b.day]} ${b.start} ${esc(b.title)}</span>`).join(' ') || '<p class="muted">None yet. Learners add these themselves.</p>'}</div>`}
    </div>` : ''}
  </section>`);
  wireTimetable($('#tt'));
  const allShown = [...weekEvents, ...priv];
  $('#ics').onclick = () => icsFile(mode === 'week' ? weekEvents : allShown, access ? `${(access.name || 'learner').toLowerCase()}-calendar` : 'c21-week');
  $$('[data-ev]').forEach((b) => b.onclick = () => {
    const e = allShown.find((x) => x.id === b.dataset.ev) || monthCells.flatMap(monthEvents).find((x) => x.id === b.dataset.ev);
    if (!e) return;
    modal(`<h3>${e.private ? '🔒 ' : ''}${esc(e.title)}</h3><p class="muted">${fmtWhen(e.start)}${e.end ? ' to ' + new Date(e.end * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</p>${e.description ? `<p>${linkify(e.description)}</p>` : ''}
      <p class="small muted">${e.private ? 'Private: encrypted for this learner\'s circle.' : e.mine ? 'A weekly block the learner set.' : 'Part of the public C21 week.'}</p><div class="row mt"><button class="btn ghost" data-close>Close</button></div>`);
  });
  if (!access) return;
  $('#addev').onclick = async () => {
    const v = await formModal('Add a private event', [
      { id: 'title', label: 'What', required: true, placeholder: S.role === 'learner' ? 'Library trip' : isGuide() ? '1:1 with your guide' : 'Dentist' },
      { id: 'date', label: 'Date', type: 'date', value: ymd(new Date(Math.max(Date.now(), monday.getTime()))) },
      { id: 'start', label: 'Start', type: 'time', value: '10:00' }, { id: 'end', label: 'End', type: 'time', value: '11:00' },
      { id: 'type', label: 'Kind', type: 'select', value: S.role === 'learner' ? 'mine' : isGuide() ? 'guide' : 'family', options: [['mine', 'Self-directed'], ['guide', 'Guide / 1:1'], ['family', 'Family'], ['explore', 'Explorers Day'], ['pbl', 'Project'], ['community', 'Community'], ['fit', 'Body']] },
      { id: 'description', label: 'Notes (optional)', type: 'textarea', rows: 2 }], { submit: 'Add and encrypt', note: `Encrypted (NIP-59) for ${access.circle.length} people in the circle.` });
    if (!v?.title) return;
    const [y, mo, d] = v.date.split('-').map(Number);
    const at = (t) => { const [h, mi] = t.split(':').map(Number); return Math.floor(new Date(y, mo - 1, d, h, mi) / 1000); };
    try { await savePrivateEvent(access, { title: v.title, start: at(v.start), end: at(v.end), description: v.description, type: v.type }); toast('Added to the calendar ✓'); calendarView(); } catch (e) { toast(e.message, true); }
  };
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    const e = priv.find((x) => x.id === b.dataset.del);
    if (!e || !confirm(`Remove "${e.title}"?`)) return;
    try { await cancelPrivateEvent(access, e); toast('Removed'); calendarView(); } catch (err) { toast(err.message, true); }
  });
  if (!access.self) return;
  $('#badd').onclick = () => {
    const t = $('#bt').value.trim(); if (!t) return toast('What is the block for?', true);
    S.learner.calendar = [...(S.learner.calendar || []), { id: Math.random().toString(36).slice(2, 9), day: $('#bd').value, start: $('#bs').value, end: $('#be').value, title: t }];
    saveLearner(); calendarView();
  };
  $$('[data-id]').forEach((b) => b.onclick = () => { S.learner.calendar = S.learner.calendar.filter((x) => x.id !== b.dataset.id); saveLearner(); calendarView(); });
}

// ---------- messages: family rooms (NIP-17). A learner can only talk to their circle. ----------
async function messagesView() {
  const me = S.signer.pubkey;
  const key = (pks) => [...new Set(pks)].sort().join(',');
  const rooms = new Map();
  const names = new Map([[me, 'You'], ...N.STAFF.map((s) => [s, 'Kieran']), ...(S.settings?.children || []).map((c) => [c.pubkey, c.name])]);
  let defaultRoom = null;
  if (S.role === 'learner') {
    defaultRoom = myCircle();
    (S.settings.parents || []).forEach((p, i) => names.set(p, (S.settings.parents.length > 1 ? `Parent ${i + 1}` : 'Parent')));
    if (S.settings.guide && !names.has(S.settings.guide)) names.set(S.settings.guide, 'Guide');
  } else if (S.role === 'parent') {
    for (const c of S.settings.children || []) {
      const a = await learnerAccess(c.pubkey);
      if (!a) continue;
      if (a.guide && !names.has(a.guide)) names.set(a.guide, 'Guide');
      a.parents.filter((p) => p !== me).forEach((p) => names.set(p, 'Co-parent'));
      rooms.set(key(a.circle), { msgs: [], last: 0, label: `${c.name}'s circle` });
      defaultRoom ||= a.circle;
    }
  }
  view(`<section class="wrap pad"><div class="eyebrow">Messages</div><h1>${S.role === 'learner' ? 'My circle' : 'Family rooms'}</h1>
    <p class="lead">Private and encrypted (NIP-17). ${S.role === 'learner' ? 'Your parents and your guide are always in the room together.' : 'Every learner\'s room includes their parents and guide.'}</p>
    <div class="msgs mt"><div class="rooms" id="rooms"></div><div class="card"><div class="thread" id="thread"><p class="muted">Decrypting messages…</p></div>
    <div id="compose" class="mt"><textarea id="mt" placeholder="Write a message"></textarea><button class="btn mt" id="send">Send</button></div></div></div></section>`);
  let current = defaultRoom ? key(defaultRoom) : null;
  const nm = (pk) => names.get(pk) || N.shortNpub(pk);
  const draw = () => {
    if (!$('#rooms')) return;
    $('#rooms').innerHTML = [...rooms.entries()].sort((a, b) => b[1].last - a[1].last).map(([k, r]) => `<button class="${k === current ? 'on' : ''}" data-k="${k}">${esc(r.label || k.split(',').filter((p) => p !== me).map(nm).join(', ') || 'Notes to self')}<small>${r.last ? fmtWhen(r.last) : 'no messages yet'}${r.flag ? ' · ' + r.flag : ''}</small></button>`).join('') || '<p class="muted small">No messages yet.</p>';
    const r = rooms.get(current);
    $('#thread').innerHTML = r?.msgs.length ? r.msgs.sort((a, b) => a.created_at - b.created_at).map((m) => `<div class="msg ${m.pubkey === me ? 'me' : ''}"><div class="meta"><b>${esc(nm(m.pubkey))}</b> · ${fmtWhen(m.created_at)}</div><p>${linkify(m.content)}</p></div>`).join('') : '<p class="muted">No messages yet. Say hello!</p>';
    $('#thread').scrollTop = 1e9;
    $('#compose').style.display = current ? '' : 'none';
  };
  const addMsg = (m) => {
    if (m.kind !== 14) return;
    const k = key([m.pubkey, ...m.tags.filter((t) => t[0] === 'p').map((t) => t[1])]);
    if (S.role === 'learner' && k !== key(defaultRoom)) return; // learners only ever see their circle
    const r = rooms.get(k) || { msgs: [], last: 0 };
    if (r.msgs.some((x) => x.id === m.id)) return;
    r.msgs.push(m); r.last = Math.max(r.last, m.created_at);
    const flag = m.tags.find((t) => t[0] === 'c21')?.[1]; if (flag) r.flag = flag;
    rooms.set(k, r); if (!current) current = k;
  };
  $('#rooms').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; current = b.dataset.k; draw(); };
  $('#send').onclick = async () => {
    const t = $('#mt').value.trim(); if (!t || !current) return;
    $('#send').disabled = true;
    try { const rumor = await N.sendPrivate(S.signer, current.split(',').filter((p) => p !== me), t); addMsg(rumor); $('#mt').value = ''; draw(); } catch (e) { toast(e.message, true); }
    $('#send').disabled = false;
  };
  draw();
  const off = N.onInbox((m) => { if (!$('#thread')) return off(); addMsg(m); draw(); });
  (await N.loadInbox(S.signer, { refresh: true })).forEach(addMsg);
  draw();
}

// ---------- parents: key pairs for the family ----------
async function familyView() {
  if (S.role !== 'parent') return (location.hash = '#/home');
  const linked = await acceptFamilyLinks().catch(() => []);
  if (linked.length) toast(`${linked.length} learner${linked.length > 1 ? 's' : ''} linked by a co-parent ✓`);
  const kids = S.settings.children || [];
  const guideSelect = (id, val) => `<select id="${id}"><option value="${N.STAFF[0]}" ${!val || val === N.STAFF[0] ? 'selected' : ''}>Kieran (C21)</option><option value="custom" ${val && val !== N.STAFF[0] ? 'selected' : ''}>Another guide (paste npub)</option><option value="" ${val === null ? 'selected' : ''}>No guide for now</option></select>`;
  view(`<section class="wrap pad"><div class="eyebrow">Family</div><h1>Your learners</h1>
    <p class="lead">Each learner has their own Nostr key pair, made by you. Their progress, calendar and portfolio are encrypted for their circle only: the learner, their parents and their guide.</p>
    <div class="card keys mt"><h3>🔑 Family keys</h3><div class="keyrow">${avatar(S.signer.pubkey, 36)}<div><b>You (parent)</b><div class="mono small break">${N.npub(S.signer.pubkey)}</div></div></div>
      ${kids.map((k) => `<div class="keyrow">${avatar(k.pubkey, 36)}<div><b>${esc(k.name)}</b> <span class="muted small">learner · password-locked key (NIP-49)${k.linkedBy ? ' · linked by co-parent' : ''}</span><div class="mono small break">${N.npub(k.pubkey)}</div></div></div>`).join('')}
      <p class="muted small mt">Share your npub with a co-parent or guide so they can be added to a circle. Never share an nsec.</p></div>
    <div id="kids" class="mt">${kids.length ? '<div class="loader"><span></span><span></span><span></span></div>' : '<div class="card muted">No learners yet. Add one below.</div>'}</div>
    <div class="card mt"><h2>Add a learner</h2><p class="muted">We'll make a new Nostr key pair for your learner, locked with a password you choose. Use a fun nickname, not their real name.</p>
      <div class="grid g4"><div><label>Nickname</label><input id="cn" value="${nickname()}"></div><div><label>Age</label><input id="ca" type="number" min="5" max="21"></div>
      <div><label>Password for your learner</label><input id="cp" type="password" minlength="6" placeholder="At least 6 characters"></div><div><label>Guide</label>${guideSelect('cg')}</div></div>
      <div id="cgcustom" hidden><label>Guide's npub</label><input id="cgn" class="mono small" placeholder="npub1…"></div>
      <details class="mt"><summary class="small">My learner already has a Nostr key</summary><label>Their nsec (it is locked with the password above, and never sent anywhere)</label><input id="cex" class="mono small" placeholder="nsec1…"></details>
      <button class="btn mt" id="cadd">Create learner login</button></div></section>`);
  $('#cg').onchange = () => ($('#cgcustom').hidden = $('#cg').value !== 'custom');
  const readGuide = (sel, input) => { if (sel === 'custom') { const v = input.trim(); if (!v.startsWith('npub1')) throw new Error('Paste the guide\'s npub'); return N.toHexKey(v); } return sel || null; };
  $('#cadd').onclick = async () => {
    const name = $('#cn').value.trim(), pw = $('#cp').value;
    if (!name || pw.length < 6) return toast('Add a nickname and a password of at least 6 characters', true);
    const bad = safetyCheck(name); if (bad) return toast(bad, true);
    let guide, existingSk;
    try {
      guide = readGuide($('#cg').value, $('#cgn').value);
      const ex = $('#cex').value.trim();
      if (ex) { const d = N.nip19.decode(ex); if (d.type !== 'nsec') throw new Error('That is not an nsec'); existingSk = d.data; }
    } catch (e) { return toast(e.message, true); }
    $('#cadd').disabled = true; $('#cadd').textContent = 'Creating…';
    try {
      const { ncryptsec } = await createLearner({ name, age: $('#ca').value, password: pw, guide, existingSk });
      await loginCard(name, ncryptsec);
      familyView();
    } catch (e) { toast(e.message, true); $('#cadd').disabled = false; $('#cadd').textContent = 'Create learner login'; }
  };
  if (!kids.length) return;
  const cards = await Promise.all(kids.map(async (k) => {
    const a = await learnerAccess(k.pubkey, { fresh: true });
    const d = a?.data;
    const done = d ? Object.keys(d.done || {}) : [];
    const byProg = PROGRAMS.map((p) => ({ p, n: p.lessons.filter((l) => d?.done?.[l.id]).length })).filter((x) => x.n);
    const recent = [...done].sort((x, y) => d.done[y] - d.done[x]).slice(0, 5).map(lessonById).filter(Boolean);
    const guide = a?.guide;
    return `<div class="card kidcard reveal"><div class="row between"><div class="row">${avatar(k.pubkey, 56)}<div><h2>${esc(k.name)}</h2><p class="muted small">${d ? 'Updated ' + fmtWhen(d.updated || d._updated) : 'Nothing shared yet. Log in as your learner once to start.'}</p>
        <p class="small">🔒 Circle: ${esc(k.name)}, ${a?.parents?.length > 1 ? `you + ${a.parents.length - 1} co-parent${a.parents.length > 2 ? 's' : ''}` : 'you'}, ${guide ? (N.STAFF.includes(guide) ? 'Kieran (guide)' : 'guide ' + N.shortNpub(guide)) : 'no guide'}</p></div></div>
      <div class="row"><a class="btn small" href="#/u/${N.npub(k.pubkey)}">Portfolio</a><a class="btn small ghost" href="#/calendar?l=${N.npub(k.pubkey)}">Calendar</a><button class="btn small ghost" data-login="${k.pubkey}">Login code</button><button class="btn small ghost" data-manage="${k.pubkey}">Guide and parents</button></div></div>
      ${d ? `<div class="grid g3 mt"><div><div class="ring" style="--p:${Math.round((done.length / ALL_LESSONS.length) * 100)}"><span>${done.length}<small>/${ALL_LESSONS.length}</small></span></div><p class="center small muted">lessons done</p></div>
        <div><h3>Project</h3><p><b>${esc(d.project?.title || 'Not named yet')}</b></p><div class="stages">${STAGES.map(([id, l]) => `<span class="stage ${d.project?.stage === id ? 'on' : ''}">${l}</span>`).join('')}</div><p class="small muted mt">Next: ${esc(d.project?.next || '-')}</p></div>
        <div><h3>By program</h3>${byProg.map(({ p, n }) => `<div class="bar"><span>${p.icon} ${esc(p.title)}</span><i style="--w:${(n / p.lessons.length) * 100}%;--c:${p.colour}"></i></div>`).join('') || '<p class="muted small">Nothing yet.</p>'}</div></div>
        ${recent.length ? `<h3 class="mt">Recent lessons and notes</h3>${recent.map((l) => `<div class="note"><b>✓ ${esc(l.title)}</b> <span class="muted small">${fmtDate(d.done[l.id])}</span>${d.notes?.[l.id] ? `<p>${esc(d.notes[l.id])}</p>` : ''}</div>`).join('')}` : ''}
        <div class="row mt"><button class="btn small ghost" data-csv="${k.pubkey}">Download learning record (CSV)</button></div>` : ''}</div>`;
  }));
  if (!$('#kids')) return;
  $('#kids').innerHTML = cards.join('');
  animateIn($('#kids'));
  $('#kids').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = kids.find((x) => x.pubkey === (b.dataset.login || b.dataset.manage || b.dataset.csv));
    if (b.dataset.login) return loginCard(k.name, k.ncryptsec);
    if (b.dataset.csv) {
      const d = (await learnerAccess(k.pubkey))?.data;
      const rows = [['Date', 'Program', 'Lesson', 'Learning areas', 'Notes']];
      Object.entries(d?.done || {}).sort((x, y) => x[1] - y[1]).forEach(([id, ts]) => { const l = lessonById(id); const p = l && programById(l.program); if (l) rows.push([fmtDate(ts), p.title, l.title, p.areas.join('; '), d.notes?.[id] || '']); });
      return download(`learning-record-${k.name}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    }
    if (b.dataset.manage) {
      const a = await learnerAccess(k.pubkey);
      const curGuide = a?.guide !== undefined ? a.guide : k.guide;
      const res = await modal(`<h3>${esc(k.name)}'s circle</h3><p class="muted">Enter ${esc(k.name)}'s password to change who is in their circle. Everyone in the circle can read their portfolio and calendar.</p>
        <form id="f"><input id="op" type="password" placeholder="Current learner password" required>
        <label>Guide</label>${guideSelect('mg', curGuide)}<div id="mgc" ${curGuide && curGuide !== N.STAFF[0] ? '' : 'hidden'}><input id="mgn" class="mono small mt" placeholder="npub1…" value="${curGuide && curGuide !== N.STAFF[0] ? N.npub(curGuide) : ''}"></div>
        <label>Co-parents (npubs, one per line)</label><textarea id="mco" class="mono small" rows="3" placeholder="npub1…">${(k.coParents || []).map((p) => N.npub(p)).join('\n')}</textarea>
        <p class="muted small">A new co-parent gets an encrypted message, and ${esc(k.name)} appears on their Family page.</p>
        <input id="np" type="password" placeholder="New learner password (optional)" class="mt"><div class="row mt"><button class="btn">Save</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
      { onMount: (m, close) => {
        $('#mg', m).onchange = () => ($('#mgc', m).hidden = $('#mg', m).value !== 'custom');
        $('#f', m).onsubmit = (ev) => { ev.preventDefault(); close({ op: $('#op', m).value, g: $('#mg', m).value, gn: $('#mgn', m).value, co: $('#mco', m).value, np: $('#np', m).value }); };
      } });
      if (!res) return;
      let guide, coParents;
      try {
        guide = readGuide(res.g, res.gn);
        coParents = res.co.split(/\s+/).map((x) => x.trim()).filter(Boolean).map((x) => { if (!x.startsWith('npub1')) throw new Error('Co-parents must be npubs'); return N.toHexKey(x); });
      } catch (err) { return toast(err.message, true); }
      try { N.unlockKey(k.ncryptsec, res.op); } catch { return toast('That password didn\'t unlock the learner key', true); }
      try { await updateLearnerSettings(k, res.op, { guide, coParents }, res.np || null); toast('Circle updated ✓'); familyView(); } catch (err) { toast(err.message, true); }
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

// ---------- guides: learners whose circle I'm in ----------
async function learnersView() {
  if (!isGuide()) return (location.hash = '#/home');
  loading('Finding your learners…');
  const list = await myLearners();
  const rows = await Promise.all(list.map(async (a) => {
    const pf = portfolioFrom(a, await circleRumors(a));
    const d = a.data;
    return `<tr><td>${avatar(a.pubkey, 32)}</td><td><b>${esc(a.name || 'Learner')}</b>${a.age ? ` <span class="muted small">age ${esc(a.age)}</span>` : ''}</td><td>${d ? Object.keys(d.done || {}).length : '-'}</td><td>${esc(d?.project?.title || '-')} <span class="pill soft">${esc(d?.project?.stage || '')}</span></td><td>${pf.commits.length}</td><td class="small muted">${pf.commits.length ? fmtWhen(pf.commits.at(-1).at) : '-'}</td>
      <td><a class="btn small" href="#/u/${N.npub(a.pubkey)}">Portfolio</a> <a class="btn small ghost" href="#/calendar?l=${N.npub(a.pubkey)}">Calendar</a></td></tr>`;
  }));
  view(`<section class="wrap pad"><div class="eyebrow">Guide</div><h1>Your learners</h1>
    <p class="lead">Learners whose parents chose you as their guide. You're in their encrypted circle, so you can read their portfolio, give feedback and add 1:1s to their calendar.</p>
    <div class="card mt">${rows.length ? `<div class="tablewrap"><table><tr><th></th><th>Learner</th><th>Lessons</th><th>Project</th><th>Commits</th><th>Last commit</th><th></th></tr>${rows.join('')}</table></div>` : '<p class="muted">No learners yet. Parents add you by pasting your npub when they set their learner\'s guide.</p>'}</div>
    <div class="card mt"><h3>Your npub</h3><p class="mono small break">${N.npub(S.signer.pubkey)}</p><button class="btn small ghost" id="cpk">Copy</button></div></section>`);
  $('#cpk').onclick = () => navigator.clipboard.writeText(N.npub(S.signer.pubkey)).then(() => toast('Copied'));
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
    <div class="card mt"><h2>🧑‍🎓 Learners you guide</h2><p class="muted">See <a href="#/learners">Learners</a> for everyone whose parents chose you.</p></div></section>`);
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
      const page = location.pathname.split('/').pop() || 'index.html';
      const files = [['/index.html', 'text/html', page], ['/assets/app.js', 'text/javascript', 'assets/app.js']];
      const tags = [['d', 'c21']];
      const servers = new Set();
      for (const [path, type, src] of files) {
        st.textContent = `Uploading ${path}…`;
        const buf = await fetch(new URL(src, location.href.split('#')[0])).then((r) => { if (!r.ok) throw new Error('Could not read ' + src); return r.arrayBuffer(); });
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
}

// ---------- account ----------
function accountView() {
  const pk = S.signer.pubkey;
  view(`<section class="wrap pad narrow"><h1>Account</h1><div class="card"><div class="row">${avatar(pk, 64)}<div><h2>${esc(S.settings?.name || (S.role === 'staff' ? 'Kieran' : ''))}</h2><p class="muted">${S.role} · signed in with ${S.signer.type === 'nip07' ? 'browser extension (NIP-07)' : S.signer.type === 'nip46' ? 'remote signer (NIP-46)' : 'password-locked key (NIP-49)'}</p></div></div>
    <p class="mono small break mt">${N.npub(pk)}</p>
    <div class="row mt">${S.role === 'learner' ? '<a class="btn ghost" href="#/me">My portfolio</a>' : ''}<button class="btn ghost" id="cpk">Copy npub</button>${S.signer.type === 'local' ? '<button class="btn ghost" id="bk">Download key backup</button>' : ''}<button class="btn" id="out">Log out</button></div></div>
    <div class="card mt"><h3>Relays</h3><p class="muted small">C21 publishes to all ${RELAYS.length} of these. Private data is encrypted before it leaves your browser.</p><ul class="relays">${RELAYS.map((r) => `<li class="mono small">${esc(r)}</li>`).join('')}</ul></div></section>`);
  $('#cpk').onclick = () => navigator.clipboard.writeText(N.npub(pk)).then(() => toast('Copied'));
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
