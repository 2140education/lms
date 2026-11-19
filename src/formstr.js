// Formstr (https://formstr.app) compatible forms, NIP-101.
// Forms made here open in formstr.app and forms made in formstr.app open here.
//
// - Form template: kind 30168, signed by a key made just for that form (the "signing key").
//   Private forms put the whole spec in `content`, NIP-44 encrypted from the signing key to
//   the public key of a second "view key". Anyone with the view key can read the form.
// - Response: kind 1069, signed by the responder, `content` NIP-44 encrypted from the
//   responder to the form's key. Only the signing key (the form owner) can read it.
// - Owner's list: kind 14083, NIP-44 encrypted to self: ["f", "<formPub>:<id>", relay, "<signingKey>:<viewKey>"].
// - Access grants: kind 18 rumor with ViewAccess/EditAccess keys, sealed by the signing key and
//   gift-wrapped to an alias pubkey sha256("30168:<formPub>:<id>:<recipient>").
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash, nip19 } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { bech32 } from '@scure/base';
import * as N from './nostr.js';
import { RELAYS } from './config.js';

export const FORMSTR_APP = 'https://formstr.app';
export const FORM_RELAYS = globalThis.C21_TEST_RELAYS ? RELAYS : ['wss://relay.formstr.app', ...RELAYS];

// Question types we build, mapped to Formstr's [primitive, renderElement].
export const FIELD_TYPES = {
  shortText: ['text', 'Short answer'], paragraph: ['text', 'Paragraph'], number: ['number', 'Number'],
  radioButton: ['option', 'Pick one'], checkboxes: ['option', 'Pick any'], dropdown: ['option', 'Dropdown'],
  rating: ['number', 'Rating (stars)'], date: ['text', 'Date'], label: ['label', 'Heading or note (no answer)'],
};

const ck = (skHex, pub) => nip44.getConversationKey(hexToBytes(skHex), pub);
export const formAddr = (pubkey, id) => `30168:${pubkey}:${id}`;
export const naddrOf = (pubkey, id, relays = FORM_RELAYS.slice(0, 2)) => nip19.naddrEncode({ kind: 30168, pubkey, identifier: id, relays });
const randId = () => Math.random().toString(36).slice(2, 10);

// ---------- building ----------
// spec: { name, description, fields: [{ id?, type, label, options?: [labels], required }] }
export function specToTags(id, spec) {
  const tags = [['d', id], ['name', spec.name], ['settings', JSON.stringify({ description: spec.description || '', thankYouPage: true, notifyNpubs: [], publicForm: !!spec.public, disallowAnonymous: !spec.public, encryptForm: !spec.public, viewKeyInUrl: true })]];
  for (const f of spec.fields) {
    const [prim] = FIELD_TYPES[f.type] || FIELD_TYPES.shortText;
    const opts = prim === 'option' ? (f.options || []).map((o) => (Array.isArray(o) ? o : [randId(), o])) : [];
    const cfg = { renderElement: f.type, required: !!f.required, ...(f.type === 'rating' ? { maxStars: 5 } : {}) };
    tags.push(['field', f.id || randId(), prim, f.label, JSON.stringify(opts), JSON.stringify(cfg)]);
  }
  return tags;
}

export function newKeys() { return { signingKey: bytesToHex(generateSecretKey()), viewKey: bytesToHex(generateSecretKey()) }; }

// Publish (or update) a form. Private forms are encrypted for the view key.
export async function publishForm(id, spec, { signingKey, viewKey }) {
  const formTags = specToTags(id, spec);
  let tags, content = '';
  if (spec.public) tags = [...formTags, ['t', 'public']];
  else {
    // Formstr puts the name in a plain tag; we leave it blank so relays learn nothing about the form.
    tags = [['d', id], ['name', '']];
    content = nip44.encrypt(JSON.stringify(formTags), ck(signingKey, getPublicKey(hexToBytes(viewKey))));
  }
  FORM_RELAYS.forEach((r) => tags.push(['relay', r]));
  const ev = finalizeEvent({ kind: 30168, created_at: N.now(), tags, content }, hexToBytes(signingKey));
  if (!(await N.publishAny(ev, FORM_RELAYS))) throw new Error('No relay accepted the form. Check your connection.');
  return ev;
}

// ---------- reading ----------
const tagv = (tags, n) => tags.find((t) => t[0] === n)?.[1];
export function parseForm(ev, viewKey) {
  let tags = ev.tags;
  if (ev.content) {
    if (!viewKey) return { locked: true, pubkey: ev.pubkey, id: tagv(ev.tags, 'd') };
    tags = JSON.parse(nip44.decrypt(ev.content, ck(viewKey, ev.pubkey)));
  }
  let settings = {}; try { settings = JSON.parse(tagv(tags, 'settings') || '{}'); } catch {}
  const fields = tags.filter((t) => t[0] === 'field').map((t) => {
    let options = [], cfg = {};
    try { options = JSON.parse(t[4] || '[]'); } catch {}
    try { cfg = JSON.parse(t[5] || '{}'); } catch {}
    return { id: t[1], prim: t[2], label: t[3], options, type: cfg.renderElement || (t[2] === 'option' ? 'radioButton' : t[2] === 'label' ? 'label' : 'shortText'), required: !!cfg.required, cfg };
  });
  return { pubkey: ev.pubkey, id: tagv(tags, 'd') || tagv(ev.tags, 'd'), name: tagv(tags, 'name') || 'Untitled form', description: settings.description || '', settings, fields,
    relays: ev.tags.filter((t) => t[0] === 'relay').map((t) => t[1]), isPublic: !ev.content, updated: ev.created_at, viewKey };
}

export async function fetchForm(pubkey, id, viewKey, relays = []) {
  const evs = await N.query({ kinds: [30168], authors: [pubkey], '#d': [id], limit: 5 }, { relays: [...new Set([...FORM_RELAYS, ...relays])] });
  const ev = N.latest(evs);
  return ev ? parseForm(ev, viewKey) : null;
}

// ---------- links ----------
export const fillUrl = (f) => `${FORMSTR_APP}/f/${naddrOf(f.pubkey, f.id)}${f.viewKey ? `?viewKey=${f.viewKey}` : ''}`;
export const responsesUrl = (f, signingKey) => `${FORMSTR_APP}/s/${naddrOf(f.pubkey, f.id)}${f.viewKey ? `?viewKey=${f.viewKey}` : ''}#${signingKey}`;

function decodeNKeys(s) {
  const { words } = bech32.decode(s, 2048);
  const data = bech32.fromWords(words);
  const out = { 0: [], 1: [] };
  for (let i = 0; i < data.length;) { const t = data[i], len = data[i + 1]; (out[t] ||= []).push(new TextDecoder().decode(new Uint8Array(data.slice(i + 2, i + 2 + len)))); i += 2 + len; }
  return Object.fromEntries(out[0].map((k, i) => [k, out[1][i]]));
}

// Accepts a formstr.app fill or responses link, or a bare naddr.
export function parseLink(input) {
  const s = input.trim();
  const naddr = s.match(/naddr1[02-9ac-hj-np-z]+/)?.[0];
  if (!naddr) throw new Error('That link has no naddr in it. Copy the share link from Formstr.');
  const d = nip19.decode(naddr);
  if (d.type !== 'naddr' || d.data.kind !== 30168) throw new Error('That is not a Formstr form link.');
  const out = { pubkey: d.data.pubkey, id: d.data.identifier, relays: d.data.relays || [] };
  try { const u = new URL(s); out.viewKey = u.searchParams.get('viewKey') || undefined; const h = u.hash.slice(1); if (h.startsWith('nkeys1')) Object.assign(out, decodeNKeys(h)); else if (/^[0-9a-f]{64}$/.test(h)) out.secretKey = h; } catch {}
  if (out.secretKey && getPublicKey(hexToBytes(out.secretKey)) !== out.pubkey) delete out.secretKey;
  return out;
}

// ---------- responses ----------
// answers: { fieldId: value } where option fields hold option ids (several joined with ';').
export async function submitResponse(signer, form, answers) {
  const responses = form.fields.filter((f) => f.prim !== 'label').map((f) => ['response', f.id, String(answers[f.id] ?? ''), '']);
  const content = await signer.encrypt(form.pubkey, JSON.stringify(responses));
  const ev = await signer.sign({ kind: 1069, created_at: N.now(), tags: [['a', formAddr(form.pubkey, form.id)]], content });
  if (!(await N.publishAny(ev, [...new Set([...FORM_RELAYS, ...form.relays])]))) throw new Error('No relay accepted your answers. Check your connection.');
  return ev;
}

const asMap = (responses) => Object.fromEntries(responses.filter((r) => r[0] === 'response').map((r) => [r[1], r[2]]));

// Owner reads every response with the form's signing key. Latest response per person wins.
export async function fetchResponses(form, signingKey) {
  const evs = await N.query({ kinds: [1069], '#a': [formAddr(form.pubkey, form.id)], limit: 1000 }, { relays: [...new Set([...FORM_RELAYS, ...form.relays])], maxWait: 4000 });
  const byAuthor = new Map();
  for (const ev of evs.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const responses = ev.content ? JSON.parse(nip44.decrypt(ev.content, ck(signingKey, ev.pubkey))) : ev.tags;
      byAuthor.set(ev.pubkey, { pubkey: ev.pubkey, at: ev.created_at, answers: asMap(responses) });
    } catch {}
  }
  return [...byAuthor.values()];
}

// A responder can read back what they sent (same NIP-44 conversation key, from their side).
export async function myResponses(signer, addrs) {
  if (!addrs.length) return new Map();
  const evs = await N.query({ kinds: [1069], authors: [signer.pubkey], '#a': addrs, limit: 500 }, { relays: FORM_RELAYS });
  const out = new Map();
  for (const ev of evs.sort((a, b) => a.created_at - b.created_at)) {
    const a = ev.tags.find((t) => t[0] === 'a')?.[1];
    try { out.set(a, { at: ev.created_at, answers: asMap(ev.content ? JSON.parse(await signer.decrypt(a.split(':')[1], ev.content)) : ev.tags) }); } catch { out.set(a, { at: ev.created_at, answers: null }); }
  }
  return out;
}

// Human-readable answer for a field (option ids become labels).
export function answerText(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.prim === 'option') return String(value).split(';').map((id) => field.options.find((o) => o[0] === id)?.[1] || id).join(', ');
  if (field.type === 'rating') return '★'.repeat(Number(value) || 0);
  return String(value);
}

// ---------- owner's form list (kind 14083, shared with formstr.app) ----------
export async function myForms(signer) {
  const ev = N.latest(await N.query({ kinds: [14083], authors: [signer.pubkey], limit: 3 }, { relays: FORM_RELAYS }));
  if (!ev) return [];
  try {
    return JSON.parse(await signer.decrypt(signer.pubkey, ev.content)).filter((t) => t[0] === 'f').map((t) => {
      const [pubkey, id] = t[1].split(':'); const [signingKey, viewKey] = (t[3] || '').split(':');
      return { pubkey, id, relay: t[2], signingKey, viewKey };
    });
  } catch { return []; }
}
export async function saveToMyForms(signer, { pubkey, id, signingKey, viewKey }, remove = false) {
  const ev = N.latest(await N.query({ kinds: [14083], authors: [signer.pubkey], limit: 3 }, { relays: FORM_RELAYS }));
  let list = [];
  if (ev) try { list = JSON.parse(await signer.decrypt(signer.pubkey, ev.content)); } catch { throw new Error('Could not read your Formstr form list, so it was left unchanged.'); }
  const key = `${pubkey}:${id}`;
  list = list.filter((t) => t[1] !== key);
  if (!remove) list.push(['f', key, FORM_RELAYS[0], signingKey + (viewKey ? ':' + viewKey : '')]);
  await N.publish(signer, { kind: 14083, tags: [], content: await signer.encrypt(signer.pubkey, JSON.stringify(list)) }, FORM_RELAYS);
}

// ---------- access grants (so the form also shows under "Shared with me" in formstr.app) ----------
export async function grantAccess(form, signingKey, recipient, { edit = false } = {}) {
  const sk = hexToBytes(signingKey);
  const tags = [...(edit ? [['EditAccess', signingKey]] : []), ...(form.viewKey ? [['ViewAccess', form.viewKey]] : [])];
  const rumor = { kind: 18, created_at: N.now(), tags, content: '', pubkey: getPublicKey(sk) };
  rumor.id = getEventHash(rumor);
  const seal = finalizeEvent({ kind: 13, created_at: N.now(), tags: [], content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(sk, recipient)) }, sk);
  const alias = await N.sha256hex(`30168:${form.pubkey}:${form.id}:${recipient}`);
  const eph = generateSecretKey();
  const wrap = finalizeEvent({ kind: 1059, created_at: N.now(), tags: [['p', alias]], content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(eph, recipient)) }, eph);
  return N.publishAny(wrap, FORM_RELAYS);
}
