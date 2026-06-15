# 建书向导 UI 优化 — Tasks

---

## Task 1: NewBookGuide 动态跳问

- [ ] GUIDE_QUESTIONS 加 `minComplexity` 字段：powerSystem="heavy"、worldModel="medium"，其余不设
- [ ] 加 `selectedGenre` state + `getGenreComplexity` 导入
- [ ] 用 `useMemo` 根据 complexity 过滤 `activeQuestions`
- [ ] 进度条 `total` 改为 `activeQuestions.length`
- [ ] `question` 改为 `activeQuestions[step]`
- [ ] 题材选择（step 0 的 handlePresetSelect/handleCustomInput）同步更新 `selectedGenre`
- [ ] 回退到 step 0 改题材时，clamp step 不超出新 activeQuestions 长度
- [ ] typecheck 干净

## Task 2: 验证

- [ ] Browser 验证：选"都市"后进度条显示 X/8（跳 2 题）
- [ ] Browser 验证：选"修仙"后进度条显示 X/10（全部）
- [ ] Browser 验证：选"系统流"后进度条显示 X/9（跳 1 题）
- [ ] 全部跳过仍正常
- [ ] 提交后 guided-setup 正常调用
