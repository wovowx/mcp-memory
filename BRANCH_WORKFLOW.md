# GitHub分支工作流约定（2026-08-13柳柳确认）

## 工作流
1. 所有代码改动先在 dev 分支进行
2. 改好并确认无误后，合并到 main
3. 合并到 main 后触发 Cloudflare 自动部署

## 原因
- 之前直接在main改，每次提交都触发部署
- 改用分支后：dev随便改不触发部署，只有合到main才部署

## 注意
- 改文件时branch参数用 dev
- 合并用 github:merge_pull_request 或先创建PR再合并
- GitHub API没有移动文件接口，移动=新路径PUT+旧路径DELETE