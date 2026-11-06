// L5 v0.4 — scene-level memory health report.
// Existing mapper/explainer make all decisions; this module only orchestrates
// a fixed demo or an explicitly-confirmed metadata-only sample.
import { buildMemoryLayerReport, explainMemoryLayerRow } from './layer_mapper.js';
import { readMemoryHealthMetadataSample } from './repository.js';

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
