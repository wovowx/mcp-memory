// ============================================================
// permission_guard.js - 写入权限闸门（Permission Guard）v1.0.0
// ============================================================
// 作用：把「写入边界」从软约束（靠自觉）变成硬约束（系统拦截）。
// 设计（GPT #731/#733 讨论收敛 + 柳柳拍板 2026-09-05）：
//   checkCapabilityAccess({agent, capability, target, context, decision, evidence})

const CAPABILITY_POLICY = {
    github_read: { enabled: true, write: false, require_proposal: false },
    supabase_read: { enabled: true, write: false, require_proposal: false },
    ds_quota: { enabled: true, write: false, require_proposal: false },
    context_read: { enabled: true, write: false, require_proposal: false },
    context_update: { enabled: true, write: false, require_proposal: false },
    github_push: { enabled: true, write: true, require_proposal: true },
    github_merge: { enabled: true, write: true, require_proposal: true },
};

const RISK_APPROVAL = {
    low: ['proposal'],
    medium: ['proposal', 'review'],
    high: ['proposal', 'review', 'liuliu'],
};

export function checkCapabilityAccess({ agent, capability, target, context, decision, evidence, risk = 'low' }) {
    const checked = { agent, capability, target, risk, decision_proposal_id: decision?.proposal_id ?? null };

    const cap = CAPABILITY_POLICY[capability];
    if (!cap) return { allowed: false, reason: 'unknown_capability', expected: '能力未配置', requiredApproval: [], checked };
    if (!cap.enabled) return { allowed: false, reason: 'capability_disabled', expected: '该能力已禁用', requiredApproval: [], checked };
    if (cap.write && !cap.require_proposal) return { allowed: false, reason: 'write_without_proposal_guard', expected: 'write 能力必须配置 require_proposal:true', requiredApproval: [], checked };

    if (!cap.write) return { allowed: true, reason: 'read_allowed', requiredApproval: [], checked };

    const branch = target?.branch || '';
    if (branch === 'main') return { allowed: false, reason: 'main_branch_forbidden', expected: '禁止写 main（release_guard 强制版本化）', requiredApproval: ['release_guard'], checked };
    if (branch !== 'dev') return { allowed: false, reason: 'non_dev_branch_forbidden', expected: 'MVP 只允许写 dev 分支', requiredApproval: [], checked };

    if (cap.require_proposal) {
        const status = decision?.proposal_status;
        if (!decision?.proposal_id) return { allowed: false, reason: 'missing_proposal', expected: 'write 必须关联 patch_proposals 记录（proposal_id）', requiredApproval: ['proposal'], checked };
        if (status !== 'approved') return { allowed: false, reason: 'proposal_not_approved', expected: 'proposal 必须是 approved 状态才能执行写入', requiredApproval: ['proposal', 'review'], checked };
    }

    const needed = RISK_APPROVAL[risk] || RISK_APPROVAL.low;
    if (risk === 'medium' || risk === 'high') {
        if (!decision?.reviewed_by) return { allowed: false, reason: 'missing_review', expected: risk + ' 风险需要技术 review（reviewed_by）', requiredApproval: needed, checked };
    }
    if (risk === 'high') {
        if (!decision?.approved_by) return { allowed: false, reason: 'missing_liuliu_approval', expected: 'high 风险需要柳柳最终确认（approved_by=liuliu）', requiredApproval: needed, checked };
    }

    if (!Array.isArray(evidence) || evidence.length === 0) return { allowed: false, reason: 'missing_evidence', expected: 'write 必须提供 evidence（issue/讨论记录/测试结果）', requiredApproval: needed, checked };
    // v1.0.1(MVP): rollback_sha 记录式（有则记，无则 v2 由 Worker 写入前自动获取 dev sha）
    if (capability === 'github_push' && target?.rollback_sha !== undefined && !target.rollback_sha) return { allowed: false, reason: 'empty_rollback', expected: 'rollback_sha 不能为空串', requiredApproval: needed, checked };

    return { allowed: true, reason: 'allowed', requiredApproval: [], checked };
}
