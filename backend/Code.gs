/**
 * REVIEW+ server (Google Apps Script), version 2
 * ----------------------------------------------
 * Paste this code into Extensions > Apps Script of your "Review Hub Database"
 * Google Sheet, following the setup guide. You don't need to change anything here.
 *
 * The Sheet is the database. Uploaded files are kept in the "Review Hub" folder of
 * your Google Drive, and they are never shared publicly: students only get a file
 * through this server, which checks that it is published for their section.
 */

const VERSION = '2.0.0';
const MAX_UPLOAD_MB = 25;
const MAX_AI_PDF_MB = 18;
const SESSION_DAYS = 60;
const KEEP_BACKUPS = 30;
const TZ = 'Asia/Manila';
const ZW = '​'; // invisible marker that stops the Sheet treating text as a formula
const TERM_IDS = ['T1', 'T2', 'T3'];
const QTYPES = ['mc', 'tf', 'id', 'match', 'enum', 'fill', 'short', 'problem', 'essay'];
const BLOOM = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const DIFFS = ['Easy', 'Average', 'Difficult'];
const AI_MODEL_DEFAULT = 'gemini-3.5-flash-lite';
const STATUSES = ['draft', 'scheduled', 'published', 'unpublished', 'archived'];

const SHEETS = {
  Users: ['id', 'role', 'name', 'lrn', 'username', 'sectionId', 'status', 'passHash', 'salt', 'mustChange', 'codeEntered', 'subjects', 'created', 'lastActive'],
  Sections: ['id', 'grade', 'strand', 'name', 'code', 'adviser', 'sy'],
  Materials: ['id', 'title', 'subject', 'grade', 'sections', 'term', 'topic', 'keywords', 'type', 'fileName', 'mime', 'size', 'driveId', 'url', 'desc', 'teacherId', 'teacherName', 'date', 'hidden', 'allowOffline', 'views', 'downloads',
    'status', 'publishAt', 'publishedAt', 'sy', 'updated', 'archivedAt'],
  Quizzes: ['id', 'title', 'materialId', 'subject', 'grade', 'sections', 'term', 'topic', 'teacherId', 'teacherName', 'published', 'questions', 'updated',
    'status', 'publishAt', 'publishedAt', 'kind', 'pairId', 'feedback', 'maxAttempts', 'aiGenerated', 'approvedBy', 'approvedAt', 'sy', 'materialIds'],
  Attempts: ['id', 'clientId', 'quizId', 'userId', 'sectionId', 'pct', 'score', 'total', 'results', 'takenAt', 'syncedAt', 'status', 'responses', 'maxScore', 'gradedBy', 'gradedAt'],
  Sessions: ['token', 'userId', 'expires'],
  Events: ['time', 'userId', 'role', 'sectionId', 'type', 'materialId', 'quizId'],
  Feedback: ['id', 'clientId', 'time', 'userId', 'sectionId', 'useful1', 'useful2', 'access1', 'access2', 'overall', 'connect', 'comment'],
  Log: ['time', 'who', 'category', 'text', 'warn'],
  Settings: ['key', 'value']
};

const DEFAULTS = {
  schoolName: 'San Francisco Senior High School',
  appName: 'REVIEW+',
  address: '',
  logo: '',
  theme: { preset: 'green', primary: '#0b6b55', highlight: '#f4c63d', header: 'plain' },
  schoolHead: '',
  schoolHeadPosition: 'School Principal',
  strands: ['STEM', 'ABM', 'HUMSS', 'GAS', 'TVL-ICT'],
  currentTerm: 'T1',
  termDates: {},
  aiModel: AI_MODEL_DEFAULT,
  subjects: ['Oral Communication', 'Komunikasyon at Pananaliksik', 'General Mathematics', 'Statistics and Probability',
    'Earth and Life Science', 'Physical Science', 'Personal Development', 'Understanding Culture, Society and Politics',
    'Empowerment Technologies', 'Practical Research 1', 'Practical Research 2', 'Pre-Calculus', 'Basic Calculus',
    'General Chemistry 1', 'General Biology 1', 'General Physics 1', 'Fundamentals of ABM 1', 'Business Mathematics',
    'Organization and Management', 'Entrepreneurship', 'Creative Writing', 'Disciplines and Ideas in the Social Sciences',
    'Computer Systems Servicing']
};

/* =====================================================================
 * Sheet menu (for you, the owner)
 * ===================================================================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Review Hub')
    .addItem('Set up or update database', 'setupFromMenu')
    .addItem('Reset admin password', 'resetAdminFromMenu')
    .addItem('Back up now', 'backupFromMenu')
    .addToUi();
}

function setupFromMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('REVIEW+', setup_().message, ui.ButtonSet.OK);
}

function resetAdminFromMenu() {
  const ui = SpreadsheetApp.getUi();
  MEMO_ = {};
  const admin = table_('Users').rows.find(u => u.role === 'admin' && u.username === 'admin');
  if (!admin) { ui.alert('No "admin" account found. Run "Set up or update database" first.'); return; }
  const pw = tempPassword_();
  update_('Users', admin._row, Object.assign({ mustChange: '1', status: 'active' }, pass_(pw)));
  clearSessions_(admin.id);
  log_('App owner', 'Security', 'Admin password reset from the Sheet menu.', true);
  ui.alert('Admin password reset', 'Username: admin\nTemporary password: ' + pw + '\n\nYou will choose a new password when you sign in.', ui.ButtonSet.OK);
}

function backupFromMenu() {
  MEMO_ = {};
  const b = backup_('Manual');
  SpreadsheetApp.getUi().alert('Backup saved: ' + b.name);
}

/** Runs every night at 11 PM (Manila time) once set up. */
function nightlyBackup() { MEMO_ = {}; backup_('Nightly'); }

function setup_() {
  MEMO_ = {};
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(name => ensureSheet_(ss, name));
  ss.getSheets().forEach(sh => {
    if (!SHEETS[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  MEMO_ = {};
  const s = settings_();
  if (!s.rootFolderId) {
    const root = DriveApp.createFolder('Review Hub');
    const bk = root.createFolder('Backups');
    setSetting_('rootFolderId', root.getId());
    setSetting_('backupFolderId', bk.getId());
  }
  Object.keys(DEFAULTS).forEach(k => { if (s[k] === undefined) setSetting_(k, DEFAULTS[k]); });
  const migrated = migrate_();

  let message;
  const users = table_('Users');
  if (!users.rows.some(u => u.role === 'admin')) {
    const pw = tempPassword_();
    insert_('Users', Object.assign({ id: id_('u'), role: 'admin', name: 'App owner', username: 'admin', status: 'active', mustChange: '1', created: now_() }, pass_(pw)));
    message = 'Setup finished.\n\nAdmin username: admin\nTemporary password: ' + pw +
      '\n\nWrite this down. You will choose a new password the first time you sign in.\n\nNext step: Deploy > New deployment > Web app (see the setup guide).';
  } else {
    message = 'The database is up to date (version ' + VERSION + ').' + (migrated ? '\n\n' + migrated : '') +
      '\n\nIf you just pasted new code, remember: Deploy > Manage deployments > pencil icon > Version: New version > Deploy.';
  }
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'nightlyBackup')) {
    ScriptApp.newTrigger('nightlyBackup').timeBased().atHour(23).everyDays(1).inTimezone(TZ).create();
  }
  log_('App owner', 'System', 'Database set up or updated (version ' + VERSION + ').');
  return { message: message };
}

function ensureSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const want = SHEETS[name];
  const lastCol = sh.getLastColumn();
  let head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = head.filter(String).length ? want.filter(h => head.indexOf(h) < 0) : want.slice();
  if (!head.filter(String).length) head = [];
  const need = head.length + missing.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
}

/** Brings data from version 1 (quarters, semesters, published flags) into version 2. */
function migrate_() {
  const s = settings_();
  const sy = s.schoolYear || defaultSY_();
  const notes = [];
  if (!s.schoolYear) setSetting_('schoolYear', sy);
  if (!/^T[123]$/.test(String(s.currentTerm || ''))) setSetting_('currentTerm', mapTerm_(s.currentTerm));
  if (!s.appName) setSetting_('appName', 'REVIEW+');

  const mats = table_('Materials');
  const mp = [];
  mats.rows.forEach(m => {
    const p = {};
    if (!m.status) { p.status = m.hidden === '1' ? 'unpublished' : 'published'; if (p.status === 'published') p.publishedAt = m.date || now_(); }
    if (!/^T[123]$/.test(m.term)) p.term = mapTerm_(m.term);
    if (!m.sy) p.sy = sy;
    if (Object.keys(p).length) mp.push({ row: m._row, obj: p });
  });
  updateMany_('Materials', mp);
  if (mp.length) notes.push(mp.length + ' materials moved to the Term 1 to 3 structure.');

  const qz = table_('Quizzes');
  const qp = [];
  qz.rows.forEach(q => {
    const p = {};
    if (!q.status) { p.status = q.published === '1' ? 'published' : 'draft'; if (p.status === 'published') { p.publishedAt = q.updated || now_(); p.approvedBy = q.teacherName; p.approvedAt = q.updated || now_(); } }
    if (!/^T[123]$/.test(q.term)) p.term = mapTerm_(q.term);
    if (!q.kind) p.kind = 'practice';
    if (!q.feedback) p.feedback = 'each';
    if (!q.sy) p.sy = sy;
    if (Object.keys(p).length) qp.push({ row: q._row, obj: p });
  });
  updateMany_('Quizzes', qp);
  if (qp.length) notes.push(qp.length + ' quizzes updated.');

  const secs = table_('Sections');
  updateMany_('Sections', secs.rows.filter(x => !x.sy).map(x => ({ row: x._row, obj: { sy: sy } })));
  return notes.join(' ');
}

function mapTerm_(t) {
  t = String(t || '');
  if (/^T[123]$/.test(t)) return t;
  return (t === 'Q3' || t === 'Q4') ? 'T2' : 'T1';
}

function defaultSY_() {
  const y = Number(Utilities.formatDate(new Date(), TZ, 'yyyy')), m = Number(Utilities.formatDate(new Date(), TZ, 'M'));
  return m >= 6 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
}

/* =====================================================================
 * Web app entry points
 * ===================================================================== */
let MEMO_ = {};

function doGet() {
  return json_({ ok: true, app: 'REVIEW+', version: VERSION });
}

function doPost(e) {
  MEMO_ = {};
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    out = route_(req);
    out.ok = true;
    out.serverVersion = VERSION;
  } catch (err) {
    out = { ok: false, error: err.userMsg || 'Something went wrong on the server. Try again in a minute.', code: err.code || '', serverVersion: VERSION };
    if (!err.userMsg) console.error(err && err.stack || err);
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  const a = req.action;
  if (PUBLIC_API[a]) return PUBLIC_API[a](req);
  const user = auth_(req.token);
  if (USER_API[a]) return USER_API[a](req, user);
  if (TEACHER_API[a]) {
    if (user.role !== 'teacher' && user.role !== 'admin') fail_('Only teachers can do that.');
    return TEACHER_API[a](req, user);
  }
  if (ADMIN_API[a]) {
    if (user.role !== 'admin') fail_('Only the admin can do that.');
    return ADMIN_API[a](req, user);
  }
  fail_('That action isn’t available. The server may need updating: ask the admin.');
}

/* =====================================================================
 * Public: branding, sign-up and sign-in
 * ===================================================================== */
const PUBLIC_API = {
  ping: () => ({ version: VERSION }),

  branding: () => ({ branding: branding_() }),

  signupOptions: () => {
    const s = settings_();
    return { schoolName: s.schoolName, strands: s.strands, sections: currentSections_().map(publicSection_) };
  },

  signup: req => {
    const name = clean_(req.name, 80), lrn = String(req.lrn || '').trim(), code = String(req.code || '').trim().toUpperCase();
    if (name.split(/\s+/).length < 2) fail_('Enter your full name (first and last name).');
    if (!/^\d{12}$/.test(lrn)) fail_('Your LRN should be exactly 12 digits.');
    if (String(req.password || '').length < 8) fail_('Your password needs at least 8 characters.');
    if (!code) fail_('Enter the class code from your adviser.');
    return withLock_(() => {
      const sec = table_('Sections').rows.find(x => x.id === req.sectionId);
      if (!sec) fail_('Choose your section.');
      const users = table_('Users');
      const existing = users.rows.find(u => u.lrn === lrn);
      if (existing && existing.status !== 'rejected') {
        fail_(existing.status === 'pending' ? 'This LRN already signed up and is waiting for approval.' : 'This LRN already has an account. Sign in instead, or ask the admin to reset your password.');
      }
      const data = Object.assign({ role: 'student', name: name, lrn: lrn, sectionId: sec.id, status: 'pending', codeEntered: code, mustChange: '', created: now_() }, pass_(req.password));
      if (existing) update_('Users', existing._row, data); else insert_('Users', Object.assign({ id: id_('u') }, data));
      const match = code === sec.code;
      log_(name, 'Accounts', 'New sign-up waiting for approval: ' + name + ', ' + label_(sec) + (match ? '.' : '. The class code doesn’t match.'), !match);
      return { message: 'Sign-up sent. You can sign in once your account is approved.' };
    });
  },

  login: req => {
    const id = String(req.id || '').trim(), pw = String(req.password || '');
    if (!id || !pw) fail_('Enter your LRN or username and your password.');
    const cache = CacheService.getScriptCache(), key = 'fail:' + id.toLowerCase();
    const fails = Number(cache.get(key) || 0);
    if (fails >= 5) fail_('Too many wrong tries. Wait 15 minutes, or ask the admin to reset your password.');
    const u = table_('Users').rows.find(x => x.lrn === id || (x.username && x.username.toLowerCase() === id.toLowerCase()));
    if (!u || hash_(pw, u.salt) !== u.passHash) {
      cache.put(key, String(fails + 1), 900);
      if (fails + 1 === 5) log_(id, 'Security', '5 wrong passwords for "' + id + '" within 15 minutes. Sign-in locked for 15 minutes.', true);
      fail_('Wrong LRN, username or password.');
    }
    cache.remove(key);
    if (u.status === 'pending') fail_('Your account is waiting for approval. Ask your adviser to check.');
    if (u.status === 'suspended') fail_('This account is suspended. Talk to the admin.');
    if (u.status === 'rejected') fail_('This sign-up wasn’t approved. Check your class code with your adviser, then sign up again.');
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    withLock_(() => {
      insert_('Sessions', { token: token, userId: u.id, expires: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() });
      update_('Users', u._row, { lastActive: now_() });
      insert_('Events', { time: now_(), userId: u.id, role: u.role, sectionId: u.sectionId, type: 'login' });
    });
    cache.put('tok:' + token, u.id, 21600);
    if (Math.random() < 0.05) cleanSessions_();
    return { token: token, user: publicUser_(u), branding: branding_() };
  }
};

/* =====================================================================
 * Any signed-in user
 * ===================================================================== */
const USER_API = {
  me: (req, user) => ({ user: publicUser_(user) }),

  logout: (req, user) => {
    withLock_(() => {
      const t = table_('Sessions');
      const s = t.rows.find(x => x.token === req.token);
      if (s) { t.sh.deleteRow(s._row); dirty_('Sessions'); }
    });
    CacheService.getScriptCache().remove('tok:' + req.token);
    return {};
  },

  changePassword: (req, user) => {
    if (hash_(String(req.current || ''), user.salt) !== user.passHash) fail_('Your current password is wrong.');
    if (String(req.password || '').length < 8) fail_('Your new password needs at least 8 characters.');
    if (req.password === req.current) fail_('Choose a password different from the current one.');
    withLock_(() => update_('Users', user._row, Object.assign({ mustChange: '' }, pass_(req.password))));
    return { user: publicUser_(Object.assign({}, user, { mustChange: '' })) };
  },

  joinSection: (req, user) => {
    if (user.role !== 'student') fail_('Only students join sections.');
    const code = String(req.code || '').trim().toUpperCase();
    const sec = table_('Sections').rows.find(s => s.code === code);
    if (!sec) fail_('That class code doesn’t match any section. Check it with your adviser.');
    if (sec.id === user.sectionId) fail_('You’re already in ' + label_(sec) + '.');
    const old = table_('Sections').rows.find(s => s.id === user.sectionId);
    withLock_(() => update_('Users', user._row, { sectionId: sec.id, codeEntered: code }));
    log_(user.name, 'Accounts', user.name + ' moved from ' + (old ? label_(old) : 'no section') + ' to ' + label_(sec) + ' with its class code.');
    return { user: publicUser_(Object.assign({}, user, { sectionId: sec.id })) };
  },

  catalog: (req, user) => {
    const s = settings_();
    const staff = user.role !== 'student', admin = user.role === 'admin';
    const allSecs = table_('Sections').rows;
    const sections = staff ? allSecs.map(x => admin ? Object.assign(publicSection_(x), { code: x.code }) : publicSection_(x))
      : allSecs.filter(x => x.id === user.sectionId).map(publicSection_);
    const materials = table_('Materials').rows.filter(m => canSeeMaterial_(m, user)).map(publicMaterial_);
    const quizzes = table_('Quizzes').rows.filter(q => canSeeQuiz_(q, user)).map(publicQuiz_);
    let myAttempts = [], toCheck = 0;
    if (user.role === 'student') {
      myAttempts = table_('Attempts').rows.filter(a => a.userId === user.id).slice(-300).map(publicAttempt_);
    } else {
      const mine = new Set(table_('Quizzes').rows.filter(q => admin || q.teacherId === user.id).map(q => q.id));
      toCheck = table_('Attempts').rows.filter(a => a.status === 'pending' && mine.has(a.quizId)).length;
    }
    const cache = CacheService.getScriptCache(), dayKey = 'open:' + user.id + ':' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
    if (!cache.get(dayKey)) {
      cache.put(dayKey, '1', 86400);
      withLock_(() => {
        update_('Users', user._row, { lastActive: now_() });
        insert_('Events', { time: now_(), userId: user.id, role: user.role, sectionId: user.sectionId, type: 'open' });
      });
    }
    const settings = { schoolName: s.schoolName, appName: s.appName, strands: s.strands, subjects: s.subjects, currentTerm: s.currentTerm, schoolYear: s.schoolYear, termDates: s.termDates || {} };
    if (staff) { settings.aiReady = !!aiKey_(); settings.aiModel = s.aiModel || AI_MODEL_DEFAULT; }
    return { user: publicUser_(user), settings: settings, branding: branding_(), sections: sections, materials: materials, quizzes: quizzes, myAttempts: myAttempts, toCheck: toCheck, serverTime: now_() };
  },

  file: (req, user) => {
    const m = table_('Materials').rows.find(x => x.id === req.id);
    if (!m || !canSeeMaterial_(m, user)) fail_('This material isn’t available. It may be locked or no longer published.', 'locked');
    if (!m.driveId) fail_('This material is a link, not a file.');
    let purpose = ['view', 'download', 'save', 'preview'].indexOf(req.purpose) >= 0 ? req.purpose : 'view';
    if (user.role === 'student' && purpose === 'preview') purpose = 'view';
    if (user.role === 'student' && purpose !== 'view' && m.allowOffline !== '1') fail_('Your teacher turned off downloads for this material. You can still view it online.');
    let blob;
    try { blob = DriveApp.getFileById(m.driveId).getBlob(); } catch (e) { fail_('The file is missing from Google Drive. Tell the teacher who uploaded it.'); }
    withLock_(() => insert_('Events', { time: now_(), userId: user.id, role: user.role, sectionId: user.sectionId, type: purpose, materialId: m.id }));
    return { name: m.fileName, mime: m.mime || blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
  },

  previewText: (req, user) => {
    const m = table_('Materials').rows.find(x => x.id === req.id);
    if (!m || !canSeeMaterial_(m, user)) fail_('This material isn’t available.', 'locked');
    const kind = officeKind_(m.mime, m.fileName);
    if (!kind) fail_('Text preview works for PowerPoint (.pptx), Word (.docx) and text files.');
    const blob = DriveApp.getFileById(m.driveId).getBlob();
    return { kind: kind, pages: officePages_(blob, kind).slice(0, 200) };
  },

  logEvents: (req, user) => {
    const allowed = ['view', 'offlineview', 'linkopen', 'open'];
    const list = (Array.isArray(req.events) ? req.events : []).slice(0, 300);
    const oldest = Date.now() - 90 * 864e5;
    const rows = list.filter(e => allowed.indexOf(e.type) >= 0).map(e => {
      const t = new Date(e.time).getTime();
      return { time: (isNaN(t) || t > Date.now() + 6e5 || t < oldest) ? now_() : new Date(t).toISOString(), userId: user.id, role: user.role, sectionId: user.sectionId, type: e.type, materialId: clean_(e.materialId, 40), quizId: clean_(e.quizId, 40) };
    });
    if (rows.length) withLock_(() => insertMany_('Events', rows));
    return { saved: list.map(e => e.clientId) };
  },

  submitAttempts: (req, user) => {
    if (user.role !== 'student') return { saved: (req.attempts || []).map(a => a.clientId) };
    const list = Array.isArray(req.attempts) ? req.attempts.slice(0, 100) : [];
    return withLock_(() => {
      const seen = new Set(table_('Attempts').rows.filter(a => a.userId === user.id).map(a => a.clientId));
      const quizzes = {};
      table_('Quizzes').rows.forEach(q => quizzes[q.id] = q);
      const rows = [], saved = [];
      list.forEach(a => {
        const cid = clean_(a.clientId, 60);
        if (!cid) return;
        saved.push(cid);
        const q = quizzes[a.quizId];
        if (seen.has(cid) || !q) return;
        seen.add(cid);
        const sc = scoreAttempt_(parse_(q.questions, []), a.responses || {});
        rows.push({
          id: id_('a'), clientId: cid, quizId: q.id, userId: user.id, sectionId: user.sectionId || '',
          pct: String(sc.pct), score: String(sc.score), maxScore: String(sc.maxScore), total: String(sc.results.length),
          results: JSON.stringify(sc.results), responses: capJson_(a.responses || {}, 45000), status: sc.status,
          takenAt: validDate_(a.takenAt), syncedAt: now_()
        });
      });
      insertMany_('Attempts', rows);
      return { saved: saved };
    });
  },

  submitFeedback: (req, user) => {
    if (user.role !== 'student') fail_('Feedback is for students.');
    const list = (Array.isArray(req.feedback) ? req.feedback : []).slice(0, 20);
    const lik = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? String(n) : ''; };
    return withLock_(() => {
      const seen = new Set(table_('Feedback').rows.filter(f => f.userId === user.id).map(f => f.clientId));
      const rows = [], saved = [];
      list.forEach(f => {
        const cid = clean_(f.clientId, 60);
        if (!cid) return;
        saved.push(cid);
        if (seen.has(cid)) return;
        seen.add(cid);
        rows.push({ id: id_('f'), clientId: cid, time: validDate_(f.time), userId: user.id, sectionId: user.sectionId, useful1: lik(f.useful1), useful2: lik(f.useful2), access1: lik(f.access1), access2: lik(f.access2), overall: lik(f.overall), connect: clean_(f.connect, 40), comment: clean_(f.comment, 1000) });
      });
      insertMany_('Feedback', rows);
      return { saved: saved };
    });
  }
};

/* =====================================================================
 * Teachers (and the admin)
 * ===================================================================== */
const TEACHER_API = {
  upload: (req, user) => {
    const title = clean_(req.title, 120), subject = clean_(req.subject, 80);
    if (!title) fail_('Add a title so students can find it.');
    if (!subject) fail_('Choose a subject.');
    const grade = String(req.grade);
    if (grade !== '11' && grade !== '12') fail_('Choose Grade 11 or 12.');
    const sections = table_('Sections').rows.filter(s => (req.sections || []).indexOf(s.id) >= 0);
    if (!sections.length) fail_('Choose at least one section.');
    const s = settings_();
    const term = TERM_IDS.indexOf(req.term) >= 0 ? req.term : s.currentTerm;
    const sy = /^\d{4}-\d{4}$/.test(req.sy || '') ? req.sy : s.schoolYear;
    const topic = clean_(req.topic, 80) || title;
    const rel = release_(req.release, req.publishAt);
    const m = {
      id: id_('m'), title: title, subject: subject, grade: grade, sections: sections.map(x => x.id).join(','), term: term, topic: topic, sy: sy,
      keywords: clean_(req.keywords, 200), desc: clean_(req.desc, 600), teacherId: user.id, teacherName: user.name,
      date: now_(), updated: now_(), hidden: '', allowOffline: req.allowOffline === false ? '' : '1', views: '0', downloads: '0',
      status: rel.status, publishAt: rel.publishAt, publishedAt: rel.status === 'published' ? now_() : ''
    };
    if (req.kind === 'link') {
      const url = String(req.url || '').trim();
      if (!/^https?:\/\/\S+$/.test(url)) fail_('Enter a web address that starts with https://');
      Object.assign(m, { type: 'link', url: url, fileName: '', mime: '', size: '0', driveId: '' });
    } else {
      Object.assign(m, saveFile_(req, grade, sections, term, subject, topic, sy));
    }
    withLock_(() => insert_('Materials', m));
    log_(user.name, 'Uploads', user.name + ' uploaded “' + title + '” (' + statusWord_(m) + ') for ' + sections.map(label_).join(', ') + '.');
    return { material: publicMaterial_(m) };
  },

  replaceFile: (req, user) => {
    const t = table_('Materials');
    const m = own_(t.rows.find(x => x.id === req.id), user);
    if (m.type === 'link') fail_('This material is a link. Edit its web address instead.');
    const sections = table_('Sections').rows.filter(s => m.sections.split(',').indexOf(s.id) >= 0);
    const f = saveFile_(req, m.grade, sections.length ? sections : [{ strand: 'All strands' }], m.term, m.subject, m.topic, m.sy);
    const old = m.driveId;
    withLock_(() => update_('Materials', m._row, Object.assign(f, { updated: now_() })));
    if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { } }
    log_(user.name, 'Uploads', user.name + ' replaced the file of “' + m.title + '”.');
    MEMO_ = {};
    return { material: publicMaterial_(table_('Materials').rows.find(x => x.id === m.id)) };
  },

  updateMaterial: (req, user) => withLock_(() => {
    const m = own_(table_('Materials').rows.find(x => x.id === req.id), user);
    const f = req.fields || {};
    const patch = { updated: now_() };
    if (f.title !== undefined) { patch.title = clean_(f.title, 120); if (!patch.title) fail_('The title can’t be empty.'); }
    ['topic', 'keywords', 'desc', 'subject'].forEach(k => { if (f[k] !== undefined) patch[k] = clean_(f[k], k === 'desc' ? 600 : 200); });
    if (f.term !== undefined && TERM_IDS.indexOf(f.term) >= 0) patch.term = f.term;
    if (f.sy !== undefined && /^\d{4}-\d{4}$/.test(f.sy)) patch.sy = f.sy;
    if (f.allowOffline !== undefined) patch.allowOffline = f.allowOffline ? '1' : '';
    if (f.url !== undefined && m.type === 'link') { if (!/^https?:\/\/\S+$/.test(String(f.url).trim())) fail_('Enter a web address that starts with https://'); patch.url = String(f.url).trim(); }
    if (f.sections !== undefined) {
      const ids = table_('Sections').rows.filter(s => f.sections.indexOf(s.id) >= 0).map(s => s.id);
      if (!ids.length) fail_('Choose at least one section.');
      patch.sections = ids.join(',');
    }
    update_('Materials', m._row, patch);
    return { material: publicMaterial_(Object.assign(m, patch)) };
  }),

  setMaterialStatus: (req, user) => {
    const ids = Array.isArray(req.ids) ? req.ids : [req.id];
    const out = withLock_(() => {
      const t = table_('Materials');
      const list = t.rows.filter(m => ids.indexOf(m.id) >= 0).map(m => own_(m, user));
      if (!list.length) fail_('Choose at least one material.');
      const patches = list.map(m => ({ row: m._row, obj: statusPatch_(m, req.op, req.publishAt) }));
      updateMany_('Materials', patches);
      return list.map((m, i) => publicMaterial_(Object.assign(m, patches[i].obj)));
    });
    log_(user.name, 'Uploads', user.name + ' ' + actionWord_(req.op, req.publishAt) + ' ' + (out.length === 1 ? '“' + out[0].title + '”' : out.length + ' materials') + '.');
    return { materials: out };
  },

  deleteMaterial: (req, user) => {
    const m = withLock_(() => {
      const t = table_('Materials');
      const m = own_(t.rows.find(x => x.id === req.id), user);
      t.sh.deleteRow(m._row);
      dirty_('Materials');
      return m;
    });
    if (m.driveId) { try { DriveApp.getFileById(m.driveId).setTrashed(true); } catch (e) { } }
    log_(user.name, 'Uploads', user.name + ' deleted “' + m.title + '”. The file is in Google Drive’s trash for 30 days.', true);
    return {};
  },

  saveQuiz: (req, user) => {
    const q = req.quiz || {};
    const title = clean_(q.title, 120);
    if (!title) fail_('Give the quiz a title.');
    const questions = (q.questions || []).map(cleanQuestion_);
    if (!questions.length) fail_('Add at least one question.');
    const ids = {};
    questions.forEach((x, i) => { if (ids[x.id]) x.id = 'q' + Utilities.getUuid().slice(0, 6); ids[x.id] = 1; });
    const json = JSON.stringify(questions);
    if (json.length > 48000) fail_('This quiz is too long to save. Split it into two quizzes.');
    const sections = table_('Sections').rows.filter(s => (q.sections || []).indexOf(s.id) >= 0).map(s => s.id);
    if (!sections.length) fail_('Choose at least one section.');
    const s = settings_();
    const kind = ['practice', 'pretest', 'posttest'].indexOf(q.kind) >= 0 ? q.kind : 'practice';
    const row = {
      title: title, materialId: String(q.materialId || ''), subject: clean_(q.subject, 80), grade: String(q.grade || ''),
      sections: sections.join(','), term: TERM_IDS.indexOf(q.term) >= 0 ? q.term : s.currentTerm, topic: clean_(q.topic, 80),
      sy: /^\d{4}-\d{4}$/.test(q.sy || '') ? q.sy : s.schoolYear, questions: json, updated: now_(), kind: kind,
      pairId: kind === 'posttest' ? clean_(q.pairId, 40) : '', feedback: ['each', 'end', 'score'].indexOf(q.feedback) >= 0 ? q.feedback : (kind === 'practice' ? 'each' : 'score'),
      maxAttempts: q.maxAttempts === undefined || q.maxAttempts === null || q.maxAttempts === '' ? (kind === 'practice' ? '0' : '1') : String(Math.max(0, Math.min(20, Math.round(Number(q.maxAttempts) || 0))))
    };
    if (!row.subject) fail_('Choose a subject.');
    const action = req.op || 'none';
    const saved = withLock_(() => {
      const t = table_('Quizzes');
      let cur;
      if (q.id) {
        cur = own_(t.rows.find(x => x.id === q.id), user);
        Object.assign(cur, row);
      } else {
        cur = Object.assign({ id: id_('q'), teacherId: user.id, teacherName: user.name, status: 'draft', aiGenerated: q.aiGenerated ? '1' : '' }, row);
      }
      if (action !== 'none') Object.assign(cur, quizStatusPatch_(cur, action, req.publishAt, req.reviewed, user));
      if (q.id) update_('Quizzes', cur._row, cur); else insert_('Quizzes', cur);
      return cur;
    });
    if (action === 'publish' || action === 'schedule') log_(user.name, 'Quizzes', user.name + ' approved and ' + actionWord_(action, req.publishAt) + ' the quiz “' + title + '” (' + questions.length + ' questions).');
    return { quiz: publicQuiz_(saved) };
  },

  setQuizStatus: (req, user) => {
    const ids = Array.isArray(req.ids) ? req.ids : [req.id];
    const out = withLock_(() => {
      const t = table_('Quizzes');
      const list = t.rows.filter(q => ids.indexOf(q.id) >= 0).map(q => own_(q, user));
      if (!list.length) fail_('Choose at least one quiz.');
      const patches = list.map(q => ({ row: q._row, obj: quizStatusPatch_(q, req.op, req.publishAt, req.reviewed, user) }));
      updateMany_('Quizzes', patches);
      return list.map((q, i) => publicQuiz_(Object.assign(q, patches[i].obj)));
    });
    log_(user.name, 'Quizzes', user.name + ' ' + actionWord_(req.op, req.publishAt) + ' ' + (out.length === 1 ? 'the quiz “' + out[0].title + '”' : out.length + ' quizzes') + '.');
    return { quizzes: out };
  },

  deleteQuiz: (req, user) => {
    withLock_(() => {
      const t = table_('Quizzes');
      const q = own_(t.rows.find(x => x.id === req.id), user);
      t.sh.deleteRow(q._row);
      dirty_('Quizzes');
    });
    return {};
  },

  generateQuiz: (req, user) => {
    const key = aiKey_();
    if (!key) fail_('The AI quiz generator isn’t turned on yet. Ask the admin to add a Gemini API key under Settings.');
    const ids = (req.materialIds || []).slice(0, 5);
    const mats = table_('Materials').rows.filter(m => ids.indexOf(m.id) >= 0).map(m => own_(m, user));
    if (!mats.length) fail_('Choose at least one of your materials.');
    const o = req.options || {};
    const types = o.type === 'mixed' ? (o.mixTypes || []).filter(t => QTYPES.indexOf(t) >= 0) : [o.type].filter(t => QTYPES.indexOf(t) >= 0);
    if (!types.length) fail_('Choose at least one question type.');
    const count = Math.max(1, Math.min(50, Math.round(Number(o.count) || 10)));
    const bloom = (o.bloom || []).filter(b => BLOOM.indexOf(b) >= 0);
    const parts = [];
    let total = 0;
    mats.forEach(m => {
      const p = materialParts_(m);
      p.forEach(x => { total += x.inline_data ? x.inline_data.data.length * 0.75 : x.text.length; });
      Array.prototype.push.apply(parts, p);
    });
    if (total > MAX_AI_PDF_MB * 1048576) fail_('These materials are too large to read at once. Choose fewer or smaller files (up to ' + MAX_AI_PDF_MB + ' MB together).');
    const first = mats[0], s = settings_();
    parts.unshift({ text: quizPrompt_(first, types, o.type === 'mixed', count, o.difficulty, bloom, clean_(o.focus, 300), o.language, o.kind, s.schoolName) });
    const out = gemini_(parts);
    const list = Array.isArray(out.questions) ? out.questions : (Array.isArray(out) ? out : []);
    const questions = list.map(fromAi_).filter(Boolean).slice(0, count);
    if (!questions.length) fail_('The AI didn’t return usable questions. Try again, or choose fewer question types.');
    const secs = [];
    mats.forEach(m => m.sections.split(',').forEach(x => { if (x && secs.indexOf(x) < 0) secs.push(x); }));
    const kind = ['practice', 'pretest', 'posttest'].indexOf(o.kind) >= 0 ? o.kind : 'practice';
    const quiz = {
      id: id_('q'), title: clean_(out.title, 100) || ((kind === 'pretest' ? 'Pre-test: ' : kind === 'posttest' ? 'Post-test: ' : 'Practice quiz: ') + first.title).slice(0, 120),
      materialId: first.id, materialIds: mats.map(m => m.id).join(','), subject: first.subject, grade: first.grade, sections: secs.join(','), term: first.term, topic: first.topic, sy: first.sy || s.schoolYear,
      teacherId: user.id, teacherName: user.name, questions: JSON.stringify(questions), updated: now_(), status: 'draft', kind: kind, pairId: '',
      feedback: kind === 'practice' ? 'each' : 'score', maxAttempts: kind === 'practice' ? '0' : '1', aiGenerated: '1'
    };
    withLock_(() => insert_('Quizzes', quiz));
    log_(user.name, 'Quizzes', user.name + ' generated a draft quiz with AI from “' + first.title + '” (' + questions.length + ' questions). It needs review before students see it.');
    return { quiz: publicQuiz_(quiz), asked: count, got: questions.length };
  },

  gradingQueue: (req, user) => {
    const admin = user.role === 'admin';
    const quizzes = {};
    table_('Quizzes').rows.filter(q => admin || q.teacherId === user.id).forEach(q => quizzes[q.id] = q);
    const users = {}, secs = {};
    table_('Users').rows.forEach(u => users[u.id] = u);
    table_('Sections').rows.forEach(s => secs[s.id] = label_(s));
    const list = table_('Attempts').rows.filter(a => a.status === 'pending' && quizzes[a.quizId]).slice(0, 150).map(a => {
      const q = quizzes[a.quizId], qs = parse_(q.questions, []), res = normResults_(a, qs), resp = parse_(a.responses, {});
      const items = qs.filter(x => { const r = res.find(y => y.id === x.id); return r && r.f === null; }).map(x => ({
        id: x.id, type: x.type, q: x.q, rubric: x.rubric || '', model: x.model || '', final: x.final || [], max: qMax_(x), response: resp[x.id] === undefined ? '' : resp[x.id]
      }));
      const u = users[a.userId] || {};
      return { id: a.id, quizId: q.id, quizTitle: q.title, subject: q.subject, student: u.name || '(removed account)', section: secs[a.sectionId] || '', takenAt: a.takenAt, score: Number(a.score), maxScore: Number(a.maxScore), items: items };
    });
    return { attempts: list };
  },

  gradeAttempt: (req, user) => {
    return withLock_(() => {
      const a = table_('Attempts').rows.find(x => x.id === req.id);
      if (!a) fail_('That attempt no longer exists.');
      const q = own_(table_('Quizzes').rows.find(x => x.id === a.quizId), user);
      const qs = parse_(q.questions, []);
      const res = normResults_(a, qs);
      (req.grades || []).forEach(g => {
        const r = res.find(x => x.id === g.id);
        if (!r) return;
        const pts = Number(g.pts);
        if (g.pts === '' || g.pts === null || g.pts === undefined || isNaN(pts)) return;
        r.f = Math.max(0, Math.min(1, pts / (r.max || 1)));
        r.f = Math.round(r.f * 1000) / 1000;
        r.cmt = clean_(g.cmt, 500);
      });
      const sc = totals_(res);
      update_('Attempts', a._row, { results: JSON.stringify(res), score: String(sc.score), maxScore: String(sc.maxScore), pct: String(sc.pct), status: sc.status, gradedBy: user.name, gradedAt: now_() });
      return { status: sc.status, pct: sc.pct };
    });
  },

  teacherResults: (req, user) => {
    const admin = user.role === 'admin';
    const quizzes = table_('Quizzes').rows.filter(q => admin ? (!req.teacherId || q.teacherId === req.teacherId) : q.teacherId === user.id);
    const ids = new Set(quizzes.map(q => q.id));
    const attempts = table_('Attempts').rows.filter(a => ids.has(a.quizId));
    const users = {};
    table_('Users').rows.forEach(u => users[u.id] = u);
    const secs = {};
    table_('Sections').rows.forEach(s => secs[s.id] = label_(s));
    const students = table_('Users').rows.filter(u => u.role === 'student' && u.status === 'active');
    return { quizzes: quizzes.map(q => summarizeQuiz_(q, attempts.filter(a => a.quizId === q.id), users, secs, students)) };
  },

  materialStats: (req, user) => {
    const admin = user.role === 'admin';
    const mine = new Set(table_('Materials').rows.filter(m => admin || m.teacherId === user.id).map(m => m.id));
    const st = {};
    table_('Events').rows.forEach(e => {
      if (!e.materialId || !mine.has(e.materialId) || e.role !== 'student') return;
      const x = st[e.materialId] = st[e.materialId] || { views: 0, downloads: 0, dl: {}, vw: {}, last: '' };
      if (e.type === 'download' || e.type === 'save') { x.downloads++; x.dl[e.userId] = 1; }
      else if (e.type === 'view' || e.type === 'offlineview' || e.type === 'linkopen') { x.views++; x.vw[e.userId] = 1; }
      if (e.time > x.last) x.last = e.time;
    });
    const out = {};
    Object.keys(st).forEach(k => { const x = st[k]; out[k] = { views: x.views, downloads: x.downloads, downloaders: Object.keys(x.dl).length, viewers: Object.keys(x.vw).length, last: x.last }; });
    return { stats: out };
  },

  report: (req, user) => ({ report: report_(req, user) })
};

/* =====================================================================
 * Admin
 * ===================================================================== */
const ADMIN_API = {
  adminData: () => {
    const secs = {};
    table_('Sections').rows.forEach(s => secs[s.id] = s);
    const users = table_('Users').rows.map(u => {
      const p = publicUser_(u);
      p.status = u.status; p.created = u.created; p.lastActive = u.lastActive; p.codeEntered = u.codeEntered;
      p.section = secs[u.sectionId] ? label_(secs[u.sectionId]) : '';
      p.codeOk = !!(secs[u.sectionId] && secs[u.sectionId].code === u.codeEntered);
      return p;
    });
    const log = table_('Log').rows.slice(-300).reverse().map(l => ({ time: l.time, who: l.who, category: l.category, text: l.text, warn: l.warn === '1' }));
    return { users: users, log: log, backups: listBackups_() };
  },

  approve: (req, user) => setUserStatus_(req.id, 'active', user, 'approved'),
  reject: (req, user) => setUserStatus_(req.id, 'rejected', user, 'rejected'),
  setStatus: (req, user) => {
    if (req.status !== 'active' && req.status !== 'suspended') fail_('Unknown status.');
    return setUserStatus_(req.id, req.status, user, req.status === 'active' ? 'reactivated' : 'suspended');
  },

  resetPassword: (req, user) => {
    const pw = tempPassword_();
    const u = withLock_(() => {
      const u = table_('Users').rows.find(x => x.id === req.id);
      if (!u) fail_('That account no longer exists.');
      update_('Users', u._row, Object.assign({ mustChange: '1' }, pass_(pw)));
      return u;
    });
    clearSessions_(u.id);
    log_(user.name, 'Accounts', 'Password reset for ' + u.name + ' by ' + user.name + '.');
    return { tempPassword: pw };
  },

  createStaff: (req, user) => {
    const name = clean_(req.name, 80), username = String(req.username || '').trim().toLowerCase();
    const role = req.role === 'admin' ? 'admin' : 'teacher';
    if (!name) fail_('Enter the teacher’s name.');
    if (!/^[a-z0-9._@-]{3,60}$/.test(username)) fail_('Usernames use 3 to 60 letters, numbers, dots, dashes or @, with no spaces.');
    const pw = tempPassword_();
    withLock_(() => {
      if (table_('Users').rows.some(u => u.username && u.username.toLowerCase() === username)) fail_('That username is taken. Try another.');
      insert_('Users', Object.assign({ id: id_('u'), role: role, name: name, username: username, status: 'active', mustChange: '1', subjects: clean_(req.subjects, 300), created: now_() }, pass_(pw)));
    });
    log_(user.name, 'Accounts', (role === 'admin' ? 'Admin' : 'Teacher') + ' account created for ' + name + '.');
    return { tempPassword: pw };
  },

  updateStaff: (req, user) => withLock_(() => {
    const u = table_('Users').rows.find(x => x.id === req.id);
    if (!u || u.role === 'student') fail_('That teacher account no longer exists.');
    const patch = { subjects: clean_(req.subjects, 300) };
    if (req.name) patch.name = clean_(req.name, 80);
    update_('Users', u._row, patch);
    return {};
  }),

  updateStudent: (req, user) => {
    const out = withLock_(() => {
      const u = table_('Users').rows.find(x => x.id === req.id);
      if (!u || u.role !== 'student') fail_('That student account no longer exists.');
      const patch = {};
      if (req.name !== undefined) { patch.name = clean_(req.name, 80); if (patch.name.split(/\s+/).length < 2) fail_('Enter the full name (first and last name).'); }
      if (req.lrn !== undefined) {
        const lrn = String(req.lrn).trim();
        if (!/^\d{12}$/.test(lrn)) fail_('The LRN should be exactly 12 digits.');
        if (table_('Users').rows.some(x => x.lrn === lrn && x.id !== u.id && x.status !== 'rejected')) fail_('Another account already uses that LRN.');
        patch.lrn = lrn;
      }
      if (req.sectionId !== undefined) {
        const sec = table_('Sections').rows.find(s => s.id === req.sectionId);
        if (!sec) fail_('Choose a section.');
        patch.sectionId = sec.id;
      }
      update_('Users', u._row, patch);
      return u;
    });
    log_(user.name, 'Accounts', 'Student details updated for ' + out.name + '.');
    return {};
  },

  saveSection: (req, user) => {
    const grade = String(req.grade), strand = clean_(req.strand, 30), name = clean_(req.name, 30).replace(/\s+/g, '-');
    if (grade !== '11' && grade !== '12') fail_('Choose Grade 11 or 12.');
    if (!strand) fail_('Choose a strand.');
    if (!name) fail_('Enter the section name, for example A or Rizal.');
    const sy = /^\d{4}-\d{4}$/.test(req.sy || '') ? req.sy : settings_().schoolYear;
    return withLock_(() => {
      const t = table_('Sections');
      const dup = t.rows.find(s => s.grade === grade && s.strand === strand && s.name.toLowerCase() === name.toLowerCase() && (s.sy || sy) === sy && s.id !== req.id);
      if (dup) fail_('That section already exists for ' + sy + '.');
      if (req.id) {
        const s = t.rows.find(x => x.id === req.id);
        if (!s) fail_('That section no longer exists.');
        update_('Sections', s._row, { grade: grade, strand: strand, name: name, adviser: clean_(req.adviser, 80), sy: sy });
        return {};
      }
      const s = { id: id_('s'), grade: grade, strand: strand, name: name, code: classCode_(grade, strand, name), adviser: clean_(req.adviser, 80), sy: sy };
      insert_('Sections', s);
      log_(user.name, 'System', 'Section ' + label_(s) + ' added for ' + sy + '.');
      return { code: s.code };
    });
  },

  deleteSection: (req, user) => withLock_(() => {
    if (table_('Users').rows.some(u => u.sectionId === req.id && u.status !== 'rejected')) fail_('Students are still in this section. Move or remove them first.');
    const t = table_('Sections');
    const s = t.rows.find(x => x.id === req.id);
    if (s) { t.sh.deleteRow(s._row); dirty_('Sections'); }
    return {};
  }),

  newCode: (req, user) => withLock_(() => {
    const s = table_('Sections').rows.find(x => x.id === req.id);
    if (!s) fail_('That section no longer exists.');
    const code = classCode_(s.grade, s.strand, s.name);
    update_('Sections', s._row, { code: code });
    log_(user.name, 'Security', 'New class code made for ' + label_(s) + '. The old code no longer works.');
    return { code: code };
  }),

  saveSettings: (req, user) => {
    const strands = (req.strands || []).map(x => clean_(x, 30).toUpperCase()).filter(Boolean);
    const subjects = (req.subjects || []).map(x => clean_(x, 80)).filter(Boolean);
    if (!strands.length) fail_('Keep at least one strand.');
    if (TERM_IDS.indexOf(req.currentTerm) < 0) fail_('Choose the current term.');
    if (!/^\d{4}-\d{4}$/.test(req.schoolYear || '')) fail_('Write the school year like 2026-2027.');
    const td = {};
    TERM_IDS.forEach(t => {
      const d = (req.termDates || {})[t] || {};
      const okd = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '';
      td[t] = { start: okd(d.start), end: okd(d.end) };
      if (td[t].start && td[t].end && td[t].end < td[t].start) fail_(termName_(t) + ' ends before it starts.');
    });
    withLock_(() => {
      setSetting_('strands', strands);
      setSetting_('subjects', subjects);
      setSetting_('currentTerm', req.currentTerm);
      setSetting_('schoolYear', req.schoolYear);
      setSetting_('termDates', td);
    });
    log_(user.name, 'System', 'School settings updated (' + req.schoolYear + ', current term ' + termName_(req.currentTerm) + ').');
    return {};
  },

  saveBranding: (req, user) => {
    const b = req.branding || {};
    const hex = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v.toLowerCase() : '';
    const theme = { preset: clean_((b.theme || {}).preset, 20) || 'custom', primary: hex((b.theme || {}).primary) || '#0b6b55', highlight: hex((b.theme || {}).highlight) || '#f4c63d', header: (b.theme || {}).header === 'color' ? 'color' : 'plain' };
    const logo = String(b.logo || '');
    if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) fail_('The logo must be a PNG, JPG or WebP picture.');
    if (logo.length > 48000) fail_('The logo is too large. Choose a smaller picture.');
    const name = clean_(b.schoolName, 100);
    if (!name) fail_('Enter the school’s name.');
    withLock_(() => {
      setSetting_('schoolName', name);
      setSetting_('appName', clean_(b.appName, 30) || 'REVIEW+');
      setSetting_('address', clean_(b.address, 200));
      setSetting_('schoolHead', clean_(b.schoolHead, 80));
      setSetting_('schoolHeadPosition', clean_(b.schoolHeadPosition, 80) || 'School Principal');
      setSetting_('theme', theme);
      setSetting_('logo', logo);
    });
    log_(user.name, 'System', 'School branding updated.');
    return { branding: branding_() };
  },

  saveAi: (req, user) => {
    const props = PropertiesService.getScriptProperties();
    if (req.key !== undefined && req.key !== null) {
      const k = String(req.key).trim();
      if (k) { if (!/^[A-Za-z0-9_\-]{20,}$/.test(k)) fail_('That doesn’t look like a Gemini API key. Copy it again from Google AI Studio.'); props.setProperty('GEMINI_API_KEY', k); }
      else props.deleteProperty('GEMINI_API_KEY');
    }
    if (req.model !== undefined) {
      const m = String(req.model || '').trim() || AI_MODEL_DEFAULT;
      if (!/^[a-z0-9.\-]{3,60}$/.test(m)) fail_('Enter a model name like ' + AI_MODEL_DEFAULT + '.');
      withLock_(() => setSetting_('aiModel', m));
    }
    log_(user.name, 'System', 'AI quiz generator settings updated.');
    return { aiReady: !!aiKey_() };
  },

  testAi: () => {
    const out = gemini_([{ text: 'Reply with exactly this JSON: {"ok": true}' }]);
    if (!out || out.ok !== true) fail_('The AI answered, but not as expected. Try another model name.');
    return { message: 'The AI quiz generator is working.' };
  },

  exportAttempts: () => {
    const users = {}, secs = {}, quizzes = {};
    table_('Users').rows.forEach(u => users[u.id] = u);
    table_('Sections').rows.forEach(s => secs[s.id] = label_(s));
    table_('Quizzes').rows.forEach(q => quizzes[q.id] = q);
    const rows = table_('Attempts').rows.map(a => {
      const u = users[a.userId] || {}, q = quizzes[a.quizId] || {};
      return [a.takenAt, u.name || '', u.lrn || '', secs[a.sectionId] || '', q.title || '(deleted quiz)', kindName_(q.kind), q.subject || '', termName_(q.term), q.teacherName || '', a.score, a.maxScore || a.total, a.pct, a.status === 'pending' ? 'Waiting for teacher' : 'Complete'];
    });
    return { header: ['Taken at', 'Student', 'LRN', 'Section', 'Quiz', 'Kind', 'Subject', 'Term', 'Teacher', 'Score', 'Out of', 'Percent', 'Status'], rows: rows };
  },

  backupNow: (req, user) => {
    const b = backup_('Manual');
    log_(user.name, 'System', 'Manual backup saved: ' + b.name);
    return { backups: listBackups_() };
  }
};

/* =====================================================================
 * Access rules: what each person may see
 * ===================================================================== */
function effStatus_(x) {
  const st = x.status || 'draft';
  if (st === 'scheduled' && x.publishAt && new Date(x.publishAt).getTime() <= Date.now()) return 'published';
  return STATUSES.indexOf(st) >= 0 ? st : 'draft';
}
function isLive_(x) { return effStatus_(x) === 'published'; }
function inSection_(x, user) { return String(x.sections || '').split(',').indexOf(user.sectionId) >= 0 && !!user.sectionId; }

function canSeeMaterial_(m, user) {
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return m.teacherId === user.id || isLive_(m);
  return isLive_(m) && inSection_(m, user);
}
function canSeeQuiz_(q, user) {
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return q.teacherId === user.id || isLive_(q);
  return isLive_(q) && inSection_(q, user);
}

function release_(rel, at) {
  if (rel === 'publish') return { status: 'published', publishAt: '' };
  if (rel === 'schedule') {
    const t = new Date(at).getTime();
    if (isNaN(t)) fail_('Choose the date and time to publish.');
    if (t <= Date.now()) return { status: 'published', publishAt: '' };
    return { status: 'scheduled', publishAt: new Date(t).toISOString() };
  }
  return { status: 'draft', publishAt: '' };
}

function statusPatch_(m, action, at) {
  const p = { updated: now_() };
  if (action === 'publish') { p.status = 'published'; p.publishAt = ''; if (!m.publishedAt || effStatus_(m) !== 'published') p.publishedAt = now_(); }
  else if (action === 'schedule') {
    const r = release_('schedule', at);
    p.status = r.status; p.publishAt = r.publishAt;
    if (r.status === 'published') p.publishedAt = now_(); else p.publishedAt = r.publishAt;
  }
  else if (action === 'unpublish') { p.status = 'unpublished'; p.publishAt = ''; }
  else if (action === 'archive') { p.status = 'archived'; p.publishAt = ''; p.archivedAt = now_(); }
  else if (action === 'restore' || action === 'lock') { p.status = 'draft'; p.publishAt = ''; }
  else fail_('Unknown action.');
  return p;
}

function quizStatusPatch_(q, action, at, reviewed, user) {
  if ((action === 'publish' || action === 'schedule') && !q.approvedAt) {
    if (q.aiGenerated === '1' && reviewed !== true) fail_('Check every AI-written question, answer and explanation, then tick “I reviewed this quiz” before publishing.');
  }
  const p = statusPatch_(q, action, at);
  delete p.archivedAt;
  if (action === 'publish' || action === 'schedule') { p.approvedBy = user.name; p.approvedAt = now_(); }
  return p;
}

function statusWord_(m) { const st = effStatus_(m); return st === 'draft' ? 'locked draft' : st === 'scheduled' ? 'scheduled for ' + Utilities.formatDate(new Date(m.publishAt), TZ, 'MMM d, h:mm a') : st; }
function actionWord_(a, at) {
  return a === 'publish' ? 'published' : a === 'schedule' ? 'scheduled' + (at ? ' for ' + Utilities.formatDate(new Date(at), TZ, 'MMM d, h:mm a') : '') : a === 'unpublish' ? 'unpublished' : a === 'archive' ? 'archived' : 'locked';
}

/* =====================================================================
 * Quiz scoring (the app uses the same rules for instant feedback)
 * ===================================================================== */
function norm_(s) { return String(s === undefined || s === null ? '' : s).toLowerCase().replace(/['’₱,]/g, '').replace(/[^a-z0-9ñ. ]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim(); }
function num_(s) { const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; }
function matchAny_(accepted, r) {
  const n = norm_(r);
  if (!n) return false;
  return (accepted || []).some(a => {
    if (norm_(a) === n) return true;
    const x = num_(a), y = num_(r);
    const onlyNum = s => /^-?[\d,]*\.?\d+\s*[a-z%°²³/ ]{0,12}$/i.test(String(s).trim());
    return !isNaN(x) && !isNaN(y) && onlyNum(a) && onlyNum(r) && Math.abs(x - y) <= Math.max(1e-9, Math.abs(x) * 1e-3);
  });
}
function qMax_(q) {
  if (Number(q.pts) > 0) return Number(q.pts);
  return q.type === 'match' ? (q.pairs || []).length || 1 : q.type === 'enum' ? q.n || 1 : q.type === 'fill' ? (q.blanks || []).length || 1 : q.type === 'short' ? 2 : q.type === 'problem' ? 3 : q.type === 'essay' ? 5 : 1;
}
function hasText_(r) { return r !== undefined && r !== null && (typeof r === 'object' ? Object.keys(r).some(k => String(r[k] || '').trim()) : String(r).trim() !== ''); }
/** Returns the share of the question earned (0 to 1), or null when a teacher must check it. */
function autoScore_(q, r) {
  if (q.type === 'mc') return r !== undefined && r !== null && r !== '' && Number(r) === q.a ? 1 : 0;
  if (q.type === 'tf') return (r === true || r === 'true') === q.a && (r === true || r === false || r === 'true' || r === 'false') ? 1 : 0;
  if (q.type === 'id') return matchAny_(q.a, r) ? 1 : 0;
  if (q.type === 'match') { const arr = Array.isArray(r) ? r : []; let c = 0; q.pairs.forEach((p, k) => { if (arr[k] === p[1]) c++; }); return c / q.pairs.length; }
  if (q.type === 'enum') {
    const arr = (Array.isArray(r) ? r : []).map(norm_).filter(Boolean), hit = {};
    arr.forEach(v => q.groups.forEach((g, gi) => { if (!hit[gi] && g.some(a => norm_(a) === v)) hit[gi] = 1; }));
    return Math.min(Object.keys(hit).length, q.n) / q.n;
  }
  if (q.type === 'fill') { const arr = Array.isArray(r) ? r : []; let c = 0; q.blanks.forEach((b, k) => { if (matchAny_(b, arr[k])) c++; }); return c / q.blanks.length; }
  if (q.type === 'short') { if ((q.a || []).length) return matchAny_(q.a, r) ? 1 : (hasText_(r) ? null : 0); return hasText_(r) ? null : 0; }
  if (q.type === 'problem') {
    const fin = r && typeof r === 'object' ? r.final : r;
    if ((q.final || []).length && matchAny_(q.final, fin)) return 1;
    return hasText_(r) ? null : 0;
  }
  if (q.type === 'essay') return hasText_(r) ? null : 0;
  return 0;
}
function totals_(res) {
  let score = 0, max = 0, pending = false;
  res.forEach(r => { max += r.max; if (r.f === null || r.f === undefined) pending = true; else score += r.f * r.max; });
  score = Math.round(score * 100) / 100;
  return { score: score, maxScore: max, pct: max ? Math.round(score / max * 100) : 0, status: pending ? 'pending' : 'complete' };
}
function scoreAttempt_(qs, responses) {
  const results = qs.map(q => ({ id: q.id, f: autoScore_(q, responses[q.id]), max: qMax_(q) }));
  results.forEach(r => { if (r.f !== null) r.f = Math.round(r.f * 1000) / 1000; });
  return Object.assign({ results: results }, totals_(results));
}
/** Version 1 attempts stored {id, pts}; version 2 stores {id, f, max}. */
function normResults_(a, qs) {
  const raw = parse_(a.results, []);
  return raw.map(r => {
    if (r.f !== undefined) return { id: r.id, f: r.f, max: Number(r.max) || 1, cmt: r.cmt || '' };
    const q = (qs || []).find(x => x.id === r.id);
    return { id: r.id, f: Number(r.pts) || 0, max: q ? 1 : 1, cmt: '' };
  });
}
function publicAttempt_(a) {
  return { clientId: a.clientId, quizId: a.quizId, pct: Number(a.pct), score: Number(a.score), maxScore: Number(a.maxScore) || Number(a.total) || 0, status: a.status || 'complete', takenAt: a.takenAt, results: normResults_(a), gradedBy: a.gradedBy };
}

/* =====================================================================
 * Question checking
 * ===================================================================== */
function arr_(x) { return (Array.isArray(x) ? x : String(x === undefined || x === null ? '' : x).split(/[,;\n]/)).map(v => clean_(v, 200)).filter(Boolean); }
function alts_(x) { return (Array.isArray(x) ? x : String(x === undefined || x === null ? '' : x).split('/')).map(v => clean_(v, 200)).filter(Boolean); }

function cleanQuestion_(q, i) {
  const type = q.type;
  const out = {
    id: (clean_(q.id, 20) || ('q' + (i + 1))).replace(/[^\w-]/g, ''), type: type, q: clean_(q.q, 2000), exp: clean_(q.exp, 1500),
    comp: clean_(q.comp, 160), diff: DIFFS.indexOf(q.diff) >= 0 ? q.diff : '', bloom: BLOOM.indexOf(q.bloom) >= 0 ? q.bloom : '', topic: clean_(q.topic, 80)
  };
  if (!out.id) out.id = 'q' + (i + 1);
  const n = 'Question ' + (i + 1) + ': ';
  if (!out.q) fail_(n + 'write the question.');
  if (type === 'mc') {
    out.options = (q.options || []).map(o => clean_(o, 400)).filter(Boolean);
    if (out.options.length < 2) fail_(n + 'add at least two choices.');
    out.a = Number(q.a);
    if (!(out.a >= 0 && out.a < out.options.length)) fail_(n + 'mark the correct choice.');
  } else if (type === 'tf') {
    out.a = q.a === true || q.a === 'true';
  } else if (type === 'id') {
    out.a = arr_(q.a);
    if (!out.a.length) fail_(n + 'add at least one accepted answer.');
  } else if (type === 'match') {
    out.pairs = (q.pairs || []).map(p => [clean_(p[0], 200), clean_(p[1], 200)]).filter(p => p[0] && p[1]);
    if (out.pairs.length < 2) fail_(n + 'add at least two complete pairs.');
  } else if (type === 'enum') {
    out.groups = (q.groups || []).map(alts_).filter(g => g.length);
    out.n = Math.max(1, Math.min(20, Math.round(Number(q.n) || out.groups.length)));
    if (!out.groups.length) fail_(n + 'list the accepted answers.');
    if (out.groups.length < out.n) fail_(n + 'list at least ' + out.n + ' accepted answers, or ask for fewer.');
  } else if (type === 'fill') {
    const blanks = (out.q.match(/_{3,}/g) || []).length;
    if (!blanks) fail_(n + 'mark each blank with three underscores ___.');
    out.blanks = (q.blanks || []).map(alts_).slice(0, blanks);
    if (out.blanks.length < blanks || out.blanks.some(b => !b.length)) fail_(n + 'give an answer for every blank (' + blanks + ').');
  } else if (type === 'short') {
    out.a = arr_(q.a);
    out.model = clean_(q.model, 2000);
  } else if (type === 'problem') {
    out.model = clean_(q.model, 3000);
    out.final = arr_(q.final);
  } else if (type === 'essay') {
    out.rubric = clean_(q.rubric, 2000);
    out.model = clean_(q.model, 2000);
  } else fail_(n + 'unknown question format.');
  if (Number(q.pts) > 0) out.pts = Math.min(100, Math.round(Number(q.pts) * 2) / 2);
  return out;
}

/* =====================================================================
 * AI quiz generation (Google Gemini)
 * ===================================================================== */
function aiKey_() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }

function officeKind_(mime, name) {
  const ext = (String(name || '').split('.').pop() || '').toLowerCase();
  if (ext === 'pptx' || /presentationml/.test(mime || '')) return 'pptx';
  if (ext === 'docx' || /wordprocessingml/.test(mime || '')) return 'docx';
  if (ext === 'txt' || /^text\/plain/.test(mime || '')) return 'txt';
  return '';
}

function xmlText_(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d)).replace(/&amp;/g, '&'); }
function paras_(xml, tag) {
  const out = [];
  xml.split(new RegExp('</' + tag + ':p>')).forEach(p => {
    const t = [];
    const re = new RegExp('<' + tag + ':t(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + ':t>', 'g');
    let m;
    while ((m = re.exec(p))) t.push(xmlText_(m[1]));
    const line = t.join('').trim();
    if (line) out.push(line);
  });
  return out;
}

function officePages_(blob, kind) {
  if (kind === 'txt') return [{ n: 1, text: blob.getDataAsString().slice(0, 200000) }];
  let files;
  try { files = Utilities.unzip(blob.setContentType('application/zip')); } catch (e) { fail_('This file couldn’t be opened. Save it again as .pptx, .docx or PDF and replace it.'); }
  const byName = {};
  files.forEach(f => byName[f.getName()] = f);
  if (kind === 'docx') {
    const d = byName['word/document.xml'];
    return d ? [{ n: 1, text: paras_(d.getDataAsString(), 'w').join('\n') }] : [];
  }
  const nums = Object.keys(byName).map(k => (k.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  return nums.map(n => {
    const text = paras_(byName['ppt/slides/slide' + n + '.xml'].getDataAsString(), 'a');
    const note = byName['ppt/notesSlides/notesSlide' + n + '.xml'];
    const notes = note ? paras_(note.getDataAsString(), 'a').filter(l => !/^\d+$/.test(l)) : [];
    return { n: n, text: text.join('\n'), notes: notes.join('\n') };
  });
}

function materialParts_(m) {
  if (m.type === 'link' || !m.driveId) fail_('“' + m.title + '” is a web link. The AI can read PDF, PowerPoint (.pptx), Word (.docx), text and picture files.');
  const blob = DriveApp.getFileById(m.driveId).getBlob();
  const head = { text: '--- Learning material: “' + m.title + '” (' + m.subject + ', topic: ' + m.topic + ') ---' };
  const kind = officeKind_(m.mime, m.fileName);
  if (kind) {
    const pages = officePages_(blob, kind);
    const text = pages.map(p => (kind === 'pptx' ? 'Slide ' + p.n + ':\n' : '') + p.text + (p.notes ? '\nSpeaker notes: ' + p.notes : '')).join('\n\n').slice(0, 300000);
    if (text.replace(/\s/g, '').length < 40) fail_('“' + m.title + '” has almost no text to read. If its slides are pictures, save it as PDF and upload that instead.');
    return [head, { text: text }];
  }
  const mime = m.mime || blob.getContentType();
  if (mime === 'application/pdf' || /^image\/(png|jpeg|webp|heic|heif)$/.test(mime)) {
    if (blob.getBytes().length > MAX_AI_PDF_MB * 1048576) fail_('“' + m.title + '” is over ' + MAX_AI_PDF_MB + ' MB, which is too large for the AI to read.');
    return [head, { inline_data: { mime_type: mime, data: Utilities.base64Encode(blob.getBytes()) } }];
  }
  if (/\.ppt$|\.doc$/i.test(m.fileName)) fail_('“' + m.title + '” is an old Office file (.ppt or .doc). Open it, save it as .pptx, .docx or PDF, and replace the file.');
  fail_('The AI can’t read “' + m.title + '”. It can read PDF, PowerPoint (.pptx), Word (.docx), text and picture files.');
}

const TYPE_GUIDE_ = {
  mc: 'mc (Multiple Choice): {"type":"mc","q":"question","options":["A","B","C","D"],"answer":0}. Exactly 4 options. "answer" is the 0-based index of the ONE correct option. Distractors must be plausible but clearly wrong.',
  tf: 'tf (True or False): {"type":"tf","q":"statement","answer":true}. Mix true and false statements. Avoid "always/never" giveaways.',
  id: 'id (Identification): {"type":"id","q":"description or question","answers":["term","acceptable alternative"]}. The answer is a term, name or value of 1 to 4 words.',
  match: 'match (Matching Type): {"type":"match","q":"Match each ... with ...","pairs":[["item","its match"],["item","its match"]]}. 4 to 6 pairs from one category.',
  enum: 'enum (Enumeration): {"type":"enum","q":"Give N ...","n":N,"items":[["item","alternative wording"],["item"]]}. "items" lists every acceptable answer, at least N of them.',
  fill: 'fill (Fill in the Blanks): {"type":"fill","q":"A sentence from the lesson with ___ for each blank","blanks":[["answer for blank 1","alternative"]]}. 1 to 3 blanks; one inner list per ___ in order.',
  short: 'short (Short Answer): {"type":"short","q":"question answered in 1 to 3 sentences","model":"model answer","answers":[]}. Leave "answers" empty unless the answer is one exact word or number.',
  problem: 'problem (Problem-Solving): {"type":"problem","q":"problem with every value needed","model":"step-by-step solution","final":["final answer with unit"]}. Use only when the material has computations or procedures.',
  essay: 'essay (Essay): {"type":"essay","q":"essay prompt","rubric":"criteria and points, e.g. Content 3 pts, Organization 1 pt, Language 1 pt","model":"key points a strong answer includes","pts":5}.'
};

function quizPrompt_(m, types, mixed, count, diff, bloom, focus, lang, kind, school) {
  const kindName = kind === 'pretest' ? 'pre-test (given before the lesson, to find what students already know)' : kind === 'posttest' ? 'post-test (given after the lesson, to measure learning)' : 'practice quiz for review';
  const d = DIFFS.indexOf(diff) >= 0 ? 'All questions should be ' + diff + '.' : 'Use a balanced difficulty: about 30% Easy, 50% Average, 20% Difficult.';
  const b = bloom.length ? bloom : ['Remember', 'Understand', 'Apply'];
  const language = lang === 'fil' ? 'Write everything in Filipino.' : lang === 'en' ? 'Write everything in English.' : 'Write in the same language as the material.';
  return [
    'You write assessment items for ' + school + ', a Senior High School in the Philippines (DepEd K to 12).',
    'Write a ' + kindName + ' for Grade ' + m.grade + ' ' + m.subject + ', topic: ' + m.topic + '.',
    'Base every question ONLY on the learning material attached below. Do not use facts that are not in it.',
    'Write exactly ' + count + ' questions.',
    'Question types: ' + types.join(', ') + (mixed ? '. Use a balanced mix of these types, grouped by type.' : '.'),
    d,
    'Cognitive levels (Revised Bloom\'s Taxonomy): spread the questions across ' + b.join(', ') + '. Tag each question with exactly one level from that list.',
    focus ? 'Focus on these topics: ' + focus + '.' : '',
    language,
    'Every question also has: "explanation" (1 or 2 sentences for students on why the answer is correct; may be empty for essays), "competency" (the learning competency checked, a short phrase that starts with a verb, like "Determine the domain of a function"), "difficulty" ("Easy", "Average" or "Difficult"), "bloom" (one level), "topic" (the lesson topic).',
    'Formats:',
    types.map(t => '- ' + TYPE_GUIDE_[t]).join('\n'),
    'Check that every answer key is correct according to the material.',
    'Return ONLY JSON in this shape: {"title":"short quiz title","questions":[ ... ]}'
  ].filter(Boolean).join('\n');
}

function gemini_(parts) {
  const key = aiKey_();
  if (!key) fail_('The AI quiz generator isn’t turned on yet. Ask the admin to add a Gemini API key under Settings.');
  const model = settings_().aiModel || AI_MODEL_DEFAULT;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 32768 } })
    });
  } catch (e) { fail_('Couldn’t reach the AI service. Try again in a minute.'); }
  const code = res.getResponseCode();
  const body = parse_(res.getContentText(), {});
  if (code === 400 && /api key/i.test(JSON.stringify(body))) fail_('The Gemini API key isn’t valid. Ask the admin to check it under Settings.');
  if (code === 403) fail_('The Gemini API key was refused. Ask the admin to check that it’s active in Google AI Studio.');
  if (code === 404) fail_('The AI model “' + model + '” wasn’t found. Ask the admin to check the model name under Settings.');
  if (code === 429) fail_('The free AI limit is used up for now. Try again in a few minutes, or tomorrow.');
  if (code >= 500) fail_('The AI service is busy. Try again in a minute.');
  if (code !== 200) fail_('The AI service returned an error (' + code + '). Try again later.');
  const cand = (body.candidates || [])[0];
  if (!cand) fail_('The AI didn’t answer. The material may contain something it refuses to process.');
  const text = ((cand.content || {}).parts || []).map(p => p.text || '').join('');
  const json = parse_(text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, ''), null);
  if (!json) fail_(cand.finishReason === 'MAX_TOKENS' ? 'The AI ran out of room. Ask for fewer questions.' : 'The AI’s answer couldn’t be read. Try again.');
  return json;
}

function fromAi_(o, i) {
  if (!o || typeof o !== 'object') return null;
  const aliases = { multiple_choice: 'mc', multiplechoice: 'mc', mcq: 'mc', true_false: 'tf', truefalse: 'tf', identification: 'id', matching: 'match', matching_type: 'match', enumeration: 'enum', fill_in_the_blanks: 'fill', fill_in_the_blank: 'fill', fill_blank: 'fill', short_answer: 'short', problem_solving: 'problem', problemsolving: 'problem' };
  const t0 = String(o.type || '').toLowerCase().replace(/[\s-]/g, '_');
  const type = QTYPES.indexOf(t0) >= 0 ? t0 : aliases[t0];
  if (!type) return null;
  const q = { id: 'q' + (i + 1), type: type, q: o.q || o.question || o.prompt, exp: o.explanation || o.exp || '', comp: o.competency || o.comp || '', diff: o.difficulty || o.diff, bloom: o.bloom || o.cognitive_level, topic: o.topic || '' };
  const list = x => Array.isArray(x) ? x : (x === undefined || x === null || x === '' ? [] : [x]);
  if (type === 'mc') {
    q.options = list(o.options || o.choices).map(String);
    let a = o.answer !== undefined ? o.answer : o.correct;
    if (typeof a === 'string' && !/^\d+$/.test(a)) { const k = q.options.findIndex(x => norm_(x) === norm_(a) || norm_(x).indexOf(norm_(a) + ' ') === 0); a = k >= 0 ? k : /^[a-d]$/i.test(a) ? 'abcd'.indexOf(a.toLowerCase()) : -1; }
    q.a = Number(a);
  } else if (type === 'tf') q.a = o.answer === true || /^(true|tama)$/i.test(String(o.answer));
  else if (type === 'id') q.a = list(o.answers || o.answer).map(String);
  else if (type === 'match') q.pairs = list(o.pairs).map(p => Array.isArray(p) ? p : [p.item || p.left || p.term, p.match || p.right || p.definition]);
  else if (type === 'enum') { q.groups = list(o.items || o.answers).map(x => list(x).map(String)); q.n = Number(o.n) || q.groups.length; }
  else if (type === 'fill') q.blanks = list(o.blanks || o.answers).map(x => list(x).map(String));
  else if (type === 'short') { q.a = list(o.answers).map(String); q.model = o.model || o.model_answer || ''; }
  else if (type === 'problem') { q.model = o.model || o.solution || ''; q.final = list(o.final || o.answer).map(String); }
  else if (type === 'essay') { q.rubric = o.rubric || ''; q.model = o.model || ''; q.pts = Number(o.pts) || 5; }
  if (typeof q.diff === 'string') q.diff = q.diff.charAt(0).toUpperCase() + q.diff.slice(1).toLowerCase();
  if (q.diff === 'Medium' || q.diff === 'Moderate') q.diff = 'Average';
  if (q.diff === 'Hard') q.diff = 'Difficult';
  if (typeof q.bloom === 'string') { q.bloom = q.bloom.charAt(0).toUpperCase() + q.bloom.slice(1).toLowerCase(); if (q.bloom === 'Analyse') q.bloom = 'Analyze'; }
  try { return cleanQuestion_(q, i); } catch (e) { return null; }
}

/* =====================================================================
 * Reports
 * ===================================================================== */
function report_(req, user) {
  const from = new Date(req.from).getTime(), to = new Date(req.to).getTime();
  if (isNaN(from) || isNaN(to) || to < from) fail_('Choose a valid date range.');
  const inP = t => { const x = new Date(t).getTime(); return x >= from && x <= to; };
  const day = t => Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd');
  const s = settings_();
  const admin = user.role === 'admin';
  const tid = admin ? (req.teacherId || '') : user.id;
  const scoped = !!tid;
  const users = table_('Users').rows, secs = table_('Sections').rows, mats = table_('Materials').rows, quizzes = table_('Quizzes').rows;
  const atts = table_('Attempts').rows, evs = table_('Events').rows, fbs = table_('Feedback').rows;
  const secMap = {}, userMap = {};
  secs.forEach(x => secMap[x.id] = x);
  users.forEach(u => userMap[u.id] = u);
  const M = scoped ? mats.filter(m => m.teacherId === tid) : mats;
  const Q = scoped ? quizzes.filter(q => q.teacherId === tid) : quizzes;
  const mIds = {}, qIds = {}, qMap = {}, qParsed = {};
  M.forEach(m => mIds[m.id] = m);
  Q.forEach(q => { qIds[q.id] = q; qMap[q.id] = q; qParsed[q.id] = parse_(q.questions, []); });
  const split = x => String(x || '').split(',').filter(Boolean);
  let scopeSecs = null;
  if (scoped) { scopeSecs = {}; M.concat(Q).forEach(x => split(x.sections).forEach(id => scopeSecs[id] = 1)); }
  const students = users.filter(u => u.role === 'student' && u.status === 'active' && (!scopeSecs || scopeSecs[u.sectionId]));
  const studentIds = {};
  students.forEach(u => studentIds[u.id] = 1);
  const isView = t => t === 'view' || t === 'offlineview' || t === 'linkopen';
  const isDl = t => t === 'download' || t === 'save';

  const E = evs.filter(e => e.role === 'student' && inP(e.time) && (!scoped || (e.materialId && mIds[e.materialId])));
  const A = atts.filter(a => qIds[a.quizId] && inP(a.takenAt)).map(a => Object.assign({}, a, { res: normResults_(a, qParsed[a.quizId]), pctN: Number(a.pct) }));
  const Acomplete = A.filter(a => a.status !== 'pending');

  const active = {}, daily = {};
  const dget = k => daily[k] = daily[k] || { active: {}, logins: 0, views: 0, downloads: 0, attempts: 0 };
  E.forEach(e => {
    active[e.userId] = 1;
    const d = dget(day(e.time));
    d.active[e.userId] = 1;
    if (e.type === 'login') d.logins++;
    if (isView(e.type)) d.views++;
    if (isDl(e.type)) d.downloads++;
  });
  A.forEach(a => { active[a.userId] = 1; const d = dget(day(a.takenAt)); d.active[a.userId] = 1; d.attempts++; });
  const days = Object.keys(daily).sort().map(k => ({ date: k, active: Object.keys(daily[k].active).length, logins: daily[k].logins, views: daily[k].views, downloads: daily[k].downloads, attempts: daily[k].attempts }));

  // Resources
  const mstat = {};
  M.forEach(m => mstat[m.id] = { views: 0, downloads: 0, dl: {}, vw: {} });
  E.forEach(e => {
    const x = mstat[e.materialId];
    if (!x) return;
    if (isDl(e.type)) { x.downloads++; x.dl[e.userId] = 1; }
    if (isView(e.type)) { x.views++; x.vw[e.userId] = 1; }
  });
  const pubAt = m => m.publishedAt || (effStatus_(m) === 'published' ? m.date : '');
  const matRows = M.map(m => {
    const x = mstat[m.id];
    return { id: m.id, title: m.title, subject: m.subject, topic: m.topic, term: m.term, grade: m.grade, type: m.type, teacher: m.teacherName, status: effStatus_(m), views: x.views, downloads: x.downloads, downloaders: Object.keys(x.dl).length, viewers: Object.keys(x.vw).length };
  });
  const liveRows = matRows.filter(r => r.status === 'published');
  const most = matRows.filter(r => r.views + r.downloads > 0).sort((a, b) => (b.views + b.downloads) - (a.views + a.downloads)).slice(0, 10);
  const least = liveRows.slice().sort((a, b) => (a.views + a.downloads) - (b.views + b.downloads)).slice(0, 10);
  const byStatus = {};
  STATUSES.forEach(st => byStatus[st] = 0);
  M.forEach(m => byStatus[effStatus_(m)]++);
  const bySubjectRes = {};
  matRows.forEach(r => { const b = bySubjectRes[r.subject] = bySubjectRes[r.subject] || { subject: r.subject, materials: 0, live: 0, views: 0, downloads: 0 }; b.materials++; if (r.status === 'published') b.live++; b.views += r.views; b.downloads += r.downloads; });
  const allDl = {};
  E.forEach(e => { if (isDl(e.type)) allDl[e.userId] = 1; });

  // Teachers
  let teachers = [];
  if (!scoped) {
    teachers = users.filter(u => u.role === 'teacher' && u.status === 'active').map(t => {
      const tm = mats.filter(m => m.teacherId === t.id), tq = quizzes.filter(q => q.teacherId === t.id);
      const mine = {};
      tm.forEach(m => mine[m.id] = 1);
      const up = tm.filter(m => inP(m.date)).length, pub = tm.filter(m => pubAt(m) && inP(pubAt(m))).length;
      const qp = tq.filter(q => q.publishedAt && inP(q.publishedAt)).length;
      return {
        name: t.name, subjects: t.subjects, uploads: up, published: pub, quizzesPublished: qp, liveMaterials: tm.filter(isLive_).length, liveQuizzes: tq.filter(isLive_).length,
        downloads: evs.filter(e => e.role === 'student' && isDl(e.type) && mine[e.materialId] && inP(e.time)).length, lastActive: t.lastActive, active: up + pub + qp > 0
      };
    }).sort((a, b) => (b.uploads + b.published + b.quizzesPublished) - (a.uploads + a.published + a.quizzesPublished) || a.name.localeCompare(b.name));
  }

  // Assessment
  const assigned = q => students.filter(u => split(q.sections).indexOf(u.sectionId) >= 0).length;
  const quizRows = Q.filter(q => isLive_(q) || A.some(a => a.quizId === q.id)).map(q => {
    const qa = A.filter(a => a.quizId === q.id), qc = qa.filter(a => a.status !== 'pending');
    const st = {};
    qa.forEach(a => st[a.userId] = 1);
    const n = assigned(q), done = Object.keys(st).length;
    return { id: q.id, title: q.title, subject: q.subject, topic: q.topic, term: q.term, kind: q.kind || 'practice', teacher: q.teacherName, status: effStatus_(q), attempts: qa.length, students: done, assigned: n, completion: n ? Math.round(done / n * 100) : null, avg: qc.length ? Math.round(avg_(qc.map(a => a.pctN))) : null, pending: qa.length - qc.length };
  });
  const group = (keyFn, list) => {
    const g = {};
    list.forEach(a => { const q = qMap[a.quizId]; if (!q) return; const k = keyFn(q, a); if (!k) return; const x = g[k] = g[k] || { key: k, n: 0, sum: 0, st: {} }; x.n++; x.sum += a.pctN; x.st[a.userId] = 1; });
    return Object.keys(g).map(k => ({ key: k, attempts: g[k].n, students: Object.keys(g[k].st).length, avg: Math.round(g[k].sum / g[k].n) })).sort((a, b) => a.key.localeCompare(b.key));
  };
  const bySubject = group(q => q.subject, Acomplete);
  const byTopic = group(q => q.subject + ' › ' + (q.topic || 'General'), Acomplete);
  const byTerm = group(q => termName_(q.term), Acomplete);
  const bySectionScore = group((q, a) => secMap[a.sectionId] ? label_(secMap[a.sectionId]) : '', Acomplete);

  // Question level: Bloom levels and competencies
  const bloom = {}, comp = {};
  A.forEach(a => {
    const q = qMap[a.quizId];
    const qs = qParsed[a.quizId];
    a.res.forEach(r => {
      if (r.f === null || r.f === undefined) return;
      const x = qs.find(y => y.id === r.id);
      if (!x) return;
      if (x.bloom) { const b = bloom[x.bloom] = bloom[x.bloom] || { sum: 0, n: 0 }; b.sum += r.f; b.n++; }
      if (x.comp) {
        const k = q.subject + '|' + x.comp;
        const c = comp[k] = comp[k] || { comp: x.comp, subject: q.subject, sum: 0, n: 0, st: {} };
        c.sum += r.f; c.n++;
        const ps = c.st[a.userId] = c.st[a.userId] || { e: 0, m: 0 };
        ps.e += r.f * r.max; ps.m += r.max;
      }
    });
  });
  const byBloom = BLOOM.filter(b => bloom[b]).map(b => ({ level: b, answers: bloom[b].n, pct: Math.round(bloom[b].sum / bloom[b].n * 100) }));
  const competencies = Object.keys(comp).map(k => {
    const c = comp[k], st = Object.keys(c.st);
    const mastered = st.filter(u => c.st[u].m && c.st[u].e / c.st[u].m >= 0.75).length;
    return { comp: c.comp, subject: c.subject, pct: Math.round(c.sum / c.n * 100), answers: c.n, students: st.length, mastered: mastered, mastery: st.length ? Math.round(mastered / st.length * 100) : 0 };
  }).sort((a, b) => a.subject.localeCompare(b.subject) || a.pct - b.pct);
  const gaps = competencies.filter(c => c.pct < 75 && c.answers >= 3).sort((a, b) => a.pct - b.pct).slice(0, 15);

  // Pre-test and post-test
  const allAtt = atts.filter(a => a.status !== 'pending');
  const firstBy = (quizId, onlyInP) => {
    const o = {};
    allAtt.filter(a => a.quizId === quizId && (!onlyInP || inP(a.takenAt))).sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt))).forEach(a => { if (!o[a.userId]) o[a.userId] = Number(a.pct); });
    return o;
  };
  const prepost = Q.filter(q => q.kind === 'posttest' && q.pairId).map(post => {
    const pre = quizzes.find(x => x.id === post.pairId);
    if (!pre) return null;
    const a = firstBy(pre.id, false), b = firstBy(post.id, true);
    const both = Object.keys(b).filter(u => a[u] !== undefined);
    if (!both.length) return { pre: pre.title, post: post.title, subject: post.subject, students: 0 };
    const avgPre = avg_(both.map(u => a[u])), avgPost = avg_(both.map(u => b[u]));
    return { pre: pre.title, post: post.title, subject: post.subject, students: both.length, avgPre: Math.round(avgPre), avgPost: Math.round(avgPost), gain: Math.round(avgPost - avgPre), improved: both.filter(u => b[u] > a[u]).length, passedPost: both.filter(u => b[u] >= 75).length };
  }).filter(Boolean);

  // Feedback
  const F = fbs.filter(f => inP(f.time) && (!scopeSecs || scopeSecs[f.sectionId]));
  const fAvg = k => { const v = F.map(f => Number(f[k])).filter(x => x >= 1); return v.length ? Math.round(avg_(v) * 10) / 10 : null; };
  const dist = [1, 2, 3, 4, 5].map(n => F.filter(f => Number(f.overall) === n).length);
  const connect = {};
  F.forEach(f => { if (f.connect) connect[f.connect] = (connect[f.connect] || 0) + 1; });
  const feedback = {
    responses: F.length, useful1: fAvg('useful1'), useful2: fAvg('useful2'), access1: fAvg('access1'), access2: fAvg('access2'), overall: fAvg('overall'), dist: dist, connect: connect,
    satisfied: F.length ? Math.round(F.filter(f => Number(f.overall) >= 4).length / F.length * 100) : null,
    comments: F.filter(f => f.comment).sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 25).map(f => ({ time: f.time, section: secMap[f.sectionId] ? label_(secMap[f.sectionId]) : '', text: f.comment }))
  };

  // Sections
  const sectionRows = secs.filter(x => (!scopeSecs || scopeSecs[x.id]) && (x.sy || s.schoolYear) === (req.sy || s.schoolYear)).map(x => {
    const st = students.filter(u => u.sectionId === x.id);
    const act = st.filter(u => active[u.id]).length;
    const sa = Acomplete.filter(a => a.sectionId === x.id);
    return { section: label_(x), adviser: x.adviser, students: st.length, active: act, activeRate: st.length ? Math.round(act / st.length * 100) : 0, attempts: A.filter(a => a.sectionId === x.id).length, avg: sa.length ? Math.round(avg_(sa.map(a => a.pctN))) : null, downloads: E.filter(e => isDl(e.type) && e.sectionId === x.id).length };
  }).sort((a, b) => a.section.localeCompare(b.section));

  const takers = {};
  A.forEach(a => takers[a.userId] = 1);
  const liveQuizRows = quizRows.filter(r => r.status === 'published' && r.assigned);
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), generatedAt: now_(), scope: scoped ? (userMap[tid] || {}).name || 'Teacher' : 'Whole school', schoolYear: s.schoolYear,
    counts: {
      students: students.length, activeStudents: Object.keys(active).length, logins: E.filter(e => e.type === 'login').length,
      appOpens: days.reduce((x, d) => x + d.active, 0), views: E.filter(e => isView(e.type)).length, downloads: E.filter(e => isDl(e.type)).length, downloaders: Object.keys(allDl).length,
      teachers: teachers.length, activeTeachers: teachers.filter(t => t.active).length,
      materials: M.length, uploaded: M.filter(m => inP(m.date)).length, publishedInPeriod: M.filter(m => pubAt(m) && inP(pubAt(m))).length, byStatus: byStatus,
      quizzes: Q.filter(isLive_).length, attempts: A.length, quizTakers: Object.keys(takers).length, pendingChecks: A.length - Acomplete.length,
      avgScore: Acomplete.length ? Math.round(avg_(Acomplete.map(a => a.pctN))) : null,
      completion: liveQuizRows.length ? Math.round(avg_(liveQuizRows.map(r => r.completion))) : null,
      pendingApprovals: admin && !scoped ? users.filter(u => u.status === 'pending').length : 0
    },
    days: days, materials: matRows, most: most, least: least, bySubjectRes: Object.keys(bySubjectRes).sort().map(k => bySubjectRes[k]),
    teachers: teachers, quizzes: quizRows, bySubject: bySubject, byTopic: byTopic, byTerm: byTerm, bySection: bySectionScore, byBloom: byBloom,
    competencies: competencies, gaps: gaps, prepost: prepost, feedback: feedback, sections: sectionRows
  };
}

function avg_(list) { return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0; }

function summarizeQuiz_(q, attempts, users, secs, students) {
  const questions = parse_(q.questions, []);
  const stats = {};
  questions.forEach(x => stats[x.id] = { sum: 0, n: 0 });
  const bySec = {}, byStudent = {}, bloom = {};
  let pending = 0;
  attempts.forEach(a => {
    const res = normResults_(a, questions);
    res.forEach(r => {
      if (!stats[r.id] || r.f === null || r.f === undefined) return;
      stats[r.id].sum += Number(r.f); stats[r.id].n++;
      const x = questions.find(y => y.id === r.id);
      if (x && x.bloom) { const b = bloom[x.bloom] = bloom[x.bloom] || { sum: 0, n: 0 }; b.sum += r.f; b.n++; }
    });
    if (a.status === 'pending') { pending++; }
    const sk = secs[a.sectionId] || 'No section';
    bySec[sk] = bySec[sk] || { sum: 0, n: 0 };
    if (a.status !== 'pending') { bySec[sk].sum += Number(a.pct); bySec[sk].n++; }
    const st = byStudent[a.userId] = byStudent[a.userId] || { tries: 0, best: 0, first: null, last: '', lastPct: 0 };
    st.tries++; st.best = Math.max(st.best, Number(a.pct));
    if (st.first === null || a.takenAt < st.firstAt) { st.first = Number(a.pct); st.firstAt = a.takenAt; }
    if (a.takenAt > st.last) { st.last = a.takenAt; st.lastPct = Number(a.pct); }
  });
  const done = attempts.filter(a => a.status !== 'pending');
  const avg = done.length ? Math.round(done.reduce((s, a) => s + Number(a.pct), 0) / done.length) : 0;
  const sections = String(q.sections || '').split(',').filter(Boolean);
  const assigned = students.filter(u => sections.indexOf(u.sectionId) >= 0).length;
  return {
    id: q.id, title: q.title, subject: q.subject, topic: q.topic, term: q.term, kind: q.kind || 'practice', status: effStatus_(q), attempts: attempts.length, students: Object.keys(byStudent).length, assigned: assigned,
    completion: assigned ? Math.round(Object.keys(byStudent).length / assigned * 100) : null, avg: avg, pending: pending,
    questions: questions.map(x => ({ id: x.id, q: x.q, type: x.type, comp: x.comp, bloom: x.bloom, n: stats[x.id].n, rate: stats[x.id].n ? Math.round(stats[x.id].sum / stats[x.id].n * 100) : null })),
    bloom: BLOOM.filter(b => bloom[b]).map(b => ({ level: b, pct: Math.round(bloom[b].sum / bloom[b].n * 100), n: bloom[b].n })),
    sections: Object.keys(bySec).sort().filter(k => bySec[k].n).map(k => ({ section: k, avg: Math.round(bySec[k].sum / bySec[k].n), n: bySec[k].n })),
    roster: Object.keys(byStudent).map(id => {
      const u = users[id] || {};
      return { name: u.name || '(removed account)', lrn: u.lrn || '', section: secs[u.sectionId] || '', tries: byStudent[id].tries, first: byStudent[id].first, best: byStudent[id].best, last: byStudent[id].last, lastPct: byStudent[id].lastPct };
    }).sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
  };
}

/* =====================================================================
 * Helpers
 * ===================================================================== */
function fail_(msg, code) { const e = new Error(msg); e.userMsg = msg; e.code = code || ''; throw e; }

function auth_(token) {
  if (!token) fail_('Please sign in again.', 'auth');
  const cache = CacheService.getScriptCache();
  let userId = cache.get('tok:' + token);
  if (!userId) {
    const s = table_('Sessions').rows.find(x => x.token === token);
    if (!s || new Date(s.expires).getTime() < Date.now()) fail_('Your sign-in expired. Please sign in again.', 'auth');
    userId = s.userId;
    cache.put('tok:' + token, userId, 21600);
  }
  const u = table_('Users').rows.find(x => x.id === userId);
  if (!u || u.status !== 'active') fail_('This account can’t sign in right now. Talk to the admin.', 'auth');
  return u;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) fail_('The server is busy. Try again in a few seconds.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) fail_('The database isn’t set up yet. Open the Sheet and choose Review Hub > Set up or update database.');
  return sh;
}

function head_(name) {
  if (MEMO_[name]) return MEMO_[name].head;
  const sh = sheet_(name);
  const lc = sh.getLastColumn();
  return lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(String) : SHEETS[name].slice();
}

function table_(name) {
  if (MEMO_[name]) return MEMO_[name];
  const sh = sheet_(name);
  const last = sh.getLastRow(), lc = Math.max(1, sh.getLastColumn());
  const vals = last >= 1 ? sh.getRange(1, 1, last, lc).getValues() : [SHEETS[name]];
  const head = vals[0].map(String);
  if (SHEETS[name].some(h => head.indexOf(h) < 0)) fail_('The database needs updating. Open the Sheet and choose Review Hub > Set up or update database.');
  const rows = vals.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { if (h) o[h] = fromCell_(r[j]); });
    return o;
  }).filter(o => SHEETS[name].some(h => o[h] !== ''));
  MEMO_[name] = { sh: sh, rows: rows, head: head };
  return MEMO_[name];
}
function dirty_(name) { delete MEMO_[name]; }

function fromCell_(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.charAt(0) === ZW ? s.slice(1) : s;
}

function toCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? '1' : '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? ZW + s : s;
}

function insert_(name, obj) { insertMany_(name, [obj]); }

function insertMany_(name, list) {
  if (!list.length) return;
  const sh = sheet_(name), head = head_(name);
  const start = sh.getLastRow() + 1;
  const rng = sh.getRange(start, 1, list.length, head.length);
  rng.setNumberFormat('@');
  rng.setValues(list.map(o => head.map(h => toCell_(o[h]))));
  dirty_(name);
}

function update_(name, row, obj) { updateMany_(name, [{ row: row, obj: obj }]); }

function updateMany_(name, patches) {
  if (!patches.length) return;
  const sh = sheet_(name), head = head_(name);
  const rows = patches.map(p => p.row);
  const lo = Math.min.apply(null, rows), hi = Math.max.apply(null, rows);
  const rng = sh.getRange(lo, 1, hi - lo + 1, head.length);
  const vals = rng.getValues().map(r => r.map(fromCell_));
  patches.forEach(p => {
    const r = vals[p.row - lo];
    head.forEach((h, j) => { if (h && Object.prototype.hasOwnProperty.call(p.obj, h)) r[j] = p.obj[h]; });
  });
  rng.setNumberFormat('@');
  rng.setValues(vals.map(r => r.map(toCell_)));
  dirty_(name);
}

function settings_() {
  const out = {};
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  if (!sh || sh.getLastRow() < 1) return out;
  table_('Settings').rows.forEach(r => { out[r.key] = parse_(r.value, r.value); });
  return out;
}

function setSetting_(key, value) {
  const t = table_('Settings');
  const v = JSON.stringify(value);
  const r = t.rows.find(x => x.key === key);
  if (r) update_('Settings', r._row, { value: v }); else insert_('Settings', { key: key, value: v });
}

function branding_() {
  const s = settings_();
  return { schoolName: s.schoolName || DEFAULTS.schoolName, appName: s.appName || 'REVIEW+', address: s.address || '', logo: s.logo || '', theme: s.theme || DEFAULTS.theme, schoolHead: s.schoolHead || '', schoolHeadPosition: s.schoolHeadPosition || 'School Principal' };
}

function currentSections_() {
  const sy = settings_().schoolYear;
  return table_('Sections').rows.filter(x => !x.sy || x.sy === sy);
}

function parse_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
function now_() { return new Date().toISOString(); }
function id_(p) { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function clean_(s, max) { return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max || 200); }
function validDate_(d) { const t = new Date(d); return isNaN(t.getTime()) || t.getTime() > Date.now() + 6e5 ? now_() : t.toISOString(); }
/** Keeps students' answers small enough for one Sheet cell. */
function capJson_(o, max) {
  const cut = (v, n) => {
    if (typeof v === 'string') return v.slice(0, n);
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
    if (Array.isArray(v)) return v.slice(0, 50).map(x => typeof x === 'string' ? x.slice(0, 500) : (typeof x === 'number' || typeof x === 'boolean') ? x : '');
    if (v && typeof v === 'object') return { final: String(v.final || '').slice(0, 500), work: String(v.work || '').slice(0, n) };
    return '';
  };
  const build = n => {
    const out = {};
    Object.keys(o || {}).slice(0, 120).forEach(k => { out[String(k).slice(0, 20)] = cut(o[k], n); });
    return JSON.stringify(out);
  };
  let s = build(6000);
  if (s.length > max) s = build(1500);
  if (s.length > max) s = build(300);
  return s.length > max ? '{}' : s;
}
function termName_(t) { return { T1: 'Term 1', T2: 'Term 2', T3: 'Term 3' }[t] || 'Term 1'; }
function kindName_(k) { return k === 'pretest' ? 'Pre-test' : k === 'posttest' ? 'Post-test' : 'Practice'; }

function hash_(pw, salt) {
  let h = String(salt) + '|' + String(pw);
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return 'h1$' + h;
}
function pass_(pw) { const salt = Utilities.getUuid(); return { salt: salt, passHash: hash_(pw, salt) }; }

function tempPassword_() {
  const words = ['Narra', 'Molave', 'Anahaw', 'Mango', 'Tarsier', 'Kalabaw', 'Bangus', 'Sampaguita', 'Agila', 'Banaba', 'Ilang', 'Dalandan'];
  return words[Math.floor(Math.random() * words.length)] + '-' + (1000 + Math.floor(Math.random() * 9000));
}

function classCode_(grade, strand, name) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 4; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
  return (strand.replace(/[^A-Za-z]/g, '').slice(0, 4) + grade + name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)).toUpperCase() + '-' + r;
}

function label_(s) { return s.grade + ' ' + s.strand + '-' + s.name; }
function publicSection_(s) { return { id: s.id, grade: s.grade, strand: s.strand, name: s.name, label: label_(s), adviser: s.adviser, sy: s.sy }; }
function publicUser_(u) {
  return { id: u.id, role: u.role, name: u.name, lrn: u.lrn, username: u.username, sectionId: u.sectionId, mustChange: u.mustChange === '1', subjects: u.subjects };
}
function publicMaterial_(m) {
  const st = effStatus_(m);
  return {
    id: m.id, title: m.title, subject: m.subject, grade: m.grade, sections: String(m.sections || '').split(',').filter(Boolean), term: m.term, topic: m.topic, sy: m.sy,
    keywords: m.keywords, type: m.type, fileName: m.fileName, mime: m.mime, size: Number(m.size || 0), url: m.url, desc: m.desc,
    teacherId: m.teacherId, teacherName: m.teacherName, date: m.date, updated: m.updated, allowOffline: m.allowOffline === '1',
    status: st, publishAt: m.publishAt, publishedAt: m.publishedAt || (st === 'published' ? m.publishAt : '')
  };
}
function publicQuiz_(q) {
  const st = effStatus_(q);
  return {
    id: q.id, title: q.title, materialId: q.materialId, materialIds: String(q.materialIds || q.materialId || '').split(',').filter(Boolean), subject: q.subject, grade: q.grade, sections: String(q.sections || '').split(',').filter(Boolean),
    term: q.term, topic: q.topic, sy: q.sy, teacherId: q.teacherId, teacherName: q.teacherName, status: st, publishAt: q.publishAt, updated: q.updated,
    kind: q.kind || 'practice', pairId: q.pairId, feedback: q.feedback || 'each', maxAttempts: Number(q.maxAttempts || 0), aiGenerated: q.aiGenerated === '1', approvedBy: q.approvedBy, approvedAt: q.approvedAt,
    questions: typeof q.questions === 'string' ? parse_(q.questions, []) : (q.questions || [])
  };
}

function own_(item, user) {
  if (!item) fail_('That item no longer exists. Refresh and try again.');
  if (user.role !== 'admin' && item.teacherId !== user.id) fail_('Only the teacher who made this can change it.');
  return item;
}

function kind_(mime, name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  mime = String(mime || '');
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/presentation|powerpoint/.test(mime) || ['ppt', 'pptx', 'odp', 'key'].indexOf(ext) >= 0) return 'slides';
  if (/sheet|excel/.test(mime) || ['xls', 'xlsx', 'ods', 'csv'].indexOf(ext) >= 0) return 'sheet';
  if (/word|opendocument\.text|rtf|text\/plain/.test(mime) || ['doc', 'docx', 'odt', 'rtf', 'txt'].indexOf(ext) >= 0) return 'doc';
  if (mime.indexOf('image/') === 0) return 'image';
  if (mime.indexOf('audio/') === 0) return 'audio';
  if (mime.indexOf('video/') === 0) return 'video';
  return 'file';
}

function saveFile_(req, grade, sections, term, subject, topic, sy) {
  if (!req.b64 || !req.fileName) fail_('Choose a file to upload.');
  const bytes = Utilities.base64Decode(req.b64);
  if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) fail_('That file is over ' + MAX_UPLOAD_MB + ' MB. Share long videos as a YouTube link instead.');
  const fileName = clean_(req.fileName, 120).replace(/[\\/:*?"<>|]/g, '_');
  const mime = String(req.mime || 'application/octet-stream');
  const folder = folderFor_(grade, sections, term, subject, topic, sy);
  const file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));
  return { type: kind_(mime, fileName), url: '', fileName: fileName, mime: mime, size: String(bytes.length), driveId: file.getId() };
}

function folderFor_(grade, sections, term, subject, topic, sy) {
  const s = settings_();
  let folder;
  try { folder = DriveApp.getFolderById(s.rootFolderId); } catch (e) { fail_('The Review Hub folder is missing from Google Drive. Run Review Hub > Set up or update database again.'); }
  const all = table_('Sections').rows.filter(x => x.grade === grade && (!x.sy || x.sy === sy)).map(x => x.strand).filter((v, i, a) => a.indexOf(v) === i);
  const strands = sections.map(x => x.strand).filter((v, i, a) => a.indexOf(v) === i);
  const strandName = strands.length >= all.length ? 'All strands' : strands.join(' + ');
  ['SY ' + (sy || s.schoolYear), 'Grade ' + grade, strandName, termName_(term), subject, topic].forEach(name => {
    name = String(name).replace(/[\\/]/g, '-');
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function setUserStatus_(id, status, admin, verb) {
  const u = withLock_(() => {
    const u = table_('Users').rows.find(x => x.id === id);
    if (!u) fail_('That account no longer exists.');
    if (u.id === admin.id) fail_('You can’t change your own account status.');
    update_('Users', u._row, { status: status });
    return u;
  });
  if (status !== 'active') clearSessions_(u.id);
  log_(admin.name, status === 'suspended' ? 'Security' : 'Accounts', u.name + ' ' + verb + ' by ' + admin.name + '.', status === 'suspended');
  return {};
}

function clearSessions_(userId) {
  const cache = CacheService.getScriptCache();
  withLock_(() => {
    const t = table_('Sessions');
    const gone = t.rows.filter(s => s.userId === userId || new Date(s.expires).getTime() < Date.now());
    gone.forEach(s => cache.remove('tok:' + s.token));
    gone.map(s => s._row).sort((a, b) => b - a).forEach(r => t.sh.deleteRow(r));
    dirty_('Sessions');
  });
}

function cleanSessions_() {
  withLock_(() => {
    const t = table_('Sessions');
    t.rows.filter(s => new Date(s.expires).getTime() < Date.now()).map(s => s._row).sort((a, b) => b - a).forEach(r => t.sh.deleteRow(r));
    dirty_('Sessions');
  });
}

function log_(who, category, text, warn) {
  try { withLock_(() => insert_('Log', { time: now_(), who: who, category: category, text: text, warn: warn ? '1' : '' })); } catch (e) { }
}

function backup_(kind) {
  const s = settings_();
  let folder;
  try { folder = DriveApp.getFolderById(s.backupFolderId); } catch (e) { fail_('The Backups folder is missing. Run Review Hub > Set up or update database again.'); }
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH-mm');
  const name = 'Review Hub backup ' + stamp + ' (' + kind + ')';
  DriveApp.getFileById(SpreadsheetApp.getActive().getId()).makeCopy(name, folder);
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(KEEP_BACKUPS).forEach(f => f.setTrashed(true));
  return { name: name };
}

function listBackups_() {
  const s = settings_();
  const out = [];
  try {
    const it = DriveApp.getFolderById(s.backupFolderId).getFiles();
    while (it.hasNext()) { const f = it.next(); out.push({ name: f.getName(), created: f.getDateCreated().toISOString(), url: f.getUrl() }); }
  } catch (e) { }
  return out.sort((a, b) => b.created.localeCompare(a.created)).slice(0, KEEP_BACKUPS);
}
