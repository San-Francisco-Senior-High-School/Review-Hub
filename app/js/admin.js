/* REVIEW+ admin: approvals, users, sections, school settings, branding, activity and backups. */
'use strict';

async function loadAdm(force) {
  if (ST.loading.adm || (!force && ST.adm) || !navigator.onLine) return;
  ST.loading.adm = true;
  try { ST.adm = await api('adminData', {}); } catch (e) { toast(e.message); ST.adm = ST.adm || { users: [], log: [], backups: [] }; }
  finally { ST.loading.adm = false; if (['approvals', 'users', 'activity', 'backups', 'sections'].includes(ST.tab) && !isBusy()) render(); }
}
const needOnline = () => '<div class="empty">This needs internet. Connect and try again.</div>';
const admWait = () => { loadAdm(); return navigator.onLine ? '<p class="muted"><span class="spinner"></span> Loading…</p>' : needOnline(); };

V.approvals = function () {
  if (!ST.adm) return admWait();
  const list = ST.adm.users.filter(u => u.status === 'pending');
  if (!list.length) return '<div class="empty">No sign-ups waiting. New ones appear here.</div>';
  return `<p class="muted small">Approve students after checking that the class code they typed matches their section. A wrong code can mean a typo, or someone who isn’t in that class.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Student</th><th>LRN</th><th>Section</th><th>Class code typed</th><th>Signed up</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.lrn)}</td><td>${esc(u.section)}</td><td><span class="mono">${esc(u.codeEntered)}</span><br>${u.codeOk ? '<span class="pill ok">Matches section</span>' : '<span class="pill warn">Doesn’t match</span>'}</td><td class="small">${fmtTime(u.created)}</td>
    <td><div class="row"><button class="btn small primary" data-act="approve" data-id="${u.id}">Approve</button><button class="btn small danger" data-act="reject" data-id="${u.id}">Reject</button></div></td></tr>`).join('')}</tbody></table></div>`;
};
V.users = function () {
  if (!ST.adm) return admWait();
  return `<form class="panel" id="staffForm" novalidate><h2>Add a teacher or admin</h2><div class="fgrid"><label class="field"><span>Full name</span><input type="text" id="sfName" placeholder="e.g. Ms. Liza Garcia"></label>
    <label class="field"><span>Username</span><input type="text" id="sfUser" autocapitalize="none" placeholder="e.g. lgarcia"></label>
    <label class="field"><span>Role</span><select id="sfRole">${opt('teacher', 'Teacher', 'teacher')}${opt('admin', 'Admin', '')}</select></label></div>
    <label class="field"><span>Subjects they teach (optional)</span><input type="text" id="sfSubj" placeholder="General Mathematics, Statistics and Probability"></label>
    <div class="row"><button class="btn primary" type="submit">Create account</button><span class="err" id="sfErr"></span></div></form>
    <div class="fgrid two"><label class="field"><span>Search</span><input type="search" id="uq" value="${esc(ST.uq)}" placeholder="Name, LRN, username or section"></label>
    <label class="field"><span>Show</span><select id="urole">${opt('all', 'Everyone', ST.urole)}${opt('student', 'Students', ST.urole)}${opt('teacher', 'Teachers', ST.urole)}${opt('admin', 'Admins', ST.urole)}${opt('suspended', 'Suspended accounts', ST.urole)}</select></label></div>
    <div class="tbl-wrap" id="utable">${usersTable()}</div>`;
};
function usersTable() {
  const q = norm(ST.uq);
  const list = ST.adm.users.filter(u => u.status !== 'pending' && u.status !== 'rejected')
    .filter(u => ST.urole === 'all' || (ST.urole === 'suspended' ? u.status === 'suspended' : u.role === ST.urole))
    .filter(u => !q || norm([u.name, u.lrn, u.username, u.section].join(' ')).includes(q));
  return `<table><thead><tr><th>Name</th><th>Role</th><th>Section or subjects</th><th>Status</th><th>Last active</th><th></th></tr></thead><tbody>
    ${list.slice(0, 400).map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="mono small muted">${esc(u.lrn || u.username)}</span></td><td>${ROLE[u.role]}</td><td class="small">${esc(u.role === 'student' ? u.section : u.subjects)}</td>
    <td><span class="pill ${u.status === 'active' ? 'ok' : 'bad'}">${u.status === 'active' ? 'Active' : 'Suspended'}</span></td><td class="small">${u.lastActive ? fmtTime(u.lastActive) : 'Never'}</td>
    <td>${u.id === ST.user.id ? '<span class="small muted">You</span>' : `<div class="row"><button class="btn small" data-act="reset" data-id="${u.id}">Reset password</button><button class="btn small ghost" data-act="edituser" data-id="${u.id}">Edit</button><button class="btn small ghost${u.status === 'active' ? ' danger' : ''}" data-act="suspend" data-id="${u.id}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button></div>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No accounts match.</td></tr>'}</tbody></table>${list.length > 400 ? '<p class="small muted" style="padding:8px">Showing the first 400. Search to narrow the list.</p>' : ''}`;
}
V.sections = function () {
  const c = C(), counts = {}, sy = ST.secSy || c.settings.schoolYear;
  if (ST.adm) ST.adm.users.forEach(u => { if (u.role === 'student' && u.status === 'active') counts[u.sectionId] = (counts[u.sectionId] || 0) + 1; });
  else loadAdm();
  const years = [...new Set([c.settings.schoolYear].concat(c.sections.map(s => s.sy).filter(Boolean)))].sort().reverse();
  const secs = c.sections.filter(s => (s.sy || c.settings.schoolYear) === sy).sort((a, b) => a.label.localeCompare(b.label));
  return `<form class="panel" id="secForm" novalidate><h2>Add a section</h2><div class="fgrid"><label class="field"><span>School year</span><select id="scSy">${years.map(y => opt(y, y, sy)).join('')}</select></label><label class="field"><span>Grade</span><select id="scGrade">${opt('11', 'Grade 11', '11')}${opt('12', 'Grade 12', '')}</select></label>
    <label class="field"><span>Strand</span><select id="scStrand">${c.settings.strands.map(s => opt(s, s, '')).join('')}</select></label>
    <label class="field"><span>Section name</span><input type="text" id="scName" placeholder="e.g. A or Rizal"></label>
    <label class="field"><span>Adviser</span><input type="text" id="scAdv" placeholder="e.g. Ms. Liza Garcia"></label></div>
    <div class="row"><button class="btn primary" type="submit">Add section</button><span class="err" id="scErr"></span></div>
    <p class="small muted">Each section gets its own class code. Give it to the adviser, who shares it with the class. Students type it when they sign up, or under Account › Join a new section at the start of a school year.</p></form>
    <div class="spread"><h2>Sections for ${esc(sy)}</h2>${years.length > 1 ? `<label class="field" style="max-width:200px"><span>School year</span><select id="secSy">${years.map(y => opt(y, y, sy)).join('')}</select></label>` : ''}</div>
    ${secs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Section</th><th>Adviser</th><th>Class code</th><th class="num">Students</th><th></th></tr></thead><tbody>
    ${secs.map(s => `<tr><td><b>${esc(s.label)}</b></td><td class="small">${esc(s.adviser)}</td><td><span class="mono">${esc(s.code)}</span></td><td class="num">${ST.adm ? counts[s.id] || 0 : '…'}</td>
    <td><div class="row"><button class="btn small" data-act="copy" data-id="${esc(s.code)}">Copy code</button><button class="btn small ghost" data-act="editsec" data-id="${s.id}">Edit</button><button class="btn small ghost" data-act="asknewcode" data-id="${s.id}">New code</button><button class="btn small ghost danger" data-act="askdelsec" data-id="${s.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No sections for this school year yet. Add them above so students can sign up.</div>'}`;
};

/* ---------------- settings ---------------- */
V.settings = function () {
  const s = C().settings, td = s.termDates || {};
  return `<form class="panel" id="setForm" novalidate><h2>School year and terms</h2>
    <div class="fgrid"><label class="field"><span>Current school year</span><input type="text" id="stSy" value="${esc(s.schoolYear)}" placeholder="2026-2027"></label>
    <label class="field"><span>Current term</span><select id="stTerm">${TERM_IDS.map(k => opt(k, TERMS[k], s.currentTerm)).join('')}</select><small>New uploads and quizzes go to this term unless the teacher picks another.</small></label></div>
    <div class="field"><span>Term dates (used for “This term” and term reports)</span><div class="tbl-wrap"><table><thead><tr><th>Term</th><th>Starts</th><th>Ends</th></tr></thead><tbody>${TERM_IDS.map(k => `<tr><td><b>${TERMS[k]}</b></td><td><input type="date" id="td${k}s" value="${esc((td[k] || {}).start || '')}" aria-label="${TERMS[k]} starts"></td><td><input type="date" id="td${k}e" value="${esc((td[k] || {}).end || '')}" aria-label="${TERMS[k]} ends"></td></tr>`).join('')}</tbody></table></div></div>
    <div class="fgrid two"><label class="field"><span>Tracks and strands, one per line</span><textarea id="stStrands" rows="7">${esc((s.strands || []).join('\n'))}</textarea><small>Rename these if your school’s tracks or strands change.</small></label>
    <label class="field"><span>Subjects, one per line</span><textarea id="stSubjects" rows="7">${esc((s.subjects || []).join('\n'))}</textarea><small>Teachers pick from these. They can also type a new one.</small></label></div>
    <div class="row"><button class="btn primary" type="submit">Save settings</button><span class="err" id="stErr"></span></div></form>
    <form class="panel" id="aiForm" novalidate><div class="spread"><h2>AI quiz generator</h2>${s.aiReady ? '<span class="pill ok">Turned on</span>' : '<span class="pill info">Off</span>'}</div>
    <p class="small">Teachers can make draft quizzes from their PDFs, PowerPoints, Word files and pictures. It uses Google’s Gemini AI with a free API key from <b>aistudio.google.com</b> (setup guide, step 8). Only teaching materials are sent, never student information. The free plan may use what’s sent to improve Google’s products.</p>
    <label class="field"><span>Gemini API key</span><input type="password" id="aiKey" autocomplete="off" placeholder="${s.aiReady ? 'A key is saved. Paste a new one to replace it.' : 'Paste the key here'}"><small>Stored privately on the server. It’s never shown again or sent to phones.</small></label>
    <label class="field"><span>AI model</span><input type="text" id="aiModel" list="aiModels" value="${esc(s.aiModel || 'gemini-3.5-flash-lite')}"><datalist id="aiModels"><option value="gemini-3.5-flash-lite"><option value="gemini-3.8-flash"><option value="gemini-3.6-flash"></datalist><small>gemini-3.5-flash-lite allows about 500 quizzes a day on the free plan. gemini-3.8-flash writes better questions but allows about 20 a day.</small></label>
    <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="testai"${s.aiReady ? '' : ' disabled'}>Test it</button>${s.aiReady ? '<button class="btn ghost danger" type="button" data-act="aioff">Turn off</button>' : ''}<span class="err" id="aiErr"></span></div></form>`;
};

/* ---------------- branding ---------------- */
function brandDraft() { if (!ST.bd) ST.bd = JSON.parse(JSON.stringify(ST.branding || { schoolName: schoolName(), appName: 'REVIEW+', theme: { preset: 'green', primary: '#0b6b55', highlight: '#f4c63d', header: 'plain' } })); if (!ST.bd.theme) ST.bd.theme = { preset: 'green', primary: '#0b6b55', highlight: '#f4c63d', header: 'plain' }; return ST.bd; }
V.branding = function () {
  const b = brandDraft(), t = b.theme;
  return `<form class="panel" id="brandForm" novalidate data-dirty="1"><h2>School branding</h2>
    <div class="fgrid two"><label class="field"><span>School name</span><input type="text" id="bName" value="${esc(b.schoolName)}" maxlength="100"></label>
    <label class="field"><span>App name</span><input type="text" id="bApp" value="${esc(b.appName)}" maxlength="30"><small>Shown at the top of every screen and in report titles.</small></label>
    <label class="field"><span>Address or office line (for reports)</span><input type="text" id="bAddr" value="${esc(b.address)}" maxlength="200" placeholder="e.g. Schools Division of …, Region …"></label>
    <label class="field"><span>School head (for report signatures)</span><input type="text" id="bHead" value="${esc(b.schoolHead)}" maxlength="80"></label>
    <label class="field"><span>Position</span><input type="text" id="bHeadPos" value="${esc(b.schoolHeadPosition || 'School Principal')}" maxlength="80"></label></div>
    <div class="field"><span>School logo</span><div class="row">${b.logo ? `<img class="logo-preview" src="${esc(b.logo)}" alt="Current logo">` : '<div class="logo-preview" style="display:grid;place-items:center;color:var(--muted)">No logo</div>'}
    <div class="field"><label class="btn" for="bLogo" style="cursor:pointer">${b.logo ? 'Change logo' : 'Upload logo'}</label><input type="file" id="bLogo" accept="image/png,image/jpeg,image/webp" style="position:absolute;opacity:0;width:1px;height:1px">${b.logo ? '<button type="button" class="btn ghost small danger" data-act="nologo">Remove logo</button>' : ''}<small>A square PNG with a clear background works best. It’s resized automatically.</small></div></div></div>
    <div class="field"><span>Color theme</span><div class="swatches">${Object.keys(PRESETS).map(k => `<button type="button" class="swatch" aria-pressed="${t.preset === k}" data-act="preset" data-id="${k}"><i style="background:${PRESETS[k][1]}"></i><i style="background:${PRESETS[k][2]}"></i>${PRESETS[k][0]}</button>`).join('')}<span class="swatch" aria-pressed="${t.preset === 'custom'}">Custom:</span></div></div>
    <div class="row"><label class="field" style="width:auto"><span>Main color</span><input type="color" id="bPrimary" value="${esc(t.primary)}"></label><label class="field" style="width:auto"><span>Highlight color</span><input type="color" id="bHi" value="${esc(t.highlight)}"></label>
    <div class="field"><span>Top bar</span><div class="checks"><label class="check"><input type="radio" name="bHeader" value="plain"${t.header !== 'color' ? ' checked' : ''}> Plain</label><label class="check"><input type="radio" name="bHeader" value="color"${t.header === 'color' ? ' checked' : ''}> School color</label></div></div></div>
    <p class="small muted">Changes preview right away on this screen. Text colors are adjusted automatically so everything stays readable in light and dark mode.</p>
    <div class="row"><button class="btn primary" type="submit">Save branding for everyone</button><button type="button" class="btn ghost" data-act="brandreset">Undo changes</button><span class="err" id="bErr"></span></div></form>
    <article class="panel"><h2>App icon on phones</h2><p class="small">Phones show the icon from the app’s files on GitHub. To use your logo there, download the icon set, unzip it, and upload the files into the <b>icons</b> folder of your GitHub repository (setup guide, “Using your logo as the app icon”).</p><div><button class="btn" data-act="icons">Download app icons (.zip)</button></div></article>`;
};
function readBrand() {
  const b = brandDraft();
  if (!$('#bName')) return b;
  b.schoolName = $('#bName').value; b.appName = $('#bApp').value; b.address = $('#bAddr').value; b.schoolHead = $('#bHead').value; b.schoolHeadPosition = $('#bHeadPos').value;
  const p = $('#bPrimary').value, h = $('#bHi').value;
  if (p !== b.theme.primary || h !== b.theme.highlight) b.theme.preset = Object.keys(PRESETS).find(k => PRESETS[k][1] === p && PRESETS[k][2] === h) || 'custom';
  b.theme.primary = p; b.theme.highlight = h;
  const hd = document.querySelector('input[name=bHeader]:checked'); b.theme.header = hd ? hd.value : 'plain';
  return b;
}
function previewBrand() { const b = readBrand(); ST.colored = b.theme.header === 'color'; applyTheme(b.theme); renderTop(); }
function loadImage(file) { return new Promise((res, rej) => { const u = URL.createObjectURL(file), img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new UserErr('That picture couldn’t be opened. Try a PNG or JPG.')); img.src = u; }); }
async function shrinkLogo(file) {
  const img = await loadImage(file);
  for (const [size, type, q] of [[256, 'image/png'], [256, 'image/webp', 0.9], [192, 'image/png'], [192, 'image/webp', 0.85], [160, 'image/jpeg', 0.85], [128, 'image/jpeg', 0.8]]) {
    const k = Math.min(1, size / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    g.drawImage(img, 0, 0, w, h);
    const url = cv.toDataURL(type, q);
    if (url.startsWith('data:' + type) && url.length <= 46000) return url;
  }
  throw new UserErr('That logo is too detailed to store. Try a simpler or smaller picture.');
}
async function makeIcons() {
  const b = readBrand();
  let img = null;
  if (b.logo) img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = b.logo; });
  const pal = palette(b.theme);
  const draw = (size, maskable) => {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    if (img) {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
      const box = size * (maskable ? 0.62 : 0.84), k = Math.min(box / img.width, box / img.height), w = img.width * k, h = img.height * k;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    } else {
      g.fillStyle = pal.L.accent; g.fillRect(0, 0, size, size);
      g.fillStyle = pal.L['accent-ink']; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 ' + Math.round(size * (maskable ? 0.3 : 0.4)) + 'px system-ui, sans-serif';
      g.fillText(initials(b.schoolName), size / 2, size / 2 + size * 0.02);
    }
    return new Promise(res => cv.toBlob(bl => bl.arrayBuffer().then(ab => res(new Uint8Array(ab))), 'image/png'));
  };
  const files = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true], ['favicon-32.png', 32, false]];
  const out = [];
  for (const [name, size, mask] of files) out.push({ name: name, data: await draw(size, mask) });
  saveBlob(makeZip(out), 'app-icons.zip');
  toast('Downloaded app-icons.zip. Upload its files to the icons folder on GitHub.');
}

/* ---------------- activity and backups ---------------- */
V.activity = function () {
  if (!ST.adm) return admWait();
  const cats = ['All', 'Security', 'Accounts', 'Uploads', 'Quizzes', 'System'];
  const list = ST.adm.log.filter(l => ST.logCat === 'All' || l.category === ST.logCat);
  return `<div class="spread"><div class="row">${cats.map(c => `<button class="btn small${ST.logCat === c ? ' on' : ''}" data-act="logcat" data-id="${c}">${c}</button>`).join('')}</div><button class="btn small" data-act="reloadadm">Refresh</button></div>
    <article class="panel"><ul class="log">${list.map(l => `<li><span class="dot${l.warn ? ' warn' : ''}"></span><div><p>${esc(l.text)}</p><p class="small muted">${fmtTime(l.time)} · ${esc(l.category)}</p></div></li>`).join('') || '<li><span></span><p class="muted">Nothing here yet.</p></li>'}</ul></article>`;
};
V.backups = function () {
  if (!ST.adm) return admWait();
  return `<article class="panel"><div class="spread"><h2>Backups</h2><button class="btn primary small" data-act="backup">Back up now</button></div>
    <p class="small">Accounts, quizzes, answer keys, scores and reports data are copied <b>every night at 11:00 PM</b> to the <b>Review Hub › Backups</b> folder in Google Drive. The last 30 are kept. Uploaded files are already in Google Drive.</p>
    ${ST.adm.backups.length ? `<div class="tbl-wrap"><table><thead><tr><th>Backup</th><th>Made</th><th></th></tr></thead><tbody>${ST.adm.backups.map(b => `<tr><td>${esc(b.name)}</td><td class="small">${fmtTime(b.created)}</td><td><a class="btn small" href="${esc(b.url)}" target="_blank" rel="noopener">Open in Drive ↗</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No backups yet. The first one runs tonight, or tap “Back up now”.</p>'}
    <p class="small muted">To restore, open a backup, copy the rows you need from its tabs, and paste them into the same tabs of the main Review Hub Sheet. The setup guide explains this.</p></article>`;
};

async function admUser(action, data, msg) { try { await api(action, data); toast(msg); await loadAdm(true); } catch (e) { toast(e.message); } }
Object.assign(A, {
  reloadadm: () => loadAdm(true),
  approve: id => admUser('approve', { id: id }, 'Approved. They can sign in now.'),
  reject: id => admUser('reject', { id: id }, 'Sign-up rejected.'),
  suspend: id => { const u = ST.adm.users.find(x => x.id === id); admUser('setStatus', { id: id, status: u.status === 'active' ? 'suspended' : 'active' }, u.status === 'active' ? u.name + ' is suspended.' : u.name + ' can sign in again.'); },
  reset: async id => {
    const u = ST.adm.users.find(x => x.id === id);
    try { const r = await api('resetPassword', { id: id }); openModal(`<div><p class="label">Password reset</p><h2>${esc(u.name)}</h2></div><p>Give this temporary password to ${esc(u.name.split(' ')[0])} in person or through their adviser. They’ll choose a new one when they sign in, and any phone still signed in to this account is signed out.</p><div class="row"><span class="kbd">${esc(r.tempPassword)}</span><button class="btn" data-act="copy" data-id="${esc(r.tempPassword)}">Copy</button></div><div><button class="btn primary" data-act="close">Done</button></div>`); loadAdm(true); } catch (e) { toast(e.message); }
  },
  edituser: id => {
    const u = ST.adm.users.find(x => x.id === id);
    if (u.role === 'student') {
      const secs = C().sections.slice().sort((a, b) => String(b.sy).localeCompare(String(a.sy)) || a.label.localeCompare(b.label));
      openModal(`<form id="euForm" class="field" style="gap:12px" data-id="${id}" novalidate><h2>Edit student</h2><label class="field"><span>Full name</span><input type="text" id="euName" value="${esc(u.name)}"></label><label class="field"><span>LRN</span><input type="text" id="euLrn" inputmode="numeric" value="${esc(u.lrn)}"></label><label class="field"><span>Section</span><select id="euSec">${secs.map(s => opt(s.id, s.label + ' (' + (s.sy || '') + ')', u.sectionId)).join('')}</select></label><div class="row"><button class="btn primary" type="submit">Save</button><span class="err" id="euErr"></span></div></form>`);
    } else openModal(`<form id="esForm" class="field" style="gap:12px" data-id="${id}" novalidate><h2>Edit ${esc(u.name)}</h2><label class="field"><span>Full name</span><input type="text" id="esName" value="${esc(u.name)}"></label><label class="field"><span>Subjects, separated by commas</span><input type="text" id="esSubj" value="${esc(u.subjects)}"></label><div class="row"><button class="btn primary" type="submit">Save</button><span class="err" id="esErr"></span></div></form>`);
  },
  editsec: id => { const s = secById(id); openModal(`<form id="esecForm" class="field" style="gap:12px" data-id="${id}" novalidate><h2>Edit ${esc(s.label)}</h2><div class="fgrid two"><label class="field"><span>Grade</span><select id="eGrade">${opt('11', 'Grade 11', s.grade)}${opt('12', 'Grade 12', s.grade)}</select></label><label class="field"><span>Strand</span><select id="eStrand">${C().settings.strands.map(x => opt(x, x, s.strand)).join('')}</select></label><label class="field"><span>Section name</span><input type="text" id="eName" value="${esc(s.name)}"></label><label class="field"><span>Adviser</span><input type="text" id="eAdv" value="${esc(s.adviser)}"></label><label class="field"><span>School year</span><input type="text" id="eSy" value="${esc(s.sy)}"></label></div><div class="row"><button class="btn primary" type="submit">Save</button><span class="err" id="eErr"></span></div></form>`); },
  asknewcode: id => openModal(`<h2>Make a new code for ${esc(secLabel(id))}?</h2><p>The current code stops working right away. Students already approved aren’t affected.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="newcode" data-id="${id}">Make new code</button></div>`),
  newcode: async id => { try { const r = await api('newCode', { id: id }); closeModal(); await refresh(true); render(); toast('New code: ' + r.code); } catch (e) { toast(e.message); } },
  askdelsec: id => openModal(`<h2>Delete ${esc(secLabel(id))}?</h2><p>You can only delete a section with no students in it.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="delsec" data-id="${id}">Delete</button></div>`),
  delsec: async id => { try { await api('deleteSection', { id: id }); closeModal(); await refresh(true); render(); toast('Section deleted.'); } catch (e) { closeModal(); toast(e.message); } },
  logcat: id => { ST.logCat = id; render(); },
  backup: async () => { toast('Backing up…'); try { const r = await api('backupNow', {}); ST.adm.backups = r.backups; render(); toast('Backup saved to Google Drive.'); } catch (e) { toast(e.message); } },
  testai: async () => { $('#aiErr').textContent = 'Testing…'; try { const r = await api('testAi', {}, { timeout: 90000 }); $('#aiErr').textContent = ''; toast(r.message); } catch (e) { $('#aiErr').textContent = e.message; } },
  aioff: async () => { try { const r = await api('saveAi', { key: '' }); C().settings.aiReady = r.aiReady; render(); toast('The AI quiz generator is off.'); } catch (e) { toast(e.message); } },
  preset: k => { const b = readBrand(); b.theme.preset = k; b.theme.primary = PRESETS[k][1]; b.theme.highlight = PRESETS[k][2]; keepVals(render); $('#bPrimary').value = b.theme.primary; $('#bHi').value = b.theme.highlight; previewBrand(); },
  nologo: () => { const b = readBrand(); b.logo = ''; keepVals(render); },
  brandreset: () => { ST.bd = null; applyTheme((ST.branding || {}).theme); render(); },
  icons: () => makeIcons().catch(e => toast(e.message))
});
