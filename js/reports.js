/* REVIEW+ dashboards and the consolidated Project REVIEW+ report. */
'use strict';

/* ---------------- periods ---------------- */
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
function syRange() {
  const s = C().settings, td = s.termDates || {};
  const starts = TERM_IDS.map(k => (td[k] || {}).start).filter(Boolean).sort(), ends = TERM_IDS.map(k => (td[k] || {}).end).filter(Boolean).sort();
  const y = Number(String(s.schoolYear || '').slice(0, 4)) || new Date().getFullYear();
  return { from: starts.length ? parseYmd(starts[0]) : new Date(y, 5, 1), to: ends.length ? endOfDay(parseYmd(ends[ends.length - 1])) : new Date(y + 1, 4, 31, 23, 59, 59) };
}
function termRange(t) {
  const d = (C().settings.termDates || {})[t] || {};
  if (!d.start || !d.end) return null;
  return { from: parseYmd(d.start), to: endOfDay(parseYmd(d.end)) };
}
const PRESET_LABELS = { today: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', term: 'This term', sy: 'This school year', last30: 'Last 30 days', custom: 'Custom dates' };
function presetRange(p, from, to) {
  const now = new Date();
  if (p === 'today') return { from: startOfDay(now), to: endOfDay(now), label: 'Today, ' + fmtLong(now) };
  if (p === 'week') { const d = startOfDay(now); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return { from: d, to: endOfDay(now), label: 'Week of ' + fmtLong(d) }; }
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now), label: now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) };
  if (p === 'quarter') { const q = Math.floor(now.getMonth() / 3); return { from: new Date(now.getFullYear(), q * 3, 1), to: endOfDay(now), label: 'Q' + (q + 1) + ' ' + now.getFullYear() + ' (' + ['January–March', 'April–June', 'July–September', 'October–December'][q] + ')' }; }
  if (p === 'term') { const t = C().settings.currentTerm, r = termRange(t); return r ? Object.assign(r, { label: TERMS[t] + ', SY ' + C().settings.schoolYear }) : null; }
  if (p === 'sy') return Object.assign(syRange(), { label: 'School year ' + C().settings.schoolYear });
  if (p === 'last30') { const d = startOfDay(now); d.setDate(d.getDate() - 29); return { from: d, to: endOfDay(now), label: 'Last 30 days' }; }
  if (p === 'custom' && from && to) return { from: parseYmd(from), to: endOfDay(parseYmd(to)), label: fmtLong(parseYmd(from)) + ' to ' + fmtLong(parseYmd(to)) };
  return null;
}
async function fetchReport(range, teacherId) {
  const key = range.from.toISOString() + range.to.toISOString() + (teacherId || '');
  const r = await api('report', { from: range.from.toISOString(), to: range.to.toISOString(), teacherId: teacherId || '' }, { timeout: 120000 });
  r.report.key = key; r.report.label = range.label;
  return r.report;
}

/* ---------------- charts ---------------- */
function buckets(days, from, to) {
  const span = (to - from) / 864e5;
  const unit = span <= 35 ? 'day' : span <= 200 ? 'week' : 'month';
  const keyOf = d => { const x = parseYmd(d); if (unit === 'day') return d; if (unit === 'week') { const k = new Date(x); k.setDate(k.getDate() - (k.getDay() + 6) % 7); return ymd(k); } return d.slice(0, 7); };
  const all = [];
  const cur = startOfDay(from);
  while (cur <= to) { const k = keyOf(ymd(cur)); if (!all.includes(k)) all.push(k); cur.setDate(cur.getDate() + 1); if (all.length > 400) break; }
  const map = {};
  all.forEach(k => map[k] = { key: k, active: 0, logins: 0, views: 0, downloads: 0, attempts: 0 });
  days.forEach(d => { const k = keyOf(d.date); const b = map[k]; if (!b) return; ['active', 'logins', 'views', 'downloads', 'attempts'].forEach(f => b[f] += d[f]); });
  const label = k => unit === 'day' ? parseYmd(k).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : unit === 'week' ? 'Wk ' + parseYmd(k).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : new Date(k + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
  return { unit: unit, list: all.map(k => Object.assign(map[k], { label: label(k) })) };
}
function barChart(list, field, title, unitWord) {
  const W = 640, H = 190, padL = 34, padB = 30, padT = 14, n = list.length || 1, max = Math.max(1, ...list.map(b => b[field]));
  const step = Math.ceil(max / 4), top = step * 4, bw = (W - padL - 8) / n;
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  const every = Math.ceil(n / 8);
  const ticks = [0, 1, 2, 3, 4].map(i => i * step);
  const total = list.reduce((s, b) => s + b[field], 0), peak = list.reduce((m, b) => b[field] > m[field] ? b : m, list[0] || { label: '', [field]: 0 });
  return `<figure style="margin:0"><figcaption class="spread"><b>${esc(title)}</b><span class="small muted">${unitWord === 'peak' ? (peak[field] ? 'most: ' + peak[field] + ' (' + esc(peak.label) + ')' : 'none yet') : total.toLocaleString() + ' ' + esc(unitWord)}</span></figcaption>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    ${ticks.map(t => `<line x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t}</text>`).join('')}
    ${list.map((b, i) => `<rect x="${padL + i * bw + bw * 0.15}" y="${y(b[field])}" width="${Math.max(1, bw * 0.7)}" height="${Math.max(0, H - padB - y(b[field]))}" rx="2" fill="var(--accent)"><title>${esc(b.label)}: ${b[field]}</title></rect>${i % every === 0 ? `<text x="${padL + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(b.label)}</text>` : ''}`).join('')}
    </svg></figure>`;
}
const meter = (v, label, right) => `<div class="bar"><div class="lab"><span>${label}</span><span>${right}</span></div><div class="track"><i class="${v >= 75 ? 'good' : v >= 60 ? 'mid' : 'low'}" style="width:${Math.max(0, Math.min(100, v))}%"></i></div></div>`;
const tile = (v, label, sub) => `<div class="tile"><b>${v}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;

/* ---------------- dashboard ---------------- */
function periodPicker(id, preset, from, to, extra) {
  const termOk = !!termRange(C().settings.currentTerm);
  return `<div class="row" style="align-items:flex-end">
    <label class="field" style="width:auto;min-width:180px"><span>Period</span><select id="${id}Preset">${Object.keys(PRESET_LABELS).filter(k => k !== 'term' || termOk).map(k => opt(k, PRESET_LABELS[k], preset)).join('')}</select></label>
    ${preset === 'custom' ? `<label class="field" style="width:auto"><span>From</span><input type="date" id="${id}From" value="${esc(from)}"></label><label class="field" style="width:auto"><span>To</span><input type="date" id="${id}To" value="${esc(to)}"></label>` : ''}
    ${extra || ''}<button class="btn" data-act="${id}go">Show</button></div>${!termOk ? '<p class="small muted">Add term dates under Settings to see “This term”.</p>' : ''}`;
}
function teacherPicker(id, cur) {
  if (!isAdmin()) return '';
  const ts = [...new Map(C().materials.concat(C().quizzes).map(x => [x.teacherId, x.teacherName])).entries()].filter(x => x[0]);
  return `<label class="field" style="width:auto;min-width:180px"><span>Scope</span><select id="${id}Teacher">${opt('', 'Whole school', cur)}${ts.map(([k, n]) => opt(k, n, cur)).join('')}</select></label>`;
}
async function loadDash() {
  const d = ST.dash;
  const range = presetRange(d.preset, d.from, d.to);
  if (!range) { d.error = 'Choose both dates.'; render(); return; }
  if (!navigator.onLine) { d.error = 'The dashboard needs internet.'; render(); return; }
  ST.loading.dash = true; d.error = '';
  try { d.data = await fetchReport(range, d.teacher); d.range = range; } catch (e) { d.error = e.message; }
  finally { ST.loading.dash = false; if (ST.tab === 'dash') render(); }
}
V.dash = function () {
  const d = ST.dash, R = d.data;
  const head = `<div class="spread"><div><h1>${isAdmin() && !d.teacher ? 'School dashboard' : 'My dashboard'}</h1><p class="small muted">${R ? esc(R.label) + ' · ' + esc(R.scope) : 'Usage, participation and results'}</p></div></div>
    ${periodPicker('dash', d.preset, d.from, d.to, teacherPicker('dash', d.teacher))}${d.error ? `<p class="err">${esc(d.error)}</p>` : ''}`;
  if (!R) { if (!ST.loading.dash && !d.error) loadDash(); return head + (d.error ? '' : '<p class="muted"><span class="spinner"></span> Loading…</p>'); }
  const k = R.counts, b = buckets(R.days, d.range.from, d.range.to);
  const admin = isAdmin() && !d.teacher;
  const fb = R.feedback;
  return head + `
    <div class="tiles">
      ${tile(k.activeStudents + '<span class="small muted"> / ' + k.students + '</span>', 'Active students', pct(k.activeStudents, k.students) + '% of ' + (admin ? 'registered students' : 'students in your sections'))}
      ${admin ? tile(k.logins, 'Sign-ins', 'plus app opens on ' + plural(k.appOpens, 'student-day')) : ''}
      ${tile(k.downloads, 'Downloads', plural(k.downloaders, 'unique student'))}
      ${tile(k.views, 'Resource views', 'opened online or offline')}
      ${admin ? tile(k.activeTeachers + '<span class="small muted"> / ' + k.teachers + '</span>', 'Teachers participating', 'uploaded or published this period') : ''}
      ${tile(k.uploaded, 'Resources uploaded', k.byStatus.published + ' published now · ' + k.byStatus.draft + ' locked')}
      ${tile(k.quizTakers + '<span class="small muted"> / ' + k.students + '</span>', 'Quiz participation', pct(k.quizTakers, k.students) + '% of students took a quiz')}
      ${tile(pctTxt(k.completion), 'Completion rate', 'average across published quizzes')}
      ${tile(pctTxt(k.avgScore), 'Average score', plural(k.attempts, 'attempt') + (k.pendingChecks ? ' · ' + k.pendingChecks + ' waiting for checking' : ''))}
      ${tile(fb.overall === null ? '–' : fb.overall + '<span class="small muted"> / 5</span>', 'Student satisfaction', plural(fb.responses, 'response'))}
      ${admin && k.pendingApprovals ? tile(k.pendingApprovals, 'Sign-ups to approve', '<button class="btn small" data-act="gotab" data-id="approvals">Open</button>') : ''}
    </div>
    <article class="panel"><div class="spread"><h2>Trends</h2><span class="small muted">per ${b.unit}</span></div><div class="cols">${barChart(b.list, 'active', 'Active students', 'peak')}${barChart(b.list, 'downloads', 'Downloads', 'downloads')}${barChart(b.list, 'attempts', 'Quiz attempts', 'attempts')}${barChart(b.list, 'views', 'Resource views', 'views')}</div></article>
    <div class="cols"><article class="panel"><h2>Most accessed</h2>${matTable(R.most, true) || '<p class="muted small">No student activity in this period.</p>'}</article>
    <article class="panel"><h2>Least accessed (published)</h2>${matTable(R.least, true) || '<p class="muted small">No published materials yet.</p>'}</article></div>
    ${admin && R.teachers.length ? `<article class="panel"><h2>Teacher participation</h2><div class="tbl-wrap"><table><thead><tr><th>Teacher</th><th class="num">Uploaded</th><th class="num">Published</th><th class="num">Quizzes published</th><th class="num">Live materials</th><th class="num">Student downloads</th><th>Last active</th></tr></thead><tbody>${R.teachers.map(t => `<tr><td>${esc(t.name)}${t.active ? '' : ' <span class="pill info">No activity</span>'}</td><td class="num">${t.uploads}</td><td class="num">${t.published}</td><td class="num">${t.quizzesPublished}</td><td class="num">${t.liveMaterials}</td><td class="num">${t.downloads}</td><td class="small">${t.lastActive ? fmtDate(t.lastActive) : 'Never'}</td></tr>`).join('')}</tbody></table></div></article>` : ''}
    <article class="panel"><h2>Quiz participation and completion</h2>${R.quizzes.length ? `<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>Kind</th><th class="num">Students</th><th class="num">Completion</th><th class="num">Average</th></tr></thead><tbody>${R.quizzes.slice().sort((a, b) => (a.completion ?? 999) - (b.completion ?? 999)).map(q => `<tr><td>${esc(q.title)}<br><span class="small muted">${esc(q.subject)} · ${termName(q.term)}${q.status !== 'published' ? ' · ' + STATUS[q.status][0] : ''}</span></td><td class="small">${esc(KINDS[q.kind])}</td><td class="num">${q.students} / ${q.assigned}</td><td class="num">${pctTxt(q.completion)}</td><td class="num">${pctTxt(q.avg)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No published quizzes yet.</p>'}</article>
    <div class="cols"><article class="panel"><h2>Results by subject</h2>${R.bySubject.length ? `<div class="bars">${R.bySubject.map(s => meter(s.avg, esc(s.key), s.avg + '% · ' + plural(s.students, 'student'))).join('')}</div>` : '<p class="muted small">No scored attempts yet.</p>'}</article>
    <article class="panel"><h2>By cognitive level</h2>${R.byBloom.length ? `<div class="bars">${R.byBloom.map(x => meter(x.pct, esc(x.level), x.pct + '% correct')).join('')}</div>` : '<p class="muted small">Tag questions with Bloom’s levels to see this.</p>'}</article></div>
    ${R.byTopic.length ? `<article class="panel"><h2>Results by topic</h2><div class="bars">${R.byTopic.map(s => meter(s.avg, esc(s.key), s.avg + '% · ' + plural(s.attempts, 'attempt'))).join('')}</div></article>` : ''}
    ${R.prepost.length ? `<article class="panel"><h2>Pre-test and post-test</h2>${prepostTable(R.prepost)}</article>` : ''}
    <article class="panel"><h2>Competency mastery</h2><p class="small muted">Mastery means a student got at least 75% of the points on that competency’s questions.</p>${R.competencies.length ? compTable(R.competencies) : '<p class="muted small">Tag quiz questions with competencies to see mastery.</p>'}</article>
    ${R.sections.length ? `<article class="panel"><h2>Sections</h2>${sectionTable(R.sections)}</article>` : ''}
    <article class="panel"><h2>Student feedback</h2>${feedbackBlock(fb)}</article>
    <div class="row no-print"><button class="btn" data-act="dashcsv">Download materials data (CSV)</button><button class="btn" data-act="dashcsvq">Download quiz data (CSV)</button><button class="btn primary" data-act="tab" data-id="reports">Make a full report</button></div>`;
};
function matTable(list, short) {
  if (!list.length) return '';
  return `<div class="tbl-wrap"><table><thead><tr><th>Material</th><th class="num">Views</th><th class="num">Downloads</th><th class="num">Students</th></tr></thead><tbody>${list.map(m => `<tr><td>${esc(m.title)}<br><span class="small muted">${esc(m.subject)} · ${termName(m.term)}${short ? '' : ' · ' + esc(m.teacher)}</span></td><td class="num">${m.views}</td><td class="num">${m.downloads}</td><td class="num">${Math.max(m.downloaders, m.viewers)}</td></tr>`).join('')}</tbody></table></div>`;
}
function prepostTable(list) {
  return `<div class="tbl-wrap"><table><thead><tr><th>Post-test (compared with pre-test)</th><th class="num">Students</th><th class="num">Pre-test</th><th class="num">Post-test</th><th class="num">Improvement</th><th class="num">Improved</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(p.post)}<br><span class="small muted">vs ${esc(p.pre)} · ${esc(p.subject)}</span></td><td class="num">${p.students}</td><td class="num">${p.students ? p.avgPre + '%' : '–'}</td><td class="num">${p.students ? p.avgPost + '%' : '–'}</td><td class="num"><b>${p.students ? (p.gain >= 0 ? '+' : '') + p.gain + ' pts' : '–'}</b></td><td class="num">${p.students ? pct(p.improved, p.students) + '%' : '–'}</td></tr>`).join('')}</tbody></table></div>`;
}
function compTable(list) {
  return `<div class="tbl-wrap"><table><thead><tr><th>Competency</th><th class="num">Correct</th><th class="num">Students mastered</th></tr></thead><tbody>${list.map(c => `<tr><td>${esc(c.comp)}<br><span class="small muted">${esc(c.subject)}</span></td><td class="num"><span class="pill ${c.pct >= 75 ? 'ok' : c.pct >= 60 ? 'warn' : 'bad'}">${c.pct}%</span></td><td class="num">${c.mastered} / ${c.students} (${c.mastery}%)</td></tr>`).join('')}</tbody></table></div>`;
}
function sectionTable(list) {
  return `<div class="tbl-wrap"><table><thead><tr><th>Section</th><th class="num">Students</th><th class="num">Active</th><th class="num">Downloads</th><th class="num">Quiz attempts</th><th class="num">Average</th></tr></thead><tbody>${list.map(s => `<tr><td>${esc(s.section)}<br><span class="small muted">${esc(s.adviser)}</span></td><td class="num">${s.students}</td><td class="num">${s.active} (${s.activeRate}%)</td><td class="num">${s.downloads}</td><td class="num">${s.attempts}</td><td class="num">${pctTxt(s.avg)}</td></tr>`).join('')}</tbody></table></div>`;
}
const FB_LABELS = { useful1: 'Materials helped me understand the lessons', useful2: 'Practice quizzes helped me prepare for exams', access1: 'It’s easy to find the materials I need', access2: 'I can use the materials with no or slow internet', overall: 'Overall satisfaction' };
function feedbackBlock(fb) {
  if (!fb.responses) return '<p class="muted small">No feedback yet in this period. Students can give feedback from My progress.</p>';
  const tot = Object.values(fb.connect).reduce((s, x) => s + x, 0);
  return `<p class="small">${plural(fb.responses, 'response')} · ${fb.satisfied}% satisfied or very satisfied (4 or 5 out of 5).</p>
    <div class="bars">${Object.keys(FB_LABELS).map(k => fb[k] === null ? '' : meter(fb[k] / 5 * 100, esc(FB_LABELS[k]), fb[k] + ' / 5')).join('')}</div>
    ${tot ? `<h3>How students get online</h3><div class="bars">${Object.keys(fb.connect).sort((a, b) => fb.connect[b] - fb.connect[a]).map(c => `<div class="bar"><div class="lab"><span>${esc(c)}</span><span>${pct(fb.connect[c], tot)}%</span></div><div class="track"><i class="alt" style="width:${pct(fb.connect[c], tot)}%"></i></div></div>`).join('')}</div>` : ''}
    ${fb.comments.length ? `<h3>Recent comments</h3><ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${fb.comments.slice(0, 8).map(c => `<li>“${esc(c.text)}” <span class="muted">· ${esc(c.section)}</span></li>`).join('')}</ul>` : ''}`;
}

/* ---------------- recommendations ---------------- */
function recommend(R) {
  const out = [], k = R.counts;
  R.gaps.slice(0, 4).forEach(g => out.push(`Re-teach “${g.comp}” in ${g.subject}: students answered ${g.pct}% correctly and only ${g.mastery}% reached mastery. Follow up with a short practice quiz or a post-test.`));
  if (k.students && pct(k.activeStudents, k.students) < 60) out.push(`Only ${pct(k.activeStudents, k.students)}% of students used ${appName()} in this period. Ask advisers to remind their classes, and schedule time on school Wi-Fi for students to save materials offline.`);
  const lowSecs = R.sections.filter(s => s.students >= 5 && s.activeRate < 50);
  if (lowSecs.length) out.push(`Follow up with the advisers of ${lowSecs.slice(0, 5).map(s => s.section).join(', ')}, where fewer than half of the students were active.`);
  const lowQ = R.quizzes.filter(q => q.status === 'published' && q.assigned >= 5 && q.completion !== null && q.completion < 50);
  if (lowQ.length) out.push(`Raise quiz completion: ${lowQ.slice(0, 4).map(q => '“' + q.title + '” (' + q.completion + '%)').join(', ')} were taken by fewer than half of the assigned students.`);
  const unused = R.least.filter(m => m.views + m.downloads === 0);
  if (unused.length) out.push(`Promote or review ${plural(unused.length, 'published material')} that no student opened, such as “${unused[0].title}”. Check that the title and topic match what students search for.`);
  if (k.byStatus && k.byStatus.draft + k.byStatus.unpublished > 0) out.push(`${plural(k.byStatus.draft + k.byStatus.unpublished, 'material is', 'materials are')} still locked. Review and publish ${k.byStatus.draft + k.byStatus.unpublished === 1 ? 'it' : 'those'} that students need.`);
  if (R.teachers.length && pct(k.activeTeachers, k.teachers) < 70) out.push(`${k.teachers - k.activeTeachers} of ${k.teachers} teachers didn’t upload or publish anything in this period. Offer a short orientation on uploading and making quizzes.`);
  R.prepost.filter(p => p.students >= 5 && p.gain < 5).forEach(p => out.push(`Scores barely changed between “${p.pre}” and “${p.post}” (${p.gain >= 0 ? '+' : ''}${p.gain} points). Review how the lesson was taught before moving on.`));
  const fb = R.feedback;
  if (fb.responses >= 5 && fb.access2 !== null && fb.access2 < 3.5) out.push(`Students rated offline access ${fb.access2} out of 5. Encourage saving materials while on Wi-Fi, and keep files small, for example PDFs instead of long videos.`);
  if (fb.responses >= 5 && fb.access1 !== null && fb.access1 < 3.5) out.push(`Students find it hard to locate materials (${fb.access1} out of 5). Use clear titles, topics and search keywords when uploading.`);
  const rare = fb.connect && (fb.connect['Rarely online'] || 0) + (fb.connect['School Wi-Fi only'] || 0);
  const tot = fb.connect ? Object.values(fb.connect).reduce((s, x) => s + x, 0) : 0;
  if (tot >= 5 && pct(rare, tot) >= 30) out.push(`${pct(rare, tot)}% of students who answered are rarely online outside school. Set aside class time on school Wi-Fi for saving materials and syncing quiz results.`);
  if (!fb.responses) out.push(`Collect student feedback: ask students to answer the short feedback form under My progress.`);
  const best = R.competencies.filter(c => c.answers >= 5 && c.pct >= 85).sort((a, b) => b.pct - a.pct)[0];
  if (best) out.push(`Keep the approach used for “${best.comp}” in ${best.subject}, where students scored ${best.pct}%.`);
  if (!out.length) out.push('Keep the current practices. Continue monitoring usage and results each month.');
  return out;
}

/* ---------------- consolidated report ---------------- */
V.reports = function () {
  const rp = ST.rep || (ST.rep = { type: 'month', month: ymd(new Date()).slice(0, 7), quarter: String(Math.floor(new Date().getMonth() / 3) + 1), year: String(new Date().getFullYear()), term: C().settings.currentTerm, from: '', to: '', teacher: '', data: null, recs: '', notes: '' });
  const years = [0, 1, 2].map(i => String(new Date().getFullYear() - i));
  const form = `<form class="panel no-print" id="repForm" novalidate><h2>Project ${esc(appName())} report</h2><p class="small muted">A consolidated report on resource use and student progress, ready to print, save as PDF or edit in Word.</p>
    <div class="row" style="align-items:flex-end"><label class="field" style="width:auto;min-width:170px"><span>Report</span><select id="rpType">${opt('month', 'Monthly', rp.type)}${opt('quarter', 'Quarterly', rp.type)}${opt('term', 'Per term', rp.type)}${opt('sy', 'School year', rp.type)}${opt('custom', 'Custom dates', rp.type)}</select></label>
    ${rp.type === 'month' ? `<label class="field" style="width:auto"><span>Month</span><input type="month" id="rpMonth" value="${esc(rp.month)}"></label>` : ''}
    ${rp.type === 'quarter' ? `<label class="field" style="width:auto"><span>Quarter</span><select id="rpQuarter">${['January–March', 'April–June', 'July–September', 'October–December'].map((l, i) => opt(String(i + 1), 'Q' + (i + 1) + ' (' + l + ')', rp.quarter)).join('')}</select></label><label class="field" style="width:auto"><span>Year</span><select id="rpYear">${years.map(y => opt(y, y, rp.year)).join('')}</select></label>` : ''}
    ${rp.type === 'term' ? `<label class="field" style="width:auto"><span>Term</span><select id="rpTerm">${TERM_IDS.map(k => opt(k, TERMS[k], rp.term)).join('')}</select></label>` : ''}
    ${rp.type === 'custom' ? `<label class="field" style="width:auto"><span>From</span><input type="date" id="rpFrom" value="${esc(rp.from)}"></label><label class="field" style="width:auto"><span>To</span><input type="date" id="rpTo" value="${esc(rp.to)}"></label>` : ''}
    ${teacherPicker('rp', rp.teacher)}<button class="btn primary" type="submit" id="rpBtn">Generate report</button></div><span class="err" id="rpErr"></span></form>`;
  if (!rp.data) return form;
  return form + `<div class="panel no-print"><div class="fgrid two"><label class="field"><span>Recommendations (edit before printing)</span><textarea id="rpRecs" rows="8">${esc(rp.recs)}</textarea><small>One recommendation per line. These were drafted from the data.</small></label>
    <label class="field"><span>Notes or highlights (optional)</span><textarea id="rpNotes" rows="8" placeholder="Activities done this period, issues met, plans…">${esc(rp.notes)}</textarea></label></div>
    <div class="row"><button class="btn" data-act="rpupdate">Update the report</button><button class="btn primary" data-act="rpprint">Print or save as PDF</button><button class="btn" data-act="rpword">Download for Word (.doc)</button><button class="btn" data-act="rpcsv">Download data (CSV)</button></div></div>
    <div id="reportDoc">${reportDoc(rp.data, rp)}</div>`;
};
function repRange(rp) {
  if (rp.type === 'month') { const [y, m] = rp.month.split('-').map(Number); if (!y) return null; const from = new Date(y, m - 1, 1), to = new Date(y, m, 0, 23, 59, 59, 999); return { from: from, to: to, label: 'Monthly Report: ' + from.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) }; }
  if (rp.type === 'quarter') { const q = Number(rp.quarter) - 1, y = Number(rp.year); return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0, 23, 59, 59, 999), label: 'Quarterly Report: Q' + (q + 1) + ' ' + y + ' (' + ['January–March', 'April–June', 'July–September', 'October–December'][q] + ')' }; }
  if (rp.type === 'term') { const r = termRange(rp.term); return r ? Object.assign(r, { label: TERMS[rp.term] + ' Report, School Year ' + C().settings.schoolYear }) : 'noterm'; }
  if (rp.type === 'sy') return Object.assign(syRange(), { label: 'School Year Report, ' + C().settings.schoolYear });
  if (rp.from && rp.to) return { from: parseYmd(rp.from), to: endOfDay(parseYmd(rp.to)), label: 'Report for ' + fmtLong(parseYmd(rp.from)) + ' to ' + fmtLong(parseYmd(rp.to)) };
  return null;
}
async function doReport(e) {
  e.preventDefault();
  const rp = ST.rep, v = id => ($('#' + id) || {}).value;
  rp.type = v('rpType'); if ($('#rpMonth')) rp.month = v('rpMonth'); if ($('#rpQuarter')) { rp.quarter = v('rpQuarter'); rp.year = v('rpYear'); } if ($('#rpTerm')) rp.term = v('rpTerm'); if ($('#rpFrom')) { rp.from = v('rpFrom'); rp.to = v('rpTo'); }
  rp.teacher = $('#rpTeacher') ? $('#rpTeacher').value : '';
  const range = repRange(rp);
  if (range === 'noterm') { $('#rpErr').textContent = 'Add the dates of ' + TERMS[rp.term] + ' under Settings first.'; return; }
  if (!range) { $('#rpErr').textContent = 'Choose the period.'; return; }
  const btn = $('#rpBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Gathering data…';
  try {
    rp.data = await fetchReport(range, rp.teacher);
    rp.data.periodLabel = range.label; rp.data.range = { from: range.from.toISOString(), to: range.to.toISOString() };
    rp.recs = recommend(rp.data).join('\n'); rp.notes = '';
    render();
    const d = $('#reportDoc'); if (d) d.scrollIntoView({ block: 'start' });
  } catch (ex) { $('#rpErr').textContent = ex.message; btn.disabled = false; btn.textContent = 'Generate report'; }
}
const T = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
function reportDoc(R, rp) {
  const b = ST.branding || {}, k = R.counts, fb = R.feedback;
  const title = 'Project ' + appName() + ': Learning Resource Utilization and Student Progress Report';
  const recs = String(rp.recs || '').split('\n').map(s => s.trim()).filter(Boolean);
  const notes = String(rp.notes || '').trim();
  const b2 = buckets(R.days, new Date(R.range.from), new Date(R.range.to));
  const trend = b2.list.filter(x => x.active + x.downloads + x.views + x.attempts > 0);
  const admin = R.scope === 'Whole school';
  const sum = [
    ['Registered students' + (admin ? '' : ' (in the teacher’s sections)'), k.students],
    ['Active students', k.activeStudents + ' (' + pct(k.activeStudents, k.students) + '%)'],
    admin ? ['Student sign-ins', k.logins] : null,
    ['Resource downloads (unique students)', k.downloads + ' (' + k.downloaders + ')'],
    ['Resource views', k.views],
    ['Resources uploaded in the period', k.uploaded],
    ['Resources currently published', k.byStatus.published],
    admin ? ['Teachers participating', k.activeTeachers + ' of ' + k.teachers] : null,
    ['Students who took a quiz', k.quizTakers + ' (' + pct(k.quizTakers, k.students) + '%)'],
    ['Quiz attempts', k.attempts],
    ['Average quiz completion rate', pctTxt(k.completion)],
    ['Average quiz score', pctTxt(k.avgScore)],
    ['Student satisfaction', fb.overall === null ? 'No responses' : fb.overall + ' out of 5 (' + fb.satisfied + '% satisfied, ' + plural(fb.responses, 'response') + ')']
  ].filter(Boolean);
  let sec = 0;
  const H = t => `<h2>${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][sec++]}. ${t}</h2>`;
  return `<article class="report-doc">
    <div class="doc-head">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ''}<div><div style="font-weight:700;font-size:16px">${esc(schoolName())}</div>${b.address ? `<div class="note">${esc(b.address)}</div>` : ''}</div></div>
    <h1>${esc(title)}</h1>
    <div class="doc-meta">${esc(R.periodLabel)}<br>${esc(fmtLong(R.range.from))} to ${esc(fmtLong(R.range.to))} · School Year ${esc(R.schoolYear)} · Scope: ${esc(R.scope)}</div>
    ${H('Summary')}
    <p>${esc(appName())} gives students one place to find, download and practice with their teachers’ learning materials, online or offline. In this period, ${k.activeStudents} of ${k.students} students (${pct(k.activeStudents, k.students)}%) used it, with ${k.downloads} downloads and ${k.views} resource views${k.attempts ? ', and ' + k.attempts + ' quiz attempts averaging ' + pctTxt(k.avgScore) : ''}.</p>
    ${T(['Indicator', 'Result'], sum.map(r => [esc(r[0]), esc(r[1])]))}
    ${notes ? `<h3>Highlights</h3><p style="white-space:pre-wrap">${esc(notes)}</p>` : ''}
    ${H('Learning resource utilization')}
    ${trend.length ? `<h3>Activity per ${b2.unit}</h3>${T(['Period', 'Active students', 'Downloads', 'Views', 'Quiz attempts'], trend.map(x => [esc(x.label), x.active, x.downloads, x.views, x.attempts]))}` : '<p>No student activity was recorded in this period.</p>'}
    ${R.most.length ? `<h3>Most accessed resources</h3>${T(['Resource', 'Subject', 'Views', 'Downloads', 'Unique students'], R.most.map(m => [esc(m.title), esc(m.subject), m.views, m.downloads, Math.max(m.downloaders, m.viewers)]))}` : ''}
    ${R.least.length ? `<h3>Least accessed published resources</h3>${T(['Resource', 'Subject', 'Views', 'Downloads'], R.least.map(m => [esc(m.title), esc(m.subject), m.views, m.downloads]))}` : ''}
    ${R.bySubjectRes.length ? `<h3>Resources by subject</h3>${T(['Subject', 'Resources', 'Published', 'Views', 'Downloads'], R.bySubjectRes.map(s => [esc(s.subject), s.materials, s.live, s.views, s.downloads]))}` : ''}
    ${R.sections.length ? `<h3>Use by section</h3>${T(['Section', 'Students', 'Active', 'Downloads', 'Quiz attempts', 'Average score'], R.sections.map(s => [esc(s.section), s.students, s.active + ' (' + s.activeRate + '%)', s.downloads, s.attempts, pctTxt(s.avg)]))}` : ''}
    ${admin && R.teachers.length ? `${H('Teacher participation')}<p>${k.activeTeachers} of ${k.teachers} teachers uploaded or published materials or quizzes in this period.</p>${T(['Teacher', 'Uploaded', 'Published', 'Quizzes published', 'Student downloads'], R.teachers.map(t => [esc(t.name), t.uploads, t.published, t.quizzesPublished, t.downloads]))}` : ''}
    ${H('Assessment results')}
    ${R.quizzes.length ? `<h3>Quiz participation and completion</h3>${T(['Quiz', 'Kind', 'Subject', 'Students', 'Completion', 'Average'], R.quizzes.map(q => [esc(q.title), esc(KINDS[q.kind]), esc(q.subject), q.students + ' of ' + q.assigned, pctTxt(q.completion), pctTxt(q.avg)]))}` : '<p>No quizzes were given in this period.</p>'}
    ${R.bySubject.length ? `<h3>Average scores by subject</h3>${T(['Subject', 'Students', 'Attempts', 'Average'], R.bySubject.map(s => [esc(s.key), s.students, s.attempts, s.avg + '%']))}` : ''}
    ${R.byTopic.length ? `<h3>Average scores by topic</h3>${T(['Subject and topic', 'Attempts', 'Average'], R.byTopic.map(s => [esc(s.key), s.attempts, s.avg + '%']))}` : ''}
    ${R.byBloom.length ? `<h3>Results by cognitive level (Revised Bloom’s Taxonomy)</h3>${T(['Level', 'Answers', 'Correct'], R.byBloom.map(x => [esc(x.level), x.answers, x.pct + '%']))}` : ''}
    ${R.prepost.length ? `<h3>Pre-test and post-test comparison</h3>${T(['Pre-test → Post-test', 'Students', 'Pre-test mean', 'Post-test mean', 'Improvement', 'Students improved'], R.prepost.map(p => [esc(p.pre) + ' → ' + esc(p.post), p.students, p.students ? p.avgPre + '%' : '–', p.students ? p.avgPost + '%' : '–', p.students ? (p.gain >= 0 ? '+' : '') + p.gain + ' points' : '–', p.students ? p.improved + ' (' + pct(p.improved, p.students) + '%)' : '–']))}` : ''}
    ${R.competencies.length ? `<h3>Competency mastery</h3><p class="note">Mastery: at least 75% of the points on the competency’s questions.</p>${T(['Competency', 'Subject', 'Correct', 'Students mastered'], R.competencies.map(c => [esc(c.comp), esc(c.subject), c.pct + '%', c.mastered + ' of ' + c.students + ' (' + c.mastery + '%)']))}` : ''}
    ${H('Student satisfaction')}
    ${fb.responses ? `<p>${plural(fb.responses, 'student')} answered the feedback form. ${fb.satisfied}% were satisfied or very satisfied.</p>${T(['Statement', 'Average (1 to 5)'], Object.keys(FB_LABELS).filter(x => fb[x] !== null).map(x => [esc(FB_LABELS[x]), fb[x]]))}
      ${Object.keys(fb.connect).length ? T(['How students get online', 'Share'], Object.keys(fb.connect).map(c => [esc(c), pct(fb.connect[c], Object.values(fb.connect).reduce((s, x) => s + x, 0)) + '%'])) : ''}
      ${fb.comments.length ? `<h3>Selected comments</h3><ul>${fb.comments.slice(0, 8).map(c => `<li>“${esc(c.text)}”</li>`).join('')}</ul>` : ''}` : '<p>No student feedback was collected in this period.</p>'}
    ${H('Identified learning gaps')}
    ${R.gaps.length ? `<p>These competencies had less than 75% correct answers:</p>${T(['Competency', 'Subject', 'Correct', 'Students mastered'], R.gaps.map(g => [esc(g.comp), esc(g.subject), g.pct + '%', g.mastered + ' of ' + g.students]))}` : '<p>No competency fell below 75% in this period' + (R.competencies.length ? '.' : ', or quiz questions were not tagged with competencies.') + '</p>'}
    ${H('Recommendations')}
    <ol>${recs.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
    <div class="sign"><div><b>${esc(ST.user.name)}</b>${esc(ROLE[ST.user.role] === 'Admin' ? 'Project coordinator' : 'Teacher')}<br>Prepared by</div><div><b>${esc(b.schoolHead || ' ')}</b>${esc(b.schoolHeadPosition || 'School Principal')}<br>Noted by</div></div>
    <p class="note" style="margin-top:24px">Generated by ${esc(appName())} on ${esc(fmtLong(R.generatedAt))}. Activity done offline is counted once the student’s phone syncs.</p>
  </article>`;
}
function readRep() { const rp = ST.rep; if ($('#rpRecs')) { rp.recs = $('#rpRecs').value; rp.notes = $('#rpNotes').value; } }
function wordDoc(html) {
  const css = 'body{font-family:Arial,sans-serif;font-size:11pt;color:#1b1b1b}h1{font-size:15pt;text-align:center}h2{font-size:12pt;border-bottom:1.5pt solid #000;text-transform:uppercase;margin-top:16pt}h3{font-size:11pt}table{border-collapse:collapse;width:100%;margin:4pt 0 8pt}th,td{border:1px solid #888;padding:3pt 5pt;font-size:9.5pt;vertical-align:top}th{background:#ececec}.doc-head,.doc-meta{text-align:center}.doc-head img{width:64px;height:64px}.sign{margin-top:30pt}.sign div{display:inline-block;width:45%;text-align:center;border-top:1px solid #000;margin-right:4%;padding-top:3pt}.note{font-size:9pt;color:#555}';
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Report</title><style>' + css + '</style></head><body>' + html + '</body></html>';
}

Object.assign(A, {
  dashgo: () => { const d = ST.dash; d.preset = $('#dashPreset').value; if ($('#dashFrom')) { d.from = $('#dashFrom').value; d.to = $('#dashTo').value; } d.teacher = $('#dashTeacher') ? $('#dashTeacher').value : ''; d.data = null; d.error = ''; if (d.preset === 'custom' && !(d.from && d.to)) { render(); return; } render(); },
  dashcsv: () => { const R = ST.dash.data; downloadCSV('materials ' + R.label.replace(/[^\w\- ]+/g, '') + '.csv', ['Material', 'Subject', 'Topic', 'Term', 'Grade', 'Teacher', 'Status', 'Views', 'Downloads', 'Unique downloaders', 'Unique viewers'], R.materials.map(m => [m.title, m.subject, m.topic, termName(m.term), m.grade, m.teacher, (STATUS[m.status] || STATUS.draft)[0], m.views, m.downloads, m.downloaders, m.viewers])); },
  dashcsvq: () => { const R = ST.dash.data; downloadCSV('quizzes ' + R.label.replace(/[^\w\- ]+/g, '') + '.csv', ['Quiz', 'Kind', 'Subject', 'Topic', 'Term', 'Teacher', 'Status', 'Attempts', 'Students', 'Assigned', 'Completion %', 'Average %'], R.quizzes.map(q => [q.title, KINDS[q.kind], q.subject, q.topic, termName(q.term), q.teacher, (STATUS[q.status] || STATUS.draft)[0], q.attempts, q.students, q.assigned, q.completion, q.avg])); },
  rpupdate: () => { readRep(); $('#reportDoc').innerHTML = reportDoc(ST.rep.data, ST.rep); toast('Report updated.'); },
  rpprint: () => { readRep(); $('#reportDoc').innerHTML = reportDoc(ST.rep.data, ST.rep); window.print(); },
  rpword: () => { readRep(); const html = reportDoc(ST.rep.data, ST.rep); saveBlob(new Blob(['﻿' + wordDoc(html)], { type: 'application/msword' }), 'Project ' + appName().replace(/[^\w+ -]/g, '') + ' report - ' + ST.rep.data.periodLabel.replace(/[^\w\- ]+/g, ' ').trim() + '.doc'); },
  rpcsv: () => { const R = ST.rep.data; const rows = [['Indicator', 'Value'], ['Period', R.periodLabel], ['Scope', R.scope], ['Registered students', R.counts.students], ['Active students', R.counts.activeStudents], ['Sign-ins', R.counts.logins], ['Downloads', R.counts.downloads], ['Unique downloaders', R.counts.downloaders], ['Views', R.counts.views], ['Uploaded', R.counts.uploaded], ['Quiz attempts', R.counts.attempts], ['Quiz takers', R.counts.quizTakers], ['Completion %', R.counts.completion], ['Average score %', R.counts.avgScore], ['Feedback responses', R.feedback.responses], ['Satisfaction (1-5)', R.feedback.overall]];
    downloadCSV('report data ' + R.periodLabel.replace(/[^\w\- ]+/g, ' ').trim() + '.csv', rows[0], rows.slice(1).concat([[''], ['Competency', 'Subject', 'Correct %', 'Students', 'Mastered']], R.competencies.map(c => [c.comp, c.subject, c.pct, c.students, c.mastered]))); }
});
