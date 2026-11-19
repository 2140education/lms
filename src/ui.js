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
  for (const [re, what] of PII) if (re.test(t)) return `This looks like it includes ${what}. Keep personal details off your public portfolio.`;
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
