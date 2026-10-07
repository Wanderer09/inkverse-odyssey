import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lessons, curriculumLessons, extraLessons, publicLesson, extraReading } from '../content/lessons.mjs';
import { createDemoEngine } from '../demo/runtime.mjs';
import { localChat, localRetell } from '../agent/teaching.mjs';

function storage() { const values=new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}; }
function engine() {
  let id=0;
  const instance=createDemoEngine({storage:storage(),authStorage:storage(),id:()=>`extra-test-${++id}`});
  return async (path,method='GET',body,headers={})=>{
    const response=await instance.request(path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:response.headers.get('Content-Type').includes('json')?await response.json():await response.text()};
  };
}

test('附件100个编号、五组主题、诗歌文体和重复关系全部保留', async()=>{
  assert.equal(curriculumLessons.length,14); assert.equal(extraLessons.length,100); assert.equal(lessons.length,114);
  assert.equal(new Set(lessons.map(l=>l.id)).size,114);
  assert.deepEqual(extraLessons.map(l=>l.number),Array.from({length:100},(_,i)=>i+1));
  assert.equal(extraLessons.filter(l=>l.expressionType==='poetry').length,21);
  for(const group of extraReading.groups) assert.equal(extraLessons.filter(l=>l.group===group).length,20);
  for(const [a,b] of [[3,74],[25,80],[35,64]]) {
    const one=extraLessons[a-1],two=extraLessons[b-1];
    assert.equal(one.text,two.text);assert.equal(one.sameSelectionNumber,b);assert.equal(two.sameSelectionNumber,a);assert.notEqual(one.id,two.id);
  }
  for(const lesson of extraLessons){
    assert.equal(lesson.questions.length,2);assert.equal(lesson.story.length,3);assert.ok(lesson.notes.length>=3);
    assert.equal(lesson.segmented.join('').replace(/[\s/]/g,''),lesson.text.replace(/\s/g,''),lesson.title+'停顿保持原文');
    for(const [word,pinyin,meaning,original] of lesson.notes){assert.ok(pinyin&&meaning);assert.ok(original.includes(word));assert.ok(lesson.text.includes(original));}
    for(const q of lesson.questions){assert.equal(new Set(q.options).size,3);assert.ok(q.options[q.answer]);}
    if(lesson.expressionType!=='story')assert.ok(lesson.story.every(part=>!part.label.includes('故事')));
    const publicData=publicLesson(lesson);assert.ok(publicData.questions.every(q=>!('answer'in q)&&!('explanation'in q)));
    assert.ok(!publicData.story.some(part=>'terms'in part));
  }
  const config=(await engine()('/api/config')).data;
  assert.equal(config.lessons.length,114);assert.equal(config.extraReading.status,'已导入');
});

test('98条原文符合附件提取指纹，两条有可回查的校订，诗词不含串入译文',()=>{
  const source=JSON.parse(readFileSync(new URL('./fixtures/extra-source-digests.json',import.meta.url),'utf8'));
  assert.equal(source.length,100);
  for(const entry of source){
    const lesson=extraLessons[entry.number-1];assert.equal(lesson.title,entry.title);
    if([71,75].includes(entry.number)){assert.ok(lesson.editorialNote&&lesson.sourceUrl);continue;}
    assert.equal(createHash('sha256').update(lesson.text).digest('hex'),entry.sha256,'附件第'+entry.number+'条原文一致');
  }
  assert.equal(extraLessons[52].text,'朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。');
  assert.ok(!extraLessons[70].text.includes('爷娘闻女来'));assert.ok(!extraLessons[70].text.includes('自刭'));
  assert.ok(extraLessons[74].text.startsWith('故士有画地为牢'));
  for(const lesson of extraLessons)assert.ok(!/[⺠-⿿]|【译文】|一句话道理|公众号|电子版领取/.test(lesson.text),lesson.title);
});

test('100条均可完成三步自学，教师证据与CSV保留原编号并适配文体',async()=>{
  for(const lesson of extraLessons){
    const request=engine();
    const created=await request('/api/sessions','POST',{lessonId:lesson.id});assert.equal(created.status,201);
    const {id,token}=created.data,headers={'X-Session-Token':token};
    const call=(action,body)=>request(`/api/sessions/${id}/${action}`,'POST',body,headers);
    assert.equal((await call('reading',{pronunciation:true,fluency:true})).status,200);
    await call('stage',{stage:'understand'});
    for(const q of lesson.questions)assert.equal((await call('answer',{questionId:q.id,option:q.answer})).data.correct,true);
    await call('stage',{stage:'retell'});
    const expression='这是我的第'+lesson.number+'条文意理解，具体句子需要继续回原文核对。';
    assert.equal((await call('retell',{text:expression,character:'我从原文中的具体描写体会特点和情感。'})).status,200);
    await call('stage',{stage:'reflect'});await call('reflect',{text:'我有自己的感受，准备选出一处原文进一步说明。'});
    assert.equal((await call('stage',{stage:'finish'})).status,200);
    const auth=(await request('/api/teacher/login','POST',{pin:'246810'})).data;
    const teacherHeaders={Authorization:'Bearer '+auth.token};
    const records=(await request('/api/teacher/records','GET',undefined,teacherHeaders)).data.records;
    assert.equal(records.length,3);assert.ok(records.every(r=>r.lessonId===lesson.id&&r.status==='待复核'));
    assert.ok(records.some(r=>r.category===lesson.characterLabel));
    assert.ok(records.some(r=>r.category===lesson.reflectionCategory));
    const csv=(await request('/api/teacher/export','GET',undefined,teacherHeaders)).data;
    assert.ok(csv.includes('课外'+String(lesson.number).padStart(3,'0')+' · '+lesson.title));
    if(lesson.expressionType==='poetry'){
      const help=localChat(lesson,{messages:[{role:'user',content:'不知道'},{role:'user',content:'不知道'}],stage:'retell'},'我不知道');
      assert.ok(!help.includes('有一天'));assert.ok(!localRetell(lesson,expression).reply.includes('故事讲出来'));
      assert.ok(records.some(r=>r.category==='诗意表达'));
    }
  }
});
