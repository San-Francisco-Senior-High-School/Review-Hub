/* REVIEW+ teacher tools: bulk upload, managing and releasing materials, quizzes, checking answers, results. */
'use strict';

/* ================= bulk upload ================= */
function upState() {
  if (!ST.up) {
    const s = C().settings;
    ST.up = { sy: s.schoolYear, grade: '11', strands: null, sections: null, subject: '', term: s.currentTerm, topic: '', release: 'draft', at: '', allowOffline: true, desc: '', rows: [], busy: false };
  }
  return ST.up;
}
const titleFromFile = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
V.upload = function () {
  const u = upState(), c = C();
  if (!navigator.onLine) return '<div class="empty">Uploading needs internet. Connect and try again.</div>';
  const gradeStrands = c.settings.strands.filter(st => c.sections.some(s => String(s.grade) === u.grade && s.strand === st && (!s.sy || s.sy === u.sy)));
  const strands = u.strands ? u.strands.filter(s => gradeStrands.includes(s)) : gradeStrands;
  const done = u.rows.filter(r => r.state === 'done').length, failed = u.rows.filter(r => r.state === 'error').length;
  const rows = u.rows.map((r, i) => `<tr${r.state === 'done' ? ' class="picked"' : ''}><td>${typeTag({ type: r.kind === 'link' ? 'link' : r.type }, true)}</td>
    <td style="min-width:200px"><input type="text" data-row="${i}" data-rf="title" value="${esc(r.title)}" aria-label="Title"${r.state === 'done' ? ' disabled' : ''}><span class="small muted">${r.kind === 'link' ? esc(r.url) : esc(r.file.name) + ' · ' + fmtSize(r.file.size)}</span></td>
    <td style="min-width:150px"><input type="text" data-row="${i}" data-rf="topic" list="topicList" value="${esc(r.topic)}" placeholder="${esc(u.topic || 'Topic')}" aria-label="Topic"${r.state === 'done' ? ' disabled' : ''}></td>
    <td style="min-width:110px"><select data-row="${i}" data-rf="term" aria-label="Term"${r.state === 'done' ? ' disabled' : ''}>${TERM_IDS.map(k => opt(k, TERMS[k], r.term || u.term)).join('')}</select></td>
    <td class="small">${r.state === 'done' ? '<span class="pill ok">Uploaded</span>' : r.state === 'uploading' ? '<span class="spinner"></span> Uploading' : r.state === 'error' ? `<span class="err">${esc(r.msg)}</span>` : r.tooBig ? `<span class="err">Over ${MAX_MB} MB</span>` : '<span class="muted">Ready</span>'}</td>
    <td>${r.state !== 'done' && !u.busy ? `<button type="button" class="btn small ghost" data-act="uprm" data-id="${i}" aria-label="Remove">✕</button>` : ''}</td></tr>`).join('');
  return `<form class="panel" id="upForm" novalidate>
    <div class="spread"><div><h2>Upload learning materials</h2><p class="small muted">Add one file or a whole term’s worth at once. New uploads stay <b>locked as drafts</b> unless you choose otherwise, so students can’t see them until you publish.</p></div></div>
    <h3>1. Where they belong</h3>
    <div class="fgrid"><label class="field"><span>School year</span><select id="upSy">${schoolYears().map(y => opt(y, y, u.sy)).join('')}</select></label>
    <label class="field"><span>Grade level</span><select id="upGrade">${opt('11', 'Grade 11', u.grade)}${opt('12', 'Grade 12', u.grade)}</select></label>
    <label class="field"><span>Subject</span><input type="text" id="upSubject" list="subjList" maxlength="80" value="${esc(u.subject)}" placeholder="Choose or type"><datalist id="subjList">${teacherSubjects().map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
    <label class="field"><span>Term</span><select id="upTerm">${TERM_IDS.map(k => opt(k, TERMS[k], u.term)).join('')}</select><small>You can change it for each file below.</small></label>
    <label class="field"><span>Topic</span><input type="text" id="upTopic" list="topicList" maxlength="80" value="${esc(u.topic)}" placeholder="e.g. Functions"><datalist id="topicList">${[...new Set(c.materials.map(m => m.topic))].map(t => `<option value="${esc(t)}">`).join('')}</datalist><small>Used for any file whose topic you leave empty.</small></label></div>
    <div class="field"><span>Strands</span><div class="checks">${gradeStrands.map(s => `<label class="check"><input type="checkbox" class="upStrand" value="${esc(s)}"${strands.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('') || '<span class="small muted">No sections for this grade and school year yet.</span>'}</div></div>
    <div class="field"><span>Sections that can see them</span><div class="checks" id="upSecs">${sectionChecks(u.grade, strands, u.sections, 'upSec', u.sy)}</div></div>
    <h3>2. Files and links</h3>
    <div class="row"><label class="btn primary" for="upFiles" style="cursor:pointer">Add files</label><input type="file" id="upFiles" multiple style="position:absolute;opacity:0;width:1px;height:1px"><button type="button" class="btn" data-act="uplink">Add a web link</button><span class="small muted">PDF, PowerPoint, Word, pictures, audio and video, up to ${MAX_MB} MB each.</span></div>
    ${u.rows.length ? `<div class="tbl-wrap"><table><thead><tr><th></th><th>Title</th><th>Topic</th><th>Term</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No files yet. Tap “Add files” and choose one or many.</div>'}
    <h3>3. Release</h3>
    <div class="checks"><label class="check"><input type="radio" name="uprel" value="draft"${u.release === 'draft' ? ' checked' : ''}> Keep locked as draft (recommended)</label><label class="check"><input type="radio" name="uprel" value="publish"${u.release === 'publish' ? ' checked' : ''}> Publish right away</label><label class="check"><input type="radio" name="uprel" value="schedule"${u.release === 'schedule' ? ' checked' : ''}> Schedule</label></div>
    ${u.release === 'schedule' ? `<label class="field" style="max-width:280px"><span>Publish on</span><input type="datetime-local" id="upAt" value="${esc(u.at || localInput())}"></label>` : ''}
    <div class="fgrid two"><label class="field"><span>Note for students (optional, for all files)</span><textarea id="upDesc" maxlength="600" placeholder="What to focus on, which pages to read first…">${esc(u.desc)}</textarea></label></div>
    <label class="check" style="align-self:flex-start"><input type="checkbox" id="upOffline"${u.allowOffline ? ' checked' : ''}> Students can download and save these offline</label>
    <div class="row"><button class="btn primary" type="submit" id="upBtn"${u.busy || !u.rows.some(r => r.state !== 'done') ? ' disabled' : ''}>${u.busy ? 'Uploading… keep this page open' : failed ? 'Retry failed uploads' : 'Upload ' + plural(u.rows.filter(r => r.state !== 'done').length, 'item')}</button>
    ${done ? `<button type="button" class="btn" data-act="gotab" data-id="manage">See them in My materials</button><button type="button" class="btn ghost" data-act="upclear">Start a new batch</button>` : ''}<span class="err" id="upErr" role="alert"></span></div></form>`;
};
function upRead() {
  const u = upState();
  const v = id => ($('#' + id) || {}).value;
  if ($('#upSy')) { u.sy = v('upSy'); u.grade = v('upGrade'); u.subject = v('upSubject') || ''; u.term = v('upTerm'); u.topic = v('upTopic') || ''; u.desc = v('upDesc') || ''; u.allowOffline = $('#upOffline').checked; if ($('#upAt')) u.at = v('upAt'); }
  if ($('#upSecs')) u.sections = $$('.upSec:checked').map(i => i.value);
}
function addFiles(list) {
  const u = upState(), kind = n => { const e = (n.split('.').pop() || '').toLowerCase(); return e === 'pdf' ? 'pdf' : /pptx?|odp|key/.test(e) ? 'slides' : /docx?|odt|rtf|txt/.test(e) ? 'doc' : /xlsx?|ods|csv/.test(e) ? 'sheet' : /png|jpe?g|gif|webp|heic/.test(e) ? 'image' : /mp3|m4a|wav|ogg|aac/.test(e) ? 'audio' : /mp4|mov|webm|3gp|mkv/.test(e) ? 'video' : 'file'; };
  Array.from(list).forEach(f => u.rows.push({ kind: 'file', file: f, type: kind(f.name), title: titleFromFile(f.name), topic: '', term: '', state: 'ready', tooBig: f.size > MAX_MB * 1048576 }));
}
async function doUpload(e) {
  e.preventDefault();
  upRead();
  const u = upState();
  const sections = u.sections || [];
  const todo = u.rows.filter(r => r.state !== 'done' && !r.tooBig);
  const err = !u.subject.trim() ? 'Choose a subject.' : !sections.length ? 'Choose at least one section.' : !todo.length ? 'Add at least one file under 25 MB, or a web link.' : todo.some(r => !r.title.trim()) ? 'Every item needs a title.' : u.release === 'schedule' && !(u.at && new Date(u.at).getTime() > Date.now()) ? 'Choose a publish date and time in the future.' : '';
  if (err) { $('#upErr').textContent = err; return; }
  u.busy = true; keepVals(render);
  let ok = 0;
  for (const r of todo) {
    r.state = 'uploading'; r.msg = ''; keepVals(render);
    try {
      const data = { title: r.title, subject: u.subject, topic: r.topic || u.topic || r.title, term: r.term || u.term, sy: u.sy, desc: u.desc, grade: u.grade, sections: sections, allowOffline: u.allowOffline, kind: r.kind, release: u.release, publishAt: u.release === 'schedule' ? new Date(u.at).toISOString() : '' };
      if (r.kind === 'link') data.url = r.url;
      else { data.fileName = r.file.name; data.mime = r.file.type || 'application/octet-stream'; data.b64 = await fileToB64(r.file); }
      const res = await api('upload', data, { timeout: 300000 });
      C().materials.unshift(res.material); r.state = 'done'; r.id = res.material.id; ok++;
    } catch (ex) { r.state = 'error'; r.msg = ex.message; }
  }
  u.busy = false;
  await KV.set('catalog', ST.cat);
  ST.stats = null;
  keepVals(render);
  const failed = todo.length - ok;
  toast(ok ? plural(ok, 'item') + ' uploaded' + (u.release === 'draft' ? ' as locked drafts. Publish them under My materials when ready.' : u.release === 'schedule' ? ' and scheduled.' : ' and published.') + (failed ? ' ' + failed + ' failed.' : '') : 'Nothing was uploaded. Check the messages in the list.');
}

/* ================= managing materials ================= */
function manageList() {
  const f = ST.mf, terms = norm(f.q).split(' ').filter(Boolean);
  return C().materials.filter(m => {
    if (!isMine(m)) return false;
    if (f.status === 'active' ? m.status === 'archived' : f.status !== 'all' && m.status !== f.status) return false;
    if (f.sy !== 'all' && m.sy !== f.sy) return false;
    if (f.grade !== 'all' && String(m.grade) !== f.grade) return false;
    if (f.strand !== 'all' && !m.sections.some(s => (secById(s) || {}).strand === f.strand)) return false;
    if (f.subject !== 'all' && m.subject !== f.subject) return false;
    if (f.term !== 'all' && m.term !== f.term) return false;
    if (f.topic && norm(m.topic) !== norm(f.topic)) return false;
    if (f.teacher !== 'all' && m.teacherId !== f.teacher) return false;
    if (terms.length) { const hay = norm([m.title, m.topic, m.keywords, m.subject, m.fileName].join(' ')); if (!terms.every(t => hay.includes(t))) return false; }
    return true;
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
async function loadStats(force) {
  if (ST.loading.stats || (!force && ST.stats) || !navigator.onLine) return;
  ST.loading.stats = true;
  try { ST.stats = (await api('materialStats', {})).stats; } catch (e) { ST.stats = ST.stats || {}; }
  finally { ST.loading.stats = false; if (ST.tab === 'manage' && !isBusy()) keepVals(render); }
}
V.manage = function () {
  const f = ST.mf, c = C(), mine = c.materials.filter(isMine);
  if (!ST.stats) loadStats();
  const list = manageList();
  const sel = [...ST.sel].filter(id => list.some(m => m.id === id));
  const teachers = [...new Map(mine.map(m => [m.teacherId, m.teacherName])).entries()];
  const counts = {}; Object.keys(STATUS).forEach(k => counts[k] = mine.filter(m => m.status === k).length);
  const stat = id => (ST.stats || {})[id] || { views: 0, downloads: 0, downloaders: 0 };
  return `<div class="tiles">${['draft', 'scheduled', 'published', 'unpublished', 'archived'].map(k => `<button class="tile linkish" data-act="mstatus" data-id="${k}" style="cursor:pointer"><b>${counts[k]}</b><span>${STATUS[k][0]}</span></button>`).join('')}</div>
    <div class="searchbox"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" id="mq" placeholder="Search title, topic or file name" value="${esc(f.q)}" aria-label="Search your materials"></div>
    <div class="fgrid">
      <label class="field"><span>Status</span><select id="mstatus">${opt('active', 'All except archived', f.status)}${opt('all', 'Everything', f.status)}${Object.keys(STATUS).map(k => opt(k, STATUS[k][0], f.status)).join('')}</select></label>
      <label class="field"><span>School year</span><select id="msy">${opt('all', 'All years', f.sy)}${schoolYears().map(y => opt(y, y, f.sy)).join('')}</select></label>
      <label class="field"><span>Grade</span><select id="mgrade">${opt('all', 'All grades', f.grade)}${opt('11', 'Grade 11', f.grade)}${opt('12', 'Grade 12', f.grade)}</select></label>
      <label class="field"><span>Strand</span><select id="mstrand">${opt('all', 'All strands', f.strand)}${c.settings.strands.map(s => opt(s, s, f.strand)).join('')}</select></label>
      <label class="field"><span>Subject</span><select id="msubject">${opt('all', 'All subjects', f.subject)}${[...new Set(mine.map(m => m.subject))].sort().map(s => opt(s, s, f.subject)).join('')}</select></label>
      <label class="field"><span>Term</span><select id="mterm">${opt('all', 'All terms', f.term)}${TERM_IDS.map(k => opt(k, TERMS[k], f.term)).join('')}</select></label>
      <label class="field"><span>Topic</span><select id="mtopic">${opt('', 'All topics', f.topic)}${[...new Set(mine.map(m => m.topic))].sort().map(t => opt(t, t, f.topic)).join('')}</select></label>
      ${isAdmin() ? `<label class="field"><span>Teacher</span><select id="mteacher">${opt('all', 'All teachers', f.teacher)}${teachers.map(([id, n]) => opt(id, n, f.teacher)).join('')}</select></label>` : ''}
    </div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th class="sel"><input type="checkbox" id="mall" aria-label="Select all shown"${sel.length && sel.length === list.length ? ' checked' : ''}></th><th>Material</th><th>Filed under</th><th>Status</th><th class="num">Views</th><th class="num">Downloads</th><th></th></tr></thead><tbody>
    ${list.map(m => { const s = stat(m.id); return `<tr${ST.sel.has(m.id) ? ' class="picked"' : ''}><td class="sel"><input type="checkbox" class="msel" value="${m.id}"${ST.sel.has(m.id) ? ' checked' : ''} aria-label="Select ${esc(m.title)}"></td>
      <td><b>${esc(m.title)}</b><br><span class="small muted">${(TYPES[m.type] || TYPES.file)[1]}${m.size ? ' · ' + fmtSize(m.size) : ''} · ${fmtDate(m.date)}${isAdmin() ? ' · ' + esc(m.teacherName) : ''}</span></td>
      <td class="small">${esc(m.sy)} · Grade ${esc(m.grade)} · ${termName(m.term)}<br><span class="muted">${esc(m.subject)} › ${esc(m.topic)}</span><br><span class="muted">${esc(aud(m.sections))}</span></td>
      <td>${statusPill(m.status, m.publishAt)}</td><td class="num">${s.views}</td><td class="num">${s.downloads}<br><span class="small muted">${plural(s.downloaders, 'student')}</span></td>
      <td><div class="row"><button class="btn small" data-act="preview" data-id="${m.id}">Preview</button><button class="btn small ghost" data-act="mmore" data-id="${m.id}">More…</button></div></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${mine.length ? 'No materials match these filters.' : 'You haven’t uploaded anything yet. Use the Upload tab.'}</div>`}
    ${sel.length ? `<div class="sticky-bar"><div class="spread"><b>${plural(sel.length, 'material')} selected</b><div class="row"><button class="btn small primary" data-act="bulk" data-id="publish">Publish now</button><button class="btn small" data-act="bulk" data-id="schedule">Schedule…</button><button class="btn small" data-act="bulk" data-id="unpublish">Unpublish</button><button class="btn small" data-act="bulk" data-id="lock">Lock as draft</button><button class="btn small" data-act="bulk" data-id="archive">Archive</button><button class="btn small" data-act="bulkclear">Clear</button></div></div></div>` : ''}
    <p class="small muted">Views and downloads count students only. Download counts include saving for offline use.</p>`;
};
async function setStatus(ids, action, at) {
  try {
    const r = await api('setMaterialStatus', { ids: ids, op: action, publishAt: at || '' });
    r.materials.forEach(m => { const i = C().materials.findIndex(x => x.id === m.id); if (i >= 0) C().materials[i] = m; });
    await KV.set('catalog', ST.cat);
    ST.sel = new Set(); closeModal(); render();
    const n = r.materials.length;
    toast((n === 1 ? '“' + r.materials[0].title + '”' : n + ' materials') + ' ' + ({ publish: 'published. Students can see ' + (n === 1 ? 'it' : 'them') + ' now.', schedule: 'scheduled for ' + fmtTime(at) + '.', unpublish: 'unpublished. Students can’t open ' + (n === 1 ? 'it' : 'them') + ' anymore.', lock: 'locked as draft.', archive: 'archived.', restore: 'restored as a locked draft.' })[action]);
  } catch (e) { toast(e.message); }
}
function scheduleForm(ids) {
  openModal(`<form id="schedForm" class="field" style="gap:12px" data-ids="${esc(ids.join(','))}" novalidate><h2>Schedule ${ids.length === 1 ? 'this material' : plural(ids.length, 'material')}</h2><p class="small">${ids.length === 1 ? 'It stays' : 'They stay'} locked until the time you choose, then students can see ${ids.length === 1 ? 'it' : 'them'} automatically.</p>
    <label class="field" style="max-width:300px"><span>Publish on</span><input type="datetime-local" id="schedAt" value="${esc(localInput())}"></label><div class="row"><button class="btn primary" type="submit">Schedule</button><span class="err" id="schedErr"></span></div></form>`);
}
function moreMenu(id) {
  const m = matById(id);
  const st = m.status;
  openModal(`<div><p class="label">${esc(m.subject)} · ${termName(m.term)}</p><h2>${esc(m.title)}</h2><p class="small">${statusPill(st, m.publishAt)}${m.publishedAt && st === 'published' ? ' since ' + esc(fmtDate(m.publishedAt)) : ''}</p></div>
    <div class="field"><span>Release</span><div class="row">${st !== 'published' ? `<button class="btn primary" data-act="mact" data-id="publish:${id}">Publish now</button><button class="btn" data-act="msched" data-id="${id}">Schedule…</button>` : `<button class="btn" data-act="mact" data-id="unpublish:${id}">Unpublish</button>`}
    ${st !== 'draft' && st !== 'archived' ? `<button class="btn" data-act="mact" data-id="lock:${id}">Lock as draft</button>` : ''}${st !== 'archived' ? `<button class="btn" data-act="mact" data-id="archive:${id}">Archive</button>` : `<button class="btn" data-act="mact" data-id="restore:${id}">Restore</button>`}</div></div>
    <div class="field"><span>Change</span><div class="row"><button class="btn" data-act="preview" data-id="${id}">Preview</button><button class="btn" data-act="editmat" data-id="${id}">Edit details</button>${m.type !== 'link' ? `<button class="btn" data-act="replacefile" data-id="${id}">Replace file</button>` : ''}</div></div>
    <div class="field"><span>Quiz</span><div class="row">${aiReadable(m) ? `<button class="btn" data-act="gen" data-id="${id}">Make a quiz with AI</button>` : ''}<button class="btn" data-act="newquiz" data-id="${id}">Write a quiz</button></div></div>
    <div class="row" style="border-top:1px solid var(--line);padding-top:12px"><button class="btn danger" data-act="askdelmat" data-id="${id}">Delete…</button></div>`);
}
function editMat(id) {
  const m = matById(id);
  openModal(`<form id="emForm" class="field" style="gap:12px" novalidate data-id="${id}"><h2>Edit details</h2>
    <label class="field"><span>Title</span><input type="text" id="emTitle" value="${esc(m.title)}" maxlength="120"></label>
    <div class="fgrid two"><label class="field"><span>Subject</span><input type="text" id="emSubject" list="subjList2" value="${esc(m.subject)}"><datalist id="subjList2">${teacherSubjects().map(s => `<option value="${esc(s)}">`).join('')}</datalist></label><label class="field"><span>Topic</span><input type="text" id="emTopic" value="${esc(m.topic)}"></label>
    <label class="field"><span>Term</span><select id="emTerm">${TERM_IDS.map(k => opt(k, TERMS[k], m.term)).join('')}</select></label><label class="field"><span>School year</span><select id="emSy">${schoolYears().map(y => opt(y, y, m.sy)).join('')}</select></label></div>
    ${m.type === 'link' ? `<label class="field"><span>Web address</span><input type="url" id="emUrl" value="${esc(m.url)}"></label>` : ''}
    <label class="field"><span>Search keywords</span><input type="text" id="emKeywords" value="${esc(m.keywords)}"></label>
    <label class="field"><span>Note for students</span><textarea id="emDesc">${esc(m.desc)}</textarea></label>
    <div class="field"><span>Sections that can see it</span><div class="checks">${sectionChecks(m.grade, null, m.sections, 'emSec', m.sy)}</div></div>
    <label class="check" style="align-self:flex-start"><input type="checkbox" id="emOffline"${m.allowOffline ? ' checked' : ''}> Students can download and save it offline</label>
    <div class="row"><button class="btn primary" type="submit">Save changes</button><span class="err" id="emErr"></span></div></form>`);
}
async function saveMat(e) {
  e.preventDefault();
  const id = e.target.dataset.id;
  try {
    const fields = { title: $('#emTitle').value, subject: $('#emSubject').value, topic: $('#emTopic').value, term: $('#emTerm').value, sy: $('#emSy').value, keywords: $('#emKeywords').value, desc: $('#emDesc').value, sections: $$('.emSec:checked').map(i => i.value), allowOffline: $('#emOffline').checked };
    if ($('#emUrl')) fields.url = $('#emUrl').value;
    const r = await api('updateMaterial', { id: id, fields: fields });
    replaceMat(r.material); closeModal(); render(); toast('Changes saved.');
  } catch (ex) { $('#emErr').textContent = ex.message; }
}
function replaceMat(m) { const i = C().materials.findIndex(x => x.id === m.id); if (i >= 0) C().materials[i] = m; KV.set('catalog', ST.cat); }
async function doReplace(e) {
  e.preventDefault();
  const id = e.target.dataset.id, f = ($('#rfFile').files || [])[0];
  if (!f) { $('#rfErr').textContent = 'Choose the new file.'; return; }
  if (f.size > MAX_MB * 1048576) { $('#rfErr').textContent = 'That file is over ' + MAX_MB + ' MB.'; return; }
  $('#rfErr').textContent = 'Uploading…';
  try { const r = await api('replaceFile', { id: id, fileName: f.name, mime: f.type || 'application/octet-stream', b64: await fileToB64(f) }, { timeout: 300000 }); replaceMat(r.material); closeModal(); render(); toast('File replaced. Its status didn’t change.'); }
  catch (ex) { $('#rfErr').textContent = ex.message; }
}

/* ================= quizzes ================= */
V.quizzes = function () {
  const f = ST.qf;
  const mine = C().quizzes.filter(isMine);
  const terms = norm(f.q).split(' ').filter(Boolean);
  const list = mine.filter(q => (f.status === 'active' ? q.status !== 'archived' : f.status === 'all' || q.status === f.status) && (f.term === 'all' || q.term === f.term) && (f.subject === 'all' || q.subject === f.subject) && (f.kind === 'all' || q.kind === f.kind)
    && (!terms.length || terms.every(t => norm(q.title + ' ' + q.topic + ' ' + q.subject).includes(t)))).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  const review = mine.filter(q => q.aiGenerated && !q.approvedAt && q.status !== 'archived').length;
  return `<div class="spread"><p class="muted small">Quizzes stay locked until you approve and publish them. Objective questions are scored automatically; you check the rest under To check.</p><div class="row"><button class="btn primary" data-act="gen" data-id="">Generate with AI</button><button class="btn" data-act="newquiz" data-id="">Write a quiz</button></div></div>
    ${review ? `<div class="banner warn"><span><b>${plural(review, 'AI draft')} waiting for your review.</b> Students can’t see ${review === 1 ? 'it' : 'them'} until you approve.</span></div>` : ''}
    <div class="fgrid"><label class="field"><span>Search</span><input type="search" id="qq" value="${esc(f.q)}" placeholder="Title or topic"></label>
    <label class="field"><span>Status</span><select id="qstatus">${opt('active', 'All except archived', f.status)}${opt('all', 'Everything', f.status)}${Object.keys(STATUS).map(k => opt(k, STATUS[k][0], f.status)).join('')}</select></label>
    <label class="field"><span>Kind</span><select id="qkind">${opt('all', 'All kinds', f.kind)}${Object.keys(KINDS).map(k => opt(k, KINDS[k], f.kind)).join('')}</select></label>
    <label class="field"><span>Term</span><select id="qterm">${opt('all', 'All terms', f.term)}${TERM_IDS.map(k => opt(k, TERMS[k], f.term)).join('')}</select></label>
    <label class="field"><span>Subject</span><select id="qsubject">${opt('all', 'All subjects', f.subject)}${[...new Set(mine.map(q => q.subject))].sort().map(s => opt(s, s, f.subject)).join('')}</select></label></div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>For</th><th>Questions</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
    ${list.map(q => { const types = [...new Set(q.questions.map(x => x.type))]; const fresh = q.aiGenerated && !q.approvedAt; return `<tr><td><b>${esc(q.title)}</b><br><span class="small muted">${esc(KINDS[q.kind])} · ${esc(q.subject)} › ${esc(q.topic)} · ${termName(q.term)}</span>${q.aiGenerated ? ` <span class="pill hi">${fresh ? 'AI draft, needs review' : 'AI, reviewed'}</span>` : ''}</td>
      <td class="small">${esc(aud(q.sections))}</td><td class="small">${q.questions.length}<br><span class="muted">${types.map(t => QT[t]).join(', ')}</span></td><td>${statusPill(q.status, q.publishAt)}</td><td class="small">${fmtDate(q.updated)}</td>
      <td><div class="row"><button class="btn small${fresh ? ' primary' : ''}" data-act="editquiz" data-id="${q.id}">${fresh ? 'Review' : 'Edit'}</button><button class="btn small ghost" data-act="previewquiz" data-id="${q.id}">Try it</button>
      ${q.status === 'published' ? `<button class="btn small ghost" data-act="qact" data-id="unpublish:${q.id}">Unpublish</button>` : !fresh && q.status !== 'archived' ? `<button class="btn small ghost" data-act="qact" data-id="publish:${q.id}">Publish</button>` : ''}
      ${q.status !== 'archived' ? `<button class="btn small ghost" data-act="qact" data-id="archive:${q.id}">Archive</button>` : `<button class="btn small ghost" data-act="qact" data-id="restore:${q.id}">Restore</button>`}<button class="btn small ghost danger" data-act="askdelquiz" data-id="${q.id}">Delete</button></div></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${mine.length ? 'No quizzes match these filters.' : 'No quizzes yet. Generate one from a PowerPoint or PDF, or write your own.'}</div>`}`;
};
async function quizAction(action, id) {
  try {
    const r = await api('setQuizStatus', { ids: [id], op: action });
    r.quizzes.forEach(q => { const i = C().quizzes.findIndex(x => x.id === q.id); if (i >= 0) C().quizzes[i] = q; });
    await KV.set('catalog', ST.cat); render();
    toast({ publish: 'Published.', unpublish: 'Unpublished. Students can’t take it anymore.', archive: 'Archived.', restore: 'Restored as a locked draft.' }[action] || 'Done.');
  } catch (e) { toast(e.message); }
}

/* ================= checking answers ================= */
async function loadGrading(force) {
  if (ST.loading.grading || (!force && ST.grading) || !navigator.onLine) return;
  ST.loading.grading = true;
  try { ST.grading = (await api('gradingQueue', {})).attempts; C().toCheck = ST.grading.length; } catch (e) { toast(e.message); ST.grading = ST.grading || []; }
  finally { ST.loading.grading = false; if (ST.tab === 'check' && !isBusy()) render(); }
}
V.check = function () {
  if (!navigator.onLine && !ST.grading) return '<div class="empty">Checking answers needs internet.</div>';
  if (!ST.grading) { loadGrading(); return '<p class="muted"><span class="spinner"></span> Loading answers to check…</p>'; }
  if (!ST.grading.length) return '<div class="empty">Nothing to check. Short answers, solutions and essays from your quizzes show up here.</div><div class="row"><button class="btn small" data-act="reloadgrading">Refresh</button></div>';
  return `<div class="spread"><p class="small muted">${plural(ST.grading.length, 'student answer set')} waiting. Objective questions are already scored; give points for the rest.</p><button class="btn small" data-act="reloadgrading">Refresh</button></div>
    ${ST.grading.map(a => `<form class="panel gradeForm" data-id="${a.id}" novalidate><div class="spread"><div><p class="label">${esc(a.subject)} · ${esc(a.quizTitle)}</p><h3>${esc(a.student)} <span class="muted small">${esc(a.section)} · ${fmtTime(a.takenAt)}</span></h3></div><span class="small muted">Scored so far: ${a.score} of ${a.maxScore}</span></div>
      ${a.items.map(it => `<div class="qedit"><div class="row"><span class="qtype">${QT[it.type]}</span><span class="small muted">up to ${plural(it.max, 'point')}</span></div><p><b>${esc(it.q)}</b></p>
        ${it.rubric ? `<p class="small"><b>Rubric:</b> ${esc(it.rubric)}</p>` : ''}${it.model ? `<p class="small"><b>Key points:</b> ${esc(it.model)}</p>` : ''}${(it.final || []).length ? `<p class="small"><b>Accepted final answer:</b> ${esc(it.final.join(' / '))}</p>` : ''}
        <div class="answer-box">${esc(typeof it.response === 'object' && it.response ? (it.response.final ? 'Final answer: ' + it.response.final + '\n' : '') + (it.response.work || '') : it.response || '(no answer)')}</div>
        <div class="fgrid two"><label class="field"><span>Points (0 to ${it.max})</span><input type="number" min="0" max="${it.max}" step="0.5" class="gPts" data-q="${esc(it.id)}"></label><label class="field"><span>Comment for the student (optional)</span><input type="text" class="gCmt" data-q="${esc(it.id)}" maxlength="500"></label></div></div>`).join('')}
      <div class="row"><button class="btn primary" type="submit">Save points</button><span class="err"></span></div></form>`).join('')}`;
};
async function saveGrades(form) {
  const id = form.dataset.id, grades = [];
  let bad = '';
  form.querySelectorAll('.gPts').forEach(i => {
    if (i.value === '') return;
    const v = Number(i.value), max = Number(i.max);
    if (isNaN(v) || v < 0 || v > max) bad = 'Points must be between 0 and ' + max + '.';
    grades.push({ id: i.dataset.q, pts: v, cmt: (form.querySelector('.gCmt[data-q="' + i.dataset.q + '"]') || {}).value || '' });
  });
  const err = form.querySelector('.err');
  if (bad) { err.textContent = bad; return; }
  if (!grades.length) { err.textContent = 'Give points for at least one answer.'; return; }
  try {
    const r = await api('gradeAttempt', { id: id, grades: grades });
    if (r.status === 'complete') ST.grading = ST.grading.filter(a => a.id !== id);
    else { const a = ST.grading.find(x => x.id === id); a.items = a.items.filter(it => !grades.some(g => g.id === it.id)); }
    C().toCheck = ST.grading.length; ST.results = null;
    render(); toast(r.status === 'complete' ? 'Saved. Final score: ' + r.pct + '%.' : 'Saved. Some answers still need points.');
  } catch (e) { err.textContent = e.message; }
}

/* ================= quiz results ================= */
async function loadResults(force) {
  if (ST.loading.results || (!force && ST.results)) return;
  if (!navigator.onLine) { ST.results = ST.results || await KV.get('results') || null; render(); return; }
  ST.loading.results = true;
  try { ST.results = await api('teacherResults', {}); ST.results.at = new Date().toISOString(); await KV.set('results', ST.results); }
  catch (e) { toast(e.message); ST.results = ST.results || await KV.get('results') || { quizzes: [], at: '' }; }
  finally { ST.loading.results = false; if (ST.tab === 'results') render(); }
}
V.results = function () {
  if (!ST.results) { loadResults(); return '<p class="muted"><span class="spinner"></span> Loading results…</p>'; }
  const R = ST.results;
  if (!R.quizzes.length) return '<div class="empty">No quizzes yet. Results show up here once students answer your quizzes.</div>';
  const sel = R.quizzes.find(q => q.id === ST.resSel) || R.quizzes.slice().sort((a, b) => b.attempts - a.attempts)[0];
  const qs = sel.questions.slice().sort((a, b) => (a.rate == null ? 999 : a.rate) - (b.rate == null ? 999 : b.rate));
  return `<div class="spread"><label class="field" style="flex:1;min-width:min(100%,260px)"><span>Quiz</span><select id="resSel">${R.quizzes.map(q => opt(q.id, q.title + ' (' + (STATUS[q.status] || STATUS.draft)[0] + ')', sel.id)).join('')}</select></label>
    <div class="row"><span class="small muted">Updated ${fmtTime(R.at)}</span><button class="btn small" data-act="reloadresults">Refresh</button></div></div>
    <div class="tiles"><div class="tile"><b>${sel.attempts}</b><span>Attempts</span></div><div class="tile"><b>${sel.students}${sel.assigned ? '<span class="small muted"> / ' + sel.assigned + '</span>' : ''}</b><span>Students who took it</span></div><div class="tile"><b>${pctTxt(sel.completion)}</b><span>Completion rate</span></div><div class="tile"><b>${sel.attempts - sel.pending ? sel.avg + '%' : '–'}</b><span>Average score</span></div>${sel.pending ? `<div class="tile"><b>${sel.pending}</b><span>Waiting for you to check</span></div>` : ''}</div>
    ${sel.attempts ? `<div class="cols"><article class="panel"><h2>By section</h2>${sel.sections.length ? `<div class="bars">${sel.sections.map(s => `<div class="bar"><div class="lab"><span>${esc(s.section)}</span><span>${s.avg}% · ${plural(s.n, 'try', 'tries')}</span></div><div class="track"><i class="${s.avg >= 75 ? 'good' : s.avg >= 60 ? 'mid' : 'low'}" style="width:${s.avg}%"></i></div></div>`).join('')}</div>` : '<p class="muted small">Scores appear once answers are checked.</p>'}</article>
    <article class="panel"><h2>By cognitive level</h2>${sel.bloom.length ? `<div class="bars">${sel.bloom.map(b => `<div class="bar"><div class="lab"><span>${esc(b.level)}</span><span>${b.pct}% correct</span></div><div class="track"><i class="${b.pct >= 75 ? 'good' : b.pct >= 60 ? 'mid' : 'low'}" style="width:${b.pct}%"></i></div></div>`).join('')}</div>` : '<p class="muted small">Tag questions with a Bloom’s level to see this.</p>'}</article></div>
    <article class="panel"><h2>Questions, hardest first</h2><div class="tbl-wrap"><table><thead><tr><th>Question</th><th>Competency</th><th class="num">Correct</th></tr></thead><tbody>${qs.map(q => `<tr><td>${esc(q.q)}<br><span class="small muted">${QT[q.type]}${q.bloom ? ' · ' + esc(q.bloom) : ''}</span></td><td class="small">${esc(q.comp)}</td><td class="num">${q.rate == null ? '–' : q.rate + '%'}</td></tr>`).join('')}</tbody></table></div></article>
    <article class="panel"><div class="spread"><h2>Students</h2><button class="btn small" data-act="exportroster">Export to Excel (CSV)</button></div><div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Section</th><th class="num">Tries</th><th class="num">First</th><th class="num">Best</th><th class="num">Latest</th><th>Last taken</th></tr></thead><tbody>${sel.roster.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.section)}</td><td class="num">${r.tries}</td><td class="num">${dash(r.first)}%</td><td class="num">${r.best}%</td><td class="num">${r.lastPct}%</td><td class="small">${fmtTime(r.last)}</td></tr>`).join('')}</tbody></table></div></article>`
      : '<div class="empty">No one has answered this quiz yet.</div>'}`;
};

Object.assign(A, {
  uplink: () => openModal(`<form id="linkForm" class="field" style="gap:12px" novalidate><h2>Add a web link</h2><label class="field"><span>Title</span><input type="text" id="lkTitle" maxlength="120"></label><label class="field"><span>Web address</span><input type="url" id="lkUrl" placeholder="https://"><small>YouTube, Desmos, PhET, Google Forms and other sites. Students need internet to open links.</small></label><div class="row"><button class="btn primary" type="submit">Add to the list</button><span class="err" id="lkErr"></span></div></form>`),
  uprm: i => { upRead(); ST.up.rows.splice(+i, 1); keepVals(render); },
  upclear: () => { upRead(); ST.up.rows = []; keepVals(render); },
  mstatus: k => { ST.mf.status = k; ST.sel = new Set(); render(); },
  mmore: moreMenu,
  mact: v => { const [a, id] = v.split(':'); setStatus([id], a); },
  msched: id => scheduleForm([id]),
  bulk: a => { const ids = [...ST.sel]; if (a === 'schedule') scheduleForm(ids); else if (a === 'archive' || a === 'unpublish') openModal(`<h2>${a === 'archive' ? 'Archive' : 'Unpublish'} ${plural(ids.length, 'material')}?</h2><p>Students won’t be able to open ${ids.length === 1 ? 'it' : 'them'}, and saved copies on their phones are removed the next time they go online. You can publish again anytime.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="bulkgo" data-id="${a}">${a === 'archive' ? 'Archive' : 'Unpublish'}</button></div>`); else setStatus(ids, a); },
  bulkgo: a => setStatus([...ST.sel], a),
  bulkclear: () => { ST.sel = new Set(); render(); },
  editmat: editMat,
  replacefile: id => openModal(`<form id="rfForm" class="field" style="gap:12px" data-id="${id}" novalidate><h2>Replace the file</h2><p class="small">The title, sections and status stay the same. The old file goes to Google Drive’s trash.</p><label class="field"><span>New file</span><input type="file" id="rfFile"></label><div class="row"><button class="btn primary" type="submit">Replace</button><span class="err" id="rfErr"></span></div></form>`),
  askdelmat: id => openModal(`<h2>Delete “${esc(matById(id).title)}”?</h2><p>It disappears from ${esc(appName())} and the file goes to Google Drive’s trash, where you can recover it for 30 days. To hide it but keep it, use Archive instead.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="delmat" data-id="${id}">Delete</button></div>`),
  delmat: async id => { try { await api('deleteMaterial', { id: id }); ST.cat.materials = C().materials.filter(m => m.id !== id); await KV.set('catalog', ST.cat); closeModal(); render(); toast('Deleted.'); } catch (e) { toast(e.message); } },
  qact: v => { const [a, id] = v.split(':'); quizAction(a, id); },
  askdelquiz: id => openModal(`<h2>Delete this quiz?</h2><p>Students can’t take it anymore. Past scores stay in reports. To keep it out of sight instead, use Archive.</p><div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="delquiz" data-id="${id}">Delete</button></div>`),
  delquiz: async id => { try { await api('deleteQuiz', { id: id }); ST.cat.quizzes = C().quizzes.filter(q => q.id !== id); await KV.set('catalog', ST.cat); closeModal(); render(); toast('Quiz deleted.'); } catch (e) { toast(e.message); } },
  reloadgrading: () => { ST.grading = null; render(); },
  reloadresults: () => loadResults(true),
  exportroster: () => { const R = ST.results, sel = R.quizzes.find(q => q.id === ST.resSel) || R.quizzes.slice().sort((a, b) => b.attempts - a.attempts)[0]; downloadCSV(sel.title.replace(/[^\w\- ]+/g, '') + ' results.csv', ['Student', 'LRN', 'Section', 'Tries', 'First %', 'Best %', 'Latest %', 'Last taken'], sel.roster.map(r => [r.name, r.lrn, r.section, r.tries, r.first, r.best, r.lastPct, fmtTime(r.last)])); }
});
