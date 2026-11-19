// Page and modal helpers shared by every view.
import { $, esc, animateIn } from './ui.js';

export const app = () => $('#app');
export const view = (html, { keepScroll = false } = {}) => { app().innerHTML = html; if (!keepScroll) window.scrollTo(0, 0); animateIn(app()); };
export const loading = (msg = 'Loading from relays…') => view(`<section class="wrap pad"><div class="loader"><span></span><span></span><span></span></div><p class="muted center">${msg}</p></section>`);

export function modal(html, { onMount, wide = false } = {}) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-card ${wide ? 'wide' : ''}">${html}</div>`;
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('show'));
    const close = (v) => { m.classList.remove('show'); setTimeout(() => m.remove(), 250); resolve(v); };
    m.addEventListener('click', (e) => { if (e.target === m || e.target.dataset.close !== undefined) close(null); });
    onMount?.(m, close);
  });
}

export const askPassword = (title = 'Unlock your account', note = 'Your key is locked on this device with your password.') => modal(`
  <h3>${esc(title)}</h3><p class="muted">${esc(note)}</p>
  <form id="pwf"><input id="pw" type="password" placeholder="Password" autocomplete="current-password" required>
  <div class="row mt"><button class="btn">Unlock</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
{ onMount: (m, close) => { $('#pw', m).focus(); $('#pwf', m).onsubmit = (e) => { e.preventDefault(); close($('#pw', m).value); }; } });

// Form modal: fields [{ id, label, type, value, placeholder, rows, options, hint }] → values or null.
export function formModal(title, fields, { submit = 'Save', note = '', wide = false } = {}) {
  const input = (f) => {
    const v = esc(f.value ?? '');
    if (f.type === 'textarea') return `<textarea id="f_${f.id}" rows="${f.rows || 6}" placeholder="${esc(f.placeholder || '')}">${v}</textarea>`;
    if (f.type === 'select') return `<select id="f_${f.id}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(f.value) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" id="f_${f.id}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
    if (f.type === 'file') return `<input id="f_${f.id}" type="file" ${f.accept ? `accept="${esc(f.accept)}"` : ''}>`;
    return `<input id="f_${f.id}" type="${f.type || 'text'}" value="${v}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>`;
  };
  return modal(`<h3>${esc(title)}</h3>${note ? `<p class="muted small">${note}</p>` : ''}<form id="fm">
    ${fields.map((f) => `${f.type === 'checkbox' ? '' : `<label for="f_${f.id}">${esc(f.label)}</label>`}${input(f)}${f.hint ? `<p class="muted small">${f.hint}</p>` : ''}`).join('')}
    <div class="row mt"><button class="btn">${esc(submit)}</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
  { wide, onMount: (m, close) => {
    $('input,textarea', m)?.focus();
    $('#fm', m).onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      fields.forEach((f) => { const el = $(`#f_${f.id}`, m); out[f.id] = f.type === 'checkbox' ? el.checked : f.type === 'file' ? el.files[0] || null : el.value; });
      close(out);
    };
  } });
}
