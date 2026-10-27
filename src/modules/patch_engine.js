// ============================================================
// Patch Engine Core (v1) - structured patch validate & apply
// Loaded by github_v64.js (SRC: ../modules/patch_engine.js)
// 2026-09-05 Ziven x GPT #751/#753 converged
// ============================================================

// 校验 structured patch 是否可应用
// patch = { file, changes: [{ start_line, delete_lines, insert_lines, delete_content? }] }
export function validatePatch(fileContent, patch) {
  const errs = [];
  if (!patch || !patch.file) errs.push('missing file');
  if (!Array.isArray(patch.changes) || patch.changes.length === 0) errs.push('missing changes');
  if (errs.length) return { ok: false, errors: errs };

  const lines = fileContent.split('\n');
  const total = lines.length;

  for (let i = 0; i < patch.changes.length; i++) {
    const ch = patch.changes[i];
    const start = ch.start_line;
    const del = ch.delete_lines || 0;
    if (typeof start !== 'number' || start < 1) { errs.push('change[' + i + '] start_line invalid: ' + start); continue; }
    if (typeof del !== 'number' || del < 0) { errs.push('change[' + i + '] delete_lines invalid: ' + del); continue; }
    if (start > total + 1) { errs.push('change[' + i + '] start_line out of range: ' + start + ' > total+1=' + (total + 1)); continue; }
    if (start - 1 + del > total) { errs.push('change[' + i + '] delete range out of bounds: start=' + start + ' del=' + del + ' total=' + total); continue; }
    if (del > 0 && ch.delete_content) {
      for (let k = 0; k < del; k++) {
        if (lines[start - 1 + k] !== ch.delete_content[k]) { errs.push('change[' + i + '] delete_content mismatch at line ' + (start + k)); break; }
      }
    }
  }
  return { ok: errs.length === 0, errors: errs, lines, total };
}

// 应用 structured patch（倒序避免行号漂移）
export function applyPatch(fileContent, patch) {
  const v = validatePatch(fileContent, patch);
  if (!v.ok) return { ok: false, errors: v.errors };
  let lines = fileContent.split('\n');
  const sorted = patch.changes.map((c, i) => ({ c, i })).sort((a, b) => b.c.start_line - a.c.start_line);
  for (const { c } of sorted) {
    const idx = c.start_line - 1;
    lines.splice(idx, c.delete_lines || 0, ...(c.insert_lines || []));
  }
  return { ok: true, content: lines.join('\n') };
}

// ============================================================
// Patch Engine target policy
// Default: dev only. Future branches can be explicitly authorized via
// PATCH_ENGINE_ALLOWED_BRANCHES (comma-separated); main is never allowed here.
// ============================================================
export function resolvePatchTargetPolicy(repo, branch, env = {}) {
  const targetRepo = String(repo || '').trim();
  const targetBranch = String(branch || '').trim();
  if (!targetRepo || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(targetRepo)) {
    return { ok: false, code: 'INVALID_REPOSITORY', reason: '目标仓库必须是合法的 owner/repo 标识，不能包含 URL 查询或路径控制字符' };
  }
  if (!targetBranch || targetBranch.startsWith('-')) {
    return { ok: false, code: 'INVALID_BRANCH', reason: '目标分支无效' };
  }
  const canonicalBranch = targetBranch.replace(/^refs\/heads\//, '');
  if (canonicalBranch.toLowerCase() === 'main') {
    return { ok: false, code: 'MAIN_PROTECTED', reason: 'github_apply_patch 禁止直接写入 main；请走独立发布审批流程' };
  }
  const configured = String(env.PATCH_ENGINE_ALLOWED_BRANCHES || 'dev')
    .split(',').map(s => s.trim()).filter(Boolean);
  const allowedBranches = new Set(configured.map(s => s.replace(/^refs\/heads\//, '')).filter(s => s.toLowerCase() !== 'main'));
  if (!allowedBranches.has(canonicalBranch)) {
    return { ok: false, code: 'BRANCH_NOT_ALLOWED', reason: `目标分支未获授权：${canonicalBranch}。允许分支：${Array.from(allowedBranches).join(', ') || '(none)'}` };
  }
  const configuredRepos = String(env.GITHUB_ALLOWED_REPOS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const defaultRepo = String(env.GITHUB_REPO || '').trim();
  if (targetRepo !== defaultRepo && !configuredRepos.includes(targetRepo)) {
    return { ok: false, code: 'REPOSITORY_NOT_ALLOWED', reason: `目标仓库未获授权：${targetRepo}。允许仓库：${[defaultRepo, ...configuredRepos].filter(Boolean).join(', ')}` };
  }
  return { ok: true, repo: targetRepo, branch: canonicalBranch };
}

// Validate an approved proposal's repository-relative target path before constructing a GitHub API URL.
// GitHub path segments '.'/'..' are not escaped by encodeURIComponent and can normalize URL paths.
export function validatePatchTargetFile(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath !== filePath.trim()) {
    return { ok: false, code: 'INVALID_TARGET_PATH', reason: '目标文件路径必须是非空且无首尾空白的相对路径' };
  }
  if (filePath.startsWith('/') || filePath.includes('\\') || /[\u0000-\u001f\u007f]/.test(filePath)) {
    return { ok: false, code: 'INVALID_TARGET_PATH', reason: '目标文件路径不能是绝对路径，也不能含反斜杠或控制字符' };
  }
  const segments = filePath.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return { ok: false, code: 'INVALID_TARGET_PATH', reason: '目标文件路径不能包含空路径段、. 或 .. 段' };
  }
  return { ok: true, path: filePath };
}

// ============================================================
// Self-test block
// ============================================================
export function selfTest() {
  const t = (name, cond) => { if (!cond) throw new Error('FAIL: ' + name); return 'PASS: ' + name; };
  const c1 = 'a\nb\nc';
  const p1 = { file: 't', changes: [{ start_line: 4, delete_lines: 0, insert_lines: ['d'] }] };
  t('append', applyPatch(c1, p1).content === 'a\nb\nc\nd');
  const c3 = 'a\nold\nb';
  const p3 = { file: 't', changes: [{ start_line: 2, delete_lines: 1, insert_lines: ['new'] }] };
  t('replace', applyPatch(c3, p3).content === 'a\nnew\nb');
  const r5 = validatePatch('a\nb', { file: 't', changes: [{ start_line: 99, delete_lines: 0, insert_lines: ['x'] }] });
  t('out-of-range', r5.ok === false);
  return 'self-test 3/3 OK';
}