import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lessons, publicLesson, extraReading } from './content/lessons.mjs';
import { SYSTEM_PROMPT, redact, localChat, localRetell, localReflect, callModel, modelRetell } from './agent/core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => Object.assign(new Error(message), { status });
const idToken = () => randomBytes(24).toString('hex');
const stages = ['read', 'understand', 'retell', 'reflect', 'finish'];
const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function csvCell(value) { const s = String(value ?? ''); return '"' + (/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'; }

export function createApp(options = {}) {
  const dataDir = options.dataDir ?? join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const dataFile = join(dataDir, 'learning.json');
  let store = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : { sessions: [], records: [] };
  const teacherPin = options.teacherPin ?? process.env.TEACHER_PIN ?? '246810';
  const config = options.modelConfig ?? { apiKey: process.env.MODEL_API_KEY ?? '', endpoint: process.env.MODEL_ENDPOINT ?? '', model: process.env.MODEL_NAME ?? 'qwen-plus', consent: process.env.MODEL_DATA_CONSENT === 'true' };
  const online = Boolean(config.apiKey && config.endpoint && config.consent);
  if (online && !/^https:\/\//.test(config.endpoint) && !options.allowInsecureModel) throw new Error('模型接口必须使用 HTTPS');
  const auth = new Map(), rates = new Map(), busy = new Set();
  function save() { writeFileSync(dataFile + '.tmp', JSON.stringify(store, null, 2)); renameSync(dataFile + '.tmp', dataFile); }
  function record(session, category, evidence, suggestion, extra = {}) {
    store.records.push({ id: randomUUID(), sessionId: session.id, student: session.student, lessonId: session.lessonId, stage: session.stage, category, evidence: evidence.slice(0, 1200), suggestion, createdAt: new Date().toISOString(), status: '待复核', teacherNote: '', synthetic: session.synthetic ?? false, ...extra });
  }
  function limit(key, max) {
    const now = Date.now(), old = rates.get(key);
    const entry = old && now - old.start < 60000 ? old : { start: now, count: 0 };
    entry.count++; rates.set(key, entry);
    if (rates.size > 5000) for (const [k, v] of rates) if (now - v.start > 60000) rates.delete(k);
    if (entry.count > max) throw fail(429, '操作有点快，请稍等一分钟再试。');
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16000) throw fail(413, '内容过长，请分段表达。'); }
    try { return JSON.parse(text || '{}'); } catch { throw fail(400, '请求格式不正确。'); }
  }
  function input(value, max = 1200) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(400, `请输入1至${max}个字符。`); return redact(value.trim()); }
  function teacher(req) {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token || !auth.has(token) || auth.get(token) < Date.now()) { auth.delete(token); throw fail(401, '请先登录教师记录台。'); }
  }
  function sessionFor(req, id) {
    const s = store.sessions.find(s => s.id === id && !s.synthetic);
    if (!s || !same(req.headers['x-session-token'], s.token)) throw fail(404, '学习会话已失效，请重新开始。');
    return s;
  }
  const safeSession = s => { const { token, ...rest } = s; return rest; };
  const server = http.createServer(async (req, res) => {
    const reply = (status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const path = new URL(req.url, 'http://localhost').pathname;
    let lock;
    try {
      if (path.startsWith('/api/')) {
        limit(req.socket.remoteAddress + ':api', 200);
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail(403, '不接受跨站请求。');
        if (req.method === 'GET' && path === '/api/config') return reply(200, { mode: online ? 'model' : 'local', model: online ? config.model : null, label: online ? '国产大模型学伴' : '本地教学演示', disclosure: online ? '学生表达将发送给配置的模型服务；自动反馈需教师复核。' : '无需密钥即可演示。本地规则提供支架提示，复述语义需教师复核。', extraReading, lessons: lessons.map(publicLesson) });
        if (req.method === 'POST' && path === '/api/sessions') {
          limit(req.socket.remoteAddress + ':create', 20);
          const data = await body(req), lesson = lessons.find(l => l.id === data.lessonId);
          if (!lesson) throw fail(400, '请选择课程。');
          const s = { id: randomUUID(), token: idToken(), student: '学伴-' + randomBytes(3).toString('hex').toUpperCase(), lessonId: lesson.id, stage: 'read', notesViewed: [], answers: [], retellings: [], messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          store.sessions.push(s); save(); return reply(201, { ...safeSession(s), token: s.token });
        }
        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(?:\/(\w+))?$/);
        if (sessionMatch) {
          const s = sessionFor(req, sessionMatch[1]), action = sessionMatch[2], lesson = lessons.find(l => l.id === s.lessonId);
          if (req.method === 'GET' && !action) return reply(200, safeSession(s));
          if (req.method !== 'POST') throw fail(405, '不支持该请求。');
          if (busy.has(s.id)) throw fail(409, '学伴正在回复，请稍等。');
          lock = s.id; busy.add(lock);
          const data = await body(req); s.updatedAt = new Date().toISOString();
          if (action === 'stage') {
            if (!stages.includes(data.stage)) throw fail(400, '学习阶段无效。');
            const target = stages.indexOf(data.stage), current = stages.indexOf(s.stage);
            if (target > current + 1) throw fail(400, '请按顺序学习。');
            if (target >= 1 && !s.readingCheck && !s.answers.length) throw fail(400, '先自查字音和朗读，再继续。');
            if (target >= 2 && !lesson.questions.every(q => s.answers.some(a => a.questionId === q.id && a.correct))) throw fail(400, '先完成两个读懂小挑战，再进入说一说。');
            if (target >= 3 && !s.retellings.length) throw fail(400, '先提交一次自己的文意表达。');
            if (target === 4 && !s.reflections?.length) throw fail(400, '先提交自己的感悟。');
            s.stage = data.stage; save(); return reply(200, safeSession(s));
          }
          if (action === 'reading') {
            if (s.stage !== 'read' || data.pronunciation !== true || data.fluency !== true) throw fail(400, '请完成两项朗读自查。');
            s.readingCheck = { pronunciation: true, fluency: true, type: '学生自查', at: new Date().toISOString() }; save(); return reply(200, { ok: true });
          }
          if (action === 'reflect') {
            if (s.stage !== 'reflect') throw fail(400, '请在悟一悟阶段表达。');
            const text = input(data.text), feedback = localReflect(lesson, text);
            (s.reflections ??= []).push({ text, feedback, at: new Date().toISOString() });
            record(s, lesson.reflectionCategory ?? '道理感悟', text, lesson.reflectionPrompt); save(); return reply(200, feedback);
          }
          if (action === 'note') {
            const note = lesson.notes.find(n => n[0] === data.word); if (!note) throw fail(400, '词语无效。');
            s.notesViewed.push({ word: data.word, at: new Date().toISOString() });
            // 阅读注释是有效学习策略，不自动记为学习困难。
            save(); return reply(200, { ok: true });
          }
          if (action === 'answer') {
            if (s.stage !== 'understand') throw fail(400, '请在读懂阶段作答。');
            const q = lesson.questions.find(q => q.id === data.questionId);
            if (!q || !Number.isInteger(data.option) || data.option < 0 || data.option >= q.options.length) throw fail(400, '请选择有效答案。');
            const correct = data.option === q.answer;
            s.answers.push({ questionId: q.id, option: data.option, correct, at: new Date().toISOString() });
            if (!correct) record(s, '词句理解', `问题：${q.prompt}\n学生选择：${q.options[data.option]}`, q.hint);
            save(); return reply(200, { correct, reply: correct ? q.explanation : q.hint });
          }
          if (action === 'hint') {
            const q = lesson.questions.find(q => q.id === data.questionId); if (!q) throw fail(400, '题目无效。');
            record(s, '支架求助', `学生请求“${q.prompt}”的提示。`, '观察学生能否将注释中的词义放回原句。'); save(); return reply(200, { reply: q.hint });
          }
          if (action === 'chat') {
            const text = input(data.message, 600); if (s.messages.length >= 120) throw fail(400, '本次对话已满，请完成故事或新开学习。');
            let engine = 'local', fallback = false, answer;
            if (online) {
              try { answer = await callModel(config, [{ role: 'system', content: SYSTEM_PROMPT + '\n当前学习阶段：' + ({read:'读一读',understand:'读一读·句意',retell:'说一说',reflect:'悟一悟',finish:'学习小结'})[s.stage] + '\n课程数据：' + JSON.stringify({ text: lesson.text, notes: lesson.notes, expressionType: lesson.expressionType, story: lesson.story, characterPrompt: lesson.characterPrompt, reflectionPrompt: lesson.reflectionPrompt }) }, ...s.messages.slice(-10), { role: 'user', content: text }]); engine = 'model'; } catch { fallback = true; }
            }
            answer ??= localChat(lesson, s, text);
            s.messages.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
            if (/不知道|不会|不懂|好难|提示/.test(text)) record(s, '表达求助', text, '用一句一问的方式检查具体卡点，避免推断能力。');
            save(); return reply(200, { reply: answer, engine, fallback });
          }
          if (action === 'retell') {
            if (s.stage !== 'retell') throw fail(400, '请先完成读懂阶段。');
            const text = input(data.text), character = input(data.character, 600); let feedback, fallback = false;
            if (online) { try { feedback = await modelRetell(config, lesson, text); } catch { fallback = true; } }
            feedback ??= localRetell(lesson, text);
            s.retellings.push({ text, character, feedback, at: new Date().toISOString() });
            record(s, lesson.characterLabel, character, lesson.characterPrompt);
            record(s, feedback.copied ? '原文转述' : ({story:'故事复述',ideas:'文意讲述',poetry:'诗意表达',scenery:'景物讲述'}[lesson.expressionType] ?? '文意讲述'), text, feedback.copied ? '引导将原文换成日常表达，先完成第一部分。' : feedback.rubric.filter(r => r.status !== '已提及').map(r => r.suggestion).join(' '), { rubric: feedback.rubric, engine: feedback.engine });
            save(); return reply(200, { ...feedback, fallback, attempt: s.retellings.length });
          }
          throw fail(404, '未找到此操作。');
        }
        if (req.method === 'POST' && path === '/api/teacher/login') {
          limit(req.socket.remoteAddress + ':login', 5);
          const data = await body(req); if (!same(data.pin, teacherPin)) throw fail(401, '教师口令不正确。');
          const token = idToken(); auth.set(token, Date.now() + 8 * 3600000); return reply(200, { token });
        }
        if (path.startsWith('/api/teacher/')) {
          teacher(req);
          if (req.method === 'POST' && path === '/api/teacher/logout') { auth.delete(req.headers.authorization.replace(/^Bearer /, '')); return reply(200, { ok: true }); }
          if (req.method === 'GET' && path === '/api/teacher/records') return reply(200, { records: store.records, sessions: store.sessions.map(safeSession) });
          if (req.method === 'POST' && path === '/api/teacher/seed') {
            if (store.sessions.some(s => s.synthetic)) return reply(200, { ok: true });
            for (const [i, category, evidence] of [[1, '词句理解', '问题：“去”是什么意思？学生选择：前往别处。'], [2, '故事复述', '小朋友在院子里玩，有人掉进瓮里。司马光拿石头打破了瓮。'], [3, '表达求助', '我不懂“竞走”是什么意思。']]) {
              const s = { id: randomUUID(), student: `演示学生-${i}`, lessonId: i === 3 ? 'wang' : 'sima', stage: i === 2 ? 'retell' : 'understand', notesViewed: [], answers: [], retellings: [], messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), synthetic: true };
              store.sessions.push(s); record(s, category, evidence, i === 2 ? '追问：水怎样了？落水的孩子结果怎样？' : '回看注释，试着把词义放进原句。');
            }
            save(); return reply(200, { ok: true });
          }
          const rm = path.match(/^\/api\/teacher\/records\/([^/]+)$/);
          if (req.method === 'PATCH' && rm) {
            const r = store.records.find(r => r.id === rm[1]); if (!r) throw fail(404, '记录不存在。');
            const data = await body(req); if (!['待复核', '跟进中', '已解决', '无需跟进'].includes(data.status) || typeof data.teacherNote !== 'string' || data.teacherNote.length > 800) throw fail(400, '复核信息无效。');
            r.status = data.status; r.teacherNote = redact(data.teacherNote); r.reviewedAt = new Date().toISOString(); save(); return reply(200, r);
          }
          const sm = path.match(/^\/api\/teacher\/sessions\/([^/]+)$/);
          if (req.method === 'DELETE' && sm) {
            if (busy.has(sm[1])) throw fail(409, '此学习会话正在处理，请稍后删除。');
            store.sessions = store.sessions.filter(s => s.id !== sm[1]); store.records = store.records.filter(r => r.sessionId !== sm[1]); save(); return reply(200, { ok: true });
          }
          if (req.method === 'GET' && path === '/api/teacher/export') {
            const rows = [['学习编号', '课文', '学习阶段', '记录类型', '原始证据', '跟进建议', '复核状态', '教师备注', '记录时间', '数据类型'], ...store.records.map(r => [r.student, (() => {const l=lessons.find(l=>l.id===r.lessonId);return (l.collection==='extra'?'课外'+String(l.number).padStart(3,'0')+' · ':'')+l.title;})(), ({ read: '读一读', understand: '读一读·句意', retell: '说一说', reflect: '悟一悟', finish: '学习小结' })[r.stage], r.category, r.evidence, r.suggestion, r.status, r.teacherNote, r.createdAt, r.synthetic ? '合成演示数据' : '学习过程数据'])];
            res.setHeader('Content-Disposition', 'attachment; filename="learning-records.csv"'); return reply(200, '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv; charset=utf-8');
          }
        }
        throw fail(404, '接口不存在。');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, '不支持该请求。');
      const allowed = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/transport.js': 'transport.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
      if (!allowed[path]) throw fail(404, '页面不存在。');
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
      reply(200, readFileSync(join(root, 'public', allowed[path])), types[extname(allowed[path])]);
    } catch (error) { if (!res.headersSent) reply(error.status ?? 500, { error: error.status ? error.message : '服务暂时遇到问题，请稍后重试。' }); }
    finally { if (lock) busy.delete(lock); }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3210), host = process.env.HOST ?? '127.0.0.1';
  createApp().listen(port, host, () => console.log(`小古文已启动：http://${host}:${port}\n本地教师演示口令：使用 .env 中 TEACHER_PIN，未设置时为 246810。`));
}
