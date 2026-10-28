/* SFSHS Review Hub app
 * Works offline: the app, the catalog, quizzes and saved files live on the device.
 * Talks to the Google Apps Script server set in config.js. */
'use strict';
(function () {
  const CFG = window.REVIEW_HUB_CONFIG || {};
  const VERSION = '1.0.0';

  /* ---------------- helpers ---------------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/['’₱,]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const TERMS = { Q1: 'Quarter 1', Q2: 'Quarter 2', Q3: 'Quarter 3', Q4: 'Quarter 4' };
  const SEMOF = { Q1: '1st Semester', Q2: '1st Semester', Q3: '2nd Semester', Q4: '2nd Semester' };
  const QT = { mc: 'Multiple choice', tf: 'True or false', id: 'Identification', match: 'Matching type' };
  const TYPES = { pdf: ['PDF', 'Handout (PDF)'], slides: ['PPT', 'Slides'], doc: ['DOC', 'Document'], sheet: ['XLS', 'Spreadsheet'], image: ['IMG', 'Picture'], audio: ['AUD', 'Audio'], video: ['VID', 'Video'], link: ['URL', 'Web link'], file: ['FILE', 'File'] };
  const DIFFS = ['Easy', 'Average', 'Difficult'];
  const MAX_MB = 25;
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const ago = iso => { if (!iso) return ''; const n = Math.floor((Date.now() - new Date(iso)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 30 ? n + ' days ago' : fmtDate(iso); };
  const fmtSize = b => !b ? '' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4200); }
  function openModal(html) { $('#sheet').innerHTML = '<button class="btn ghost small x" data-act="close" aria-label="Close">Close ✕</button>' + html; $('#modal').hidden = false; $('#sheet').focus(); }
  function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }

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

  /* ---------------- state ---------------- */
  const ST = {
    token: null, user: null, cat: null, pending: [], saved: {}, screen: 'login', tab: null,
    f: { q: '', grade: 'all', strand: 'all', section: 'all', subject: 'all', term: 'all', when: 'any', sort: 'new', mine: true },
    subj: null, quiz: null, edit: null, adm: null, results: null, resSel: null, reports: null,
    logCat: 'All', uq: '', urole: 'all', up: { grade: '11', strands: null, kind: 'file' }, installEvt: null, loading: {}
  };
  async function persist() {
    await Promise.all([KV.set('session', ST.token ? { token: ST.token, user: ST.user } : null), KV.set('pending', ST.pending), KV.set('savedIndex', ST.saved)]);
  }
  const C = () => ST.cat || { materials: [], quizzes: [], sections: [], settings: { strands: [], subjects: [], currentTerm: 'Q1' }, myAttempts: [] };
  const secById = id => C().sections.find(s => s.id === id);
  const secLabel = id => (secById(id) || {}).label || 'Removed section';
  const matById = id => C().materials.find(m => m.id === id);
  const isStudent = () => ST.user && ST.user.role === 'student';
  const isStaff = () => ST.user && ST.user.role !== 'student';
  const isAdmin = () => ST.user && ST.user.role === 'admin';
  const quizzesFor = mid => C().quizzes.filter(q => q.materialId === mid && q.published);
  function aud(ids) {
    const out = [];
    ['11', '12'].forEach(g => {
      const all = C().sections.filter(s => String(s.grade) === g).map(s => s.id);
      const mine = ids.filter(id => (secById(id) || {}).grade == g);
      if (!mine.length) return;
      if (mine.length === all.length) out.push('All Grade ' + g);
      else {
        const strands = [...new Set(mine.map(id => secById(id).strand))];
        const full = strands.filter(st => C().sections.filter(s => s.grade == g && s.strand === st).every(s => mine.includes(s.id)));
        out.push(full.length === strands.length ? 'Grade ' + g + ' ' + strands.join(', ') : mine.map(secLabel).join(', '));
      }
    });
    return out.join(' · ') || 'No sections';
  }
  const fileLike = m => m && m.type !== 'link';

  /* ---------------- server ---------------- */
  class UserErr extends Error { constructor(m, offline) { super(m); this.offline = !!offline; } }
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
    if (!j.ok) {
      if (j.code === 'auth' && ST.token) { await signOutLocal(); render(); }
      throw new UserErr(j.error || 'Something went wrong. Try again.');
    }
    return j;
  }

  async function refresh(quiet) {
    if (!ST.token || !navigator.onLine || !apiReady()) return;
    try {
      await sync(true);
      const r = await api('catalog');
      ST.cat = r; ST.user = r.user; ST.lastRefresh = Date.now();
      await KV.set('catalog', ST.cat); await persist();
      if (!quiet || !isBusy()) render();
    } catch (e) { if (!quiet) toast(e.message); }
  }
  const isBusy = () => !!(ST.quiz || ST.edit || !$('#modal').hidden || document.querySelector('#app form[data-dirty]'));

  async function sync(silent) {
    if (!ST.pending.length || !ST.token || !navigator.onLine || ST.syncing || !apiReady()) return;
    ST.syncing = true;
    try {
      const r = await api('submitAttempts', { attempts: ST.pending });
      const ok = new Set(r.saved);
      const done = ST.pending.filter(a => ok.has(a.clientId));
      ST.pending = ST.pending.filter(a => !ok.has(a.clientId));
      if (ST.cat) { const have = new Set((ST.cat.myAttempts || []).map(a => a.clientId)); ST.cat.myAttempts = (ST.cat.myAttempts || []).concat(done.filter(a => !have.has(a.clientId))); await KV.set('catalog', ST.cat); }
      await persist();
      if (done.length) toast(plural(done.length, 'quiz result') + ' synced to your teachers.');
    } catch (e) { if (!silent) toast(e.message); }
    finally { ST.syncing = false; renderTop(); }
  }

  async function signOutLocal() {
    ST.token = null; ST.user = null; ST.cat = null; ST.pending = []; ST.adm = null; ST.results = null; ST.reports = null; ST.quiz = null; ST.edit = null; ST.tab = null; ST.screen = 'login';
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
  async function getFile(m, count) {
    const saved = await KV.get(m.id, 'files');
    if (saved && saved.blob) return saved;
    const r = await api('file', { id: m.id, count: !!count }, { timeout: 180000 });
    return { blob: b64ToBlob(r.b64, r.mime), name: r.name, mime: r.mime };
  }
  function saveBlob(blob, name) {
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  function downloadCSV(name, header, rows) {
    const q = v => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    saveBlob(new Blob(['﻿' + [header].concat(rows).map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }), name);
  }

  /* ---------------- top bar ---------------- */
  const ROLE = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };
  function renderTop() {
    const top = $('#top');
    if (!ST.user) { top.hidden = true; return; }
    top.hidden = false;
    const on = navigator.onLine, n = ST.pending.length;
    const sec = isStudent() && secById(ST.user.sectionId) ? ' · ' + secLabel(ST.user.sectionId) : '';
    const canInstall = ST.installEvt || (isIOS() && !standalone());
    top.innerHTML = `<div class="wrap"><div class="brand"><div class="seal" aria-hidden="true">SF</div><div><b>Review Hub</b><span>${esc(ST.user.name)} · ${ROLE[ST.user.role]}${esc(sec)}</span></div></div>
      <span class="net ${on ? '' : 'off'}"><i></i>${on ? 'Online' : 'Offline'}${n ? ' · ' + n + ' to sync' : ''}</span>
      ${canInstall ? '<button class="btn small" data-act="install">Install app</button>' : ''}
      <button class="btn small ghost" data-act="account">Account</button></div>`;
  }
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  /* ---------------- main render ---------------- */
  const TABS = {
    student: [['find', 'Find materials'], ['subjects', 'Subjects'], ['saved', 'Saved offline'], ['practice', 'Practice'], ['progress', 'My progress']],
    teacher: [['find', 'Library'], ['upload', 'Upload'], ['mine', 'My materials'], ['quizzes', 'Quizzes'], ['results', 'Results']],
    admin: [['approvals', 'Approvals'], ['users', 'Users'], ['sections', 'Sections'], ['settings', 'Settings'], ['content', 'Content'], ['reports', 'Reports'], ['activity', 'Activity'], ['backups', 'Backups'], ['find', 'Library'], ['upload', 'Upload'], ['quizzes', 'Quizzes'], ['results', 'Results']]
  };
  function render() {
    renderTop();
    const app = $('#app');
    if (!ST.user) { app.innerHTML = ST.screen === 'signup' ? vSignup() : vLogin(); if (ST.screen === 'signup') loadSignupOptions(); return; }
    if (ST.user.mustChange) { app.innerHTML = vChangePw(true); return; }
    if (ST.quiz) { app.innerHTML = vQuiz(); return; }
    if (ST.edit) { app.innerHTML = vQuizEditor(); return; }
    const tabs = TABS[ST.user.role];
    if (!tabs.some(t => t[0] === ST.tab)) ST.tab = tabs[0][0];
    if (!ST.cat) {
      app.innerHTML = `<div class="panel narrow"><h2>Almost ready</h2><p>${navigator.onLine ? 'Downloading your school’s materials…' : 'Connect to the internet once so the app can download your school’s materials. After that it works offline.'}</p><div><button class="btn primary" data-act="refresh">Try again</button></div></div>`;
      return;
    }
    const pendingCount = isAdmin() && ST.adm ? ST.adm.users.filter(u => u.status === 'pending').length : 0;
    let head = '';
    if (!navigator.onLine) head += `<div class="banner off"><span><b>You’re offline.</b> ${isStudent() ? 'Saved materials and all quizzes still work. Your scores sync when you’re back online.' : 'You can browse, but uploads and reports need internet.'}</span></div>`;
    head += `<div class="tabs" role="tablist">${tabs.map(([id, l]) => `<button class="tab" role="tab" aria-selected="${id === ST.tab}" data-act="tab" data-id="${id}">${l}${id === 'approvals' && pendingCount ? `<span class="count">${pendingCount}</span>` : ''}${id === 'saved' && Object.keys(ST.saved).length ? `<span class="count">${Object.keys(ST.saved).length}</span>` : ''}</button>`).join('')}</div>`;
    const V = { find: vFind, subjects: vSubjects, saved: vSaved, practice: vPractice, progress: vProgress, upload: vUpload, mine: vMine, quizzes: vQuizzes, results: vResults, approvals: vApprovals, users: vUsers, sections: vSections, settings: vSettings, content: vContent, reports: vReports, activity: vActivity, backups: vBackups };
    app.innerHTML = head + V[ST.tab]();
    if (ST.tab === 'find') updateResults();
    if (ST.tab === 'saved') showStorage();
  }

  /* ================= AUTH SCREENS ================= */
  function vLogin() {
    return `<form class="panel auth" id="loginForm" novalidate>
      <div class="row"><div class="seal" aria-hidden="true">SF</div><div><h1>Review Hub</h1><p class="muted small">${esc(CFG.schoolName || 'San Francisco Senior High School')}</p></div></div>
      ${apiReady() ? '' : '<div class="banner warn small"><span>This copy of the app isn’t connected to the school server yet. Put the web app URL in <b>config.js</b> (setup guide, step 4).</span></div>'}
      <label class="field"><span>LRN or username</span><input type="text" id="liId" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Students: your 12-digit LRN"></label>
      <label class="field"><span>Password</span><input type="password" id="liPw" autocomplete="current-password"></label>
      <div class="row"><button class="btn primary" type="submit" id="liBtn">Sign in</button><span class="err" id="liErr" role="alert"></span></div>
      <p class="small">New student? <button type="button" class="btn small" data-act="screen" data-id="signup">Sign up</button></p>
      <p class="small muted">Forgot your password? Ask your adviser or the admin to reset it.</p></form>`;
  }
  async function doLogin(e) {
    e.preventDefault();
    const id = $('#liId').value.trim(), pw = $('#liPw').value;
    $('#liErr').textContent = ''; $('#liBtn').disabled = true; $('#liBtn').textContent = 'Signing in…';
    try {
      const r = await api('login', { id: id, password: pw });
      const prev = ST.user;
      ST.token = r.token; ST.user = r.user;
      if (!prev || prev.id !== r.user.id) { ST.cat = null; await KV.del('catalog'); }
      ST.f.mine = r.user.role === 'student';
      await persist(); render();
      if (!r.user.mustChange) await refresh();
    } catch (err) { $('#liErr').textContent = err.message; $('#liBtn').disabled = false; $('#liBtn').textContent = 'Sign in'; }
  }

  let signupOpts = null;
  function vSignup() {
    if (!signupOpts) return `<div class="panel auth"><h1>Student sign-up</h1><p class="muted" id="suLoad">${navigator.onLine ? 'Loading sections…' : 'You need internet to sign up.'}</p><div><button class="btn" data-act="screen" data-id="login">Back to sign in</button></div></div>`;
    const g = ST.sg || '11', strands = signupOpts.strands.filter(st => signupOpts.sections.some(s => s.grade == g && s.strand === st));
    const st = strands.includes(ST.ss) ? ST.ss : strands[0];
    const secs = signupOpts.sections.filter(s => s.grade == g && s.strand === st);
    return `<form class="panel auth" id="suForm" novalidate>
      <div><p class="label">Student sign-up</p><h1>Join the Review Hub</h1><p class="muted small">Ask your adviser for your class code before you start.</p></div>
      <label class="field"><span>Full name</span><input type="text" id="suName" placeholder="First name, middle initial, last name" autocomplete="name"></label>
      <label class="field"><span>LRN</span><input type="text" id="suLrn" inputmode="numeric" placeholder="12-digit Learner Reference Number"><small>It’s on your report card.</small></label>
      <div class="fgrid"><label class="field"><span>Grade</span><select id="suGrade">${opt('11', 'Grade 11', g)}${opt('12', 'Grade 12', g)}</select></label>
      <label class="field"><span>Strand</span><select id="suStrand">${strands.map(s => opt(s, s, st)).join('') || '<option value="">None yet</option>'}</select></label>
      <label class="field"><span>Section</span><select id="suSection">${secs.map(s => opt(s.id, s.label, '')).join('') || '<option value="">None yet</option>'}</select></label></div>
      <label class="field"><span>Class code</span><input type="text" id="suCode" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-family:var(--f-mono);text-transform:uppercase"></label>
      <div class="fgrid two"><label class="field"><span>Password</span><input type="password" id="suPw" autocomplete="new-password"><small>At least 8 characters.</small></label>
      <label class="field"><span>Type it again</span><input type="password" id="suPw2" autocomplete="new-password"></label></div>
      <div class="row"><button class="btn primary" type="submit" id="suBtn">Send sign-up</button><button type="button" class="btn ghost" data-act="screen" data-id="login">Back to sign in</button></div>
      <p class="err" id="suErr" role="alert"></p></form>`;
  }
  async function loadSignupOptions() {
    if (signupOpts || !navigator.onLine) return;
    try { signupOpts = await api('signupOptions'); render(); } catch (e) { const l = $('#suLoad'); if (l) l.textContent = e.message; }
  }
  async function doSignup(e) {
    e.preventDefault();
    const v = id => $('#' + id).value;
    const err = v('suName').trim().split(/\s+/).length < 2 ? 'Enter your full name (first and last name).' : !/^\d{12}$/.test(v('suLrn').trim()) ? 'Your LRN should be exactly 12 digits.' : !v('suSection') ? 'Choose your section.' : !v('suCode').trim() ? 'Enter the class code from your adviser.' : v('suPw').length < 8 ? 'Your password needs at least 8 characters.' : v('suPw') !== v('suPw2') ? 'The two passwords don’t match.' : '';
    if (err) { $('#suErr').textContent = err; return; }
    $('#suBtn').disabled = true;
    try {
      await api('signup', { name: v('suName'), lrn: v('suLrn').trim(), sectionId: v('suSection'), code: v('suCode'), password: v('suPw') });
      $('#app').innerHTML = `<div class="panel auth"><p class="label">Sign-up sent</p><h1>Thanks!</h1><p>Your account is waiting for approval. Your adviser or the admin will check your class code. You can sign in once it’s approved, usually within a day.</p><div><button class="btn primary" data-act="screen" data-id="login">Back to sign in</button></div></div>`;
    } catch (ex) { $('#suErr').textContent = ex.message; $('#suBtn').disabled = false; }
  }

  function vChangePw(forced) {
    return `<form class="panel auth" id="pwForm" novalidate><div><p class="label">${forced ? 'One more step' : 'Account'}</p><h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
      ${forced ? '<p class="muted small">You signed in with a temporary password. Choose a new one that only you know.</p>' : ''}</div>
      <label class="field"><span>${forced ? 'Temporary password' : 'Current password'}</span><input type="password" id="pwCur" autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" id="pwNew" autocomplete="new-password"><small>At least 8 characters.</small></label>
      <label class="field"><span>Type the new password again</span><input type="password" id="pwNew2" autocomplete="new-password"></label>
      <div class="row"><button class="btn primary" type="submit">Save password</button>${forced ? '<button type="button" class="btn ghost" data-act="signout">Sign out</button>' : ''}</div><p class="err" id="pwErr" role="alert"></p></form>`;
  }
  async function doChangePw(e) {
    e.preventDefault();
    const n = $('#pwNew').value;
    if (n.length < 8) { $('#pwErr').textContent = 'Your new password needs at least 8 characters.'; return; }
    if (n !== $('#pwNew2').value) { $('#pwErr').textContent = 'The two new passwords don’t match.'; return; }
    try {
      const r = await api('changePassword', { current: $('#pwCur').value, password: n });
      const forced = ST.user.mustChange;
      ST.user = r.user; await persist(); closeModal(); toast('Password saved.');
      render(); if (forced) await refresh();
    } catch (ex) { $('#pwErr').textContent = ex.message; }
  }

  /* ================= LIBRARY (students and staff) ================= */
  function vFind() {
    const f = ST.f, c = C();
    const subjects = [...new Set(c.materials.map(m => m.subject))].sort();
    const mySec = isStudent() && secById(ST.user.sectionId);
    return `<div class="searchbox"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input type="search" id="q" placeholder="Search a topic, like “domain” or “photosynthesis”" value="${esc(f.q)}" aria-label="Search materials"></div>
      <div class="fgrid">
        <label class="field"><span>Grade</span><select id="fgrade">${opt('all', 'All grades', f.grade)}${opt('11', 'Grade 11', f.grade)}${opt('12', 'Grade 12', f.grade)}</select></label>
        <label class="field"><span>Strand</span><select id="fstrand">${opt('all', 'All strands', f.strand)}${c.settings.strands.map(s => opt(s, s, f.strand)).join('')}</select></label>
        <label class="field"><span>Section</span><select id="fsection">${opt('all', 'All sections', f.section)}${c.sections.map(s => opt(s.id, s.label, f.section)).join('')}</select></label>
        <label class="field"><span>Subject</span><select id="fsubject">${opt('all', 'All subjects', f.subject)}${subjects.map(s => opt(s, s, f.subject)).join('')}</select></label>
        <label class="field"><span>Quarter</span><select id="fterm">${opt('all', 'All quarters', f.term)}${Object.keys(TERMS).map(k => opt(k, TERMS[k], f.term)).join('')}</select></label>
        <label class="field"><span>Uploaded</span><select id="fwhen">${opt('any', 'Any time', f.when)}${opt('week', 'This week', f.when)}${opt('month', 'Last 30 days', f.when)}</select></label>
        <label class="field"><span>Sort by</span><select id="fsort">${opt('new', 'Newest first', f.sort)}${opt('old', 'Oldest first', f.sort)}${opt('views', 'Most viewed', f.sort)}${opt('az', 'Title A–Z', f.sort)}</select></label>
      </div>
      <div class="spread">${mySec ? `<label class="check"><input type="checkbox" id="fmine"${f.mine ? ' checked' : ''}> Only for my section (${esc(mySec.label)})</label>` : '<span></span>'}<span class="small muted" id="rmeta"></span></div>
      <div class="grid" id="results"></div>`;
  }
  function filtered() {
    const f = ST.f, terms = norm(f.q).split(' ').filter(Boolean), now = Date.now();
    const list = C().materials.filter(m => {
      if (!navigator.onLine && isStudent() && !ST.saved[m.id] && !quizzesFor(m.id).length) return false;
      if (f.mine && isStudent() && !m.sections.includes(ST.user.sectionId)) return false;
      if (f.grade !== 'all' && String(m.grade) !== f.grade) return false;
      if (f.strand !== 'all' && !m.sections.some(s => (secById(s) || {}).strand === f.strand)) return false;
      if (f.section !== 'all' && !m.sections.includes(f.section)) return false;
      if (f.subject !== 'all' && m.subject !== f.subject) return false;
      if (f.term !== 'all' && m.term !== f.term) return false;
      if (f.when !== 'any' && now - new Date(m.date) > (f.when === 'week' ? 7 : 30) * 864e5) return false;
      if (terms.length) { const hay = norm([m.title, m.topic, m.keywords, m.subject, m.teacherName, m.desc].join(' ')); if (!terms.every(t => hay.includes(t))) return false; }
      return true;
    });
    list.sort((a, b) => f.sort === 'views' ? b.views - a.views : f.sort === 'old' ? a.date.localeCompare(b.date) : f.sort === 'az' ? a.title.localeCompare(b.title) : b.date.localeCompare(a.date));
    return { list: list, terms: terms };
  }
  function hl(text, terms) {
    let s = esc(text);
    terms.forEach(t => { if (t.length < 2) return; s = s.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
    return s;
  }
  function card(m, terms) {
    terms = terms || [];
    const t = TYPES[m.type] || TYPES.file, saved = !!ST.saved[m.id], qz = quizzesFor(m.id);
    const offlineBlocked = !navigator.onLine && fileLike(m) && !saved;
    return `<article class="mat"><div class="ftag${m.type === 'link' ? ' link' : ''}">${t[0]}</div><div class="mbody">
      <h3><button class="linkish" data-act="open" data-id="${m.id}">${hl(m.title, terms)}</button></h3>
      <p class="small">${esc(m.subject)} › <b>${hl(m.topic, terms)}</b> <span class="muted">· ${TERMS[m.term] || ''}</span></p>
      <p class="meta">${esc(m.teacherName)} · ${fmtDate(m.date)} (${ago(m.date)})${m.size ? ' · ' + fmtSize(m.size) : ''}</p>
      <div class="chips"><span class="chip">${esc(aud(m.sections))}</span>${qz.length ? '<span class="chip quiz">Practice quiz</span>' : ''}${saved ? '<span class="chip saved">Saved offline ✓</span>' : ''}${m.hidden ? '<span class="pill bad">Hidden</span>' : ''}</div>
      <div class="actions"><button class="btn small" data-act="open" data-id="${m.id}">Open</button>
      ${fileLike(m) && m.allowOffline ? `<button class="btn small${saved ? ' on' : ''}" data-act="save" data-id="${m.id}"${offlineBlocked ? ' disabled' : ''}>${saved ? 'Saved ✓' : 'Save offline'}</button>` : ''}
      ${qz.length ? `<button class="btn small primary" data-act="startquiz" data-id="${qz[0].id}">Practice</button>` : ''}</div></div></article>`;
  }
  function updateResults() {
    const r = $('#results'); if (!r) return;
    const { list, terms } = filtered();
    $('#rmeta').textContent = plural(list.length, 'material');
    r.innerHTML = list.length ? list.map(m => card(m, terms)).join('') : `<div class="empty">${C().materials.length ? 'No materials match. Try a shorter search word' + (ST.f.mine && isStudent() ? ', or turn off “Only for my section”.' : '.') : 'No materials yet. Teachers’ uploads will show up here.'}</div>`;
  }

  function vSubjects() {
    const mine = isStudent() ? C().materials.filter(m => m.sections.includes(ST.user.sectionId)) : C().materials;
    const sec = isStudent() ? secById(ST.user.sectionId) : null;
    const crumb = sec ? `<button data-act="subj" data-id="">Grade ${esc(sec.grade)}</button><span class="sep">›</span><button data-act="subj" data-id="">${esc(sec.strand)}</button><span class="sep">›</span>` : '';
    const top = `<nav class="row small" aria-label="Where you are" style="gap:6px">${crumb}${ST.subj ? `<button class="btn small ghost" data-act="subj" data-id="">All subjects</button><span class="muted">›</span><b>${esc(ST.subj)}</b>` : '<b>All subjects</b>'}</nav>`;
    if (!ST.subj) {
      const subs = [...new Set(mine.map(m => m.subject))].sort();
      if (!subs.length) return top + '<div class="empty">No materials for your section yet.</div>';
      return top + `<div class="grid">${subs.map(s => {
        const ms = mine.filter(m => m.subject === s), topics = [...new Set(ms.map(m => m.topic))], q = ms.filter(m => quizzesFor(m.id).length).length;
        return `<button class="panel linkish" style="text-align:left;gap:6px" data-act="subj" data-id="${esc(s)}"><span class="label">${[...new Set(ms.map(m => TERMS[m.term]))].sort().join(' · ')}</span><h3>${esc(s)}</h3><span class="small muted">${plural(ms.length, 'material')} · ${plural(q, 'quiz', 'quizzes')}</span><span class="small">Topics: ${topics.map(esc).join(', ')}</span></button>`;
      }).join('')}</div>`;
    }
    const ms = mine.filter(m => m.subject === ST.subj);
    return top + ['Q4', 'Q3', 'Q2', 'Q1'].filter(t => ms.some(m => m.term === t)).map(t => {
      const tm = ms.filter(m => m.term === t), topics = [...new Set(tm.map(m => m.topic))];
      return `<section style="display:flex;flex-direction:column;gap:12px"><h2>${TERMS[t]} <span class="muted small">${SEMOF[t]}</span></h2>${topics.map(l => `<p class="label">Topic · ${esc(l)}</p><div class="grid">${tm.filter(m => m.topic === l).map(m => card(m)).join('')}</div>`).join('')}</section>`;
    }).join('');
  }

  function vSaved() {
    const ids = Object.keys(ST.saved);
    const known = ids.map(id => matById(id)).filter(Boolean);
    const orphans = ids.filter(id => !matById(id));
    return `<div class="banner note"><span>Saved files stay on this phone and open with no load. Quizzes work offline even without saving. <span id="storage"></span></span></div>
      <div class="grid">${known.length ? known.map(m => card(m)).join('') : '<div class="empty">Nothing saved yet. Tap “Save offline” on any material while you have internet.</div>'}</div>
      ${orphans.length ? `<div class="panel"><h3>Removed by the teacher</h3><p class="small muted">These are still on your phone but no longer in the Review Hub.</p>${orphans.map(id => `<div class="spread"><span>${esc(ST.saved[id].name)}</span><div class="row"><button class="btn small" data-act="openorphan" data-id="${id}">Open</button><button class="btn small ghost danger" data-act="unsave" data-id="${id}">Remove</button></div></div>`).join('')}</div>` : ''}`;
  }
  async function showStorage() {
    const el = $('#storage'); if (!el) return;
    const used = Object.values(ST.saved).reduce((s, x) => s + (x.size || 0), 0);
    let txt = 'Using ' + (fmtSize(used) || '0 KB') + '.';
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e.quota) txt += ' About ' + fmtSize(Math.max(0, e.quota - e.usage)) + ' free for the app.'; } } catch (e) { }
    el.textContent = txt;
  }

  function openMat(id) {
    const m = matById(id); if (!m) return;
    const t = TYPES[m.type] || TYPES.file, saved = !!ST.saved[id], qz = quizzesFor(id);
    const canGet = saved || navigator.onLine;
    if (navigator.onLine && !isStaff()) api('recordView', { id: id }).catch(() => { });
    const viewable = ['image', 'audio', 'video', 'pdf'].includes(m.type);
    openModal(`<div><p class="label">${esc(m.subject)} · ${t[1]}</p><h2>${esc(m.title)}</h2><p class="meta">${esc(m.teacherName)} · Uploaded ${fmtDate(m.date)}${m.size ? ' · ' + fmtSize(m.size) : ''}</p></div>
      ${m.desc ? `<p>${esc(m.desc)}</p>` : ''}
      <div class="chips"><span class="chip">For: ${esc(aud(m.sections))}</span><span class="chip">${TERMS[m.term] || ''}</span><span class="chip">Topic: ${esc(m.topic)}</span></div>
      <div id="viewer"></div>
      ${m.type === 'link' ? `<div class="row"><a class="btn primary" href="${esc(m.url)}" target="_blank" rel="noopener">Open website ↗</a></div><p class="small muted">Websites need internet.</p>` :
        canGet ? `<div class="row">${viewable ? `<button class="btn primary" data-act="view" data-id="${id}">View</button>` : ''}<button class="btn${viewable ? '' : ' primary'}" data-act="download" data-id="${id}">Download to phone</button>
        ${m.allowOffline ? `<button class="btn${saved ? ' on' : ''}" data-act="save" data-id="${id}">${saved ? 'Saved offline ✓' : 'Save offline'}</button>` : ''}</div>
        <p class="small muted">${saved ? 'Saved on this phone. Opens with no load.' : '“Download to phone” puts a copy in your Downloads folder. “Save offline” keeps it inside this app.'}</p>`
          : '<div class="banner off"><span>Not saved on this phone. Connect to the internet once and tap “Save offline” to read it without load.</span></div>'}
      ${qz.length ? `<div class="row">${qz.map(q => `<button class="btn primary" data-act="startquiz" data-id="${q.id}">Practice: ${esc(q.title)}</button>`).join('')}</div>` : ''}
      ${isStaff() ? `<p class="small muted">Views: ${m.views} · Downloads: ${m.downloads}</p>` : ''}`);
  }
  async function viewFile(id) {
    const m = matById(id), box = $('#viewer'); if (!m || !box) return;
    let win = null;
    if (m.type === 'pdf') win = window.open('', '_blank');
    box.innerHTML = '<p class="small muted">Opening…</p>';
    try {
      const f = await getFile(m, false);
      const u = URL.createObjectURL(f.blob);
      if (m.type === 'image') box.innerHTML = `<img class="viewer" style="background:none" src="${u}" alt="${esc(m.title)}">`;
      else if (m.type === 'audio') box.innerHTML = `<audio controls src="${u}" style="width:100%"></audio>`;
      else if (m.type === 'video') box.innerHTML = `<video class="viewer" controls playsinline src="${u}"></video>`;
      else { if (win) { win.location.href = u; box.innerHTML = '<p class="small muted">Opened in a new tab. If nothing opened, use “Download to phone”.</p>'; } else { saveBlob(f.blob, f.name); box.innerHTML = ''; } }
    } catch (e) { if (win) win.close(); box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  async function downloadFile(id) {
    const m = matById(id); if (!m) return;
    toast('Getting the file…');
    try { const f = await getFile(m, true); saveBlob(f.blob, f.name || m.fileName); toast('Saved to your Downloads folder.'); } catch (e) { toast(e.message); }
  }
  async function toggleSave(id) {
    const m = matById(id);
    if (ST.saved[id]) {
      await KV.del(id, 'files'); delete ST.saved[id]; await persist(); toast('Removed from this phone.');
    } else {
      if (!m) return;
      if (!navigator.onLine) { toast('Connect to the internet to save new materials.'); return; }
      toast('Saving ' + (m.size ? fmtSize(m.size) : 'file') + '…');
      try {
        const f = await getFile(m, true);
        await KV.set(id, { blob: f.blob, name: f.name || m.fileName, mime: f.mime }, 'files');
        ST.saved[id] = { name: f.name || m.fileName, size: f.blob.size, savedAt: new Date().toISOString() };
        await persist();
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
        toast('Saved. It opens even with no load.');
      } catch (e) { toast(e.name === 'QuotaExceededError' ? 'Your phone is out of space for the app. Remove some saved files first.' : e.message); return; }
    }
    if (!$('#modal').hidden && m) openMat(id);
    render();
  }

  /* ================= PRACTICE ================= */
  function vPractice() {
    const qs = C().quizzes.filter(q => q.published);
    const mine = qs.filter(q => !isStudent() || q.sections.includes(ST.user.sectionId)), others = qs.filter(q => !mine.includes(q));
    const best = bestScores();
    const qcard = q => `<article class="panel"><div><p class="label">${esc(q.subject)} · ${TERMS[q.term] || ''}</p><h3>${esc(q.title)}</h3></div>
      <div class="chips">${[...new Set(q.questions.map(x => x.type))].map(t => `<span class="chip">${QT[t]}</span>`).join('')}</div>
      <p class="small muted">${plural(q.questions.length, 'question')} · ${esc(q.teacherName)}${best[q.id] != null ? ` · Your best: <b>${best[q.id]}%</b>` : ' · Not tried yet'}</p>
      <div><button class="btn primary" data-act="startquiz" data-id="${q.id}">Start quiz</button></div></article>`;
    if (!qs.length) return '<div class="empty">No practice quizzes yet. Your teachers’ quizzes will show up here, and they work offline.</div>';
    return `${mine.length ? `<article class="panel" style="background:var(--hi-soft);border-color:transparent"><div class="spread"><div><h2>Quick mixed review</h2><p class="small">Up to 10 questions mixed from your section’s quizzes. Good for the night before the exam. It’s for practice and isn’t sent to teachers.</p></div><button class="btn primary" data-act="mixed">Start mixed review</button></div></article>` : ''}
      ${mine.length ? `<h2>${isStudent() ? 'For your section' : 'All quizzes'}</h2><div class="grid">${mine.map(qcard).join('')}</div>` : ''}
      ${others.length ? `<h2>Other sections</h2><div class="grid">${others.map(qcard).join('')}</div>` : ''}`;
  }
  function history() {
    const server = (C().myAttempts || []).map(a => Object.assign({ synced: true }, a));
    const have = new Set(server.map(a => a.clientId));
    return server.concat(ST.pending.filter(a => !have.has(a.clientId)).map(a => Object.assign({ synced: false }, a))).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  }
  function bestScores() { const b = {}; history().forEach(a => { b[a.quizId] = Math.max(b[a.quizId] || 0, a.pct); }); return b; }
  function vProgress() {
    const h = history(), qmap = {};
    C().quizzes.forEach(q => qmap[q.id] = q);
    const avg = h.length ? Math.round(h.reduce((s, a) => s + a.pct, 0) / h.length) : 0;
    const bySub = {};
    h.forEach(a => { const q = qmap[a.quizId]; if (!q) return; const s = bySub[q.subject] = bySub[q.subject] || { sum: 0, n: 0 }; s.sum += a.pct; s.n++; });
    const missed = {};
    h.slice(0, 40).forEach(a => { const q = qmap[a.quizId]; if (!q) return; (a.results || []).forEach(r => { const qq = q.questions.find(x => x.id === r.id); if (qq && qq.comp && r.pts < 1) { const k = qq.comp; missed[k] = missed[k] || { n: 0, subject: q.subject }; missed[k].n++; } }); });
    const comps = Object.keys(missed).sort((a, b) => missed[b].n - missed[a].n).slice(0, 4);
    return `<div class="tiles"><div class="tile"><b>${h.length}</b><span>Quizzes taken</span></div><div class="tile"><b>${h.length ? avg + '%' : '–'}</b><span>Average score</span></div><div class="tile"><b>${Object.keys(ST.saved).length}</b><span>Saved offline</span></div><div class="tile"><b>${ST.pending.length}</b><span>Waiting to sync</span></div></div>
      ${comps.length ? `<article class="panel"><h2>Practice these topics again</h2><p class="small muted">Picked from the questions you missed most.</p><div class="bars">${comps.map(c => `<div class="spread" style="border-top:1px solid var(--line);padding-top:10px"><div><b>${esc(c)}</b><br><span class="small muted">${esc(missed[c].subject)} · missed ${plural(missed[c].n, 'time')}</span></div><button class="btn small primary" data-act="skill" data-id="${esc(c)}">Practice this skill</button></div>`).join('')}</div></article>` : ''}
      ${Object.keys(bySub).length ? `<article class="panel"><h2>Average by subject</h2><div class="bars">${Object.keys(bySub).sort().map(s => { const v = Math.round(bySub[s].sum / bySub[s].n); return `<div class="bar"><div class="lab"><span>${esc(s)}</span><span>${v}% · ${plural(bySub[s].n, 'quiz', 'quizzes')}</span></div><div class="track"><i style="width:${v}%"></i></div></div>`; }).join('')}</div></article>` : ''}
      <article class="panel"><div class="spread"><h2>Quiz history</h2>${ST.pending.length ? `<span class="pill warn">${ST.pending.length} waiting to sync</span>` : '<span class="pill ok">All synced</span>'}</div>
      ${h.length ? `<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>When</th><th class="num">Score</th><th>Status</th></tr></thead><tbody>${h.slice(0, 60).map(a => `<tr><td>${esc((qmap[a.quizId] || {}).title || 'Removed quiz')}</td><td class="small">${new Date(a.takenAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</td><td class="num">${a.pct}%</td><td>${a.synced ? '<span class="pill ok">Synced</span>' : '<span class="pill warn">Not synced</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No quizzes yet. Try one under Practice.</p>'}</article>`;
  }

  /* ----- quiz engine ----- */
  function startQuiz(quiz, mode, title, questions) {
    const qs = (questions || quiz.questions).map(q => q.type === 'match' ? Object.assign({}, q, { right: shuffle(q.pairs.map(p => p[1])) }) : q);
    if (!qs.length) { toast('This quiz has no questions yet.'); return; }
    closeModal();
    ST.quiz = { quiz: quiz, mode: mode, title: title || quiz.title, qs: qs, i: 0, pts: [], results: [], checked: false };
    render(); window.scrollTo(0, 0);
  }
  function vQuiz() {
    const z = ST.quiz;
    if (z.i >= z.qs.length) {
      const total = z.pts.reduce((a, b) => a + b, 0), pct = Math.round(total / z.qs.length * 100);
      return `<section class="panel quiz"><p class="label">${esc(z.title)} · Finished</p><h1 class="mono" style="font-size:3rem">${pct}%</h1>
        <p>${Math.round(total * 10) / 10} of ${z.qs.length} correct.</p>
        <p class="small muted">${z.mode === 'quiz' && isStudent() ? (z.synced ? 'Your score was sent to your teacher.' : 'Saved on this phone. It syncs to your teacher when you’re online.') : z.mode === 'preview' ? 'Preview only. Nothing was recorded.' : 'Practice set. It isn’t sent to teachers.'}</p>
        <div class="row">${z.quiz ? `<button class="btn primary" data-act="retry">Try again</button>` : ''}<button class="btn" data-act="endquiz">Done</button></div></section>`;
    }
    const q = z.qs[z.i];
    let ui = '';
    if (q.type === 'mc' || q.type === 'tf') {
      const opts = q.type === 'tf' ? ['True', 'False'] : q.options;
      ui = `<div class="opts" role="radiogroup">${opts.map((o, k) => `<label class="opt" id="opt${k}"><input type="radio" name="ans" value="${k}">${esc(o)}</label>`).join('')}</div>`;
    } else if (q.type === 'id') ui = `<label class="field"><span>Your answer</span><input type="text" id="ans" autocomplete="off"></label>`;
    else if (q.type === 'match') ui = `<div class="opts">${q.pairs.map((p, k) => `<div class="matchrow"><b>${esc(p[0])}</b><select id="mt${k}" aria-label="Match for ${esc(p[0])}"><option value="">Choose…</option>${q.right.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>`).join('')}</div>`;
    return `<section class="panel quiz"><div class="spread"><span class="small muted">${esc(z.title)}${z.mode === 'preview' ? ' · Preview' : ''}</span><button class="btn small ghost" data-act="endquiz">Quit</button></div>
      <div class="progress"><i style="width:${z.i / z.qs.length * 100}%"></i></div>
      <div class="row"><span class="qtype">${QT[q.type]}</span><span class="small muted">Question ${z.i + 1} of ${z.qs.length}</span></div>
      <p class="qtext">${esc(q.q)}</p>${ui}<div id="fb"></div>
      <div class="row"><button class="btn primary" data-act="check" id="checkBtn">Check answer</button></div></section>`;
  }
  async function checkAnswer() {
    const z = ST.quiz, q = z.qs[z.i];
    if (z.checked) { z.i++; z.checked = false; if (z.i >= z.qs.length) await finishQuiz(); render(); window.scrollTo(0, 0); return; }
    let pts = 0, right = '';
    if (q.type === 'mc' || q.type === 'tf') {
      const sel = document.querySelector('input[name=ans]:checked');
      if (!sel) { toast('Pick an answer first.'); return; }
      const k = +sel.value, correct = q.type === 'tf' ? (q.a ? 0 : 1) : q.a;
      pts = k === correct ? 1 : 0;
      $('#opt' + correct).classList.add('right'); if (!pts) $('#opt' + k).classList.add('wrong');
      right = q.type === 'tf' ? (q.a ? 'True' : 'False') : q.options[q.a];
    } else if (q.type === 'id') {
      const v = $('#ans').value;
      if (!v.trim()) { toast('Type your answer first.'); return; }
      pts = q.a.map(norm).includes(norm(v)) ? 1 : 0; right = q.a[0];
    } else if (q.type === 'match') {
      let c = 0, chosen = 0;
      q.pairs.forEach((p, k) => { const s = $('#mt' + k); if (s.value) chosen++; if (s.value === p[1]) c++; });
      if (!chosen) { toast('Match at least one item first.'); return; }
      q.pairs.forEach((p, k) => { $('#mt' + k).style.borderColor = $('#mt' + k).value === p[1] ? 'var(--ok)' : 'var(--bad)'; });
      pts = c / q.pairs.length; right = q.pairs.map(p => p[0] + ' → ' + p[1]).join('; ');
    }
    z.pts.push(pts); z.results.push({ id: q.id, pts: Math.round(pts * 100) / 100 }); z.checked = true;
    const cls = pts === 1 ? 'ok' : pts > 0 ? 'part' : 'bad';
    $('#fb').innerHTML = `<div class="feedback ${cls}"><b>${pts === 1 ? 'Correct!' : pts > 0 ? 'Partly correct.' : 'Not quite.'}</b> ${pts < 1 ? 'Answer: ' + esc(right) + '. ' : ''}${esc(q.exp || '')}</div>`;
    $$('.quiz input, .quiz select').forEach(e => e.disabled = true);
    const b = $('#checkBtn'); b.textContent = z.i === z.qs.length - 1 ? 'See my score' : 'Next question'; b.focus();
  }
  async function finishQuiz() {
    const z = ST.quiz;
    if (z.mode !== 'quiz' || !isStudent()) return;
    const total = z.pts.reduce((a, b) => a + b, 0);
    const a = { clientId: uid(), quizId: z.quiz.id, pct: Math.round(total / z.qs.length * 100), score: Math.round(total * 100) / 100, total: z.qs.length, results: z.results, takenAt: new Date().toISOString() };
    ST.pending.push(a); await persist();
    if (navigator.onLine) { await sync(true); z.synced = !ST.pending.some(p => p.clientId === a.clientId); }
  }

  /* ================= TEACHER ================= */
  function teacherSubjects() {
    const own = String(ST.user.subjects || '').split(',').map(s => s.trim()).filter(Boolean);
    return [...new Set(own.concat(C().settings.subjects || []))];
  }
  function sectionChecks(grade, strands, selected, cls) {
    const list = C().sections.filter(s => String(s.grade) === String(grade) && (!strands || strands.includes(s.strand)));
    if (!list.length) return '<span class="small muted">No sections for this grade and strand yet. The admin adds sections under Sections.</span>';
    return list.map(s => `<label class="check"><input type="checkbox" class="${cls}" value="${s.id}"${!selected || selected.includes(s.id) ? ' checked' : ''}> ${esc(s.label)}</label>`).join('');
  }
  function vUpload() {
    const u = ST.up, c = C();
    const gradeStrands = c.settings.strands.filter(st => c.sections.some(s => String(s.grade) === u.grade && s.strand === st));
    const strands = u.strands ? u.strands.filter(s => gradeStrands.includes(s)) : gradeStrands;
    if (!navigator.onLine) return '<div class="empty">Uploading needs internet. Connect and try again.</div>';
    return `<form class="panel" id="upForm" novalidate><h2>Share a learning material</h2>
      <div class="fgrid two"><label class="field"><span>Title</span><input type="text" id="upTitle" maxlength="120" placeholder="e.g. Inverse Functions"></label>
      <label class="field"><span>Subject</span><input type="text" id="upSubject" list="subjList" maxlength="80" placeholder="Choose or type"><datalist id="subjList">${teacherSubjects().map(s => `<option value="${esc(s)}">`).join('')}</datalist></label></div>
      <div class="fgrid two"><label class="field"><span>Topic</span><input type="text" id="upTopic" list="topicList" maxlength="80" placeholder="e.g. Functions"><datalist id="topicList">${[...new Set(c.materials.map(m => m.topic))].map(t => `<option value="${esc(t)}">`).join('')}</datalist><small>Groups this with other materials on the same topic.</small></label>
      <label class="field"><span>Term</span><select id="upTerm">${Object.keys(TERMS).map(k => opt(k, TERMS[k] + ' · ' + SEMOF[k], c.settings.currentTerm)).join('')}</select></label></div>
      <label class="field"><span>Search keywords (optional)</span><input type="text" id="upKeywords" maxlength="200" placeholder="inverse, one-to-one, horizontal line test"><small>Words students might search for. Separate with commas.</small></label>
      <div class="field"><span>What are you sharing?</span><div class="checks"><label class="check"><input type="radio" name="upkind" value="file"${u.kind === 'file' ? ' checked' : ''}> A file (PDF, slides, document, picture, audio, video)</label><label class="check"><input type="radio" name="upkind" value="link"${u.kind === 'link' ? ' checked' : ''}> A web link</label></div></div>
      ${u.kind === 'link' ? '<label class="field"><span>Web address</span><input type="url" id="upUrl" placeholder="https://"><small>YouTube, Desmos, PhET, Google Forms and other sites. Students need internet to open links.</small></label>'
        : `<label class="field"><span>File</span><input type="file" id="upFile"><small>Up to ${MAX_MB} MB. Saved to the Review Hub folder in Google Drive. Share long videos as YouTube links instead.</small></label>`}
      <div class="fgrid two"><label class="field"><span>Grade level</span><select id="upGrade">${opt('11', 'Grade 11', u.grade)}${opt('12', 'Grade 12', u.grade)}</select></label></div>
      <div class="field"><span>Strands</span><div class="checks" id="upStrands">${gradeStrands.map(s => `<label class="check"><input type="checkbox" class="upStrand" value="${esc(s)}"${strands.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('') || '<span class="small muted">No sections for this grade yet.</span>'}</div></div>
      <div class="field"><span>Sections that can see it</span><div class="checks" id="upSecs">${sectionChecks(u.grade, strands, null, 'upSec')}</div></div>
      <label class="field"><span>Note for students (optional)</span><textarea id="upDesc" maxlength="600" placeholder="What to focus on, which pages to read first…"></textarea></label>
      <label class="check" style="align-self:flex-start"><input type="checkbox" id="upOffline" checked> Students can download it and save it offline</label>
      <div class="row"><button class="btn primary" type="submit" id="upBtn">Upload to Review Hub</button><span class="err" id="upErr" role="alert"></span></div></form>`;
  }
  async function doUpload(e) {
    e.preventDefault();
    const v = id => ($('#' + id) || {}).value || '';
    const sections = $$('.upSec:checked').map(i => i.value);
    const kind = ST.up.kind, file = kind === 'file' ? ($('#upFile').files || [])[0] : null;
    const err = !v('upTitle').trim() ? 'Add a title so students can find it.' : !v('upSubject').trim() ? 'Choose a subject.' : !sections.length ? 'Choose at least one section.'
      : kind === 'link' && !/^https?:\/\/\S+$/.test(v('upUrl').trim()) ? 'Enter a web address that starts with https://' : kind === 'file' && !file ? 'Choose a file to upload.'
        : file && file.size > MAX_MB * 1048576 ? `That file is ${fmtSize(file.size)}. The limit is ${MAX_MB} MB. Share long videos as YouTube links instead.` : '';
    if (err) { $('#upErr').textContent = err; return; }
    const btn = $('#upBtn'); btn.disabled = true; btn.textContent = file ? 'Uploading ' + fmtSize(file.size) + '… keep this page open' : 'Saving…'; $('#upErr').textContent = '';
    try {
      const data = { title: v('upTitle'), subject: v('upSubject'), topic: v('upTopic'), term: v('upTerm'), keywords: v('upKeywords'), desc: v('upDesc'), grade: v('upGrade'), sections: sections, allowOffline: $('#upOffline').checked, kind: kind };
      if (kind === 'link') data.url = v('upUrl').trim();
      else { data.fileName = file.name; data.mime = file.type || 'application/octet-stream'; data.b64 = await fileToB64(file); }
      const r = await api('upload', data, { timeout: 300000 });
      C().materials.unshift(r.material); await KV.set('catalog', ST.cat);
      $('#upForm').removeAttribute('data-dirty');
      const listTab = isAdmin() ? 'content' : 'mine';
      openModal(`<h2>Uploaded</h2><p>“${esc(r.material.title)}” is now in the Review Hub for ${esc(aud(r.material.sections))}.</p><div class="row"><button class="btn primary" data-act="newquiz" data-id="${r.material.id}">Make a practice quiz for it</button><button class="btn" data-act="close">Done</button></div>`);
      ST.tab = listTab; render();
    } catch (ex) { $('#upErr').textContent = ex.message; btn.disabled = false; btn.textContent = 'Upload to Review Hub'; }
  }

  function vMine() {
    const list = C().materials.filter(m => isAdmin() || m.teacherId === ST.user.id).sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) return '<div class="empty">You haven’t uploaded anything yet. Use the Upload tab.</div>';
    return `<div class="tbl-wrap"><table><thead><tr><th>Material</th><th>Filed under</th><th>Uploaded</th><th class="num">Views</th><th class="num">Downloads</th><th>Quiz</th><th></th></tr></thead><tbody>
      ${list.map(m => { const qz = C().quizzes.filter(q => q.materialId === m.id); return `<tr><td><b>${esc(m.title)}</b><br><span class="small muted">${(TYPES[m.type] || TYPES.file)[1]}${m.size ? ' · ' + fmtSize(m.size) : ''}</span>${m.hidden ? '<br><span class="pill bad">Hidden</span>' : ''}</td>
        <td class="small">${esc(aud(m.sections))}<br><span class="muted">${TERMS[m.term] || ''} › ${esc(m.subject)} › ${esc(m.topic)}</span></td><td class="small">${fmtDate(m.date)}</td><td class="num">${m.views}</td><td class="num">${m.downloads}</td>
        <td>${qz.length ? qz.map(q => q.published ? '<span class="pill ok">Published</span>' : '<span class="pill warn">Draft</span>').join(' ') : `<button class="btn small" data-act="newquiz" data-id="${m.id}">Make quiz</button>`}</td>
        <td><div class="row"><button class="btn small" data-act="editmat" data-id="${m.id}">Edit</button><button class="btn small ghost" data-act="hidemat" data-id="${m.id}">${m.hidden ? 'Show' : 'Hide'}</button><button class="btn small ghost danger" data-act="askdelmat" data-id="${m.id}">Delete</button></div></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function editMat(id) {
    const m = matById(id);
    openModal(`<form id="emForm" class="field" style="gap:12px" novalidate data-id="${id}"><h2>Edit material</h2>
      <label class="field"><span>Title</span><input type="text" id="emTitle" value="${esc(m.title)}" maxlength="120"></label>
      <div class="fgrid two"><label class="field"><span>Topic</span><input type="text" id="emTopic" value="${esc(m.topic)}"></label><label class="field"><span>Term</span><select id="emTerm">${Object.keys(TERMS).map(k => opt(k, TERMS[k], m.term)).join('')}</select></label></div>
      <label class="field"><span>Search keywords</span><input type="text" id="emKeywords" value="${esc(m.keywords)}"></label>
      <label class="field"><span>Note for students</span><textarea id="emDesc">${esc(m.desc)}</textarea></label>
      <div class="field"><span>Sections that can see it</span><div class="checks">${sectionChecks(m.grade, null, m.sections, 'emSec')}</div></div>
      <div class="row"><button class="btn primary" type="submit">Save changes</button><span class="err" id="emErr"></span></div></form>`);
  }
  async function saveMat(e) {
    e.preventDefault();
    const id = e.target.dataset.id;
    try {
      const r = await api('updateMaterial', { id: id, fields: { title: $('#emTitle').value, topic: $('#emTopic').value, term: $('#emTerm').value, keywords: $('#emKeywords').value, desc: $('#emDesc').value, sections: $$('.emSec:checked').map(i => i.value) } });
      replaceMat(r.material); closeModal(); render(); toast('Changes saved.');
    } catch (ex) { $('#emErr').textContent = ex.message; }
  }
  function replaceMat(m) { const i = C().materials.findIndex(x => x.id === m.id); if (i >= 0) C().materials[i] = m; KV.set('catalog', ST.cat); }

  /* ----- quizzes ----- */
  function vQuizzes() {
    const list = C().quizzes.filter(q => q.teacherId === ST.user.id || isAdmin()).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return `<div class="spread"><p class="muted small">Write practice quizzes with answer keys and explanations. Students can answer them offline.</p><button class="btn primary" data-act="newquiz" data-id="">New quiz</button></div>
      ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>For</th><th class="num">Questions</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
      ${list.map(q => `<tr><td><b>${esc(q.title)}</b><br><span class="small muted">${esc(q.subject)} › ${esc(q.topic)}${q.materialId && matById(q.materialId) ? ' · with “' + esc(matById(q.materialId).title) + '”' : ''}</span></td><td class="small">${esc(aud(q.sections))}</td><td class="num">${q.questions.length}</td>
      <td>${q.published ? '<span class="pill ok">Published</span>' : '<span class="pill warn">Draft</span>'}</td><td class="small">${fmtDate(q.updated)}</td>
      <td><div class="row"><button class="btn small" data-act="editquiz" data-id="${q.id}">Edit</button><button class="btn small ghost" data-act="previewquiz" data-id="${q.id}">Try it</button><button class="btn small ghost danger" data-act="askdelquiz" data-id="${q.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No quizzes yet. Tap “New quiz”, or “Make quiz” next to one of your materials.</div>'}`;
  }
  function newQuiz(materialId) {
    const m = materialId ? matById(materialId) : null;
    ST.edit = { title: m ? 'Practice quiz: ' + m.title : '', materialId: m ? m.id : '', subject: m ? m.subject : '', grade: m ? String(m.grade) : '11', sections: m ? m.sections.slice() : [], term: m ? m.term : C().settings.currentTerm, topic: m ? m.topic : '', published: false, questions: [] };
    closeModal(); render(); window.scrollTo(0, 0);
  }
  function blankQ(type) {
    const q = { id: 'q' + uid().slice(0, 6), type: type, q: '', exp: '', comp: '', diff: 'Average' };
    if (type === 'mc') { q.options = ['', '', '', '']; q.a = 0; }
    if (type === 'tf') q.a = true;
    if (type === 'id') q.a = '';
    if (type === 'match') q.pairs = [['', ''], ['', ''], ['', '']];
    return q;
  }
  function vQuizEditor() {
    const e = ST.edit, c = C();
    const comps = [...new Set(c.quizzes.flatMap(q => q.questions.map(x => x.comp)).filter(Boolean))];
    const mats = c.materials.filter(m => isAdmin() || m.teacherId === ST.user.id);
    const qBlock = (q, i) => {
      let key = '';
      if (q.type === 'mc') key = `<div class="field"><span>Choices <span class="hint">· tick the correct one</span></span>${q.options.map((o, k) => `<div class="row" style="flex-wrap:nowrap"><input type="radio" name="ca${i}" data-q="${i}" data-f="a" value="${k}"${q.a === k ? ' checked' : ''} aria-label="Choice ${k + 1} is correct" style="accent-color:var(--accent);width:20px;height:20px"><input type="text" data-q="${i}" data-o="${k}" value="${esc(o)}" placeholder="Choice ${'ABCDEF'[k]}">${q.options.length > 2 ? `<button type="button" class="btn small ghost" data-act="delopt" data-id="${i}:${k}" aria-label="Remove choice">✕</button>` : ''}</div>`).join('')}${q.options.length < 6 ? `<div><button type="button" class="btn small" data-act="addopt" data-id="${i}">Add a choice</button></div>` : ''}</div>`;
      if (q.type === 'tf') key = `<label class="field"><span>Correct answer</span><select data-q="${i}" data-f="a">${opt('true', 'True', String(q.a))}${opt('false', 'False', String(q.a))}</select></label>`;
      if (q.type === 'id') key = `<label class="field"><span>Accepted answers</span><input type="text" data-q="${i}" data-f="a" value="${esc(Array.isArray(q.a) ? q.a.join(', ') : q.a)}" placeholder="e.g. photosynthesis, photo synthesis"><small>Separate different accepted answers with commas. Capital letters and punctuation don’t matter.</small></label>`;
      if (q.type === 'match') key = `<div class="field"><span>Pairs <span class="hint">· students see the right side shuffled</span></span>${q.pairs.map((p, k) => `<div class="matchrow"><input type="text" data-q="${i}" data-p="${k}" data-s="0" value="${esc(p[0])}" placeholder="Item ${k + 1}"><div class="row" style="flex-wrap:nowrap"><input type="text" data-q="${i}" data-p="${k}" data-s="1" value="${esc(p[1])}" placeholder="Its match">${q.pairs.length > 2 ? `<button type="button" class="btn small ghost" data-act="delpair" data-id="${i}:${k}" aria-label="Remove pair">✕</button>` : ''}</div></div>`).join('')}${q.pairs.length < 8 ? `<div><button type="button" class="btn small" data-act="addpair" data-id="${i}">Add a pair</button></div>` : ''}</div>`;
      return `<div class="qedit"><div class="spread"><span class="row"><b>${i + 1}.</b><span class="qtype">${QT[q.type]}</span></span><span class="row"><button type="button" class="btn small ghost" data-act="upq" data-id="${i}"${i ? '' : ' disabled'} aria-label="Move up">↑</button><button type="button" class="btn small ghost" data-act="downq" data-id="${i}"${i < e.questions.length - 1 ? '' : ' disabled'} aria-label="Move down">↓</button><button type="button" class="btn small ghost danger" data-act="delq" data-id="${i}">Remove</button></span></div>
        <label class="field"><span>Question</span><textarea data-q="${i}" data-f="q" rows="2">${esc(q.q)}</textarea></label>${key}
        <label class="field"><span>Explanation students see after answering</span><textarea data-q="${i}" data-f="exp" rows="2" placeholder="Why the answer is correct">${esc(q.exp)}</textarea></label>
        <div class="fgrid two"><label class="field"><span>Competency</span><input type="text" data-q="${i}" data-f="comp" list="compList" value="${esc(q.comp)}" placeholder="e.g. Find the domain and range"></label>
        <label class="field"><span>Difficulty</span><select data-q="${i}" data-f="diff">${DIFFS.map(d => opt(d, d, q.diff)).join('')}</select></label></div></div>`;
    };
    return `<form class="panel" id="qeForm" novalidate data-dirty="1"><div class="spread"><h2>${e.id ? 'Edit quiz' : 'New quiz'}</h2><button type="button" class="btn ghost" data-act="cancelquiz">Cancel</button></div>
      <div class="fgrid two"><label class="field"><span>Quiz title</span><input type="text" data-m="title" value="${esc(e.title)}" maxlength="120"></label>
      <label class="field"><span>Goes with material (optional)</span><select data-m="materialId">${opt('', 'None', e.materialId)}${mats.map(m => opt(m.id, m.title, e.materialId)).join('')}</select></label></div>
      <div class="fgrid"><label class="field"><span>Subject</span><input type="text" data-m="subject" list="subjList" value="${esc(e.subject)}"><datalist id="subjList">${teacherSubjects().map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
      <label class="field"><span>Topic</span><input type="text" data-m="topic" value="${esc(e.topic)}"></label>
      <label class="field"><span>Term</span><select data-m="term">${Object.keys(TERMS).map(k => opt(k, TERMS[k], e.term)).join('')}</select></label>
      <label class="field"><span>Grade</span><select data-m="grade">${opt('11', 'Grade 11', e.grade)}${opt('12', 'Grade 12', e.grade)}</select></label></div>
      <div class="field"><span>Sections that can take it</span><div class="checks">${sectionChecks(e.grade, null, e.sections.length ? e.sections : null, 'qeSec')}</div></div>
      <datalist id="compList">${comps.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      ${e.questions.map(qBlock).join('') || '<div class="empty">No questions yet. Add one below.</div>'}
      <div class="field"><span>Add a question</span><div class="row">${Object.keys(QT).map(t => `<button type="button" class="btn" data-act="addq" data-id="${t}">+ ${QT[t]}</button>`).join('')}</div></div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:14px"><button type="button" class="btn" data-act="savequiz" data-id="draft">Save as draft</button><button type="button" class="btn primary" data-act="savequiz" data-id="publish">${e.published ? 'Save and keep published' : 'Save and publish'}</button>${e.published ? '<button type="button" class="btn ghost" data-act="savequiz" data-id="unpublish">Unpublish</button>' : ''}<span class="err" id="qeErr" role="alert"></span></div></form>`;
  }
  function bindEditor(t) {
    const e = ST.edit; if (!e) return false;
    if (t.dataset.m) { e[t.dataset.m] = t.value; return true; }
    if (t.classList.contains('qeSec')) { e.sections = $$('.qeSec:checked').map(i => i.value); return true; }
    if (t.dataset.q === undefined) return false;
    const q = e.questions[+t.dataset.q]; if (!q) return false;
    if (t.dataset.o !== undefined) q.options[+t.dataset.o] = t.value;
    else if (t.dataset.p !== undefined) q.pairs[+t.dataset.p][+t.dataset.s] = t.value;
    else if (t.dataset.f === 'a') q.a = q.type === 'mc' ? +t.value : q.type === 'tf' ? t.value === 'true' : t.value;
    else q[t.dataset.f] = t.value;
    return true;
  }
  async function saveQuiz(mode) {
    const e = ST.edit;
    const qz = Object.assign({}, e, { published: mode === 'publish', questions: e.questions.map(q => Object.assign({}, q, q.type === 'id' ? { a: String(Array.isArray(q.a) ? q.a.join(',') : q.a).split(',').map(s => s.trim()).filter(Boolean) } : {}, q.type === 'mc' ? { options: q.options.map(o => o.trim()) } : {})) });
    if (!qz.sections.length) qz.sections = $$('.qeSec:checked').map(i => i.value);
    const err = !qz.title.trim() ? 'Give the quiz a title.' : !qz.subject.trim() ? 'Choose a subject.' : !qz.sections.length ? 'Choose at least one section.' : !qz.questions.length ? 'Add at least one question.' : '';
    if (err) { $('#qeErr').textContent = err; return; }
    if (!navigator.onLine) { $('#qeErr').textContent = 'Saving needs internet. Stay on this page and try again when you’re online.'; return; }
    $('#qeErr').textContent = 'Saving…';
    try {
      const r = await api('saveQuiz', { quiz: qz });
      const i = C().quizzes.findIndex(q => q.id === r.quiz.id);
      if (i >= 0) C().quizzes[i] = r.quiz; else C().quizzes.push(r.quiz);
      await KV.set('catalog', ST.cat);
      ST.edit = null; ST.tab = 'quizzes'; render();
      toast(r.quiz.published ? 'Published. Students can take it now.' : 'Saved as a draft. Students can’t see it yet.');
    } catch (ex) { $('#qeErr').textContent = ex.message; }
  }

  /* ----- results ----- */
  async function loadResults(force) {
    if (ST.loading.results || (!force && ST.results)) return;
    if (!navigator.onLine) { ST.results = ST.results || await KV.get('results') || null; render(); return; }
    ST.loading.results = true;
    try { ST.results = await api('teacherResults', {}); ST.results.at = new Date().toISOString(); await KV.set('results', ST.results); }
    catch (e) { toast(e.message); ST.results = ST.results || await KV.get('results') || { quizzes: [], competencies: [], at: '' }; }
    finally { ST.loading.results = false; if (ST.tab === 'results') render(); }
  }
  function vResults() {
    if (!ST.results) { loadResults(); return '<p class="muted">Loading results…</p>'; }
    const R = ST.results;
    if (!R.quizzes.length) return '<div class="empty">No quizzes yet. Results show up here once students answer your quizzes.</div>';
    const sel = R.quizzes.find(q => q.id === ST.resSel) || R.quizzes.slice().sort((a, b) => b.attempts - a.attempts)[0];
    const qs = sel.questions.slice().sort((a, b) => (a.rate == null ? 999 : a.rate) - (b.rate == null ? 999 : b.rate));
    const cols = [...new Set(R.competencies.flatMap(c => Object.keys(c.bySection)))].sort();
    const cell = v => v == null ? '<td class="cell muted">–</td>' : `<td class="cell ${v.pct >= 75 ? 'h-hi' : v.pct >= 60 ? 'h-mid' : 'h-lo'}">${v.pct}%<br><span class="small" style="font-weight:400">${v.n}</span></td>`;
    const weak = R.competencies.filter(c => { const v = Object.values(c.bySection); const n = v.reduce((s, x) => s + x.n, 0); return n >= 5 && v.reduce((s, x) => s + x.pct * x.n, 0) / n < 60; });
    return `<div class="spread"><label class="field" style="flex:1;min-width:min(100%,260px)"><span>Quiz</span><select id="resSel">${R.quizzes.map(q => opt(q.id, q.title + (q.published ? '' : ' (draft)'), sel.id)).join('')}</select></label>
      <div class="row"><span class="small muted">Updated ${fmtTime(R.at)}</span><button class="btn small" data-act="reloadresults">Refresh</button></div></div>
      <div class="tiles"><div class="tile"><b>${sel.attempts}</b><span>Attempts</span></div><div class="tile"><b>${sel.students}</b><span>Students</span></div><div class="tile"><b>${sel.attempts ? sel.avg + '%' : '–'}</b><span>Average score</span></div><div class="tile"><b>${sel.questions.length}</b><span>Questions</span></div></div>
      ${sel.attempts ? `<div class="cols"><article class="panel"><h2>By section</h2><div class="bars">${sel.sections.map(s => `<div class="bar"><div class="lab"><span>${esc(s.section)}</span><span>${s.avg}% · ${plural(s.n, 'try', 'tries')}</span></div><div class="track"><i style="width:${s.avg}%"></i></div></div>`).join('')}</div></article>
      <article class="panel"><h2>Most-missed questions</h2><div class="tbl-wrap"><table><thead><tr><th>Question</th><th class="num">Correct</th></tr></thead><tbody>${qs.slice(0, 6).map(q => `<tr><td>${esc(q.q)}<br><span class="small muted">${QT[q.type]}${q.comp ? ' · ' + esc(q.comp) : ''}</span></td><td class="num">${q.rate == null ? '–' : q.rate + '%'}</td></tr>`).join('')}</tbody></table></div></article></div>
      <article class="panel"><div class="spread"><h2>Students</h2><button class="btn small" data-act="exportroster">Export to Excel (CSV)</button></div><div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Section</th><th class="num">Tries</th><th class="num">Best</th><th class="num">Latest</th><th>Last taken</th></tr></thead><tbody>${sel.roster.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.section)}</td><td class="num">${r.tries}</td><td class="num">${r.best}%</td><td class="num">${r.lastPct}%</td><td class="small">${fmtTime(r.last)}</td></tr>`).join('')}</tbody></table></div></article>`
        : '<div class="empty">No one has answered this quiz yet.</div>'}
      <article class="panel"><h2>Learning gaps by competency</h2><p class="small muted">Share of correct answers on questions tagged with each competency, across all your quizzes. The small number is how many answers it’s based on. Tag questions with a competency in the quiz editor to see them here.</p>
      ${R.competencies.length ? `<div class="tbl-wrap"><table class="heat"><thead><tr><th>Competency</th>${cols.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>${R.competencies.map(c => `<tr><td>${esc(c.comp)}<br><span class="small muted">${esc(c.subject)}</span></td>${cols.map(k => cell(c.bySection[k])).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="row small"><span class="pill ok">75% and up</span><span class="pill warn">60–74%</span><span class="pill bad">Below 60%</span></div>
      ${weak.length ? `<div class="banner warn"><span><b>Needs re-teaching:</b> ${weak.map(c => esc(c.comp)).join(', ')}. Students scored below 60% on these overall. They’ll see them under “Practice these topics again”.</span></div>` : ''}` : '<p class="muted">No tagged answers yet.</p>'}</article>`;
  }

  /* ================= ADMIN ================= */
  async function loadAdm(force) {
    if (ST.loading.adm || (!force && ST.adm)) return;
    if (!navigator.onLine) return;
    ST.loading.adm = true;
    try { ST.adm = await api('adminData', {}); } catch (e) { toast(e.message); ST.adm = ST.adm || { users: [], log: [], backups: [] }; }
    finally { ST.loading.adm = false; if (['approvals', 'users', 'activity', 'backups', 'sections'].includes(ST.tab)) render(); }
  }
  const needOnline = () => '<div class="empty">This needs internet. Connect and try again.</div>';
  function vApprovals() {
    if (!ST.adm) { loadAdm(); return navigator.onLine ? '<p class="muted">Loading…</p>' : needOnline(); }
    const list = ST.adm.users.filter(u => u.status === 'pending');
    if (!list.length) return '<div class="empty">No sign-ups waiting. New ones appear here.</div>';
    return `<p class="muted small">Approve students after checking that the class code they typed matches their section. A wrong code can mean a typo, or someone who isn’t in that class.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Student</th><th>LRN</th><th>Section</th><th>Class code typed</th><th>Signed up</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.lrn)}</td><td>${esc(u.section)}</td><td><span class="mono">${esc(u.codeEntered)}</span><br>${u.codeOk ? '<span class="pill ok">Matches section</span>' : '<span class="pill warn">Doesn’t match</span>'}</td><td class="small">${fmtTime(u.created)}</td>
      <td><div class="row"><button class="btn small primary" data-act="approve" data-id="${u.id}">Approve</button><button class="btn small danger" data-act="reject" data-id="${u.id}">Reject</button></div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function vUsers() {
    if (!ST.adm) { loadAdm(); return navigator.onLine ? '<p class="muted">Loading…</p>' : needOnline(); }
    return `<form class="panel" id="staffForm" novalidate><h2>Add a teacher or admin</h2><div class="fgrid"><label class="field"><span>Full name</span><input type="text" id="sfName" placeholder="e.g. Ms. Liza Garcia"></label>
      <label class="field"><span>Username</span><input type="text" id="sfUser" autocapitalize="none" placeholder="e.g. lgarcia"></label>
      <label class="field"><span>Role</span><select id="sfRole">${opt('teacher', 'Teacher', 'teacher')}${opt('admin', 'Admin', '')}</select></label></div>
      <label class="field"><span>Subjects they teach (optional)</span><input type="text" id="sfSubj" placeholder="General Mathematics, Statistics and Probability"></label>
      <div class="row"><button class="btn primary" type="submit">Create account</button><span class="err" id="sfErr"></span></div></form>
      <div class="fgrid two"><label class="field"><span>Search</span><input type="search" id="uq" value="${esc(ST.uq)}" placeholder="Name, LRN, username or section"></label>
      <label class="field"><span>Show</span><select id="urole">${opt('all', 'Everyone', ST.urole)}${opt('student', 'Students', ST.urole)}${opt('teacher', 'Teachers', ST.urole)}${opt('admin', 'Admins', ST.urole)}${opt('suspended', 'Suspended accounts', ST.urole)}</select></label></div>
      <div class="tbl-wrap" id="utable">${usersTable()}</div>`;
  }
  function usersTable() {
    const q = norm(ST.uq);
    const list = ST.adm.users.filter(u => u.status !== 'pending' && u.status !== 'rejected')
      .filter(u => ST.urole === 'all' || (ST.urole === 'suspended' ? u.status === 'suspended' : u.role === ST.urole))
      .filter(u => !q || norm([u.name, u.lrn, u.username, u.section].join(' ')).includes(q));
    return `<table><thead><tr><th>Name</th><th>Role</th><th>Section or subjects</th><th>Status</th><th>Last active</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="mono small muted">${esc(u.lrn || u.username)}</span></td><td>${ROLE[u.role]}</td><td class="small">${esc(u.role === 'student' ? u.section : u.subjects)}</td>
      <td><span class="pill ${u.status === 'active' ? 'ok' : 'bad'}">${u.status === 'active' ? 'Active' : 'Suspended'}</span></td><td class="small">${u.lastActive ? fmtTime(u.lastActive) : 'Never'}</td>
      <td>${u.id === ST.user.id ? '<span class="small muted">You</span>' : `<div class="row"><button class="btn small" data-act="reset" data-id="${u.id}">Reset password</button><button class="btn small ghost${u.status === 'active' ? ' danger' : ''}" data-act="suspend" data-id="${u.id}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>${u.role !== 'student' ? `<button class="btn small ghost" data-act="editstaff" data-id="${u.id}">Subjects</button>` : ''}</div>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No accounts match.</td></tr>'}</tbody></table>`;
  }
  function vSections() {
    const c = C(), counts = {};
    if (ST.adm) ST.adm.users.forEach(u => { if (u.role === 'student' && u.status === 'active') counts[u.sectionId] = (counts[u.sectionId] || 0) + 1; });
    else loadAdm();
    const secs = c.sections.slice().sort((a, b) => a.label.localeCompare(b.label));
    return `<form class="panel" id="secForm" novalidate><h2>Add a section</h2><div class="fgrid"><label class="field"><span>Grade</span><select id="scGrade">${opt('11', 'Grade 11', '11')}${opt('12', 'Grade 12', '')}</select></label>
      <label class="field"><span>Strand</span><select id="scStrand">${c.settings.strands.map(s => opt(s, s, '')).join('')}</select></label>
      <label class="field"><span>Section name</span><input type="text" id="scName" placeholder="e.g. A or Rizal"></label>
      <label class="field"><span>Adviser</span><input type="text" id="scAdv" placeholder="e.g. Ms. Liza Garcia"></label></div>
      <div class="row"><button class="btn primary" type="submit">Add section</button><span class="err" id="scErr"></span></div>
      <p class="small muted">Each section gets its own class code. Give it to the adviser, who shares it with the class. Students type it when they sign up.</p></form>
      ${secs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Section</th><th>Adviser</th><th>Class code</th><th class="num">Students</th><th></th></tr></thead><tbody>
      ${secs.map(s => `<tr><td><b>${esc(s.label)}</b></td><td class="small">${esc(s.adviser)}</td><td><span class="mono">${esc(s.code)}</span></td><td class="num">${ST.adm ? counts[s.id] || 0 : '…'}</td>
      <td><div class="row"><button class="btn small" data-act="copy" data-id="${esc(s.code)}">Copy code</button><button class="btn small ghost" data-act="editsec" data-id="${s.id}">Edit</button><button class="btn small ghost" data-act="asknewcode" data-id="${s.id}">New code</button><button class="btn small ghost danger" data-act="askdelsec" data-id="${s.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No sections yet. Add your first section above, so students can sign up.</div>'}`;
  }
  function vSettings() {
    const s = C().settings;
    return `<form class="panel" id="setForm" novalidate><h2>School settings</h2>
      <label class="field"><span>School name</span><input type="text" id="stName" value="${esc(s.schoolName || '')}"></label>
      <label class="field"><span>Current term</span><select id="stTerm">${Object.keys(TERMS).map(k => opt(k, SEMOF[k] + ' · ' + TERMS[k], s.currentTerm)).join('')}</select><small>New uploads and quizzes are filed under this term unless the teacher picks another.</small></label>
      <div class="fgrid two"><label class="field"><span>Tracks and strands, one per line</span><textarea id="stStrands" rows="7">${esc((s.strands || []).join('\n'))}</textarea><small>Rename these if your school’s tracks or strands change.</small></label>
      <label class="field"><span>Subjects, one per line</span><textarea id="stSubjects" rows="7">${esc((s.subjects || []).join('\n'))}</textarea><small>Teachers pick from these. They can also type a new one.</small></label></div>
      <div class="row"><button class="btn primary" type="submit">Save settings</button><span class="err" id="stErr"></span></div></form>`;
  }
  function vContent() {
    const list = C().materials.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) return '<div class="empty">Nothing uploaded yet.</div>';
    return `<p class="muted small">Every material in the Review Hub. Hide anything that’s wrong or shouldn’t be shared. Hidden materials disappear for students but stay in Google Drive.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Material</th><th>Filed under</th><th>Teacher</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(m => `<tr><td><b>${esc(m.title)}</b><br><span class="small muted">${(TYPES[m.type] || TYPES.file)[1]} · ${fmtDate(m.date)}</span></td><td class="small">Grade ${esc(m.grade)} › ${TERMS[m.term] || ''} › ${esc(m.subject)} › ${esc(m.topic)}<br><span class="muted">${esc(aud(m.sections))}</span></td><td class="small">${esc(m.teacherName)}</td>
      <td>${m.hidden ? '<span class="pill bad">Hidden</span>' : '<span class="pill ok">Published</span>'}</td><td><div class="row"><button class="btn small" data-act="hidemat" data-id="${m.id}">${m.hidden ? 'Show again' : 'Hide'}</button><button class="btn small ghost danger" data-act="askdelmat" data-id="${m.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;
  }
  async function loadReports(force) {
    if (ST.loading.rep || (!force && ST.reports) || !navigator.onLine) return;
    ST.loading.rep = true;
    try { ST.reports = await api('reports', {}); ST.reports.at = new Date().toISOString(); } catch (e) { toast(e.message); }
    finally { ST.loading.rep = false; if (ST.tab === 'reports') render(); }
  }
  function vReports() {
    if (!ST.reports) { loadReports(); return navigator.onLine ? '<p class="muted">Loading reports…</p>' : needOnline(); }
    const R = ST.reports, k = R.counts;
    const strands = Object.keys(R.byStrand).sort();
    const maxW = Math.max(1, ...R.weeks.map(w => w.attempts)), maxU = Math.max(1, ...R.weeks.map(w => w.uploads));
    const wl = R.weeks.map(w => `<span>${new Date(new Date(w.end) - 6 * 864e5).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>`).join('');
    const st = R.storage;
    return `<div class="spread"><div class="row"><button class="btn" data-act="exportattempts">Export quiz results (CSV)</button><button class="btn" data-act="exportusers">Export accounts (CSV)</button></div><div class="row"><span class="small muted">Updated ${fmtTime(R.at)}</span><button class="btn small" data-act="reloadreports">Refresh</button></div></div>
      <div class="tiles"><div class="tile"><b>${k.students}</b><span>Students with accounts</span></div><div class="tile"><b>${k.activeWeek}</b><span>Active this week${k.students ? ' (' + Math.round(k.activeWeek / k.students * 100) + '%)' : ''}</span></div><div class="tile"><b>${k.teachers}</b><span>Teachers</span></div><div class="tile"><b>${k.materials}</b><span>Materials</span></div><div class="tile"><b>${k.quizzes}</b><span>Published quizzes</span></div><div class="tile"><b>${k.attemptsWeek}</b><span>Quizzes taken this week</span></div></div>
      <div class="cols"><article class="panel"><h2>Active students by strand</h2><p class="small muted">Used the app in the last 7 days.</p>${strands.length ? `<div class="bars">${strands.map(s => { const v = R.byStrand[s]; return `<div class="bar"><div class="lab"><span>${esc(s)}</span><span>${v.active} of ${v.registered}</span></div><div class="track"><i style="width:${v.registered ? v.active / v.registered * 100 : 0}%"></i></div></div>`; }).join('')}</div>` : '<p class="muted">No students yet.</p>'}</article>
      <article class="panel"><h2>Quizzes taken per week</h2><div><div class="colchart">${R.weeks.map(w => `<div><span>${w.attempts}</span><i style="height:${w.attempts / maxW * 110}px"></i></div>`).join('')}</div><div class="xlab">${wl}</div></div>
      <h3>Uploads per week</h3><div><div class="colchart" style="height:90px">${R.weeks.map(w => `<div><span>${w.uploads}</span><i style="height:${w.uploads / maxU * 60}px;background:var(--hi)"></i></div>`).join('')}</div><div class="xlab">${wl}</div></div></article></div>
      <div class="cols"><article class="panel"><h2>Common learning gaps, school-wide</h2>${R.gaps.length ? `<div class="bars">${R.gaps.map(g => `<div class="bar"><div class="lab"><span>${esc(g.comp)} <span class="muted small">· ${esc(g.subject)}</span></span><span>${g.pct}%</span></div><div class="track"><i style="width:${g.pct}%;background:${g.pct < 60 ? 'var(--bad)' : g.pct < 75 ? 'var(--warn)' : 'var(--ok)'}"></i></div></div>`).join('')}</div>` : '<p class="muted">Shows once teachers tag quiz questions with competencies and students answer them.</p>'}</article>
      <article class="panel"><h2>Most downloaded</h2>${R.topDownloads.length ? `<div class="bars">${R.topDownloads.map(m => `<div class="bar"><div class="lab"><span>${esc(m.title)}</span><span>${m.downloads}</span></div><div class="track"><i class="alt" style="width:${m.downloads / Math.max(1, R.topDownloads[0].downloads) * 100}%"></i></div></div>`).join('')}</div>` : '<p class="muted">No materials yet.</p>'}
      <h3>Storage</h3><div class="bar"><div class="lab"><span>Review Hub files: ${fmtSize(st.appBytes) || '0 KB'}</span><span>${st.driveLimit ? 'Drive: ' + fmtSize(st.driveUsed) + ' of ' + fmtSize(st.driveLimit) : ''}</span></div><div class="track"><i style="width:${st.driveLimit ? Math.min(100, st.driveUsed / st.driveLimit * 100) : 0}%"></i></div></div></article></div>`;
  }
  function vActivity() {
    if (!ST.adm) { loadAdm(); return navigator.onLine ? '<p class="muted">Loading…</p>' : needOnline(); }
    const cats = ['All', 'Security', 'Accounts', 'Uploads', 'Quizzes', 'System'];
    const list = ST.adm.log.filter(l => ST.logCat === 'All' || l.category === ST.logCat);
    return `<div class="spread"><div class="row">${cats.map(c => `<button class="btn small${ST.logCat === c ? ' on' : ''}" data-act="logcat" data-id="${c}">${c}</button>`).join('')}</div><button class="btn small" data-act="reloadadm">Refresh</button></div>
      <article class="panel"><ul class="log">${list.map(l => `<li><span class="dot${l.warn ? ' warn' : ''}"></span><div><p>${esc(l.text)}</p><p class="small muted">${fmtTime(l.time)} · ${esc(l.category)}</p></div></li>`).join('') || '<li><span></span><p class="muted">Nothing here yet.</p></li>'}</ul></article>`;
  }
  function vBackups() {
    if (!ST.adm) { loadAdm(); return navigator.onLine ? '<p class="muted">Loading…</p>' : needOnline(); }
    return `<article class="panel"><div class="spread"><h2>Backups</h2><button class="btn primary small" data-act="backup">Back up now</button></div>
      <p class="small">Accounts, quizzes, answer keys and scores are copied <b>every night at 11:00 PM</b> to the <b>Review Hub › Backups</b> folder in Google Drive. The last 30 are kept. Uploaded files are already in Google Drive.</p>
      ${ST.adm.backups.length ? `<div class="tbl-wrap"><table><thead><tr><th>Backup</th><th>Made</th><th></th></tr></thead><tbody>${ST.adm.backups.map(b => `<tr><td>${esc(b.name)}</td><td class="small">${fmtTime(b.created)}</td><td><a class="btn small" href="${esc(b.url)}" target="_blank" rel="noopener">Open in Drive ↗</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No backups yet. The first one runs tonight, or tap “Back up now”.</p>'}
      <p class="small muted">To restore, open a backup, copy the rows you need from its tabs, and paste them into the same tabs of the main Review Hub Sheet. See the setup guide for details.</p></article>`;
  }

  /* ================= actions ================= */
  const A = {
    tab: id => { ST.tab = id; ST.subj = null; render(); window.scrollTo(0, 0); if (navigator.onLine && Date.now() - (ST.lastRefresh || 0) > 60000) refresh(true); },
    gotab: id => { closeModal(); A.tab(id); },
    screen: id => { ST.screen = id; render(); },
    refresh: () => { closeModal(); return refresh(); },
    close: closeModal,
    open: openMat, save: toggleSave, unsave: toggleSave, view: viewFile, download: downloadFile,
    openorphan: async id => { const f = await KV.get(id, 'files'); if (f) saveBlob(f.blob, f.name); },
    subj: id => { ST.subj = id || null; render(); },
    startquiz: id => { const q = C().quizzes.find(x => x.id === id); if (q) startQuiz(q, 'quiz'); },
    previewquiz: id => { const q = C().quizzes.find(x => x.id === id); if (q) startQuiz(q, 'preview'); },
    mixed: () => {
      const pool = C().quizzes.filter(q => q.published && (!isStudent() || q.sections.includes(ST.user.sectionId)));
      const qs = shuffle(pool.flatMap(q => shuffle(q.questions).slice(0, 3))).slice(0, 10);
      startQuiz(null, 'practice', 'Quick mixed review', qs);
    },
    skill: comp => {
      const qs = shuffle(C().quizzes.filter(q => q.published).flatMap(q => q.questions.filter(x => x.comp === comp))).slice(0, 10);
      startQuiz(null, 'practice', 'Practice: ' + comp, qs);
    },
    check: checkAnswer,
    retry: () => { const z = ST.quiz; startQuiz(z.quiz, z.mode, z.title); },
    endquiz: () => { const back = ST.quiz && ST.quiz.mode === 'preview' ? 'quizzes' : ST.tab; ST.quiz = null; if (back) ST.tab = back; render(); },
    account: () => openModal(`<div><p class="label">Account</p><h2>${esc(ST.user.name)}</h2><p class="muted small">${ROLE[ST.user.role]}${ST.user.lrn ? ' · LRN ' + esc(ST.user.lrn) : ST.user.username ? ' · ' + esc(ST.user.username) : ''}</p></div>
      <div class="row"><button class="btn" data-act="changepw">Change password</button><button class="btn" data-act="refresh">Check for new materials</button></div>
      <div class="row"><button class="btn danger" data-act="signout">Sign out</button></div>
      <p class="small muted">Review Hub ${VERSION}${ST.lastRefresh ? ' · Last updated ' + fmtTime(new Date(ST.lastRefresh).toISOString()) : ''}</p>`),
    changepw: () => openModal(vChangePw(false)),
    signout: async () => {
      if (ST.pending.length) { await sync(true); }
      if (ST.pending.length) { openModal(`<h2>Sign out without syncing?</h2><p>${plural(ST.pending.length, 'quiz result')} on this phone ${ST.pending.length === 1 ? 'hasn’t' : 'haven’t'} reached your teachers yet. Connect to the internet first, or they’ll be lost.</p><div class="row"><button class="btn" data-act="close">Stay signed in</button><button class="btn danger" data-act="signoutnow">Sign out anyway</button></div>`); return; }
      A.signoutnow();
    },
    signoutnow: async () => { closeModal(); if (navigator.onLine) api('logout', {}).catch(() => { }); await signOutLocal(); render(); },
    install: async () => {
      if (ST.installEvt) { ST.installEvt.prompt(); try { await ST.installEvt.userChoice; } catch (e) { } ST.installEvt = null; renderTop(); return; }
      openModal('<h2>Install on iPhone or iPad</h2><ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="small muted">Open Review Hub from your home screen so saved files stay available offline.</p>');
    },
    // teacher
    newquiz: id => newQuiz(id),
    editquiz: id => { const q = C().quizzes.find(x => x.id === id); ST.edit = JSON.parse(JSON.stringify(q)); ST.edit.questions.forEach(x => { if (x.type === 'id' && Array.isArray(x.a)) x.a = x.a.join(', '); }); render(); window.scrollTo(0, 0); },
    cancelquiz: () => openModal('<h2>Leave without saving?</h2><p>Your changes to this quiz will be lost.</p><div class="row"><button class="btn" data-act="close">Keep editing</button><button class="btn danger" data-act="discardquiz">Leave</button></div>'),
    discardquiz: () => { closeModal(); ST.edit = null; ST.tab = 'quizzes'; render(); },
    addq: t => { ST.edit.questions.push(blankQ(t)); render(); const all = $$('.qedit'); if (all.length) all[all.length - 1].scrollIntoView({ block: 'center' }); },
    delq: i => { ST.edit.questions.splice(+i, 1); render(); },
    upq: i => { i = +i; const q = ST.edit.questions; [q[i - 1], q[i]] = [q[i], q[i - 1]]; render(); },
    downq: i => { i = +i; const q = ST.edit.questions; [q[i + 1], q[i]] = [q[i], q[i + 1]]; render(); },
    addopt: i => { ST.edit.questions[+i].options.push(''); render(); },
    delopt: id => { const [i, k] = id.split(':').map(Number); const q = ST.edit.questions[i]; q.options.splice(k, 1); if (q.a >= q.options.length) q.a = 0; else if (q.a > k) q.a--; render(); },
    addpair: i => { ST.edit.questions[+i].pairs.push(['', '']); render(); },
    delpair: id => { const [i, k] = id.split(':').map(Number); ST.edit.questions[i].pairs.splice(k, 1); render(); },
    savequiz: mode => saveQuiz(mode),
    askdelquiz: id => openModal(`<h2>Delete this quiz?</h2><p>Students can’t take it anymore. Past scores stay in reports.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="delquiz" data-id="${id}">Delete</button></div>`),
    delquiz: async id => { try { await api('deleteQuiz', { id: id }); ST.cat.quizzes = C().quizzes.filter(q => q.id !== id); await KV.set('catalog', ST.cat); closeModal(); render(); toast('Quiz deleted.'); } catch (e) { toast(e.message); } },
    editmat: editMat,
    hidemat: async id => { const m = matById(id); try { const r = await api('updateMaterial', { id: id, fields: { hidden: !m.hidden } }); replaceMat(r.material); render(); toast(r.material.hidden ? 'Hidden from students.' : 'Students can see it again.'); } catch (e) { toast(e.message); } },
    askdelmat: id => openModal(`<h2>Delete “${esc(matById(id).title)}”?</h2><p>It disappears from the Review Hub and the file goes to Google Drive’s trash, where you can recover it for 30 days. Copies already saved on students’ phones stay until they remove them.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="delmat" data-id="${id}">Delete</button></div>`),
    delmat: async id => { try { await api('deleteMaterial', { id: id }); ST.cat.materials = C().materials.filter(m => m.id !== id); await KV.set('catalog', ST.cat); closeModal(); render(); toast('Deleted.'); } catch (e) { toast(e.message); } },
    reloadresults: () => loadResults(true),
    exportroster: () => { const R = ST.results, sel = R.quizzes.find(q => q.id === ST.resSel) || R.quizzes.slice().sort((a, b) => b.attempts - a.attempts)[0]; downloadCSV(sel.title.replace(/[^\w\- ]+/g, '') + ' results.csv', ['Student', 'LRN', 'Section', 'Tries', 'Best %', 'Latest %', 'Last taken'], sel.roster.map(r => [r.name, r.lrn, r.section, r.tries, r.best, r.lastPct, fmtTime(r.last)])); },
    // admin
    reloadadm: () => loadAdm(true),
    approve: id => admUser('approve', { id: id }, 'Approved. They can sign in now.'),
    reject: id => admUser('reject', { id: id }, 'Sign-up rejected.'),
    suspend: id => { const u = ST.adm.users.find(x => x.id === id); admUser('setStatus', { id: id, status: u.status === 'active' ? 'suspended' : 'active' }, u.status === 'active' ? u.name + ' is suspended.' : u.name + ' can sign in again.'); },
    reset: async id => {
      const u = ST.adm.users.find(x => x.id === id);
      try { const r = await api('resetPassword', { id: id }); openModal(`<div><p class="label">Password reset</p><h2>${esc(u.name)}</h2></div><p>Give this temporary password to ${esc(u.name.split(' ')[0])} in person or through their adviser. They’ll choose a new one when they sign in.</p><div class="row"><span class="kbd">${esc(r.tempPassword)}</span><button class="btn" data-act="copy" data-id="${esc(r.tempPassword)}">Copy</button></div><div><button class="btn primary" data-act="close">Done</button></div>`); loadAdm(true); } catch (e) { toast(e.message); }
    },
    editstaff: id => { const u = ST.adm.users.find(x => x.id === id); openModal(`<form id="esForm" class="field" style="gap:12px" data-id="${id}" novalidate><h2>Subjects for ${esc(u.name)}</h2><label class="field"><span>Subjects, separated by commas</span><input type="text" id="esSubj" value="${esc(u.subjects)}"></label><div class="row"><button class="btn primary" type="submit">Save</button><span class="err" id="esErr"></span></div></form>`); },
    copy: txt => { const ok = () => toast('Copied ' + (txt.length > 40 ? '' : txt)); try { navigator.clipboard.writeText(txt).then(ok, () => toast('Couldn’t copy. Select the text and copy it.')); } catch (e) { toast('Couldn’t copy. Select the text and copy it.'); } },
    editsec: id => { const s = secById(id); openModal(`<form id="esecForm" class="field" style="gap:12px" data-id="${id}" novalidate><h2>Edit ${esc(s.label)}</h2><div class="fgrid two"><label class="field"><span>Grade</span><select id="eGrade">${opt('11', 'Grade 11', s.grade)}${opt('12', 'Grade 12', s.grade)}</select></label><label class="field"><span>Strand</span><select id="eStrand">${C().settings.strands.map(x => opt(x, x, s.strand)).join('')}</select></label><label class="field"><span>Section name</span><input type="text" id="eName" value="${esc(s.name)}"></label><label class="field"><span>Adviser</span><input type="text" id="eAdv" value="${esc(s.adviser)}"></label></div><div class="row"><button class="btn primary" type="submit">Save</button><span class="err" id="eErr"></span></div></form>`); },
    asknewcode: id => openModal(`<h2>Make a new code for ${esc(secLabel(id))}?</h2><p>The current code stops working right away. Students already approved aren’t affected.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="newcode" data-id="${id}">Make new code</button></div>`),
    newcode: async id => { try { const r = await api('newCode', { id: id }); closeModal(); await refresh(true); render(); toast('New code: ' + r.code); } catch (e) { toast(e.message); } },
    askdelsec: id => openModal(`<h2>Delete ${esc(secLabel(id))}?</h2><p>You can only delete a section with no students in it.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="delsec" data-id="${id}">Delete</button></div>`),
    delsec: async id => { try { await api('deleteSection', { id: id }); closeModal(); await refresh(true); render(); toast('Section deleted.'); } catch (e) { closeModal(); toast(e.message); } },
    logcat: id => { ST.logCat = id; render(); },
    backup: async () => { toast('Backing up…'); try { const r = await api('backupNow', {}); ST.adm.backups = r.backups; render(); toast('Backup saved to Google Drive.'); } catch (e) { toast(e.message); } },
    reloadreports: () => loadReports(true),
    exportattempts: async () => { try { const r = await api('exportAttempts', {}); downloadCSV('Review Hub quiz results.csv', r.header, r.rows.map(x => { x[0] = fmtTime(x[0]); return x; })); } catch (e) { toast(e.message); } },
    exportusers: async () => { await loadAdm(true); const u = (ST.adm || { users: [] }).users; downloadCSV('Review Hub accounts.csv', ['Name', 'Role', 'LRN', 'Username', 'Section', 'Status', 'Signed up', 'Last active'], u.map(x => [x.name, ROLE[x.role], x.lrn, x.username, x.section, x.status, fmtTime(x.created), fmtTime(x.lastActive)])); }
  };
  async function admUser(action, data, msg) {
    try { await api(action, data); toast(msg); await loadAdm(true); } catch (e) { toast(e.message); }
  }

  /* ================= events ================= */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.tagName === 'A') return;
    e.preventDefault();
    const fn = A[b.dataset.act];
    if (fn) Promise.resolve(fn(b.dataset.id, b)).catch(err => toast(err.message || 'Something went wrong.'));
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  document.addEventListener('input', e => {
    const t = e.target, id = t.id;
    const form = t.closest('form'); if (form && form.id !== 'loginForm') form.setAttribute('data-dirty', '1');
    if (bindEditor(t)) return;
    if (id === 'q') { ST.f.q = t.value; updateResults(); }
    if (id === 'uq') { ST.uq = t.value; $('#utable').innerHTML = usersTable(); }
    if (id === 'suLrn') t.value = t.value.replace(/\D/g, '').slice(0, 12);
  });
  document.addEventListener('change', e => {
    const t = e.target, id = t.id;
    if (ST.edit && t.closest('#qeForm')) { bindEditor(t); if (t.dataset.m === 'grade') { ST.edit.sections = []; render(); } return; }
    const fmap = { fgrade: 'grade', fstrand: 'strand', fsection: 'section', fsubject: 'subject', fterm: 'term', fwhen: 'when', fsort: 'sort' };
    if (fmap[id]) { ST.f[fmap[id]] = t.value; updateResults(); }
    if (id === 'fmine') { ST.f.mine = t.checked; updateResults(); }
    if (id === 'resSel') { ST.resSel = t.value; render(); }
    if (id === 'urole') { ST.urole = t.value; $('#utable').innerHTML = usersTable(); }
    if (id === 'suGrade' || id === 'suStrand') { ST.sg = $('#suGrade').value; ST.ss = id === 'suStrand' ? t.value : null; keepVals(render); }
    if (t.name === 'upkind') { ST.up.kind = t.value; keepVals(render); }
    if (id === 'upGrade') { ST.up.grade = t.value; ST.up.strands = null; keepVals(render); }
    if (t.classList.contains('upStrand')) { ST.up.strands = $$('.upStrand:checked').map(i => i.value); $('#upSecs').innerHTML = sectionChecks(ST.up.grade, ST.up.strands, null, 'upSec'); }
  });
  function keepVals(fn) {
    const vals = $$('#app input[id], #app textarea[id], #app select[id]').filter(el => !['file', 'radio', 'checkbox', 'password'].includes(el.type)).map(el => [el.id, el.value]);
    const skip = new Set(['suStrand', 'suSection', 'upGrade', 'suGrade']);
    fn();
    vals.forEach(([i, v]) => { const el = document.getElementById(i); if (el && !skip.has(i)) el.value = v; });
  }
  document.addEventListener('submit', async e => {
    const id = e.target.id;
    const F = { loginForm: doLogin, suForm: doSignup, pwForm: doChangePw, upForm: doUpload, emForm: saveMat };
    if (F[id]) return F[id](e);
    e.preventDefault();
    const val = i => ($('#' + i) || {}).value || '';
    try {
      if (id === 'staffForm') {
        const r = await api('createStaff', { name: val('sfName'), username: val('sfUser'), role: val('sfRole'), subjects: val('sfSubj') });
        openModal(`<h2>Account created</h2><p>Username: <span class="kbd">${esc(val('sfUser').trim().toLowerCase())}</span></p><p>Temporary password: <span class="kbd">${esc(r.tempPassword)}</span></p><p class="small muted">Give these to the teacher. They’ll choose their own password the first time they sign in.</p><div class="row"><button class="btn" data-act="copy" data-id="${esc(r.tempPassword)}">Copy password</button><button class="btn primary" data-act="close">Done</button></div>`);
        await loadAdm(true);
      } else if (id === 'secForm') {
        const r = await api('saveSection', { grade: val('scGrade'), strand: val('scStrand'), name: val('scName'), adviser: val('scAdv') });
        await refresh(true); render(); toast('Section added. Class code: ' + r.code);
      } else if (id === 'esecForm') {
        await api('saveSection', { id: e.target.dataset.id, grade: val('eGrade'), strand: val('eStrand'), name: val('eName'), adviser: val('eAdv') });
        closeModal(); await refresh(true); render(); toast('Section saved.');
      } else if (id === 'esForm') {
        await api('updateStaff', { id: e.target.dataset.id, subjects: val('esSubj') }); closeModal(); toast('Subjects saved.'); loadAdm(true);
      } else if (id === 'setForm') {
        await api('saveSettings', { schoolName: val('stName'), currentTerm: val('stTerm'), strands: val('stStrands').split('\n'), subjects: val('stSubjects').split('\n') });
        await refresh(true); render(); toast('Settings saved.');
      }
    } catch (ex) {
      const errEl = e.target.querySelector('.err'); if (errEl) errEl.textContent = ex.message; else toast(ex.message);
    }
  });

  window.addEventListener('online', () => { renderTop(); toast('Back online.'); sync(); refresh(true); });
  window.addEventListener('offline', () => { renderTop(); if (!isBusy()) render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine && ST.token && Date.now() - (ST.lastRefresh || 0) > 5 * 60 * 1000) refresh(true); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ST.installEvt = e; renderTop(); });
  window.addEventListener('appinstalled', () => { ST.installEvt = null; renderTop(); toast('Review Hub is installed. Open it from your home screen.'); });

  /* ================= start ================= */
  async function boot() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
    try {
      const s = await KV.get('session');
      if (s && s.token) { ST.token = s.token; ST.user = s.user; ST.f.mine = s.user.role === 'student'; }
      ST.cat = (await KV.get('catalog')) || null;
      ST.pending = (await KV.get('pending')) || [];
      ST.saved = (await KV.get('savedIndex')) || {};
    } catch (e) { }
    render();
    if (ST.token && !ST.user.mustChange) refresh(!!ST.cat);
  }
  boot();
})();
