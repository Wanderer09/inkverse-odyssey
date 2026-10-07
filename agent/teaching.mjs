export function redact(text) {
  return text.replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱已隐藏]')
    .replace(/\b\d{17}[\dXx]\b/g, '[证件号已隐藏]');
}

export function localChat(lesson, session, text) {
  if (/提示词|忽略.*指令|system prompt|管理员|密钥|api.?key/i.test(text)) return '我们一起回到这篇小古文吧。选一个还不明白的词，看看它的注释，再试着说说你的理解。';
  if (/手机号|学校|姓名|住址|\[.*已隐藏\]/.test(text)) return '学习时用系统分配的学习编号就好，不需要告诉我真实姓名或联系方式。我们回到原文：你想先读懂哪一句？';
  if (/救人|落水|砸缸|砸瓮|下水/.test(text) && /怎么|如何|能不能|可以|教我/.test(text)) return '故事可以帮助我们思考，但现实中遇到落水危险要立即呼救、找成年人，不模仿故事中的动作。我们看看原文：司马光的行动和其他孩子有什么不同？';
  if (/译文|翻译|答案|帮我写|替我写/.test(text)) return `我们先自己试一句。读“${lesson.segmented[0].replaceAll(' / ', '')}”，看看相关注释，你能用现在的话说说这句吗？`;
  const note = lesson.notes.find(([word]) => text.includes(word));
  if (note) return `你注意到了“${note[0]}”这个词。注释里说：${note[2]} 原文是“${note[3]}”。${note[4]}试着用自己的话说一说。`;
  if (/不知道|不会|不懂|好难|提示/.test(text)) {
    const count = session.messages.filter(m => m.role === 'user' && /不知道|不会|不懂|好难|提示/.test(m.content)).length;
    return count > 1 ? `我们把故事分小一点。先用“有一天……”开头，说说${lesson.story[0].question}只说这一段也可以。` : `没关系，先看第一句“${lesson.segmented[0].replaceAll(' / ', '')}”。找一个你认识的词，再点开另一个词的注释。第一句里写了谁？`;
  }
  if (session.stage === 'retell') return `你已经开始用自己的话表达了。再检查“开始 → 经过 → 结果”三个部分。${lesson.story[1].question}可以把这一段补到故事里。`;
  if (session.stage === 'understand') return `先把你想说的那句原文找出来，再看看词语注释。古文中的“${lesson.notes[0][0]}”表示“${lesson.notes[0][2]}”。这句话里谁做了什么？`;
  return `我们从原文找线索。读读“${lesson.segmented[0].replaceAll(' / ', '')}”，不认识的词可以点开注释。你发现故事先写了谁？`;
}

export function localRetell(lesson, text) {
  const copied = text.replace(/[\s，。、“”：]/g, '') === lesson.text.replace(/[\s，。、“”：]/g, '');
  const rubric = lesson.story.map(part => {
    const found = part.terms.every(pattern => new RegExp(pattern).test(text));
    return { label: part.label, status: found ? '待复核' : '可补充', evidence: found ? text.slice(0, 160) : '', suggestion: part.question };
  });
  return { reply: copied ? '你认真读了原文。接下来试着换成平时说话的方式，先讲清故事的开始，再补经过和结果。' : '谢谢你把故事讲出来。下面的三个小问题可以帮你检查遗漏。你可以改一改再讲一次，老师也会看你的表达。', rubric, copied, engine: 'local', note: '本地模式只检查表达线索，无法判断语义是否正确；全部交由教师复核。' };
}
