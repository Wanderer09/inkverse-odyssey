import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createDemoEngine } from '../demo/runtime.mjs';
import { lessons } from '../content/lessons.mjs';

function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; }
function setup(local = storage(), auth = storage()) {
  let sequence = 0;
  const engine = createDemoEngine({ storage: local, authStorage: auth, id: () => `demo-${++sequence}`, now: () => '2026-10-07T03:00:00Z' });
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await engine.request(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.headers.get('Content-Type').includes('json') ? await response.json() : await response.text() };
  };
  return { request, local, auth };
}
async function learner(request, lessonId = 'sima') {
  const { data } = await request('/api/sessions', 'POST', { lessonId });
  await request(`/api/sessions/${data.id}/reading`, 'POST', { pronunciation: true, fluency: true }, { 'X-Session-Token': data.token });
  return { ...data, call: (action, body) => request(`/api/sessions/${data.id}/${action}`, 'POST', action === 'retell' ? { character: '人物善于思考，因为能联系事情来行动。', ...body } : body, { 'X-Session-Token': data.token }), read: () => request(`/api/sessions/${data.id}`, 'GET', undefined, { 'X-Session-Token': data.token }) };
}
async function teacher(request) { const { data } = await request('/api/teacher/login', 'POST', { pin: '246810' }); return { Authorization: 'Bearer ' + data.token }; }

test('Pages 演示闭环：理解、两次复述、教师复核、导出、刷新持久化和删除', async () => {
  const { request, local, auth } = setup();
  const config = await request('/api/config'); assert.equal(config.data.isDemo, true); assert.equal(config.data.persistence, 'localStorage');
  const s = await learner(request);
  assert.equal((await s.call('stage', { stage: 'retell' })).status, 400);
  await s.call('note', { word: '去' });
  const headers = await teacher(request);
  assert.equal((await request('/api/teacher/records', 'GET', undefined, headers)).data.records.length, 0);
  await s.call('stage', { stage: 'understand' });
  await s.call('answer', { questionId: 'q1', option: 0 }); await s.call('hint', { questionId: 'q1' });
  await s.call('answer', { questionId: 'q1', option: 1 }); await s.call('answer', { questionId: 'q2', option: 1 });
  await s.call('chat', { message: '我不懂去的意思，13812345678' });
  await s.call('stage', { stage: 'retell' });
  let feedback = await s.call('retell', { text: '孩子在院子里玩，有人掉进瓮里，司马光拿石头打破瓮。' });
  assert.equal(feedback.data.rubric[2].status, '可补充');
  feedback = await s.call('retell', { text: '孩子在院子里玩，有人掉进瓮里，其他人跑开。司马光拿石头打破瓮，水流出来，孩子得救了。' });
  assert.equal(feedback.data.attempt, 2); assert.ok(feedback.data.rubric.every(r => r.status !== '已提及'));
  await s.call('stage', { stage: 'reflect' }); await s.call('reflect', { text: '我认为遇到问题要认真思考，因为文中人物采取了不同的行动。' }); await s.call('stage', { stage: 'finish' });
  const refreshed = setup(local, auth), records = await refreshed.request('/api/teacher/records', 'GET', undefined, headers);
  assert.equal(records.data.records.length, 8); assert.equal(records.data.sessions[0].stage, 'finish'); assert.equal(records.data.sessions[0].token, undefined);
  assert.ok(!JSON.stringify(records.data).includes('13812345678'));
  const record = records.data.records[0];
  await refreshed.request(`/api/teacher/records/${record.id}`, 'PATCH', { status: '已解决', teacherNote: '=2+2' }, headers);
  const csv = await refreshed.request('/api/teacher/export', 'GET', undefined, headers); assert.match(csv.data, /浏览器演示学习数据/); assert.match(csv.data, /'=2\+2/); assert.match(csv.data, /读一读/);
  await refreshed.request(`/api/teacher/sessions/${s.id}`, 'DELETE', undefined, headers);
  assert.equal((await refreshed.request('/api/teacher/records', 'GET', undefined, headers)).data.sessions.length, 0);
  assert.equal((await s.read()).status, 404);
});

test('十四篇课文都可完成；合成演示数据独立标识且重复载入不重复生成', async () => {
  const { request } = setup();
  for (const lesson of lessons) {
    const s = await learner(request, lesson.id); await s.call('stage', { stage: 'understand' });
    for (const q of lesson.questions) assert.equal((await s.call('answer', { questionId: q.id, option: q.answer })).data.correct, true);
    await s.call('stage', { stage: 'retell' });
    assert.equal((await s.call('retell', { text: lesson.text })).data.copied, true);
    assert.equal((await s.call('stage', { stage: 'reflect' })).status, 200); assert.equal((await s.call('reflect', { text: '我认为遇到问题要认真思考，因为文中人物采取了不同的行动。' })).status, 200); assert.equal((await s.call('stage', { stage: 'finish' })).status, 200);
  }
  const headers = await teacher(request);
  await request('/api/teacher/seed', 'POST', {}, headers); await request('/api/teacher/seed', 'POST', {}, headers);
  const { data } = await request('/api/teacher/records', 'GET', undefined, headers);
  assert.equal(data.sessions.filter(s => s.synthetic).length, 3); assert.equal(data.records.filter(r => r.synthetic).length, 3);
});

test('本地角色入口、会话令牌与输入边界仍有效；演示口令不宣称真实身份验证', async () => {
  const { request } = setup(), s = await learner(request);
  assert.equal((await request('/api/teacher/records')).status, 401);
  assert.equal((await request('/api/teacher/login', 'POST', { pin: 'wrong' })).status, 401);
  assert.equal((await request(`/api/sessions/${s.id}`)).status, 404);
  assert.equal((await s.call('note', { word: 'invalid' })).status, 400);
  assert.equal((await s.call('chat', { message: 'a'.repeat(601) })).status, 400);
  assert.equal((await s.call('retell', { text: '提前讲述' })).status, 400);
  const headers = await teacher(request);
  await request('/api/teacher/logout', 'POST', {}, headers);
  assert.equal((await request('/api/teacher/export', 'GET', undefined, headers)).status, 401);
});

test('禁用存储时明确提示临时模式，空间耗尽不假报保存，损坏数据不静默覆盖', async () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const transient = setup(denied), config = await transient.request('/api/config'); assert.equal(config.data.persistence, 'memory');
  assert.equal((await transient.request('/api/sessions', 'POST', { lessonId: 'sima' })).status, 201);
  const local = storage(), normal = setup(local); local.setItem('inkverse-odyssey.v1.learning', 'invalid-json');
  assert.equal((await normal.request('/api/sessions', 'POST', { lessonId: 'sima' })).status, 500); assert.equal(local.getItem('inkverse-odyssey.v1.learning'), 'invalid-json');
  const space = storage(), quota = setup(space); space.setItem = () => { throw new Error('quota'); };
  assert.equal((await quota.request('/api/sessions', 'POST', { lessonId: 'sima' })).status, 507);
});

test('静态构建适配 Pages 子路径，产物无服务器代码、密钥、原始讲义和模型请求', () => {
  execFileSync(process.execPath, ['scripts/build-demo.mjs']);
  assert.deepEqual(readdirSync('dist').sort(), ['.nojekyll', 'app.js', 'browser-demo.js', 'demo-content.js', 'favicon.svg', 'index.html', 'learning-core.js', 'styles.css', 'transport.js'].sort());
  const html = readFileSync('dist/index.html', 'utf8'); assert.match(html, /data-runtime="browser-demo"/); assert.ok(!/\b(?:src|href)="\//.test(html));
  const version = html.match(/app\.js\?v=([a-f0-9]{12})/)[1];
  assert.ok(html.includes(`styles.css?v=${version}`));
  assert.ok(readFileSync('dist/app.js', 'utf8').includes(`transport.js?v=${version}`));
  assert.ok(readFileSync('dist/transport.js', 'utf8').includes(`browser-demo.js?v=${version}`));
  const runtime = readFileSync('dist/browser-demo.js', 'utf8'); assert.ok(!runtime.includes('../content/')); assert.ok(!runtime.includes('fetch('));
  assert.ok(runtime.includes(`demo-content.js?v=${version}`)); assert.ok(runtime.includes(`learning-core.js?v=${version}`));
  const core = readFileSync('dist/learning-core.js', 'utf8'); assert.ok(!core.includes('callModel')); assert.ok(!core.includes('MODEL_API_KEY')); assert.ok(!core.includes('fetch('));
  assert.match(readFileSync('dist/app.js', 'utf8'), /INKVERSE ODYSSEY/);
});

test('三步学习边界：朗读自查、人物依据与感悟都必须实际提交', async () => {
  const { request } = setup();
  const { data:s }=await request('/api/sessions','POST',{lessonId:'sima'});
  const headers={'X-Session-Token':s.token};
  const call=(action,body)=>request(`/api/sessions/${s.id}/${action}`,'POST',body,headers);
  assert.equal((await call('stage',{stage:'understand'})).status,400);
  assert.equal((await call('reading',{pronunciation:true,fluency:false})).status,400);
  assert.equal((await call('reflect',{text:'提前感悟'})).status,400);
  await call('reading',{pronunciation:true,fluency:true}); await call('stage',{stage:'understand'});
  for(const q of lessons[0].questions) await call('answer',{questionId:q.id,option:q.answer});
  await call('stage',{stage:'retell'});
  assert.equal((await call('retell',{text:'孩子在院子玩，司马光救了人。'})).status,400);
  await call('retell',{text:'孩子在院子玩，司马光打破瓮救了人。',character:'司马光冷静，因为他没有跑开。'});
  assert.equal((await call('stage',{stage:'finish'})).status,400);
  await call('stage',{stage:'reflect'});
  assert.equal((await call('stage',{stage:'finish'})).status,400);
  const f=await call('reflect',{text:'我认为要思考办法，依据是司马光选择打破瓮。13812345678'});
  assert.equal(f.data.status,'待复核');assert.ok(!f.data.evidence.includes('13812345678'));
  assert.equal((await call('stage',{stage:'finish'})).status,200);
  const teacherHeaders=await teacher(request), r=await request('/api/teacher/records','GET',undefined,teacherHeaders);
  assert.ok(r.data.records.some(r=>r.category==='人物特点'&&r.evidence.includes('冷静')));
  assert.ok(r.data.records.some(r=>r.category==='道理感悟'&&r.status==='待复核'));
  assert.equal(r.data.sessions[0].readingCheck.type,'学生自查');
  const csv=await request('/api/teacher/export','GET',undefined,teacherHeaders);assert.match(csv.data,/悟一悟/);assert.match(csv.data,/道理感悟/);
});

test('课程目录完整且表达支架适配文体，所有原句与字音可回查', async () => {
  const expected={三上:['司马光'],三下:['守株待兔'],四上:['精卫填海','王戎不取道旁李'],四下:['囊萤夜读','铁杵成针'],五上:['古人谈读书','少年中国说（节选）'],五下:['杨氏之子','自相矛盾'],六上:['两小儿辩日','曹冲称象'],六下:['学弈','关尹子教射']};
  assert.equal(lessons.length,14);assert.equal(new Set(lessons.map(l=>l.id)).size,14);
  for(const [semester,titles]of Object.entries(expected))assert.deepEqual(lessons.filter(l=>l.semester===semester).map(l=>l.title),titles);
  for(const l of lessons){assert.equal(l.questions.length,2);assert.equal(l.story.length,3);assert.ok(l.characterPrompt&&l.reflectionPrompt);assert.equal(l.segmented.join("").replace(/[\s/]/g,""),l.text.replace(/\s/g,""),l.title+"停顿文本保持原文");for(const n of l.notes){assert.ok(l.text.includes(n[3]),l.title+': '+n[3]);assert.ok(n[1]);}assert.ok(l.questions.every(q=>q.options[q.answer]));}
  for(const id of ['reading','young']){const l=lessons.find(l=>l.id===id);assert.equal(l.expressionType,'ideas');assert.ok(l.story.every(s=>!s.label.includes('故事')));}
  const {request}=setup();const config=await request('/api/config');assert.match(config.data.extraReading.url,/w9qKPnqRsDTKzt28itSbBw/);
});
