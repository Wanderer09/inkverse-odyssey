import { lessons, publicLesson, extraReading } from '../content/lessons.mjs';
import { redact, localChat, localRetell, localReflect } from '../agent/teaching.mjs';

const stages = ['read', 'understand', 'retell', 'reflect', 'finish'];
const stageNames = { read: '读一读', understand: '读一读·句意', retell: '说一说', reflect: '悟一悟', finish: '学习小结' };
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const safe = session => { const { token, ...rest } = session; return rest; };
const clone = value => JSON.parse(JSON.stringify(value));
export function demoCsvCell(value) {
  const text = String(value ?? '');
  return '"' + (/^\s*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
}
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

export function createDemoEngine({ storage, authStorage, namespace = 'inkverse-odyssey.v1', id = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  let persistent = true;
  try {
    storage ??= globalThis.localStorage;
    const probe = namespace + '.probe'; storage.setItem(probe, '1'); storage.removeItem(probe);
  } catch { storage = memoryStorage(); persistent = false; }
  try { authStorage ??= globalThis.sessionStorage; authStorage.getItem(namespace + '.auth'); } catch { authStorage = memoryStorage(); }
  const key = namespace + '.learning';
  const authKey = namespace + '.auth';
  const issue = (value, max = 1200) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw error(`请输入1至${max}个字符。`);
    return redact(value.trim());
  };
  function read() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return { version: 1, sessions: [], records: [] };
      const state = JSON.parse(raw);
      if (state.version !== 1 || !Array.isArray(state.sessions) || !Array.isArray(state.records)) throw error('数据格式错误');
      return state;
    } catch { throw error('本浏览器的演示数据无法读取。请先导出可用记录，或在浏览器网站设置中清理此站点数据。', 500); }
  }
  function save(state) {
    try { storage.setItem(key, JSON.stringify(state)); }
    catch { throw error('浏览器存储空间不足，本次操作尚未保存。请导出并清理旧记录后重试。', 507); }
  }
  function teacher(headers) {
    const raw = authStorage.getItem(authKey);
    let auth; try { auth = JSON.parse(raw); } catch { /* not logged in */ }
    if (!auth || auth.expires < Date.parse(now()) || headers.get('Authorization') !== 'Bearer ' + auth.token) throw error('请先进入教师演示记录台。', 401);
  }
  function record(state, session, category, evidence, suggestion, extra = {}) {
    state.records.push({ id: id(), sessionId: session.id, student: session.student, lessonId: session.lessonId, stage: session.stage, category, evidence: evidence.slice(0, 1200), suggestion, createdAt: now(), status: '待复核', teacherNote: '', synthetic: session.synthetic ?? false, engine: 'browser-demo', ...extra });
  }
  function execute(path, options) {
    const method = options.method ?? 'GET', headers = new Headers(options.headers ?? {});
    let body; try { body = options.body ? JSON.parse(options.body) : {}; } catch { throw error('请求格式无效。'); }
    if (method === 'GET' && path === '/api/config') return {
      isDemo: true, mode: 'local', model: null, label: '浏览器本地演示', persistence: persistent ? 'localStorage' : 'memory',
      disclosure: persistent ? 'GitHub Pages 演示版：学伴使用本地支架提示。学习与教师记录只存于当前浏览器，不发送到服务器；复述语义需教师复核。' : '浏览器未允许本地存储。本次可临时体验，但刷新后记录会丢失；学伴采用本地提示，复述需教师复核。',
      extraReading, lessons: lessons.map(publicLesson)
    };
    const state = read();
    if (method === 'POST' && path === '/api/sessions') {
      const lesson = lessons.find(l => l.id === body.lessonId); if (!lesson) throw error('请选择课程。');
      const token = id();
      const session = { id: id(), token, student: '学伴-' + id().replaceAll('-', '').slice(0, 6).toUpperCase(), lessonId: lesson.id, stage: 'read', notesViewed: [], answers: [], retellings: [], messages: [], createdAt: now(), updatedAt: now() };
      state.sessions.push(session); save(state); return { ...safe(session), token };
    }
    const match = path.match(/^\/api\/sessions\/([^/]+)(?:\/(\w+))?$/);
    if (match) {
      const session = state.sessions.find(s => s.id === match[1] && !s.synthetic);
      if (!session || session.token !== headers.get('X-Session-Token')) throw error('学习会话已失效，请重新开始。', 404);
      if (method === 'GET' && !match[2]) return safe(session);
      if (method !== 'POST') throw error('不支持此操作。', 405);
      const lesson = lessons.find(l => l.id === session.lessonId), action = match[2];
      session.updatedAt = now();
      if (action === 'stage') {
        const target = stages.indexOf(body.stage), current = stages.indexOf(session.stage);
        if (target < 0 || target > current + 1) throw error('请按顺序学习。');
        if (target >= 1 && !session.readingCheck && !session.answers.length) throw error('先自查字音和朗读，再继续。');
        if (target >= 2 && !lesson.questions.every(q => session.answers.some(a => a.questionId === q.id && a.correct))) throw error('先完成两个读懂小挑战，再进入说一说。');
        if (target >= 3 && !session.retellings.length) throw error('先提交一次自己的文意表达。');
        if (target === 4 && !session.reflections?.length) throw error('先提交自己的感悟。');
        session.stage = body.stage; save(state); return safe(session);
      }
      if (action === 'reading') {
        if (session.stage !== 'read' || body.pronunciation !== true || body.fluency !== true) throw error('请完成两项朗读自查。');
        session.readingCheck = { pronunciation: true, fluency: true, type: '学生自查', at: now() }; save(state); return { ok: true };
      }
      if (action === 'reflect') {
        if (session.stage !== 'reflect') throw error('请在悟一悟阶段表达。');
        const text = issue(body.text), feedback = localReflect(lesson, text);
        (session.reflections ??= []).push({ text, feedback, at: now() });
        record(state, session, lesson.reflectionCategory ?? '道理感悟', text, lesson.reflectionPrompt); save(state); return feedback;
      }
      if (action === 'note') {
        if (!lesson.notes.some(n => n[0] === body.word)) throw error('词语无效。');
        session.notesViewed.push({ word: body.word, at: now() }); save(state); return { ok: true };
      }
      if (action === 'answer') {
        if (session.stage !== 'understand') throw error('请在读懂阶段作答。');
        const question = lesson.questions.find(q => q.id === body.questionId);
        if (!question || !Number.isInteger(body.option) || body.option < 0 || body.option >= question.options.length) throw error('请选择有效答案。');
        const correct = body.option === question.answer;
        session.answers.push({ questionId: question.id, option: body.option, correct, at: now() });
        if (!correct) record(state, session, '词句理解', `问题：${question.prompt}\n学生选择：${question.options[body.option]}`, question.hint);
        save(state); return { correct, reply: correct ? question.explanation : question.hint };
      }
      if (action === 'hint') {
        const question = lesson.questions.find(q => q.id === body.questionId); if (!question) throw error('题目无效。');
        record(state, session, '支架求助', `学生请求“${question.prompt}”的提示。`, '观察学生能否将注释中的词义放回原句。');
        save(state); return { reply: question.hint };
      }
      if (action === 'chat') {
        const text = issue(body.message, 600);
        if (session.messages.length >= 120) throw error('本次对话已满，请完成故事或新开学习。');
        const reply = localChat(lesson, session, text);
        session.messages.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
        if (/不知道|不会|不懂|好难|提示/.test(text)) record(state, session, '表达求助', text, '用一句一问的方式检查具体卡点，避免推断能力。');
        save(state); return { reply, engine: 'local', fallback: false };
      }
      if (action === 'retell') {
        if (session.stage !== 'retell') throw error('请先完成读懂阶段。');
        const text = issue(body.text), character = issue(body.character, 600), feedback = localRetell(lesson, text);
        session.retellings.push({ text, character, feedback, at: now() });
        record(state, session, lesson.characterLabel, character, lesson.characterPrompt);
        record(state, session, feedback.copied ? '原文转述' : ({story:'故事复述',ideas:'文意讲述',poetry:'诗意表达',scenery:'景物讲述'}[lesson.expressionType] ?? '文意讲述'), text, feedback.rubric.map(r => r.suggestion).join(' '), { rubric: feedback.rubric });
        save(state); return { ...feedback, fallback: false, attempt: session.retellings.length };
      }
      throw error('未找到此操作。', 404);
    }
    if (method === 'POST' && path === '/api/teacher/login') {
      if (body.pin !== '246810') throw error('演示口令不正确。', 401);
      const token = id(); authStorage.setItem(authKey, JSON.stringify({ token, expires: Date.parse(now()) + 8 * 3600000 })); return { token };
    }
    if (path.startsWith('/api/teacher/')) {
      teacher(headers);
      if (method === 'POST' && path === '/api/teacher/logout') { authStorage.removeItem(authKey); return { ok: true }; }
      if (method === 'GET' && path === '/api/teacher/records') return { records: state.records, sessions: state.sessions.map(safe) };
      if (method === 'POST' && path === '/api/teacher/seed') {
        if (!state.sessions.some(s => s.synthetic)) {
          for (const [number, category, evidence] of [[1, '词句理解', '问题：“去”是什么意思？学生选择：前往别处。'], [2, '故事复述', '小朋友在院子里玩，有人掉进瓮里。司马光拿石头打破了瓮。'], [3, '表达求助', '我不懂“竞走”是什么意思。']]) {
            const session = { id: id(), student: `演示学生-${number}`, lessonId: number === 3 ? 'wang' : 'sima', stage: number === 2 ? 'retell' : 'understand', notesViewed: [], answers: [], retellings: [], messages: [], createdAt: now(), updatedAt: now(), synthetic: true };
            state.sessions.push(session); record(state, session, category, evidence, number === 2 ? '追问：水怎样了？落水的孩子结果怎样？' : '回看注释，试着把词义放进原句。');
          }
          save(state);
        }
        return { ok: true };
      }
      const rm = path.match(/^\/api\/teacher\/records\/([^/]+)$/);
      if (method === 'PATCH' && rm) {
        const r = state.records.find(r => r.id === rm[1]); if (!r) throw error('记录不存在。', 404);
        if (!['待复核', '跟进中', '已解决', '无需跟进'].includes(body.status) || typeof body.teacherNote !== 'string' || body.teacherNote.length > 800) throw error('复核信息无效。');
        r.status = body.status; r.teacherNote = redact(body.teacherNote); r.reviewedAt = now(); save(state); return r;
      }
      const sm = path.match(/^\/api\/teacher\/sessions\/([^/]+)$/);
      if (method === 'DELETE' && sm) {
        state.sessions = state.sessions.filter(s => s.id !== sm[1]); state.records = state.records.filter(r => r.sessionId !== sm[1]); save(state); return { ok: true };
      }
      if (method === 'GET' && path === '/api/teacher/export') {
        const rows = [['学习编号', '课文', '学习阶段', '记录类型', '原始证据', '跟进建议', '复核状态', '教师备注', '记录时间', '数据类型'], ...state.records.map(r => [r.student, (() => {const l=lessons.find(l=>l.id===r.lessonId);return (l.collection==='extra'?'课外'+String(l.number).padStart(3,'0')+' · ':'')+l.title;})(), stageNames[r.stage], r.category, r.evidence, r.suggestion, r.status, r.teacherNote, r.createdAt, r.synthetic ? '合成演示数据' : '浏览器演示学习数据'])];
        return { csv: '\ufeff' + rows.map(row => row.map(demoCsvCell).join(',')).join('\r\n') };
      }
    }
    throw error('接口不存在。', 404);
  }
  return {
    async request(path, options = {}) {
      try {
        const data = clone(execute(path, options));
        if (data.csv != null) return new Response(data.csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
        return new Response(JSON.stringify(data), { status: path === '/api/sessions' && options.method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: e.status ?? 500, headers: { 'Content-Type': 'application/json' } }); }
    }
  };
}
