# ADR-0002: 轻量自建 i18n（三语：简/繁/英）

- 状态：Accepted（2026-08-25）；2026-08-26 部分被 ADR-0003 取代（繁体改为 OpenCC 生成，其余有效）
- 关联：可行性研究报告 §六（P2 三语 i18n）；GHPaths ADR-0008（react-i18next + OpenCC 先例）

## 背景

报告 P2 要求简/繁/英三语。GHPaths 用 react-i18next + OpenCC 繁体转换。

## 决策

**自建轻量字典方案**：三份静态字典（`en` / `zh-Hans` / `zh-Hant`）+ 一个
`t(key)` 函数 + React context 切换，零运行时依赖。

## 理由

1. 本项目文案量小（~60 条 UI 字符串），react-i18next（含 ICU 插件生态）
   的能力远超需求，而本项目的加载体积红线（纯前端、移动可用）比 GHPaths
   （桌面 Tauri）更紧；
2. 繁体不用 OpenCC 运行时转换：opencc-js 词典体积 ~1 MB 级，对三张字典
   手工维护的 60 条文案不成比例；繁体字典随简体字典同步人工更新（AI 辅助
   翻译质量对 UI 短语足够），漂移风险由「缺 key 回退英语 + 测试断言三语
   key 集合一致」兜底；
3. 未来文案规模超过 ~150 条或需要复数/日期格式化时，迁移 react-i18next
   的成本仅为字典改格式（届时另立 ADR）。

## 实现要点

- `packages/web/src/i18n/`：`en.ts`、`zh.ts`、`zh-tw.ts`、`index.tsx`（context + hook）
- 语言偏好存 localStorage（`ghpb.lang`），默认取浏览器语言（zh* → 简/繁，否则英语）
- 字典 key 用稳定的英文 slug；组件内不硬编码用户可见文案
- 测试：三语 key 集合一致性断言
