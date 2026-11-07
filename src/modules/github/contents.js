// GitHub Contents domain: reusable API primitives + scenario workflows.
// The MCP facade owns tool schemas, registry integration, routing and release guards.
function apiBase(repo) { return 'https://api.github.com/repos/' + repo; }
function normalizeBase64(value) { return String(value || '').replace(/\s+/g, ''); }
function errorMessage(payload, status) { return (payload && payload.message) || ('HTTP ' + status); }

async function responsePayload(response) {
    try { return await response.json(); } catch { return {}; }
}
function pathPolicy(ctx, path, allowRoot = false) {
    return ctx.validateRepoRelativePath(path, { allowRoot });
}
function assertAllowedRepo(ctx, repo) {
    const normalized = String(repo || '').trim();
    const allowed = String(ctx.env.GITHUB_ALLOWED_REPOS || '').split(',').map(v => v.trim()).filter(Boolean);
    if (normalized !== ctx.env.GITHUB_REPO && !allowed.includes(normalized)) {
        return { ok: false, code: 'REPOSITORY_NOT_ALLOWED', message: 'Repository not allowed: ' + normalized };
    }
    return { ok: true };
}
function assertWritableBranch(branch) {
    if (String(branch || '').toLowerCase() === 'main') {
        return { ok: false, code: 'MAIN_WRITE_BLOCKED', message: '非发布 GitHub 写入不得修改 main；请写入 dev 并按发布流程合并。' };
    }
    return { ok: true };
}
async function requestJson(ctx, url, options = {}) {
    let response;
    try { response = await ctx.fetchImpl.call(globalThis, url, { headers: ctx.headers, ...options }); }
    catch (error) {
        return { ok: false, status: 0, code: 'NETWORK_ERROR', message: error?.message || String(error) };
    }
    const payload = await responsePayload(response);
    if (!response.ok) {
        return {
            ok: false, status: response.status,
            code: response.status === 404 ? 'NOT_FOUND' : 'GITHUB_API_ERROR',
            message: errorMessage(payload, response.status), payload
        };
    }
    return { ok: true, status: response.status, data: payload };
}
function contentUrl(repo, encodedPath, branch) {
    return apiBase(repo) + '/contents' + (encodedPath ? '/' + encodedPath : '/') + '?ref=' + encodeURIComponent(branch);
}

// -------------------- Reusable primitives --------------------
export async function getContent(ctx, { repo, path, branch = 'main' }) {
    const checked = pathPolicy(ctx, path);
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.reason };
    const result = await requestJson(ctx, contentUrl(repo, checked.encodedPath, branch));
    return result.ok ? { ok: true, data: result.data, status: result.status } : result;
}
export async function listContents(ctx, { repo, path = '', branch = 'main' }) {
    const checked = pathPolicy(ctx, path, true);
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.reason };
    const result = await requestJson(ctx, contentUrl(repo, checked.encodedPath, branch));
    if (!result.ok) return result;
    return { ok: true, items: Array.isArray(result.data) ? result.data : [result.data], status: result.status };
}
export async function getTree(ctx, { repo, ref = 'main', recursive = true }) {
    const result = await requestJson(
        ctx,
        apiBase(repo) + '/git/trees/' + encodeURIComponent(ref) + (recursive ? '?recursive=1' : '')
    );
    if (!result.ok) return result;
    return {
        ok: true, sha: result.data.sha || null,
        tree: Array.isArray(result.data.tree) ? result.data.tree : [],
        truncated: result.data.truncated === true
    };
}
export async function putContent(ctx, { repo, path, branch = 'dev', message, contentBase64, sha = null }) {
    const checked = pathPolicy(ctx, path);
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.reason };
    const writable = assertWritableBranch(branch);
    if (!writable.ok) return writable;
    const body = { message: message || ('Update ' + path), content: normalizeBase64(contentBase64), branch };
    if (sha) body.sha = sha;
    const result = await requestJson(ctx, apiBase(repo) + '/contents/' + checked.encodedPath, {
        method: 'PUT', body: JSON.stringify(body)
    });
    if (!result.ok) return result;
    return {
        ok: true, data: result.data,
        commitSha: result.data.commit?.sha || null,
        contentSha: result.data.content?.sha || null
    };
}
export async function deleteContent(ctx, { repo, path, branch = 'dev', sha, message }) {
    const checked = pathPolicy(ctx, path);
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.reason };
    const writable = assertWritableBranch(branch);
    if (!writable.ok) return writable;
    if (!sha) return { ok: false, code: 'MISSING_BLOB_SHA', message: '删除操作缺少当前文件 blob SHA。' };
    const result = await requestJson(ctx, apiBase(repo) + '/contents/' + checked.encodedPath, {
        method: 'DELETE',
        body: JSON.stringify({ message: message || ('Delete ' + path), sha, branch })
    });
    if (!result.ok) return result;
    return { ok: true, commitSha: result.data.commit?.sha || null };
}
export async function verifyContent(ctx, { repo, path, branch = 'dev', expectedSha = null, expectedContent = undefined }) {
    const read = await getContent(ctx, { repo, path, branch });
    if (!read.ok) return { ok: false, code: 'VERIFY_READ_FAILED', message: read.message, status: read.status };
    const data = read.data;
    if (expectedSha && data.sha !== expectedSha) {
        return { ok: false, code: 'VERIFY_SHA_MISMATCH', message: '回读 blob SHA 与写入响应不一致。', expectedSha, actualSha: data.sha || null, data };
    }
    if (expectedContent !== undefined) {
        if (typeof data.content !== 'string') return { ok: false, code: 'VERIFY_CONTENT_MISSING', message: '回读响应没有 content 字段。', data };
        let actual;
        try { actual = ctx.base64ToUtf8(normalizeBase64(data.content)); }
        catch (error) { return { ok: false, code: 'VERIFY_DECODE_FAILED', message: error?.message || String(error), data }; }
        if (actual !== expectedContent) return { ok: false, code: 'VERIFY_CONTENT_MISMATCH', message: '回读内容与预期内容不一致。', data };
    }
    return { ok: true, data, sha: data.sha || null, size: data.size ?? null };
}

async function verifyContentWithRetry(ctx, input, attempts = 3) {
    let lastResult = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        lastResult = await verifyContent(ctx, input);
        if (lastResult.ok) return lastResult;
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
    return lastResult || { ok: false, code: 'VERIFY_FAILED', message: '内容验证失败。' };
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}
function errorResult(code, message, extra = {}) { return { ok: false, code, message, ...extra }; }
function partialWrite(code, message, extra = {}) {
    return { ok: false, partial: true, written: true, code, message, ...extra };
}

// -------------------- Scenario workflows --------------------
export async function pushFileFromStorage(ctx, args) {
    const path = String(args.path || '');
    const branch = args.branch || 'dev';
    const message = args.message || ('Create ' + path);
    const writable = assertWritableBranch(branch);
    if (!writable.ok) return writable;
    if (!path || !args.content_url) return errorResult('MISSING_ARGUMENT', 'github_push requires path and content_url.');
    const repo = String(args.repo || ctx.repo).trim();
    const allowed = assertAllowedRepo(ctx, repo);
    if (!allowed.ok) return allowed;
    const checked = pathPolicy(ctx, path);
    if (!checked.ok) return errorResult(checked.code, checked.reason);

    let uploadUrl;
    try { uploadUrl = new URL(args.content_url); }
    catch { return errorResult('INVALID_CONTENT_URL', 'content_url 不是有效 URL。'); }
    let configuredOrigin = '';
    try { configuredOrigin = new URL(ctx.env.SUPABASE_URL || '').origin; } catch { configuredOrigin = ''; }
    if (
        uploadUrl.protocol !== 'https:' || !configuredOrigin || uploadUrl.origin !== configuredOrigin ||
        uploadUrl.username || uploadUrl.password ||
        !uploadUrl.pathname.startsWith('/storage/v1/object/public/files/')
    ) {
        return errorResult('INVALID_CONTENT_URL', 'content_url must use the exact configured SUPABASE_URL origin and /storage/v1/object/public/files/ path.');
    }

    let bytes;
    try {
        const response = await ctx.fetchImpl.call(globalThis, args.content_url, {
            headers: { 'User-Agent': 'ziven-mcp' }, redirect: 'error'
        });
        if (!response.ok) return errorResult('CONTENT_FETCH_FAILED', 'content_url fetch failed - HTTP ' + response.status);
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
        return errorResult('CONTENT_FETCH_FAILED', error?.message || String(error));
    }

    const existing = await getContent(ctx, { repo, path, branch });
    if (existing.ok) return errorResult('GITHUB_PUSH_EXISTING_FILE', path + ' already exists on ' + branch + '; use github_edit to modify it.');
    if (existing.status !== 404) {
        return errorResult('DESTINATION_CHECK_FAILED', existing.message || '无法确认目标文件是否存在。', { status: existing.status });
    }

    const written = await putContent(ctx, {
        repo, path, branch, message, contentBase64: bytesToBase64(bytes)
    });
    if (!written.ok) return errorResult(written.code || 'WRITE_FAILED', written.message, { status: written.status });
    const verified = await verifyContentWithRetry(ctx, { repo, path, branch, expectedSha: written.contentSha });
    if (!verified.ok || verified.size !== bytes.byteLength) {
        return partialWrite('WRITE_VERIFY_FAILED', '文件已写入，但完整性验证未通过或未能确认。', {
            path, branch, expectedBytes: bytes.byteLength, actualBytes: verified.size ?? null,
            verifyCode: verified.code || null, verifyMessage: verified.message || null,
            commitSha: written.commitSha
        });
    }
    return {
        ok: true, path, branch, repo, message, size: verified.size,
        url: written.data.content?.html_url || null,
        commitSha: written.commitSha, blobSha: written.contentSha
    };
}

export async function editFileByAnchors(ctx, args) {
    const path = String(args.path || '');
    const branch = args.branch || 'dev';
    const writable = assertWritableBranch(branch);
    if (!writable.ok) return writable;
    if (!path || !Array.isArray(args.operations) || !args.operations.length) {
        return errorResult('MISSING_ARGUMENT', 'github_edit requires path and a non-empty operations array.');
    }
    const repo = String(args.repo || ctx.repo).trim();
    const allowed = assertAllowedRepo(ctx, repo);
    if (!allowed.ok) return allowed;
    const checkedPath = pathPolicy(ctx, path);
    if (!checkedPath.ok) return errorResult(checkedPath.code, checkedPath.reason);
    const read = await getContent(ctx, { repo, path, branch });
    if (!read.ok) return errorResult(read.code === 'NOT_FOUND' ? 'FILE_NOT_FOUND' : 'READ_FAILED', read.message, { status: read.status });
    if (typeof read.data.content !== 'string') return errorResult('READ_NO_CONTENT', 'GitHub response has no file content.');
    let content;
    try { content = ctx.base64ToUtf8(normalizeBase64(read.data.content)); }
    catch (error) { return errorResult('READ_DECODE_FAILED', error?.message || String(error)); }

    const details = [];
    for (let index = 0; index < args.operations.length; index++) {
        const operation = args.operations[index];
        if (!operation || typeof operation.old !== 'string' || typeof operation.new !== 'string' || !operation.old.length) {
            return errorResult('INVALID_OPERATION', 'Each operation must contain a non-empty old string and a new string.');
        }
        const count = content.split(operation.old).length - 1;
        if (!count) {
            const hint = ctx.findSimilarCandidates ? ctx.findSimilarCandidates(content, operation.old) : '';
            return errorResult('ANCHOR_NOT_FOUND', 'op #' + (index + 1) + ': ' + operation.old.slice(0, 80) + (hint ? '\n候选提示：\n' + hint : ''));
        }
        if (count > 1) return errorResult('ANCHOR_AMBIGUOUS', 'op #' + (index + 1) + ' matched ' + count + ' times.');
        content = content.replace(operation.old, operation.new);
        details.push('op#' + (index + 1) + ': ' + operation.old.slice(0, 40) + '… → ' + operation.new.slice(0, 40) + '…');
    }
    if (args.dry_run === true) return { ok: true, dryRun: true, path, branch, details, resultingCharacters: content.length };

    const written = await putContent(ctx, {
        repo, path, branch, message: args.message || ('Update ' + path),
        contentBase64: ctx.utf8ToBase64(content), sha: read.data.sha
    });
    if (!written.ok) return errorResult(written.code || 'WRITE_FAILED', written.message, { status: written.status });
    const verified = await verifyContentWithRetry(ctx, {
        repo, path, branch, expectedSha: written.contentSha, expectedContent: content
    });
    if (!verified.ok) {
        return partialWrite('EDIT_VERIFY_FAILED', '文件已写入，但回读验证未通过或未能确认。', {
            path, branch, details, commitSha: written.commitSha,
            verifyCode: verified.code, verifyMessage: verified.message
        });
    }
    return { ok: true, path, branch, details, verified: true, url: written.data.content?.html_url || null, commitSha: written.commitSha, blobSha: written.contentSha };
}

export async function deleteFile(ctx, args) {
    const path = String(args.path || '');
    const branch = args.branch || 'dev';
    const writable = assertWritableBranch(branch);
    if (!writable.ok) return writable;
    if (!path) return errorResult('MISSING_PATH', 'github_delete requires path.');
    const repo = String(args.repo || ctx.repo).trim();
    const allowed = assertAllowedRepo(ctx, repo);
    if (!allowed.ok) return allowed;
    const checkedPath = pathPolicy(ctx, path);
    if (!checkedPath.ok) return errorResult(checkedPath.code, checkedPath.reason);
    const read = await getContent(ctx, { repo, path, branch });
    if (!read.ok) return errorResult(read.code === 'NOT_FOUND' ? 'FILE_NOT_FOUND' : 'READ_FAILED', read.message, { status: read.status });
    const deleted = await deleteContent(ctx, {
        repo, path, branch, sha: read.data.sha,
        message: args.message || ('Delete ' + path)
    });
    if (!deleted.ok) return errorResult('DELETE_FAILED', deleted.message, { status: deleted.status });
    return { ok: true, path, branch, repo, commitSha: deleted.commitSha };
}

export async function copyFile(ctx, args) {
    const sourceRepo = String(args.source_repo || '').trim();
    const sourceBranch = args.source_branch || 'main';
    const sourcePath = String(args.source_path || '');
    const targetRepo = String(args.target_repo || '').trim();
    const targetBranch = args.target_branch || 'dev';
    const targetPath = String(args.target_path || '');
    if (!sourceRepo || !sourcePath || !targetRepo || !targetPath) return errorResult('MISSING_ARGUMENT', 'github_copy requires source_repo, source_path, target_repo and target_path.');
    const sourceAllowed = assertAllowedRepo(ctx, sourceRepo);
    if (!sourceAllowed.ok) return sourceAllowed;
    const targetAllowed = assertAllowedRepo(ctx, targetRepo);
    if (!targetAllowed.ok) return targetAllowed;
    const writable = assertWritableBranch(targetBranch);
    if (!writable.ok) return writable;
    const sourceChecked = pathPolicy(ctx, sourcePath);
    if (!sourceChecked.ok) return errorResult(sourceChecked.code, sourceChecked.reason);
    const targetChecked = pathPolicy(ctx, targetPath);
    if (!targetChecked.ok) return errorResult(targetChecked.code, targetChecked.reason);
    if (sourceRepo === targetRepo && sourceBranch === targetBranch && sourcePath === targetPath) return errorResult('SOURCE_IS_TARGET', 'source and target are the same file.');

    const source = await getContent(ctx, { repo: sourceRepo, path: sourcePath, branch: sourceBranch });
    if (!source.ok) return errorResult(source.code === 'NOT_FOUND' ? 'SOURCE_NOT_FOUND' : 'SOURCE_READ_FAILED', source.message, { status: source.status });
    if (typeof source.data.content !== 'string' || !source.data.sha) return errorResult('SOURCE_CONTENT_UNAVAILABLE', '源文件缺少可复制的内容或 blob SHA。');

    const target = await getContent(ctx, { repo: targetRepo, path: targetPath, branch: targetBranch });
    let targetSha = null;
    let overwritten = false;
    if (target.ok) {
        if (args.overwrite !== true) return errorResult('TARGET_EXISTS', targetPath + ' already exists; set overwrite=true to replace it.');
        targetSha = target.data.sha;
        overwritten = true;
    } else if (target.status !== 404) {
        return errorResult('TARGET_CHECK_FAILED', target.message, { status: target.status });
    }

    const written = await putContent(ctx, {
        repo: targetRepo, path: targetPath, branch: targetBranch,
        message: args.message || ('Copy ' + sourcePath + ' → ' + targetPath),
        contentBase64: normalizeBase64(source.data.content), sha: targetSha
    });
    if (!written.ok) return errorResult('TARGET_WRITE_FAILED', written.message, { status: written.status });
    const verified = await verifyContentWithRetry(ctx, {
        repo: targetRepo, path: targetPath, branch: targetBranch,
        expectedSha: written.contentSha || source.data.sha
    });
    if (!verified.ok || verified.sha !== source.data.sha) {
        return partialWrite('COPY_VERIFY_FAILED', '目标文件已写入，但 blob SHA 验证不一致或未能确认；源文件未改动。', {
            source: { repo: sourceRepo, branch: sourceBranch, path: sourcePath, sha: source.data.sha },
            target: { repo: targetRepo, branch: targetBranch, path: targetPath, sha: verified.sha || null },
            verifyCode: verified.code || null, overwritten
        });
    }
    return {
        ok: true, sourceRepo, sourceBranch, sourcePath, sourceSha: source.data.sha,
        targetRepo, targetBranch, targetPath, targetSha: verified.sha,
        sourceSize: source.data.size ?? null, size: verified.size,
        commitSha: written.commitSha, overwritten, verified: true
    };
}

async function collectDirectoryFiles(ctx, repo, branch, rootPath) {
    const tree = await getTree(ctx, { repo, ref: branch, recursive: true });
    if (tree.ok && !tree.truncated) {
        const prefix = rootPath + '/';
        const files = tree.tree.filter(item => item.type === 'blob' && item.path.startsWith(prefix))
            .map(item => ({ abs: item.path, rel: item.path.slice(prefix.length) }));
        return { ok: true, files, source: 'recursive-tree' };
    }

    // A truncated recursive tree is never treated as a complete move plan.
    // Contents traversal is a conservative fallback; ambiguous listings abort before writes.
    const files = [];
    const visited = new Set();
    const walk = async directoryPath => {
        if (visited.has(directoryPath)) return { ok: false, code: 'TREE_CYCLE', message: '重复目录路径：' + directoryPath };
        visited.add(directoryPath);
        const listing = await listContents(ctx, { repo, path: directoryPath, branch });
        if (!listing.ok) return { ok: false, code: 'TREE_FALLBACK_FAILED', message: listing.message, status: listing.status };
        if (listing.items.length >= 1000) return { ok: false, code: 'TREE_FALLBACK_AMBIGUOUS', message: '目录条目达到 Contents API 单次上限，无法证明枚举完整：' + directoryPath };
        for (const item of listing.items) {
            if (item.type === 'dir') {
                const nested = await walk(item.path);
                if (!nested.ok) return nested;
            } else if (item.type === 'file') {
                const relative = item.path.startsWith(rootPath + '/') ? item.path.slice(rootPath.length + 1) : '';
                if (!relative) return { ok: false, code: 'INVALID_TREE_PATH', message: '无法计算目录相对路径：' + item.path };
                files.push({ abs: item.path, rel: relative });
                if (files.length > 10000) return { ok: false, code: 'MOVE_FILE_LIMIT', message: '待移动文件超过安全上限 10000。' };
            }
        }
        return { ok: true };
    };
    const fallback = await walk(rootPath);
    if (!fallback.ok) return fallback;
    return { ok: true, files, source: 'contents-fallback' };
}

export async function movePath(ctx, args) {
    const sourceRepo = String(args.source_repo || '').trim();
    const sourceBranch = args.source_branch || 'dev';
    const sourcePath = String(args.source_path || '');
    const targetRepo = String(args.target_repo || '').trim();
    const targetBranch = args.target_branch || 'dev';
    const targetPath = String(args.target_path || '');
    if (!sourceRepo || !sourcePath || !targetRepo || !targetPath) return errorResult('MISSING_ARGUMENT', 'github_move requires source_repo, source_path, target_repo and target_path.');
    const sourceAllowed = assertAllowedRepo(ctx, sourceRepo);
    if (!sourceAllowed.ok) return sourceAllowed;
    const targetAllowed = assertAllowedRepo(ctx, targetRepo);
    if (!targetAllowed.ok) return targetAllowed;
    const sourceWritable = assertWritableBranch(sourceBranch);
    if (!sourceWritable.ok) return errorResult('SOURCE_MAIN_DELETE_BLOCKED', sourceWritable.message);
    const targetWritable = assertWritableBranch(targetBranch);
    if (!targetWritable.ok) return targetWritable;
    const sourceChecked = pathPolicy(ctx, sourcePath);
    if (!sourceChecked.ok) return errorResult(sourceChecked.code, sourceChecked.reason);
    const targetChecked = pathPolicy(ctx, targetPath);
    if (!targetChecked.ok) return errorResult(targetChecked.code, targetChecked.reason);
    if (sourceRepo === targetRepo && sourceBranch === targetBranch && (
        targetPath.startsWith(sourcePath + '/') || sourcePath.startsWith(targetPath + '/')
    )) return errorResult('SOURCE_TARGET_OVERLAP', '源路径与目标路径存在父子重叠；拒绝执行移动。');

    const sourceCheck = await getContent(ctx, { repo: sourceRepo, path: sourcePath, branch: sourceBranch });
    if (!sourceCheck.ok) return errorResult(sourceCheck.code === 'NOT_FOUND' ? 'SOURCE_NOT_FOUND' : 'SOURCE_CHECK_FAILED', sourceCheck.message, { status: sourceCheck.status });
    if (sourceRepo === targetRepo && sourceBranch === targetBranch && sourcePath === targetPath) {
        return errorResult('SOURCE_TARGET_IDENTICAL', 'source and target resolve to the same repository path.');
    }
    const isDirectory = Array.isArray(sourceCheck.data);
    let plan;
    let enumerationSource = 'single-file';
    if (isDirectory) {
        if (args.recursive === false) return errorResult('DIRECTORY_WITHOUT_RECURSIVE', sourcePath + ' is a directory; recursive=true is required.');
        const collected = await collectDirectoryFiles(ctx, sourceRepo, sourceBranch, sourcePath);
        if (!collected.ok) return errorResult(collected.code, collected.message, { status: collected.status });
        if (!collected.files.length) return errorResult('EMPTY_DIRECTORY', 'no files found under ' + sourcePath);
        enumerationSource = collected.source;
        plan = collected.files.map(file => ({ abs: file.abs, rel: file.rel, targetAbs: targetPath + '/' + file.rel }));
    } else {
        plan = [{ abs: sourcePath, rel: sourcePath.split('/').pop(), targetAbs: targetPath }];
    }

    const targetPaths = new Set();
    for (const item of plan) {
        const sourcePolicy = pathPolicy(ctx, item.abs);
        const targetPolicy = pathPolicy(ctx, item.targetAbs);
        if (!sourcePolicy.ok || !targetPolicy.ok) return errorResult('INVALID_MOVE_PLAN_PATH', sourcePolicy.reason || targetPolicy.reason);
        item.encodedAbs = sourcePolicy.encodedPath;
        item.encodedTargetAbs = targetPolicy.encodedPath;
        if (targetPaths.has(item.targetAbs)) return errorResult('DUPLICATE_MOVE_TARGET', '多个源文件映射到同一目标路径：' + item.targetAbs);
        targetPaths.add(item.targetAbs);
        if (sourceRepo === targetRepo && sourceBranch === targetBranch && item.abs === item.targetAbs) {
            return errorResult('SOURCE_TARGET_IDENTICAL', 'source and target resolve to the same repository path.');
        }
    }

    const copied = [];
    let copyFailure = null;
    for (const item of plan) {
        const result = await copyFile(ctx, {
            source_repo: sourceRepo, source_branch: sourceBranch, source_path: item.abs,
            target_repo: targetRepo, target_branch: targetBranch, target_path: item.targetAbs,
            overwrite: args.overwrite === true,
            message: args.message || ('Move ' + sourcePath + ' → ' + targetPath)
        });
        if (!result.ok) {
            copyFailure = { source: item.abs, target: item.targetAbs, code: result.code, message: result.message, partial: result.partial === true, targetWritten: result.written === true, verifyCode: result.verifyCode || null, verifyMessage: result.verifyMessage || null };
            break;
        }
        copied.push({
            source: item.abs, target: item.targetAbs, sourceSha: result.sourceSha,
            targetSha: result.targetSha, size: result.size, overwritten: result.overwritten
        });
    }
    if (copyFailure) {
        return {
            ok: false, partial: copied.length > 0 || copyFailure.partial === true,
            code: 'MOVE_COPY_FAILED', message: '目标复制阶段失败；没有删除任何源文件。',
            copied, failed: copyFailure,
            targetsWritten: copied.map(item => item.target).concat(copyFailure.targetWritten ? [copyFailure.target] : []),
            targetVerificationUnconfirmed: copyFailure.targetWritten,
            sourcesDeleted: [], sourcesRemaining: plan.map(item => item.abs)
        };
    }

    // Re-read every source before deleting any of them. One mutation preserves all source files.
    const changed = [];
    for (const item of copied) {
        const current = await getContent(ctx, { repo: sourceRepo, path: item.source, branch: sourceBranch });
        if (!current.ok || current.data.sha !== item.sourceSha) {
            changed.push({
                path: item.source, expectedSha: item.sourceSha, actualSha: current.data?.sha || null,
                reason: current.message || 'SOURCE_CHANGED_AFTER_COPY'
            });
        }
    }
    if (changed.length) {
        return {
            ok: false, partial: true, code: 'SOURCE_CHANGED_AFTER_COPY',
            message: '目标文件已全部复制并验证，但发现源文件在复制后发生变化；为避免删除新内容，本次没有删除任何源文件。',
            copied, changed, sourcesDeleted: [], sourcesRemaining: plan.map(item => item.abs)
        };
    }

    const deleted = [];
    for (let index = 0; index < copied.length; index++) {
        const item = copied[index];
        const deletion = await deleteContent(ctx, {
            repo: sourceRepo, path: item.source, branch: sourceBranch, sha: item.sourceSha,
            message: args.message || ('Move ' + sourcePath + ' → ' + targetPath)
        });
        if (!deletion.ok) {
            return {
                ok: false, partial: true, code: 'MOVE_DELETE_PARTIAL',
                message: '目标文件均已复制并验证，但源删除中途失败；没有继续删除后续源文件。',
                copied, sourcesDeleted: deleted,
                sourcesRemaining: copied.slice(index).map(entry => entry.source),
                failed: { path: item.source, code: deletion.code, message: deletion.message }
            };
        }
        deleted.push(item.source);
    }
    return {
        ok: true, moved: plan.length, isDirectory, enumerationSource,
        sourceRepo, sourceBranch, sourcePath, targetRepo, targetBranch, targetPath,
        verifiedAll: true,
        files: copied.map(item => ({ source: item.source, target: item.target, sha: item.sourceSha, size: item.size }))
    };
}

export function formatContentsResult(name, result) {
    if (result?.dryRun) {
        return 'DRY_RUN (' + result.branch + '/' + result.path + '):\n' +
            result.details.join('\n') + '\n' + result.resultingCharacters + ' characters after edit';
    }
    if (result?.ok) {
        if (name === 'github_push') {
            return 'OK: File pushed to GitHub\nPath: ' + result.path + '\nMsg: ' + result.message + '\nURL: ' + (result.url || 'pushed') + '\nVerified: true\nFile size: ' + result.size + ' bytes';
        }
        if (name === 'github_edit') {
            return 'OK: github_edit (' + result.branch + '/' + result.path + '):\n' +
                result.details.join('\n') + '\nVerified: true\nURL: ' + (result.url || '');
        }
        if (name === 'github_delete') return 'DELETED: ' + result.path;
        if (name === 'github_copy') {
            return JSON.stringify({
                success: true, verified: true,
                source_repo: result.sourceRepo, source_branch: result.sourceBranch,
                source_path: result.sourcePath, source_size: result.sourceSize,
                target_repo: result.targetRepo, target_branch: result.targetBranch,
                target_path: result.targetPath, target_size: result.size,
                file_sha: result.sourceSha, commit_sha: result.commitSha,
                overwritten: result.overwritten
            }, null, 2);
        }
        if (name === 'github_move') {
            return JSON.stringify({
                success: true, moved: result.moved, is_dir: result.isDirectory,
                source_repo: result.sourceRepo, source_branch: result.sourceBranch,
                source_path: result.sourcePath, target_repo: result.targetRepo,
                target_branch: result.targetBranch, target_path: result.targetPath,
                verified_all: result.verifiedAll,
                files: result.files.map(file => ({ source: file.source, target: file.target }))
            }, null, 2);
        }
        return JSON.stringify(result, null, 2);
    }
    const prefix = 'ERROR: ' + (result?.code || 'CONTENTS_ERROR') + ' - ' + (result?.message || 'Unknown error');
    if (!result?.partial) return prefix;
    return prefix + '\n' + JSON.stringify({
        written: result.written === true, source: result.source || null, target: result.target || null,
        copied: result.copied || [], changed: result.changed || [],
        targetsWritten: result.targetsWritten || [], targetVerificationUnconfirmed: result.targetVerificationUnconfirmed === true,
        sourcesDeleted: result.sourcesDeleted || [], sourcesRemaining: result.sourcesRemaining || [],
        failed: result.failed || null, verifyCode: result.verifyCode || null, verifyMessage: result.verifyMessage || null
    }, null, 2);
}
