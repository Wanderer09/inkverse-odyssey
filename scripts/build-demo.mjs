import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });
let html = readFileSync(resolve(root, 'public/index.html'), 'utf8')
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-runtime="browser-demo">')
  .replace('<title>小古文 · 文言文启蒙学伴</title>', '<title>InkVerse Odyssey · 小古文启蒙学伴</title>')
  .replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./')
  .replace('本地作品演示默认口令：246810。实际使用前请在服务端修改。', '演示口令：246810。此入口用于体验教师流程，记录只来自当前浏览器。')
  .replace('查看学习证据，记录下一步教学。请使用教师口令。', '查看此浏览器中的学习记录。演示入口不代表真实学校账号权限。');
writeFileSync(resolve(dist, 'index.html'), html);
for (const name of ['app.js', 'transport.js', 'styles.css', 'favicon.svg']) {
  let text = readFileSync(resolve(root, 'public', name), 'utf8');
  if (name === 'app.js') text = text
    .replace('A LITTLE CLASSIC, A BIG WORLD', 'INKVERSE ODYSSEY')
    .replace('教师入口供本地作品演示。真实部署需学校账号、权限与数据管理制度。', 'GitHub Pages 本地演示：教师端仅能查看当前浏览器的记录。演示口令不提供真实账号隔离，适合使用虚构学习内容体验。')
    .replace('原文来自所附教学资料 · 提示与自动反馈供学习参考', 'InkVerse Odyssey · GitHub Pages 演示版 · 课程支架提示')
    .replace('表达会保留给教师复核。', '表达存于此浏览器，可在教师演示端复核。')
    .replace('你的尝试和求助，老师都能看到。', '你的尝试和求助，保存在本浏览器的教师演示端。')
    .replace('参与学习', '本浏览器学习会话');
  writeFileSync(resolve(dist, name), text);
}
writeFileSync(resolve(dist, 'demo-content.js'), readFileSync(resolve(root, 'content/lessons.mjs'), 'utf8'));
writeFileSync(resolve(dist, 'learning-core.js'), readFileSync(resolve(root, 'agent/teaching.mjs'), 'utf8'));
writeFileSync(resolve(dist, 'browser-demo.js'), readFileSync(resolve(root, 'demo/runtime.mjs'), 'utf8')
  .replace('../content/lessons.mjs', './demo-content.js').replace('../agent/teaching.mjs', './learning-core.js'));
writeFileSync(resolve(dist, '.nojekyll'), '');
console.log('InkVerse Odyssey Pages demo built in dist/ (no server or model keys).');
