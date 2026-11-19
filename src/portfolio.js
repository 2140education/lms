// Learner portfolios, laid out like a Consensus21 profile, built from a private git history
// on Nostr. Repos and commits are NIP-34 kinds sealed in NIP-59 gift wraps, so only the learner,
// their parents and their guide can ever read them.
import * as N from './nostr.js';
import { S, learnerAccess, circleRumors, portfolioFrom, verifyCommit, commit, saveRepo, comment, parseDoc, makeDoc, slugify, MAIN_REPO,
  privateEvents, weeklyBlocks, c21Calendar, schoolWeek, myLearners } from './store.js';
import { PROGRAMS, ALL_LESSONS, lessonById } from './lessons.js';
import { MAX_TEXT_COMMIT } from './config.js';
import { $, $$, esc, md, fmtDate, fmtWhen, toast, avatar, heatmap, miniHeat, timetable, wireTimetable, icsFile, mondayOf, ymd, secretCheck, TT_COLOURS } from './ui.js';
import { view, loading, modal, formModal } from './shell.js';

const LANG_COLOUR = { Markdown: '#083fa1', JavaScript: '#f1e05a', Python: '#3572A5', 'C++': '#f34b7d', HTML: '#e34c26', CSS: '#563d7c', Scratch: '#f7931a', MakeCode: '#7a5cd6', Minecraft: '#3aa65a', Lua: '#000080', Rust: '#dea584', Other: '#94a3b8' };
const LANGS = Object.keys(LANG_COLOUR);
export const stageOf = (age) => (!age ? 'Learner' : age < 11 ? 'Explorer' : age < 16 ? 'Builder' : 'Founder');
const CORE_ROWS = [
  ['Time management', ['core-week', 'core-audit'], '#f7931a'],
  ['Financial literacy & Bitcoin', ['core-money', 'core-keys'], '#fde047'],
  ['Reflection & portfolio', ['core-git', 'core-sip'], '#2dd4bf'],
];
const lock = '<span class="pf-pill">🔒 Private</span>';

// ---------- building the profile model ----------
async function nameOf(pk, label) {
  if (N.STAFF.includes(pk)) return 'Kieran';
  if (pk === S.signer?.pubkey) return 'You';
  const kid = S.settings?.children?.find((c) => c.pubkey === pk);
  if (kid) return kid.name;
  const p = await Promise.race([N.profile(pk), new Promise((r) => setTimeout(() => r({}), 2500))]);
  return p.display_name || p.name || label;
}

function countsFrom(portfolio, data, pk) {
  const counts = {};
  const add = (ts) => { const k = ymd(new Date(ts * 1000)); counts[k] = (counts[k] || 0) + 1; };
  portfolio.commits.forEach((c) => add(c.at));
  portfolio.comments.filter((c) => c.pubkey === pk).forEach((c) => add(c.created_at));
  Object.values(data?.done || {}).forEach(add);
  return counts;
}

function docsIn(repo, dir) {
  if (!repo) return [];
  return [...repo.files.values()].filter((f) => f.path.startsWith(dir + '/') && f.path.endsWith('.md')).map((f) => {
    const { meta, body } = parseDoc(f.content);
    return { path: f.path, title: meta.title || f.path.split('/').pop().replace(/\.md$/, ''), date: meta.date || ymd(new Date(f.at * 1000)), status: meta.status, number: meta.number, summary: body.replace(/^#.*$/m, '').trim().split('\n').find((l) => l.trim()) || '', body, at: f.at };
  }).sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.at - a.at));
}

export async function buildModel(access, { refresh = false } = {}) {
  const rumors = await circleRumors(access, { refresh });
  const portfolio = portfolioFrom(access, rumors);
  const main = portfolio.repos.get(MAIN_REPO);
  const [parentNames, guideName] = await Promise.all([Promise.all((access.parents || []).map((p, i, all) => nameOf(p, all.length > 1 ? `Parent ${i + 1}` : 'Parent'))), access.guide ? nameOf(access.guide, 'Guide') : null]);
  return {
    access, pubkey: access.pubkey, name: access.name || 'Learner', age: access.age, data: access.data || {}, portfolio, rumors,
    readme: main?.files.get('README.md')?.content || '',
    explorers: docsIn(main, 'explorers'), reflections: docsIn(main, 'reflections'), sips: docsIn(main, 'sips'),
    counts: countsFrom(portfolio, access.data, access.pubkey),
    events: privateEvents(access, rumors),
    parentNames, guideName, canEdit: !!access.self,
  };
}

// ---------- the profile page ----------
export async function profileView(npubStr, sub, ...rest) {
  let pk;
  try { pk = N.toHexKey(npubStr); } catch { return view('<section class="wrap pad"><div class="card bad">That profile link is not valid.</div></section>'); }
  if (!S.signer) return lockedView(pk);
  loading('Decrypting portfolio…');
  const access = await learnerAccess(pk);
  if (!access) return lockedView(pk);
  const model = await buildModel(access);
  if (sub === 'repo') return repoView(model, rest[0], rest.slice(1).join('/'));
  renderProfile(model, sub || 'overview');
}

function lockedView(pk) {
  view(`<section class="pfp"><div class="wrap pf-locked">
    <div class="pf-ava-ring small">${avatar(pk, 160)}</div>
    <h1>🔒 This portfolio is encrypted</h1>
    <p class="lede">Consensus21 portfolios are private git repositories on Nostr. Every commit is sealed (NIP-59) for exactly three kinds of people: the learner, their parents and their guide. Relays only hold ciphertext.</p>
    <p class="muted mono small">${N.shortNpub(pk)}</p>
    <div class="row mt">${S.signer ? '<a class="btn" href="#/home">Back home</a>' : '<a class="btn" href="#/login">Log in to open it</a>'}<a class="btn ghost" href="#/demo">See an example learner</a></div>
  </div></section>`);
}

export function renderProfile(m, tab = 'overview', { switcher = null } = {}) {
  const repos = [...m.portfolio.repos.values()].sort((a, b) => b.updated - a.updated);
  const pinned = (repos.filter((r) => r.pinned).length ? repos.filter((r) => r.pinned) : repos).slice(0, 6);
  const hm = heatmap(m.counts);
  const login = slugify(m.name) + '-c21';
  const link = (path) => (m.demo ? `#/demo/${m.demo}` : `#/u/${N.npub(m.pubkey)}`) + (path ? '/' + path : '');
  const doneIds = Object.keys(m.data.done || {});
  const progRows = CORE_ROWS.map(([label, ids, c]) => [label, Math.round((ids.filter((i) => doneIds.includes(i)).length / ids.length) * 100), c]);
  const otherProgs = PROGRAMS.filter((p) => p.id !== 'core').map((p) => [p.title, p.lessons.filter((l) => doneIds.includes(l.id)).length, p.lessons.length]).filter((r) => r[1] > 0);
  const project = m.data.project || {};
  const weekMonday = mondayOf();
  const bio = project.title ? `Working on <b>${esc(project.title)}</b>${project.stage ? ` (${esc(project.stage)})` : ''}.${project.next ? ` Next: ${esc(project.next)}.` : ''}` : (m.canEdit ? 'Name your project on your Home page and it shows up here.' : 'No project named yet.');
  const docRow = (d, kind) => `<div class="pf-row"><span class="d">${kind === 'sip' ? esc(d.number ? 'SIP-' + String(d.number).padStart(3, '0') : 'SIP') : esc(fmtDate(new Date(d.date + 'T12:00').getTime() / 1000))}</span><div class="tt2"><a href="#" data-doc="${esc(d.path)}">${esc(d.title)}</a>${d.status ? ` <span class="pf-pill st-${esc(d.status)}">${esc(d.status)}</span>` : ''}<p>${esc(d.summary.slice(0, 180))}</p></div></div>`;
  const empty = (msg) => `<div class="pf-list"><div class="pf-row"><div class="tt2"><p>${msg}</p></div></div></div>`;
  const ownerBar = m.canEdit ? `<div class="pf-actions"><button class="btn sm" data-act="reflection">+ Reflection</button><button class="btn sm ghost" data-act="explorer">+ Explorers Day</button><button class="btn sm ghost" data-act="sip">+ SIP</button><button class="btn sm ghost" data-act="project">+ New project</button></div>` : '';

  view(`<div class="pfp">
  <div class="pf-bar"><div class="wrap pf-bar-in" role="tablist">
    ${[['overview', 'Overview'], ['projects', 'Projects', repos.length], ['week', 'My week'], ['journal', 'Journal', m.explorers.length + m.reflections.length], ['sips', 'SIPs', m.sips.length]]
      .map(([id, label, cnt]) => `<button class="pf-tab" role="tab" aria-selected="${tab === id}" data-p="${id}">${label}${cnt !== undefined ? ` <span class="cnt">${cnt}</span>` : ''}</button>`).join('')}
  </div></div>
  <div class="wrap pf-layout">
    <aside class="pf-side">
      <div class="pf-ava-ring">${avatar(m.pubkey, 260)}</div>
      <div class="who"><h1>${esc(m.name)}</h1><div class="login">${esc(login)}</div></div>
      <div><span class="pf-stage">${stageOf(m.age)}${m.age ? ' · age ' + esc(m.age) : ''}</span></div>
      <p class="bio">${bio}</p>
      ${m.demo ? '<a class="btn ghost" href="#/login">Make your own</a>' : m.canEdit ? '<button class="btn ghost" data-act="readme">Edit README</button>' : '<a class="btn ghost" href="#/messages">Message the family room</a>'}
      <ul class="pf-meta">
        <li>🔒 <span>Encrypted for <b>${m.access.circle.length}</b> ${m.access.circle.length === 1 ? 'person' : 'people'}: learner, ${m.parentNames.length === 1 ? 'parent' : 'parents'}${m.guideName ? ', guide' : ''}</span></li>
        <li>👪 <span>Parents: ${m.parentNames.map(esc).join(', ') || '-'}</span></li>
        <li>🧭 <span>Guide: ${esc(m.guideName || 'none yet')}</span></li>
        <li>🔑 <span class="mono small">${N.shortNpub(m.pubkey)}</span></li>
      </ul>
      <div class="pf-badges">
        <div class="pf-badge" style="--c:#38bdf8"><b>${m.explorers.length}</b><span>Explorers Days</span></div>
        <div class="pf-badge" style="--c:#c084fc"><b>${m.reflections.length}</b><span>Reflections</span></div>
        <div class="pf-badge" style="--c:#fde047"><b>${m.sips.length}</b><span>SIPs</span></div>
      </div>
    </aside>
    <main class="pf-main">
      <div id="pfswitch">${switcher || ''}</div>
      ${ownerBar}
      <section class="pf-panel" id="p-overview" ${tab === 'overview' ? '' : 'hidden'}>
        <div class="pf-block"><div class="pf-readme"><div class="file">${esc(login)} / README.md ${lock}</div>${m.readme ? md(parseDoc(m.readme).body) : `<h2>Hi, I'm ${esc(m.name)} 👋</h2><p>${m.canEdit ? 'This is your README. Tell your parents and guide what you are building and why. Click <b>Edit README</b>.' : 'No README yet.'}</p>`}</div></div>
        <div class="pf-block"><h3 class="pf-h3">Pinned</h3>
          ${pinned.length ? `<div class="pf-pins">${pinned.map((r) => `<div class="pf-pin"><div class="pf-pin-top">📘 <a href="${link('repo/' + r.slug)}">${esc(r.name)}</a>${lock}</div><p>${esc(r.description || 'No description yet.')}</p>
            <div class="pf-pin-foot">${r.language ? `<span><i style="--c:${LANG_COLOUR[r.language] || '#94a3b8'}"></i>${esc(r.language)}</span>` : ''}<span>⎇ ${r.commits.length} commit${r.commits.length === 1 ? '' : 's'}</span>${r.updated ? `<span>${fmtDate(r.updated)}</span>` : ''}</div></div>`).join('')}</div>`
            : empty(m.canEdit ? 'No repositories yet. Add a reflection or a new project and your first private repo appears here.' : 'No repositories yet.')}
        </div>
        <div class="pf-block"><h3 class="pf-h3">Core programs</h3><div class="pf-programs">${progRows.map(([l, p, c]) => `<div class="pf-prog-row"><span>${esc(l)}</span><div class="pf-prog-bar"><i style="--c:${c};width:${p}%"></i></div><b>${p}%</b></div>`).join('')}</div>
          ${otherProgs.length ? `<p class="muted small" style="margin-top:10px">Also: ${otherProgs.map(([t, n, of]) => `${esc(t)} ${n}/${of}`).join(' · ')}</p>` : ''}</div>
        <div class="pf-block"><h3 class="pf-h3"><span>${hm.total.toLocaleString()} contributions in the last year</span></h3>${hm.html}</div>
        ${m.portfolio.comments.length ? `<div class="pf-block"><h3 class="pf-h3">Latest feedback <small>from the circle</small></h3><div class="pf-list">${m.portfolio.comments.slice(-4).reverse().map((c) => feedbackRow(m, c)).join('')}</div></div>` : ''}
      </section>
      <section class="pf-panel" id="p-projects" ${tab === 'projects' ? '' : 'hidden'}>
        ${repos.length ? `<div class="pf-list">${repos.map((r) => `<div class="pf-row"><div class="tt2"><a href="${link('repo/' + r.slug)}">${esc(r.name)}</a> ${lock}${r.pinned ? ' <span class="pf-pill">Pinned</span>' : ''}<p>${esc(r.description || 'No description yet.')}</p></div>
          <div class="pf-pin-foot">${r.language ? `<span><i style="--c:${LANG_COLOUR[r.language] || '#94a3b8'}"></i>${esc(r.language)}</span>` : ''}<span>${r.updated ? fmtDate(r.updated) : ''}</span></div></div>`).join('')}</div>` : empty('No projects yet.')}
      </section>
      <section class="pf-panel" id="p-week" ${tab === 'week' ? '' : 'hidden'}>
        <div class="pf-block pf-weekhead"><p class="muted small">The C21 week plus ${esc(m.name)}'s own blocks and private events. Only this circle can see the 🔒 ones.</p><div class="row"><button class="btn ghost sm" id="icsBtn" type="button">Add to my calendar</button>${m.demo ? '' : `<a class="btn ghost sm" href="#/calendar?l=${N.npub(m.pubkey)}">Open calendar</a>`}</div></div>
        <div class="tt" id="pftt"><div class="loader"><span></span><span></span><span></span></div></div>
      </section>
      <section class="pf-panel" id="p-journal" ${tab === 'journal' ? '' : 'hidden'}>
        <div class="pf-block"><h3 class="pf-h3">Explorers Days <small>explorers/</small></h3>${m.explorers.length ? `<div class="pf-list">${m.explorers.map((d) => docRow(d)).join('')}</div>` : empty('No Explorers Days logged yet.')}</div>
        <div class="pf-block"><h3 class="pf-h3">Reflections <small>reflections/</small></h3>${m.reflections.length ? `<div class="pf-list">${m.reflections.map((d) => docRow(d)).join('')}</div>` : empty('No reflections yet. Friday is reflection day.')}</div>
      </section>
      <section class="pf-panel" id="p-sips" ${tab === 'sips' ? '' : 'hidden'}>
        <div class="pf-block"><h3 class="pf-h3">System Improvement Proposals <small>sips/</small></h3>${m.sips.length ? `<div class="pf-list">${m.sips.map((d) => docRow(d, 'sip')).join('')}</div>` : empty('No SIPs yet. Got an idea that would make C21 better? Write it up and bring it to Thursday SIP discussion.')}</div>
      </section>
    </main>
  </div></div>`);

  // tabs
  $$('.pf-tab').forEach((b) => b.onclick = () => {
    $$('.pf-tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('.pf-panel').forEach((p) => (p.hidden = p.id !== 'p-' + b.dataset.p));
    history.replaceState(null, '', link(b.dataset.p === 'overview' ? '' : b.dataset.p));
  });
  // week
  (m.schoolEvents ? Promise.resolve(m.schoolEvents) : c21Calendar()).then((school) => {
    const evs = [...schoolWeek(school, weekMonday), ...weeklyBlocks(m.data, weekMonday), ...m.events.filter((e) => e.start * 1000 >= weekMonday.getTime() && e.start * 1000 < weekMonday.getTime() + 7 * 86400000)];
    const box = $('#pftt'); if (!box) return;
    box.innerHTML = timetable(evs, weekMonday); wireTimetable(box);
    $('#icsBtn').onclick = () => icsFile([...evs, ...m.events.filter((e) => e.start * 1000 > Date.now())], `${slugify(m.name)}-week`);
  });
  // documents
  $$('[data-doc]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openDoc(m, MAIN_REPO, a.dataset.doc); });
  // owner actions
  $$('[data-act]').forEach((b) => b.onclick = () => ownerAction(m, b.dataset.act));
}

function feedbackRow(m, c) {
  const who = c.pubkey === m.pubkey ? m.name : N.STAFF.includes(c.pubkey) ? 'Kieran' : m.access.guide === c.pubkey ? (m.guideName || 'Guide') : 'Parent';
  const repo = (c.tags.find((t) => t[0] === 'a')?.[1] || '').split(':')[2];
  const path = c.tags.find((t) => t[0] === 'path')?.[1];
  return `<div class="pf-row">${avatar(c.pubkey, 28)}<div class="tt2"><a>${esc(who)}</a> <span class="muted small">on ${esc(repo || '')}${path ? ' / ' + esc(path) : ''} · ${fmtWhen(c.created_at)}</span><p>${esc(c.content)}</p></div></div>`;
}

// ---------- reading a document (journal / SIP / any markdown file) ----------
function openDoc(m, slug, path) {
  const repo = m.portfolio.repos.get(slug);
  const f = repo?.files.get(path);
  if (!f) return;
  const { meta, body } = parseDoc(f.content);
  const fb = m.portfolio.comments.filter((c) => (c.tags.find((t) => t[0] === 'a')?.[1] || '').endsWith(':' + slug) && c.tags.find((t) => t[0] === 'path')?.[1] === path);
  modal(`<div class="pfp doc"><div class="file mono small muted">${esc(slug)} / ${esc(path)} ${lock}</div><h2>${esc(meta.title || path)}</h2>
    ${meta.date ? `<p class="muted small">${esc(meta.date)}${meta.status ? ` · <span class="pf-pill st-${esc(meta.status)}">${esc(meta.status)}</span>` : ''}</p>` : ''}
    <div class="md">${md(body)}</div>
    <h3 class="pf-h3 mt">Feedback</h3><div class="pf-list">${fb.map((c) => feedbackRow(m, c)).join('') || '<div class="pf-row"><div class="tt2"><p>No feedback yet.</p></div></div>'}</div>
    ${m.demo ? '' : `<textarea id="fbt" class="mt" placeholder="${m.canEdit ? 'Reply to your parents and guide' : 'Encouragement, questions, ideas…'}"></textarea>`}
    <div class="row mt">${m.demo ? '' : '<button class="btn sm" id="fbs">Send feedback</button>'}${m.canEdit ? '<button class="btn sm ghost" id="edit">Edit</button>' : ''}<button class="btn sm ghost" data-close>Close</button></div></div>`,
  { wide: true, onMount: (el, close) => {
    if ($('#fbs', el)) $('#fbs', el).onclick = async () => {
      const t = $('#fbt', el).value.trim(); if (!t) return;
      try { await comment(m.access, slug, t, path); toast('Feedback sent, encrypted for the circle ✓'); close(); rerender(m); } catch (e) { toast(e.message, true); }
    };
    if ($('#edit', el)) $('#edit', el).onclick = async () => { close(); editFile(m, slug, path); };
    hydrateImages(el, m, slug);
  } });
}

async function rerender(m, tab) {
  if (m.demo) return;
  const active = tab || $('.pf-tab[aria-selected="true"]')?.dataset.p || 'overview';
  const fresh = await buildModel(m.access);
  const h = location.hash.split('?')[0];
  const i = h.indexOf('/repo/');
  if (i >= 0) { const [slug, ...p] = h.slice(i + 6).split('/').map(decodeURIComponent); return repoView(fresh, slug, p.join('/')); }
  renderProfile(fresh, active);
}

// Images in Markdown point at files in the repo; encrypted ones are decrypted in the browser.
function hydrateImages(root, m, slug) {
  const repo = m.portfolio.repos.get(slug);
  $$('img.mdimg', root).forEach((img) => {
    const src = img.dataset.src;
    if (/^https:\/\//.test(src)) { img.src = src; return; }
    const f = repo?.files.get(src.replace(/^\.?\//, ''));
    if (f?.blob && !m.demo) N.fetchEncrypted(f.blob).then((u) => (img.src = u)).catch(() => (img.alt = 'Could not decrypt image'));
  });
}

// ---------- writing (learner only) ----------
async function doCommit(m, slug, message, changes) {
  const size = JSON.stringify(changes).length;
  if (size > MAX_TEXT_COMMIT) throw new Error(`That's ${Math.round(size / 1000)} KB. Keep text under ${MAX_TEXT_COMMIT / 1000} KB, or attach big files as encrypted uploads.`);
  const bad = secretCheck(message, ...changes.map((c) => c.content || ''));
  if (bad) throw new Error(bad);
  await commit(m.access, m.portfolio, slug, message, changes);
}

async function ownerAction(m, act) {
  const today = ymd(new Date());
  try {
    if (act === 'readme') {
      const v = await formModal('Edit README', [{ id: 'body', label: 'README.md (Markdown)', type: 'textarea', rows: 12, value: m.readme ? parseDoc(m.readme).body : `# Hi, I'm ${m.name} 👋\n\nI'm building …\n\n## What I'm learning\n- \n\n## What's next\n- ` }], { submit: 'Commit', wide: true, note: 'Encrypted for you, your parents and your guide.' });
      if (!v) return;
      await doCommit(m, MAIN_REPO, 'Update README', [{ path: 'README.md', content: v.body }]);
    } else if (act === 'reflection') {
      const v = await formModal('Friday reflection', [
        { id: 'title', label: 'Title', value: `Week ${weekNo()}: `, required: true },
        { id: 'built', label: 'What did I build or do?', type: 'textarea', rows: 3 },
        { id: 'learned', label: 'What did I learn?', type: 'textarea', rows: 3 },
        { id: 'next', label: 'What will I do next?', type: 'textarea', rows: 2 }], { submit: 'Commit reflection', wide: true });
      if (!v?.title) return;
      await doCommit(m, MAIN_REPO, `Reflection: ${v.title}`, [{ path: `reflections/${today}-${slugify(v.title)}.md`, content: makeDoc({ title: v.title, date: today }, `${v.built}\n\n## What I learned\n${v.learned}\n\n## Next\n${v.next}`) }]);
    } else if (act === 'explorer') {
      const v = await formModal('Explorers Day log', [
        { id: 'title', label: 'Where did you go?', required: true, placeholder: 'e.g. Wetlands walk with a ranger' },
        { id: 'date', label: 'Date', type: 'date', value: today },
        { id: 'body', label: 'What did you see, who did you meet, what will you follow up?', type: 'textarea', rows: 5 },
        { id: 'photo', label: 'Photo (optional, encrypted before upload)', type: 'file', accept: 'image/*' }], { submit: 'Commit log', wide: true });
      if (!v?.title) return;
      const changes = [];
      let body = v.body;
      if (v.photo) {
        const blob = await N.uploadEncrypted(S.signer, v.photo, (s) => toast(s));
        const p = `explorers/media/${v.date}-${slugify(v.title)}.${(v.photo.name.split('.').pop() || 'jpg').toLowerCase()}`;
        changes.push({ path: p, blob });
        body += `\n\n![photo](${p})`;
      }
      changes.unshift({ path: `explorers/${v.date}-${slugify(v.title)}.md`, content: makeDoc({ title: v.title, date: v.date }, body) });
      await doCommit(m, MAIN_REPO, `Explorers Day: ${v.title}`, changes);
    } else if (act === 'sip') {
      const n = Math.max(0, ...m.sips.map((s) => Number(s.number) || 0)) + 1;
      const v = await formModal(`SIP-${String(n).padStart(3, '0')}`, [
        { id: 'title', label: 'Title', required: true, placeholder: 'e.g. A robotics bench in the shed' },
        { id: 'problem', label: 'The problem', type: 'textarea', rows: 3 },
        { id: 'proposal', label: 'What I propose', type: 'textarea', rows: 4 },
        { id: 'cost', label: 'What it needs (time, money, people)', type: 'textarea', rows: 2 }], { submit: 'Commit SIP', wide: true, note: 'SIPs are how learners change how C21 runs. Your guide will help you bring it to Thursday SIP discussion.' });
      if (!v?.title) return;
      await doCommit(m, MAIN_REPO, `SIP-${n}: ${v.title}`, [{ path: `sips/SIP-${String(n).padStart(3, '0')}-${slugify(v.title)}.md`, content: makeDoc({ title: v.title, date: today, number: n, status: 'draft' }, `## Problem\n${v.problem}\n\n## Proposal\n${v.proposal}\n\n## What it needs\n${v.cost}`) }]);
    } else if (act === 'project') {
      const v = await formModal('New private repository', [
        { id: 'name', label: 'Name', required: true, placeholder: 'garden-sensor' },
        { id: 'description', label: 'Description', placeholder: 'What are you building?' },
        { id: 'language', label: 'Main language or tool', type: 'select', options: LANGS.map((l) => [l, l]), value: 'Markdown' },
        { id: 'pinned', label: 'Pin to my profile', type: 'checkbox', value: true }], { submit: 'Create repository', note: 'Repositories are encrypted. Only you, your parents and your guide can see them.' });
      if (!v?.name) return;
      const slug = slugify(v.name);
      if (m.portfolio.repos.has(slug)) throw new Error('You already have a repository called ' + slug);
      await saveRepo(m.access, { slug, name: slug, description: v.description, language: v.language, pinned: v.pinned });
      await doCommit(m, slug, 'Initial commit', [{ path: 'README.md', content: `# ${slug}\n\n${v.description || ''}\n` }]);
      toast('Repository created ✓');
      location.hash = `#/u/${N.npub(m.pubkey)}/repo/${slug}`;
      return;
    }
    toast('Committed, encrypted for your circle ✓');
    rerender(m, act === 'sip' ? 'sips' : act === 'readme' ? 'overview' : 'journal');
  } catch (e) { toast(e.message, true); }
}
const weekNo = () => { const d = new Date(); const j = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - j) / 86400000 + j.getDay() + 1) / 7); };

async function editFile(m, slug, path) {
  const f = path ? m.portfolio.repos.get(slug)?.files.get(path) : null;
  const v = await formModal(path ? `Edit ${path}` : 'Add a file', [
    { id: 'path', label: 'Path', value: path || '', placeholder: 'notes/ideas.md', required: true },
    { id: 'content', label: 'Content', type: 'textarea', rows: 14, value: f?.content || '' },
    { id: 'file', label: '…or upload a file instead (encrypted before upload)', type: 'file' },
    { id: 'message', label: 'Commit message', value: path ? `Update ${path}` : '', required: true }], { submit: 'Commit', wide: true });
  if (!v?.path) return;
  try {
    const p = v.path.replace(/^\/+/, '').replace(/\.\.+/g, '.');
    let change;
    if (v.file) change = { path: p, blob: await N.uploadEncrypted(S.signer, v.file, (s) => toast(s)) };
    else change = { path: p, content: v.content };
    await doCommit(m, slug, v.message || `Update ${p}`, [change]);
    toast('Committed ✓');
    location.hash = `#/u/${N.npub(m.pubkey)}/repo/${slug}/${p}`;
    if (location.hash.endsWith(p)) rerender(m);
  } catch (e) { toast(e.message, true); }
}

// ---------- a repository (code / commits / feedback) ----------
export async function repoView(m, slug, path = '') {
  const repo = m.portfolio.repos.get(slug);
  const base = m.demo ? `#/demo/${m.demo}` : `#/u/${N.npub(m.pubkey)}`;
  const login = slugify(m.name) + '-c21';
  if (!repo) return view(`<section class="pfp"><div class="wrap pad"><p>No repository called ${esc(slug)}.</p><a class="btn" href="${base}">Back to profile</a></div></section>`);
  const files = [...repo.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const file = path ? repo.files.get(path) : null;
  const commitById = new Map(repo.commits.map((c) => [c.id, c]));
  const fb = m.portfolio.comments.filter((c) => (c.tags.find((t) => t[0] === 'a')?.[1] || '').endsWith(':' + slug));
  const readme = repo.files.get('README.md');
  const isImg = (f) => f?.blob && /^image\//.test(f.blob.type);
  view(`<div class="pfp"><div class="wrap pad-s">
    <div class="pf-crumb"><a href="${base}">${esc(login)}</a> / <a href="${base}/repo/${esc(slug)}"><b>${esc(repo.name)}</b></a> ${lock}${path ? ` / <span class="mono">${esc(path)}</span>` : ''}</div>
    <p class="muted">${esc(repo.description || '')}</p>
    <div class="pf-repo-tabs"><button class="pf-tab" aria-selected="true" data-r="code">Code</button><button class="pf-tab" aria-selected="false" data-r="commits">Commits <span class="cnt">${repo.commits.length}</span></button><button class="pf-tab" aria-selected="false" data-r="feedback">Feedback <span class="cnt">${fb.length}</span></button>
      ${m.canEdit ? `<span class="grow"></span><button class="btn sm" id="addf">Add file</button><button class="btn sm ghost" id="pin">${repo.pinned ? 'Unpin' : 'Pin'}</button>` : ''}</div>
    <section id="r-code">
      ${file ? `<div class="pf-file"><div class="pf-file-head"><span class="mono">${esc(path)}</span><span class="muted small">${fmtWhen(file.at)} · ${esc(commitById.get(file.commit)?.message || '')}</span>${m.canEdit ? `<span class="grow"></span><button class="btn sm ghost" id="editf">Edit</button><button class="btn sm ghost" id="delf">Delete</button>` : ''}</div>
        <div class="pf-file-body">${file.blob ? (isImg(file) ? `<img id="blobimg" alt="${esc(path)}">` : `<p><button class="btn sm" id="dlblob">Decrypt and download (${Math.round(file.blob.size / 1024)} KB)</button></p>`) : path.endsWith('.md') ? `<div class="md">${md(parseDoc(file.content).body)}</div>` : `<pre>${esc(file.content)}</pre>`}</div></div>`
      : `<div class="pf-list">${files.map((f) => `<div class="pf-row"><span class="fi">${f.blob ? '🖼️' : '📄'}</span><div class="tt2"><a href="${base}/repo/${esc(slug)}/${esc(f.path)}">${esc(f.path)}</a></div><span class="muted small ellip">${esc(commitById.get(f.commit)?.message || '')}</span><span class="d">${fmtDate(f.at)}</span></div>`).join('') || '<div class="pf-row"><div class="tt2"><p>Empty repository.</p></div></div>'}</div>
        ${readme ? `<div class="pf-readme mt"><div class="file">README.md</div><div class="md">${md(readme.content)}</div></div>` : ''}`}
    </section>
    <section id="r-commits" hidden><div class="pf-list">${[...repo.commits].reverse().map((c) => `<div class="pf-row"><div class="tt2"><a>${esc(c.message)}</a><p>${c.changes.map((x) => esc(x.path) + (x.delete ? ' (deleted)' : '')).join(', ')}</p></div><span class="mono small" data-verify="${esc(c.id)}">${esc(c.id.slice(0, 7))}</span><span class="d">${fmtWhen(c.at)}</span></div>`).join('') || '<div class="pf-row"><div class="tt2"><p>No commits yet.</p></div></div>'}</div>
      <p class="muted small mt">Each commit id is a SHA-256 of its parent, message, changes and time, so the history can't be quietly rewritten. ✓ means this browser re-checked it. The author is proven by the signed NIP-59 seal.</p></section>
    <section id="r-feedback" hidden><div class="pf-list">${fb.map((c) => feedbackRow(m, c)).join('') || '<div class="pf-row"><div class="tt2"><p>No feedback yet.</p></div></div>'}</div>
      ${m.demo ? '' : `<textarea id="fbt" class="mt" placeholder="Feedback for ${esc(repo.name)}"></textarea><button class="btn sm mt" id="fbs">Send feedback</button>`}</section>
  </div></div>`);
  $$('.pf-repo-tabs .pf-tab').forEach((b) => b.onclick = () => { $$('.pf-repo-tabs .pf-tab').forEach((x) => x.setAttribute('aria-selected', String(x === b))); ['code', 'commits', 'feedback'].forEach((k) => ($('#r-' + k).hidden = k !== b.dataset.r)); });
  Promise.all(repo.commits.map(async (c) => { const ok = await verifyCommit(c); const el = $(`[data-verify="${c.id}"]`); if (el) el.textContent = (ok ? '✓ ' : '✗ ') + c.id.slice(0, 7); }));
  if (isImg(file) && !m.demo) N.fetchEncrypted(file.blob).then((u) => { const i = $('#blobimg'); if (i) i.src = u; }).catch((e) => toast(e.message, true));
  if ($('#dlblob')) $('#dlblob').onclick = async () => { try { const u = await N.fetchEncrypted(file.blob); const a = document.createElement('a'); a.href = u; a.download = file.blob.name || path.split('/').pop(); a.click(); } catch (e) { toast(e.message, true); } };
  hydrateImages(document, m, slug);
  if ($('#fbs')) $('#fbs').onclick = async () => { const t = $('#fbt').value.trim(); if (!t) return; try { await comment(m.access, slug, t, path); toast('Feedback sent ✓'); rerender(m); } catch (e) { toast(e.message, true); } };
  if (!m.canEdit) return;
  $('#addf').onclick = () => editFile(m, slug, '');
  $('#pin').onclick = async () => { try { await saveRepo(m.access, { ...repo, pinned: !repo.pinned }); toast(repo.pinned ? 'Unpinned' : 'Pinned ✓'); rerender(m); } catch (e) { toast(e.message, true); } };
  if ($('#editf')) $('#editf').onclick = () => (file.blob ? toast('Upload a new version with Add file and the same path') : editFile(m, slug, path));
  if ($('#delf')) $('#delf').onclick = async () => {
    if (!confirm(`Delete ${path}? It stays in the commit history.`)) return;
    try { await doCommit(m, slug, `Delete ${path}`, [{ path, delete: true }]); toast('Deleted ✓'); location.hash = `${base}/repo/${slug}`; } catch (e) { toast(e.message, true); }
  };
}

// ---------- learner rows (like the Consensus21 roster) ----------
export function learnerRow(href, pk, name, age, tagline, counts, colour) {
  return `<a class="lrow" href="${href}" style="--c:${colour || '#38bdf8'}">${avatar(pk, 64)}
    <div><span class="tag">${stageOf(age)}${age ? ' · age ' + esc(age) : ''}</span><b>${esc(name)}</b><small>${esc(tagline || '')}</small></div>${miniHeat(counts || {})}</a>`;
}

// Portfolios I can open: my learners (parents), my guided learners (guides), or me (learner).
export async function portfoliosView() {
  if (S.role === 'learner') return (location.hash = '#/me');
  loading('Decrypting your learners\' portfolios…');
  const pks = S.role === 'parent' ? (S.settings.children || []).map((c) => c.pubkey) : (await myLearners()).map((a) => a.pubkey);
  const accesses = (await Promise.all(pks.map((pk) => learnerAccess(pk)))).filter(Boolean);
  const rows = await Promise.all(accesses.map(async (a) => {
    const rumors = await circleRumors(a);
    const pf = portfolioFrom(a, rumors);
    return learnerRow(`#/u/${N.npub(a.pubkey)}`, a.pubkey, a.name || 'Learner', a.age, a.data?.project?.title || `${pf.commits.length} commits`, countsFrom(pf, a.data, a.pubkey), TT_COLOURS[['explore', 'fit', 'sip', 'ai', 'family'][parseInt(a.pubkey.slice(0, 2), 16) % 5]]);
  }));
  view(`<div class="pfp"><section class="wrap pf-directory">
    <div class="eyebrow">Learner profiles</div><h1 class="h2">${S.role === 'parent' ? 'Your learners' : 'Learners you guide'}</h1>
    <p class="lede">Each profile is built from the learner's own encrypted git history on Nostr: projects, reflections, Explorers Days and SIPs. Only the learner, their parents and their guide can open it.</p>
    <div class="roster mt">${rows.join('') || `<p class="muted">${S.role === 'parent' ? 'No learners yet. <a href="#/family">Add one on your Family page.</a>' : 'No learners have chosen you as their guide yet.'}</p>`}</div>
    <p class="muted small mt">Want to see what a full profile looks like? <a href="#/demo">Browse the example learners</a>.</p>
  </section></div>`);
}

// ---------- example learners (made-up data, shown on the public site) ----------
export const DEMOS = [
  { id: 'cosmic-otter', name: 'CosmicOtter27', age: 14, pk: 'a3f19c22be0177d5e8c1aa4421b2c3d4e5f60718293a4b5c6d7e8f9012345678', colour: '#38bdf8', tag: 'A weather station for the community garden', project: ['skywatch', 'Solar weather station that posts readings to the garden shed screen.', 'C++'], second: ['rain-game', 'A MakeCode game where you catch rain for the tank.', 'MakeCode'] },
  { id: 'pixel-wombat', name: 'PixelWombat61', age: 16, pk: '5d02e7b1c9a4f3e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4', colour: '#a3e635', tag: 'Selling stickers for sats at the market', project: ['sticker-shop', 'A Lightning-powered sticker stall with a tablet checkout.', 'JavaScript'], second: ['pricing', 'Spreadsheets and notes on what to charge.', 'Markdown'] },
  { id: 'brave-falcon', name: 'BraveFalcon33', age: 12, pk: '9be4c1a07f2d6e5b8c3a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c', colour: '#fde047', tag: 'A Minecraft castle no one can break into', project: ['castle-defence', 'Red vs Blue castle with redstone traps and a hidden treasure room.', 'Minecraft'], second: ['network-map', 'How our castle network works, drawn as a map.', 'Markdown'] },
  { id: 'lucky-comet', name: 'LuckyComet08', age: 8, pk: '1c7a3e5f9b2d4c6e8a0f1b3d5c7e9a2b4d6f8c0e1a3b5d7f9c2e4a6b8d0f1c3e', colour: '#fdba74', tag: 'Birds, bugs and a bug-hotel camera', project: ['bug-hotel', 'A camera in the bug hotel that takes a photo when something moves.', 'Python'], second: ['bird-list', 'Every bird I have seen this year.', 'Markdown'] },
];

function seeded(seed) { let s = parseInt(seed.slice(0, 8), 16) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function demoModel(d, school) {
  const rnd = seeded(d.pk);
  const counts = {};
  const now = Date.now();
  for (let i = 0; i < 365; i++) { const r = rnd(); const day = new Date(now - i * 86400000); const wk = day.getDay() % 6 !== 0; if (r < (wk ? 0.62 : 0.15)) counts[ymd(day)] = Math.ceil(rnd() * (d.age > 12 ? 9 : 5)); }
  const ago = (n) => Math.floor(now / 1000) - n * 86400;
  const mkRepo = ([slug, desc, lang], n, pinned) => ({ slug, name: slug, description: desc, language: lang, pinned, updated: ago(Math.floor(rnd() * 9)), files: new Map([['README.md', { path: 'README.md', content: `# ${slug}\n\n${desc}`, at: ago(20), commit: 'c' }]]), commits: [...Array(n)].map((_, i) => ({ id: (d.pk.slice(i, i + 40) + '0'.repeat(40)).slice(0, 40), message: ['Initial commit', 'Add sensor notes', 'Fix the bug Dad found', 'Tidy README', 'Add photos from testing', 'Try a new idea'][i % 6], changes: [{ path: 'README.md' }], at: ago(n - i), repo: slug, parent: '' })) });
  const doc = (dir, title, days, body, extra = {}) => ({ path: `${dir}/${title}.md`, title, date: ymd(new Date((ago(days)) * 1000)), summary: body, body, at: ago(days), ...extra });
  const main = mkRepo([MAIN_REPO, 'My Consensus21 portfolio: README, Explorers Days, reflections and SIPs.', 'Markdown'], 14, false);
  const reflections = [doc('reflections', `Week ${weekNo() - 1}: it finally worked`, 6, 'Spent most of studio time debugging. It was a loose wire, not my code.'), doc('reflections', `Week ${weekNo() - 2}: asking for help`, 13, 'My guide showed me how to break the problem into smaller steps.'), doc('reflections', `Week ${weekNo() - 3}: first prototype`, 20, 'Ugly but it works. Next is making it waterproof.')];
  const explorers = [doc('explorers', 'Library maker space', 3, 'Used the 3D printer for the first time and printed a case.'), doc('explorers', 'Coastal walk with a ranger', 24, 'Learned which plants hold the dunes together.')];
  const sips = [doc('sips', 'Longer project studio on Fridays', 9, 'Two hours is not enough to finish a build. Proposing three.', { number: 4, status: 'accepted' }), doc('sips', 'A shared parts library', 30, 'Everyone buys the same sensors. Let\'s share them.', { number: 7, status: 'draft' })];
  main.files.set('README.md', { path: 'README.md', content: `# Hi, I'm ${d.name} 👋\n\nThis is an **example** learner. Real portfolios look just like this, but they are encrypted so only the learner, their parents and their guide can read them.\n\nRight now I'm building **${d.project[0]}**: ${d.project[1]}`, at: ago(2), commit: 'c' });
  const doneLessons = ALL_LESSONS.filter(() => rnd() < (d.age > 12 ? 0.55 : 0.35)).map((l) => l.id);
  const repos = new Map([[d.project[0], mkRepo(d.project, 18, true)], [d.second[0], mkRepo(d.second, 6, true)], [MAIN_REPO, main]]);
  const monday = mondayOf();
  const at = (day, h) => { const x = new Date(monday); x.setDate(x.getDate() + day); x.setHours(h, 0, 0, 0); return Math.floor(x / 1000); };
  return {
    demo: d.id, access: { pubkey: d.pk, circle: [d.pk, 'p1', 'p2', 'g'], parents: ['p1', 'p2'], guide: 'g' }, pubkey: d.pk, name: d.name, age: d.age,
    data: { done: Object.fromEntries(doneLessons.map((id) => [id, ago(Math.floor(rnd() * 200))])), project: { title: d.project[0], stage: 'build', next: 'show it at Friday show and tell' }, calendar: [{ id: 'b1', day: 2, start: '15:00', end: '16:00', title: 'Footy training' }] },
    portfolio: { repos, commits: [...repos.values()].flatMap((r) => r.commits), comments: [] },
    readme: main.files.get('README.md').content, explorers, reflections, sips, counts,
    events: [{ id: 'e1', title: '1:1 with guide', start: at(3, 14), end: at(3, 15), type: 'guide', private: true }, { id: 'e2', title: 'Dentist', start: at(4, 15), end: at(4, 16), type: 'family', private: true }],
    parentNames: ['Parent 1', 'Parent 2'], guideName: 'Kieran', canEdit: false, schoolEvents: school,
  };
}

export async function demoView(id, tab, ...rest) {
  const d = DEMOS.find((x) => x.id === id) || DEMOS[0];
  const school = await c21Calendar();
  const m = demoModel(d, school);
  if (tab === 'repo') return repoView(m, rest[0], rest.slice(1).join('/'));
  const switcher = `<div class="pf-switch"><span class="muted">Example learners</span>${DEMOS.map((x) => `<a href="#/demo/${x.id}" title="${esc(x.name)}" ${x.id === d.id ? 'aria-current="true"' : ''}>${avatar(x.pk, 40)}</a>`).join('')}<span class="pf-pill">Made-up data</span></div>`;
  renderProfile(m, tab || 'overview', { switcher });
}
