// Forms in the LMS, powered by Formstr (NIP-101). Guides, parents and Kieran build forms,
// send them to learners' circles, and read the answers, which are encrypted to the form's key.
// Every form also opens in formstr.app, and Formstr forms can be imported here.
import * as N from './nostr.js';
import * as F from './formstr.js';
import { S, learnerAccess, myLearners, circleRumors, portfolioFrom, commit, makeDoc, slugify, MAIN_REPO } from './store.js';
import { $, $$, esc, fmtDate, fmtWhen, toast, avatar, download, ymd } from './ui.js';
import { view, loading, modal, formModal } from './shell.js';

const isOwnerRole = () => ['parent', 'guide', 'staff'].includes(S.role);
const go = (h) => { location.hash = h; };

// ---------- templates that fit the Consensus21 week ----------
const opt = (...labels) => labels;
export const TEMPLATES = {
  blank: { name: 'Untitled form', description: '', fields: [{ type: 'shortText', label: 'Your question', required: false }] },
  checkin: { name: 'Friday check-in', description: 'Two minutes, every Friday. Only your guide and parents see your answers.', fields: [
    { type: 'rating', label: 'How was your week?', required: true },
    { type: 'paragraph', label: 'What did you build or finish?', required: true },
    { type: 'paragraph', label: 'What got in your way?' },
    { type: 'radioButton', label: 'How much help do you want next week?', options: opt('None, I\'ve got it', 'A quick check-in', 'A proper 1:1'), required: true },
  ] },
  explorers: { name: 'Explorers Day debrief', description: 'After every Explorers Day Out.', fields: [
    { type: 'shortText', label: 'Where did you go?', required: true },
    { type: 'date', label: 'When?' },
    { type: 'paragraph', label: 'Who did you meet and what do they do?' },
    { type: 'checkboxes', label: 'Which learning areas did it touch?', options: opt('English', 'Maths', 'Science', 'Humanities', 'The Arts', 'Health and PE', 'Technologies', 'Languages') },
    { type: 'paragraph', label: 'One thing you want to follow up', required: true },
  ] },
  sip: { name: 'SIP feedback', description: 'Tell us what you think before Thursday SIP discussion.', fields: [
    { type: 'shortText', label: 'Which SIP is this about?', required: true },
    { type: 'radioButton', label: 'Do you support it?', options: opt('Yes', 'Yes, with changes', 'Not yet', 'No'), required: true },
    { type: 'paragraph', label: 'Why?' },
  ] },
  quiz: { name: 'Lesson check', description: 'A quick check after a lesson. Not a test, just a way to see what stuck.', fields: [
    { type: 'label', label: 'Keys and wallets' },
    { type: 'radioButton', label: 'Which key can you share with anyone?', options: opt('Public key (npub)', 'Private key (nsec)', 'Seed words'), required: true },
    { type: 'paragraph', label: 'Explain how a message gets locked and unlocked, in your own words.' },
  ] },
  parents: { name: 'Parent survey', description: 'Help us improve C21 Online.', fields: [
    { type: 'rating', label: 'How is C21 working for your family?', required: true },
    { type: 'checkboxes', label: 'What has been most useful?', options: opt('Lessons', 'Calendar', 'Portfolio', 'Weekly video', 'Guide feedback', 'Messages') },
    { type: 'paragraph', label: 'What should we change?' },
  ] },
  interest: { name: 'Register interest', description: 'Tell us about your family and we\'ll be in touch. Your answers are encrypted to Kieran.', public: true, fields: [
    { type: 'shortText', label: 'Your name', required: true },
    { type: 'shortText', label: 'Email or npub, so we can reply', required: true },
    { type: 'dropdown', label: 'Learner\'s age', options: opt('5 to 7', '8 to 10', '11 to 13', '14 to 17', '18 to 21'), required: true },
    { type: 'checkboxes', label: 'Interested in', options: opt('C21 Online', 'Holiday Studio', 'Campus 01 (in person)', 'Becoming a guide') },
    { type: 'paragraph', label: 'Anything else?' },
  ] },
};

// ---------- who I can send forms to ----------
async function myLearnerAccess() {
  const pks = S.role === 'parent' ? (S.settings.children || []).map((c) => c.pubkey) : (await myLearners()).map((a) => a.pubkey);
  return (await Promise.all(pks.map((pk) => learnerAccess(pk)))).filter(Boolean);
}

// Assignments are NIP-17 messages to the learner's circle, so parents see them too.
function assignmentsIn(rumors) {
  return rumors.filter((r) => r.kind === 14 && r.tags.some((t) => t[0] === 'c21' && t[1] === 'form')).map((r) => {
    const tg = (n) => r.tags.find((t) => t[0] === n)?.[1];
    const [, pubkey, id] = (tg('a') || '').split(':');
    return { rumor: r, from: r.pubkey, learner: tg('learner'), addr: tg('a'), pubkey, id, viewKey: tg('viewkey'), name: tg('name') || 'Form', due: Number(tg('due')) || 0, at: r.created_at };
  }).filter((a) => a.pubkey && a.id);
}

// ================= /forms =================
export async function formsView(sub, ...args) {
  if (sub === 'new') return builderView();
  if (sub === 'edit') return builderView(args[0], args[1]);
  if (sub === 'fill') return fillView(args[0]);
  if (sub === 'r') return responsesView(args[0], args[1]);
  if (S.role === 'learner') return learnerForms();
  return ownerForms();
}

async function ownerForms() {
  loading('Loading your forms from Formstr relays…');
  const list = await F.myForms(S.signer);
  const forms = (await Promise.all(list.map(async (e) => { try { const f = await F.fetchForm(e.pubkey, e.id, e.viewKey); return f && { ...f, entry: e }; } catch { return null; } }))).filter(Boolean);
  const sent = assignmentsIn(await N.loadInbox(S.signer)).filter((a) => a.from === S.signer.pubkey);
  view(`<section class="wrap pad"><div class="eyebrow">Forms · powered by Formstr</div>
    <div class="row between"><h1>Forms</h1><div class="row"><a class="btn" href="#/forms/new">+ New form</a><button class="btn ghost" id="imp">Import from Formstr</button></div></div>
    <p class="lead">Check-ins, Explorers Day debriefs, SIP feedback and quick lesson checks. Forms use the open <a href="https://about.formstr.app/" target="_blank" rel="noopener">Formstr</a> format (NIP-101): answers are encrypted to the form's own key, and every form also opens in formstr.app with the same Nostr login.</p>
    <div class="grid g2 mt">${forms.map((f) => {
      const n = sent.filter((a) => a.addr === F.formAddr(f.pubkey, f.id));
      return `<div class="card formcard"><div class="row between"><h3>${esc(f.name)}</h3><span class="pill soft">${f.isPublic ? '🌐 Public' : '🔒 Private'}</span></div>
        <p class="muted small">${esc(f.description || '')}</p><p class="small">${f.fields.filter((x) => x.prim !== 'label').length} questions · sent to ${new Set(n.map((a) => a.learner)).size} learner${new Set(n.map((a) => a.learner)).size === 1 ? '' : 's'} · updated ${fmtDate(f.updated)}</p>
        <div class="row mt"><a class="btn small" href="#/forms/r/${f.pubkey}/${encodeURIComponent(f.id)}">Responses</a><button class="btn small ghost" data-assign="${esc(f.pubkey + ':' + f.id)}">Send to learners</button><a class="btn small ghost" href="#/forms/edit/${f.pubkey}/${encodeURIComponent(f.id)}">Edit</a>
        <a class="btn small ghost" href="${esc(F.fillUrl(f))}" target="_blank" rel="noopener">Open in Formstr ↗</a></div></div>`;
    }).join('') || `<div class="card"><h3>No forms yet</h3><p class="muted">Start from a template: a Friday check-in, an Explorers Day debrief or SIP feedback. Forms you've made in formstr.app with this same key show up here too.</p><a class="btn mt" href="#/forms/new">Make your first form</a></div>`}</div>
  </section>`);
  $('#imp').onclick = importForm;
  $$('[data-assign]').forEach((b) => b.onclick = () => { const [pk, id] = b.dataset.assign.split(':'); const f = forms.find((x) => x.pubkey === pk && x.id === id); assignForm(f); });
}

async function importForm() {
  const v = await formModal('Import a Formstr form', [{ id: 'link', label: 'Formstr link', placeholder: 'https://formstr.app/f/naddr1…', required: true, hint: 'Paste the <b>responses link</b> (formstr.app/s/…) if you made the form, so you can read the answers here. A fill link (formstr.app/f/…) lets you send the form to learners, but only its owner can read the answers.' }], { submit: 'Import' });
  if (!v?.link) return;
  try {
    const p = F.parseLink(v.link);
    const f = await F.fetchForm(p.pubkey, p.id, p.viewKey, p.relays);
    if (!f) throw new Error('Could not find that form on the relays.');
    if (f.locked) throw new Error('That form is private and the link has no view key. Copy the full share link from Formstr.');
    if (p.secretKey) { await F.saveToMyForms(S.signer, { pubkey: p.pubkey, id: p.id, signingKey: p.secretKey, viewKey: p.viewKey }); toast(`Imported "${f.name}" ✓`); ownerForms(); }
    else { toast('You can send this form, but only its owner reads the answers'); assignForm(f); }
  } catch (e) { toast(e.message, true); }
}

async function assignForm(f) {
  const learners = await myLearnerAccess();
  if (!learners.length) return toast(S.role === 'parent' ? 'Add a learner on your Family page first' : 'No learners have chosen you as their guide yet', true);
  const res = await modal(`<h3>Send "${esc(f.name)}"</h3><p class="muted">It arrives as an encrypted message in each learner's circle (so their parents see it too) and on their Forms page.</p>
    <form id="af">${learners.map((a) => `<label class="check"><input type="checkbox" value="${a.pubkey}" checked> ${avatar(a.pubkey, 22)} ${esc(a.name || 'Learner')}</label>`).join('')}
    <label>Due (optional)</label><input id="due" type="date"><label>Note (optional)</label><input id="note" placeholder="e.g. Fill this in after Monday's excursion">
    <div class="row mt"><button class="btn">Send</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
  { onMount: (m, close) => { $('#af', m).onsubmit = (e) => { e.preventDefault(); close({ pks: $$('input[type=checkbox]:checked', m).map((x) => x.value), due: $('#due', m).value, note: $('#note', m).value }); }; } });
  if (!res?.pks.length) return;
  const entry = (await F.myForms(S.signer)).find((e) => e.pubkey === f.pubkey && e.id === f.id);
  const due = res.due ? Math.floor(new Date(res.due + 'T17:00') / 1000) : 0;
  try {
    for (const pk of res.pks) {
      const a = learners.find((x) => x.pubkey === pk);
      const text = `📝 New form: ${f.name}${res.note ? `\n${res.note}` : ''}${due ? `\nDue ${fmtDate(due)}` : ''}\nOpen it on your Forms page, or in Formstr: ${F.fillUrl(f)}`;
      await N.sendPrivate(S.signer, a.circle.filter((p) => p !== S.signer.pubkey), text,
        [['c21', 'form'], ['learner', pk], ['a', F.formAddr(f.pubkey, f.id)], ['name', f.name], ...(f.viewKey ? [['viewkey', f.viewKey]] : []), ...(due ? [['due', String(due)]] : [])]);
      if (entry?.signingKey) await F.grantAccess(f, entry.signingKey, pk); // shows under "Shared with me" in formstr.app
    }
    toast(`Sent to ${res.pks.length} learner${res.pks.length > 1 ? 's' : ''} ✓`);
    if (location.hash.startsWith('#/forms') && !location.hash.includes('/r/')) ownerForms();
  } catch (e) { toast(e.message, true); }
}

// ---------- learner: to do / done ----------
async function learnerForms() {
  loading('Decrypting your forms…');
  const me = S.signer.pubkey;
  const byAddr = new Map();
  for (const a of assignmentsIn(await N.loadInbox(S.signer)).filter((x) => x.learner === me && myCircleIncludes(x.from))) if (!byAddr.has(a.addr) || byAddr.get(a.addr).at < a.at) byAddr.set(a.addr, a);
  const list = [...byAddr.values()].sort((a, b) => (a.due || 9e12) - (b.due || 9e12));
  const done = await F.myResponses(S.signer, list.map((a) => a.addr));
  const row = (a) => { const d = done.get(a.addr); const late = !d && a.due && a.due * 1000 < Date.now();
    return `<a class="card lift formrow" href="#/forms/fill/${F.naddrOf(a.pubkey, a.id)}${a.viewKey ? '?k=' + a.viewKey : ''}"><div class="row between"><b>📝 ${esc(a.name)}</b>${d ? `<span class="pill" style="background:var(--green)">✓ Done ${fmtDate(d.at)}</span>` : a.due ? `<span class="pill ${late ? '' : 'soft'}" ${late ? 'style="background:var(--red)"' : ''}>Due ${fmtDate(a.due)}</span>` : '<span class="pill soft">To do</span>'}</div><p class="muted small">From ${N.STAFF.includes(a.from) ? 'Kieran' : a.from === S.settings.guide ? 'your guide' : 'your parent'} · ${fmtWhen(a.at)}</p></a>`; };
  const todo = list.filter((a) => !done.has(a.addr)), fin = list.filter((a) => done.has(a.addr));
  view(`<section class="wrap pad narrow"><div class="eyebrow">Forms</div><h1>Your forms</h1>
    <p class="lead">Check-ins and questions from your guide and parents. Your answers are encrypted so only the person who made the form can read them, and you can save a copy to your portfolio.</p>
    <h2 class="mt">To do</h2><div class="formlist">${todo.map(row).join('') || '<p class="muted">Nothing to do. Nice.</p>'}</div>
    ${fin.length ? `<h2 class="mt">Done</h2><div class="formlist">${fin.map(row).join('')}</div>` : ''}</section>`);
}
const myCircleIncludes = (pk) => [S.signer.pubkey, ...(S.settings?.parents || []), S.settings?.guide].includes(pk);

// ---------- filling a form ----------
async function fillView(naddr) {
  let p;
  try { const d = N.nip19.decode(naddr); if (d.type !== 'naddr' || d.data.kind !== 30168) throw 0; p = d.data; } catch { return view('<section class="wrap pad"><div class="card bad">That form link is not valid.</div></section>'); }
  const viewKey = new URLSearchParams(location.hash.split('?')[1] || '').get('k') || undefined;
  loading('Loading form…');
  const form = await F.fetchForm(p.pubkey, p.identifier, viewKey, p.relays || []);
  if (!form) return view('<section class="wrap pad narrow"><div class="card bad">Could not find that form on the relays.</div></section>');
  if (form.locked) return view('<section class="wrap pad narrow"><div class="card bad">This form is private. Open it from your Forms page or the message it came in.</div></section>');
  const prev = S.signer ? (await F.myResponses(S.signer, [F.formAddr(form.pubkey, form.id)])).get(F.formAddr(form.pubkey, form.id)) : null;
  renderForm($('#app'), form, { prev, onDone: () => (S.role === 'learner' ? go('#/forms') : null) });
}

// Renders a form into `root`. Used by the fill page and the landing page.
export function renderForm(root, form, { prev = null, onDone, compact = false } = {}) {
  const val = (f) => prev?.answers?.[f.id] ?? '';
  const input = (f) => {
    const name = `q_${esc(f.id)}`;
    const v = String(val(f));
    if (f.type === 'label') return '';
    if (f.type === 'paragraph') return `<textarea name="${name}" ${f.required ? 'required' : ''}>${esc(v)}</textarea>`;
    if (f.type === 'number') return `<input type="number" name="${name}" value="${esc(v)}" ${f.required ? 'required' : ''}>`;
    if (f.type === 'date') return `<input type="date" name="${name}" value="${esc(v)}" ${f.required ? 'required' : ''}>`;
    if (f.type === 'time') return `<input type="time" name="${name}" value="${esc(v)}" ${f.required ? 'required' : ''}>`;
    if (f.type === 'rating') return `<div class="stars">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}" ${v === String(n) ? 'checked' : ''} ${f.required ? 'required' : ''}><span>★</span></label>`).join('')}</div>`;
    if (f.type === 'dropdown') return `<select name="${name}" ${f.required ? 'required' : ''}><option value="">Choose…</option>${f.options.map((o) => `<option value="${esc(o[0])}" ${v === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    if (f.prim === 'option') { const multi = f.type === 'checkboxes'; const chosen = v.split(';');
      return `<div class="choices">${f.options.map((o) => `<label class="check"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(o[0])}" ${chosen.includes(o[0]) ? 'checked' : ''} ${!multi && f.required ? 'required' : ''}> ${esc(o[1])}</label>`).join('')}</div>`; }
    return `<input name="${name}" value="${esc(v)}" ${f.required ? 'required' : ''}>`;
  };
  const html = `<form class="fform" id="fform">
    ${compact ? '' : `<div class="eyebrow">${form.isPublic ? 'Form' : '🔒 Private form'} · Formstr</div><h1>${esc(form.name)}</h1>${form.description ? `<p class="lead">${esc(form.description)}</p>` : ''}`}
    ${prev ? `<div class="safe">✓ You answered this on ${fmtWhen(prev.at)}. You can change your answers and send them again.</div>` : ''}
    ${form.fields.map((f) => (f.type === 'label' ? `<h3 class="mt">${esc(f.label)}</h3>` : `<div class="fq"><label>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>${input(f)}</div>`)).join('')}
    ${S.role === 'learner' ? '<label class="check mt"><input type="checkbox" id="tocommit" checked> Also save my answers to my portfolio (so my parents and guide see them there too)</label>' : ''}
    <div class="row mt"><button class="btn" id="fsend">${prev ? 'Send updated answers' : 'Send'}</button>${compact ? '' : `<a class="btn ghost" href="${esc(F.fillUrl(form))}" target="_blank" rel="noopener">Open in Formstr ↗</a>`}</div>
    <p class="muted small mt">🔒 Encrypted in your browser to the form owner's key (NIP-44) before it's sent.${!S.signer ? ' You are not logged in, so a one-time key signs it.' : ''}</p></form>`;
  root.innerHTML = compact ? html : `<section class="wrap pad narrow">${html}</section>`;
  $('#fform', root).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answers = {};
    for (const f of form.fields) {
      if (f.type === 'label') continue;
      const all = fd.getAll(`q_${f.id}`).map(String).filter(Boolean);
      answers[f.id] = all.join(';');
      if (f.required && !answers[f.id]) return toast(`Please answer: ${f.label}`, true);
    }
    const btn = $('#fsend', root); btn.disabled = true; btn.textContent = 'Encrypting…';
    try {
      const signer = S.signer || N.localSigner(N.generateSecretKey());
      await F.submitResponse(signer, form, answers);
      if (S.role === 'learner' && $('#tocommit', root)?.checked) {
        try {
          const access = await learnerAccess(S.signer.pubkey);
          const pf = portfolioFrom(access, await circleRumors(access));
          const body = form.fields.map((f) => (f.type === 'label' ? `## ${f.label}` : `**${f.label}**\n\n${F.answerText(f, answers[f.id]) || '_No answer_'}`)).join('\n\n');
          await commit(access, pf, MAIN_REPO, `Form: ${form.name}`, [{ path: `forms/${ymd(new Date())}-${slugify(form.name)}.md`, content: makeDoc({ title: form.name, date: ymd(new Date()) }, body) }]);
        } catch (err) { toast('Answers sent, but saving to your portfolio failed: ' + err.message, true); }
      }
      root.querySelector('#fform').innerHTML = `<div class="paid">✓ Sent, encrypted. Thank you!</div>${compact ? '' : '<div class="row mt"><a class="btn ghost" href="#/forms">Back to forms</a></div>'}`;
      toast('Answers sent ✓');
      onDone?.();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Send'; }
  };
}

// ---------- owner: responses ----------
async function responsesView(pubkey, id) {
  loading('Decrypting responses…');
  const entry = (await F.myForms(S.signer)).find((e) => e.pubkey === pubkey && e.id === id);
  if (!entry?.signingKey) return view('<section class="wrap pad narrow"><div class="card bad">Only the form\'s owner can read its responses, and this form isn\'t in your list.</div></section>');
  const form = await F.fetchForm(pubkey, id, entry.viewKey);
  if (!form || form.locked) return view('<section class="wrap pad narrow"><div class="card bad">Could not load that form.</div></section>');
  const responses = await F.fetchResponses(form, entry.signingKey);
  const learners = isOwnerRole() ? await myLearnerAccess() : [];
  const names = new Map([[S.signer.pubkey, 'You'], ...learners.map((a) => [a.pubkey, a.name || 'Learner'])]);
  const sent = assignmentsIn(await N.loadInbox(S.signer)).filter((a) => a.from === S.signer.pubkey && a.addr === F.formAddr(pubkey, id));
  const waiting = [...new Set(sent.map((a) => a.learner))].filter((pk) => !responses.some((r) => r.pubkey === pk));
  const qs = form.fields.filter((f) => f.type !== 'label');
  const summary = (f) => {
    if (f.prim === 'option') { const counts = f.options.map((o) => [o[1], responses.filter((r) => String(r.answers[f.id] || '').split(';').includes(o[0])).length]);
      return counts.map(([l, n]) => `<div class="bar"><span>${esc(l)} <b>${n}</b></span><i style="--w:${responses.length ? (n / responses.length) * 100 : 0}%;--c:var(--orange)"></i></div>`).join(''); }
    if (f.type === 'rating' || f.type === 'number') { const nums = responses.filter((r) => r.answers[f.id] !== undefined && r.answers[f.id] !== '').map((r) => Number(r.answers[f.id])).filter((n) => !Number.isNaN(n)); return nums.length ? `<p>Average <b>${(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)}</b> from ${nums.length}</p>` : '<p class="muted">No answers yet</p>'; }
    return responses.filter((r) => r.answers[f.id]).slice(-4).map((r) => `<p class="small">“${esc(r.answers[f.id])}” <span class="muted">· ${esc(names.get(r.pubkey) || 'Anonymous')}</span></p>`).join('') || '<p class="muted">No answers yet</p>';
  };
  view(`<section class="wrap pad"><a class="muted small" href="#/forms">← Forms</a><div class="row between"><h1>${esc(form.name)}</h1><span class="pill soft">${responses.length} response${responses.length === 1 ? '' : 's'}</span></div>
    <p class="lead">Decrypted in your browser with this form's key. Relays only hold ciphertext.</p>
    ${waiting.length ? `<div class="safe">Waiting on: ${waiting.map((pk) => esc(names.get(pk) || N.shortNpub(pk))).join(', ')}</div>` : ''}
    <div class="row mt"><button class="btn small" id="csv">Download CSV</button><button class="btn small ghost" id="send">Send to learners</button><a class="btn small ghost" href="${esc(F.fillUrl(form))}" target="_blank" rel="noopener">Fill link in Formstr ↗</a><button class="btn small ghost" id="fsr">Responses in Formstr ↗</button></div>
    <h2 class="mt">Summary</h2><div class="grid g2">${qs.map((f) => `<div class="card"><h3>${esc(f.label)}</h3>${summary(f)}</div>`).join('')}</div>
    <h2 class="mt">Each response</h2><div class="card"><div class="tablewrap"><table><tr><th>Who</th><th>When</th>${qs.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr>
      ${responses.sort((a, b) => b.at - a.at).map((r) => `<tr><td>${names.has(r.pubkey) ? `${avatar(r.pubkey, 22)} ${esc(names.get(r.pubkey))}` : '<span class="muted">Anonymous</span>'}</td><td class="small muted">${fmtWhen(r.at)}</td>${qs.map((f) => `<td>${esc(F.answerText(f, r.answers[f.id]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${qs.length + 2}" class="muted">No responses yet.</td></tr>`}</table></div></div></section>`);
  $('#csv').onclick = () => download(`${slugify(form.name)}-responses.csv`, [['Who', 'When', ...qs.map((f) => f.label)], ...responses.map((r) => [names.get(r.pubkey) || r.pubkey, new Date(r.at * 1000).toISOString(), ...qs.map((f) => F.answerText(f, r.answers[f.id]))])]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  $('#send').onclick = () => assignForm(form);
  $('#fsr').onclick = () => { if (confirm('The Formstr responses link contains this form\'s secret key. Anyone with it can read the answers. Open it?')) window.open(F.responsesUrl(form, entry.signingKey), '_blank', 'noopener'); };
}

// ---------- builder ----------
async function builderView(pubkey, id) {
  let spec, existing = null;
  if (pubkey) {
    loading('Loading form…');
    existing = (await F.myForms(S.signer)).find((e) => e.pubkey === pubkey && e.id === id);
    const f = existing && (await F.fetchForm(pubkey, id, existing.viewKey));
    if (!f || f.locked || !existing.signingKey) return view('<section class="wrap pad narrow"><div class="card bad">You can only edit forms you own.</div></section>');
    spec = { name: f.name, description: f.description, public: f.isPublic, fields: f.fields.map((x) => ({ id: x.id, type: x.type, label: x.label, required: x.required, options: x.options })) };
  } else spec = structuredClone(TEMPLATES[new URLSearchParams(location.hash.split('?')[1] || '').get('t') || 'blank'] || TEMPLATES.blank);
  const templates = Object.entries(TEMPLATES).filter(([k]) => k !== 'interest' || S.role === 'staff');
  const qRow = (f, i) => `<div class="qrow card" data-i="${i}"><div class="row between"><b class="muted small">Question ${i + 1}</b><div class="row"><button type="button" class="x" data-up="${i}" title="Move up">↑</button><button type="button" class="x" data-down="${i}" title="Move down">↓</button><button type="button" class="x" data-del="${i}" title="Remove">×</button></div></div>
    <div class="grid g2"><div><label>Question</label><input class="ql" value="${esc(f.label)}"></div><div><label>Type</label><select class="qt">${Object.entries(F.FIELD_TYPES).map(([k, [, l]]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="qo" ${F.FIELD_TYPES[f.type]?.[0] === 'option' ? '' : 'hidden'}><label>Choices (one per line)</label><textarea class="qopts" rows="3">${esc((f.options || []).map((o) => (Array.isArray(o) ? o[1] : o)).join('\n'))}</textarea></div>
    <label class="check"><input type="checkbox" class="qr" ${f.required ? 'checked' : ''}> Required</label></div>`;
  const draw = () => {
    view(`<section class="wrap pad narrow"><a class="muted small" href="#/forms">← Forms</a><div class="eyebrow mt">Forms · Formstr</div><h1>${existing ? 'Edit form' : 'New form'}</h1>
      ${existing ? '' : `<div class="row">${templates.map(([k, t]) => `<a class="chip" href="#/forms/new?t=${k}">${esc(t.name)}</a>`).join('')}</div>`}
      <div class="card mt"><label>Form name</label><input id="fn" value="${esc(spec.name)}"><label>Description</label><textarea id="fd" rows="2">${esc(spec.description || '')}</textarea>
      ${S.role === 'staff' ? `<label class="check"><input type="checkbox" id="fpub" ${spec.public ? 'checked' : ''}> Public form (anyone can fill it in, answers are still encrypted to you). Use this for "Register interest".</label>` : ''}</div>
      <div id="qs">${spec.fields.map(qRow).join('')}</div>
      <div class="row mt"><button class="btn ghost" id="addq">+ Add question</button><span class="grow"></span><button class="btn" id="save">${existing ? 'Save changes' : 'Create form'}</button></div>
      <p class="muted small mt">${existing ? 'Changing questions after people have answered can make old answers harder to read.' : 'A new key is made for this form. It is saved, encrypted, in your Formstr form list (kind 14083), so the form also appears in your formstr.app dashboard.'}</p></section>`);
    const read = () => { spec.name = $('#fn').value; spec.description = $('#fd').value; spec.public = !!$('#fpub')?.checked;
      spec.fields = $$('.qrow').map((r, i) => { const t = $('.qt', r).value; const old = spec.fields[i] || {}; const lines = $('.qopts', r).value.split('\n').map((x) => x.trim()).filter(Boolean);
        const prevOpts = (old.options || []).filter(Array.isArray);
        return { id: old.id, type: t, label: $('.ql', r).value, required: $('.qr', r).checked, options: lines.map((l) => prevOpts.find((o) => o[1] === l) || l) }; }); };
    $$('.qt').forEach((s) => s.onchange = () => { s.closest('.qrow').querySelector('.qo').hidden = F.FIELD_TYPES[s.value][0] !== 'option'; });
    $('#addq').onclick = () => { read(); spec.fields.push({ type: 'shortText', label: '', required: false }); draw(); };
    $$('[data-del]').forEach((b) => b.onclick = () => { read(); spec.fields.splice(Number(b.dataset.del), 1); draw(); });
    $$('[data-up]').forEach((b) => b.onclick = () => { read(); const i = Number(b.dataset.up); if (i > 0) [spec.fields[i - 1], spec.fields[i]] = [spec.fields[i], spec.fields[i - 1]]; draw(); });
    $$('[data-down]').forEach((b) => b.onclick = () => { read(); const i = Number(b.dataset.down); if (i < spec.fields.length - 1) [spec.fields[i + 1], spec.fields[i]] = [spec.fields[i], spec.fields[i + 1]]; draw(); });
    $('#save').onclick = async () => {
      read();
      if (!spec.name.trim()) return toast('Give the form a name', true);
      if (!spec.fields.length || spec.fields.some((f) => !f.label.trim())) return toast('Every question needs some text', true);
      if (spec.fields.some((f) => F.FIELD_TYPES[f.type][0] === 'option' && !f.options.length)) return toast('Choice questions need at least one choice', true);
      $('#save').disabled = true; $('#save').textContent = 'Publishing…';
      try {
        const keys = existing ? { signingKey: existing.signingKey, viewKey: existing.viewKey || F.newKeys().viewKey } : F.newKeys();
        const fid = id || slugify(spec.name).slice(0, 24) + '-' + Math.random().toString(36).slice(2, 7);
        const ev = await F.publishForm(fid, spec, keys);
        await F.saveToMyForms(S.signer, { pubkey: ev.pubkey, id: fid, signingKey: keys.signingKey, viewKey: spec.public ? '' : keys.viewKey });
        if (S.role === 'staff' && spec.public && confirm('Show this form on the C21 Online home page as "Register interest"?')) {
          await N.publish(S.signer, { kind: 30078, content: JSON.stringify({ pubkey: ev.pubkey, id: fid }), tags: [['d', 'c21/interest-form']] });
        }
        toast(existing ? 'Form updated ✓' : 'Form created ✓');
        go('#/forms/r/' + ev.pubkey + '/' + encodeURIComponent(fid));
      } catch (e) { toast(e.message, true); $('#save').disabled = false; $('#save').textContent = existing ? 'Save changes' : 'Create form'; }
    };
  };
  draw();
}

// ---------- landing page: Kieran's public "Register interest" form ----------
export async function interestForm() {
  const ptr = N.latest(await N.query({ kinds: [30078], authors: N.STAFF, '#d': ['c21/interest-form'], limit: 3 }));
  if (!ptr) return null;
  try { const { pubkey, id } = JSON.parse(ptr.content); const f = await F.fetchForm(pubkey, id); return f && !f.locked ? f : null; } catch { return null; }
}

// Learner home: how many forms are waiting.
export async function formsToDo() {
  const me = S.signer.pubkey;
  const list = assignmentsIn(await N.loadInbox(S.signer)).filter((a) => a.learner === me && myCircleIncludes(a.from));
  const addrs = [...new Set(list.map((a) => a.addr))];
  const done = await F.myResponses(S.signer, addrs);
  return addrs.filter((a) => !done.has(a)).length;
}
