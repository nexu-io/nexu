---
id: "20260415-developer-notify"
name: "Developer Notify"
status: new
created: "2026-04-15"
---

## Overview

开发者社群运营需求：当有新增 PR 或 issue 时，推送通知到飞书群。

### 新增外部贡献者 pr 推送

1. 触发条件：每新增一个外部 pr ，立即推送至飞书群
2. 推送格式

```
标题：🎉 又新增 1 位贡献者给 Nexu 提 PR 啦～ 立即派出奖励💰！
Author: teddyli18000   
Labels: none
1. 按钮文案： 查看贡献Pr  跳转Pr 地址
Nexu 准备好一批对新手友好任务的 Good First Issue 👇 
只需 3 步💥，选任务 —认领 —— 提交 ，即可获得 GitHub README 公开致谢+积分奖励+Github 社区徽章🎉。（详情请看群公告）
1. 按钮文案：贡献者指南 /   跳转链接：https://docs.nexu.io/zh/guide/first-pr
2. 按钮文案：立即贡献  /  跳转 good first issue 链接：https://github.com/nexu-io/nexu/labels/good-first-issue
```


### 新增 issue 推送至开发者飞书交流群 @刘毅 

1. 触发条件：只要新增外部 issue 就立即发布
1. 推送格式

```
1. 标题：一批新手友好 Issue 等你领取，做贡献领积分奖励💰🎉
只需 3 步💥，选任务 —认领 —— 提交 ，即可获得 GitHub README 公开致谢+积分奖励+Github 社区徽章🎉。（详情请阅览群公告）
1. 按钮文案：查看 issue 
按钮跳转新增 issue 地址：例如 https://github.com/nexu-io/nexu/issues/1097
2. 按钮文案：领取新手友好 issue 
按钮跳转 good first issue 链接：https://github.com/nexu-io/nexu/labels/good-first-issue
3. 按钮文案：贡献者指南 
跳转链接：https://docs.nexu.io/zh/guide/first-pr
```


## Research

<!-- What have we found out? What are the alternatives considered? -->

## Design

<!-- Technical approach, architecture decisions -->

## Plan

<!-- Break down implementation and verification into steps -->

- [ ] Phase 1: Implement the first part of the feature
  - [ ] Task 1
  - [ ] Task 2
  - [ ] Task 3
- [ ] Phase 2: Implement the second part of the feature
  - [ ] Task 1
  - [ ] Task 2
  - [ ] Task 3
- [ ] Phase 3: Test and verify
  - [ ] Test criteria 1
  - [ ] Test criteria 2

## Notes

<!-- Optional: Alternatives considered, open questions, etc. -->
