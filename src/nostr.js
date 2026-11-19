// Nostr plumbing: relay pool, signers (extension, remote signer, password-locked key),
// encrypted private data, NIP-17 private messages and Blossom uploads.
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, getEventHash, verifyEvent, nip19 } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip49 from 'nostr-tools/nip49';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { RELAYS, STAFF_NPUBS, BLOSSOM_SERVERS, PROFILE_RELAYS } from './config.js';

export const pool = new SimplePool();
export const STAFF = STAFF_NPUBS.map((n) => nip19.decode(n).data);
export const now = () => Math.floor(Date.now() / 1000);

// ---------- reading ----------
// Streams events as relays answer (fast first paint) and resolves after EOSE or a timeout.
export function query(filter, { relays = RELAYS, onEvent, maxWait = 3500 } = {}) {
  return new Promise((resolve) => {
    const seen = new Map();
    let done = false;
    const finish = () => { if (done) return; done = true; try { sub.close(); } catch {} resolve([...seen.values()]); };
    const sub = pool.subscribeManyEose(relays, filter, {
      maxWait,
      onevent: (e) => { if (seen.has(e.id)) return; seen.set(e.id, e); onEvent?.(e); },
      onclose: finish,
    });
    setTimeout(finish, maxWait + 300);
  });
}

// Latest version of a replaceable/addressable event.
export const latest = (events) => events.sort((a, b) => b.created_at - a.created_at)[0] || null;

const profileCache = new Map();
export async function profile(pubkey) {
  if (profileCache.has(pubkey)) return profileCache.get(pubkey);
  const p = query({ kinds: [0], authors: [pubkey], limit: 3 }, { relays: [...RELAYS, ...PROFILE_RELAYS], maxWait: 2500 })
    .then((evs) => { try { return JSON.parse(latest(evs)?.content || '{}'); } catch { return {}; } });
  profileCache.set(pubkey, p);
  return p;
}

// ---------- signers ----------
// Every signer exposes: type, pubkey, sign(template), encrypt(pubkey, text), decrypt(pubkey, ciphertext)
export function localSigner(sk) {
  const pubkey = getPublicKey(sk);
  const ck = (pk) => nip44.getConversationKey(sk, pk);
  return {
    type: 'local', pubkey, sk,
    sign: async (t) => finalizeEvent({ created_at: now(), tags: [], content: '', ...t }, sk),
    encrypt: async (pk, text) => nip44.encrypt(text, ck(pk)),
    decrypt: async (pk, ct) => nip44.decrypt(ct, ck(pk)),
  };
}

export async function extensionSigner() {
  if (!window.nostr) throw new Error('No Nostr extension found. Try Alby, nos2x or Nostash.');
  if (!window.nostr.nip44) throw new Error('Your extension needs NIP-44 encryption. Please update it.');
  const pubkey = await window.nostr.getPublicKey();
  return {
    type: 'nip07', pubkey,
    sign: (t) => window.nostr.signEvent({ created_at: now(), tags: [], content: '', ...t }),
    encrypt: (pk, text) => window.nostr.nip44.encrypt(pk, text),
    decrypt: (pk, ct) => window.nostr.nip44.decrypt(pk, ct),
  };
}

export async function bunkerSigner(input, clientSkHex) {
  const bp = await parseBunkerInput(input);
  if (!bp) throw new Error('That bunker link was not recognised.');
  const clientSk = clientSkHex ? hexToBytes(clientSkHex) : generateSecretKey();
  const b = BunkerSigner.fromBunker(clientSk, bp, { onauth: (url) => window.open(url, '_blank') });
  if (!clientSkHex) await b.connect();
  const pubkey = await b.getPublicKey();
  return {
    type: 'nip46', pubkey, bunker: input, clientSkHex: bytesToHex(clientSk),
    sign: (t) => b.signEvent({ created_at: now(), tags: [], content: '', ...t }),
    encrypt: (pk, text) => b.nip44Encrypt(pk, text),
    decrypt: (pk, ct) => b.nip44Decrypt(pk, ct),
  };
}

export const lockKey = (sk, password) => nip49.encrypt(sk, password, 16);
export const unlockKey = (ncryptsec, password) => nip49.decrypt(ncryptsec, password);

// ---------- writing ----------
// Resolves as soon as one relay accepts; the rest keep going in the background.
export async function publishAny(ev, relays = RELAYS) {
  try { await Promise.any(pool.publish(relays, ev)); return true; } catch { return false; }
}
export async function publish(signer, template, relays = RELAYS) {
  const ev = await signer.sign(template);
  if (!(await publishAny(ev, relays))) throw new Error('No relay accepted the event. Check your connection.');
  return ev;
}

// ---------- encrypted private data (kind 30078, NIP-78 + NIP-44) ----------
export async function sha16(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Data only I can read.
export async function getPrivate(signer, d) {
  const ev = latest(await query({ kinds: [30078], authors: [signer.pubkey], '#d': [d], limit: 5 }));
  if (!ev) return null;
  try { return JSON.parse(await signer.decrypt(signer.pubkey, ev.content)); } catch { return null; }
}
export async function setPrivate(signer, d, data) {
  const content = await signer.encrypt(signer.pubkey, JSON.stringify(data));
  return publish(signer, { kind: 30078, content, tags: [['d', d]] });
}

// A copy of my data that one other person (a parent or mentor) can read. The d tag is a hash,
// so nobody else can even tell who it is shared with.
export const shareTag = async (ownerPk, viewerPk) => 'c21/share/' + (await sha16(viewerPk + ':' + ownerPk));
export async function shareWith(signer, viewerPk, data) {
  const content = await signer.encrypt(viewerPk, JSON.stringify(data));
  return publish(signer, { kind: 30078, content, tags: [['d', await shareTag(signer.pubkey, viewerPk)]] });
}
export async function readShare(signer, ownerPk) {
  const d = await shareTag(ownerPk, signer.pubkey);
  const ev = latest(await query({ kinds: [30078], authors: [ownerPk], '#d': [d], limit: 3 }));
  if (!ev) return null;
  try { return { ...JSON.parse(await signer.decrypt(ownerPk, ev.content)), _updated: ev.created_at }; } catch { return null; }
}

// ---------- NIP-59 gift wraps: the private channel for messages, portfolios and calendars ----------
// A rumor (unsigned event) is sealed by the author (kind 13, signed, NIP-44 encrypted to one
// recipient) then wrapped by a throwaway key (kind 1059). Relays see only the recipient's
// p tag and a random timestamp: not the author, the kind, or the content.
const randomPast = () => now() - Math.floor(Math.random() * 172800);

export async function wrapTo(signer, recipients, template) {
  const rumor = { created_at: now(), tags: [], content: '', ...template, pubkey: signer.pubkey };
  rumor.id = getEventHash(rumor);
  await sealFor(signer, rumor, [...new Set([...recipients, signer.pubkey])]);
  inboxAdd(rumor);
  return rumor;
}

// Seal an existing rumor (same id, same time) for more people, e.g. a co-parent added later.
// Only the rumor's author can do this, because the seal carries the author's signature.
export async function sealFor(signer, rumor, recipients) {
  if (rumor.pubkey !== signer.pubkey) throw new Error('Only the author can re-seal this');
  const json = JSON.stringify(rumor);
  if (json.length > 60000) throw new Error('That is too big to send in one go. Try a smaller file.');
  const sends = [];
  for (const r of recipients) {
    const seal = await signer.sign({ kind: 13, created_at: randomPast(), tags: [], content: await signer.encrypt(r, json) });
    const eph = generateSecretKey();
    const wrap = finalizeEvent({ kind: 1059, created_at: randomPast(), tags: [['p', r]],
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(eph, r)) }, eph);
    sends.push(publishAny(wrap));
  }
  if (!(await Promise.all(sends)).some(Boolean)) throw new Error('No relay accepted the encrypted event. Check your connection.');
}

// NIP-17 chat message (kind 14) to a group.
export const sendPrivate = (signer, recipients, content, extraTags = []) =>
  wrapTo(signer, recipients, { kind: 14, content, tags: [...recipients.filter((p) => p !== signer.pubkey).map((p) => ['p', p]), ...extraTags] });

export async function unwrap(signer, wrap) {
  const seal = JSON.parse(await signer.decrypt(wrap.pubkey, wrap.content));
  if (seal.kind !== 13 || !verifyEvent(seal)) throw new Error('bad seal');
  const rumor = JSON.parse(await signer.decrypt(seal.pubkey, seal.content));
  if (rumor.pubkey !== seal.pubkey) throw new Error('forged sender');
  if (getEventHash(rumor) !== rumor.id) throw new Error('bad rumor id');
  return rumor;
}

// Everything addressed to me, unwrapped once and kept in memory for this tab.
const INBOX = { rumors: new Map(), seen: new Set(), loaded: null, owner: null, listeners: new Set() };
function inboxAdd(r) {
  if (INBOX.rumors.has(r.id)) return;
  INBOX.rumors.set(r.id, r);
  INBOX.listeners.forEach((fn) => { try { fn(r); } catch {} });
}
export const onInbox = (fn) => { INBOX.listeners.add(fn); return () => INBOX.listeners.delete(fn); };
export function resetInbox() { INBOX.rumors.clear(); INBOX.seen.clear(); INBOX.loaded = null; INBOX.owner = null; }

// Loads my gift wraps (paging back through history), unwraps them and resolves with every rumor.
export function loadInbox(signer, { refresh = false } = {}) {
  if (INBOX.owner !== signer.pubkey) { resetInbox(); INBOX.owner = signer.pubkey; }
  const current = () => [...INBOX.rumors.values()];
  if (INBOX.loaded && !refresh) return INBOX.loaded.then(current);
  INBOX.loaded = (async () => {
    let until;
    for (let page = 0; page < 8; page++) {
      const filter = { kinds: [1059], '#p': [signer.pubkey], limit: 500 };
      if (until) filter.until = until;
      const evs = await query(filter, { maxWait: 4000 });
      const fresh = evs.filter((w) => !INBOX.seen.has(w.id));
      await Promise.all(fresh.map(async (w) => {
        INBOX.seen.add(w.id);
        try { inboxAdd(await unwrap(signer, w)); } catch {}
      }));
      if (evs.length < 400) break;
      until = Math.min(...evs.map((e) => e.created_at)) - 1;
    }
  })();
  return INBOX.loaded.then(current);
}
export const inboxRumors = () => [...INBOX.rumors.values()];

// ---------- Blossom uploads (for weekly videos) ----------
export async function blossomUpload(signer, file, onStatus) {
  onStatus?.('Hashing video…');
  const buf = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const auth = await signer.sign({ kind: 24242, content: 'Upload C21 weekly video', tags: [['t', 'upload'], ['x', hash], ['expiration', String(now() + 600)]] });
  const header = 'Nostr ' + btoa(JSON.stringify(auth));
  let lastErr;
  for (const server of BLOSSOM_SERVERS) {
    try {
      onStatus?.(`Uploading to ${new URL(server).host}…`);
      const res = await fetch(server.replace(/\/$/, '') + '/upload', { method: 'PUT', headers: { authorization: header, 'content-type': file.type || 'video/mp4' }, body: buf });
      if (!res.ok) throw new Error(`${res.status} ${res.headers.get('x-reason') || res.statusText}`);
      const out = await res.json();
      return { url: out.url, sha256: hash, size: file.size, type: file.type || 'video/mp4' };
    } catch (e) { lastErr = e; }
  }
  throw new Error('Upload failed on every Blossom server: ' + lastErr?.message);
}

// Upload one blob to every Blossom server we can (used to publish the site itself).
export async function blossomMirror(signer, buf, type) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const auth = await signer.sign({ kind: 24242, content: 'Upload C21 Online site file', tags: [['t', 'upload'], ['x', hash], ['expiration', String(now() + 600)]] });
  const header = 'Nostr ' + btoa(JSON.stringify(auth));
  const ok = [];
  await Promise.all(BLOSSOM_SERVERS.map(async (server) => {
    try {
      const res = await fetch(server.replace(/\/$/, '') + '/upload', { method: 'PUT', headers: { authorization: header, 'content-type': type }, body: buf });
      if (res.ok) ok.push(server);
    } catch {}
  }));
  if (!ok.length) throw new Error('No Blossom server accepted the upload');
  return { hash, servers: ok };
}

// Encrypted attachments: AES-256-GCM in the browser, ciphertext to Blossom. The key lives only
// inside the (encrypted) portfolio commit, so Blossom servers store bytes nobody can read.
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
export async function uploadEncrypted(signer, file, onStatus) {
  onStatus?.('Encrypting…');
  const key = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ck = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, await file.arrayBuffer());
  const hash = hex(await crypto.subtle.digest('SHA-256', ct));
  const auth = await signer.sign({ kind: 24242, content: 'Upload encrypted C21 portfolio file', tags: [['t', 'upload'], ['x', hash], ['expiration', String(now() + 600)]] });
  const header = 'Nostr ' + btoa(JSON.stringify(auth));
  let lastErr;
  for (const server of BLOSSOM_SERVERS) {
    try {
      onStatus?.(`Uploading to ${new URL(server).host}…`);
      const res = await fetch(server.replace(/\/$/, '') + '/upload', { method: 'PUT', headers: { authorization: header, 'content-type': 'application/octet-stream' }, body: ct });
      if (!res.ok) throw new Error(`${res.status} ${res.headers.get('x-reason') || res.statusText}`);
      const out = await res.json();
      return { url: out.url, sha256: hash, key: hex(key), iv: hex(iv), type: file.type || 'application/octet-stream', size: file.size, name: file.name };
    } catch (e) { lastErr = e; }
  }
  throw new Error('Upload failed on every Blossom server: ' + lastErr?.message);
}
const blobCache = new Map();
export function fetchEncrypted(blob) {
  if (blobCache.has(blob.sha256)) return blobCache.get(blob.sha256);
  const p = (async () => {
    const ct = await fetch(blob.url).then((r) => { if (!r.ok) throw new Error('File not found on Blossom'); return r.arrayBuffer(); });
    if (hex(await crypto.subtle.digest('SHA-256', ct)) !== blob.sha256) throw new Error('File was changed on the server');
    const ck = await crypto.subtle.importKey('raw', unhex(blob.key), 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(blob.iv) }, ck, ct);
    return URL.createObjectURL(new Blob([pt], { type: blob.type }));
  })();
  blobCache.set(blob.sha256, p);
  return p;
}

export async function sha256hex(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

// nsite (NIP-5A) address for a named site: base36 pubkey + identifier.
export const nsiteUrl = (pubkey, d, gateway = 'nsite.lol') => `https://${BigInt('0x' + pubkey).toString(36).padStart(50, '0')}${d}.${gateway}`;

export const npub = (pk) => nip19.npubEncode(pk);
export const shortNpub = (pk) => { const n = npub(pk); return n.slice(0, 10) + '…' + n.slice(-4); };
export const toHexKey = (s) => (s.startsWith('npub') ? nip19.decode(s).data : s);
export { nip19, generateSecretKey, getPublicKey, bytesToHex, hexToBytes };
