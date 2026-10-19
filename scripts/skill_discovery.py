#!/usr/bin/env python3
# 使用数据扫描器（自动技能沉淀 · 候选发现 · 第一阶段）
# 输入：tool_usage.json = [{name,category,usage_count,last_used}]
# 输出：候选技能线索清单（按频率分层）
# 诚实备注（GPT 收敛要点）：当前 skills 表只打点 usage_count（频率），
#   缺「任务聚合/执行结果/跨任务复用」维度——usage_count 高 ≠ 可复用技能。
#   故本扫描器输出 = 「频率候选线索」，须补关联日志 + 人审才可晋升技能。
import json, sys

# 高频/高风险参考
HIGH_RISK = ['delete', 'remove', 'drop', 'permission', 'deploy', 'restart', 'close_pull', 'branch']
MIN_SERIOUS = 5       # 出现次数下限（候选线索门槛）
FREQ_THRESHOLD = 10   # 频率候选重点层


def main(path='tool_usage.json'):
    data = json.load(open(path))
    used = [t for t in data if (t.get('usage_count') or 0) > 0]
    used.sort(key=lambda t: -(t.get('usage_count') or 0))
    freq_candidates = [t for t in used if (t.get('usage_count') or 0) >= MIN_SERIOUS]
    print(f'=== {len(used)} 个工具有使用记录；>= MIN_SERIOUS({MIN_SERIOUS}) 的有 {len(freq_candidates)} 个 ===')
    print('\n### 频率候选线索（usage_count 降序）')
    for t in freq_candidates:
        name = t.get('name', '?')
        risk = ' ⚠️高风险-需人审' if any(r in name.lower() for r in HIGH_RISK) else ''
        print(f'  - {name:34s} {str(t.get("category", "")):10s} usage={t.get("usage_count")}{risk}')
    print('\n### 诚实备注（GPT 收敛要点）')
    print('  1) 本扫描器只基于 usage_count（频率），缺「任务聚合/执行结果/跨任务复用」维度。')
    print('     usage_count 高 ≠ 可复用技能（可能同任务重复 / 低效重试 / 一次大任务多次调用）。')
    print('  2) 要升格为技能候选，需补打点：任务_id + 每步结果 + 跨任务聚合；否则只作参考线索。')
    print('  3) 晋升技能流程：候选 → 生成 SKILL.md 草案 → skills/_candidates/ → 关联回归测试 → CI → 人审 → 正式路由。')
    print('  4) 高风险动作（删除/部署/权限/分支）标记需人审，不自动激活。')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tool_usage.json')