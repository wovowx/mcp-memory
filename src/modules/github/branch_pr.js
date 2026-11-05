// GitHub Branch/PR domain: reusable ref primitive + complete PR/merge workflows.
// Public tools, repo/token gates and release authorization remain in github_v64.js.
export async function restoreBranchReference({
    baseUrl, headers, branch = 'dev', targetSha, expectedSha, fetchImpl = fetch
} = {}) {
    const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
    const validSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
    const readJson = async response => {
        try { return await response.json(); } catch { return {}; }
    };

    if (branch !== 'dev') return fail('BRANCH_NOT_ALLOWED', '精确恢复模式只允许操作 dev。');
    if (!validSha(targetSha) || !validSha(expectedSha)) {
        return fail('INVALID_SHA', 'targetSha 和 expectedSha 都必须是完整的 40 位 commit SHA。');
    }

    let response;
    let payload;
    try {
        response = await fetchImpl.call(globalThis, `${baseUrl}/commits/${targetSha}`, { headers });
        payload = await readJson(response);
    } catch (error) {
        return fail('TARGET_COMMIT_READ_FAILED', error?.message || String(error));
    }
    if (!response.ok || (payload.sha || '').toLowerCase() !== targetSha.toLowerCase()) {
        return fail('TARGET_COMMIT_NOT_FOUND', payload.message || `HTTP ${response.status}`, { status: response.status });
    }

    const refUrl = `${baseUrl}/git/ref/heads/dev`;
    try {
        response = await fetchImpl.call(globalThis, refUrl, { headers });
        payload = await readJson(response);
    } catch (error) {
        return fail('CURRENT_REF_READ_FAILED', error?.message || String(error));
    }
    if (!response.ok) return fail('CURRENT_REF_READ_FAILED', payload.message || `HTTP ${response.status}`, { status: response.status });
    const currentSha = payload.object?.sha;
    if (!currentSha || currentSha.toLowerCase() !== expectedSha.toLowerCase()) {
        return fail('HEAD_MISMATCH', 'dev 当前 HEAD 已变化，拒绝覆盖。', { currentSha: currentSha || null });
    }

    try {
        response = await fetchImpl.call(globalThis, `${baseUrl}/git/refs/heads/dev`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ sha: targetSha, force: true })
        });
        payload = await readJson(response);
    } catch (error) {
        return fail('REF_UPDATE_FAILED', error?.message || String(error), { previousSha: currentSha });
    }
    if (!response.ok) return fail('REF_UPDATE_FAILED', payload.message || `HTTP ${response.status}`, { status: response.status, previousSha: currentSha });

    try {
        response = await fetchImpl.call(globalThis, refUrl, { headers });
        payload = await readJson(response);
    } catch (error) {
        return fail('REF_VERIFY_FAILED', error?.message || String(error), { previousSha: currentSha });
    }
    const verifiedSha = payload.object?.sha;
    if (!response.ok || !verifiedSha || verifiedSha.toLowerCase() !== targetSha.toLowerCase()) {
        return fail('REF_VERIFY_FAILED', payload.message || '更新后回读的 dev HEAD 与目标 SHA 不一致。', {
            status: response.status, previousSha: currentSha, verifiedSha: verifiedSha || null
        });
    }
    return { ok: true, branch: 'dev', previousSha: currentSha, sha: verifiedSha };
}



async function tryAutoSyncDev(baseUrl, ghHeaders, pullNumber) {
    try {
        const prNum = Number(pullNumber);
        if (!Number.isSafeInteger(prNum) || prNum <= 0) {
            return 'ℹ️ 已跳过 dev 自动同步：缺少有效 PR 编号，dev 未修改';
        }

        // 必须用 GitHub 当前 PR metadata 判断实际 head/base 与 merged 状态，
        // 不能仅凭调用入口的参数或 merge endpoint 的 HTTP 状态推断。
        const prResp = await fetch(`${baseUrl}/pulls/${prNum}`, { headers: ghHeaders });
        if (!prResp.ok) {
            return `⚠️ 已跳过 dev 自动同步：读取 PR #${prNum} 信息失败（HTTP ${prResp.status}），dev 未修改`;
        }
        const prData = await prResp.json();
        if (!prData || prData.merged !== true) {
            return `ℹ️ 已跳过 dev 自动同步：PR #${prNum} 未能确认 merged=true，dev 未修改`;
        }

        const headRef = prData.head?.ref;
        const baseRef = prData.base?.ref;
        if (typeof headRef !== 'string' || typeof baseRef !== 'string' || !headRef || !baseRef) {
            return `⚠️ 已跳过 dev 自动同步：PR #${prNum} 缺少完整 head/base ref，dev 未修改`;
        }
        if (headRef !== 'dev' || baseRef !== 'main') {
            return `ℹ️ 已跳过 dev 自动同步：PR #${prNum} 为 ${headRef} → ${baseRef}，仅 dev → main 可触发同步；dev 未修改`;
        }

        const refResp = await fetch(`${baseUrl}/git/ref/heads/main`, { headers: ghHeaders });
        if (!refResp.ok) return '⚠️ 自动同步 dev 失败：取 main SHA 出错；dev 未确认修改';
        const refData = await refResp.json();
        const sha = refData?.object?.sha;
        if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
            return '⚠️ 自动同步 dev 已停止：main ref 未返回有效 commit SHA；dev 未修改';
        }

        const updResp = await fetch(`${baseUrl}/git/refs/heads/dev`, {
            method: 'PATCH',
            headers: ghHeaders,
            body: JSON.stringify({ sha, force: true })
        });
        if (!updResp.ok) {
            let message = `HTTP ${updResp.status}`;
            try { message = (await updResp.json())?.message || message; } catch {}
            return '⚠️ 自动同步 dev 失败：' + message;
        }
        return `✅ 已确认 PR #${prNum} 为 dev → main，合并后自动同步 dev → main（${sha.slice(0, 8)}）`;
    } catch (e) {
        return '⚠️ 已跳过/停止 dev 自动同步：PR 或 ref 信息读取异常，dev 未执行后续同步。' + e.message;
    }
}

// ============================================================
// autoSyncGithubTools - 全量对比 + 自动补新增
// 四态：���增(自动注册) / 变化(报告待确认) / 孤儿(报告待确认) / 无变化
// ============================================================

export const BRANCH_PR_TOOL_NAMES = new Set([
    "github_merge_to_main",
    "github_create_pull_request",
    "github_merge_pull_request",
    "github_close_pull_request",
    "github_compare_branches",
    "github_get_pull_request",
    "github_sync_branch",
    "github_create_branch"
]);

export async function handleBranchPrTool(name, safeArgs, { repo, baseUrl, ghHeaders }) {
    let text = '';
    // github_merge_to_main
        if (name === 'github_merge_to_main') {
            const branch = (safeArgs && safeArgs.branch) || 'dev';
            const title = (safeArgs && safeArgs.title) || `Merge ${branch} into main`;
            const prBody = (safeArgs && safeArgs.body) || '';
            const mergeMethod = (safeArgs && safeArgs.merge_method) || 'rebase';
            const mergeTitle = (safeArgs && safeArgs.commit_title) || (safeArgs && safeArgs.title) || undefined;
            const mergeReason = (safeArgs && safeArgs.merge_reason) || '';
            if (mergeMethod === 'merge') {
                if (!mergeTitle) return 'ERROR: MERGE_REQUIRES_COMMIT_TITLE: 显式 merge 必须带 commit_title（否则 GitHub 会把标题写两遍，参见 PR #131 事故）';
                if (!mergeReason) return 'ERROR: MERGE_REQUIRES_REASON: 显式 merge 必须说明 merge_reason（hotfix/emergency/history-preserve）——禁止策略含糊，见 release_guard 家族规则';
            }
            const steps = [];

            try {
                const creatResp = await fetch(`${baseUrl}/pulls`, {
                    method: 'POST',
                    headers: ghHeaders,
                    body: JSON.stringify({ title: mergeTitle || title, head: branch, base: 'main', body: prBody })
                });
                const prData = await creatResp.json();
                if (!creatResp.ok) {
                    const existingResp = await fetch(`${baseUrl}/pulls?state=open&head=${repo.split('/')[0]}:${branch}&base=main`, { headers: ghHeaders });
                    const existing = await existingResp.json();
                    if (Array.isArray(existing) && existing.length > 0) {
                        const prNum = existing[0].number;
                        steps.push(`步骤1（建PR）：已存在 PR #${prNum}，直接沿用 ${existing[0].html_url}`);
                        prData.number = prNum;
                        prData.mergeable = existing[0].mergeable;
                        prData.mergeable_state = existing[0].mergeable_state;
                    } else {
                        throw new Error('建PR失败：' + (prData.message || `HTTP ${creatResp.status}`));
                    }
                } else {
                    steps.push(`步骤1（建PR）：创建成功 PR #${prData.number} ${prData.html_url}`);
                    prData.mergeable = prData.mergeable;
                    prData.mergeable_state = prData.mergeable_state;
                }

                const prNum = prData.number;
                let mergeable = prData.mergeable;
                let mergeableState = prData.mergeable_state;
                if (mergeable === null) {
                    const waitResp = await fetch(`${baseUrl}/pulls/${prNum}`, { headers: ghHeaders });
                    const waitData = await waitResp.json();
                    mergeable = waitData.mergeable;
                    mergeableState = waitData.mergeable_state;
                }
                if (mergeable === false) {
                    steps.push(`步骤2（查可合并）：❌ 不可合并（mergeable_state=${mergeableState}）——有冲突，请先回 dev 对齐 main`);
                    return steps.join('\n') + '\n\n⛔ 停止：PR 存在冲突，未合并。请先解决冲突再重试。';
                }
                steps.push(`步骤2（查可合并）：✅ 可合并（mergeable_state=${mergeableState || 'clean'}）`);

                const mergeBody = { merge_method: mergeMethod };
                if (mergeTitle && mergeMethod !== 'rebase') mergeBody.commit_title = mergeTitle;
                const mergeResp = await fetch(`${baseUrl}/pulls/${prNum}/merge`, {
                    method: 'PUT',
                    headers: ghHeaders,
                    body: JSON.stringify(mergeBody)
                });
                const mergeData = await mergeResp.json();
                if (mergeResp.ok || mergeResp.status === 405) {
                    steps.push('步骤3（合并）：✅ 已合并' + (mergeData.html_url ? ' ' + mergeData.html_url : ''));
                    if (mergeTitle && mergeMethod !== 'rebase') steps.push('Commit: ' + mergeTitle);
                    if (mergeMethod === 'rebase') steps.push('(rebase: 保留 dev 原始 commit 名，无 Merge PR 前缀)');
                    if (mergeData.merged || mergeResp.status === 405) {
                        const syncNote = await tryAutoSyncDev(baseUrl, ghHeaders, prNum);
                        steps.push(syncNote);
                    }
                    text = steps.join('\n');
                    text += '\n\n⚠️ 部署验证提示（Deploy Closure · 规范生效机制 Step 4）: 合并已成功，请按 deploy skill 第 6 步自动闭环——sleep 45s → cloudflare_deploy_status(verify_main=true) → 若 DEPLOY_UNVERIFIED 自动调 cloudflare_deploy_logs 查日志分类自愈，不许让柳柳手动贴日志。';
                } else {
                    throw new Error('合并失败：' + (mergeData.message || `HTTP ${mergeResp.status}`));
                }
            } catch (e) {
                if (steps.length > 0) {
                    return 'ERROR: ' + steps.join('\n') + '\n\n❌ ' + e.message;
                }
                throw new Error(e.message);
            }
        }

        // github_create_pull_request
        else if (name === 'github_create_pull_request') {
            const head = safeArgs.head || 'dev';
            const base = safeArgs.base || 'main';
            const title = safeArgs.title || `Merge ${head} into ${base}`;
            const body = safeArgs.body || '';
            const resp = await fetch(`${baseUrl}/pulls`, {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ title, head, base, body })
            });
            const data = await resp.json();
            if (!resp.ok) { throw new Error('建PR失败：' + (data.message || `HTTP ${resp.status}`)); }
            text = `OK: PR #${data.number} created\nTitle: ${data.title}\nURL: ${data.html_url}\nMergeable: ${data.mergeable}`;
        }

        // github_merge_pull_request
        else if (name === 'github_merge_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const method = safeArgs.merge_method || 'rebase';
            const commitTitle = safeArgs.commit_title || safeArgs.title || undefined;
            const mergeReason = (safeArgs && safeArgs.merge_reason) || '';
            if (method === 'merge') {
                if (!commitTitle) return 'ERROR: MERGE_REQUIRES_COMMIT_TITLE: 显式 merge 必须带 commit_title（否则 GitHub 会把标题写两遍，参见 PR #131 事故）';
                if (!mergeReason) return 'ERROR: MERGE_REQUIRES_REASON: 显式 merge 必须说明 merge_reason（hotfix/emergency/history-preserve）——禁止策略含糊，见 release_guard 家族规则';
            }
            const mergeBody = { merge_method: method };
            if (commitTitle) mergeBody.commit_title = commitTitle;
            const resp = await fetch(`${baseUrl}/pulls/${pr}/merge`, {
                method: 'PUT',
                headers: ghHeaders,
                body: JSON.stringify(mergeBody)
            });
            const data = await resp.json();
            if (resp.ok || resp.status === 405) {
                const merged = resp.ok ? (data.merged ? '✅ 已合并' : '⚠️ 未合并') : 'ℹ️ 已经合并过（405）';
                text = `OK: PR #${pr} ${merged}\n` + (data.html_url ? `URL: ${data.html_url}` : '');
                if (commitTitle && method !== 'rebase') text += `\nCommit: ${commitTitle}`;
                if (method === 'rebase') text += '\n(rebase: 保留 dev 原始 commit 名，无 Merge PR 前缀)';
                if (data.merged || resp.status === 405) {
                    const syncNote = await tryAutoSyncDev(baseUrl, ghHeaders, pr);
                    text += '\n\n' + syncNote;
                }
            } else {
                throw new Error('合并失败：' + (data.message || `HTTP ${resp.status}`));
            }
        }

        // github_close_pull_request
        else if (name === 'github_close_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const resp = await fetch(`${baseUrl}/pulls/${pr}`, {
                method: 'PATCH',
                headers: ghHeaders,
                body: JSON.stringify({ state: 'closed' })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `OK: PR #${pr} closed\nState: ${data.state}\nURL: ${data.html_url || ''}`;
        }

        // github_compare_branches
        else if (name === 'github_compare_branches') {
            const base = safeArgs.base || 'main';
            const head = safeArgs.head || 'dev';
            const resp = await fetch(`${baseUrl}/compare/${base}...${head}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `Compare ${base}...${head}\nAhead by: ${data.ahead_by}\nBehind by: ${data.behind_by}\nStatus: ${data.status}\nTotal commits: ${data.total_commits}`;
            if (data.files && data.files.length) {
                text += '\nFiles changed (' + data.files.length + '):\n' + data.files.slice(0, 30).map(f => `  ${f.status} ${f.filename}`).join('\n');
            }
        }

        // github_get_pull_request
        else if (name === 'github_get_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const resp = await fetch(`${baseUrl}/pulls/${pr}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `PR #${data.number}: ${data.title}\nState: ${data.state}\nMerged: ${data.merged}\nMergeable: ${data.mergeable}\nMergeable state: ${data.mergeable_state}\nHead: ${data.head ? data.head.ref : '?'}\nBase: ${data.base ? data.base.ref : '?'}\nURL: ${data.html_url || ''}`;
        }

        // github_sync_branch
        // github_sync_branch
        else if (name === 'github_sync_branch') {
            const targetBranch = safeArgs.name || safeArgs.branch || 'dev';
            const shaMatch = typeof safeArgs.from === 'string' ? safeArgs.from.match(/^sha:([0-9a-f]{40})$/i) : null;
            if (shaMatch) {
                const restored = await restoreBranchReference({
                    baseUrl, headers: ghHeaders, branch: targetBranch,
                    targetSha: shaMatch[1], expectedSha: safeArgs.base, fetchImpl: fetch
                });
                if (!restored.ok) throw new Error(`精确恢复失败 [${restored.code}]：${restored.message}`);
                text = `✅ 已精确恢复：${targetBranch} ${restored.previousSha.slice(0, 8)} → ${restored.sha.slice(0, 8)}（expected SHA 校验及回读验证通过）`;
            } else {
                const fromBranch = safeArgs.from || safeArgs.base || 'main';
                if (targetBranch === fromBranch) return 'ERROR: target and source are the same branch';
                const refResp = await fetch(`${baseUrl}/git/ref/heads/${fromBranch}`, { headers: ghHeaders });
                if (!refResp.ok) {
                    const err = await refResp.json();
                    throw new Error('取源分支失败：' + (err.message || `HTTP ${refResp.status}`));
                }
                const refData = await refResp.json();
                const sha = refData.object.sha;
                const updateResp = await fetch(`${baseUrl}/git/refs/heads/${targetBranch}`, {
                    method: 'PATCH',
                    headers: ghHeaders,
                    body: JSON.stringify({ sha, force: true })
                });
                if (!updateResp.ok) {
                    const err = await updateResp.json();
                    throw new Error('同步失败：' + (err.message || `HTTP ${updateResp.status}`));
                }
                text = `✅ 已同步：${targetBranch} → ${fromBranch}（${sha.slice(0, 8)}，未删分支）`;
            }
        }

        // github_create_branch
        else if (name === 'github_create_branch') {
            const newBranch = safeArgs.name || safeArgs.branch;
            if (!newBranch) return 'ERROR: Missing branch name (name or branch)';
            if (newBranch === 'main') return 'ERROR: main already exists';
            const from = safeArgs.from || safeArgs.base || 'main';
            const refResp = await fetch(`${baseUrl}/git/ref/heads/${from}`, { headers: ghHeaders });
            if (!refResp.ok) {
                const err = await refResp.json();
                throw new Error('取源分支失败：' + (err.message || `HTTP ${refResp.status}`));
            }
            const refData = await refResp.json();
            const sha = refData.object.sha;
            const createResp = await fetch(`${baseUrl}/git/refs`, {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha })
            });
            if (createResp.status === 422) {
                const errText = await createResp.text();
                return `❌ 分支已存在或创建失败：${newBranch}（${errText.substring(0, 120)}）`;
            }
            if (!createResp.ok) {
                const err = await createResp.json();
                throw new Error('建分支失败：' + (err.message || `HTTP ${createResp.status}`));
            }
            text = `✅ 已创建分支：${newBranch}（源自 ${from} ${sha.slice(0, 8)}）`;
        }

        
    else return 'ERROR: Unknown Branch/PR tool: ' + name;
    return text;
}
