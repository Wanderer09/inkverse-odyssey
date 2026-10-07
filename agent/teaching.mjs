export function redact(text) {
  return text.replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱已隐藏]')
    .replace(/\b\d{17}[\dXx]\b/g, '[证件号已隐藏]');
}

export function localChat(lesson, session, text) {
  const ideas = lesson.expressionType === 'ideas';
  if (/提示词|忽略.*指令|system prompt|管理员|密钥|api.?key/i.test(text)) return '我们一起回到这篇小古文吧。选一个还不明白的词，看看它的注释，再试着说说你的理解。';
  if (/手机号|学校|姓名|住址|\[.*已隐藏\]/.test(text)) return '学习时用系统分配的学习编号就好，不需要告诉我真实姓名或联系方式。我们回到原文：你想先读懂哪一句？';
  if (/救人|落水|砸缸|砸瓮|下水/.test(text) && /怎么|如何|能不能|可以|教我/.test(text)) return '故事可以帮助我们思考，但现实中遇到落水危险要立即呼救、找成年人，不模仿故事中的动作。我们看看原文：司马光的行动和其他孩子有什么不同？';
  if (/译文|翻译|答案|帮我写|替我写/.test(text)) return `我们先自己试一句。读“${lesson.segmented[0].replaceAll(' / ', '')}”，看看相关注释，你能用现在的话说说这句吗？`;
  const note = lesson.notes.find(([word]) => text.includes(word));
  if (note) return `你注意到了“${note[0]}”这个词。注释里说：${note[2]} 原文是“${note[3]}”。${note[4]}试着用自己的话说一说。`;
  if (/不知道|不会|不懂|好难|提示/.test(text)) {
    const count = session.messages.filter(m => m.role === 'user' && /不知道|不会|不懂|好难|提示/.test(m.content)).length;
    return count > 1 ? `我们把${ideas ? '文意' : '故事'}分小一点。${ideas ? '先说说作者的一个观点。' : '先用“有一天……”开头。'}${lesson.story[0].question}只说这一部分也可以。` : `没关系，先看第一句“${lesson.segmented[0].replaceAll(' / ', '')}”。找一个你认识的词，再点开另一个词的注释。${ideas ? '这一句表达了什么想法？' : '第一句里写了谁？'}`;
  }
  if (session.stage === 'reflect') return `你可以有自己的理解。先选一处原文，再说出它让你想到的道理。${lesson.reflectionPrompt}`;
  if (/人物|特点|品质|精神/.test(text)) return `${lesson.characterPrompt}先说一个特点，再找一句原文或一个行动作依据。`;
  if (session.stage === 'retell') return `你已经开始用自己的话表达了。再检查这篇文章的三个表达部分。${lesson.story[1].question}可以把这一部分补到你的表达里。`;
  if (session.stage === 'understand') return `先把你想说的那句原文找出来，再看看词语注释。古文中的“${lesson.notes[0][0]}”表示“${lesson.notes[0][2]}”。${ideas ? '这句话表达了什么主张或期望？' : '这句话里谁做了什么？'}`;
  return `我们从原文找线索。读读“${lesson.segmented[0].replaceAll(' / ', '')}”，不认识的词可以点开注释。${ideas ? '你发现作者先说了什么观点？' : '你发现故事先写了谁？'}`;
}

export function localRetell(lesson, text) {
  const copied = text.replace(/[\s，。、“”：]/g, '') === lesson.text.replace(/[\s，。、“”：]/g, '');
  const rubric = lesson.story.map(part => {
    const found = part.terms.every(pattern => new RegExp(pattern).test(text));
    return { label: part.label, status: found ? '待复核' : '可补充', evidence: found ? text.slice(0, 160) : '', suggestion: part.question };
  });
  return { reply: copied ? '你认真读了原文。接下来试着换成平时说话的方式，先说清第一部分，再补充文意和依据。' : `谢谢你${lesson.expressionType === 'ideas' ? '说出自己的理解' : '把故事讲出来'}。下面的三个小问题可以帮你检查表达中的遗漏。你可以改一改再讲一次，你的表达会保留给教师复核。`, rubric, copied, engine: 'local', note: '本地模式只检查表达线索，无法判断语义是否正确；全部交由教师复核。' };
}

export function localReflect(lesson, text) {
  return { reply: '谢谢你说出自己的理解。请回到原文，检查你的道理是否有具体的句子或事件支持。', question: lesson.reflectionPrompt, evidence: text, status: '待复核', engine: 'local', note: '这里保留你的感悟，不自动判对错。教师会结合原文与表达复核。' };
}
