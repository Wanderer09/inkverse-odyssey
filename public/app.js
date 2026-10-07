import { request, isDemo } from './transport.js';
const storagePrefix = isDemo ? 'inkverse-odyssey:' + new URL('.', import.meta.url).pathname + ':' : '';
const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageNames = { read: '读原文', understand: '说句意', retell: '讲故事', finish: '学习小结' };
const stages = Object.keys(stageNames);
const state = { config: null, page: 'home', session: null, note: null, segmented: false, answers: {}, hints: {}, feedback: null, draft: '', chatDraft: '', busy: false, teacher: null, filterLesson: 'all', filterStatus: 'all', filterData: 'all', deleting: null };
let toastTimer;
function notify(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200); }
function storageGet(key) { try { return sessionStorage.getItem(storagePrefix + key); } catch { return null; } }
function storageSet(key, value) { try { value == null ? sessionStorage.removeItem(storagePrefix + key) : sessionStorage.setItem(storagePrefix + key, value); } catch { notify('浏览器未允许保存会话，刷新后需重新开始。'); } }
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (path.startsWith('/api/teacher/') && storageGet('teacher-token')) headers.Authorization = 'Bearer ' + storageGet('teacher-token');
  if (path.startsWith('/api/sessions/') && storageGet('learning-token')) headers['X-Session-Token'] = storageGet('learning-token');
  const response = await request(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/teacher/')) storageSet('teacher-token', null);
    throw new Error(data.error || '操作失败，请重试。');
  }
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body });
const sessionPost = (action, body) => post(`/api/sessions/${state.session.id}/${action}`, body);
const currentLesson = () => state.config.lessons.find(l => l.id === state.session?.lessonId);
const date = str => new Date(str).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function header() {
  return `<header class="topbar"><button class="brand" data-action="home" aria-label="小古文书房首页"><span class="brandmark">文</span><span><span class="brand-title">小古文</span><span class="brand-sub">A LITTLE CLASSIC, A BIG WORLD</span></span></button><nav class="nav" aria-label="主导航"><span class="mode">${escape(state.config.label)}</span><button data-action="home" class="${state.page === 'home' ? 'active' : ''}">我的书房</button><button data-action="teacher" class="teacher-link ${state.page === 'teacher' ? 'active' : ''}">教师记录台 ↗</button></nav></header>`;
}
function footer() { return `<footer class="footer"><span>小古文 · 小学文言文启蒙学伴<br>借助注释读懂，用自己的话表达。</span><span>原文来自所附教学资料 · 提示与自动反馈供学习参考<br>仅使用学习编号；请勿输入姓名、学校、联系方式等个人信息。</span></footer>`; }
function home() {
  const resume = state.session && state.session.stage !== 'finish';
  return `<section class="hero"><div><span class="eyebrow">小学文言文启蒙学伴 / 03—04 年级</span><h1>读懂小古文，<br><span>讲出自己的故事。</span></h1><p>和小竹一起，在注释里寻找线索，<br>把古人的小故事，讲成自己的话。</p><div class="actions"><button class="button primary" data-action="${resume ? 'resume' : 'start'}" data-id="sima">${resume ? '继续我的学习' : '从《司马光》开始'} <span>→</span></button><button class="button subtle" data-action="courses">看看其他故事 ↓</button></div><p class="small disclosure">${escape(state.config.disclosure)}</p></div><div class="hero-art" aria-label="读原文、找线索、讲故事的学习步骤示意"><div class="art-book"><span class="book-word">古文</span></div><div class="art-tag tag-one"><span>一</span> 在原文里发现</div><div class="art-tag tag-two"><span>二</span> 从注释里读懂</div><div class="art-tag tag-three"><span>三</span> 用自己的话讲述</div></div></section><section id="courses"><div class="section-head"><div><h2>今天，读一个小故事</h2><p>从短短的一段开始，每一步都有小竹陪你。</p></div><span class="section-count">${state.config.lessons.length} 篇启蒙故事 · 按需选择</span></div><div class="course-grid">${state.config.lessons.map((l, i) => `<article class="course-card"><div class="course-art ${escape(l.color)}" aria-hidden="true"><span class="book-index">STORY / 0${i + 1}</span><span class="circle"></span><span class="char">${['光', '思', '羽', '耕'][i]}</span><span class="vertical">${escape(l.genre)}</span></div><div class="course-info"><div><span class="pill">${escape(l.grade)}</span><span class="pill">${escape(l.genre)}</span></div><h3>${escape(l.title)}</h3><p>${escape(l.intro)}</p><div class="course-bottom"><span class="small">${escape(l.duration)}</span><button data-action="start" data-id="${l.id}" aria-label="开始学习${escape(l.title)}">打开故事 →</button></div></div></article>`).join('')}</div></section><section class="method-strip" aria-label="学习方法"><h3>不急着背答案，<br>一步步读明白。</h3><div class="method-step"><span class="method-number">01</span><div><b>原文与注释一起读</b><p>点一点词语，找到理解线索。</p></div></div><div class="method-step"><span class="method-number">02</span><div><b>把句意说清楚</b><p>放回原句，试试自己的理解。</p></div></div><div class="method-step"><span class="method-number">03</span><div><b>自己讲，老师看</b><p>保留表达证据，跟进具体卡点。</p></div></div></section>`;
}
function original(lesson) {
  const words = lesson.notes.map(n => n[0]).sort((a, b) => b.length - a.length);
  const regex = new RegExp('((?:' + words.join('|') + ')[，。、“”？！：；]?)', 'g');
  const text = lesson.text.split(regex).map(part => {
    const word = part.replace(/[，。、“”？！：；]$/, '');
    return words.includes(word) ? `<span class="word-unit"><button class="annotation" data-action="note" data-word="${escape(word)}" aria-label="查看${escape(word)}的注释">${escape(word)}</button>${escape(part.slice(word.length))}</span>` : escape(part);
  }).join('');
  return `<div class="original">${state.segmented ? `<div class="segmented">${lesson.segmented.map(line => `<p>${escape(line)}</p>`).join('')}<p class="small">“/”提示停顿；可以先读一句，再看注释。</p></div>` : `<p class="classical">${text}</p>`}<p class="source">—— ${escape(lesson.source)}</p></div>`;
}
function notes(lesson) {
  const n = lesson.notes.find(n => n[0] === state.note);
  return `<div class="note-shelf" aria-label="词语注释">${lesson.notes.map(([word]) => `<button class="note-chip ${state.note === word ? 'selected' : ''}" data-action="note" data-word="${escape(word)}">${escape(word)}</button>`).join('')}</div>${n ? `<div class="note-detail" role="status"><b>${escape(n[0])}</b><span class="pinyin">${escape(n[1])}</span><p>${escape(n[2])}</p><p class="small">原文：“${escape(n[3])}”</p><p>${escape(n[4])}</p></div>` : '<p class="small">遇到不明白的词，点一下绿色词语或上面的注释卡。</p>'}`;
}
function read(lesson) {
  return `<div class="panel-head"><h2>先读一读，找找线索</h2><button class="button small-btn subtle" data-action="segment">${state.segmented ? '查看完整原文' : '显示停顿提示'}</button></div>${original(lesson)}${notes(lesson)}${lesson.caution ? `<div class="soft-notice">${escape(lesson.caution)}</div>` : ''}<div class="panel-end"><p class="small">不需要一口气读懂。借助注释，先认识故事里的人和事。</p><button class="button primary" data-action="stage" data-stage="understand">我来试试句意 →</button></div>`;
}
function understand(lesson) {
  const done = lesson.questions.every(q => state.session.answers.some(a => a.questionId === q.id && a.correct));
  return `<div class="panel-head"><h2>读懂两句话</h2><span class="small">错了也可以看注释，再试一次。</span></div><div class="reference">${escape(lesson.text)}</div>${lesson.questions.map((q, i) => {
    const answer = state.answers[q.id], correct = state.session.answers.some(a => a.questionId === q.id && a.correct);
    return `<section class="question-card"><div class="question-title"><span class="question-index">0${i + 1}</span><span>${escape(q.prompt)}</span></div><div class="options">${q.options.map((option, index) => `<button class="option ${correct && state.session.answers.some(a => a.questionId === q.id && a.correct && a.option === index) ? 'correct' : answer?.option === index && !answer.correct ? 'wrong' : ''}" data-action="answer" data-question="${q.id}" data-option="${index}" ${correct ? 'disabled' : ''}>${String.fromCharCode(65 + index)}. ${escape(option)}</button>`).join('')}</div><button class="hint-button" data-action="hint" data-question="${q.id}">给我一点提示</button>${answer ? `<p class="question-feedback ${answer.correct ? '' : 'wrong'}">${answer.correct ? '✓ ' : '再想一想：'}${escape(answer.reply)}</p>` : ''}${state.hints[q.id] ? `<p class="question-feedback">${escape(state.hints[q.id])}</p>` : ''}</section>`;
  }).join('')}${notes(lesson)}<div class="panel-end"><p class="small">${done ? '两句都读懂了，试着把它们连成一个故事。' : '完成两个小挑战，就可以讲故事了。'}</p><button class="button primary" data-action="stage" data-stage="retell" ${done ? '' : 'disabled'}>用自己的话讲故事 →</button></div>`;
}
function feedbackView(f) {
  return `<div class="feedback" aria-live="polite"><h3>小竹的讲述反馈</h3><p>${escape(f.reply)}</p>${f.fallback ? '<p class="notice-inline">模型暂不可用，本次使用本地提示。</p>' : ''}${f.rubric.map(r => `<div class="rubric"><div class="rubric-head"><b>${escape(r.label)}</b><span class="status ${r.status === '已提及' ? 'resolved' : ''}">${escape(r.status)}</span></div>${r.evidence ? `<p>表达证据：“${escape(r.evidence)}”</p>` : ''}<p>${escape(r.suggestion)}</p></div>`).join('')}<div class="soft-notice">${escape(f.note)}</div></div>`;
}
function retell(lesson) {
  return `<div class="panel-head"><h2>轮到你来讲故事</h2><span class="small">第 ${state.session.retellings.length + 1} 次表达</span></div><p class="small">像讲给朋友听一样，不需要逐字翻译。可以借助下面三个小问题。</p><div class="story-frame">${lesson.story.map((part, i) => `<div class="story-step"><span class="num">0${i + 1}</span><h3>${escape(part.label)}</h3><p>${escape(part.question)}</p></div>`).join('')}</div><details><summary class="small">需要时，再看一眼原文与注释</summary>${original(lesson)}${notes(lesson)}</details><form id="retell-form"><label class="field-label" for="retell-text">我的故事</label><textarea id="retell-text" class="retell-input" maxlength="1200" required placeholder="有一天……后来……最后……">${escape(state.draft)}</textarea><p class="word-count"><span id="word-count">${state.draft.length}</span> / 1200 字</p><div class="actions"><button class="button primary" type="submit">${state.feedback ? '改一改，再讲一次' : '讲给小竹听'} →</button><span class="small">表达会保留给教师复核。</span></div></form>${state.feedback ? feedbackView(state.feedback) : ''}<div class="panel-end"><p class="small">可以继续修改，也可以带着自己的故事完成本次学习。</p><button class="button subtle" data-action="stage" data-stage="finish" ${state.session.retellings.length ? '' : 'disabled'}>完成本次学习 ✓</button></div>`;
}
function finish(lesson) {
  return `<section class="complete"><div class="complete-mark">✓</div><h2>小故事，是你自己讲出来的。</h2><p>你完成了《${escape(lesson.title)}》的启蒙学习。<br>你的尝试和求助，老师都能看到。</p><div class="review-summary"><div><b>${new Set(state.session.notesViewed.map(n => n.word)).size}</b>个词语看过注释</div><div><b>${lesson.questions.filter(q => state.session.answers.some(a => a.questionId === q.id && a.correct)).length}</b>个句意小挑战完成</div><div><b>${state.session.retellings.length}</b>次自己的故事表达</div></div><div class="note-detail"><p>再想一想：${escape(lesson.transfer)}</p></div><div class="actions"><button class="button primary" data-action="home">回书房，读下一个故事 →</button><button class="button subtle" data-action="stage" data-stage="retell">再完善我的故事</button></div></section>`;
}
function companion(lesson) {
  const welcome = `你好，我是小竹。我们一起读《${lesson.title}》。先找一处你认识的词，不明白的地方可以看看注释，也可以问我。`;
  const messages = state.session.messages.length ? state.session.messages : [{ role: 'assistant', content: welcome }];
  return `<aside class="panel companion"><div class="companion-title"><span class="avatar" aria-hidden="true">竹</span><div><h3>小竹 · 你的古文学伴</h3><span class="small">慢慢想，一句句说。</span></div></div><div class="chat-messages" role="log" aria-label="和小竹的对话">${messages.map(m => `<div class="bubble ${m.role === 'user' ? 'user' : ''}"><span class="bubble-label">${m.role === 'user' ? '我' : '小竹'}</span>${escape(m.content)}</div>`).join('')}${state.busy ? '<div class="busy-notice" role="status">小竹正在想一想……</div>' : ''}</div><div class="quick-prompts"><button data-action="quick" data-text="我不知道从哪一句开始">不知道从哪开始</button><button data-action="quick" data-text="我想要一点提示">给我一点提示</button></div><form class="chat-form" id="chat-form"><label class="small" for="chat-input">把你想问的告诉小竹</label><textarea id="chat-input" maxlength="600" placeholder="例如：这里的“去”是什么意思？" required>${escape(state.chatDraft)}</textarea><div class="chat-bottom"><span class="small">${escape(state.config.label)}</span><button class="button primary small-btn" type="submit">发送 ↑</button></div></form><div class="soft-notice">${escape(state.config.disclosure)}<br>不要输入个人信息。</div></aside>`;
}
function study() {
  const l = currentLesson(), index = stages.indexOf(state.session.stage);
  return `<div class="lesson-heading"><div><button class="back" data-action="home">← 回到我的书房</button><span class="eyebrow">${escape(l.grade)} · ${escape(l.genre)}</span><h1>${escape(l.title)}</h1><span class="small">学习编号 ${escape(state.session.student)}</span></div><nav class="progress" aria-label="学习阶段">${stages.map((stage, i) => `<button class="${i === index ? 'current' : i < index ? 'done' : ''}" data-action="stage" data-stage="${stage}" ${i > index ? 'disabled' : ''}>${i < index ? '✓' : '0' + (i + 1)} ${stageNames[stage]}</button>`).join('')}</nav></div><div class="study-grid"><main class="panel">${({ read, understand, retell, finish })[state.session.stage](l)}</main>${companion(l)}</div>`;
}
function teacher() {
  const real = state.teacher.records.filter(r => !r.synthetic), sessions = state.teacher.sessions.filter(s => !s.synthetic);
  const records = state.teacher.records.filter(r => (state.filterLesson === 'all' || r.lessonId === state.filterLesson) && (state.filterStatus === 'all' || r.status === state.filterStatus) && (state.filterData === 'all' || (state.filterData === 'real' ? !r.synthetic : r.synthetic))).toReversed();
  const counts = Object.fromEntries(['词句理解', '支架求助', '表达求助', '故事复述', '原文转述'].map(c => [c, real.filter(r => r.category === c).length]));
  return `<section class="teacher-heading"><div><span class="eyebrow">TEACHER’S DESK / 教师记录台</span><h1>看见卡点，接住每一次尝试。</h1><p>从学生的具体表达出发，决定下一步怎么教。</p></div><div class="actions"><button class="button small-btn" data-action="refresh">刷新记录 ↻</button><button class="button primary small-btn" data-action="export">导出 CSV ↓</button><button class="button subtle small-btn" data-action="logout">退出</button></div></section><div class="metrics"><div class="metric"><span class="metric-label">参与学习</span><div class="metric-value">${sessions.length}</div><p>按学习会话计数，不代表独立人数</p></div><div class="metric"><span class="metric-label">等待复核</span><div class="metric-value">${real.filter(r => r.status === '待复核').length}</div><p>自动提示需要教师结合原始回答判断</p></div><div class="metric"><span class="metric-label">正在跟进</span><div class="metric-value">${real.filter(r => r.status === '跟进中').length}</div><p>为具体卡点安排后续教学</p></div><div class="metric"><span class="metric-label">已解决</span><div class="metric-value">${real.filter(r => r.status === '已解决').length}</div><p>由教师复核后标记</p></div></div><div class="teacher-grid"><section class="panel"><div class="panel-head"><h2>学习过程与困难记录</h2><span class="small">${records.length} 条 · 演示数据不计入统计</span></div><div class="filters"><label class="small">课文 <select id="filter-lesson" aria-label="按课文筛选"><option value="all">全部课文</option>${state.config.lessons.map(l => `<option value="${l.id}" ${state.filterLesson === l.id ? 'selected' : ''}>${escape(l.title)}</option>`).join('')}</select></label><label class="small">状态 <select id="filter-status" aria-label="按复核状态筛选">${['all', '待复核', '跟进中', '已解决', '无需跟进'].map(v => `<option value="${v}" ${state.filterStatus === v ? 'selected' : ''}>${v === 'all' ? '全部状态' : v}</option>`).join('')}</select></label><label class="small">数据 <select id="filter-data" aria-label="按数据类型筛选">${[['all', '全部数据'], ['real', '学习过程数据'], ['demo', '合成演示数据']].map(([v, label]) => `<option value="${v}" ${state.filterData === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="records">${records.length ? records.map(recordView).join('') : `<div class="empty"><span class="avatar">记</span><h3>等待一段真实的学习过程</h3><p>学生答错、主动求助或提交故事后，记录会出现在这里。<br>也可以载入带标签的合成数据，预览复核流程。</p><div class="actions"><button class="button subtle" data-action="seed">载入合成演示数据</button><button class="button primary" data-action="home">去体验学生学习 →</button></div></div>`}</div></section><aside><section class="panel insight"><div><h3>卡点分布</h3><p>只汇总学习过程数据；次数用于安排教学，不作为能力排名。</p>${Object.entries(counts).map(([label, count]) => `<div class="bar-row"><div class="bar-label"><span>${label}</span><span>${count}</span></div><div class="bar"><svg width="100%" height="7" aria-hidden="true"><rect width="${real.length ? Math.round(count / real.length * 100) : 0}%" height="7" rx="3" fill="#92a66e"/></svg></div></div>`).join('')}</div><div><h3>把记录用在教学里</h3><ol class="hint-list"><li>先看学生的原始回答。</li><li>确认是词义、因果还是表达卡点。</li><li>写下一句可执行的追问。</li><li>面谈后更新复核状态。</li></ol><p>查看注释是一种学习策略，不自动认定为困难。</p><button class="button small-btn subtle" data-action="seed">预览合成演示数据</button></div></section><div class="soft-notice">教师入口供本地作品演示。真实部署需学校账号、权限与数据管理制度。</div></aside></div>`;
}
function recordView(r) {
  const lesson = state.config.lessons.find(l => l.id === r.lessonId), s = state.teacher.sessions.find(s => s.id === r.sessionId);
  return `<article class="record ${r.synthetic ? 'sample' : ''}"><div class="record-head"><div><span class="record-id">${escape(r.student)}</span> ${r.synthetic ? '<span class="demo-badge">合成演示</span>' : ''}<p class="record-meta">${escape(lesson.title)} · ${stageNames[r.stage]} · ${escape(r.category)}</p></div><span class="status ${r.status === '已解决' || r.status === '无需跟进' ? 'resolved' : r.status === '跟进中' ? 'follow' : ''}">${escape(r.status)}</span></div><p class="record-preview">${escape(r.evidence)}</p><details><summary>查看依据与教师复核</summary><div class="record-detail"><h4>建议下一步</h4><p>${escape(r.suggestion || '结合学生表达确认是否需要跟进。')}</p>${r.rubric ? `<h4>复述反馈（${r.engine === 'model' ? 'AI 辅助' : '本地线索检查'}，需复核）</h4>${r.rubric.map(item => `<p>${escape(item.label)} · ${escape(item.status)}：${escape(item.suggestion)}</p>`).join('')}` : ''}<h4>学习过程</h4><p>查看注释 ${s?.notesViewed.length ?? 0} 次 · 句意尝试 ${s?.answers.length ?? 0} 次 · 故事表达 ${s?.retellings.length ?? 0} 次</p><form class="review-form" data-record="${r.id}"><label>复核状态 <select name="status">${['待复核', '跟进中', '已解决', '无需跟进'].map(v => `<option ${r.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>教师观察与跟进<textarea name="note" maxlength="800" rows="3" placeholder="例如：面谈后能解释“去”，下一次请再用自己的话讲结果。">${escape(r.teacherNote)}</textarea></label><div class="actions"><button class="button primary small-btn" type="submit">保存复核</button><button class="button subtle small-btn" type="button" data-action="delete" data-id="${r.sessionId}">删除此学习编号的全部记录</button></div></form><p class="record-time">记录于 ${date(r.createdAt)}${r.reviewedAt ? ' · 复核于 ' + date(r.reviewedAt) : ''}</p></div></details></article>`;
}
function sessionManagement() {
  return `<details class="panel session-management"><summary>学习会话管理 · ${state.teacher.sessions.length} 次</summary><p class="small">包括尚未产生困难记录的会话。每个编号对应一次学习，可删除该编号的全部数据。</p>${state.teacher.sessions.map(s => `<div class="session-row"><div><b>${escape(s.student)}</b> ${s.synthetic ? '<span class="demo-badge">合成演示</span>' : ''}<p>${escape(state.config.lessons.find(l => l.id === s.lessonId).title)} · ${stageNames[s.stage]} · ${date(s.updatedAt)}</p></div><button class="button subtle small-btn" data-action="delete" data-id="${s.id}" aria-label="删除${escape(s.student)}的学习会话">删除会话</button></div>`).join('')}</details>`;
}
function render() {
  $('#app').innerHTML = `<div class="container">${header()}${state.page === 'home' ? home() : state.page === 'study' ? study() : teacher() + sessionManagement()}${footer()}</div>`;
  if (state.busy) $('#app').querySelectorAll('button,select').forEach(el => el.disabled = true);
  const log = $('.chat-messages'); if (log) log.scrollTop = log.scrollHeight;
}
async function run(task, shouldRender = true) {
  if (state.busy) return;
  state.busy = true;
  if (shouldRender) render();
  try { await task(); } catch (error) { notify(error.message); }
  finally { state.busy = false; render(); }
}
async function refreshSession() { state.session = await api(`/api/sessions/${state.session.id}`); }
async function loadTeacher() { state.teacher = await api('/api/teacher/records'); state.page = 'teacher'; }
async function changeStage(stage) {
  state.session = await sessionPost('stage', { stage });
  state.note = null; state.answers = {}; state.hints = {};
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function sendChat(text) {
  const answer = await sessionPost('chat', { message: text });
  state.chatDraft = ''; await refreshSession();
  if (answer.fallback) notify('模型暂不可用，本次使用本地教学提示。');
}
$('#app').addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el || state.busy) return;
  const action = el.dataset.action;
  if (action === 'home') { state.page = 'home'; render(); window.scrollTo(0, 0); return; }
  if (action === 'courses') { $('#courses')?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (action === 'resume') { state.page = 'study'; render(); return; }
  if (action === 'segment') { state.segmented = !state.segmented; render(); return; }
  if (action === 'teacher' && !storageGet('teacher-token')) { $('#login-error').textContent = ''; $('#login-dialog').showModal(); return; }
  if (action === 'delete') { state.deleting = el.dataset.id; $('#delete-dialog').showModal(); return; }
  run(async () => {
    if (action === 'start') {
      const s = await post('/api/sessions', { lessonId: el.dataset.id }); storageSet('learning-id', s.id); storageSet('learning-token', s.token);
      delete s.token; state.session = s; state.page = 'study'; state.note = null; state.answers = {}; state.hints = {}; state.feedback = null; state.draft = ''; state.chatDraft = ''; state.segmented = false; window.scrollTo(0, 0);
    }
    if (action === 'stage') await changeStage(el.dataset.stage);
    if (action === 'note') { await sessionPost('note', { word: el.dataset.word }); state.note = el.dataset.word; await refreshSession(); }
    if (action === 'answer') { const option = Number(el.dataset.option), id = el.dataset.question; state.answers[id] = { ...await sessionPost('answer', { questionId: id, option }), option }; await refreshSession(); }
    if (action === 'hint') state.hints[el.dataset.question] = (await sessionPost('hint', { questionId: el.dataset.question })).reply;
    if (action === 'quick') await sendChat(el.dataset.text);
    if (action === 'teacher' || action === 'refresh') { try { await loadTeacher(); } catch (error) { if (!storageGet('teacher-token')) { state.page = 'home'; $('#login-dialog').showModal(); } throw error; } }
    if (action === 'seed') { await post('/api/teacher/seed', {}); await loadTeacher(); notify('已载入合成演示数据，不计入学习统计。'); }
    if (action === 'logout') { await post('/api/teacher/logout', {}); storageSet('teacher-token', null); state.teacher = null; state.page = 'home'; }
    if (action === 'export') {
      const response = await request('/api/teacher/export', { headers: { Authorization: 'Bearer ' + storageGet('teacher-token') } });
      if (!response.ok) throw new Error('导出失败，请重新登录教师记录台。');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = '小古文-学习困难记录.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('已导出全部记录，包含明确标识的演示数据。');
    }
  });
});
$('#app').addEventListener('input', event => {
  if (event.target.id === 'retell-text') { state.draft = event.target.value; $('#word-count').textContent = state.draft.length; }
  if (event.target.id === 'chat-input') state.chatDraft = event.target.value;
});
$('#app').addEventListener('change', event => {
  const key = { 'filter-lesson': 'filterLesson', 'filter-status': 'filterStatus', 'filter-data': 'filterData' }[event.target.id];
  if (key) { state[key] = event.target.value; render(); }
});
$('#app').addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'chat-form') { const text = state.chatDraft.trim(); if (text) run(() => sendChat(text)); }
  if (event.target.id === 'retell-form') { const text = state.draft.trim(); if (text) run(async () => { state.feedback = await sessionPost('retell', { text }); await refreshSession(); }); }
  if (event.target.matches('.review-form')) {
    const form = event.target, formData = new FormData(form), id = form.dataset.record;
    run(async () => { await api(`/api/teacher/records/${id}`, { method: 'PATCH', body: { status: formData.get('status'), teacherNote: formData.get('note') } }); await loadTeacher(); notify('教师复核已保存。'); });
  }
});
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const auth = await post('/api/teacher/login', { pin: $('#teacher-pin').value }); storageSet('teacher-token', auth.token); $('#teacher-pin').value = ''; await loadTeacher(); $('#login-dialog').close(); render(); }
  catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#close-login').addEventListener('click', () => $('#login-dialog').close());
$('#close-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#delete-form').addEventListener('submit', event => { event.preventDefault(); $('#delete-dialog').close(); run(async () => { await api(`/api/teacher/sessions/${state.deleting}`, { method: 'DELETE' }); if (state.session?.id === state.deleting) { state.session = null; storageSet('learning-id', null); storageSet('learning-token', null); } await loadTeacher(); notify('已删除该学习编号的全部记录。'); }); });
async function init() {
  try {
    state.config = await api('/api/config');
    const id = storageGet('learning-id');
    if (id && storageGet('learning-token')) {
      try { state.session = await api(`/api/sessions/${id}`); const last = state.session.retellings.at(-1); if (last) { state.draft = last.text; state.feedback = last.feedback; } }
      catch { storageSet('learning-id', null); storageSet('learning-token', null); }
    }
    render();
  } catch (error) { $('#app').innerHTML = `<div class="error-page"><h1>书房暂时没有打开</h1><p>${escape(isDemo ? error.message : '请确认本地服务已启动，再刷新页面。')}</p><a class="button" href="./">重新打开</a></div>`; }
}
init();
