// L5 — deterministic metadata mapping plus a bounded read-only health scene.
// Mapping stays pure; only the explicit health_check scene reads metadata.
import { BOOTSTRAP_KEYS } from '../session/keys.js';
import { readMemoryHealthMetadataSample } from './repository.js';

export const BOOTSTRAP_CORE_KEYS = Object.freeze(Object.values(BOOTSTRAP_KEYS));

const CORE_KEY_SET = new Set(BOOTSTRAP_CORE_KEYS);
const MEMORY_TYPES = new Set(['fact', 'quote', 'inference', 'agreement']);
const REFLECTION_STATES = new Set(['pending', 'validated', 'rejected', 'deferred']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const safeText = value => nonblank(value) ? value.trim() : null;

function referenceArray(value) {
    return Array.isArray(value) && value.every(nonblank)
        ? [...new Set(value.map(x => x.trim()))] : [];
}

/** A single memory row is not a Reflection candidate, regardless of type/key. */
export function mapMemoryMetadata(input) {
    const row = isObject(input) ? input : {};
    const uncertainties = [];
    const reasons = [];
    if (!isObject(input)) uncertainties.push('invalid_record_shape');

    const recordId = safeText(row.id) || safeText(row.record_id);
    const key = safeText(row.key);
    const category = safeText(row.category);
    const type = MEMORY_TYPES.has(row.type) ? row.type : null;
    const sourceRef = safeText(row.source_ref);
    const status = safeText(row.status);
    const validToPresent = hasOwn(row, 'valid_to');
    const validTo = validToPresent ? row.valid_to : undefined;
    const evidenceRefs = referenceArray(row.evidence_refs);

    if (!recordId) uncertainties.push('record_id_missing');
    if (!key) uncertainties.push('key_missing');
    if (!category) uncertainties.push('category_missing');
    if (!type) uncertainties.push(hasOwn(row, 'type') ? 'type_invalid_or_unmarked' : 'type_missing');
    if (!sourceRef) uncertainties.push('provenance_missing');
    if (hasOwn(row, 'evidence_refs') && evidenceRefs.length === 0) {
        uncertainties.push('evidence_refs_invalid_or_empty');
    }
    if (type === 'agreement') uncertainties.push('agreement_confirmation_source_unverified');

    let validity = 'unknown';
    if (status === 'active' && validToPresent && validTo === null) {
        validity = 'current';
        reasons.push('current_active_record');
    } else if (status === 'active' && validToPresent && validTo !== null) {
        validity = 'conflicting';
        uncertainties.push('active_status_with_valid_to');
    } else if (['deleted', 'expired', 'inactive', 'archived'].includes(status)) {
        validity = 'historical';
        reasons.push('non_current_record');
    } else if (status && status !== 'active') {
        uncertainties.push('unknown_status');
    }
    if (validity === 'unknown') uncertainties.push('validity_unverified');

    const views = [];
    let coreInclusion = 'not_in_core_5_keys';
    if (validity === 'current') {
        views.push('Long-term');
        if (key && CORE_KEY_SET.has(key)) {
            reasons.push('exact_bootstrap_core_key');
            if (row.body_readable === true) {
                views.unshift('Core');
                coreInclusion = 'eligible_with_explicit_body_evidence';
            } else {
                coreInclusion = 'UNCERTAIN';
                uncertainties.push(row.body_readable === false
                    ? 'core_body_unreadable' : 'core_body_readability_unverified');
            }
        } else {
            reasons.push('not_a_bootstrap_core_key');
        }
    } else if (validity === 'historical') {
        views.push('Archive');
        coreInclusion = 'non_current_record';
    } else {
        views.push('UNCLASSIFIED');
        if (key && CORE_KEY_SET.has(key)) coreInclusion = 'UNCERTAIN';
    }

    return {
        record_id: recordId,
        key,
        category,
        type,
        validity: { status: status || null, valid_to: validToPresent ? validTo : null,
            classification: validity, valid_to_provided: validToPresent },
        maturity: null,
        provenance: sourceRef,
        suggested_views: views,
        core_inclusion: coreInclusion,
        evidence_refs: evidenceRefs,
        reasons,
        uncertainties,
        recommendation: 'review_only',
        writes_executed: false
    };
}
// The health scene reuses the pure mapper/explainer exports defined below.

const DEMO = Object.freeze({
    records: [
        { id: 'demo-core', key: '🧬/我是谁', category: '🧬', type: 'fact',
            status: 'active', valid_to: null, body_readable: true, source_ref: 'synthetic:core' },
        { id: 'demo-unknown', key: '⚙️/纯合成示例', category: '⚙️',
            status: 'active', valid_to: null },
        { id: 'demo-old', key: '💕/已失效的合成示例', category: '💕',
            type: 'quote', status: 'expired', valid_to: '2026-01-01' },
        { id: 'demo-conflict', key: '📦/状态冲突的合成示例', category: '📦',
            type: 'fact', status: 'active', valid_to: '2026-02-01' }
    ],
    reflection_candidates: [
        { candidate_id: 'demo-reflection', validation_state: 'pending', source_refs: ['synthetic:lesson'] }
    ]
});

function uniqueRecords(rows) {
    const ids = new Set();
    return rows.filter(row => {
        const id = typeof row?.id === 'string' && row.id.trim() ? row.id : null;
        if (!id) return true; // Cannot prove a duplicate without an ID.
        if (ids.has(id)) return false;
        ids.add(id);
        return true;
    });
}

export function formatMemoryHealthReport({ mode, sample, report }) {
    const demo = mode === 'demo';
    const summary = report.summary;
    const counts = summary.view_counts;
    const unverifiedCore = report.memory_rows.filter(row => row.core_inclusion === 'UNCERTAIN').length;
    const issueCounts = new Map();
    for (const mapped of report.memory_rows) {
        for (const issue of explainMemoryLayerRow(mapped).issues) {
            issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
        }
    }
    const commonIssues = [...issueCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    const status = sample?.status || 'OK';
    const lines = [
        '🧠 [health_status=' + status + '] Ziven 记忆体检',
        demo ? '🧪 固定合成数据演示；没有读取柳柳的真实记忆。'
            : '📍 本次仅检查已授权的少量记忆元数据，不含正文；不是全库盘点。',
        '📊 样本：读取 ' + (sample?.returned_rows ?? summary.provided_memory_rows)
            + ' 行；去重后 ' + summary.provided_memory_rows + ' 条。',
        '🔖 视图候选：Core ' + counts.Core + '，Long-term ' + counts['Long-term']
            + '，Archive ' + counts.Archive + '，待确认 ' + counts.UNCLASSIFIED
            + '；Reflection ' + (demo ? counts.Reflection : '未检查') + '。',
        '🧬 Core 启动候选待核验：' + unverifiedCore + ' 条（不视作已装载）。',
        'ℹ️ 这些是可重叠的引用建议，不等于内容真实、自动归档或宿主已成功恢复。'
    ];
    if (!demo) {
        const groups = sample?.groups || {};
        lines.push('🔎 采样覆盖：核心 ' + (groups.core ?? 0) + '/5，工作 '
            + (groups.work ?? 0) + '/2，相处 ' + (groups.relationship ?? 0)
            + '/2，较早记录 ' + (groups.older ?? 0) + '/3。');
        if (sample?.error_code) lines.push('⚠️ 读取未完成：' + sample.error_code + '；不得当作没有记忆。');
    }
    lines.push('⚠️ 值得核对的疑点（仅样本，匿名）：');
    if (commonIssues.length) {
        for (const [issue, count] of commonIssues) lines.push('- ' + count + ' 条：' + issue);
    } else lines.push('- 本次没有触发已知规则疑点；不能证明数据完全正确。');
    lines.push('📋 匿名逐条说明：');
    report.memory_rows.forEach((mapped, index) => {
        const note = explainMemoryLayerRow(mapped);
        lines.push('- 样本 ' + String(index + 1).padStart(2, '0') + '：'
            + note.validity_label + '；' + note.type_label + '；'
            + note.provenance_label + '；' + note.view_label + '；' + note.core_label + '。');
    });
    lines.push('🔒 只读，仅提出人工审阅建议；未读取正文、未更改/迁移/删除记忆、未自动打点 usage_count。');
    return lines.join('\n');
}

export async function handleMemoryHealthCheck(args = {}, env = {}) {
    const mode = args.mode ?? 'demo';
    if (mode !== 'demo' && mode !== 'sample') return '❌ [health_status=INVALID_MODE] 只支持 demo 或 sample';
    if (mode === 'sample' && args.metadata_read_confirmed !== true) {
        return '❌ [health_status=CONSENT_REQUIRED] 真实元数据体检需要柳柳本次明确授权，且显式 metadata_read_confirmed=true；未发起读取。';
    }
    if (mode === 'demo') {
        return formatMemoryHealthReport({ mode, report: buildMemoryLayerReport(DEMO) });
    }
    // Do not echo raw ids/keys/source references even when the repository returns
    // a partial result. Every visible explanation comes from a fixed label.
    const sample = await readMemoryHealthMetadataSample(env);
    if (sample.status === 'ERROR') {
        return '❌ [health_status=ERROR] 元数据读取失败（' + sample.error_code + '）；没有证明记忆库为空，未读取正文或写入。';
    }
    return formatMemoryHealthReport({
        mode, sample,
        report: buildMemoryLayerReport({ records: uniqueRecords(sample.rows) })
    });
}


const MEMORY_LAYER_ISSUE_LABELS = Object.freeze({
    invalid_record_shape: '记录结构无效',
    record_id_missing: '缺少记录标识，无法独立追溯',
    key_missing: '缺少精确记忆键名',
    category_missing: '缺少主题分类',
    type_missing: '记忆性质尚未标注',
    type_invalid_or_unmarked: '性质未标注或不在已支持的类型中',
    provenance_missing: '未见结构化来源引用；不代表记忆没有来源',
    evidence_refs_invalid_or_empty: '证据引用列表无效或为空',
    agreement_confirmation_source_unverified: '尚未核实柳柳明确确认这项约定的依据',
    active_status_with_valid_to: '记录标为活跃，但仍带有失效时间，状态冲突',
    unknown_status: '记录状态不在已支持范围内',
    validity_unverified: '无法证明记录当前有效',
    core_body_unreadable: '启动候选的正文不可读，不能纳入 Core',
    core_body_readability_unverified: '启动候选正文是否可读尚未核验',
    possible_duplicate_key: '不同记录可能共用相同键名，需要人工核对'
});

/**
 * Readable, metadata-only explanation of an already-mapped memory.
 * Never copies record IDs, keys, source references, evidence payloads or bodies.
 * The mapper remains the single authority for classification decisions.
 */
export function explainMemoryLayerRow(mapped) {
    if (!isObject(mapped) || !isObject(mapped.validity)
        || !Array.isArray(mapped.uncertainties) || !Array.isArray(mapped.suggested_views)) {
        throw new TypeError('mapped_memory_row_required');
    }

    const validityLabels = {
        current: '当前有效（仅据状态字段，不代表内容已证实）',
        historical: '历史状态（仅建议按需查看，不移动或删除）',
        conflicting: '有效性状态冲突，不能自动当作当前事实',
        unknown: '有效性尚未核验，暂不自动归类'
    };
    const validityLabel = Object.prototype.hasOwnProperty.call(validityLabels, mapped.validity.classification)
        ? validityLabels[mapped.validity.classification] : validityLabels.unknown;
    const type = MEMORY_TYPES.has(mapped.type) ? mapped.type : null;
    const typeLabel = type
        ? '已标注性质：' + type + '（性质标签不证明内容真实）'
        : '性质未标注（不能默认当成 fact 或 agreement）';
    const provenanceLabel = nonblank(mapped.provenance)
        ? '已有结构化来源引用，但引用真实性尚未核验'
        : '未见结构化来源引用（不等于记忆没有来源；正文未检查）';
    const agreementLabel = type === 'agreement'
        ? '已标注 agreement，但柳柳是否明确确认的依据仍待核验'
        : '未标记为 agreement，不推断柳柳曾明确确认';

    let coreLabel = '不在当前 Core 引用范围内';
    if (mapped.core_inclusion === 'eligible_with_explicit_body_evidence') {
        coreLabel = '已有输入侧的正文可读证据，但宿主实际装载仍须单独验收';
    } else if (mapped.core_inclusion === 'UNCERTAIN') {
        coreLabel = mapped.uncertainties.includes('core_body_unreadable')
            ? '启动核心候选正文不可读，不能自动纳入 Core'
            : '启动核心候选正文可读性未核验，不能自动纳入 Core';
    } else if (mapped.core_inclusion === 'non_current_record') {
        coreLabel = '已非当前有效记录，不纳入 Core';
    }

    const views = mapped.suggested_views;
    const viewLabel = views.includes('UNCLASSIFIED')
        ? '待人工确认，不能自动归类'
        : views.includes('Archive')
            ? 'Archive 历史视图候选（不迁移记忆）'
            : views.includes('Core')
                ? 'Core + Long-term 引用候选（宿主装载尚未验证）'
                : views.includes('Long-term')
                    ? 'Long-term 当前引用候选（不修改原记录）'
                    : '无已证明的当前视图建议';

    const issues = [...new Set(mapped.uncertainties.map(code =>
        Object.prototype.hasOwnProperty.call(MEMORY_LAYER_ISSUE_LABELS, code)
            ? MEMORY_LAYER_ISSUE_LABELS[code]
            : '存在未解释的疑点，需要人工核对'
    ))];

    return {
        contract_version: 'MEMORY-L5-EXPLANATION-0.1',
        validity_label: validityLabel,
        type_label: typeLabel,
        provenance_label: provenanceLabel,
        agreement_label: agreementLabel,
        core_label: coreLabel,
        view_label: viewLabel,
        trust_label: '仅凭元数据不能核验记忆内容是否真实',
        issues,
        recommendation: 'review_only',
        writes_executed: false
    };
}

/** Learning candidates are independent of memories rows and never promoted here. */
export function mapReflectionMetadata(input) {
    const row = isObject(input) ? input : {};
    const candidateId = safeText(row.candidate_id);
    const state = safeText(row.validation_state);
    const sourceRefs = referenceArray(row.source_refs);
    const uncertainties = [];
    if (!isObject(input)) uncertainties.push('invalid_candidate_shape');
    if (!candidateId) uncertainties.push('candidate_id_missing');
    if (!REFLECTION_STATES.has(state)) uncertainties.push('reflection_state_invalid_or_missing');
    if (!sourceRefs.length) uncertainties.push('reflection_source_refs_missing');
    return {
        candidate_id: candidateId,
        maturity: REFLECTION_STATES.has(state) ? state : null,
        provenance_refs: sourceRefs,
        suggested_views: candidateId && REFLECTION_STATES.has(state) && sourceRefs.length
            ? ['Reflection'] : ['UNCLASSIFIED'],
        uncertainties,
        recommendation: 'review_only',
        approval_required: true,
        writes_executed: false
    };
}

/** Inventory here means only the supplied rows, never a database-wide count. */
export function buildMemoryLayerReport({ records = [], reflection_candidates: candidates = [] } = {}) {
    if (!Array.isArray(records) || !Array.isArray(candidates)) {
        throw new TypeError('records_and_reflection_candidates_must_be_arrays');
    }
    const mapped = records.map(mapMemoryMetadata);
    const keyCounts = new Map();
    for (const row of mapped) {
        if (row.key) keyCounts.set(row.key, (keyCounts.get(row.key) || 0) + 1);
    }
    const possibleDuplicates = [...keyCounts.entries()]
        .filter(([, count]) => count > 1).map(([key]) => key).sort();
    const duplicateSet = new Set(possibleDuplicates);
    const memory_rows = mapped.map(row => duplicateSet.has(row.key)
        ? { ...row, uncertainties: [...row.uncertainties, 'possible_duplicate_key'] } : row);
    const reflection_candidates = candidates.map(mapReflectionMetadata);
    const viewCounts = { Core: 0, 'Long-term': 0, Reflection: 0, Archive: 0, UNCLASSIFIED: 0 };
    for (const row of [...memory_rows, ...reflection_candidates]) {
        for (const view of row.suggested_views) viewCounts[view]++;
    }
    return {
        contract_version: 'MEMORY-L5-0.1',
        inventory_scope: 'provided_metadata_only',
        full_database_coverage_verified: false,
        read_only: true,
        writes_executed: false,
        memory_rows,
        reflection_candidates,
        possible_duplicate_keys: possibleDuplicates,
        summary: {
            provided_memory_rows: records.length,
            provided_reflection_candidates: candidates.length,
            rows_with_uncertainties: [...memory_rows, ...reflection_candidates]
                .filter(row => row.uncertainties.length > 0).length,
            view_counts: viewCounts
        }
    };
}
