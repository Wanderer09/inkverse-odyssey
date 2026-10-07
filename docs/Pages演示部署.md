# GitHub Pages 演示部署

项目：InkVerse Odyssey（墨语奇旅）。仓库：`Wanderer09/inkverse-odyssey`。

演示地址：https://wanderer09.github.io/inkverse-odyssey/

## 自动发布

在仓库 Settings → Pages 中，将 Source 设为 **GitHub Actions**。推送到 `main`，或在 Actions 页面手动运行 `Deploy InkVerse Odyssey to GitHub Pages`。

工作流使用 Node.js 24，依次运行 `npm test`、`npm run build:demo`，上传 `dist/` 后部署。无需配置模型密钥或任何仓库 Secret。更换仓库名时，相对资产路径仍可工作；修改 README 的体验地址，并按新子目录访问。

依据 [GitHub 官方自定义工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)，部署任务具有 `pages: write`、`id-token: write` 权限，使用 `github-pages` 环境。静态输出不包含服务器、原始讲义、比赛通知、私有配置、学习数据或大模型调用代码。

## 本地复现

```sh
npm test
npm run build:demo
npm run preview:demo
```

访问 `http://127.0.0.1:3211/inkverse-odyssey/`，按 Ctrl+C 停止。不要直接双击 `dist/index.html`：浏览器模块需要通过 HTTP 服务加载。

## 学习状态与数据

浏览器演示与本地服务器使用同一套界面和课程规则；演示构建通过浏览器内的状态引擎处理学习操作。记录使用按项目路径隔离的 localStorage，教师演示登录使用 sessionStorage。

数据不会通过应用接口上传，教师只能在当前浏览器查看。不同设备、浏览器或无痕窗口之间不共享学习记录。固定口令 `246810` 仅展示教师操作流程，不能用于正式账号管理。

存储不可用时明确显示临时模式；保存失败时报告错误。合成演示数据带独立标签并排除统计。CSV 导出带中文字段和公式输入防护；教师可删除一个学习编号的全部数据。

在线版采用固定课程支架，不调用模型。开放复述的语义正确性必须由教师复核。如需模型对话、跨设备汇集、真实教师账号，应部署服务端并补充账号与数据管理，参见 [本地运行说明](本地运行.md)。
