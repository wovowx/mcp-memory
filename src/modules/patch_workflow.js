// Patch proposal application workflow: approved -> applying -> GitHub PUT -> applied.
// Preserve partial/unknown results and existing proposal state semantics.
import { validatePatch, applyPatch, resolvePatchTargetPolicy, validatePatchTargetFile } from './patch_engine.js';

export async function handlePatchWorkflow(name, safeArgs, env, { base64ToUtf8, utf8ToBase64 }) {
    let text = '';
    // github_apply_patch - Patch Engine MVP (structured patch)
        if (name === 'github_apply_patch') {
            const proposalId = safeArgs.proposal_id;
            if (!proposalId) return 'ERROR: Missing proposal_id';
            const requestedBranch = safeArgs.branch || 'dev';
            const requestedRepo = (safeArgs && safeArgs.repo) || env.GITHUB_REPO;
            // Fail closed before any Supabase/GitHub request. New branches are enabled only by policy config.
            const targetPolicy = resolvePatchTargetPolicy(requestedRepo, requestedBranch, env);
            if (!targetPolicy.ok) return 'ERROR: ' + targetPolicy.code + ': ' + targetPolicy.reason;
            const branch = targetPolicy.branch;
            const applyRepo = targetPolicy.repo;
            if (!env.SUPABASE_URL) return 'ERROR: SUPABASE_URL not configured';
            const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
            if (!sbKey) return 'ERROR: Supabase key not configured';
            const sbHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' };
            const proposalUrl = env.SUPABASE_URL + '/rest/v1/patch_proposals?id=eq.' + encodeURIComponent(proposalId);
            // 1) 查 proposal，明确检查 HTTP 状态
            const propResp = await fetch(proposalUrl + '&select=*', { headers: sbHeaders });
            if (!propResp.ok) return 'ERROR: 读取 proposal 失败: HTTP ' + propResp.status;
            const propRows = await propResp.json();
            const proposal = Array.isArray(propRows) ? propRows[0] : null;
            if (!proposal) return 'ERROR: proposal not found: ' + proposalId;
            if (proposal.status !== 'approved') return 'ERROR: proposal status=' + proposal.status + '（必须 approved 才能 apply）';
            // 2) 解析 structured patch
            let patch = null;
            try { patch = JSON.parse(proposal.diff); } catch (e) { patch = null; }
            if (!patch || !Array.isArray(patch.changes) || patch.changes.length === 0) return 'ERROR: proposal.diff 不是有效 structured patch JSON';
            const proposalTarget = proposal.target == null ? '' : proposal.target;
            const diffTarget = patch.file == null ? '' : patch.file;
            if ((proposalTarget && typeof proposalTarget !== 'string') || (diffTarget && typeof diffTarget !== 'string')) return 'ERROR: proposal target / patch.file 必须是字符串路径';
            if (proposalTarget && diffTarget && proposalTarget !== diffTarget) return 'ERROR: PATCH_TARGET_MISMATCH: proposal.target 与 patch.file 不一致；拒绝写入未经 proposal target 明确绑定的文件';
            const targetFile = proposalTarget || diffTarget;
            if (!targetFile) return 'ERROR: 缺少目标文件（patch.file / proposal.target）';
            const targetPathPolicy = validatePatchTargetFile(targetFile);
            if (!targetPathPolicy.ok) return 'ERROR: ' + targetPathPolicy.code + ': ' + targetPathPolicy.reason;
            patch.file = targetFile;
            // 3) 读目标文件当前内容（目标分支）
            const ghToken = env.GITHUB_TOKEN;
            if (!ghToken) return 'ERROR: GITHUB_TOKEN not configured';
            const ghApplyHeaders = { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'User-Agent': 'mcp-memory' };
            const gbUrl = 'https://api.github.com/repos/' + applyRepo;
            const fileUrl = gbUrl + '/contents/' + targetPathPolicy.encodedPath + '?ref=' + encodeURIComponent(branch);
            const fileResp = await fetch(fileUrl, { headers: ghApplyHeaders });
            let fileData;
            try { fileData = await fileResp.json(); } catch (e) { return 'ERROR: 读取目标文件响应无效'; }
            if (!fileResp.ok) return 'ERROR: 读取文件失败: ' + (fileData.message || fileResp.status);
            const oldSha = fileData.sha;
            let fileContent;
            try { fileContent = base64ToUtf8(fileData.content); } catch (e) { return 'ERROR: base64 解码失败: ' + e.message; }
            // 4) validate + apply before claiming proposal
            const vRes = validatePatch(fileContent, patch);
            if (!vRes.ok) return 'ERROR: validatePatch: ' + vRes.errors.join('; ');
            const aRes = applyPatch(fileContent, patch);
            if (!aRes.ok) return 'ERROR: applyPatch: ' + (aRes.errors ? aRes.errors.join('; ') : 'unknown');
            const newContent = aRes.content;
            // 5) Atomically claim only an approved proposal. A competing call gets zero rows and cannot write GitHub.
            const claimAt = new Date().toISOString();
            let claimResp;
            try {
                claimResp = await fetch(proposalUrl + '&status=eq.approved&select=id,status', {
                    method: 'PATCH',
                    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({ status: 'applying', updated_at: claimAt })
                });
            } catch (e) { return 'UNKNOWN: proposal 原子认领请求结果未知；本次尚未请求 GitHub 写入，但 proposal 可能已进入 applying。请先核对状态，不要盲目重试。错误: ' + e.message; }
            if (!claimResp.ok) return 'ERROR/UNKNOWN: proposal 原子认领返回 HTTP ' + claimResp.status + '；本次未请求 GitHub 写入，但请核对 proposal 状态后再重试。';
            let claimedRows;
            try { claimedRows = await claimResp.json(); } catch (e) { claimedRows = null; }
            if (!Array.isArray(claimedRows) || !claimedRows.some(row => row && row.id === proposalId && row.status === 'applying')) {
                return 'ERROR: proposal 已被其他执行占用或状态已变化；本次未写入 GitHub';
            }
            // 6) 写入 GitHub（PUT contents，带 old sha）
            const putBody = { message: 'Patch Engine: apply proposal ' + proposalId.slice(0, 8) + ' (' + applyRepo + ' ' + branch + ' ' + targetFile + ')', content: utf8ToBase64(newContent), sha: oldSha, branch: branch };
            let putResp;
            try {
                putResp = await fetch(gbUrl + '/contents/' + targetPathPolicy.encodedPath, { method: 'PUT', headers: ghApplyHeaders, body: JSON.stringify(putBody) });
            } catch (e) {
                return 'PARTIAL/UNKNOWN: proposal 已锁定为 applying，但 GitHub 写入结果未知；为避免重复应用未自动解锁。请先核对目标文件，再人工恢复 proposal 状态。错误: ' + e.message;
            }
            let putData;
            try { putData = await putResp.json(); } catch (e) { putData = {}; }
            if (!putResp.ok) {
                // Definite client-side rejection (excluding timeout/rate-limit): release the claim. Server/timeout outcomes remain locked for reconciliation.
                if (putResp.status >= 400 && putResp.status < 500 && putResp.status !== 408 && putResp.status !== 429) {
                    let releaseOk = false;
                    try {
                        const releaseResp = await fetch(proposalUrl + '&status=eq.applying&select=id,status', {
                            method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                            body: JSON.stringify({ status: 'approved', updated_at: new Date().toISOString() })
                        });
                        const releaseRows = releaseResp.ok ? await releaseResp.json() : null;
                        releaseOk = Array.isArray(releaseRows) && releaseRows.some(row => row && row.id === proposalId && row.status === 'approved');
                    } catch (e) { releaseOk = false; }
                    return 'ERROR: GitHub 写入被拒绝 (HTTP ' + putResp.status + '): ' + (putData.message || 'unknown') + (releaseOk ? '；proposal 已恢复 approved' : '；proposal 仍可能处于 applying，请核对状态后再处理');
                }
                return 'PARTIAL/UNKNOWN: GitHub 写入返回 HTTP ' + putResp.status + '，proposal 保持 applying 以防重复应用；请核对目标文件后再恢复状态。详情: ' + (putData.message || 'unknown');
            }
            // A 2xx alone is not enough: require a returned content SHA before marking the proposal applied.
            // GitHub may have accepted the write while returning an unusable/truncated response; keep applying for reconciliation.
            const returnedContent = putData && putData.content;
            const returnedSha = returnedContent && typeof returnedContent.sha === 'string' ? returnedContent.sha : '';
            const returnedPath = returnedContent && typeof returnedContent.path === 'string' ? returnedContent.path : '';
            if (!returnedSha || (returnedPath && returnedPath !== targetFile)) {
                return 'PARTIAL/UNKNOWN: GitHub PUT returned HTTP success but did not provide a verifiable target identity; proposal remains applying and was not marked applied. Check the repository file before reconciliation; do not retry blindly. proposal=' + proposalId + ' expected_file=' + targetFile + ' returned_file=' + (returnedPath || '?') + ' returned_sha=' + (returnedSha || '?');
            }
            // 7) Confirm applied state transition. HTTP success alone is insufficient; require returned row.
            const appliedAt = new Date().toISOString();
            let stateResp;
            try {
                stateResp = await fetch(proposalUrl + '&status=eq.applying&select=id,status', {
                    method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({ status: 'applied', applied_by: 'ziven', applied_at: appliedAt, rollback_sha: oldSha, updated_at: appliedAt })
                });
            } catch (e) {
                return 'PARTIAL SUCCESS: GitHub 文件已写入，但 proposal 状态确认请求失败；proposal 可能仍为 applying。不要直接重试。proposal=' + proposalId + ' file=' + targetFile + ' branch=' + branch + ' old_sha=' + oldSha + ' new_sha=' + ((putData.content && putData.content.sha) || '?') + ' error=' + e.message;
            }
            let stateRows;
            try { stateRows = stateResp.ok ? await stateResp.json() : null; } catch (e) { stateRows = null; }
            if (!stateResp.ok || !Array.isArray(stateRows) || !stateRows.some(row => row && row.id === proposalId && row.status === 'applied')) {
                return 'PARTIAL SUCCESS: GitHub 文件已写入，但 proposal 状态未能确认变为 applied（HTTP ' + stateResp.status + '）。proposal 可能仍为 applying；不要直接重试。proposal=' + proposalId + ' file=' + targetFile + ' branch=' + branch + ' old_sha=' + oldSha + ' new_sha=' + ((putData.content && putData.content.sha) || '?');
            }
            text = '✅ github_apply_patch 成功\nproposal: ' + proposalId + '\nfile: ' + targetFile + ' (' + branch + ')\nold_sha: ' + oldSha.slice(0, 12) + '\nnew_sha: ' + (putData.content && putData.content.sha ? putData.content.sha.slice(0, 12) : '?') + '\nrollback: ' + oldSha.slice(0, 12) + '\nstatus: applied';
        }
        
    else return 'ERROR: Unknown patch workflow: ' + name;
    return text;
}
