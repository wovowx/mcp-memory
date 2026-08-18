---
name: cloudflare-deploy
description: Cloudflare Worker 多文件部署完整步骤与常见坑点
---

# Cloudflare Worker 部署技能

## 目标
解决 GitHub 自动部署到 Cloudflare 时默认只有单个 index.js 的问题，实现多文件部署。

## 适用场景
- 将多个 JS 文件部署到 Cloudflare Worker
- 解决 esbuild 打包导致文件丢失的问题
- 配置 Worker 环境变量和绑定

## 工作流程（SOP）
1. 代码结构：确保代码放在 `src/` 目录（入口 src/index.js，模块 src/utils/*.js、src/tools/*.js）
2. 构建命令：Cloudflare 控制台配置为 `npx wrangler deploy --no-bundle`
3. wrangler.toml 配置：在顶层添加 `find_additional_modules = true` 和规则
4. 验证部署：检查 Worker 是否能正确加载所有模块

## 关键坑点（务必注意）
1. ❌ `[build] command = "npm run build"` → 递归执行或找不到 build 脚本
2. ❌ `[build.upload] format = "modules"` → wrangler 4.x 不认
3. ❌ 只加 `--no-bundle` 不加 `find_additional_modules` → No such module
4. ❌ `find_additional_modules` 放 `[build]` 段 → 不生效，必须在顶层
5. ❌ globs 写 `src/**/*.js` → 不对，base_dir 默认是 src/，应写 `**/*.js`
6. ✅ 命令行 `--no-bundle` 不会自动开启 `find_additional_modules`，必须显式在 wrangler.toml 顶层写

## 标准配置模板
```toml
find_additional_modules = true

[[rules]]
type = "ESModule"
globs = ["**/*.js"]
fallthrough = true
```

## 注意事项
- 每次修改代码后需要重新部署
- 环境变量在 Cloudflare 控制台配置，不要硬编码
- 部署失败时检查 wrangler.toml 配置是否正确
- 建议使用 dev 分支开发，合并到 main 后触发部署

## 输出格式
返回部署状态和结果：
- 成功：显示部署时间、Worker URL
- 失败：显示错误信息和排查建议