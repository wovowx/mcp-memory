// 最小 CI 门禁（v1 · 2026-10-19）
// 治：语法错误进部署 + 文件移动后出现悬空 import
// 轻量、离线可运行（不需要外部 API / Supabase / GitHub）
// 用法：node scripts/check.mjs   （或 npm run check）
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const root = process.cwd();
let failed = 0;

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const jsFiles = walk(join(root, 'src'));
console.log(`[check] 语法检查 ${jsFiles.length} 个 JavaScript 文件...`);
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' }); }
  catch { console.log('  ✗ 语法错误:', f); failed++; }
}

// import 完整性：确认本地相对 import 目标存在（不检查 npm 包）
console.log('[check] 验证本地 import 路径完整性...');
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) { console.log('  ✗ 悬空 import:', f, '→', m[1]); failed++; }
  }
}

if (failed === 0) console.log('✅ [check] 全部通过');
else { console.log(`❌ [check] ${failed} 处问题`); }
process.exit(failed === 0 ? 0 : 1);