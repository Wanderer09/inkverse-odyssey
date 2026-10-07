$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $taskNode) {
    Write-Host '请先安装 Node.js 22.9 或更高版本，然后重新运行。'
    exit 1
}
Write-Host '小古文书房即将启动。浏览器访问 http://127.0.0.1:3210'
Write-Host '按 Ctrl+C 停止。教师演示口令默认为 246810，可通过 .env 修改。'
& $taskNode.Source --env-file-if-exists=.env server.mjs
