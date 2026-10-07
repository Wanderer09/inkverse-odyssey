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
  return { ...data, call: (action, body) => request(`/api/sessions/${data.id}/${action}`, 'POST', body, { 'X-Session-Token': data.token }), read: () => request(`/api/sessions/${data.id}`, 'GET', undefined, { 'X-Session-Token': data.token }) };
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
  await s.call('stage', { stage: 'finish' });
  const refreshed = setup(local, auth), records = await refreshed.request('/api/teacher/records', 'GET', undefined, headers);
  assert.equal(records.data.records.length, 5); assert.equal(records.data.sessions[0].stage, 'finish'); assert.equal(records.data.sessions[0].token, undefined);
  assert.ok(!JSON.stringify(records.data).includes('13812345678'));
  const record = records.data.records[0];
  await refreshed.request(`/api/teacher/records/${record.id}`, 'PATCH', { status: '已解决', teacherNote: '=2+2' }, headers);
  const csv = await refreshed.request('/api/teacher/export', 'GET', undefined, headers); assert.match(csv.data, /浏览器演示学习数据/); assert.match(csv.data, /'=2\+2/); assert.match(csv.data, /说句意/);
  await refreshed.request(`/api/teacher/sessions/${s.id}`, 'DELETE', undefined, headers);
  assert.equal((await refreshed.request('/api/teacher/records', 'GET', undefined, headers)).data.sessions.length, 0);
  assert.equal((await s.read()).status, 404);
});

test('四篇课文都可完成；合成演示数据独立标识且重复载入不重复生成', async () => {
  const { request } = setup();
  for (const lesson of lessons) {
    const s = await learner(request, lesson.id); await s.call('stage', { stage: 'understand' });
    for (const q of lesson.questions) assert.equal((await s.call('answer', { questionId: q.id, option: q.answer })).data.correct, true);
    await s.call('stage', { stage: 'retell' });
    assert.equal((await s.call('retell', { text: lesson.text })).data.copied, true);
    assert.equal((await s.call('stage', { stage: 'finish' })).status, 200);
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
  const runtime = readFileSync('dist/browser-demo.js', 'utf8'); assert.ok(!runtime.includes('../content/')); assert.ok(!runtime.includes('fetch('));
  const core = readFileSync('dist/learning-core.js', 'utf8'); assert.ok(!core.includes('callModel')); assert.ok(!core.includes('MODEL_API_KEY')); assert.ok(!core.includes('fetch('));
  assert.match(readFileSync('dist/app.js', 'utf8'), /INKVERSE ODYSSEY/);
});
