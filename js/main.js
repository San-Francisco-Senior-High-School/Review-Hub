/* REVIEW+ startup and event wiring. */
'use strict';

document.addEventListener('click', e => {
  const link = e.target.closest('a[data-linkopen]');
  if (link) { logEvent('linkopen', link.dataset.linkopen); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  if (b.tagName === 'A') return;
  e.preventDefault();
  const fn = A[b.dataset.act];
  if (fn) Promise.resolve(fn(b.dataset.id, b)).catch(err => toast(err.message || 'Something went wrong.'));
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOpen()) closeModal(); });

document.addEventListener('input', e => {
  const t = e.target, id = t.id;
  if (bindEditor(t)) return;
  if (t.dataset.row !== undefined && ST.up) { ST.up.rows[+t.dataset.row][t.dataset.rf] = t.value; return; }
  if (id === 'q') { ST.f.q = t.value; updateResults(); }
  if (id === 'mq') { ST.mf.q = t.value; clearTimeout(ST.mqT); ST.mqT = setTimeout(() => keepVals(render), 350); }
  if (id === 'qq') { ST.qf.q = t.value; clearTimeout(ST.qqT); ST.qqT = setTimeout(() => keepVals(render), 350); }
  if (id === 'uq') { ST.uq = t.value; $('#utable').innerHTML = usersTable(); }
  if (id === 'suLrn' || id === 'euLrn') t.value = t.value.replace(/\D/g, '').slice(0, 12);
  if (id === 'genFind') { const q = norm(t.value); $$('#genMats label').forEach(l => { l.hidden = !!q && !l.dataset.text.includes(q); }); }
  if (id === 'ans' && $('#wc')) { const n = t.value.trim() ? t.value.trim().split(/\s+/).length : 0; $('#wc').textContent = plural(n, 'word'); }
  if (id === 'bPrimary' || id === 'bHi') previewBrand();
  if (t.closest && t.closest('form') && !['loginForm', 'repForm'].includes(t.closest('form').id)) t.closest('form').setAttribute('data-dirty', '1');
});

document.addEventListener('change', e => {
  const t = e.target, id = t.id;
  if (ST.edit && t.closest('#qeForm')) {
    bindEditor(t);
    if (t.dataset.m === 'grade' || t.dataset.m === 'sy') { ST.edit.sections = []; keepVals(render); }
    else if (t.dataset.m === 'kind') { if (ST.edit.kind !== 'practice' && ST.edit.feedback === 'each') ST.edit.feedback = 'score'; if (ST.edit.kind !== 'practice' && !ST.edit.maxAttempts) ST.edit.maxAttempts = 1; keepVals(render); }
    else if (t.dataset.f === 'q' && ST.edit.questions[+t.dataset.q] && ST.edit.questions[+t.dataset.q].type === 'fill') keepVals(render);
    return;
  }
  if (t.dataset.row !== undefined && ST.up) { ST.up.rows[+t.dataset.row][t.dataset.rf] = t.value; return; }
  const fmap = { fgrade: 'grade', fstrand: 'strand', fsection: 'section', fsubject: 'subject', fterm: 'term', ftype: 'type', fsort: 'sort', fsy: 'sy' };
  if (fmap[id]) { ST.f[fmap[id]] = t.value; updateResults(); }
  const mmap = { mstatus: 'status', msy: 'sy', mgrade: 'grade', mstrand: 'strand', msubject: 'subject', mterm: 'term', mtopic: 'topic', mteacher: 'teacher' };
  if (mmap[id]) { ST.mf[mmap[id]] = t.value; ST.sel = new Set(); keepVals(render); }
  const qmap = { qstatus: 'status', qkind: 'kind', qterm: 'term', qsubject: 'subject' };
  if (qmap[id]) { ST.qf[qmap[id]] = t.value; keepVals(render); }
  if (id === 'mall') { manageList().forEach(m => t.checked ? ST.sel.add(m.id) : ST.sel.delete(m.id)); keepVals(render); }
  if (t.classList.contains('msel')) { t.checked ? ST.sel.add(t.value) : ST.sel.delete(t.value); keepVals(render); }
  if (id === 'resSel') { ST.resSel = t.value; render(); }
  if (id === 'urole') { ST.urole = t.value; $('#utable').innerHTML = usersTable(); }
  if (id === 'secSy') { ST.secSy = t.value; render(); }
  if (id === 'suGrade' || id === 'suStrand') { ST.sg = $('#suGrade').value; ST.ss = id === 'suStrand' ? t.value : null; keepVals(render); }
  if (id === 'upFiles') { upRead(); addFiles(t.files); t.value = ''; keepVals(render); }
  if (id === 'upGrade' || id === 'upSy') { upRead(); ST.up.strands = null; ST.up.sections = null; keepVals(render); }
  if (t.classList.contains('upStrand')) { upRead(); ST.up.strands = $$('.upStrand:checked').map(i => i.value); ST.up.sections = null; keepVals(render); }
  if (t.name === 'uprel') { upRead(); ST.up.release = t.value; keepVals(render); }
  if (id === 'genType') $('#genMix').hidden = t.value !== 'mixed';
  if (id === 'dashPreset') { ST.dash.preset = t.value; if (t.value !== 'custom') { ST.dash.data = null; } keepVals(render); }
  if (id === 'dashTeacher') { ST.dash.teacher = t.value; ST.dash.data = null; render(); }
  if (id === 'rpType') { ST.rep.type = t.value; keepVals(render); }
  if (id === 'bLogo' && t.files[0]) { shrinkLogo(t.files[0]).then(url => { const b = readBrand(); b.logo = url; keepVals(render); toast('Logo ready. Tap “Save branding for everyone” to keep it.'); }).catch(err => toast(err.message)); }
  if (t.name === 'bHeader') previewBrand();
});

document.addEventListener('submit', async e => {
  const f = e.target, id = f.id;
  const F = { loginForm: doLogin, suForm: doSignup, pwForm: doChangePw, upForm: doUpload, emForm: saveMat, rfForm: doReplace, genForm: doGenerate, fbForm: doFeedback, repForm: doReport };
  if (F[id]) return F[id](e);
  e.preventDefault();
  if (f.classList.contains('gradeForm')) return saveGrades(f);
  const val = i => ($('#' + i) || {}).value || '';
  const errEl = f.querySelector('.err');
  try {
    if (id === 'linkForm') {
      const title = val('lkTitle').trim(), url = val('lkUrl').trim();
      if (!title) throw new UserErr('Add a title.');
      if (!/^https?:\/\/\S+$/.test(url)) throw new UserErr('Enter a web address that starts with https://');
      upState().rows.push({ kind: 'link', url: url, type: 'link', title: title, topic: '', term: '', state: 'ready' });
      closeModal(); keepVals(render);
    } else if (id === 'schedForm') {
      const v = val('schedAt');
      if (!v || new Date(v).getTime() <= Date.now()) throw new UserErr('Choose a date and time in the future.');
      await setStatus(f.dataset.ids.split(','), 'schedule', new Date(v).toISOString());
    } else if (id === 'joinForm') {
      const r = await api('joinSection', { code: val('joinCode') });
      ST.user = r.user; await persist(); closeModal(); await refresh(); toast('You’re now in ' + secLabel(r.user.sectionId) + '.');
    } else if (id === 'staffForm') {
      const r = await api('createStaff', { name: val('sfName'), username: val('sfUser'), role: val('sfRole'), subjects: val('sfSubj') });
      openModal(`<h2>Account created</h2><p>Username: <span class="kbd">${esc(val('sfUser').trim().toLowerCase())}</span></p><p>Temporary password: <span class="kbd">${esc(r.tempPassword)}</span></p><p class="small muted">Give these to the teacher. They’ll choose their own password the first time they sign in.</p><div class="row"><button class="btn" data-act="copy" data-id="${esc(r.tempPassword)}">Copy password</button><button class="btn primary" data-act="close">Done</button></div>`);
      await loadAdm(true);
    } else if (id === 'secForm') {
      const r = await api('saveSection', { sy: val('scSy'), grade: val('scGrade'), strand: val('scStrand'), name: val('scName'), adviser: val('scAdv') });
      ST.secSy = val('scSy'); await refresh(true); render(); toast('Section added. Class code: ' + r.code);
    } else if (id === 'esecForm') {
      await api('saveSection', { id: f.dataset.id, grade: val('eGrade'), strand: val('eStrand'), name: val('eName'), adviser: val('eAdv'), sy: val('eSy') });
      closeModal(); await refresh(true); render(); toast('Section saved.');
    } else if (id === 'esForm') {
      await api('updateStaff', { id: f.dataset.id, name: val('esName'), subjects: val('esSubj') }); closeModal(); toast('Saved.'); loadAdm(true);
    } else if (id === 'euForm') {
      await api('updateStudent', { id: f.dataset.id, name: val('euName'), lrn: val('euLrn'), sectionId: val('euSec') }); closeModal(); toast('Student details saved.'); loadAdm(true);
    } else if (id === 'setForm') {
      const td = {}; TERM_IDS.forEach(k => td[k] = { start: val('td' + k + 's'), end: val('td' + k + 'e') });
      await api('saveSettings', { schoolYear: val('stSy').trim(), currentTerm: val('stTerm'), termDates: td, strands: val('stStrands').split('\n'), subjects: val('stSubjects').split('\n') });
      f.removeAttribute('data-dirty'); await refresh(true); render(); toast('Settings saved.');
    } else if (id === 'aiForm') {
      const key = val('aiKey').trim();
      const r = await api('saveAi', Object.assign({ model: val('aiModel').trim() }, key ? { key: key } : {}));
      C().settings.aiReady = r.aiReady; C().settings.aiModel = val('aiModel').trim(); f.removeAttribute('data-dirty'); render(); toast(r.aiReady ? 'Saved. Tap “Test it” to check the key.' : 'Saved. Add a key to turn the AI generator on.');
    } else if (id === 'brandForm') {
      const b = readBrand();
      const r = await api('saveBranding', { branding: b });
      ST.bd = null; applyBranding(r.branding); if (ST.cat) ST.cat.branding = r.branding; await KV.set('catalog', ST.cat); render(); toast('Branding saved. Everyone sees it the next time their app updates.');
    }
  } catch (ex) { if (errEl) errEl.textContent = ex.message; else toast(ex.message); }
});

window.addEventListener('online', () => { renderTop(); toast('Back online.'); sync(); refresh(true); });
window.addEventListener('offline', () => { renderTop(); noteOfflineOpen(); if (!isBusy()) render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine && ST.token && Date.now() - (ST.lastRefresh || 0) > 5 * 60 * 1000) refresh(true); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ST.installEvt = e; renderTop(); });
window.addEventListener('appinstalled', () => { ST.installEvt = null; renderTop(); toast(appName() + ' is installed. Open it from your home screen.'); });
window.addEventListener('beforeunload', e => { if (ST.up && ST.up.busy) { e.preventDefault(); e.returnValue = ''; } });

async function boot() {
  const b = LS.get('branding', null);
  if (b) applyBranding(b); else applyTheme(null);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  try {
    const s = await KV.get('session');
    if (s && s.token) { ST.token = s.token; ST.user = s.user; }
    ST.cat = (await KV.get('catalog')) || null;
    ST.pending = (await KV.get('pending')) || [];
    ST.events = (await KV.get('events')) || [];
    ST.fbq = (await KV.get('fbq')) || [];
    ST.saved = (await KV.get('savedIndex')) || {};
    ST.lastFeedback = (await KV.get('lastFeedback')) || null;
  } catch (e) { }
  render();
  noteOfflineOpen();
  if (!ST.token && navigator.onLine && apiReady()) api('branding').then(r => { applyBranding(r.branding); if (!ST.user) render(); }).catch(() => { });
  if (ST.token && !ST.user.mustChange) refresh(!!ST.cat);
}
boot();
