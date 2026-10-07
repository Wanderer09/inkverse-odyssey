export const isDemo = document.documentElement.dataset.runtime === 'browser-demo';
let demo;
async function demoEngine() {
  demo ??= import('./browser-demo.js').then(({ createDemoEngine }) => createDemoEngine({ namespace: 'inkverse-odyssey.v1:' + new URL('.', import.meta.url).pathname }));
  return demo;
}
export async function request(path, options = {}) {
  if (isDemo) return (await demoEngine()).request(path, options);
  return fetch(path, options);
}
