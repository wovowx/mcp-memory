// ============================================================
// release_guard.js - 发布闸门（Release Guard）v1
// ============================================================
// 作用：把「版本化发布纪律」从软约束（靠记忆）变成硬约束（系统拦截）。
// 柳柳 2026-09-04 点破：角色卡/文档/提示词全是软约束，AI 想不起来等于没有。
// 真正可靠的系统不是让 Agent 记住，而是让「忘记规则也无法造成错误状态」。
// 与 watchdog 同思想：watchdog 防事件忘记处理，release_guard 防发布忘记规范。
//
// v1 范围（GPT #514 定稿）：
//   - repo 类型识别（代码仓 mcp-memory / 文档仓 ZivenLab）
//   - branch 判断（只拦受保护分支 main）
//   - commit_title 版本正则校验
//   - main push 硬阻断（不再只警告）
//   - 结构化返回 {allowed, reason, expected, repoType, checked}
// 暂不做：CHANGELOG 校验（留 v2）、bypass（紧急走 emergency_reason 单独判断）
// ============================================================

// 代码仓（mcp-memory）→ 语义化版本 vX.Y.Z: 名称
const CODE_REPO_PATTERN = /^v\d+\.\d+\.\d+\s*:/;
// 文档仓（ZivenLab）→ 知识快照 docs-YYYY.MM(.N)?(:|\s|$)
const DOCS_REPO_PATTERN = /^docs-\d{4}\.\d{2}(\.\d+)?(\s*:|\s|$)/;

// 代码仓列表（加白名单判定时用完整 repo 名，这里用 owner/repo 匹配）
const CODE_REPOS = ['wovowx/mcp-memory', 'mcp-memory'];
// 文档仓列表
const DOCS_REPOS = ['wovowx/ZivenLab', 'ZivenLab'];

/**
 * 识别仓库类型
 * @param {string} repo 仓库名（可能带 owner/ 前缀）
 * @returns {'code'|'docs'|'unknown'}
 */
export function detectRepoType(repo = '') {
    const r = repo.trim().toLowerCase();
    if (CODE_REPOS.includes(r) || r.endsWith('/mcp-memory')) return 'code';
    if (DOCS_REPOS.includes(r) || r.endsWith('/zivenlab')) return 'docs';
    return 'unknown';
}

/**
 * 校验 commit_title 是否符合版本规范
 * @param {'code'|'docs'} repoType
 * @param {string} commitTitle
 * @returns {{ok: boolean, expected: string}}
 */
export function validateCommitTitle(repoType, commitTitle = '') {
    if (repoType === 'code') {
        return { ok: CODE_REPO_PATTERN.test(commitTitle), expected: 'vX.Y.Z: 名称（如 v6.9.0: Release Discipline）' };
    }
    if (repoType === 'docs') {
        return { ok: DOCS_REPO_PATTERN.test(commitTitle), expected: 'docs-YYYY.MM(.N)?: 名称（如 docs-2026.09: 项目驾驶舱）' };
    }
    return { ok: false, expected: '无法识别的仓库类型' };
}

/**
 * 发布闸门主函数：统一校验「进入受保护分支的发布行为」
 * @param {object} opts
 * @param {string} opts.repo 仓库名
 * @param {string} opts.branch 目标分支
 * @param {string} opts.commitTitle 合并标题（版本号+名称）
 * @param {'merge'|'push'} opts.action 操作类型
 * @returns {{allowed: boolean, reason?: string, expected?: string, repoType: string, checked: object}}
 */
export function validateRelease({ repo, branch, commitTitle, action = 'merge' }) {
    const checked = { repo, branch, commit_title: commitTitle ?? null, action };
    const repoType = detectRepoType(repo || '');

    // 1. 只拦受保护分支 main；非 main（dev/feature）不拦，开发期不痛苦
    if (branch !== 'main') {
        return { allowed: true, repoType, checked };
    }

    // 2. push 到 main 直接硬阻断（WARNING 已证明拦不住，柳柳 2026-09-04）
    //    紧急情况走 emergency_reason 单独判断（v2 实现），不做万能 bypass
    if (action === 'push') {
        return {
            allowed: false,
            reason: 'push_to_main_blocked',
            expected: '禁止直接 push main。请推到 dev，走 PR/merge 发布（release_guard 强制版本化）',
            repoType,
            checked
        };
    }

    // 3. merge 到 main：必须带版本化 commit_title
    if (!commitTitle || String(commitTitle).trim() === '') {
        return {
            allowed: false,
            reason: 'missing_version_prefix',
            expected: repoType === 'code' ? 'vX.Y.Z: 名称（如 v6.9.0: Release Discipline）' : 'docs-YYYY.MM: 名称（如 docs-2026.09: 项目驾驶舱）',
            repoType,
            checked
        };
    }

    const v = validateCommitTitle(repoType, String(commitTitle).trim());
    if (!v.ok) {
        return {
            allowed: false,
            reason: 'invalid_version_format',
            expected: v.expected,
            repoType,
            checked
        };
    }

    // 4. 未知仓库类型但带了合法版本前缀：放行（不误伤未来新仓）
    return { allowed: true, repoType, checked };
}

// ============================================================
// 自测（dev 分支可直接跑：node src/modules/release_guard.js）
// ============================================================
if (import.meta.url === `file://${process.argv[1]}`) {
    const cases = [
        // [repo, branch, commitTitle, action, 期望]
        ['wovowx/mcp-memory', 'main', 'v6.9.0: Release Discipline', 'merge', true],
        ['wovowx/ZivenLab', 'main', 'docs-2026.09: 项目驾驶舱', 'merge', true],
        ['wovowx/ZivenLab', 'main', 'docs-2026.09.1: 第二次发布', 'merge', true],
        ['wovowx/mcp-memory', 'main', 'docs(common-ground): update xxx', 'merge', false],
        ['wovowx/ZivenLab', 'main', 'v6.9.0: 名称写错了', 'merge', false],
        ['wovowx/mcp-memory', 'main', '', 'merge', false],
        ['wovowx/mcp-memory', 'main', '随便写', 'push', false],
        ['wovowx/mcp-memory', 'dev', '随便写', 'push', true],
        ['wovowx/mcp-memory', 'main', 'v6.9.0: ok', 'push', false],
    ];
    let pass = 0;
    for (const [repo, branch, title, action, expect] of cases) {
        const r = validateRelease({ repo, branch, commitTitle: title, action });
        const ok = r.allowed === expect;
        console.log(`${ok ? '✅' : '❌'} repo=${repo} branch=${branch} title="${title}" action=${action} → allowed=${r.allowed} (expect ${expect})${r.reason ? ' [' + r.reason + ']' : ''}`);
        if (ok) pass++;
    }
    console.log(`\n${pass}/${cases.length} passed`);
}
