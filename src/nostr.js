// Nostr plumbing: relay pool, signers (extension, remote signer, password-locked key),
// encrypted private data, NIP-17 private messages and Blossom uploads.
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, getEventHash, verifyEvent, nip19 } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip49 from 'nostr-tools/nip49';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { RELAYS, STAFF_NPUBS, BLOSSOM_SERVERS } from './config.js';

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
  const p = query({ kinds: [0], authors: [pubkey], limit: 3 }, { relays: globalThis.C21_TEST_RELAYS ? RELAYS : [...RELAYS, 'wss://purplepag.es'], maxWait: 2500 })
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
export async function publish(signer, template, relays = RELAYS) {
  const ev = await signer.sign(template);
  const results = await Promise.allSettled(pool.publish(relays, ev));
  if (!results.some((r) => r.status === 'fulfilled')) throw new Error('No relay accepted the event. Check your connection.');
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

// ---------- NIP-17 private messages (works with any signer) ----------
const randomPast = () => now() - Math.floor(Math.random() * 172800);

export async function sendPrivate(signer, recipients, content, extraTags = []) {
  const everyone = [...new Set([...recipients, signer.pubkey])];
  const rumor = { kind: 14, pubkey: signer.pubkey, created_at: now(), content,
    tags: [...recipients.filter((p) => p !== signer.pubkey).map((p) => ['p', p]), ...extraTags] };
  rumor.id = getEventHash(rumor);
  for (const r of everyone) {
    const seal = await signer.sign({ kind: 13, created_at: randomPast(), tags: [], content: await signer.encrypt(r, JSON.stringify(rumor)) });
    const eph = generateSecretKey();
    const wrap = finalizeEvent({ kind: 1059, created_at: randomPast(), tags: [['p', r]],
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(eph, r)) }, eph);
    await Promise.allSettled(pool.publish(RELAYS, wrap));
  }
  return rumor;
}

export async function unwrap(signer, wrap) {
  const seal = JSON.parse(await signer.decrypt(wrap.pubkey, wrap.content));
  if (seal.kind !== 13 || !verifyEvent(seal)) throw new Error('bad seal');
  const rumor = JSON.parse(await signer.decrypt(seal.pubkey, seal.content));
  if (rumor.pubkey !== seal.pubkey) throw new Error('forged sender');
  return rumor;
}

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

// nsite (NIP-5A) address for a named site: base36 pubkey + identifier.
export const nsiteUrl = (pubkey, d, gateway = 'nsite.lol') => `https://${BigInt('0x' + pubkey).toString(36).padStart(50, '0')}${d}.${gateway}`;

export const npub = (pk) => nip19.npubEncode(pk);
export const shortNpub = (pk) => { const n = npub(pk); return n.slice(0, 10) + '…' + n.slice(-4); };
export const toHexKey = (s) => (s.startsWith('npub') ? nip19.decode(s).data : s);
export { nip19, generateSecretKey, getPublicKey, bytesToHex, hexToBytes };
