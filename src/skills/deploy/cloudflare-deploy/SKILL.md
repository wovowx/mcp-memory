---
name: cloudflare-deploy
description: 当用户需要了解Cloudflare Worker多文件部署方案或解决部署问题时调用此技能。
---

# Cloudflare Worker部署技能

## 目标
解决GitHub自动部署到Cloudflare时默认只有单个index.js的问题，实现多文件部署。

## 适用场景
- 将多个JS文件部署到Cloudflare Worker
- 解决esbuild打包导致文件丢失的问题
- 配置Worker环境变量和绑定

## 工作流程（SOP）
1. 代码结构：确保代码放在src/目录（入口src/index.js，模块src/utils/*.js、src/tools/*.js）
2. 构建命令：Cloudflare控制台配置为`npx wrangler deploy --no-bundle`
3. wrangler.toml配置：在顶层添加`find_additional_modules = true`和规则
4. 验证部署：检查Worker是否能正确加载所有模块

## 关键坑点
1. ❌ `[build] command = "npm run build"` → 递归执行或找不到build脚本
2. ❌ `[build.upload] format = "modules"` → wrangler 4.x不认
3. ❌ 只加`--no-bundle`不加`find_additional_modules` → No such module
4. ❌ `find_additional_modules`放`[build]`段 → 不生效，必须在顶层
5. ❌ globs写`src/**/*.js` → 不对，base_dir默认是src/，应写`**/*.js`
6. ✅ 命令行`--no-bundle`不会自动开启`find_additional_modules`，必须显式在wrangler.toml顶层写

## 注意事项
- 每次修改代码后需要重新部署
- 环境变量在Cloudflare控制台配置，不要硬编码

## 输出格式
返回部署状态和结果