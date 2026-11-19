// Session and data layer: who is logged in, their encrypted settings and learning data,
// learner "circles" (learner + parents + guide), private git portfolios and private calendars.
import * as N from './nostr.js';
import { SITE } from './config.js';
import { DEFAULT_WEEK } from './lessons.js';
import { zonedToUnix, mondayOf, ymd } from './ui.js';

export const S = {
  signer: null,      // current signer
  role: null,        // 'parent' | 'learner' | 'guide' | 'staff'
  settings: null,    // encrypted c21/settings
  learner: null,     // encrypted c21/learner (learners only)
};

const LS = { login: 'c21_login', ncrypt: 'c21_ncryptsec', session: 'c21_session_sk', bunker: 'c21_bunker' };

// ---------- login / logout ----------
export async function restoreSession(askPassword) {
  const kind = localStorage.getItem(LS.login);
  if (!kind) return false;
  try {
    if (kind === 'nip07') S.signer = await N.extensionSigner();
    else if (kind === 'nip46') { const b = JSON.parse(localStorage.getItem(LS.bunker)); S.signer = await N.bunkerSigner(b.input, b.client); }
    else if (kind === 'local') {
      const sess = sessionStorage.getItem(LS.session);
      if (sess) S.signer = N.localSigner(N.hexToBytes(sess));
      else {
        const pw = await askPassword();
        if (!pw) return false;
        loginLocal(localStorage.getItem(LS.ncrypt), pw);
      }
    }
  } catch (e) { console.warn(e); return false; }
  return !!S.signer;
}

export function loginLocal(ncryptsec, password) {
  const sk = N.unlockKey(ncryptsec, password); // throws on a wrong password
  S.signer = N.localSigner(sk);
  localStorage.setItem(LS.login, 'local');
  localStorage.setItem(LS.ncrypt, ncryptsec);
  sessionStorage.setItem(LS.session, N.bytesToHex(sk)); // cleared when the tab closes
}
export async function loginExtension() { S.signer = await N.extensionSigner(); localStorage.setItem(LS.login, 'nip07'); }
export async function loginBunker(input) {
  S.signer = await N.bunkerSigner(input);
  localStorage.setItem(LS.login, 'nip46');
  localStorage.setItem(LS.bunker, JSON.stringify({ input, client: S.signer.clientSkHex }));
}
export function createLocalAccount(password) {
  const sk = N.generateSecretKey();
  const ncryptsec = N.lockKey(sk, password);
  loginLocal(ncryptsec, password);
  return ncryptsec;
}
export function logout() {
  Object.values(LS).forEach((k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
  Object.assign(S, { signer: null, role: null, settings: null, learner: null });
  N.resetInbox();
}
export const savedNcryptsec = () => localStorage.getItem(LS.ncrypt);

// ---------- settings and role ----------
export async function loadAccount() {
  S.settings = await N.getPrivate(S.signer, 'c21/settings');
  if (N.STAFF.includes(S.signer.pubkey)) S.role = 'staff';
  else S.role = S.settings?.role || null;
  if (S.role === 'learner') {
    // Older accounts had one parent and an on/off mentor switch.
    if (!S.settings.parents && S.settings.parent) S.settings.parents = [S.settings.parent];
    if (S.settings.guide === undefined) S.settings.guide = S.settings.shareMentor === false ? null : N.STAFF[0];
    S.learner = (await N.getPrivate(S.signer, 'c21/learner')) || emptyLearner();
  }
  N.loadInbox(S.signer); // start unwrapping private events in the background
  return S.role;
}
export async function saveSettings(patch) {
  S.settings = { ...(S.settings || {}), ...patch };
  await N.setPrivate(S.signer, 'c21/settings', S.settings);
}

export const emptyLearner = () => ({ done: {}, notes: {}, project: { title: '', stage: 'discover', next: '', desc: '' }, calendar: [], payments: [] });

// ---------- circles ----------
// A learner's circle is the only group that can read their portfolio, calendar and progress.
export const circleFrom = (learnerPk, parents = [], guide = null) => [...new Set([learnerPk, ...parents, ...(guide ? [guide] : [])].filter(Boolean))];
export const myCircle = () => circleFrom(S.signer.pubkey, S.settings?.parents, S.settings?.guide);

// Learner data is saved privately, then shared (encrypted) with each parent and the guide.
let saveTimer;
export function saveLearner(now = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    const circle = myCircle();
    const data = { ...S.learner, name: S.settings?.name, age: S.settings?.age, circle, parents: S.settings?.parents || [], guide: S.settings?.guide || null, updated: N.now() };
    await N.setPrivate(S.signer, 'c21/learner', data);
    for (const pk of circle) if (pk !== S.signer.pubkey) await N.shareWith(S.signer, pk, data);
  };
  if (now) return run();
  saveTimer = setTimeout(() => run().catch((e) => console.warn('save failed', e)), 1200);
}

// Who can I see? Returns { pubkey, name, age, circle, data } for a learner I'm allowed to open.
const accessCache = new Map();
export async function learnerAccess(learnerPk, { fresh = false } = {}) {
  const me = S.signer?.pubkey;
  if (!me) return null;
  if (learnerPk === me && S.role === 'learner') {
    return { pubkey: me, name: S.settings?.name, age: S.settings?.age, circle: myCircle(), parents: S.settings?.parents || [], guide: S.settings?.guide, data: S.learner, self: true };
  }
  if (!fresh && accessCache.has(learnerPk)) return accessCache.get(learnerPk);
  const p = (async () => {
    const d = await N.readShare(S.signer, learnerPk);
    const kid = S.settings?.children?.find((c) => c.pubkey === learnerPk);
    if (!d && !kid) return null;
    const parents = d?.parents || (d?.parent ? [d.parent] : kid ? [me] : []);
    const guide = d?.guide !== undefined ? d.guide : kid?.guide || null;
    const circle = d?.circle || circleFrom(learnerPk, parents, guide);
    if (!circle.includes(me)) return null;
    return { pubkey: learnerPk, name: d?.name || kid?.name, age: d?.age || kid?.age, circle, parents, guide, data: d || null, kid };
  })();
  accessCache.set(learnerPk, p);
  return p;
}

// A parent creates a learner (or links a key the learner already has), locked with a password the parent chooses.
export async function createLearner({ name, age, password, guide, existingSk }) {
  const sk = existingSk || N.generateSecretKey();
  const child = N.localSigner(sk);
  const ncryptsec = N.lockKey(sk, password);
  const parent = S.signer.pubkey;
  const settings = { role: 'learner', name, age: Number(age) || null, parents: [parent], guide: guide || null };
  // No public profile is published for learners: nothing about a child is readable on relays.
  await N.setPrivate(child, 'c21/settings', settings);
  const circle = circleFrom(child.pubkey, [parent], guide);
  const data = { ...emptyLearner(), name, age: settings.age, circle, parents: [parent], guide: guide || null, updated: N.now() };
  await N.setPrivate(child, 'c21/learner', data);
  for (const pk of circle) if (pk !== child.pubkey) await N.shareWith(child, pk, data);
  if (guide) await N.sendPrivate(child, [parent, guide], `New learner joined: ${name}${age ? `, age ${age}` : ''}. You're their guide.`, [['c21', 'enrol']]);
  const children = [...(S.settings?.children || []).filter((c) => c.pubkey !== child.pubkey), { pubkey: child.pubkey, name, age: Number(age) || null, ncryptsec, guide: guide || null, coParents: [] }];
  await saveSettings({ children });
  return { pubkey: child.pubkey, ncryptsec };
}

// Parent unlocks a learner key (needs the learner's password) to change guide, co-parents or password.
export async function updateLearnerSettings(childEntry, password, { guide, coParents }, newPassword) {
  const sk = N.unlockKey(childEntry.ncryptsec, password);
  const child = N.localSigner(sk);
  const me = S.signer.pubkey;
  const current = (await N.getPrivate(child, 'c21/settings')) || { role: 'learner', name: childEntry.name, age: childEntry.age };
  // Removing someone stops future sharing. It can't take back what they already read.
  const removed = (childEntry.coParents || []).filter((p) => !(coParents || []).includes(p));
  const base = (current.parents || (current.parent ? [current.parent] : [me])).filter((p) => !removed.includes(p));
  const parents = [...new Set([...base, me, ...(coParents || [])])];
  const next = { ...current, parents, guide: guide || null };
  delete next.parent; delete next.shareMentor; delete next.publicPortfolio;
  await N.setPrivate(child, 'c21/settings', next);
  const prev = (await N.getPrivate(child, 'c21/learner')) || emptyLearner();
  const oldCircle = circleFrom(child.pubkey, current.parents || (current.parent ? [current.parent] : [me]), current.guide !== undefined ? current.guide : childEntry.guide);
  const circle = circleFrom(child.pubkey, parents, next.guide);
  // New members can't read anything sealed before they joined, so re-seal the history for them:
  // everything the learner wrote (we hold their key right now) and everything I wrote.
  const added = circle.filter((pk) => !oldCircle.includes(pk));
  if (added.length) {
    const history = await circleRumors({ pubkey: child.pubkey, circle: oldCircle });
    for (const r of history) {
      if (r.pubkey === child.pubkey) await N.sealFor(child, r, added);
      else if (r.pubkey === me) await N.sealFor(S.signer, r, added);
    }
  }
  const data = { ...prev, name: next.name, age: next.age, circle, parents, guide: next.guide, updated: N.now() };
  await N.setPrivate(child, 'c21/learner', data);
  for (const pk of circle) if (pk !== child.pubkey) await N.shareWith(child, pk, data);
  if (next.guide && next.guide !== current.guide) await N.sendPrivate(child, [me, next.guide], `${next.name} has a new guide. Welcome!`, [['c21', 'enrol']]);
  const newCo = (coParents || []).filter((p) => !(childEntry.coParents || []).includes(p));
  const ncryptsec = newPassword ? N.lockKey(sk, newPassword) : childEntry.ncryptsec;
  // Tell each new co-parent: their app adds the learner to their Family page.
  for (const co of newCo) await N.sendPrivate(S.signer, [co], `You've been added as a parent of ${next.name} on C21 Online.`, [['c21', 'family-link'], ['learner', child.pubkey, next.name, String(next.age || ''), ncryptsec]]);
  const children = S.settings.children.map((c) => (c.pubkey === childEntry.pubkey ? { ...c, guide: next.guide, coParents: coParents || [], ncryptsec } : c));
  accessCache.delete(child.pubkey);
  await saveSettings({ children });
}

// Learners another parent linked me to (family-link messages), added to my Family page.
export async function acceptFamilyLinks() {
  const rumors = await N.loadInbox(S.signer);
  const have = new Set((S.settings.children || []).map((c) => c.pubkey));
  const add = [];
  for (const r of rumors) {
    if (r.kind !== 14 || !r.tags.some((t) => t[0] === 'c21' && t[1] === 'family-link')) continue;
    const t = r.tags.find((x) => x[0] === 'learner');
    if (!t || have.has(t[1])) continue;
    have.add(t[1]);
    add.push({ pubkey: t[1], name: t[2], age: Number(t[3]) || null, ncryptsec: t[4], coParents: [r.pubkey], linkedBy: r.pubkey });
  }
  if (add.length) await saveSettings({ children: [...(S.settings.children || []), ...add] });
  return add;
}

// Learners whose guide I am (enrol messages), for guides and staff.
export async function myLearners() {
  const rumors = await N.loadInbox(S.signer);
  const pks = new Set();
  for (const r of rumors) if (r.kind === 14 && r.tags.some((t) => t[0] === 'c21' && t[1] === 'enrol')) pks.add(r.pubkey);
  const out = await Promise.all([...pks].map((pk) => learnerAccess(pk)));
  return out.filter((a) => a && a.guide === S.signer.pubkey);
}

// ---------- private circle events (NIP-59 gift wraps) ----------
// Every rumor carries ['learner', pubkey] so a parent with two learners knows whose it is.
export function sendToCircle(access, template) {
  return N.wrapTo(S.signer, access.circle, { ...template, tags: [['learner', access.pubkey], ...(template.tags || [])] });
}
export async function circleRumors(access, { refresh = false } = {}) {
  const all = await N.loadInbox(S.signer, { refresh });
  return all.filter((r) => r.tags.some((t) => t[0] === 'learner' && t[1] === access.pubkey) && access.circle.includes(r.pubkey));
}

// ---------- portfolio: private git (NIP-34 kinds inside gift wraps) ----------
// kind 30617 = repository, kind 1617 = commit (a patch), kind 1111 = feedback comment.
// Only the learner can write repos and commits. Each commit id is a SHA-256 over its parent,
// message, changes and time, so the history is a verifiable chain like git.
export const MAIN_REPO = 'c21';
const tagv = (e, n) => e.tags.find((t) => t[0] === n)?.[1];

export async function commitId({ repo, parent, message, changes, at }) {
  return (await N.sha256hex(JSON.stringify([repo, parent || '', message, changes, at]))).slice(0, 40);
}

export function portfolioFrom(access, rumors) {
  const own = rumors.filter((r) => r.pubkey === access.pubkey);
  const repoMap = new Map();
  for (const r of own.filter((x) => x.kind === 30617)) {
    const d = tagv(r, 'd');
    if (!repoMap.has(d) || repoMap.get(d).created_at < r.created_at) repoMap.set(d, r);
  }
  const commits = own.filter((x) => x.kind === 1617 && tagv(x, 'commit')).map((r) => {
    let body = {}; try { body = JSON.parse(r.content); } catch {}
    return { id: tagv(r, 'commit'), parent: tagv(r, 'parent-commit') || '', repo: (tagv(r, 'a') || '').split(':')[2], at: r.created_at, message: body.message || '', changes: body.changes || [], rumor: r };
  }).sort((a, b) => a.at - b.at);
  const repos = new Map();
  const ensure = (slug) => {
    if (!repos.has(slug)) {
      const ev = repoMap.get(slug);
      repos.set(slug, { slug, name: ev ? tagv(ev, 'name') || slug : slug, description: ev ? tagv(ev, 'description') || '' : (slug === MAIN_REPO ? 'My Consensus21 portfolio: README, Explorers Days, reflections and SIPs.' : ''),
        language: ev ? tagv(ev, 'language') || '' : 'Markdown', pinned: ev ? tagv(ev, 'pinned') === 'true' : false, created: ev?.created_at || 0, files: new Map(), commits: [], updated: ev?.created_at || 0 });
    }
    return repos.get(slug);
  };
  [...repoMap.keys()].forEach(ensure);
  for (const c of commits) {
    const repo = ensure(c.repo);
    for (const ch of c.changes) {
      if (ch.delete) repo.files.delete(ch.path);
      else repo.files.set(ch.path, { path: ch.path, content: ch.content, blob: ch.blob || null, at: c.at, commit: c.id });
    }
    repo.commits.push(c);
    repo.updated = Math.max(repo.updated, c.at);
  }
  const comments = rumors.filter((r) => r.kind === 1111).sort((a, b) => a.created_at - b.created_at);
  return { repos, commits, comments };
}

export async function verifyCommit(c) {
  return (await commitId({ repo: c.repo, parent: c.parent, message: c.message, changes: c.changes, at: c.at })) === c.id;
}

export async function saveRepo(access, { slug, name, description, language, pinned }) {
  return sendToCircle(access, { kind: 30617, content: '', tags: [['d', slug], ['name', name || slug], ['description', description || ''], ['language', language || ''], ['pinned', pinned ? 'true' : 'false'], ['t', 'c21-portfolio'], ['alt', 'Private C21 portfolio repository']] });
}

export async function commit(access, portfolio, slug, message, changes) {
  const repo = portfolio.repos.get(slug);
  if (!repo) await saveRepo(access, { slug, name: slug, description: slug === MAIN_REPO ? 'My Consensus21 portfolio: README, Explorers Days, reflections and SIPs.' : '', language: 'Markdown', pinned: slug === MAIN_REPO });
  const parent = repo?.commits.at(-1)?.id || '';
  const at = N.now();
  const id = await commitId({ repo: slug, parent, message, changes, at });
  return sendToCircle(access, { kind: 1617, created_at: at, content: JSON.stringify({ message, changes }),
    tags: [['a', `30617:${access.pubkey}:${slug}`], ['commit', id], ['parent-commit', parent], ['t', 'c21-commit'], ['alt', 'Private C21 portfolio commit']] });
}

export function comment(access, slug, text, path = '') {
  const addr = `30617:${access.pubkey}:${slug}`;
  return sendToCircle(access, { kind: 1111, content: text, tags: [['A', addr], ['K', '30617'], ['P', access.pubkey], ['a', addr], ['k', '30617'], ['p', access.pubkey], ...(path ? [['path', path]] : []), ['t', 'c21-feedback']] });
}

// Front matter: --- key: value --- then Markdown.
export function parseDoc(text = '') {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (m) m[1].split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  const body = m ? m[2] : text;
  if (!meta.title) meta.title = body.match(/^#\s+(.+)$/m)?.[1] || '';
  return { meta, body };
}
export const makeDoc = (meta, body) => `---\n${Object.entries(meta).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`).join('\n')}\n---\n${body}\n`;
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'untitled';

// ---------- private calendar (NIP-52 kind 31923 inside gift wraps) ----------
// Anyone in the circle can add to a learner's calendar. Latest version per d tag wins;
// a version with ['status', 'cancelled'] removes the event.
export function privateEvents(access, rumors) {
  const byD = new Map();
  for (const r of rumors.filter((x) => x.kind === 31923)) {
    const d = tagv(r, 'd');
    if (!byD.has(d) || byD.get(d).created_at < r.created_at) byD.set(d, r);
  }
  return [...byD.values()].filter((r) => tagv(r, 'status') !== 'cancelled').map((r) => ({
    id: tagv(r, 'd'), title: tagv(r, 'title'), start: Number(tagv(r, 'start')), end: Number(tagv(r, 'end')) || 0, description: r.content,
    type: tagv(r, 'c21type') || 'mine', by: r.pubkey, private: true,
  })).filter((e) => e.start).sort((a, b) => a.start - b.start);
}
export function savePrivateEvent(access, { id, title, start, end, description, type }) {
  const d = id || 'c21-' + Math.random().toString(36).slice(2, 12);
  return sendToCircle(access, { kind: 31923, content: description || '', tags: [['d', d], ['title', title], ['start', String(start)], ['end', String(end || start + 3600)],
    ['start_tzid', Intl.DateTimeFormat().resolvedOptions().timeZone], ['c21type', type || 'mine'], ['alt', 'Private C21 calendar event']] });
}
export function cancelPrivateEvent(access, ev) {
  return sendToCircle(access, { kind: 31923, content: '', tags: [['d', ev.id], ['title', ev.title], ['start', String(ev.start)], ['status', 'cancelled']] });
}

// Weekly blocks the learner set (from their encrypted learner data) as real times this week.
export function weeklyBlocks(data, monday = mondayOf()) {
  return (data?.calendar || []).map((b) => {
    const d = new Date(monday); d.setDate(d.getDate() + Number(b.day) - 1);
    const [sh, sm] = b.start.split(':').map(Number), [eh, em] = b.end.split(':').map(Number);
    const s = new Date(d); s.setHours(sh, sm); const e = new Date(d); e.setHours(eh, em);
    return { id: b.id, title: b.title, type: 'mine', mine: true, start: Math.floor(s / 1000), end: Math.floor(e / 1000) };
  });
}

// ---------- shared public content ----------
export async function weeklyVideos(onEvent) {
  const evs = await N.query({ kinds: [21, 22], authors: N.STAFF, '#t': ['c21-weekly'], limit: 20 }, { onEvent });
  return evs.sort((a, b) => b.created_at - a.created_at);
}

export function videoInfo(ev) {
  const tag = (n) => ev.tags.find((t) => t[0] === n)?.[1];
  const imeta = ev.tags.find((t) => t[0] === 'imeta');
  const fields = imeta ? Object.fromEntries(imeta.slice(1).map((s) => [s.split(' ')[0], s.split(' ').slice(1).join(' ')])) : {};
  return { title: tag('title') || 'Weekly update', url: fields.url || tag('r') || tag('url'), mime: fields.m, notes: ev.content, at: Number(tag('published_at')) || ev.created_at };
}

// The C21 school week (NIP-52), published by Kieran. This is the public timetable, not personal data.
let calCache;
export function c21Calendar() {
  calCache ||= (async () => {
    const cal = N.latest(await N.query({ kinds: [31924], authors: N.STAFF, '#d': ['c21'], limit: 5 }));
    if (cal) {
      const ds = cal.tags.filter((t) => t[0] === 'a' && t[1].startsWith('31923:')).map((t) => t[1].split(':').slice(2).join(':'));
      if (ds.length) {
        const evs = await N.query({ kinds: [31923], authors: [cal.pubkey], '#d': ds, limit: 200 });
        const out = evs.map((e) => ({ id: tagv(e, 'd'), title: tagv(e, 'title'), start: Number(tagv(e, 'start')), end: Number(tagv(e, 'end')), type: e.tags.find((t) => t[0] === 't' && t[1] !== 'c21')?.[1] || 'core', description: e.content, source: 'nostr' }))
          .filter((e) => e.start).sort((a, b) => a.start - b.start);
        if (out.length) return out;
      }
    }
    return defaultWeekEvents(mondayOf());
  })();
  return calCache;
}

export function defaultWeekEvents(monday) {
  return DEFAULT_WEEK.map((b) => {
    const d = new Date(monday); d.setDate(d.getDate() + b.day - 1);
    return { id: `default-${b.day}-${b.start}`, title: b.title, type: b.type, start: zonedToUnix(ymd(d), b.start, SITE.timezone), end: zonedToUnix(ymd(d), b.end, SITE.timezone), source: 'default' };
  });
}

// The school week repeats: show it for any week by shifting the published week.
export function schoolWeek(events, monday) {
  const ref = mondayOf(new Date(events[0]?.start * 1000 || Date.now()));
  const shift = Math.round((monday - ref) / (7 * 86400000)) * 7 * 86400;
  return events.map((e) => ({ ...e, start: e.start + shift, end: e.end ? e.end + shift : 0, id: e.id + '@' + ymd(monday) }));
}

export async function publishWeek(monday, blocks) {
  const events = [];
  for (const b of blocks) {
    const d = new Date(monday); d.setDate(d.getDate() + b.day - 1);
    const date = ymd(d);
    const dTag = `c21-${date}-${b.start.replace(':', '')}-${b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 80);
    const ev = await N.publish(S.signer, { kind: 31923, content: b.description || '', tags: [
      ['d', dTag], ['title', b.title], ['start', String(zonedToUnix(date, b.start, SITE.timezone))], ['end', String(zonedToUnix(date, b.end, SITE.timezone))],
      ['start_tzid', SITE.timezone], ['end_tzid', SITE.timezone], ['location', 'C21 Online'], ['t', 'c21'], ['t', b.type || 'core']] });
    events.push(`31923:${ev.pubkey}:${dTag}`);
  }
  await N.publish(S.signer, { kind: 31924, content: 'The Consensus21 week: time management on Monday, core programs, project studio and SIP discussion.', tags: [['d', 'c21'], ['title', 'Consensus21 week'], ...events.map((a) => ['a', a])] });
  calCache = null;
}
