/* REVIEW+ quizzes: scoring, taking a quiz, the question editor and the AI generator. */
'use strict';

/* ---------------- scoring (same rules as the server) ---------------- */
const numOf = s => { const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
const onlyNum = s => /^-?[\d,]*\.?\d+\s*[a-z%°²³/ ]{0,12}$/i.test(String(s == null ? '' : s).trim());
function matchAny(accepted, r) {
  const n = norm(r);
  if (!n) return false;
  return (accepted || []).some(a => {
    if (norm(a) === n) return true;
    const x = numOf(a), y = numOf(r);
    return !isNaN(x) && !isNaN(y) && onlyNum(a) && onlyNum(r) && Math.abs(x - y) <= Math.max(1e-9, Math.abs(x) * 1e-3);
  });
}
function qMax(q) {
  if (Number(q.pts) > 0) return Number(q.pts);
  return q.type === 'match' ? (q.pairs || []).length || 1 : q.type === 'enum' ? q.n || 1 : q.type === 'fill' ? (q.blanks || []).length || 1 : q.type === 'short' ? 2 : q.type === 'problem' ? 3 : q.type === 'essay' ? 5 : 1;
}
const hasText = r => r !== undefined && r !== null && (typeof r === 'object' ? Object.keys(r).some(k => String(r[k] || '').trim()) : String(r).trim() !== '');
function autoScore(q, r) {
  if (q.type === 'mc') return r !== undefined && r !== null && r !== '' && Number(r) === q.a ? 1 : 0;
  if (q.type === 'tf') return (r === true || r === false) && r === q.a ? 1 : 0;
  if (q.type === 'id') return matchAny(q.a, r) ? 1 : 0;
  if (q.type === 'match') { const arr = Array.isArray(r) ? r : []; let c = 0; q.pairs.forEach((p, k) => { if (arr[k] === p[1]) c++; }); return c / q.pairs.length; }
  if (q.type === 'enum') {
    const arr = (Array.isArray(r) ? r : []).map(norm).filter(Boolean), hit = {};
    arr.forEach(v => q.groups.forEach((g, gi) => { if (!hit[gi] && g.some(a => norm(a) === v)) hit[gi] = 1; }));
    return Math.min(Object.keys(hit).length, q.n) / q.n;
  }
  if (q.type === 'fill') { const arr = Array.isArray(r) ? r : []; let c = 0; q.blanks.forEach((b, k) => { if (matchAny(b, arr[k])) c++; }); return c / q.blanks.length; }
  if (q.type === 'short') { if ((q.a || []).length) return matchAny(q.a, r) ? 1 : (hasText(r) ? null : 0); return hasText(r) ? null : 0; }
  if (q.type === 'problem') { const fin = r && typeof r === 'object' ? r.final : r; if ((q.final || []).length && matchAny(q.final, fin)) return 1; return hasText(r) ? null : 0; }
  if (q.type === 'essay') return hasText(r) ? null : 0;
  return 0;
}
function totals(res) {
  let score = 0, max = 0, pending = 0, pendingPts = 0;
  res.forEach(r => { max += r.max; if (r.f === null || r.f === undefined) { pending++; pendingPts += r.max; } else score += r.f * r.max; });
  score = Math.round(score * 100) / 100;
  return { score: score, maxScore: max, pct: max ? Math.round(score / max * 100) : 0, status: pending ? 'pending' : 'complete', pending: pending, pendingPts: pendingPts };
}
function answerText(q) {
  if (q.type === 'mc') return q.options[q.a];
  if (q.type === 'tf') return q.a ? 'True' : 'False';
  if (q.type === 'id' || q.type === 'short') return (q.a || []).join(' / ') || q.model || '';
  if (q.type === 'match') return q.pairs.map(p => p[0] + ' → ' + p[1]).join('; ');
  if (q.type === 'enum') return q.groups.map(g => g[0]).join(', ') + (q.groups.length > q.n ? ' (any ' + q.n + ')' : '');
  if (q.type === 'fill') return q.blanks.map(b => b[0]).join('; ');
  if (q.type === 'problem') return ((q.final || []).length ? 'Final answer: ' + q.final[0] + '\n' : '') + (q.model || '');
  if (q.type === 'essay') return q.model || '';
  return '';
}
function responseText(q, r) {
  if (r === undefined || r === null || r === '') return '(no answer)';
  if (q.type === 'mc') return q.options[r] || '(no answer)';
  if (q.type === 'tf') return r ? 'True' : 'False';
  if (q.type === 'match') return q.pairs.map((p, k) => p[0] + ' → ' + ((r || [])[k] || '–')).join('; ');
  if (q.type === 'enum' || q.type === 'fill') return (r || []).filter(Boolean).join('; ') || '(no answer)';
  if (q.type === 'problem') return (r.final ? 'Final answer: ' + r.final : '') + (r.work ? (r.final ? '\n' : '') + r.work : '') || '(no answer)';
  return String(r);
}

/* ---------------- taking a quiz ---------------- */
function myTries(quizId) { return history().filter(a => a.quizId === quizId).length; }
function startQuiz(quiz, mode, title, questions) {
  if (mode === 'quiz' && isStudent() && quiz.maxAttempts > 0 && myTries(quiz.id) >= quiz.maxAttempts) {
    openModal(`<h2>No tries left</h2><p>“${esc(quiz.title)}” allows ${plural(quiz.maxAttempts, 'try', 'tries')}, and you’ve used ${quiz.maxAttempts === 1 ? 'it' : 'them all'}. See your score under My progress.</p><div><button class="btn primary" data-act="close">OK</button></div>`);
    return;
  }
  const qs = (questions || quiz.questions).map(q => q.type === 'match' ? Object.assign({}, q, { right: shuffle(q.pairs.map(p => p[1])) }) : q);
  if (!qs.length) { toast('This quiz has no questions yet.'); return; }
  closeModal();
  const fb = mode === 'quiz' ? (quiz.feedback || 'each') : 'each';
  ST.quiz = { quiz: quiz, mode: mode, fb: fb, title: title || quiz.title, qs: qs, i: 0, resp: {}, res: [], checked: false, back: ST.tab };
  render(); window.scrollTo(0, 0);
}
V.quiz = function () {
  const z = ST.quiz;
  if (z.i >= z.qs.length) return finishView(z);
  const q = z.qs[z.i], prev = z.resp[q.id];
  let ui = '';
  if (q.type === 'mc' || q.type === 'tf') {
    const opts = q.type === 'tf' ? ['True', 'False'] : q.options;
    ui = `<div class="opts" role="radiogroup">${opts.map((o, k) => `<label class="opt" id="opt${k}"><input type="radio" name="ans" value="${k}">${esc(o)}</label>`).join('')}</div>`;
  } else if (q.type === 'id') ui = `<label class="field"><span>Your answer</span><input type="text" id="ans" autocomplete="off"></label>`;
  else if (q.type === 'match') ui = `<div class="opts">${q.pairs.map((p, k) => `<div class="matchrow"><b>${esc(p[0])}</b><select id="mt${k}" aria-label="Match for ${esc(p[0])}"><option value="">Choose…</option>${q.right.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>`).join('')}</div>`;
  else if (q.type === 'enum') ui = `<div class="fgrid">${Array.from({ length: q.n }, (_, k) => `<label class="field"><span>${k + 1}.</span><input type="text" class="enum" id="en${k}" autocomplete="off"></label>`).join('')}</div><p class="small muted">Any order is fine.</p>`;
  else if (q.type === 'fill') {
    const parts = q.q.split(/_{3,}/);
    ui = `<p class="fillin">${parts.map((t, k) => esc(t) + (k < parts.length - 1 ? `<input type="text" id="fb${k}" aria-label="Blank ${k + 1}" autocomplete="off">` : '')).join('')}</p>`;
  } else if (q.type === 'short') ui = `<label class="field"><span>Your answer</span><textarea id="ans" rows="3"></textarea></label>`;
  else if (q.type === 'problem') ui = `<label class="field"><span>Your solution</span><textarea id="work" rows="6" placeholder="Show your steps"></textarea></label><label class="field"><span>Final answer</span><input type="text" id="fin" autocomplete="off" placeholder="Include the unit, if any"></label>`;
  else if (q.type === 'essay') ui = `${q.rubric ? `<div class="answer-box small"><b>How this is scored:</b>\n${esc(q.rubric)}</div>` : ''}<label class="field"><span>Your answer</span><textarea id="ans" rows="9"></textarea><small id="wc">0 words</small></label>`;
  const manual = !OBJECTIVE.includes(q.type) && !(q.type === 'short' && (q.a || []).length);
  const last = z.i === z.qs.length - 1;
  return `<section class="panel quiz"><div class="spread"><span class="small muted">${esc(z.title)}${z.mode === 'preview' ? ' · Preview, nothing is recorded' : ''}</span><button class="btn small ghost" data-act="endquiz">Quit</button></div>
    <div class="progress"><i style="width:${z.i / z.qs.length * 100}%"></i></div>
    <div class="row"><span class="qtype">${QT[q.type]}</span><span class="small muted">Question ${z.i + 1} of ${z.qs.length} · ${plural(qMax(q), 'point')}${manual ? ' · checked by your teacher' : ''}</span></div>
    ${q.type === 'fill' ? '<p class="small muted">Fill in each blank.</p>' : `<p class="qtext">${esc(q.q)}</p>`}${ui}<div id="fb"></div>
    <div class="row"><button class="btn primary" data-act="check" id="checkBtn">${z.fb === 'each' ? 'Check answer' : last ? 'Finish' : 'Next question'}</button><button class="btn ghost small" data-act="skipq" id="skipBtn">Skip</button></div></section>`;
};
function readResponse(q) {
  if (q.type === 'mc' || q.type === 'tf') { const s = document.querySelector('input[name=ans]:checked'); if (!s) return undefined; return q.type === 'tf' ? s.value === '0' : Number(s.value); }
  if (q.type === 'id' || q.type === 'short' || q.type === 'essay') { const v = $('#ans').value; return v.trim() ? v.trim() : undefined; }
  if (q.type === 'match') { const a = q.pairs.map((p, k) => $('#mt' + k).value); return a.some(Boolean) ? a : undefined; }
  if (q.type === 'enum') { const a = $$('.enum').map(i => i.value.trim()); return a.some(Boolean) ? a : undefined; }
  if (q.type === 'fill') { const a = q.blanks.map((b, k) => ($('#fb' + k) || {}).value || '').map(s => s.trim()); return a.some(Boolean) ? a : undefined; }
  if (q.type === 'problem') { const o = { final: $('#fin').value.trim(), work: $('#work').value.trim() }; return o.final || o.work ? o : undefined; }
}
async function checkAnswer(skip) {
  const z = ST.quiz, q = z.qs[z.i];
  if (z.checked) { z.i++; z.checked = false; if (z.i >= z.qs.length) await finishQuiz(); render(); window.scrollTo(0, 0); return; }
  const r = skip ? undefined : readResponse(q);
  if (r === undefined && !skip) { toast('Answer first, or tap Skip.'); return; }
  z.resp[q.id] = r;
  const f = autoScore(q, r);
  z.res[z.i] = { id: q.id, f: f === null ? null : Math.round(f * 1000) / 1000, max: qMax(q) };
  if (z.fb !== 'each') { z.i++; if (z.i >= z.qs.length) await finishQuiz(); render(); window.scrollTo(0, 0); return; }
  z.checked = true;
  if (q.type === 'mc' || q.type === 'tf') {
    const correct = q.type === 'tf' ? (q.a ? 0 : 1) : q.a;
    $('#opt' + correct).classList.add('right');
    const sel = document.querySelector('input[name=ans]:checked');
    if (sel && Number(sel.value) !== correct) $('#opt' + sel.value).classList.add('wrong');
  }
  if (q.type === 'match') q.pairs.forEach((p, k) => { $('#mt' + k).style.borderColor = $('#mt' + k).value === p[1] ? 'var(--ok)' : 'var(--bad)'; });
  let html;
  if (f === null) html = `<div class="feedback wait"><b>Saved.</b> Your teacher will check this answer.${answerText(q) ? '\n\n<b>Key points:</b> ' + esc(answerText(q)) : ''}</div>`;
  else {
    const cls = f === 1 ? 'ok' : f > 0 ? 'part' : 'bad';
    html = `<div class="feedback ${cls}"><b>${skip ? 'Skipped.' : f === 1 ? 'Correct!' : f > 0 ? 'Partly correct.' : 'Not quite.'}</b> ${f < 1 ? 'Answer: ' + esc(answerText(q)) + '. ' : ''}${esc(q.exp || '')}</div>`;
  }
  $('#fb').innerHTML = html;
  $$('.quiz input, .quiz select, .quiz textarea').forEach(e => e.disabled = true);
  const b = $('#checkBtn'); b.textContent = z.i === z.qs.length - 1 ? 'See my score' : 'Next question'; b.focus();
  $('#skipBtn').hidden = true;
}
async function finishQuiz() {
  const z = ST.quiz;
  z.tot = totals(z.res);
  if (z.mode !== 'quiz' || !isStudent()) return;
  const a = { clientId: uid(), quizId: z.quiz.id, responses: z.resp, takenAt: new Date().toISOString(), results: z.res, pct: z.tot.pct, score: z.tot.score, maxScore: z.tot.maxScore, status: z.tot.status };
  ST.pending.push(a); await persist();
  if (navigator.onLine) { await sync(true); z.synced = !ST.pending.some(p => p.clientId === a.clientId); }
}
function finishView(z) {
  const t = z.tot || totals(z.res);
  const askFeedback = isStudent() && z.mode === 'quiz' && history().length >= 2 && !feedbackRecent();
  let review = '';
  if (z.fb === 'end' || (z.mode !== 'quiz' && z.fb !== 'score')) {
    review = `<div class="review">${z.qs.map((q, i) => { const r = z.res[i] || {}; const f = r.f;
      return `<div><span class="small muted">${i + 1}. ${QT[q.type]} · ${f === null ? 'teacher will check' : Math.round((f || 0) * r.max * 10) / 10 + ' of ' + r.max}</span><b>${esc(q.q.replace(/_{3,}/g, '____'))}</b>
      <span class="small">Your answer: ${esc(responseText(q, z.resp[q.id]))}</span>${f !== 1 ? `<span class="small">Answer: ${esc(answerText(q))}</span>` : ''}${q.exp ? `<span class="small muted">${esc(q.exp)}</span>` : ''}</div>`; }).join('')}</div>`;
  }
  return `<section class="panel quiz"><p class="label">${esc(z.title)} · Finished</p><h1 class="mono" style="font-size:3rem">${t.pct}%</h1>
    <p>${t.score} of ${t.maxScore} points.${t.pending ? ` <b>${plural(t.pending, 'answer')}</b> worth ${plural(t.pendingPts, 'point')} will be added after your teacher checks ${t.pending === 1 ? 'it' : 'them'}.` : ''}</p>
    <p class="small muted">${z.mode === 'quiz' && isStudent() ? (z.synced ? 'Your answers were sent to your teacher.' : 'Saved on this phone. It syncs to your teacher when you’re online.') : z.mode === 'preview' ? 'Preview only. Nothing was recorded.' : 'Practice set. It isn’t sent to teachers.'}</p>
    ${review}
    ${askFeedback ? `<div class="banner hi"><span>How is ${esc(appName())} working for you? <button class="btn small" data-act="feedback">Give feedback</button></span></div>` : ''}
    <div class="row">${z.quiz && (!z.quiz.maxAttempts || z.mode !== 'quiz' || myTries(z.quiz.id) < z.quiz.maxAttempts) ? `<button class="btn primary" data-act="retry">Try again</button>` : ''}<button class="btn" data-act="endquiz">Done</button></div></section>`;
}
Object.assign(A, {
  check: () => checkAnswer(false),
  skipq: () => checkAnswer(true),
  retry: () => { const z = ST.quiz; startQuiz(z.quiz, z.mode, z.title, z.mode === 'quiz' ? null : z.qs); },
  endquiz: () => { const back = ST.quiz && ST.quiz.mode === 'preview' && !ST.quiz.fromEdit ? (ST.quiz.back || 'quizzes') : ST.quiz && ST.quiz.back; const ed = ST.quiz && ST.quiz.fromEdit; ST.quiz = null; if (ed) ST.edit = ed; if (back) ST.tab = back; render(); },
  startquiz: id => { const q = quizById(id); if (q) startQuiz(q, isStudent() ? 'quiz' : 'preview'); },
  previewquiz: id => { const q = quizById(id); if (q) startQuiz(q, 'preview'); },
  mixed: () => {
    const pool = C().quizzes.filter(q => q.status === 'published' && q.kind === 'practice' && (!isStudent() || q.sections.includes(ST.user.sectionId)));
    const qs = shuffle(pool.flatMap(q => shuffle(q.questions.filter(x => OBJECTIVE.includes(x.type))).slice(0, 3))).slice(0, 10);
    if (!qs.length) { toast('No practice questions yet.'); return; }
    startQuiz(null, 'practice', 'Quick mixed review', qs);
  },
  skill: comp => {
    const qs = shuffle(C().quizzes.filter(q => q.status === 'published' && q.kind === 'practice').flatMap(q => q.questions.filter(x => x.comp === comp && OBJECTIVE.includes(x.type)))).slice(0, 10);
    if (!qs.length) { toast('No practice questions for this skill yet. Retake its quiz instead.'); return; }
    startQuiz(null, 'practice', 'Practice: ' + comp, qs);
  }
});

/* ---------------- quiz editor ---------------- */
function toEdit(quiz) {
  const e = JSON.parse(JSON.stringify(quiz));
  e.questions.forEach(q => {
    if (q.type === 'id' || q.type === 'short') q.aText = (q.a || []).join(', ');
    if (q.type === 'problem') q.finalText = (q.final || []).join(', ');
    if (q.type === 'enum') q.groupsText = (q.groups || []).map(g => g.join(' / ')).join('\n');
    if (q.type === 'fill') q.blanksText = (q.blanks || []).map(b => b.join(' / '));
  });
  return e;
}
function fromEdit(e) {
  const out = JSON.parse(JSON.stringify(e));
  out.questions = out.questions.map(q => {
    const x = Object.assign({}, q);
    const list = s => String(s || '').split(',').map(v => v.trim()).filter(Boolean);
    const alts = s => String(s || '').split('/').map(v => v.trim()).filter(Boolean);
    if (x.type === 'id' || x.type === 'short') x.a = list(x.aText);
    if (x.type === 'problem') x.final = list(x.finalText);
    if (x.type === 'enum') x.groups = String(x.groupsText || '').split('\n').map(alts).filter(g => g.length);
    if (x.type === 'fill') x.blanks = (x.blanksText || []).map(alts);
    if (x.type === 'mc') x.options = x.options.map(o => o.trim());
    delete x.aText; delete x.finalText; delete x.groupsText; delete x.blanksText; delete x.right;
    if (!(Number(x.pts) > 0)) delete x.pts;
    return x;
  });
  return out;
}
function blankQ(type) {
  const q = { id: 'q' + uid().slice(0, 6), type: type, q: '', exp: '', comp: '', diff: 'Average', bloom: 'Remember' };
  if (type === 'mc') { q.options = ['', '', '', '']; q.a = 0; }
  if (type === 'tf') q.a = true;
  if (type === 'id' || type === 'short') q.aText = '';
  if (type === 'match') q.pairs = [['', ''], ['', ''], ['', '']];
  if (type === 'enum') { q.n = 3; q.groupsText = ''; }
  if (type === 'fill') { q.q = ''; q.blanksText = []; }
  if (type === 'short') q.model = '';
  if (type === 'problem') { q.model = ''; q.finalText = ''; }
  if (type === 'essay') { q.rubric = 'Content: 3 points\nOrganization: 1 point\nLanguage: 1 point'; q.model = ''; q.pts = 5; }
  return q;
}
function newQuiz(materialId) {
  const m = materialId ? matById(materialId) : null, s = C().settings;
  ST.edit = { title: m ? 'Practice quiz: ' + m.title : '', materialId: m ? m.id : '', materialIds: m ? [m.id] : [], subject: m ? m.subject : '', grade: m ? String(m.grade) : '11', sections: m ? m.sections.slice() : [],
    term: m ? m.term : s.currentTerm, sy: m ? m.sy : s.schoolYear, topic: m ? m.topic : '', status: 'draft', kind: 'practice', feedback: 'each', maxAttempts: 0, pairId: '', questions: [] };
  closeModal(); render(); window.scrollTo(0, 0);
}
function keyEditor(q, i) {
  if (q.type === 'mc') return `<div class="field"><span>Choices <span class="hint">· tick the correct one</span></span>${q.options.map((o, k) => `<div class="row" style="flex-wrap:nowrap"><input type="radio" name="ca${i}" data-q="${i}" data-f="a" value="${k}"${q.a === k ? ' checked' : ''} aria-label="Choice ${'ABCDEF'[k]} is correct"><input type="text" data-q="${i}" data-o="${k}" value="${esc(o)}" placeholder="Choice ${'ABCDEF'[k]}">${q.options.length > 2 ? `<button type="button" class="btn small ghost" data-act="delopt" data-id="${i}:${k}" aria-label="Remove choice">✕</button>` : ''}</div>`).join('')}${q.options.length < 6 ? `<div><button type="button" class="btn small" data-act="addopt" data-id="${i}">Add a choice</button></div>` : ''}</div>`;
  if (q.type === 'tf') return `<label class="field"><span>Correct answer</span><select data-q="${i}" data-f="a">${opt('true', 'True', String(q.a))}${opt('false', 'False', String(q.a))}</select></label>`;
  if (q.type === 'id') return `<label class="field"><span>Accepted answers</span><input type="text" data-q="${i}" data-f="aText" value="${esc(q.aText)}" placeholder="e.g. photosynthesis, photo synthesis"><small>Separate accepted answers with commas. Capital letters and punctuation don’t matter.</small></label>`;
  if (q.type === 'match') return `<div class="field"><span>Pairs <span class="hint">· students see the right side shuffled</span></span>${q.pairs.map((p, k) => `<div class="matchrow"><input type="text" data-q="${i}" data-p="${k}" data-s="0" value="${esc(p[0])}" placeholder="Item ${k + 1}"><div class="row" style="flex-wrap:nowrap"><input type="text" data-q="${i}" data-p="${k}" data-s="1" value="${esc(p[1])}" placeholder="Its match">${q.pairs.length > 2 ? `<button type="button" class="btn small ghost" data-act="delpair" data-id="${i}:${k}" aria-label="Remove pair">✕</button>` : ''}</div></div>`).join('')}${q.pairs.length < 10 ? `<div><button type="button" class="btn small" data-act="addpair" data-id="${i}">Add a pair</button></div>` : ''}</div>`;
  if (q.type === 'enum') return `<div class="fgrid two"><label class="field"><span>How many must students give?</span><input type="number" min="1" max="20" data-q="${i}" data-f="n" value="${esc(q.n)}"></label></div><label class="field"><span>Accepted answers, one per line</span><textarea data-q="${i}" data-f="groupsText" rows="4" placeholder="atmosphere\nhydrosphere\nlithosphere / geosphere">${esc(q.groupsText)}</textarea><small>Put alternatives for the same answer on one line, separated by “/”.</small></label>`;
  if (q.type === 'fill') {
    const n = (String(q.q).match(/_{3,}/g) || []).length;
    return `<div class="field"><span>Answer for each blank</span>${n ? Array.from({ length: n }, (_, k) => `<div class="row" style="flex-wrap:nowrap"><span class="small muted" style="width:64px">Blank ${k + 1}</span><input type="text" data-q="${i}" data-b="${k}" value="${esc((q.blanksText || [])[k] || '')}" placeholder="answer / alternative"></div>`).join('') : '<small class="err">Type ___ (three underscores) in the sentence above for each blank.</small>'}<small>Separate alternatives with “/”.</small></div>`;
  }
  if (q.type === 'short') return `<label class="field"><span>Model answer (for checking)</span><textarea data-q="${i}" data-f="model" rows="2">${esc(q.model)}</textarea></label><label class="field"><span>Exact accepted answers (optional)</span><input type="text" data-q="${i}" data-f="aText" value="${esc(q.aText)}" placeholder="Leave empty to check by hand"><small>If the answer is one exact word or number, list it to score it automatically. Other answers come to you under To check.</small></label>`;
  if (q.type === 'problem') return `<label class="field"><span>Worked solution</span><textarea data-q="${i}" data-f="model" rows="4">${esc(q.model)}</textarea></label><label class="field"><span>Accepted final answers (optional)</span><input type="text" data-q="${i}" data-f="finalText" value="${esc(q.finalText)}" placeholder="e.g. 12.5 m, 12.5"><small>A correct final answer gets full points automatically. Wrong or missing ones come to you under To check, with the student’s solution.</small></label>`;
  if (q.type === 'essay') return `<label class="field"><span>Rubric (students see this)</span><textarea data-q="${i}" data-f="rubric" rows="3">${esc(q.rubric)}</textarea></label><label class="field"><span>Key points of a strong answer (for checking)</span><textarea data-q="${i}" data-f="model" rows="3">${esc(q.model)}</textarea></label>`;
  return '';
}
V.quizEditor = function () {
  const e = ST.edit, c = C();
  const comps = [...new Set(c.quizzes.flatMap(q => q.questions.map(x => x.comp)).filter(Boolean))];
  const mats = c.materials.filter(m => isMine(m));
  const pres = c.quizzes.filter(q => isMine(q) && q.kind === 'pretest' && q.id !== e.id);
  const needsReview = e.aiGenerated && !e.approvedAt;
  const qBlock = (q, i) => `<div class="qedit" id="qe${i}"><div class="spread"><span class="row"><b>${i + 1}.</b><span class="qtype">${QT[q.type]}</span></span><span class="row"><button type="button" class="btn small ghost" data-act="upq" data-id="${i}"${i ? '' : ' disabled'} aria-label="Move up">↑</button><button type="button" class="btn small ghost" data-act="downq" data-id="${i}"${i < e.questions.length - 1 ? '' : ' disabled'} aria-label="Move down">↓</button><button type="button" class="btn small ghost" data-act="dupq" data-id="${i}">Copy</button><button type="button" class="btn small ghost danger" data-act="delq" data-id="${i}">Remove</button></span></div>
    <label class="field"><span>${q.type === 'fill' ? 'Sentence (type ___ for each blank)' : q.type === 'essay' ? 'Essay prompt' : q.type === 'problem' ? 'Problem' : 'Question'}</span><textarea data-q="${i}" data-f="q" rows="2">${esc(q.q)}</textarea></label>${keyEditor(q, i)}
    ${q.type !== 'essay' ? `<label class="field"><span>Explanation students see after answering</span><textarea data-q="${i}" data-f="exp" rows="2" placeholder="Why the answer is correct">${esc(q.exp)}</textarea></label>` : ''}
    <div class="fgrid"><label class="field"><span>Competency</span><input type="text" data-q="${i}" data-f="comp" list="compList" value="${esc(q.comp)}" placeholder="e.g. Find the domain"></label>
    <label class="field"><span>Bloom’s level</span><select data-q="${i}" data-f="bloom">${opt('', 'Not set', q.bloom)}${BLOOM.map(b => opt(b, b, q.bloom)).join('')}</select></label>
    <label class="field"><span>Difficulty</span><select data-q="${i}" data-f="diff">${opt('', 'Not set', q.diff)}${DIFFS.map(d => opt(d, d, q.diff)).join('')}</select></label>
    <label class="field"><span>Points</span><input type="number" min="0.5" max="100" step="0.5" data-q="${i}" data-f="pts" value="${esc(q.pts || '')}" placeholder="${qMax(fromEdit({ questions: [q] }).questions[0])}"></label></div></div>`;
  const total = fromEdit(e).questions.reduce((s, q) => s + qMax(q), 0);
  return `<form class="panel" id="qeForm" novalidate data-dirty="1"><div class="spread"><h2>${e.id ? (needsReview ? 'Review AI draft' : 'Edit quiz') : 'New quiz'}</h2><div class="row"><button type="button" class="btn" data-act="previewedit">Try it</button><button type="button" class="btn ghost" data-act="cancelquiz">Cancel</button></div></div>
    ${needsReview ? '<div class="banner warn"><span><b>Written by AI. Students can’t see it yet.</b> Check every question, answer key and explanation against your material. Fix or remove anything wrong, then approve it below.</span></div>' : ''}
    ${e.status && e.status !== 'draft' ? `<p class="small">Status: ${statusPill(e.status, e.publishAt)}${e.approvedBy ? ' · approved by ' + esc(e.approvedBy) + ' on ' + esc(fmtDate(e.approvedAt)) : ''}</p>` : ''}
    <div class="fgrid two"><label class="field"><span>Quiz title</span><input type="text" data-m="title" value="${esc(e.title)}" maxlength="120"></label>
    <label class="field"><span>Kind</span><select data-m="kind">${Object.keys(KINDS).map(k => opt(k, KINDS[k], e.kind)).join('')}</select></label></div>
    ${e.kind === 'posttest' ? `<label class="field"><span>Pre-test to compare with</span><select data-m="pairId">${opt('', 'Choose the matching pre-test', e.pairId)}${pres.map(q => opt(q.id, q.title, e.pairId)).join('')}</select><small>Reports compare each student’s first pre-test score with their first post-test score.</small></label>` : ''}
    <div class="fgrid two"><label class="field"><span>Show students the answers</span><select data-m="feedback">${Object.keys(FEEDBACK_MODES).map(k => opt(k, FEEDBACK_MODES[k], e.feedback)).join('')}</select></label>
    <label class="field"><span>Tries allowed</span><select data-m="maxAttempts">${opt(0, 'Unlimited', e.maxAttempts)}${[1, 2, 3, 5].map(n => opt(n, String(n), e.maxAttempts)).join('')}</select></label></div>
    <div class="fgrid"><label class="field"><span>Subject</span><input type="text" data-m="subject" list="subjList" value="${esc(e.subject)}"><datalist id="subjList">${teacherSubjects().map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
    <label class="field"><span>Topic</span><input type="text" data-m="topic" value="${esc(e.topic)}"></label>
    <label class="field"><span>Term</span><select data-m="term">${TERM_IDS.map(k => opt(k, TERMS[k], e.term)).join('')}</select></label>
    <label class="field"><span>School year</span><select data-m="sy">${schoolYears().map(y => opt(y, y, e.sy)).join('')}</select></label>
    <label class="field"><span>Grade</span><select data-m="grade">${opt('11', 'Grade 11', e.grade)}${opt('12', 'Grade 12', e.grade)}</select></label>
    <label class="field"><span>Goes with material</span><select data-m="materialId">${opt('', 'None', e.materialId)}${mats.map(m => opt(m.id, m.title, e.materialId)).join('')}</select></label></div>
    <div class="field"><span>Sections that can take it</span><div class="checks">${sectionChecks(e.grade, null, e.sections.length ? e.sections : null, 'qeSec', e.sy)}</div></div>
    <datalist id="compList">${comps.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="spread"><h3>${plural(e.questions.length, 'question')} · ${plural(total, 'point')}</h3></div>
    ${e.questions.map(qBlock).join('') || '<div class="empty">No questions yet. Add one below.</div>'}
    <div class="field"><span>Add a question</span><div class="row">${QT_IDS.map(t => `<button type="button" class="btn small" data-act="addq" data-id="${t}">+ ${QT[t]}</button>`).join('')}</div></div>
    <div class="panel" style="background:var(--paper)">
      ${needsReview ? '<label class="check" style="align-self:flex-start"><input type="checkbox" id="qeReviewed"> I reviewed every question, answer key and explanation</label>' : ''}
      <div class="row"><button type="button" class="btn" data-act="savequiz" data-id="none">${e.status === 'published' ? 'Save changes' : 'Save as draft'}</button>
      ${e.status !== 'published' ? `<button type="button" class="btn primary" data-act="savequiz" data-id="publish">Approve and publish now</button>` : '<button type="button" class="btn ghost" data-act="savequiz" data-id="unpublish">Unpublish</button>'}</div>
      ${e.status !== 'published' ? `<div class="row"><label class="field" style="max-width:260px"><span>Or publish on</span><input type="datetime-local" id="qeAt" value="${esc(localInput(e.publishAt))}"></label><button type="button" class="btn" data-act="savequiz" data-id="schedule" style="align-self:flex-end">Approve and schedule</button></div>` : ''}
      <span class="err" id="qeErr" role="alert"></span></div></form>`;
};
function bindEditor(t) {
  const e = ST.edit; if (!e) return false;
  if (t.dataset.m) { e[t.dataset.m] = t.dataset.m === 'maxAttempts' ? Number(t.value) : t.value; return true; }
  if (t.classList.contains('qeSec')) { e.sections = $$('.qeSec:checked').map(i => i.value); return true; }
  if (t.dataset.q === undefined) return false;
  const q = e.questions[+t.dataset.q]; if (!q) return false;
  if (t.dataset.o !== undefined) q.options[+t.dataset.o] = t.value;
  else if (t.dataset.p !== undefined) q.pairs[+t.dataset.p][+t.dataset.s] = t.value;
  else if (t.dataset.b !== undefined) { q.blanksText = q.blanksText || []; q.blanksText[+t.dataset.b] = t.value; }
  else if (t.dataset.f === 'a') q.a = q.type === 'mc' ? +t.value : t.value === 'true';
  else if (t.dataset.f === 'n' || t.dataset.f === 'pts') q[t.dataset.f] = t.value === '' ? '' : Number(t.value);
  else q[t.dataset.f] = t.value;
  return true;
}
async function saveQuiz(action) {
  const e = ST.edit;
  const qz = fromEdit(e);
  if (!qz.sections.length) qz.sections = $$('.qeSec:checked').map(i => i.value);
  if (qz.materialId && !(qz.materialIds || []).includes(qz.materialId)) qz.materialIds = [qz.materialId];
  const reviewed = !!($('#qeReviewed') && $('#qeReviewed').checked);
  const err = !qz.title.trim() ? 'Give the quiz a title.' : !qz.subject.trim() ? 'Choose a subject.' : !qz.sections.length ? 'Choose at least one section.' : !qz.questions.length ? 'Add at least one question.'
    : (action === 'publish' || action === 'schedule') && e.aiGenerated && !e.approvedAt && !reviewed ? 'Tick “I reviewed every question…” before you approve this AI draft.'
      : qz.kind === 'posttest' && !qz.pairId && (action === 'publish' || action === 'schedule') ? 'Choose the pre-test this post-test is compared with.' : '';
  if (err) { $('#qeErr').textContent = err; return; }
  if (!navigator.onLine) { $('#qeErr').textContent = 'Saving needs internet. Stay on this page and try again when you’re online.'; return; }
  let publishAt = '';
  if (action === 'schedule') { const v = $('#qeAt').value; if (!v) { $('#qeErr').textContent = 'Choose the date and time to publish.'; return; } publishAt = new Date(v).toISOString(); }
  $('#qeErr').textContent = 'Saving…';
  try {
    const r = await api('saveQuiz', { quiz: qz, op: action, publishAt: publishAt, reviewed: reviewed });
    const i = C().quizzes.findIndex(q => q.id === r.quiz.id);
    if (i >= 0) C().quizzes[i] = r.quiz; else C().quizzes.push(r.quiz);
    await KV.set('catalog', ST.cat);
    ST.edit = null; ST.tab = 'quizzes'; render();
    toast(r.quiz.status === 'published' ? 'Published. Students in the chosen sections can take it now.' : r.quiz.status === 'scheduled' ? 'Scheduled for ' + fmtTime(r.quiz.publishAt) + '.' : 'Saved as a locked draft. Students can’t see it yet.');
  } catch (ex) { $('#qeErr').textContent = ex.message; }
}
Object.assign(A, {
  newquiz: id => newQuiz(id),
  editquiz: id => { const q = quizById(id); if (!q) return; ST.edit = toEdit(q); closeModal(); render(); window.scrollTo(0, 0); },
  previewedit: () => {
    let qz;
    try { qz = fromEdit(ST.edit); } catch (e) { return; }
    const ok = qz.questions.filter(q => q.q && (q.type !== 'mc' || q.options.filter(Boolean).length >= 2));
    if (!ok.length) { toast('Write at least one question first.'); return; }
    const ed = ST.edit; ST.edit = null;
    startQuiz(Object.assign({}, qz, { feedback: 'each' }), 'preview', qz.title || 'Preview', ok);
    ST.quiz.fromEdit = ed;
  },
  cancelquiz: () => openModal('<h2>Leave without saving?</h2><p>Your changes to this quiz will be lost.</p><div class="row"><button class="btn" data-act="close">Keep editing</button><button class="btn danger" data-act="discardquiz">Leave</button></div>'),
  discardquiz: () => { closeModal(); ST.edit = null; ST.tab = 'quizzes'; render(); },
  addq: t => { ST.edit.questions.push(blankQ(t)); keepVals(render); const el = $('#qe' + (ST.edit.questions.length - 1)); if (el) el.scrollIntoView({ block: 'center' }); },
  delq: i => { ST.edit.questions.splice(+i, 1); render(); },
  dupq: i => { const q = JSON.parse(JSON.stringify(ST.edit.questions[+i])); q.id = 'q' + uid().slice(0, 6); ST.edit.questions.splice(+i + 1, 0, q); render(); },
  upq: i => { i = +i; const q = ST.edit.questions; [q[i - 1], q[i]] = [q[i], q[i - 1]]; render(); },
  downq: i => { i = +i; const q = ST.edit.questions; [q[i + 1], q[i]] = [q[i], q[i + 1]]; render(); },
  addopt: i => { ST.edit.questions[+i].options.push(''); render(); },
  delopt: id => { const [i, k] = id.split(':').map(Number); const q = ST.edit.questions[i]; q.options.splice(k, 1); if (q.a >= q.options.length) q.a = 0; else if (q.a > k) q.a--; render(); },
  addpair: i => { ST.edit.questions[+i].pairs.push(['', '']); render(); },
  delpair: id => { const [i, k] = id.split(':').map(Number); ST.edit.questions[i].pairs.splice(k, 1); render(); },
  savequiz: action => saveQuiz(action)
});

/* ---------------- AI quiz generator ---------------- */
const AI_TYPES = ['pdf', 'slides', 'doc', 'image'];
function aiReadable(m) { return m.type === 'pdf' || m.type === 'image' || /\.(pptx|docx|txt)$/i.test(m.fileName || ''); }
function genForm(pre) {
  const s = C().settings;
  if (!s.aiReady) {
    openModal(`<h2>Generate a quiz with AI</h2><p>The AI quiz generator isn’t turned on yet. ${isAdmin() ? 'Add a free Gemini API key under School › Settings. The setup guide explains how to get one.' : 'Ask the admin to add a Gemini API key under Settings.'}</p><p class="small muted">You can still write quizzes yourself with “New quiz”.</p><div class="row">${isAdmin() ? '<button class="btn primary" data-act="gotab" data-id="settings">Open Settings</button>' : ''}<button class="btn" data-act="close">OK</button></div>`);
    return;
  }
  const g = Object.assign({ type: 'mixed', mix: ['mc', 'tf', 'id', 'match', 'enum', 'fill'], count: 10, difficulty: 'Balanced', bloom: ['Remember', 'Understand', 'Apply'], kind: 'practice', language: 'same', focus: '' }, LS.get('gen', {}));
  const mats = C().materials.filter(m => isMine(m) && m.status !== 'archived' && aiReadable(m)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const picked = pre ? [pre] : [];
  openModal(`<form id="genForm" class="field" style="gap:14px" novalidate><div><p class="label">AI quiz generator</p><h2>Make a quiz from your materials</h2><p class="small muted">The AI reads your files and writes a draft with answer keys and explanations. You review and approve it before students see it.</p></div>
    <div class="field"><span>Materials to use (up to 5)</span>${mats.length ? `<input type="search" id="genFind" placeholder="Filter by title or subject"><div class="bars" id="genMats" style="max-height:220px;overflow:auto;gap:6px">${mats.map(m => `<label class="check" data-text="${esc(norm(m.title + ' ' + m.subject + ' ' + m.topic))}"><input type="checkbox" class="genMat" value="${m.id}"${picked.includes(m.id) ? ' checked' : ''}>${typeTag(m, true)}<span><b>${esc(m.title)}</b><br><span class="small muted">${esc(m.subject)} · ${termName(m.term)} · ${esc(m.topic)}</span></span></label>`).join('')}</div>`
      : '<p class="small muted">Upload a PDF, PowerPoint (.pptx), Word (.docx) or picture first.</p>'}</div>
    <div class="fgrid two"><label class="field"><span>Test type</span><select id="genType">${opt('mixed', 'Mixed test types', g.type)}${QT_IDS.map(t => opt(t, QT[t], g.type)).join('')}</select></label>
    <label class="field"><span>Number of questions</span><input type="number" id="genCount" min="1" max="50" value="${esc(g.count)}"></label></div>
    <div class="field" id="genMix"${g.type === 'mixed' ? '' : ' hidden'}><span>Types to mix</span><div class="checks">${QT_IDS.map(t => `<label class="check"><input type="checkbox" class="genMix" value="${t}"${g.mix.includes(t) ? ' checked' : ''}> ${QT[t]}</label>`).join('')}</div><small>Short Answer, Problem-Solving and Essay are checked by you after students answer.</small></div>
    <div class="fgrid two"><label class="field"><span>Difficulty</span><select id="genDiff">${opt('Balanced', 'Balanced mix', g.difficulty)}${DIFFS.map(d => opt(d, d, g.difficulty)).join('')}</select></label>
    <label class="field"><span>Use as</span><select id="genKind">${Object.keys(KINDS).map(k => opt(k, KINDS[k], g.kind)).join('')}</select></label></div>
    <div class="field"><span>Cognitive levels (Revised Bloom’s Taxonomy)</span><div class="checks">${BLOOM.map(b => `<label class="check"><input type="checkbox" class="genBloom" value="${b}"${g.bloom.includes(b) ? ' checked' : ''}> ${b}</label>`).join('')}</div></div>
    <div class="fgrid two"><label class="field"><span>Focus on these topics (optional)</span><input type="text" id="genFocus" value="${esc(g.focus)}" placeholder="e.g. domain and range, vertical line test"></label>
    <label class="field"><span>Language</span><select id="genLang">${opt('same', 'Same as the material', g.language)}${opt('en', 'English', g.language)}${opt('fil', 'Filipino', g.language)}</select></label></div>
    <div class="row"><button class="btn primary" type="submit" id="genBtn"${mats.length ? '' : ' disabled'}>Generate draft</button><span class="err" id="genErr" role="alert"></span></div>
    <p class="small muted">Only your learning material is sent to Google’s Gemini AI. No student names or scores are sent.</p></form>`, true);
}
async function doGenerate(e) {
  e.preventDefault();
  const ids = $$('.genMat:checked').map(i => i.value);
  const o = { type: $('#genType').value, mixTypes: $$('.genMix:checked').map(i => i.value), count: Number($('#genCount').value) || 10, difficulty: $('#genDiff').value, bloom: $$('.genBloom:checked').map(i => i.value), focus: $('#genFocus').value, kind: $('#genKind').value, language: $('#genLang').value };
  const err = !ids.length ? 'Choose at least one material.' : ids.length > 5 ? 'Choose up to 5 materials.' : o.type === 'mixed' && !o.mixTypes.length ? 'Choose at least one type to mix.' : !(o.count >= 1 && o.count <= 50) ? 'Ask for 1 to 50 questions.' : !o.bloom.length ? 'Choose at least one cognitive level.' : '';
  if (err) { $('#genErr').textContent = err; return; }
  LS.set('gen', { type: o.type, mix: o.mixTypes, count: o.count, difficulty: o.difficulty, bloom: o.bloom, kind: o.kind, language: o.language, focus: '' });
  const btn = $('#genBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Reading your material and writing questions… this can take a minute';
  $('#genErr').textContent = '';
  try {
    const r = await api('generateQuiz', { materialIds: ids, options: { type: o.type, mixTypes: o.mixTypes, count: o.count, difficulty: o.difficulty, bloom: o.bloom, focus: o.focus, kind: o.kind, language: o.language } }, { timeout: 330000 });
    C().quizzes.push(r.quiz); await KV.set('catalog', ST.cat);
    closeModal();
    ST.edit = toEdit(r.quiz); ST.tab = 'quizzes'; render(); window.scrollTo(0, 0);
    toast('Draft ready: ' + plural(r.got, 'question') + (r.got < r.asked ? ' (some were left out because they weren’t usable)' : '') + '. Review it before publishing.');
  } catch (ex) { if ($('#genErr')) { $('#genErr').textContent = ex.message; btn.disabled = false; btn.textContent = 'Generate draft'; } else toast(ex.message); }
}
Object.assign(A, { gen: id => genForm(id) });
