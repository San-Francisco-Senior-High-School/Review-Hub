/* REVIEW+ core: helpers, device storage, server calls, syncing, theme, navigation. */
'use strict';
const CFG = window.REVIEW_HUB_CONFIG || {};
const VERSION = '2.0.0';

/* ---------------- constants ---------------- */
const TERMS = { T1: 'Term 1', T2: 'Term 2', T3: 'Term 3' };
const TERM_IDS = ['T1', 'T2', 'T3'];
const QT = { mc: 'Multiple Choice', tf: 'True or False', id: 'Identification', match: 'Matching Type', enum: 'Enumeration', fill: 'Fill in the Blanks', short: 'Short Answer', problem: 'Problem-Solving', essay: 'Essay' };
const QT_IDS = Object.keys(QT);
const OBJECTIVE = ['mc', 'tf', 'id', 'match', 'enum', 'fill'];
const BLOOM = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const DIFFS = ['Easy', 'Average', 'Difficult'];
const KINDS = { practice: 'Practice quiz', pretest: 'Pre-test', posttest: 'Post-test' };
const FEEDBACK_MODES = { each: 'After each question', end: 'After finishing (review all answers)', score: 'Score only, no answers' };
const STATUS = { draft: ['Locked (draft)', 'lock'], scheduled: ['Scheduled', 'warn'], published: ['Published', 'ok'], unpublished: ['Unpublished', 'bad'], archived: ['Archived', 'info'] };
const TYPES = { pdf: ['PDF', 'PDF'], slides: ['PPT', 'Slides'], doc: ['DOC', 'Document'], sheet: ['XLS', 'Spreadsheet'], image: ['IMG', 'Picture'], audio: ['AUD', 'Audio'], video: ['VID', 'Video'], link: ['URL', 'Web link'], file: ['FILE', 'File'] };
const MAX_MB = 25;
const ROLE = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Same rules as the server's norm_(): capital letters, punctuation and extra spaces don't matter. */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/['’₱,]/g, '').replace(/[^a-z0-9ñ. ]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtLong = iso => iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
const ago = iso => { if (!iso) return ''; const n = Math.floor((Date.now() - new Date(iso)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 30 ? n + ' days ago' : fmtDate(iso); };
const fmtSize = b => !b ? '' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const opt = (v, l, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const dash = v => v === null || v === undefined || v === '' ? '–' : v;
const pctTxt = v => v === null || v === undefined ? '–' : v + '%';
const localInput = iso => { const d = iso ? new Date(iso) : new Date(Date.now() + 864e5); return ymd(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const statusPill = (st, at) => { const s = STATUS[st] || STATUS.draft; return `<span class="pill ${s[1]}">${s[0]}${st === 'scheduled' && at ? ' · ' + esc(fmtTime(at)) : ''}</span>`; };
const typeTag = (m, sm) => { const t = TYPES[m.type] || TYPES.file; return `<div class="ftag${m.type === 'link' ? ' link' : ''}${sm ? ' sm' : ''}">${t[0]}</div>`; };
const termName = t => TERMS[t] || '';

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4600); }
function openModal(html, wide) {
  const sh = $('#sheet');
  sh.className = 'sheet' + (wide ? ' wide' : '');
  sh.innerHTML = '<button class="btn ghost small x" data-act="close" aria-label="Close">Close ✕</button>' + html;
  $('#modal').hidden = false; sh.focus();
}
function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }
const modalOpen = () => !$('#modal').hidden;

/* ---------------- device storage ---------------- */
const KV = (() => {
  let dbp = null;
  const mem = { kv: new Map(), files: new Map() };
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const r = indexedDB.open('reviewhub', 1);
        r.onupgradeneeded = () => { const db = r.result; ['kv', 'files'].forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    if (!db) return fn(null, mem[store]);
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), os = t.objectStore(store);
      let out; const r = fn(os);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Storage is full.'));
    });
  }
  return {
    get: (k, s = 'kv') => run(s, 'readonly', (os, m) => os ? os.get(k) : m.get(k)),
    set: (k, v, s = 'kv') => run(s, 'readwrite', (os, m) => os ? os.put(v, k) : void m.set(k, v)),
    del: (k, s = 'kv') => run(s, 'readwrite', (os, m) => os ? os.delete(k) : void m.delete(k))
  };
})();
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem('rh:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem('rh:' + k, JSON.stringify(v)); } catch (e) { } }
};

/* ---------------- state ---------------- */
const ST = {
  token: null, user: null, cat: null, branding: null, serverVersion: null,
  pending: [], events: [], fbq: [], saved: {}, lastFeedback: null,
  screen: 'login', tab: null, group: null,
  f: { q: '', subject: 'all', term: 'all', type: 'all', sort: 'new', grade: 'all', strand: 'all', section: 'all', sy: 'all' },
  mf: { q: '', sy: 'all', grade: 'all', strand: 'all', subject: 'all', term: 'all', topic: '', status: 'active', teacher: 'all' },
  qf: { q: '', term: 'all', subject: 'all', status: 'active', kind: 'all' },
  sel: new Set(), subj: null, sterm: null,
  quiz: null, edit: null, adm: null, results: null, resSel: null, stats: null, grading: null,
  dash: { preset: 'month', from: '', to: '', data: null, key: '' }, rep: null,
  logCat: 'All', uq: '', urole: 'all', secSy: null,
  up: null, installEvt: null, loading: {}
};
const C = () => ST.cat || { materials: [], quizzes: [], sections: [], settings: { strands: [], subjects: [], currentTerm: 'T1', schoolYear: '', termDates: {} }, myAttempts: [] };
const secById = id => C().sections.find(s => s.id === id);
const secLabel = id => (secById(id) || {}).label || 'Removed section';
const matById = id => C().materials.find(m => m.id === id);
const quizById = id => C().quizzes.find(q => q.id === id);
const isStudent = () => !!ST.user && ST.user.role === 'student';
const isStaff = () => !!ST.user && ST.user.role !== 'student';
const isAdmin = () => !!ST.user && ST.user.role === 'admin';
const isMine = x => isAdmin() || (ST.user && x.teacherId === ST.user.id);
const quizzesFor = mid => C().quizzes.filter(q => q.status === 'published' && (q.materialId === mid || (q.materialIds || []).includes(mid)));
const fileLike = m => m && m.type !== 'link';
const appName = () => (ST.branding && ST.branding.appName) || 'REVIEW+';
const schoolName = () => (ST.branding && ST.branding.schoolName) || CFG.schoolName || 'San Francisco Senior High School';
const schoolYears = () => { const s = new Set([C().settings.schoolYear].filter(Boolean)); C().materials.forEach(m => m.sy && s.add(m.sy)); C().sections.forEach(x => x.sy && s.add(x.sy)); return [...s].sort().reverse(); };
function aud(ids) {
  const out = [];
  ['11', '12'].forEach(g => {
    const mine = ids.filter(id => (secById(id) || {}).grade == g);
    if (!mine.length) return;
    const sy = (secById(mine[0]) || {}).sy;
    const all = C().sections.filter(s => String(s.grade) === g && (!sy || s.sy === sy)).map(s => s.id);
    if (isStaff() && mine.length === all.length) out.push('All Grade ' + g);
    else {
      const strands = [...new Set(mine.map(id => secById(id).strand))];
      const full = strands.filter(st => C().sections.filter(s => s.grade == g && s.strand === st && (!sy || s.sy === sy)).every(s => mine.includes(s.id)));
      out.push(isStaff() && full.length === strands.length ? 'Grade ' + g + ' ' + strands.join(', ') : mine.map(secLabel).join(', '));
    }
  });
  return out.join(' · ') || (isStudent() ? 'Your section' : 'No sections');
}
async function persist() {
  await Promise.all([
    KV.set('session', ST.token ? { token: ST.token, user: ST.user } : null), KV.set('pending', ST.pending), KV.set('events', ST.events),
    KV.set('fbq', ST.fbq), KV.set('savedIndex', ST.saved), KV.set('lastFeedback', ST.lastFeedback)
  ]);
}

/* ---------------- server ---------------- */
class UserErr extends Error { constructor(m, offline, code) { super(m); this.offline = !!offline; this.code = code || ''; } }
const apiReady = () => !!CFG.apiUrl && !/PASTE_YOUR/.test(CFG.apiUrl);
async function api(action, data, opts) {
  const timeout = (opts && opts.timeout) || 60000;
  if (!apiReady()) throw new UserErr('This app isn’t connected to the school server yet. The admin needs to put the web app URL in config.js.');
  if (!navigator.onLine) throw new UserErr('You’re offline. Connect to the internet and try again.', true);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(CFG.apiUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, token: ST.token }, data || {})), signal: ctrl.signal, redirect: 'follow' });
  } catch (e) {
    throw new UserErr(e.name === 'AbortError' ? 'The school server took too long to answer. Check your connection and try again.' : 'Can’t reach the school server. Check your internet and try again.', true);
  } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) { throw new UserErr('The school server sent an unexpected reply. Try again in a minute.'); }
  if (j.serverVersion) ST.serverVersion = j.serverVersion;
  if (!j.ok) {
    if (j.code === 'auth' && ST.token) { await signOutLocal(); render(); }
    throw new UserErr(j.error || 'Something went wrong. Try again.', false, j.code);
  }
  return j;
}

async function refresh(quiet) {
  if (!ST.token || !navigator.onLine || !apiReady() || ST.refreshing) return;
  ST.refreshing = true;
  try {
    await sync(true);
    const r = await api('catalog');
    if (!r.serverVersion) ST.serverVersion = '1';
    ST.cat = r; ST.user = r.user; ST.lastRefresh = Date.now();
    if (r.branding) applyBranding(r.branding);
    await purgeLocked();
    await KV.set('catalog', ST.cat); await persist();
    if (!quiet || !isBusy()) render(); else renderTop();
  } catch (e) { if (!quiet) toast(e.message); }
  finally { ST.refreshing = false; }
}
const isBusy = () => !!(ST.quiz || ST.edit || modalOpen() || document.querySelector('#app form[data-dirty]') || (ST.up && ST.up.busy));

/** Saved copies of materials the teacher locked, unpublished or removed are deleted from the phone. */
async function purgeLocked() {
  if (!isStudent()) return;
  const live = new Set(C().materials.map(m => m.id));
  const gone = Object.keys(ST.saved).filter(id => !live.has(id));
  for (const id of gone) { await KV.del(id, 'files'); await KV.del('pv:' + id); delete ST.saved[id]; }
  if (gone.length) toast(plural(gone.length, 'saved file was', 'saved files were') + ' removed from this phone because the teacher locked or removed them.');
}

async function sync(silent) {
  if (!ST.token || !navigator.onLine || ST.syncing || !apiReady()) return;
  if (!ST.pending.length && !ST.events.length && !ST.fbq.length) return;
  ST.syncing = true;
  try {
    if (ST.pending.length) {
      const r = await api('submitAttempts', { attempts: ST.pending.map(a => ({ clientId: a.clientId, quizId: a.quizId, responses: a.responses, takenAt: a.takenAt })) });
      const ok = new Set(r.saved);
      const done = ST.pending.filter(a => ok.has(a.clientId));
      ST.pending = ST.pending.filter(a => !ok.has(a.clientId));
      if (ST.cat && done.length) {
        const have = new Set((ST.cat.myAttempts || []).map(a => a.clientId));
        ST.cat.myAttempts = (ST.cat.myAttempts || []).concat(done.filter(a => !have.has(a.clientId)).map(a => ({ clientId: a.clientId, quizId: a.quizId, pct: a.pct, score: a.score, maxScore: a.maxScore, status: a.status, takenAt: a.takenAt, results: a.results })));
        await KV.set('catalog', ST.cat);
      }
      if (done.length && !silent) toast(plural(done.length, 'quiz result') + ' synced to your teachers.');
      ST.justSynced = (ST.justSynced || 0) + done.length;
    }
    if (ST.events.length) {
      const batch = ST.events.slice(0, 300);
      const r = await api('logEvents', { events: batch });
      const ok = new Set(r.saved);
      ST.events = ST.events.filter(e => !ok.has(e.clientId));
    }
    if (ST.fbq.length) {
      const r = await api('submitFeedback', { feedback: ST.fbq });
      const ok = new Set(r.saved);
      ST.fbq = ST.fbq.filter(f => !ok.has(f.clientId));
    }
    await persist();
  } catch (e) { if (!silent) toast(e.message); }
  finally { ST.syncing = false; renderTop(); }
}
function logEvent(type, materialId, quizId) {
  if (!isStudent()) return;
  ST.events.push({ clientId: uid(), type: type, materialId: materialId || '', quizId: quizId || '', time: new Date().toISOString() });
  persist();
  clearTimeout(ST.evT);
  ST.evT = setTimeout(() => sync(true), 4000);
}
function noteOfflineOpen() {
  if (!isStudent() || navigator.onLine) return;
  const k = ymd(new Date());
  if (LS.get('openDay') === k) return;
  LS.set('openDay', k);
  logEvent('open');
}

async function signOutLocal() {
  ST.token = null; ST.user = null; ST.cat = null; ST.pending = []; ST.events = []; ST.fbq = []; ST.adm = null; ST.results = null; ST.stats = null; ST.grading = null;
  ST.quiz = null; ST.edit = null; ST.tab = null; ST.group = null; ST.screen = 'login'; ST.dash.data = null; ST.rep = null; ST.up = null;
  for (const id of Object.keys(ST.saved)) { await KV.del(id, 'files'); await KV.del('pv:' + id); }
  ST.saved = {};
  await Promise.all([KV.del('catalog'), KV.del('results'), persist()]);
}

/* ---------------- files ---------------- */
function b64ToBlob(b64, mime) {
  const bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}
function fileToB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new UserErr('Couldn’t read that file. Try choosing it again.')); r.readAsDataURL(file); });
}
function saveBlob(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
function csvText(header, rows) {
  const q = v => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + [header].concat(rows).map(r => r.map(q).join(',')).join('\r\n');
}
function downloadCSV(name, header, rows) { saveBlob(new Blob([csvText(header, rows)], { type: 'text/csv' }), name); }

/** A small zip writer (files stored without compression), for the app-icon download. */
function makeZip(files) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), data = f.data, c = crc(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, c, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, c, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const size = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
}

/* ---------------- theme and branding ---------------- */
const PRESETS = {
  green: ['Forest green', '#0b6b55', '#f4c63d'], blue: ['Royal blue', '#1f4fa3', '#f2b705'], maroon: ['Maroon', '#7b1e2b', '#e8b23a'],
  navy: ['Navy', '#1d3557', '#f4a261'], purple: ['Purple', '#5b2a86', '#f6c445'], teal: ['Teal', '#0f6e6e', '#ff8c42'], red: ['Red', '#b42318', '#f5c518'], gray: ['Slate', '#3d4a56', '#5fb3b3']
};
const hexRgb = h => { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return isNaN(n) ? [11, 107, 85] : [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = c => '#' + c.map(v => pad2(Math.max(0, Math.min(255, Math.round(v))).toString(16))).join('');
const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = h => { const c = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const reach = (c, bg, ratio, toward) => { let out = c; for (let i = 1; i <= 20 && contrast(out, bg) < ratio; i++) out = mix(c, toward, i / 20); return out; };
function palette(theme) {
  const p = (theme && theme.primary) || '#0b6b55', h = (theme && theme.highlight) || '#f4c63d', colored = theme && theme.header === 'color';
  const L = { paper: mix('#f4f6f5', p, 0.035), card: '#ffffff', ink: '#16262a', muted: '#566a6c', line: mix('#d9e2de', p, 0.08) };
  L.accent = reach(p, '#ffffff', 4.5, '#000000');
  L['accent-ink'] = contrast(L.accent, '#ffffff') >= 4.5 ? '#ffffff' : '#111111';
  L['accent-soft'] = mix(L.accent, '#ffffff', 0.86);
  L['accent-text'] = reach(L.accent, L['accent-soft'], 4.5, '#000000');
  L.hi = h; L['hi-on'] = contrast(h, '#1a1a1a') >= 4.5 ? '#1a1600' : '#ffffff';
  L['hi-soft'] = mix(h, '#ffffff', 0.76); L['hi-soft-ink'] = reach(mix(h, '#000000', 0.55), L['hi-soft'], 4.5, '#000000');
  L['info-soft'] = mix('#e8eef0', p, 0.05);
  const Dk = { paper: mix('#0e1618', p, 0.06), card: mix('#162124', p, 0.05), ink: '#e6eeec', muted: '#9aaba8', line: mix('#2a3b3e', p, 0.1) };
  Dk.accent = reach(p, Dk.card, 4.5, '#ffffff');
  Dk['accent-ink'] = contrast(Dk.accent, '#0b1210') >= 4.5 ? '#0b1210' : '#ffffff';
  Dk['accent-soft'] = mix(Dk.accent, Dk.paper, 0.78);
  Dk['accent-text'] = reach(Dk.accent, Dk['accent-soft'], 4.5, '#ffffff');
  Dk.hi = h; Dk['hi-on'] = L['hi-on'];
  Dk['hi-soft'] = mix(h, Dk.paper, 0.8); Dk['hi-soft-ink'] = reach(h, Dk['hi-soft'], 4.5, '#ffffff');
  Dk['info-soft'] = mix('#1f2c2f', p, 0.06);
  if (colored) {
    Object.assign(L, { 'top-bg': L.accent, 'top-ink': L['accent-ink'], 'top-muted': mix(L['accent-ink'], L.accent, 0.25) });
    const tb = mix(p, Dk.paper, 0.45);
    Object.assign(Dk, { 'top-bg': tb, 'top-ink': contrast(tb, '#ffffff') >= 4.5 ? '#ffffff' : '#0b1210', 'top-muted': contrast(tb, '#ffffff') >= 4.5 ? '#d8e2df' : '#26302e' });
  } else {
    Object.assign(L, { 'top-bg': L.card, 'top-ink': L.ink, 'top-muted': L.muted });
    Object.assign(Dk, { 'top-bg': Dk.card, 'top-ink': Dk.ink, 'top-muted': Dk.muted });
  }
  return { L: L, D: Dk, primary: p };
}
function applyTheme(theme) {
  const pal = palette(theme);
  const block = o => Object.keys(o).map(k => '--' + k + ':' + o[k]).join(';');
  let el = $('#theme-vars');
  if (!el) { el = document.createElement('style'); el.id = 'theme-vars'; document.head.appendChild(el); }
  el.textContent = `:root{${block(pal.L)}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block(pal.D)};color-scheme:dark}}:root[data-theme="dark"]{${block(pal.D)};color-scheme:dark}`;
  const mode = LS.get('mode', 'system');
  if (mode === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', mode);
  const meta = $('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', theme && theme.header === 'color' ? pal.L.accent : pal.L.card);
  ST.colored = !!(theme && theme.header === 'color');
}
function applyBranding(b) {
  if (!b) return;
  ST.branding = b;
  LS.set('branding', b);
  document.title = (b.appName || 'REVIEW+') + ' · ' + (b.schoolName || '');
  applyTheme(b.theme);
}
const initials = name => { const w = String(name || '').split(/\s+/).filter(x => x && !/^(senior|high|school|national|integrated|of|the|and|shs|nhs)$/i.test(x)); return ((w[0] || 'R')[0] + ((w[1] || '')[0] || '')).toUpperCase(); };
const brandMark = cls => ST.branding && ST.branding.logo ? `<img class="logo ${cls || ''}" src="${esc(ST.branding.logo)}" alt="">` : `<div class="seal ${cls || ''}" aria-hidden="true">${esc(initials(schoolName()))}</div>`;

/* ---------------- top bar and navigation ---------------- */
const NAV = {
  student: [[null, [['find', 'Find materials'], ['subjects', 'By term'], ['saved', 'Saved offline'], ['practice', 'Practice'], ['progress', 'My progress']]]],
  teacher: [[null, [['dash', 'Dashboard'], ['upload', 'Upload'], ['manage', 'My materials'], ['quizzes', 'Quizzes'], ['check', 'To check'], ['results', 'Results'], ['library', 'Library'], ['reports', 'Reports']]]],
  admin: [
    ['Overview', [['dash', 'Dashboard'], ['reports', 'Reports'], ['activity', 'Activity']]],
    ['People', [['approvals', 'Approvals'], ['users', 'Users'], ['sections', 'Sections']]],
    ['Learning', [['manage', 'All materials'], ['upload', 'Upload'], ['quizzes', 'Quizzes'], ['check', 'To check'], ['results', 'Results'], ['library', 'Library']]],
    ['School', [['settings', 'Settings'], ['branding', 'Branding'], ['backups', 'Backups']]]
  ]
};
const V = {}; // views, filled in by the other files
const A = {}; // actions for data-act buttons, filled in by the other files

function renderTop() {
  const top = $('#top');
  if (!ST.user) { top.hidden = true; return; }
  top.hidden = false;
  top.classList.toggle('colored', !!ST.colored);
  const on = navigator.onLine, n = ST.pending.length;
  const sec = isStudent() && secById(ST.user.sectionId) ? ' · ' + secLabel(ST.user.sectionId) : '';
  const canInstall = ST.installEvt || (isIOS() && !standalone());
  top.innerHTML = `<div class="wrap"><div class="brand">${brandMark()}<div><b>${esc(appName())}</b><span>${esc(ST.user.name)} · ${ROLE[ST.user.role]}${esc(sec)}</span></div></div>
    <span class="net ${on ? '' : 'off'}"><i></i>${on ? 'Online' : 'Offline'}${n ? ' · ' + n + ' to sync' : ''}</span>
    ${canInstall ? '<button class="btn small" data-act="install">Install app</button>' : ''}
    <button class="btn small" data-act="account">Account</button></div>`;
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

function navFor(role) { return NAV[role]; }
function render() {
  renderTop();
  const app = $('#app');
  if (!ST.user) { app.innerHTML = ST.screen === 'signup' ? V.signup() : V.login(); if (ST.screen === 'signup') loadSignupOptions(); return; }
  if (ST.user.mustChange) { app.innerHTML = V.changePw(true); return; }
  if (ST.quiz) { app.innerHTML = V.quiz(); return; }
  if (ST.edit) { app.innerHTML = V.quizEditor(); return; }
  const nav = navFor(ST.user.role);
  const allTabs = nav.flatMap(g => g[1]);
  if (!allTabs.some(t => t[0] === ST.tab)) { ST.tab = LS.get('tab:' + ST.user.role, allTabs[0][0]); if (!allTabs.some(t => t[0] === ST.tab)) ST.tab = allTabs[0][0]; }
  const group = nav.find(g => g[1].some(t => t[0] === ST.tab));
  if (!ST.cat) {
    app.innerHTML = `<div class="panel narrow"><h2>Almost ready</h2><p>${navigator.onLine ? 'Downloading your school’s materials…' : 'Connect to the internet once so the app can download your school’s materials. After that it works offline.'}</p><div><button class="btn primary" data-act="refresh">Try again</button></div></div>`;
    return;
  }
  const badges = { approvals: isAdmin() && ST.adm ? ST.adm.users.filter(u => u.status === 'pending').length : 0, saved: Object.keys(ST.saved).length, check: C().toCheck || 0 };
  let head = '';
  if (isAdmin() && ST.serverVersion && Number(String(ST.serverVersion).split('.')[0]) < 2) head += '<div class="banner bad"><span><b>The server code is out of date.</b> Paste the new Code.gs into Apps Script, run Review Hub › Set up or update database, then redeploy as a new version (setup guide, “Updating”).</span></div>';
  if (!navigator.onLine) head += `<div class="banner off"><span><b>You’re offline.</b> ${isStudent() ? 'Saved materials and all quizzes still work. Your scores sync when you’re back online.' : 'You can browse, but uploads, publishing and reports need internet.'}</span></div>`;
  if (nav.length > 1) head += `<div class="groups" role="group" aria-label="Sections of the app">${nav.map(g => `<button class="group" aria-pressed="${g === group}" data-act="group" data-id="${esc(g[0])}">${esc(g[0])}</button>`).join('')}</div>`;
  head += `<div class="tabs" role="tablist">${group[1].map(([id, l]) => `<button class="tab" role="tab" aria-selected="${id === ST.tab}" data-act="tab" data-id="${id}">${l}${badges[id] ? `<span class="count">${badges[id]}</span>` : ''}</button>`).join('')}</div>`;
  app.innerHTML = head + (V[ST.tab] ? V[ST.tab]() : '');
  if (V[ST.tab + 'After']) V[ST.tab + 'After']();
}

Object.assign(A, {
  tab: id => { if (ST.tab === 'branding' && id !== 'branding' && ST.bd) { ST.bd = null; applyTheme((ST.branding || {}).theme); } ST.tab = id; ST.subj = null; ST.sel = new Set(); LS.set('tab:' + ST.user.role, id); render(); window.scrollTo(0, 0); if (navigator.onLine && Date.now() - (ST.lastRefresh || 0) > 60000) refresh(true); },
  group: name => { const g = navFor(ST.user.role).find(x => x[0] === name); if (g) A.tab(g[1][0][0]); },
  gotab: id => { closeModal(); A.tab(id); },
  close: closeModal,
  refresh: () => { closeModal(); return refresh(); },
  copy: txt => { const ok = () => toast(txt.length > 40 ? 'Copied.' : 'Copied ' + txt); try { navigator.clipboard.writeText(txt).then(ok, () => toast('Couldn’t copy. Select the text and copy it.')); } catch (e) { toast('Couldn’t copy. Select the text and copy it.'); } }
});

/* ---------------- shared pieces ---------------- */
function sectionChecks(grade, strands, selected, cls, sy) {
  const year = sy || C().settings.schoolYear;
  const list = C().sections.filter(s => String(s.grade) === String(grade) && (!strands || strands.includes(s.strand)) && (!s.sy || s.sy === year));
  if (!list.length) return '<span class="small muted">No sections for this grade and strand in ' + esc(year) + '. The admin adds sections under People › Sections.</span>';
  return list.map(s => `<label class="check"><input type="checkbox" class="${cls}" value="${s.id}"${!selected || selected.includes(s.id) ? ' checked' : ''}> ${esc(s.label)}</label>`).join('');
}
function teacherSubjects() {
  const own = String((ST.user && ST.user.subjects) || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(own.concat(C().settings.subjects || []))];
}
function keepVals(fn) {
  const vals = $$('#app input[id], #app textarea[id], #app select[id], #sheet input[id], #sheet textarea[id], #sheet select[id]').filter(el => !['file', 'radio', 'checkbox', 'password'].includes(el.type)).map(el => [el.id, el.value]);
  fn();
  vals.forEach(([i, v]) => { const el = document.getElementById(i); if (el && el.dataset.keep !== 'no') el.value = v; });
}
