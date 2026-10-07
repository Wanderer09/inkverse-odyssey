import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, csvCell } from '../server.mjs';
import { curriculumLessons as lessons, extraLessons } from '../content/lessons.mjs';
import { localRetell, redact } from '../agent/core.mjs';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wenyan-test-'));
  const server = createApp({ dataDir: dir, teacherPin: 'test-pin', modelConfig: {}, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  }
  return { request, dir, server };
}
async function learner(request, lessonId = 'sima') {
  const response = await request('/api/sessions', 'POST', { lessonId }); assert.equal(response.status, 201);
  const { id, token } = response.data, headers = { 'X-Session-Token': token };
  await request(`/api/sessions/${id}/reading`, 'POST', { pronunciation: true, fluency: true }, headers);
  return { id, token, call: (action, body) => request(`/api/sessions/${id}/${action}`, 'POST', action === 'retell' ? { character: '人物善于思考，因为能联系事情来行动。', ...body } : body, headers), read: () => request(`/api/sessions/${id}`, 'GET', undefined, headers) };
}
async function teacher(request) { const { data } = await request('/api/teacher/login', 'POST', { pin: 'test-pin' }); return { Authorization: 'Bearer ' + data.token }; }

test('完整学习闭环：注释不记困难，错答与求助留证据，复述可复核、可导出、可删除', async t => {
  const { request } = await fixture(t), s = await learner(request);
  await s.call('note', { word: '去' });
  const auth = await teacher(request);
  let r = await request('/api/teacher/records', 'GET', undefined, auth); assert.equal(r.data.records.length, 0);
  assert.equal((await s.call('stage', { stage: 'retell' })).status, 400);
  assert.equal((await s.call('retell', { text: '提前讲故事' })).status, 400);
  await s.call('stage', { stage: 'understand' });
  assert.equal((await s.call('answer', { questionId: 'q1', option: 0 })).data.correct, false);
  assert.equal((await s.call('answer', { questionId: 'q1', option: 100 })).status, 400);
  await s.call('hint', { questionId: 'q1' });
  await s.call('answer', { questionId: 'q1', option: 1 });
  await s.call('answer', { questionId: 'q2', option: 1 });
  await s.call('chat', { message: '我不懂这里的意思，电话是13812345678' });
  await s.call('stage', { stage: 'retell' });
  const text = '小朋友们在庭院玩，一个孩子掉进瓮里。其他孩子跑开了，司马光拿石头打破瓮，水流出，孩子得救了。';
  const result = await s.call('retell', { text }); assert.equal(result.data.engine, 'local'); assert.equal(result.data.rubric.length, 3);
  assert.ok(result.data.rubric.every(r => r.status !== '已提及'));
  await s.call('stage', { stage: 'reflect' }); await s.call('reflect', { text: '我认为遇到问题要认真思考，因为文中人物采取了不同的行动。' }); await s.call('stage', { stage: 'finish' }); assert.equal((await s.read()).data.stage, 'finish');
  r = await request('/api/teacher/records', 'GET', undefined, auth); assert.equal(r.data.records.length, 6); assert.ok(!JSON.stringify(r.data).includes('13812345678')); assert.equal(r.data.sessions[0].token, undefined);
  const record = r.data.records[0];
  const reviewed = await request(`/api/teacher/records/${record.id}`, 'PATCH', { status: '已解决', teacherNote: '=IMPORT("attack")' }, auth); assert.equal(reviewed.data.status, '已解决');
  const csv = await request('/api/teacher/export', 'GET', undefined, auth); assert.match(csv.data, /学习编号/); assert.match(csv.data, /'\=IMPORT/);
  await request(`/api/teacher/sessions/${s.id}`, 'DELETE', undefined, auth);
  r = await request('/api/teacher/records', 'GET', undefined, auth); assert.equal(r.data.records.length, 0); assert.equal(r.data.sessions.length, 0); assert.equal((await s.read()).status, 404);
});

test('教师鉴权、学生会话隔离、静态文件边界与跨站请求保护', async t => {
  const { request } = await fixture(t), s = await learner(request);
  assert.equal((await request('/api/teacher/records')).status, 401);
  assert.equal((await request('/api/teacher/export')).status, 401);
  assert.equal((await request('/api/teacher/login', 'POST', { pin: 'wrong' })).status, 401);
  assert.equal((await request(`/api/sessions/${s.id}`)).status, 404);
  assert.equal((await request(`/api/sessions/${s.id}`, 'GET', undefined, { 'X-Session-Token': 'wrong-token' })).status, 404);
  assert.equal((await request('/data/learning.json')).status, 404);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/api/sessions', 'POST', { lessonId: 'sima' }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await request('/api/sessions', 'POST', { lessonId: 'invalid' })).status, 400);
  const auth = await teacher(request); await request('/api/teacher/logout', 'POST', {}, auth);
  assert.equal((await request('/api/teacher/records', 'GET', undefined, auth)).status, 401);
});

test('十四篇课程都能完成，演示数据明确标识且不会重复载入', async t => {
  const { request } = await fixture(t);
  for (const lesson of lessons) {
    const s = await learner(request, lesson.id); await s.call('stage', { stage: 'understand' });
    for (const q of lesson.questions) assert.equal((await s.call('answer', { questionId: q.id, option: q.answer })).data.correct, true);
    await s.call('stage', { stage: 'retell' }); assert.equal((await s.call('retell', { text: '我想先讲故事开始，再回到原文补充结果。' })).status, 200);
    assert.equal((await s.call('stage', { stage: 'reflect' })).status, 200); assert.equal((await s.call('reflect', { text: '我认为遇到问题要认真思考，因为文中人物采取了不同的行动。' })).status, 200); assert.equal((await s.call('stage', { stage: 'finish' })).status, 200);
  }
  const auth = await teacher(request);
  await request('/api/teacher/seed', 'POST', {}, auth); await request('/api/teacher/seed', 'POST', {}, auth);
  const r = await request('/api/teacher/records', 'GET', undefined, auth); assert.equal(r.data.sessions.filter(s => s.synthetic).length, 3); assert.equal(r.data.records.filter(r => r.synthetic).length, 3);
});

test('重启后保留学习证据与教师复核，教师登录凭证不跨服务实例', async t => {
  const { request, dir } = await fixture(t), s = await learner(request);
  await s.call('stage', { stage: 'understand' }); await s.call('answer', { questionId: 'q1', option: 0 });
  const auth = await teacher(request), records = await request('/api/teacher/records', 'GET', undefined, auth);
  await request(`/api/teacher/records/${records.data.records[0].id}`, 'PATCH', { status: '跟进中', teacherNote: '先追问词义。' }, auth);
  const restarted = createApp({ dataDir: dir, teacherPin: 'test-pin', modelConfig: {} });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => restarted.close(resolve)));
  const url = `http://127.0.0.1:${restarted.address().port}`;
  const response = await fetch(`${url}/api/sessions/${s.id}`, { headers: { 'X-Session-Token': s.token } }); assert.equal((await response.json()).answers.length, 1);
  assert.equal((await fetch(url + '/api/teacher/records', { headers: auth })).status, 401);
  const login = await fetch(url + '/api/teacher/login', { method: 'POST', body: JSON.stringify({ pin: 'test-pin' }) });
  const token = (await login.json()).token;
  const data = await (await fetch(url + '/api/teacher/records', { headers: { Authorization: 'Bearer ' + token } })).json(); assert.equal(data.records[0].teacherNote, '先追问词义。');
});

test('本地反馈不会把命中关键词的矛盾故事当作语义正确；抄原文有提示', () => {
  const lesson = lessons[0];
  const feedback = localRetell(lesson, '孩子在庭院里掉水。其他孩子跑走，司马光没有拿石头也没打破瓮。水没有流出，孩子没有得救。');
  assert.ok(feedback.rubric.every(r => r.status !== '已提及'));
  assert.equal(localRetell(lesson, lesson.text).copied, true);
  assert.equal(redact('13812345678 x@y.com 110101200001011234'), '[手机号已隐藏] [邮箱已隐藏] [证件号已隐藏]');
  assert.match(csvCell('  =2+2'), /^"'/);
});

test('模型链路传入课程与已脱敏文本、验证原样证据，失败和伪造证据会明确降级', async t => {
  let mode = 'valid', captured;
  const model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    captured = JSON.parse(data);
    if (mode === 'error') { res.writeHead(503); res.end('{}'); return; }
    const student = JSON.parse(captured.messages[1].content).studentRetelling;
    const payload = { reply: '你讲清了开始，接着想一想结果。', rubric: lessons[0].story.map(part => ({ label: part.label, status: '已提及', evidence: mode === 'fake' ? '凭空出现的证据' : student.slice(0, 6), suggestion: part.question })) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => model.close(resolve)));
  const { request } = await fixture(t, { modelConfig: { apiKey: 'fake-test-key', endpoint: `http://127.0.0.1:${model.address().port}`, model: 'mock', consent: true }, allowInsecureModel: true });
  assert.equal((await request('/api/config')).data.mode, 'model');
  const s = await learner(request); await s.call('stage', { stage: 'understand' });
  for (const q of lessons[0].questions) await s.call('answer', { questionId: q.id, option: q.answer });
  await s.call('stage', { stage: 'retell' });
  let response = await s.call('retell', { text: '孩子在院子玩，我不小心写了13812345678。' });
  assert.equal(response.data.engine, 'model'); assert.ok(!JSON.stringify(captured).includes('13812345678')); assert.match(captured.messages[0].content, /古小言/);
  mode = 'fake'; response = await s.call('retell', { text: '孩子在院子里玩。' }); assert.equal(response.data.fallback, true); assert.equal(response.data.engine, 'local');
  mode = 'error'; response = await s.call('chat', { message: '我不懂去的意思' }); assert.equal(response.data.fallback, true); assert.equal(response.data.engine, 'local');
});

test('未授权模型传输时仍为本地模式，浏览器不会收到密钥和参考答案', async t => {
  const { request } = await fixture(t, { modelConfig: { apiKey: 'private-key', endpoint: 'https://invalid.test', model: 'model', consent: false } });
  const config = await request('/api/config'); assert.equal(config.data.mode, 'local'); assert.ok(!JSON.stringify(config.data).includes('private-key'));
  assert.equal(config.data.lessons[0].questions[0].answer, undefined);
});

test('服务端强制三步学习边界，并保存人物特点、朗读自查和感悟依据', async t => {
  const {request}=await fixture(t), {data:s}=await request('/api/sessions','POST',{lessonId:'archery'});
  const headers={'X-Session-Token':s.token},call=(action,body)=>request(`/api/sessions/${s.id}/${action}`,'POST',body,headers);
  assert.equal((await call('stage',{stage:'understand'})).status,400);
  await call('reading',{pronunciation:true,fluency:true});await call('stage',{stage:'understand'});
  for(const q of lessons.find(l=>l.id==='archery').questions)await call('answer',{questionId:q.id,option:q.answer});
  await call('stage',{stage:'retell'});
  assert.equal((await call('retell',{text:'列子学习射箭，知道原因后才算学会。',character:''})).status,400);
  await call('retell',{text:'列子射中了却不知道原因，后来练习三年，终于理解原因。',character:'关尹子严谨，列子愿意继续学习。'});
  await call('stage',{stage:'reflect'});assert.equal((await call('stage',{stage:'finish'})).status,400);
  await call('reflect',{text:'学会一题也要知道原因，文中关尹子问的是所以中。'});
  assert.equal((await call('stage',{stage:'finish'})).status,200);
  const auth=await teacher(request),r=await request('/api/teacher/records','GET',undefined,auth);
  assert.equal(r.data.records.length,3);assert.equal(r.data.sessions[0].reflections[0].feedback.status,'待复核');
  const csv=await request('/api/teacher/export','GET',undefined,auth);assert.match(csv.data,/人物特点/);assert.match(csv.data,/悟一悟/);
});

test('服务端课外叙事、诗歌与论述课程可学，教师能区分课外编号和同名课内选文',async t=>{
  const {request}=await fixture(t);
  const config=(await request('/api/config')).data;
  assert.equal(config.lessons.length,114);assert.equal(config.extraReading.count,100);
  for(const lesson of extraLessons.filter(l=>[1,51,75].includes(l.number))){
    const s=await learner(request,lesson.id);await s.call('stage',{stage:'understand'});
    for(const q of lesson.questions)await s.call('answer',{questionId:q.id,option:q.answer});
    await s.call('stage',{stage:'retell'});
    assert.equal((await s.call('retell',{text:'我想用自己的话说明选文的内容，并回原文核对。',character:'我的发现需要具体原句支持。'})).status,200);
    await s.call('stage',{stage:'reflect'});await s.call('reflect',{text:'我准备比较原文中的前后变化，再说明自己的感悟。'});
    assert.equal((await s.call('stage',{stage:'finish'})).status,200);
  }
  const auth=await teacher(request), result=(await request('/api/teacher/records','GET',undefined,auth)).data;
  assert.equal(result.records.length,9);assert.ok(result.records.some(r=>r.category==='诗意表达'));assert.ok(result.records.some(r=>r.category==='阅读感悟'));
  const csv=(await request('/api/teacher/export','GET',undefined,auth)).data;
  assert.match(csv,/课外001 · 学弈/);assert.match(csv,/课外051 · 题西林壁/);assert.match(csv,/课外075 · 画地为牢/);
});
