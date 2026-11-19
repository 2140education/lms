// Small UI helpers: escaping, toasts, avatars, QR codes, safety checks, time zones, ICS export.
import qrcode from 'qrcode-generator';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
export const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtWhen = (ts) => new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
}

// Generated avatar (a 3x3 cube face from the key). Learners never upload photos.
const PALETTE = ['#f7931a', '#1fa6a0', '#2f6fde', '#3aa65a', '#f2c230', '#e0533d', '#7a5cd6'];
export function avatar(pubkey, size = 48) {
  const cells = [...Array(9)].map((_, i) => PALETTE[parseInt(pubkey.slice(i * 2, i * 2 + 2), 16) % PALETTE.length]);
  const s = 30;
  const rects = cells.map((c, i) => `<rect x="${(i % 3) * 32 + 3}" y="${Math.floor(i / 3) * 32 + 3}" width="${s}" height="${s}" rx="6" fill="${c}"/>`).join('');
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="18" fill="#081b2a"/>${rects}</svg>`;
}

export function qr(text, cell = 4) {
  const q = qrcode(0, 'L');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

// Child safety: stop personal details going into anything public.
const PII = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'an email address'],
  [/(\+?\d[\s-]?){8,}/, 'a phone number'],
  [/\b\d{1,5}\s+\w+\s+(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|lane|ln|place|pl|way|parade|pde)\b/i, 'a street address'],
  [/\b(nsec1|ncryptsec1)[a-z0-9]+/i, 'a secret key'],
  [/\b(password|passcode|seed phrase|seed words)\b\s*[:=]/i, 'a password'],
  [/\b(primary school|high school|secondary college|grammar school)\b/i, 'a school name'],
];
const BAD = /\b(fuck|shit|bitch|cunt|dick|piss|bastard|slut|whore)\w*/i;
export function safetyCheck(...texts) {
  const t = texts.join(' \n ');
  for (const [re, what] of PII) if (re.test(t)) return `This looks like it includes ${what}. Use a fun nickname instead of personal details.`;
  if (BAD.test(t)) return 'Please keep it friendly. That word isn\'t allowed on C21.';
  return null;
}

const ADJ = ['Swift', 'Bright', 'Clever', 'Brave', 'Cosmic', 'Electric', 'Curious', 'Quantum', 'Lucky', 'Solar', 'Pixel', 'Turbo'];
const NOUN = ['Builder', 'Coder', 'Explorer', 'Maker', 'Falcon', 'Otter', 'Comet', 'Wombat', 'Robot', 'Voyager', 'Dolphin', 'Satoshi'];
export const nickname = () => ADJ[Math.floor(Math.random() * ADJ.length)] + NOUN[Math.floor(Math.random() * NOUN.length)] + Math.floor(Math.random() * 90 + 10);

// Time zones: turn "Monday 09:30 in Melbourne" into a real moment, then show it in the viewer's zone.
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
export function zonedToUnix(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return Math.floor(utc / 1000);
}
export const ymd = (date) => date.toLocaleDateString('en-CA');
export function mondayOf(date = new Date()) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function icsFile(events, name = 'c21-week') {
  const stamp = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const escI = (s) => String(s || '').replace(/[,;\\]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Consensus21//C21 Online//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:C21 Online'];
  events.forEach((e, i) => lines.push('BEGIN:VEVENT', `UID:${e.id || i}-${e.start}@c21.online`, `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end || e.start + 3600)}`, `SUMMARY:${escI(e.title)}`, `DESCRIPTION:${escI(e.description || '')}`, 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = name + '.ics'; a.click();
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
}

// Reveal-on-scroll and counters for the landing page.
export function animateIn(root = document) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    const n = e.target.dataset.count;
    if (n !== undefined) countUp(e.target, Number(n), e.target.dataset.suffix || '');
    io.unobserve(e.target);
  }), { threshold: 0.15 });
  $$('.reveal, [data-count]', root).forEach((el) => io.observe(el));
}
function countUp(el, to, suffix) {
  const t0 = performance.now(), dur = 1100;
  const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + suffix; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

export function typeLines(el, lines, speed = 22) {
  let i = 0, j = 0, out = '';
  const tick = () => {
    if (!el.isConnected) return;
    if (i >= lines.length) return;
    const line = lines[i];
    if (j <= line.length) { el.innerHTML = out + esc(line.slice(0, j)) + '<span class="caret">▍</span>'; j++; setTimeout(tick, line.startsWith('$') ? speed * 2 : speed / 2); }
    else { out += `<span class="${line.startsWith('$') ? 'cmd' : 'outl'}">${esc(line)}</span>\n`; i++; j = 0; setTimeout(tick, 280); }
  };
  tick();
}

// Private portfolios are only seen by the family and guide, but secret keys must never go in.
export function secretCheck(...texts) {
  const t = texts.join(' \n ');
  if (/\b(nsec1|ncryptsec1)[a-z0-9]{20,}/i.test(t)) return 'That looks like a secret key. Never put secret keys in your portfolio.';
  if (/\b(seed phrase|seed words|recovery phrase)\b\s*[:=]/i.test(t)) return 'That looks like a seed phrase. Keep those offline.';
  return null;
}

// Small, safe Markdown: everything is escaped first, then a few patterns are turned into HTML.
export function md(src = '') {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/!\[([^\]]*)\]\(([^)\s"]+)\)/g, '<img class="mdimg" alt="$1" data-src="$2">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<"]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const out = []; let list = null, code = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(src).split('\n')) {
    if (code !== null) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { close(); code = []; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(?:\[( |x)\]\s+)?(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${m[1] ? (m[1] === 'x' ? '☑ ' : '☐ ') : ''}${inline(m[2])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)$/))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  close();
  return out.join('');
}

const level = (c) => (c === 0 ? 0 : c < 2 ? 1 : c < 4 ? 2 : c < 7 ? 3 : 4);

// GitHub-style contribution graph (53 weeks, Sunday-first like GitHub).
export function heatmap(counts) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 52 * 7 - start.getDay());
  const cells = [], months = [];
  let total = 0, lastMonth = -1;
  for (let w = 0; w < 53; w++) {
    const first = new Date(start); first.setDate(first.getDate() + w * 7);
    months.push(first.getMonth() !== lastMonth ? first.toLocaleDateString(undefined, { month: 'short' }) : '');
    lastMonth = first.getMonth();
    for (let d = 0; d < 7; d++) {
      const day = new Date(first); day.setDate(day.getDate() + d);
      if (day > today) { cells.push('<i class="x"></i>'); continue; }
      const c = counts[ymd(day)] || 0; total += c;
      cells.push(`<i data-l="${level(c)}" title="${c} contribution${c === 1 ? '' : 's'} on ${ymd(day)}"></i>`);
    }
  }
  months[0] = '';
  return { total, html: `<div class="pf-cal"><div class="pf-cal-grid"><div></div><div class="pf-cal-months">${months.map((m) => `<span>${m}</span>`).join('')}</div>
    <div class="pf-cal-days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div><div class="pf-cal-cells">${cells.join('')}</div></div>
    <div class="pf-cal-foot"><span>Commits, lessons, Explorers Days and reflections. All encrypted.</span><span class="pf-cal-key">Less <i data-l="0"></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i> More</span></div></div>` };
}

// The last 64 days as a strip, for learner rows.
export function miniHeat(counts) {
  const today = new Date();
  return `<div class="mini-heat" aria-hidden="true">${[...Array(64)].map((_, i) => { const d = new Date(today); d.setDate(d.getDate() - 63 + i); return `<i data-l="${level(counts[ymd(d)] || 0)}"></i>`; }).join('')}</div>`;
}

// Timetable like the Consensus21 profile "My week": Monday to Friday (plus weekend days in use).
export const TT_COLOURS = { explore: '#38bdf8', fit: '#a3e635', core: '#f7931a', ai: '#c084fc', sip: '#fde047', pbl: '#fb7185', community: '#2dd4bf', live: '#ef4444', mine: '#94a3b8', guide: '#c084fc', family: '#60a5fa' };
export const TT_LABELS = { explore: 'Explore', fit: 'Body', core: 'Core program', ai: 'AI & tools', sip: 'Governance', pbl: 'Projects', community: 'Community', live: 'Live', mine: 'Self-directed', guide: 'Guide', family: 'Family' };
export function timetable(events, monday = mondayOf()) {
  const days = [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const inDay = (d) => events.filter((e) => new Date(e.start * 1000).toDateString() === d.toDateString()).sort((a, b) => a.start - b.start);
  const shown = days.filter((d, i) => i < 5 || inDay(d).length);
  const hourOf = (ts) => { const x = new Date(ts * 1000); return x.getHours() + x.getMinutes() / 60; };
  let lo = 8, hi = 17;
  shown.forEach((d) => inDay(d).forEach((e) => { lo = Math.min(lo, Math.floor(hourOf(e.start))); const end = hourOf(e.end || e.start + 3600); hi = Math.max(hi, Math.ceil(end < hourOf(e.start) ? 24 : end)); }));
  const rows = Math.max(1, hi - lo);
  const fmt = (h) => (h % 12 || 12) + (h < 12 || h === 24 ? 'am' : 'pm');
  const t = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date().toDateString();
  const hasToday = shown.some((d) => d.toDateString() === today);
  const nowH = hourOf(Date.now() / 1000);
  return `<div class="tt-tabs" role="tablist">${shown.map((d, i) => `<button type="button" role="tab" aria-selected="${hasToday ? d.toDateString() === today : i === 0}" data-day="${ymd(d)}">${d.toLocaleDateString(undefined, { weekday: 'short' })}</button>`).join('')}</div>
  <div class="tt-grid" style="--rows:${rows};grid-template-columns:52px repeat(${shown.length},minmax(0,1fr))">
    <div class="tt-gutter"><div class="tt-dayhead"></div><div class="tt-hours">${[...Array(rows + 1)].map((_, i) => `<div class="tt-hour" style="top:${(i / rows) * 100}%">${fmt(lo + i)}</div>`).join('')}</div></div>
    ${shown.map((d) => `<div class="tt-col ${d.toDateString() === today ? 'today' : ''}" data-day="${ymd(d)}"><div class="tt-dayhead"><span>${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}</span></div><div class="tt-track">
      ${inDay(d).map((e) => { const s = Math.max(lo, hourOf(e.start)); let en = hourOf(e.end || e.start + 3600); if (en < s) en = hi; en = Math.min(hi, en); const c = TT_COLOURS[e.type] || '#38bdf8';
        return `<button type="button" class="tt-block t-${esc(e.type)} ${en - s <= 1 ? 'short' : ''}" style="--c:${c};top:${((s - lo) / rows) * 100}%;height:${(Math.max(0.5, en - s) / rows) * 100}%" data-ev="${esc(e.id)}" title="${esc(e.title)}"><span class="tt-title">${e.private ? '🔒 ' : ''}${esc(e.title)}</span><span class="tt-time">${t(e.start)}${e.end ? ' – ' + t(e.end) : ''}</span></button>`; }).join('')}
      ${d.toDateString() === today && nowH > lo && nowH < hi ? `<div class="tt-now" style="top:${((nowH - lo) / rows) * 100}%"></div>` : ''}</div></div>`).join('')}
  </div>`;
}
// Mobile: show one day at a time.
export function wireTimetable(root) {
  if (!root) return;
  const tabs = $$('.tt-tabs button', root);
  const show = (day) => { tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.day === day))); $$('.tt-col', root).forEach((c) => c.classList.toggle('m-show', c.dataset.day === day)); };
  tabs.forEach((b) => b.onclick = () => show(b.dataset.day));
  const sel = tabs.find((b) => b.getAttribute('aria-selected') === 'true') || tabs[0];
  if (sel) show(sel.dataset.day);
}
