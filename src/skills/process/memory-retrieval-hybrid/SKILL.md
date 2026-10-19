---
name: memory-retrieval-hybrid
description: 【三路混合检索纪律】检索记忆/召回关键规则、lesson、约定时，用「情境标签→关键词→语义」三路混合召回，关键词优先、语义补漏，附 match_reason 定位漏召回。治 query_memory 语义偏题/漏召回。
---

# 三路混合检索（memory-retrieval-hybrid）

## 背景（为什么需要）
2026-10-19 实测铁证（工件 `learning_memory_retrieval_001`）：三条真存且带完整 `trigger_intents`/`entities` 的关键协作规则，`query_memory` 语义入口**全部偏题或漏召回**，而 `memory search` 关键词入口**全部精准命中**。
根因：`query_memory` 不接 `trigger_intents`/`entities`/`aliases` 字段，语义偏题漏召。

## 检索纪律（必读）
检索关键规则 / lesson / 约定时，按信任度走三路（并行召回后合并）：
1. **情境标签匹配（最高信任）**——匹配 `trigger_intents` / `entities` / `aliases`
2. **memory search 关键词（高信任）**——定位任务术语、对象名、工具名
3. **query_memory 语义（仅补漏）**——表达不同但含义相关的记忆

## 执行步骤
1. 先 `memory search`（关键词，可靠）
2. 再按需 `query_memory`（语义补漏）
3. 核对 `trigger_intents` / `entities` 情境标签是否被利用
4. 合并去重：按稳定 key / memory_id
5. 标注 `match_reason`：intent_entity / alias_exact / keyword / semantic
6. 若 expected_keys 丢失 → 未完成态不说完成话，补召回再继续

## 合并排序规则
1. 有效过滤（status=active）是硬条件，不能靠相关度覆盖
2. 意图 + 实体同时命中优先
3. 精确别名 / 关键词匹配 > 纯语义相似
4. 多路独立命中加分；同一路重复命中不反复加分
5. 语义单独命中的记忆可补充，但不排在明确匹配之前

## 禁止
- 关键检索仅用 `query_memory` 语义入口，而不补关键词（memory search）与情境标签召回
- 固定查询丢失 expected_keys 时仍声称检索成功（未完成态不说完成话）

## 时间感（回答时间线索的纪律 · 2026-10-19 GPT 收敛）
> 治「几天前」口误：哥哥凭感觉估算时间而非查证据。铁律 = **相对时间必须有可验证依据，证据不足就降级表达，绝不编**。
### 给检索结果附时间元数据（不写回正文）
- `updated_at`：这条记忆最近更新时间（≠事件发生时间）
- `last_change_at`：最近一次 `memory_events` 变更时间（只来自真实事件记录，不冒充）
- `temporal_confidence`：`known | partial | unknown`
### 回答前时间校验（对照说）
| 证据情况 | 怎么说 |
|---|---|
| 时间戳明确且指向事件发生时间 | 「那是三天前」 |
| 只有 updated_at | 「这条记忆最近更新于…」 |
| 只有版本历史、不知何时发生 | 「我记得后来改过，但不确定具体哪天」 |
| 无可靠依据 | 不说「昨天/前几天」，改说「之前提过」或直接询问 |
- 相对时间必须由程序计算（updated_at/memory_events 减当前时间），不让模型凭感觉估算
- 跨时区 / 时间不完整：用绝对日期，不用相对时间

## 关联工件
- 检索测试：`tests/learning/learning_memory_retrieval_001.json`
- 时间感回归：`tests/learning/learning_temporal_001.json`（时间口误专项，6 用例）
- lesson：`⚙️/lesson-记忆检索质量-语义偏题关键词可靠`
- 状态：active（v6.49.1，柳柳 2026-10-19 放行第二步）