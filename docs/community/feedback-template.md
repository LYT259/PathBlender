# Feedback template / 反馈模板

> Copy this into your bug report (GitHub issue or wherever we're collecting
> feedback). **You are never required to post your path files** — the error
> text alone is usually enough; attach a file only if your team is
> comfortable sharing it (a single scrubbed route beats a whole match
> deploy folder).
>
> 复制以下模板到你的反馈（GitHub issue 或当时的反馈渠道）。**绝不会要求你公开路径文件**——通常报错文字就够用了；只有你们队伍愿意时才附文件（一条脱敏路线远好过整个比赛 deploy 目录）。

```
**App version / 应用版本**: (PathBlender menu → About PathBlender → copy, e.g. 0.1.6)
**Where / 运行环境**: desktop app (macOS __) / web app (browser __)
**Which tool exported the paths / 导出工具**: Choreo __ / PathPlanner __ / 103 fork __ (version if known)
**What happened / 发生了什么**:
**What you expected / 预期行为**:
**Steps to reproduce / 复现步骤**: 1. … 2. …
**Error text (copy it exactly) / 报错原文（照抄）**:
```

What each field is for / 各字段用途:

- **App version** — found in the About dialog (desktop) or the release
  you downloaded; the version pins the exact code under test.
  应用版本在「关于」对话框里，桌面版可一键复制；版本号对应确切代码。
- **Where** — desktop vs web builds differ in capability; the OS and
  browser matter for UI bugs. 桌面/网页能力不同，系统与浏览器对界面问题有影响。
- **Export tool + version** — most "fails to import" reports are format
  drift from a newer tool release; the tool version tells us which
  schema to test against. 多数「导入失败」是新版工具改了格式；工具版本决定我们对照哪个 schema 测试。
- **Error text** — copy it verbatim; the message names the parser and
  the reason. 报错原文照抄——里面指明了解析器与原因。
