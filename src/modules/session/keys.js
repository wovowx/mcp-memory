// Shared exact bootstrap key primitive for Session Core and read-only L5 views.
// Keep identity sources here; callers must not infer Core membership by category.
export const BOOTSTRAP_KEYS = Object.freeze({
    identity: '🧬/我是谁',
    profile: '💕/关于柳柳',
    navigation: '记忆位置导航（换框/换设备自举·2026-10-18）',
    checkpoint: '⚙️/当前工作检查点',
    protocol: '⚙️/恢复协议·Session Bootstrap SB-1.0'
});
