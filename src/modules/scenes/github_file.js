// One-book scene: create a new UTF-8 GitHub file from text without an upload.
// Reuses the existing Contents primitives; does not create a second GitHub client.
import { assertAllowedRepo, getContent, putContent, verifyContentWithRetry } from '../github/contents.js';

export const MAX_DIRECT_FILE_BYTES = 64 * 1024;

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * Strictly create-only; never overwrite a user file. The GitHub PUT uses no
 * existing blob SHA, so a concurrent create is rejected instead of replaced.
 * A failed read-back after writing is explicitly PARTIAL, not "completed".
 */
export async function createGithubTextFile(ctx, args = {}) {
    const repo = typeof args.repo === 'string' && args.repo.trim() ? args.repo.trim() : ctx.repo;
    const branch = args.branch === undefined ? 'dev' : args.branch;
    const path = args.path;
    if (branch !== 'dev') return failure('BRANCH_NOT_ALLOWED', '直接文本创建仅允许 dev；main 与其它分支不在本场景授权内。');
    const allowedRepo = assertAllowedRepo(ctx, repo);
    if (!allowedRepo.ok) return failure(allowedRepo.code, allowedRepo.message);
    const checkedPath = ctx.validateRepoRelativePath(path);
    if (!checkedPath.ok) return failure(checkedPath.code, checkedPath.reason);
    if (typeof args.content !== 'string') return failure('CONTENT_REQUIRED', 'content 必须是原始 UTF-8 文本，允许空字符串。');
    const size = new TextEncoder().encode(args.content).byteLength;
    if (size > MAX_DIRECT_FILE_BYTES) {
        return failure('CONTENT_TOO_LARGE', '文本超过 64 KiB，请改用已有上传→github_push 路径。');
    }
    if (args.dry_run !== undefined && typeof args.dry_run !== 'boolean') {
        return failure('INVALID_DRY_RUN', 'dry_run 必须是布尔值。');
    }

    const existing = await getContent(ctx, { repo, branch, path });
    if (existing.ok) return failure('TARGET_EXISTS', '目标文件已存在，创建场景绝不覆盖：' + path);
    if (existing.status !== 404) {
        return failure('TARGET_CHECK_FAILED', existing.message || '目标状态未知，禁止尝试写入。', { status: existing.status });
    }
    if (args.dry_run === true) return { ok: true, dryRun: true, repo, branch, path, size };

    const write = await putContent(ctx, {
        repo, branch, path, message: args.message || ('Create ' + path),
        contentBase64: ctx.utf8ToBase64(args.content)
    });
    if (!write.ok) return failure('CREATE_WRITE_FAILED', write.message || 'GitHub 拒绝创建。', { status: write.status });

    const verified = await verifyContentWithRetry(ctx, {
        repo, branch, path,
        expectedSha: write.contentSha || null,
        expectedContent: args.content
    });
    if (!verified.ok) {
        return failure('CREATE_VERIFY_FAILED', '已收到写入成功响应，但无法确认文件内容完全一致；切勿盲目重试覆盖。', {
            partial: true, written: true,
            target: { repo, branch, path, commitSha: write.commitSha || null },
            verifyCode: verified.code || null, verifyMessage: verified.message || null
        });
    }
    return { ok: true, repo, branch, path, size: verified.size ?? size,
        commitSha: write.commitSha || null, verified: true };
}
