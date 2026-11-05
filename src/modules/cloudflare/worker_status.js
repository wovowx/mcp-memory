// Cloudflare Worker deployment/build status service.
// Tool registration and GitHub facade stay in github_v64.js; Cloudflare API
// requests and response formatting live here for a separate provider boundary.

export async function handleCloudflareTool(name, safeArgs, env, fetchImpl = globalThis.fetch) {
    let text = '';
    try {
        // cloudflare_deploy_logs - 部署日志/详情查询（v6.18.1 新增 · 柳柳要求「做查日志的工具」）
        if (name === 'cloudflare_deploy_logs') {
            const cfToken = env.cloudflare_key || env.CLOUDFLARE_API_TOKEN;
            if (!cfToken) return 'ERROR: Cloudflare token not set (env.cloudflare_key or CLOUDFLARE_API_TOKEN, e.g. cfut_ user token for Builds API)';
            const account = safeArgs.account_id || env.CLOUDFLARE_ACCOUNT_ID || '';
            if (!account) return 'ERROR: CLOUDFLARE_ACCOUNT_ID not set';
            const worker = safeArgs.worker_name || 'mcp-memory';
            const limit = Math.min(10, safeArgs.limit || 3);
            const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/scripts/' + worker;
            const cfHeaders = { 'Authorization': 'Bearer ' + cfToken, 'Content-Type': 'application/json' };
            const includeRaw = safeArgs.include_raw === true || safeArgs.include_raw === 'true';

            // 模式 A：查单次部署详情
            if (safeArgs.deployment_id) {
                const depId = String(safeArgs.deployment_id);
                const dResp = await fetchImpl(base + '/deployments/' + encodeURIComponent(depId), { headers: cfHeaders });
                let detail = null, rawErr = null;
                try {
                    const dJson = await dResp.json();
                    if (!dResp.ok) rawErr = JSON.stringify(dJson).slice(0, 300);
                    else detail = dJson;
                } catch (e) { rawErr = dResp.status + ' ' + e.message; }
                if (includeRaw) return JSON.stringify({ ok: dResp.ok, http: dResp.status, raw: detail || rawErr, note: 'raw response' }, null, 2);
                if (!detail) return 'ERROR: 部署详情查询失败' + (rawErr ? ': ' + rawErr : '（HTTP ' + dResp.status + '）');
                const r = detail.result || detail;
                const lines = [
                    '📋 Cloudflare 部署详情 (' + worker + ')',
                    '  deployment_id: ' + (r.id || safeArgs.deployment_id),
                    '  created_on: ' + (r.created_on || '?'),
                    '  source: ' + (r.source || '?'),
                    '  trigger: ' + JSON.stringify(r.trigger || null),
                    '  status: ' + JSON.stringify(r.status || null),
                    '  metadata: ' + JSON.stringify(r.metadata || null),
                    '  error: ' + JSON.stringify(r.error || null),
                    '  author: ' + (r.author_email || r.author || '?')
                ];
                return lines.join('\n');
            }

            // 模式 B：最近 N 次部署 + 各自详情
            const depResp = await fetchImpl(base + '/deployments?per_page=' + limit, { headers: cfHeaders });
            let depList = [];
            let depErr = null;
            try {
                const d = await depResp.json();
                if (!depResp.ok) depErr = (d.errors && d.errors[0] && d.errors[0].message) || ('HTTP ' + depResp.status);
                else depList = (d.result && d.result.deployments || []).slice(0, limit);
            } catch (e) { depErr = e.message; }
            if (depErr) return 'ERROR: 查询部署列表失败: ' + depErr;

            const out = [];
            for (const dep of depList) {
                const item = {
                    id: (dep.id || '').slice(0, 12),
                    full_id: dep.id || '', // v6.28.1: 完整 UUID（Get Deployment API 要求完整 UUID，截断会 10004）
                    created_on: dep.created_on,
                    source: dep.source,
                    trigger: dep.trigger || null,
                    status: dep.status || null
                };
                try {
                    const dr = await fetchImpl(base + '/deployments/' + encodeURIComponent(dep.id), { headers: cfHeaders });
                    if (dr.ok) {
                        const dj = await dr.json();
                        const det = dj.result || dj;
                        item.detail = { trigger: det.trigger || null, metadata: det.metadata || null, status: det.status || null, error: det.error || null };
                    } else {
                        item.detail_error = 'HTTP ' + dr.status;
                    }
                } catch (e) { item.detail_error = e.message; }
                out.push(item);
            }
            if (includeRaw) return JSON.stringify({ ok: depResp.ok, http: depResp.status, raw: out, note: 'raw response (parsed deployments + details)' }, null, 2);
            return JSON.stringify(out, null, 2);
        }

        // cloudflare_build_logs - 构建日志/构建阶段失败排查（v6.28 新增 · 柳柳要求「查构建日志的通道」）
        else if (name === 'cloudflare_build_logs') {
            const cfToken = env.cloudflare_key || env.CLOUDFLARE_API_TOKEN;
            if (!cfToken) return 'ERROR: Cloudflare token not set (env.cloudflare_key or CLOUDFLARE_API_TOKEN, e.g. cfut_ user token for Builds API)';
            const account = safeArgs.account_id || env.CLOUDFLARE_ACCOUNT_ID || '';
            if (!account) return 'ERROR: CLOUDFLARE_ACCOUNT_ID not set';
            const worker = safeArgs.worker_name || 'mcp-memory';
            const limit = Math.min(10, safeArgs.limit || 3);
            const cfBase = 'https://api.cloudflare.com/client/v4/accounts/' + account;
            const cfHeaders = { 'Authorization': 'Bearer ' + cfToken, 'Content-Type': 'application/json' };
            const includeRaw = safeArgs.include_raw === true || safeArgs.include_raw === 'true';

            // Step 1: 拿 Worker tag（Builds API 用 tag/external_script_id，不用 name）
            const scriptsResp = await fetchImpl(cfBase + '/workers/scripts', { headers: cfHeaders });
            let workerTag = '';
            let scriptsRaw = '';
            try {
                scriptsRaw = await scriptsResp.text();
                const sj = JSON.parse(scriptsRaw);
                if (scriptsResp.ok && Array.isArray(sj.result)) {
                    const found = sj.result.find(x => x.id === worker);
                    if (found && found.tag) workerTag = found.tag;
                }
            } catch (e) { scriptsRaw = scriptsRaw || e.message; }
            if (!workerTag) return 'ERROR: 获取 Worker tag 失败（Builds API 需要 external_script_id）。可能：① token 无 Workers Scripts Read 权限；② Builds API 需要 user-scoped token。HTTP ' + scriptsResp.status + '\nRAW: ' + String(scriptsRaw).slice(0, 800);

            // Step 2: 列构建
            const listResp = await fetchImpl(cfBase + '/builds/workers/' + encodeURIComponent(workerTag) + '/builds?per_page=' + limit, { headers: cfHeaders });
            let builds = [];
            let listErr = null;
            let listRaw = '';
            try {
                listRaw = await listResp.text();
                const lj = JSON.parse(listRaw);
                if (!listResp.ok) listErr = (lj.errors && lj.errors[0] && lj.errors[0].message) || ('HTTP ' + listResp.status);
                else builds = (lj.result || []).slice(0, limit);
            } catch (e) { listErr = e.message; }
            if (listErr) return 'ERROR: 列出构建失败: ' + listErr + '（Builds API 需要 user-scoped token + Workers Builds Configuration Edit 权限）\nHTTP ' + listResp.status + '\nRAW: ' + String(listRaw).slice(0, 800);

            // Step 3: 确定要拉日志的 build_uuid
            let buildUuid = safeArgs.build_uuid || '';
            if (!buildUuid && builds.length > 0) {
                const withErr = builds.find(b => b.status === 'failure' || b.error);
                const chosen = withErr || builds[0];
                buildUuid = chosen.build_uuid || chosen.id || '';
            }

            const summary = builds.map(function (b, i) {
                return '  ' + (i + 1) + '. [' + (b.build_uuid || b.id || '').slice(0, 12) + '] status=' + (b.status || '?') + ' branch=' + (b.branch || '?') + ' created=' + (b.created_at || '?') + (b.error ? ' error=' + JSON.stringify(b.error).slice(0, 200) : '');
            }).join('\n');

            if (includeRaw) return JSON.stringify({ ok: listResp.ok, http: listResp.status, worker_tag: workerTag, builds: builds, note: 'raw builds list' }, null, 2);

            if (!buildUuid) {
                return '📋 Cloudflare 构建列表 (' + worker + ')\n（无构建记录或无法确定 build_uuid）\n' + (summary || '  (empty)') + '\n\n提示：若列表为空，说明 Git 集成未触发过构建，或 Builds API 未覆盖该 Worker。';
            }

            // Step 4: 拉构建日志（尾部 4000 字符）
            const logResp = await fetchImpl(cfBase + '/builds/builds/' + encodeURIComponent(buildUuid) + '/logs', { headers: cfHeaders });
            let logText = '';
            let logErr = null;
            try {
                const lj = await logResp.json();
                if (!logResp.ok) logErr = (lj.errors && lj.errors[0] && lj.errors[0].message) || ('HTTP ' + logResp.status);
                else logText = typeof lj.result === 'string' ? lj.result : JSON.stringify(lj.result || lj, null, 2);
            } catch (e) { logErr = e.message; }
            if (logErr) return 'ERROR: 拉取构建日志失败: ' + logErr;

            const logTail = String(logText).slice(-4000);
            return '📋 Cloudflare 构建日志 (' + worker + ')\nbuild_uuid: ' + buildUuid + '\n最近构建：\n' + (summary || '  (empty)') + '\n\n── 日志（尾部 4000 字符）──\n' + logTail;
        }

        // cloudflare_deploy_status
        else if (name === 'cloudflare_deploy_status') {
            const cfToken = env.cloudflare_key || env.CLOUDFLARE_API_TOKEN;
            if (!cfToken) return 'ERROR: Cloudflare token not set (env.cloudflare_key or CLOUDFLARE_API_TOKEN, e.g. cfut_ user token for Builds API)';
            const account = safeArgs.account_id || env.CLOUDFLARE_ACCOUNT_ID || '';
            if (!account) return 'ERROR: CLOUDFLARE_ACCOUNT_ID not set';
            const worker = safeArgs.worker_name || 'mcp-memory';
            const limit = Math.min(10, safeArgs.limit || 5);
            const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/scripts/' + worker;
            const cfHeaders = { 'Authorization': 'Bearer ' + cfToken, 'Content-Type': 'application/json' };
            const [depRes, verRes] = await Promise.all([
                fetchImpl(base + '/deployments', { headers: cfHeaders }),
                fetchImpl(base + '/versions?per_page=' + limit, { headers: cfHeaders })
            ]);
            let deployments = [], versions = [];
            let depErr = null, verErr = null;
            try {
                const d = await depRes.json();
                if (!depRes.ok) depErr = (d.errors && d.errors[0] && d.errors[0].message) || ('HTTP ' + depRes.status);
                else deployments = (d.result && d.result.deployments || []).slice(0, limit).map(function (x) { return { id: (x.id || '').slice(0, 8), created_on: x.created_on, source: x.source }; });
            } catch (e) { depErr = e.message; }
            try {
                const v = await verRes.json();
                if (!verRes.ok) verErr = (v.errors && v.errors[0] && v.errors[0].message) || ('HTTP ' + verRes.status);
                else versions = (v.result && v.result.items || []).slice(0, limit).map(function (x) { return { id: (x.id || '').slice(0, 8), number: x.number, created_on: x.metadata && x.metadata.created_on, source: x.metadata && x.metadata.source }; });
            } catch (e) { verErr = e.message; }

            const depLine = depErr ? ('Deployments 错误: ' + depErr) : ('Deployments 最近 ' + deployments.length + ' 次:\n' + deployments.map(function (d, i) { return '  ' + (i+1) + '. [' + d.id + '] ' + d.created_on + ' (' + d.source + ')'; }).join('\n'));
            const verLine = verErr ? ('Versions 错误: ' + verErr) : ('Versions 最近 ' + versions.length + ' 个:\n' + versions.map(function (v, i) { return '  ' + (i+1) + '. #' + v.number + ' [' + v.id + '] ' + v.created_on + ' (' + v.source + ')'; }).join('\n'));
            text = '\u2705 Cloudflare 部署状态 (' + worker + '):\n' + depLine + '\n' + verLine;

            // v6.17.0 verify_main: 部署后必查（柳柳铁律）——对比 main HEAD commit vs 最新部署版本
            if (safeArgs.verify_main === true || safeArgs.verify_main === 'true') {
                try {
                    const verifyRepo = safeArgs.repo || env.GITHUB_REPO || 'wovowx/mcp-memory';
                    const ghToken = env.GITHUB_TOKEN || '';
                    const ghVerifyHeaders = { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'User-Agent': 'mcp-memory' };
                    const ghResp = await fetchImpl('https://api.github.com/repos/' + verifyRepo + '/commits/main', { headers: ghVerifyHeaders });
                    const ghData = await ghResp.json();
                    const mainSha = (ghData && ghData.sha) || '';
                    const mainDate = (ghData && ghData.commit && ghData.commit.committer && ghData.commit.committer.date) || '';
                    const latestDep = deployments.length > 0 ? deployments[0] : null;
                    const latestDepDate = latestDep ? latestDep.created_on : '';
                    const deployedOk = latestDepDate && mainDate && (latestDepDate >= mainDate);
                    const verifyStatus = deployedOk ? 'VERIFIED' : 'DEPLOY_UNVERIFIED';
                    text += '\n\n🔍 verify_main (' + verifyRepo + '):\n' +
                        '  main HEAD: ' + mainSha.slice(0, 12) + ' (' + mainDate + ')\n' +
                        '  latest deploy: ' + (latestDep ? '[' + latestDep.id + '] ' + latestDepDate : 'NONE') + '\n' +
                        '  status: ' + verifyStatus + (deployedOk ? ' ✅ main 已上线' : ' ⚠️ main 比最新部署新');

                    // v6.32.9（柳柳 2026-09-09拍板）：DEPLOY_UNVERIFIED → 自动查官方 Builds（Git 集成构建）
                    // 不再依赖本地 node --check（script 模式漏 ESM 错误，v6.32.5-7 教训）；官方构建结果 + 失败日志为准
                    if (deployedOk) return text;

                    const cfBase = 'https://api.cloudflare.com/client/v4/accounts/' + account;
                    const scriptsResp = await fetchImpl(cfBase + '/workers/scripts', { headers: cfHeaders });
                    let workerTag = '';
                    try {
                        const sj = await scriptsResp.json();
                        if (scriptsResp.ok && Array.isArray(sj.result)) {
                            const found = sj.result.find(function (x) { return x.id === worker; });
                            if (found && found.tag) workerTag = found.tag;
                        }
                    } catch (e) { workerTag = ''; }
                    if (!workerTag) { text += '\n\n⚠️ 无法获取 Worker tag（Builds API 需 user-scoped token cfut_）——自动查构建失败 HTTP ' + scriptsResp.status; return text; }

                    const blistResp = await fetchImpl(cfBase + '/builds/workers/' + encodeURIComponent(workerTag) + '/builds?per_page=3', { headers: cfHeaders });
                    let builds = [];
                    try {
                        const lj = await blistResp.json();
                        if (blistResp.ok && Array.isArray(lj.result)) builds = lj.result.slice(0, 3);
                    } catch (e) { builds = []; }
                    if (builds.length === 0) { text += '\n\n⚠️ Git 集成未触发构建（无构建记录）——推 main 后 Cloudflare 没收到 push 事件，检查 Git 集成/分支配置'; return text; }

                    const latestBuild = builds[0];
                    const bMeta = latestBuild.build_trigger_metadata || {};
                    const bStatus = latestBuild.build_outcome || latestBuild.status || '?';
                    const bCommit = (bMeta.commit_hash || '').slice(0, 12);
                    const bMsg = (bMeta.commit_message || '').slice(0, 60);
                    text += '\n\n🏗️ Cloudflare Build（Git 集成自动部署 push→main 触发）:\n' +
                        '  构建 ' + String(latestBuild.build_uuid || '').slice(0, 12) + ' @ ' + (latestBuild.created_on || '?') + '\n' +
                        '  commit: ' + bCommit + ' | ' + bMsg + '\n' +
                        '  outcome: ' + bStatus;
                    if (bStatus === 'success') {
                        text += '\n  ✅ 构建成功——部署记录若仍滞后，可能还在传播（等 30-60s 重跑 verify_main）';
                        return text;
                    }

                    const logResp = await fetchImpl(cfBase + '/builds/builds/' + encodeURIComponent(latestBuild.build_uuid) + '/logs', { headers: cfHeaders });
                    let logText = '';
                    try {
                        const lj = await logResp.json();
                        if (logResp.ok && lj.result && Array.isArray(lj.result.lines)) {
                            logText = lj.result.lines.map(function (L) { return L[1]; }).join('\n');
                        } else if (logResp.ok) {
                            logText = JSON.stringify(lj.result || lj).slice(0, 2000);
                        }
                    } catch (e) { logText = ''; }
                    const logTailData = String(logText).slice(-2500);
                    text += '\n  ❌ 构建失败（' + (logResp.ok ? '日志尾部' : 'HTTP ' + logResp.status) + '）:\n' + logTailData;
                    return text;
                } catch (e) {
                    text += '\n\n🔍 verify_main 错误: ' + e.message;
                }
            }
        }
    } catch (e) {
        return 'ERROR: ' + (e?.message || String(e));
    }
    return text;
}
