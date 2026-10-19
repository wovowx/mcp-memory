#!/usr/bin/env python3
# 学习回归测试 runner —— 校验 tests/learning/*.json 工件一致性（持续学习引擎 MVP CI 第一步）
# 用法：在 mcp-memory 仓库根目录运行：python3 tests/learning/run_learning_tests.py
# 职责：test_id 唯一+格式、必填字段、status 合法、checks/blocked_actions 非空。
# 退出码 0=PASS，1=FAIL（供 GitHub Actions 门禁）。
import glob, json, sys, re

REQUIRED = ['test_id', 'name', 'lesson_key', 'status', 'trigger', 'checks', 'blocked_actions', 'verification']
VALID_STATUS = {'active', 'superseded', 'revoked'}
ID_RE = re.compile(r'^learning_[a-z0-9_]+_\d{3}$')

errors = []
ids = []
files = sorted(glob.glob('tests/learning/*.json'))
if not files:
    print('NO_TEST_FILES: tests/learning/ 下没有工件')
    sys.exit(1)
for f in files:
    try:
        d = json.load(open(f))
    except Exception as e:
        errors.append(f'{f}: JSON 解析失败 {e}')
        continue
    tid = d.get('test_id')
    if tid in ids:
        errors.append(f'{f}: test_id {tid} 重复')
    ids.append(tid)
    for k in REQUIRED:
        if k not in d:
            errors.append(f'{f}: 缺必填字段 {k}')
    st = d.get('status')
    if st and st not in VALID_STATUS:
        errors.append(f'{f}: status 非法 {st}（应属 {sorted(VALID_STATUS)}）')
    if tid and not ID_RE.match(tid):
        errors.append(f'{f}: test_id 格式应为 learning_xxx_NNN，实际 {tid}')
    if not d.get('checks'):
        errors.append(f'{f}: checks 为空')
    if not d.get('blocked_actions'):
        errors.append(f'{f}: blocked_actions 为空')

print(f'=== {len(files)} 个工件, test_ids={ids} ===')
if errors:
    print('FAIL')
    for e in errors:
        print('  - ' + e)
    sys.exit(1)
print('PASS: 学习回归测试工件全部一致')