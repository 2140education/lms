// Session and data layer: who is logged in, their encrypted settings and learning data,
// and shared reads like the weekly video and the C21 calendar.
import * as N from './nostr.js';
import { RELAYS, GIT_RELAYS, SITE } from './config.js';
import { DEFAULT_WEEK } from './lessons.js';
import { zonedToUnix, mondayOf, ymd } from './ui.js';

export const S = {
  signer: null,      // current signer
  role: null,        // 'parent' | 'learner' | 'staff'
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
}
export const savedNcryptsec = () => localStorage.getItem(LS.ncrypt);

// ---------- settings and role ----------
export async function loadAccount() {
  S.settings = await N.getPrivate(S.signer, 'c21/settings');
  if (N.STAFF.includes(S.signer.pubkey)) S.role = 'staff';
  else S.role = S.settings?.role || null;
  if (S.role === 'learner') S.learner = (await N.getPrivate(S.signer, 'c21/learner')) || emptyLearner();
  return S.role;
}
export async function saveSettings(patch) {
  S.settings = { ...(S.settings || {}), ...patch };
  await N.setPrivate(S.signer, 'c21/settings', S.settings);
}

export const emptyLearner = () => ({ done: {}, notes: {}, project: { title: '', stage: 'discover', next: '', desc: '' }, calendar: [], drafts: [], payments: [] });

// Learner data is saved privately, then shared (encrypted) with the parent and, if allowed, mentors.
let saveTimer;
export function saveLearner(now = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    const data = { ...S.learner, name: S.settings?.name, updated: N.now() };
    await N.setPrivate(S.signer, 'c21/learner', data);
    if (S.settings?.parent) await N.shareWith(S.signer, S.settings.parent, data);
    if (S.settings?.shareMentor) for (const m of N.STAFF) await N.shareWith(S.signer, m, data);
  };
  if (now) return run();
  saveTimer = setTimeout(() => run().catch((e) => console.warn('save failed', e)), 1200);
}

// A parent creates a learner: new key, locked with a password the parent chooses.
export async function createLearner({ name, age, password, publicPortfolio, shareMentor }) {
  const sk = N.generateSecretKey();
  const child = N.localSigner(sk);
  const ncryptsec = N.lockKey(sk, password);
  const parent = S.signer.pubkey;
  const settings = { role: 'learner', name, age: Number(age) || null, parent, publicPortfolio: !!publicPortfolio, shareMentor: !!shareMentor };
  await N.publish(child, { kind: 0, content: JSON.stringify({ name, display_name: name, about: 'Consensus21 learner. Building in public, one project at a time.' }) });
  await N.setPrivate(child, 'c21/settings', settings);
  const data = { ...emptyLearner(), name, updated: N.now() };
  await N.setPrivate(child, 'c21/learner', data);
  await N.shareWith(child, parent, data);
  if (shareMentor) {
    for (const m of N.STAFF) await N.shareWith(child, m, data);
    await N.sendPrivate(child, [parent, ...N.STAFF], `New learner enrolled: ${name}${age ? `, age ${age}` : ''}.`, [['c21', 'enrol']]);
  }
  const children = [...(S.settings?.children || []), { pubkey: child.pubkey, name, age: Number(age) || null, ncryptsec, publicPortfolio: !!publicPortfolio, shareMentor: !!shareMentor }];
  await saveSettings({ children });
  return { pubkey: child.pubkey, ncryptsec };
}

// Parent unlocks a learner key (needs the learner's password) to change their settings.
export async function updateLearnerSettings(childEntry, password, patch, newPassword) {
  const sk = N.unlockKey(childEntry.ncryptsec, password);
  const child = N.localSigner(sk);
  const current = (await N.getPrivate(child, 'c21/settings')) || { role: 'learner', parent: S.signer.pubkey, name: childEntry.name };
  const next = { ...current, ...patch };
  await N.setPrivate(child, 'c21/settings', next);
  const children = S.settings.children.map((c) => (c.pubkey === childEntry.pubkey ? { ...c, ...patch, ncryptsec: newPassword ? N.lockKey(sk, newPassword) : c.ncryptsec } : c));
  await saveSettings({ children });
}

// ---------- shared content ----------
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

// C21 calendar (NIP-52): Kieran's calendar (kind 31924) lists time-based events (kind 31923).
export async function c21Calendar() {
  const cal = N.latest(await N.query({ kinds: [31924], authors: N.STAFF, '#d': ['c21'], limit: 5 }));
  if (cal) {
    const ds = cal.tags.filter((t) => t[0] === 'a' && t[1].startsWith('31923:')).map((t) => t[1].split(':').slice(2).join(':'));
    if (ds.length) {
      const evs = await N.query({ kinds: [31923], authors: [cal.pubkey], '#d': ds, limit: 200 });
      const tag = (e, n) => e.tags.find((t) => t[0] === n)?.[1];
      const out = evs.map((e) => ({ id: tag(e, 'd'), title: tag(e, 'title'), start: Number(tag(e, 'start')), end: Number(tag(e, 'end')), type: e.tags.find((t) => t[0] === 't' && t[1] !== 'c21')?.[1] || 'core', description: e.content, source: 'nostr' }))
        .filter((e) => e.start).sort((a, b) => a.start - b.start);
      if (out.length) return out;
    }
  }
  return defaultWeekEvents(mondayOf());
}

export function defaultWeekEvents(monday) {
  return DEFAULT_WEEK.map((b) => {
    const d = new Date(monday); d.setDate(d.getDate() + b.day - 1);
    return { id: `default-${b.day}-${b.start}`, title: b.title, type: b.type, start: zonedToUnix(ymd(d), b.start, SITE.timezone), end: zonedToUnix(ymd(d), b.end, SITE.timezone), source: 'default' };
  });
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
  await N.publish(S.signer, { kind: 31924, content: 'The Consensus21 week: Explorers Monday, core programs, project studio and SIP discussion.', tags: [['d', 'c21'], ['title', 'Consensus21 week'], ...events.map((a) => ['a', a])] });
}

// ---------- portfolio (NIP-34 git repositories) ----------
export const GIT_READ = [...new Set([...RELAYS, ...GIT_RELAYS])];
export async function reposOf(pubkey) {
  const evs = await N.query({ kinds: [30617], authors: [pubkey], limit: 100 }, { relays: GIT_READ });
  const byD = new Map();
  for (const e of evs) { const d = e.tags.find((t) => t[0] === 'd')?.[1]; if (!byD.has(d) || byD.get(d).created_at < e.created_at) byD.set(d, e); }
  return [...byD.values()].sort((a, b) => b.created_at - a.created_at);
}
export async function activityOf(pubkey) {
  const since = N.now() - 371 * 86400;
  return N.query({ kinds: [30617, 30618, 1617, 1618, 1621, 1630, 1631, 1632, 1633, 1111], authors: [pubkey], since, limit: 2000 }, { relays: GIT_READ, maxWait: 4500 });
}
export async function announceRepo({ slug, name, description, web, clone }) {
  const tags = [['d', slug], ['name', name], ['description', description], ['t', 'c21'], ['t', 'c21-portfolio'], ['relays', ...GIT_READ]];
  if (web) tags.push(['web', web]);
  if (clone) tags.push(['clone', clone]);
  return N.publish(S.signer, { kind: 30617, content: '', tags }, GIT_READ);
}
export async function postDevlog(repoAddr, text) {
  const pk = S.signer.pubkey;
  return N.publish(S.signer, { kind: 1111, content: text, tags: [['A', repoAddr], ['K', '30617'], ['P', pk], ['a', repoAddr], ['k', '30617'], ['p', pk], ['t', 'c21-devlog']] }, GIT_READ);
}
export async function devlogsOf(pubkey) {
  const evs = await N.query({ kinds: [1111], authors: [pubkey], '#t': ['c21-devlog'], limit: 200 }, { relays: GIT_READ });
  return evs.sort((a, b) => b.created_at - a.created_at);
}
