/* REVIEW+ sign-in screens, the library, materials, offline saving and student progress. */
'use strict';

/* ================= sign-in ================= */
V.login = function () {
  return `<form class="panel auth" id="loginForm" novalidate>
    <div class="row">${brandMark()}<div><h1>${esc(appName())}</h1><p class="muted small">${esc(schoolName())}</p></div></div>
    ${apiReady() ? '' : '<div class="banner warn small"><span>This copy of the app isn’t connected to the school server yet. Put the web app URL in <b>config.js</b> (setup guide, step 4).</span></div>'}
    <label class="field"><span>LRN or username</span><input type="text" id="liId" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Students: your 12-digit LRN"></label>
    <label class="field"><span>Password</span><input type="password" id="liPw" autocomplete="current-password"></label>
    <div class="row"><button class="btn primary" type="submit" id="liBtn">Sign in</button><span class="err" id="liErr" role="alert"></span></div>
    <p class="small">New student? <button type="button" class="btn small" data-act="screen" data-id="signup">Sign up</button></p>
    <p class="small muted">Forgot your password? Ask your adviser or the admin to reset it.</p></form>`;
};
async function doLogin(e) {
  e.preventDefault();
  const id = $('#liId').value.trim(), pw = $('#liPw').value;
  $('#liErr').textContent = ''; $('#liBtn').disabled = true; $('#liBtn').textContent = 'Signing in…';
  try {
    const r = await api('login', { id: id, password: pw });
    const prev = ST.user;
    ST.token = r.token; ST.user = r.user;
    if (r.branding) applyBranding(r.branding);
    if (!prev || prev.id !== r.user.id) { ST.cat = null; await KV.del('catalog'); }
    ST.tab = null;
    await persist(); render();
    if (!r.user.mustChange) await refresh();
  } catch (err) { $('#liErr').textContent = err.message; $('#liBtn').disabled = false; $('#liBtn').textContent = 'Sign in'; }
}

let signupOpts = null;
V.signup = function () {
  if (!signupOpts) return `<div class="panel auth"><h1>Student sign-up</h1><p class="muted" id="suLoad">${navigator.onLine ? 'Loading sections…' : 'You need internet to sign up.'}</p><div><button class="btn" data-act="screen" data-id="login">Back to sign in</button></div></div>`;
  const g = ST.sg || '11', strands = signupOpts.strands.filter(st => signupOpts.sections.some(s => s.grade == g && s.strand === st));
  const st = strands.includes(ST.ss) ? ST.ss : strands[0];
  const secs = signupOpts.sections.filter(s => s.grade == g && s.strand === st);
  return `<form class="panel auth" id="suForm" novalidate>
    <div class="row">${brandMark()}<div><p class="label">Student sign-up</p><h1>Join ${esc(appName())}</h1></div></div><p class="muted small">Ask your adviser for your class code before you start.</p>
    <label class="field"><span>Full name</span><input type="text" id="suName" placeholder="First name, middle initial, last name" autocomplete="name"></label>
    <label class="field"><span>LRN</span><input type="text" id="suLrn" inputmode="numeric" placeholder="12-digit Learner Reference Number"><small>It’s on your report card.</small></label>
    <div class="fgrid"><label class="field"><span>Grade</span><select id="suGrade" data-keep="no">${opt('11', 'Grade 11', g)}${opt('12', 'Grade 12', g)}</select></label>
    <label class="field"><span>Strand</span><select id="suStrand" data-keep="no">${strands.map(s => opt(s, s, st)).join('') || '<option value="">None yet</option>'}</select></label>
    <label class="field"><span>Section</span><select id="suSection" data-keep="no">${secs.map(s => opt(s.id, s.label, '')).join('') || '<option value="">None yet</option>'}</select></label></div>
    <label class="field"><span>Class code</span><input type="text" id="suCode" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-family:var(--f-mono);text-transform:uppercase"></label>
    <div class="fgrid two"><label class="field"><span>Password</span><input type="password" id="suPw" autocomplete="new-password"><small>At least 8 characters.</small></label>
    <label class="field"><span>Type it again</span><input type="password" id="suPw2" autocomplete="new-password"></label></div>
    <div class="row"><button class="btn primary" type="submit" id="suBtn">Send sign-up</button><button type="button" class="btn ghost" data-act="screen" data-id="login">Back to sign in</button></div>
    <p class="err" id="suErr" role="alert"></p></form>`;
};
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

V.changePw = function (forced) {
  return `<form class="panel auth" id="pwForm" novalidate><div><p class="label">${forced ? 'One more step' : 'Account'}</p><h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
    ${forced ? '<p class="muted small">You signed in with a temporary password. Choose a new one that only you know.</p>' : ''}</div>
    <label class="field"><span>${forced ? 'Temporary password' : 'Current password'}</span><input type="password" id="pwCur" autocomplete="current-password"></label>
    <label class="field"><span>New password</span><input type="password" id="pwNew" autocomplete="new-password"><small>At least 8 characters.</small></label>
    <label class="field"><span>Type the new password again</span><input type="password" id="pwNew2" autocomplete="new-password"></label>
    <div class="row"><button class="btn primary" type="submit">Save password</button>${forced ? '<button type="button" class="btn ghost" data-act="signout">Sign out</button>' : ''}</div><p class="err" id="pwErr" role="alert"></p></form>`;
};
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

/* ================= library ================= */
function filterBar(staff) {
  const f = ST.f, c = C();
  const subjects = [...new Set(c.materials.map(m => m.subject))].sort();
  const types = [...new Set(c.materials.map(m => m.type))];
  return `<div class="searchbox"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
    <input type="search" id="q" placeholder="Search a topic, like “domain” or “photosynthesis”" value="${esc(f.q)}" aria-label="Search materials"></div>
    <div class="fgrid">
      ${staff ? `<label class="field"><span>School year</span><select id="fsy">${opt('all', 'All years', f.sy)}${schoolYears().map(y => opt(y, y, f.sy)).join('')}</select></label>
      <label class="field"><span>Grade</span><select id="fgrade">${opt('all', 'All grades', f.grade)}${opt('11', 'Grade 11', f.grade)}${opt('12', 'Grade 12', f.grade)}</select></label>
      <label class="field"><span>Strand</span><select id="fstrand">${opt('all', 'All strands', f.strand)}${c.settings.strands.map(s => opt(s, s, f.strand)).join('')}</select></label>
      <label class="field"><span>Section</span><select id="fsection">${opt('all', 'All sections', f.section)}${c.sections.map(s => opt(s.id, s.label + (s.sy ? ' (' + s.sy + ')' : ''), f.section)).join('')}</select></label>` : ''}
      <label class="field"><span>Subject</span><select id="fsubject">${opt('all', 'All subjects', f.subject)}${subjects.map(s => opt(s, s, f.subject)).join('')}</select></label>
      <label class="field"><span>Term</span><select id="fterm">${opt('all', 'All terms', f.term)}${TERM_IDS.map(k => opt(k, TERMS[k], f.term)).join('')}</select></label>
      <label class="field"><span>Type</span><select id="ftype">${opt('all', 'All types', f.type)}${types.map(t => opt(t, (TYPES[t] || TYPES.file)[1], f.type)).join('')}</select></label>
      <label class="field"><span>Sort by</span><select id="fsort">${opt('new', 'Newest first', f.sort)}${opt('old', 'Oldest first', f.sort)}${opt('az', 'Title A–Z', f.sort)}</select></label>
    </div><div class="spread"><span class="small muted">${staff ? 'Published materials from all teachers. Your own locked materials are under My materials.' : 'Materials your teachers published for ' + esc(secLabel(ST.user.sectionId)) + '.'}</span><span class="small muted" id="rmeta"></span></div>
    <div class="grid" id="results"></div>`;
}
V.find = () => filterBar(false);
V.findAfter = () => updateResults();
V.library = () => filterBar(true);
V.libraryAfter = () => updateResults();
function filtered() {
  const f = ST.f, terms = norm(f.q).split(' ').filter(Boolean), staff = isStaff();
  const list = C().materials.filter(m => {
    if (m.status !== 'published') return false;
    if (!navigator.onLine && isStudent() && fileLike(m) && !ST.saved[m.id]) return false;
    if (!navigator.onLine && m.type === 'link') return false;
    if (staff) {
      if (f.sy !== 'all' && m.sy !== f.sy) return false;
      if (f.grade !== 'all' && String(m.grade) !== f.grade) return false;
      if (f.strand !== 'all' && !m.sections.some(s => (secById(s) || {}).strand === f.strand)) return false;
      if (f.section !== 'all' && !m.sections.includes(f.section)) return false;
    }
    if (f.subject !== 'all' && m.subject !== f.subject) return false;
    if (f.term !== 'all' && m.term !== f.term) return false;
    if (f.type !== 'all' && m.type !== f.type) return false;
    if (terms.length) { const hay = norm([m.title, m.topic, m.keywords, m.subject, m.teacherName, m.desc].join(' ')); if (!terms.every(t => hay.includes(t))) return false; }
    return true;
  });
  const pd = m => m.publishedAt || m.date || '';
  list.sort((a, b) => f.sort === 'old' ? pd(a).localeCompare(pd(b)) : f.sort === 'az' ? a.title.localeCompare(b.title) : pd(b).localeCompare(pd(a)));
  return { list: list, terms: terms };
}
function hl(text, terms) {
  let s = esc(text);
  terms.forEach(t => { if (t.length < 2) return; s = s.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
  return s;
}
function card(m, terms) {
  terms = terms || [];
  const saved = !!ST.saved[m.id], qz = quizzesFor(m.id).filter(q => !isStudent() || q.sections.includes(ST.user.sectionId));
  const offlineBlocked = !navigator.onLine && fileLike(m) && !saved;
  return `<article class="mat">${typeTag(m)}<div class="mbody">
    <h3><button class="linkish" data-act="open" data-id="${m.id}">${hl(m.title, terms)}</button></h3>
    <p class="small">${esc(m.subject)} › <b>${hl(m.topic, terms)}</b> <span class="muted">· ${termName(m.term)}</span></p>
    <p class="meta">${esc(m.teacherName)} · ${fmtDate(m.publishedAt || m.date)}${m.size ? ' · ' + fmtSize(m.size) : ''}</p>
    <div class="chips">${isStaff() ? `<span class="chip">${esc(aud(m.sections))}</span>` : ''}${qz.length ? '<span class="chip quiz">Practice quiz</span>' : ''}${saved ? '<span class="chip saved">Saved offline ✓</span>' : ''}${m.status !== 'published' ? statusPill(m.status, m.publishAt) : ''}</div>
    <div class="actions"><button class="btn small" data-act="open" data-id="${m.id}">Open</button>
    ${fileLike(m) && m.allowOffline && isStudent() ? `<button class="btn small${saved ? ' on' : ''}" data-act="save" data-id="${m.id}"${offlineBlocked ? ' disabled' : ''}>${saved ? 'Saved ✓' : 'Save offline'}</button>` : ''}
    ${qz.length && isStudent() ? `<button class="btn small primary" data-act="startquiz" data-id="${qz[0].id}">Practice</button>` : ''}</div></div></article>`;
}
function updateResults() {
  const r = $('#results'); if (!r) return;
  const { list, terms } = filtered();
  $('#rmeta').textContent = plural(list.length, 'material');
  r.innerHTML = list.length ? list.map(m => card(m, terms)).join('') : `<div class="empty">${C().materials.some(m => m.status === 'published') ? 'No materials match. Try a shorter search word or another term.' : isStudent() ? 'Your teachers haven’t published materials for your section yet.' : 'No published materials yet.'}</div>`;
}

/* ================= by term (students) ================= */
V.subjects = function () {
  const live = C().materials.filter(m => m.status === 'published');
  const cur = C().settings.currentTerm;
  if (!ST.sterm) ST.sterm = live.some(m => m.term === cur) ? cur : 'all';
  const t = ST.sterm;
  const pills = `<div class="pillrow" role="group" aria-label="Term">${[['all', 'All terms']].concat(TERM_IDS.map(k => [k, TERMS[k]])).map(([k, l]) => `<button class="pillbtn" aria-pressed="${t === k}" data-act="sterm" data-id="${k}">${l}${k === cur ? ' · now' : ''}</button>`).join('')}</div>`;
  const inT = live.filter(m => t === 'all' || m.term === t);
  if (!ST.subj) {
    const subs = [...new Set(inT.map(m => m.subject))].sort();
    if (!subs.length) return pills + `<div class="empty">No materials ${t === 'all' ? 'yet' : 'for ' + TERMS[t] + ' yet'}.</div>`;
    return pills + `<div class="grid">${subs.map(s => {
      const ms = inT.filter(m => m.subject === s), topics = [...new Set(ms.map(m => m.topic))], q = ms.filter(m => quizzesFor(m.id).length).length;
      return `<button class="panel linkish" style="text-align:left;gap:6px" data-act="subj" data-id="${esc(s)}"><span class="label">${[...new Set(ms.map(m => termName(m.term)))].sort().join(' · ')}</span><h3>${esc(s)}</h3><span class="small muted">${plural(ms.length, 'material')} · ${plural(q, 'with a quiz', 'with quizzes')}</span><span class="small">Topics: ${topics.map(esc).join(', ')}</span></button>`;
    }).join('')}</div>`;
  }
  const ms = inT.filter(m => m.subject === ST.subj);
  const byTerm = TERM_IDS.filter(k => ms.some(m => m.term === k));
  return pills + `<div class="row"><button class="btn small" data-act="subj" data-id="">← All subjects</button><h2>${esc(ST.subj)}</h2></div>` + (byTerm.map(k => {
    const tm = ms.filter(m => m.term === k), topics = [...new Set(tm.map(m => m.topic))];
    return `<section style="display:flex;flex-direction:column;gap:12px"><h2>${TERMS[k]}</h2>${topics.map(l => `<p class="label">Topic · ${esc(l)}</p><div class="grid">${tm.filter(m => m.topic === l).map(m => card(m)).join('')}</div>`).join('')}</section>`;
  }).join('') || '<div class="empty">Nothing here for this term.</div>');
};

/* ================= saved offline ================= */
V.saved = function () {
  const list = Object.keys(ST.saved).map(id => matById(id)).filter(Boolean);
  return `<div class="banner note"><span>Saved files stay on this phone and open with no load. Quizzes work offline even without saving. <span id="storage"></span></span></div>
    <div class="grid">${list.length ? list.map(m => card(m)).join('') : '<div class="empty">Nothing saved yet. Tap “Save offline” on any material while you have internet.</div>'}</div>
    <p class="small muted">If a teacher locks or removes a material, its saved copy is deleted from this phone the next time the app goes online.</p>`;
};
V.savedAfter = async function () {
  const el = $('#storage'); if (!el) return;
  const used = Object.values(ST.saved).reduce((s, x) => s + (x.size || 0), 0);
  let txt = 'Using ' + (fmtSize(used) || '0 KB') + '.';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e.quota) txt += ' About ' + fmtSize(Math.max(0, e.quota - e.usage)) + ' free for the app.'; } } catch (e) { }
  el.textContent = txt;
};

/* ================= opening a material ================= */
async function getFile(m, purpose) {
  const saved = await KV.get(m.id, 'files');
  if (saved && saved.blob) return Object.assign({ local: true }, saved);
  const r = await api('file', { id: m.id, purpose: purpose }, { timeout: 180000 });
  return { blob: b64ToBlob(r.b64, r.mime), name: r.name, mime: r.mime };
}
const hasTextView = m => /\.(pptx|docx|txt)$/i.test(m.fileName || '');
function openMat(id, preview) {
  const m = matById(id); if (!m) return;
  const t = TYPES[m.type] || TYPES.file, saved = !!ST.saved[id], qz = quizzesFor(id).filter(q => !isStudent() || q.sections.includes(ST.user.sectionId));
  const canGet = saved || navigator.onLine;
  const viewable = ['image', 'audio', 'video', 'pdf'].includes(m.type);
  const st = isStaff();
  openModal(`<div><p class="label">${esc(m.subject)} · ${t[1]} · ${termName(m.term)}</p><h2>${esc(m.title)}</h2><p class="meta">${esc(m.teacherName)} · ${m.publishedAt ? 'Published ' + fmtDate(m.publishedAt) : 'Uploaded ' + fmtDate(m.date)}${m.size ? ' · ' + fmtSize(m.size) : ''}</p></div>
    ${preview || (st && m.status !== 'published') ? `<div class="banner ${m.status === 'published' ? 'note' : 'warn'}"><span>${m.status === 'published' ? '<b>Preview.</b> This is what students see.' : '<b>Students can’t see this yet.</b> Status: ' + statusPill(m.status, m.publishAt) + '. Students only get published files, and the server checks every request.'}</span></div>` : ''}
    ${m.desc ? `<p style="white-space:pre-wrap">${esc(m.desc)}</p>` : ''}
    <div class="chips">${st ? `<span class="chip">For: ${esc(aud(m.sections))}</span><span class="chip">SY ${esc(m.sy)}</span>` : ''}<span class="chip">Topic: ${esc(m.topic)}</span></div>
    <div id="viewer"></div>
    ${m.type === 'link' ? `<div class="row"><a class="btn primary" href="${esc(m.url)}" target="_blank" rel="noopener" data-linkopen="${m.id}">Open website ↗</a></div><p class="small muted">Websites need internet.</p>` :
      canGet ? `<div class="row">${viewable ? `<button class="btn primary" data-act="view" data-id="${id}">View</button>` : ''}${hasTextView(m) ? `<button class="btn${viewable ? '' : ' primary'}" data-act="textview" data-id="${id}">Quick view (text)</button>` : ''}
        ${!isStudent() || m.allowOffline ? `<button class="btn" data-act="download" data-id="${id}">Download${isStudent() ? ' to phone' : ''}</button>` : ''}
        ${isStudent() && m.allowOffline ? `<button class="btn${saved ? ' on' : ''}" data-act="save" data-id="${id}">${saved ? 'Saved offline ✓' : 'Save offline'}</button>` : ''}</div>
        ${isStudent() ? `<p class="small muted">${!m.allowOffline ? 'Your teacher turned off downloads for this material. You can view it while online.' : saved ? 'Saved on this phone. Opens with no load.' : '“Download to phone” puts a copy in your Downloads folder. “Save offline” keeps it inside this app.'}</p>` : ''}`
        : '<div class="banner off"><span>Not saved on this phone. Connect to the internet once and tap “Save offline” to read it without load.</span></div>'}
    ${qz.length ? `<div class="row">${qz.map(q => `<button class="btn primary" data-act="startquiz" data-id="${q.id}">${esc(KINDS[q.kind] || 'Quiz')}: ${esc(q.title)}</button>`).join('')}</div>` : ''}
    ${st && isMine(m) ? `<div class="row"><button class="btn small" data-act="editmat" data-id="${id}">Edit details</button>${aiReadable(m) ? `<button class="btn small" data-act="gen" data-id="${id}">Make a quiz with AI</button>` : ''}</div>` : ''}`);
}
async function viewFile(id) {
  const m = matById(id), box = $('#viewer'); if (!m || !box) return;
  let win = null;
  if (m.type === 'pdf') win = window.open('', '_blank');
  box.innerHTML = '<p class="small muted"><span class="spinner"></span> Opening…</p>';
  try {
    const f = await getFile(m, isStaff() ? 'preview' : 'view');
    if (f.local) logEvent(navigator.onLine ? 'view' : 'offlineview', m.id);
    const u = URL.createObjectURL(f.blob);
    if (m.type === 'image') box.innerHTML = `<img class="viewer" style="background:none" src="${u}" alt="${esc(m.title)}">`;
    else if (m.type === 'audio') box.innerHTML = `<audio controls src="${u}" style="width:100%"></audio>`;
    else if (m.type === 'video') box.innerHTML = `<video class="viewer" controls playsinline src="${u}"></video>`;
    else { if (win) { win.location.href = u; box.innerHTML = '<p class="small muted">Opened in a new tab. If nothing opened, use “Download”.</p>'; } else { saveBlob(f.blob, f.name); box.innerHTML = ''; } }
  } catch (e) { if (win) win.close(); box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function textView(id) {
  const m = matById(id), box = $('#viewer'); if (!m || !box) return;
  box.innerHTML = '<p class="small muted"><span class="spinner"></span> Getting the text…</p>';
  try {
    let pv = await KV.get('pv:' + id);
    if (!pv) { const r = await api('previewText', { id: id }); pv = r.pages; if (ST.saved[id]) await KV.set('pv:' + id, pv); }
    logEvent(navigator.onLine ? 'view' : 'offlineview', id);
    box.innerHTML = `<div class="slides">${pv.map(p => `<div>${pv.length > 1 ? `<span class="label">Slide ${p.n}</span>\n` : ''}${esc(p.text || '(no text on this slide)')}${p.notes ? `\n<span class="small muted">Notes: ${esc(p.notes)}</span>` : ''}</div>`).join('') || '<div>No text found.</div>'}</div><p class="small muted">Text only. Download the file to see pictures and layout.</p>`;
  } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function downloadFile(id) {
  const m = matById(id); if (!m) return;
  toast('Getting the file…');
  try { const f = await getFile(m, isStaff() ? 'preview' : 'download'); if (f.local) logEvent('offlineview', m.id); saveBlob(f.blob, f.name || m.fileName); toast('Saved to your Downloads folder.'); } catch (e) { toast(e.message); }
}
async function toggleSave(id) {
  const m = matById(id);
  if (ST.saved[id]) { await KV.del(id, 'files'); await KV.del('pv:' + id); delete ST.saved[id]; await persist(); toast('Removed from this phone.'); }
  else {
    if (!m) return;
    if (!navigator.onLine) { toast('Connect to the internet to save new materials.'); return; }
    toast('Saving ' + (m.size ? fmtSize(m.size) : 'file') + '…');
    try {
      const r = await api('file', { id: m.id, purpose: 'save' }, { timeout: 180000 });
      const blob = b64ToBlob(r.b64, r.mime);
      await KV.set(id, { blob: blob, name: r.name || m.fileName, mime: r.mime }, 'files');
      ST.saved[id] = { name: r.name || m.fileName, size: blob.size, savedAt: new Date().toISOString() };
      if (hasTextView(m)) { try { const pv = await api('previewText', { id: id }); await KV.set('pv:' + id, pv.pages); } catch (e) { } }
      await persist();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
      toast('Saved. It opens even with no load.');
    } catch (e) { toast(e.name === 'QuotaExceededError' ? 'Your phone is out of space for the app. Remove some saved files first.' : e.message); return; }
  }
  if (modalOpen() && m) openMat(id);
  render();
}

/* ================= practice and progress ================= */
function history() {
  const server = (C().myAttempts || []).map(a => Object.assign({ synced: true }, a));
  const have = new Set(server.map(a => a.clientId));
  return server.concat(ST.pending.filter(a => !have.has(a.clientId)).map(a => Object.assign({ synced: false }, a))).sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt)));
}
function bestScores() { const b = {}; history().forEach(a => { if (a.status !== 'pending') b[a.quizId] = Math.max(b[a.quizId] || 0, a.pct); }); return b; }
V.practice = function () {
  const qs = C().quizzes.filter(q => q.status === 'published' && (!isStudent() || q.sections.includes(ST.user.sectionId)));
  if (!qs.length) return `<div class="empty">No quizzes yet. Your teachers’ quizzes will show up here, and they work offline.</div>`;
  const best = bestScores(), h = history();
  const tests = qs.filter(q => q.kind !== 'practice'), prac = qs.filter(q => q.kind === 'practice');
  const qcard = q => {
    const tries = h.filter(a => a.quizId === q.id), left = q.maxAttempts ? Math.max(0, q.maxAttempts - tries.length) : null, wait = tries.some(a => a.status === 'pending');
    const types = [...new Set(q.questions.map(x => x.type))];
    return `<article class="panel"><div><p class="label">${esc(KINDS[q.kind])} · ${esc(q.subject)} · ${termName(q.term)}</p><h3>${esc(q.title)}</h3></div>
      <div class="chips">${types.map(t => `<span class="chip">${QT[t]}</span>`).join('')}</div>
      <p class="small muted">${plural(q.questions.length, 'question')} · ${esc(q.teacherName)}${best[q.id] != null ? ` · Your best: <b>${best[q.id]}%</b>` : tries.length ? '' : ' · Not tried yet'}${wait ? ' · <span class="pill info">Waiting for teacher</span>' : ''}</p>
      <div class="row">${left === 0 ? '<span class="pill info">No tries left</span>' : `<button class="btn primary" data-act="startquiz" data-id="${q.id}">${tries.length ? 'Try again' : 'Start'}</button>`}${left ? `<span class="small muted">${plural(left, 'try', 'tries')} left</span>` : ''}</div></article>`;
  };
  return `${prac.some(q => q.questions.some(x => OBJECTIVE.includes(x.type))) ? `<article class="panel" style="background:var(--hi-soft);border-color:transparent"><div class="spread"><div><h2>Quick mixed review</h2><p class="small">Up to 10 questions mixed from your practice quizzes. It’s for practice and isn’t sent to teachers.</p></div><button class="btn primary" data-act="mixed">Start mixed review</button></div></article>` : ''}
    ${tests.length ? `<h2>Pre-tests and post-tests</h2><div class="grid">${tests.map(qcard).join('')}</div>` : ''}
    ${prac.length ? `<h2>Practice quizzes</h2><div class="grid">${prac.map(qcard).join('')}</div>` : ''}`;
};
V.progress = function () {
  const h = history(), qmap = {};
  C().quizzes.forEach(q => qmap[q.id] = q);
  const done = h.filter(a => a.status !== 'pending');
  const avg = done.length ? Math.round(done.reduce((s, a) => s + a.pct, 0) / done.length) : null;
  const bySub = {}, byTopic = {}, missed = {}, comps = {};
  done.forEach(a => { const q = qmap[a.quizId]; if (!q) return; const s = bySub[q.subject] = bySub[q.subject] || { sum: 0, n: 0 }; s.sum += a.pct; s.n++; const k = q.subject + ' › ' + (q.topic || 'General'); const t = byTopic[k] = byTopic[k] || { sum: 0, n: 0 }; t.sum += a.pct; t.n++; });
  h.slice(0, 60).forEach(a => { const q = qmap[a.quizId]; if (!q) return; (a.results || []).forEach(r => { const qq = q.questions.find(x => x.id === r.id); if (!qq || !qq.comp || r.f === null || r.f === undefined) return; const c = comps[qq.comp] = comps[qq.comp] || { e: 0, m: 0, subject: q.subject }; c.e += r.f; c.m++; if (r.f < 1) missed[qq.comp] = (missed[qq.comp] || 0) + 1; }); });
  const weak = Object.keys(missed).filter(k => comps[k].e / comps[k].m < 0.75).sort((a, b) => missed[b] - missed[a]).slice(0, 4);
  const graded = h.filter(a => a.gradedBy && (a.results || []).some(r => r.cmt));
  const pp = C().quizzes.filter(q => q.kind === 'posttest' && q.pairId).map(post => {
    const first = id => h.filter(a => a.quizId === id && a.status !== 'pending').sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)))[0];
    const a = first(post.pairId), b = first(post.id);
    return a && b ? { title: post.title, pre: a.pct, post: b.pct } : null;
  }).filter(Boolean);
  const bars = o => Object.keys(o).sort().map(s => { const v = Math.round(o[s].sum / o[s].n); return `<div class="bar"><div class="lab"><span>${esc(s)}</span><span>${v}% · ${plural(o[s].n, 'quiz', 'quizzes')}</span></div><div class="track"><i class="${v >= 75 ? 'good' : v >= 60 ? 'mid' : 'low'}" style="width:${v}%"></i></div></div>`; }).join('');
  return `<div class="tiles"><div class="tile"><b>${h.length}</b><span>Quizzes taken</span></div><div class="tile"><b>${pctTxt(avg)}</b><span>Average score</span></div><div class="tile"><b>${Object.keys(ST.saved).length}</b><span>Saved offline</span></div><div class="tile"><b>${ST.pending.length}</b><span>Waiting to sync</span></div></div>
    ${!feedbackRecent() ? `<div class="banner hi"><span><b>Help improve ${esc(appName())}.</b> Tell your school how useful and easy to use it is. It takes one minute. <button class="btn small" data-act="feedback">Give feedback</button></span></div>` : ''}
    ${weak.length ? `<article class="panel"><h2>Practice these topics again</h2><p class="small muted">Skills where you scored below 75%.</p><div class="bars">${weak.map(c => `<div class="spread" style="border-top:1px solid var(--line);padding-top:10px"><div><b>${esc(c)}</b><br><span class="small muted">${esc(comps[c].subject)} · ${Math.round(comps[c].e / comps[c].m * 100)}% correct</span></div><button class="btn small primary" data-act="skill" data-id="${esc(c)}">Practice this skill</button></div>`).join('')}</div></article>` : ''}
    ${pp.length ? `<article class="panel"><h2>Pre-test and post-test</h2><div class="tbl-wrap"><table><thead><tr><th>Test</th><th class="num">Pre</th><th class="num">Post</th><th class="num">+/−</th></tr></thead><tbody>${pp.map(x => `<tr><td>${esc(x.title)}</td><td class="num">${x.pre}%</td><td class="num">${x.post}%</td><td class="num"><b>${x.post - x.pre >= 0 ? '+' : ''}${x.post - x.pre}</b></td></tr>`).join('')}</tbody></table></div></article>` : ''}
    <div class="cols">${Object.keys(bySub).length ? `<article class="panel"><h2>By subject</h2><div class="bars">${bars(bySub)}</div></article>` : ''}${Object.keys(byTopic).length ? `<article class="panel"><h2>By topic</h2><div class="bars">${bars(byTopic)}</div></article>` : ''}</div>
    ${graded.length ? `<article class="panel"><h2>Notes from your teachers</h2>${graded.slice(0, 10).map(a => { const q = qmap[a.quizId]; return (a.results || []).filter(r => r.cmt).map(r => { const qq = q && q.questions.find(x => x.id === r.id); return `<div style="border-top:1px solid var(--line);padding-top:8px"><span class="small muted">${esc(q ? q.title : 'Quiz')} · ${esc(a.gradedBy)}</span><p><b>${esc(qq ? qq.q : '')}</b></p><p class="small">${Math.round((r.f || 0) * r.max * 10) / 10} of ${r.max} points. ${esc(r.cmt)}</p></div>`; }).join(''); }).join('')}</article>` : ''}
    <article class="panel"><div class="spread"><h2>Quiz history</h2>${ST.pending.length ? `<span class="pill warn">${ST.pending.length} waiting to sync</span>` : '<span class="pill ok">All synced</span>'}</div>
    ${h.length ? `<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>Date</th><th class="num">Score</th><th>Status</th></tr></thead><tbody>${h.slice(0, 80).map(a => `<tr><td>${esc((qmap[a.quizId] || {}).title || 'Removed quiz')}</td><td class="small">${new Date(a.takenAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</td><td class="num">${a.pct}%</td><td>${!a.synced ? '<span class="pill warn">Not synced</span>' : a.status === 'pending' ? '<span class="pill info">Checking</span>' : '<span class="pill ok">Done</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No quizzes yet. Try one under Practice.</p>'}</article>`;
};

/* ================= student feedback ================= */
const FB_ITEMS = [
  ['useful1', 'The materials helped me understand our lessons.'],
  ['useful2', 'The practice quizzes helped me prepare for exams.'],
  ['access1', 'It’s easy to find the materials I need.'],
  ['access2', 'I can use the materials even with no or slow internet.'],
  ['overall', 'Overall, I’m satisfied with ' + 'REVIEW+' + '.']
];
const CONNECT = ['Mobile data (load)', 'Wi-Fi at home', 'School Wi-Fi only', 'Piso Wi-Fi or shop', 'Rarely online'];
function feedbackRecent() { return ST.lastFeedback && Date.now() - new Date(ST.lastFeedback).getTime() < 30 * 864e5; }
function feedbackForm() {
  const scale = ['Strongly disagree', 'Disagree', 'Not sure', 'Agree', 'Strongly agree'];
  openModal(`<form id="fbForm" class="field" style="gap:16px" novalidate><div><p class="label">Your feedback</p><h2>How is ${esc(appName())} working for you?</h2><p class="small muted">Your answers go to the school without your name, to help improve ${esc(appName())}. Works offline too.</p></div>
    ${FB_ITEMS.map(([k, l]) => `<fieldset class="field" style="border:0;padding:0;margin:0"><legend style="font-weight:700;margin-bottom:6px">${esc(l.replace('REVIEW+', appName()))}</legend><div class="likert">${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="${k}" value="${n}"><b>${n}</b>${n === 1 || n === 5 || n === 3 ? scale[n - 1] : ''}</label>`).join('')}</div></fieldset>`).join('')}
    <label class="field"><span>How do you usually get online?</span><select id="fbConnect">${opt('', 'Choose one', '')}${CONNECT.map(c => opt(c, c, '')).join('')}</select></label>
    <label class="field"><span>What should we improve? (optional)</span><textarea id="fbComment" rows="3" maxlength="1000"></textarea></label>
    <div class="row"><button class="btn primary" type="submit">Send feedback</button><span class="err" id="fbErr"></span></div></form>`);
}
async function doFeedback(e) {
  e.preventDefault();
  const val = k => { const s = document.querySelector('input[name=' + k + ']:checked'); return s ? Number(s.value) : null; };
  const f = { clientId: uid(), time: new Date().toISOString(), connect: $('#fbConnect').value, comment: $('#fbComment').value.trim() };
  FB_ITEMS.forEach(([k]) => f[k] = val(k));
  if (FB_ITEMS.some(([k]) => !f[k])) { $('#fbErr').textContent = 'Answer all five statements.'; return; }
  ST.fbq.push(f); ST.lastFeedback = f.time; await persist();
  closeModal(); toast('Thank you! Your feedback ' + (navigator.onLine ? 'was sent.' : 'will be sent when you’re online.'));
  sync(true); if (!ST.quiz) render();
}

Object.assign(A, {
  screen: id => { ST.screen = id; render(); },
  open: id => openMat(id), preview: id => openMat(id, true), save: toggleSave, view: viewFile, textview: textView, download: downloadFile,
  subj: id => { ST.subj = id || null; render(); },
  sterm: id => { ST.sterm = id; ST.subj = null; render(); },
  feedback: feedbackForm,
  account: () => openModal(`<div><p class="label">Account</p><h2>${esc(ST.user.name)}</h2><p class="muted small">${ROLE[ST.user.role]}${ST.user.lrn ? ' · LRN ' + esc(ST.user.lrn) : ST.user.username ? ' · ' + esc(ST.user.username) : ''}${isStudent() ? ' · ' + esc(secLabel(ST.user.sectionId)) : ''}</p></div>
    <div class="field"><span>Appearance on this device</span><div class="pillrow">${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button class="pillbtn" aria-pressed="${LS.get('mode', 'system') === k}" data-act="mode" data-id="${k}">${l}</button>`).join('')}</div></div>
    <div class="row"><button class="btn" data-act="changepw">Change password</button><button class="btn" data-act="refresh">Check for new materials</button>${isStudent() ? '<button class="btn" data-act="joinsec">Join a new section</button><button class="btn" data-act="feedback">Give feedback</button>' : ''}</div>
    <div class="row"><button class="btn danger" data-act="signout">Sign out</button></div>
    <p class="small muted">${esc(appName())} ${VERSION}${ST.serverVersion ? ' · server ' + esc(ST.serverVersion) : ''}${ST.lastRefresh ? ' · Last updated ' + fmtTime(new Date(ST.lastRefresh).toISOString()) : ''}</p>`),
  mode: m => { LS.set('mode', m); applyTheme((ST.branding || {}).theme); A.account(); },
  changepw: () => openModal(V.changePw(false)),
  joinsec: () => openModal(`<form id="joinForm" class="field" style="gap:12px" novalidate><h2>Join a new section</h2><p class="small">Moving to a new section, for example at the start of the school year? Enter the class code from your new adviser.</p><label class="field"><span>Class code</span><input type="text" id="joinCode" autocapitalize="characters" style="font-family:var(--f-mono);text-transform:uppercase"></label><div class="row"><button class="btn primary" type="submit">Join section</button><span class="err" id="joinErr"></span></div></form>`),
  signout: async () => {
    if (ST.pending.length || ST.fbq.length) await sync(true);
    if (ST.pending.length) { openModal(`<h2>Sign out without syncing?</h2><p>${plural(ST.pending.length, 'quiz result')} on this phone ${ST.pending.length === 1 ? 'hasn’t' : 'haven’t'} reached your teachers yet. Connect to the internet first, or ${ST.pending.length === 1 ? 'it' : 'they'} will be lost.</p><div class="row"><button class="btn" data-act="close">Stay signed in</button><button class="btn danger" data-act="signoutnow">Sign out anyway</button></div>`); return; }
    A.signoutnow();
  },
  signoutnow: async () => { closeModal(); if (navigator.onLine) api('logout', {}).catch(() => { }); await signOutLocal(); render(); },
  install: async () => {
    if (ST.installEvt) { ST.installEvt.prompt(); try { await ST.installEvt.userChoice; } catch (e) { } ST.installEvt = null; renderTop(); return; }
    openModal('<h2>Install on iPhone or iPad</h2><ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="small muted">Open the app from your home screen so saved files stay available offline.</p>');
  }
});
