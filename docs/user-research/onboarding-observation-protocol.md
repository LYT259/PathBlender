# PathBlender Onboarding Usability Observation Protocol（新手可用性观察协议）

**Status: NOT EXECUTED — no participants recruited, no sessions run**
**状态：未执行——未招募任何参与者，未进行任何观察场次**

- Date prepared / 编制日期: 2026.11.07
- Provenance / 依据: private spec `PathBlender_新用户入门与功能发现方案.md` §六（验收方式）. The framing sentence, the six success criteria, and the recording rule below are copied from §六 verbatim (Chinese is the original; English is a faithful translation) / 框架句、六条成功标准与记录方式均逐字摘自 §六（中文为原文，英文为忠实对照译文）.
- Scope / 范围: this document **prepares** observation materials only. It contains no participants, no sessions, and no results / 本文件仅**准备**观察材料，不包含任何参与者、场次或结果.

**Status-change rule / 状态更改规则:** the status line above may only change when real session evidence exists — an engineering-log entry plus the completed, anonymized record sheets from actually run sessions. It must never be changed to satisfy a deadline or to claim acceptance / 上面的状态行只有在存在真实场次证据（工程日志条目＋实际完成场次的匿名记录表）时才可更改；绝不为赶进度或宣称验收通过而修改。

Spec §六 framing, verbatim / §六 原文框架句:

> 邀请没有使用过 PathBlender 的 FRC 队员，分别从介绍／下载入口与直接打开应用开始；观察其独立完成操作，不在测试中代替界面口头解释。
>
> Invite FRC members who have never used PathBlender; start them from the README/download page and from opening the app directly (two cohorts); observe them completing the operations on their own — during the tasks, never explain the interface verbally in place of the UI.
>
> 记录用户在哪一步卡住、是否误解按钮含义、是否能继续完成任务，再修改对应界面与说明。通过人工观察和自愿反馈收集这些结果，不添加遥测。
>
> Record where the user stalled, whether they misread a button's meaning, and whether they could continue the task; then fix the corresponding interface and copy. Collect these results through manual observation and voluntary feedback only — no telemetry is added.

## 1. Moderator protocol / 主持人规程

**Who to recruit / 招募对象.** FRC team members (students or mentors) who have **never used PathBlender**. A mix of roles is welcome (strategy, drive team, programming, CAD); recruiting requires only that they have never used the app. Do not recruit people who have already seen the demo video or a guided walkthrough for this study / 招募从未使用过 PathBlender 的 FRC 队员（学生或导师）；欢迎不同角色（策略、操作组、编程、CAD），唯一硬性要求是未用过本软件。已看过演示视频或被引导走查过的人不作为本观察对象。

**Two entry cohorts / 两个入口组.** Assign each participant to one cohort, alternating / 每位参与者分入一组，交替分配:

- **Cohort A — README/download entry / 介绍／下载入口组:** start at the project README/download page and reach the app from there / 从项目 README/下载页开始，经该入口进入应用。
- **Cohort B — direct entry / 直接打开组:** open the app directly (installed desktop app or hosted web app), with no prior material / 直接打开应用（桌面安装版或网页版），不看任何前置材料。

**Session shape / 场次安排.** One participant, one moderator, about 30 minutes: informed consent (Part 4) → task list (Part 2) → post-task questions → thank and close / 一名参与者、一名主持人，约 30 分钟：知情同意（第 4 部分）→ 任务清单（第 2 部分）→ 任务后提问→致谢结束.

**Setup, before the participant arrives / 参与者到场前的准备:**

1. The shipped app is running (installed desktop build or the deployed web app; not a dev server with extra logging) / 运行的是正式版本（桌面安装版或已部署网页版，不是带额外日志的开发服务器）。
2. The two sample route files are available on disk for participants who bring no files of their own / 为未自带文件的参与者准备两个示例路径文件。
3. Record sheets (Part 3) printed or ready, consent text (Part 4) ready / 记录表（第 3 部分）与知情同意文本（第 4 部分）就绪。
4. No other windows, tabs, or hints on screen / 屏幕上无其他窗口、标签页或提示。

**Observer rules / 观察规则 (the core §六 rule / §六 核心规则):**

- Watch silently. **Never explain the UI verbally during the task**: do not name buttons, do not point at controls, do not say where to click / 默默观察。**任务进行期间绝不以口头解释代替界面**：不说按钮名称、不指控件、不说该点哪里。
- Speak only to: hand over the task list, answer non-UI logistics (for example "yes, that is the sample file"), remind the participant they may think aloud, and close the session / 只在以下情况开口：交付任务清单、回答非界面事务（例如「是的，那是示例文件」）、提醒可以边做边说、结束场次。
- If the participant asks how something works, say it will be discussed after the tasks, note the question, and move on / 参与者询问功能如何用时，说明任务后再谈，记录该问题并继续。
- If the participant is fully stuck on one step for about two minutes, mark the stall on the record sheet, then give the minimum unblocking hint; write down exactly what was said / 在同一步骤卡住约两分钟时，先在记录表标记卡点，再给出最小解锁提示，并逐字记录所提示内容。
- Note-taking is continuous, on the record sheet, by hand / 全程在记录表上手工记录。

**After the tasks / 任务之后.** Ask the purpose question and record the answer verbatim: "In your own words, what is this software for, and when would you use it?" / 用自己的话提问并逐字记录：「用你自己的话说，这个软件是做什么的？什么时候会用到？」Then collect any voluntary feedback. Close by reminding the participant that nothing was recorded automatically / 随后收集自愿反馈，结束前提醒参与者：没有任何自动记录。

## 2. Participant task list / 参与者任务清单

Hand this list to the participant (in their language). Do not demonstrate anything. The tasks mirror the onboarding demo-video scenes / 将清单交给参与者（用其语言）；不做任何演示。任务与入门演示视频场景一一对应:

> Work the way you normally would. If you are comfortable, say out loud what you are looking at and what you expect. You cannot break anything: the analysis view never rewrites your files or your robot program.
>
> 按你平时的方式操作。如果愿意，请说出你在看什么、预期会怎样。不会弄坏任何东西：分析视图不会改写你的文件或机器人程序。

**Moderator note — do not read aloud / 主持人注意——不向参与者宣读.** The preamble reassurance above is deliberate — keep it, so participants dare to explore — but it hands participants the criterion-4 fact, so the preamble itself is **excluded as evidence** for criterion 4. Score criterion 4 only from **unprompted** understanding or behavior during the relevant tasks (compare a route, mirror, alliance switch): for example, the participant says on their own that a changed route or a mirrored robot does not touch their real files or robot program, asks whether anything was saved, or checks/exports on their own initiative. Anything the participant says only after the moderator raises the topic does not count. Quote the observed basis on the record sheet (Part 3).
/ 上面引言中的安抚是刻意保留的——让参与者敢于尝试——但它把标准 4 的事实直接告诉了参与者，因此引言本身对标准 4 **不作为证据**。标准 4 只依据相关任务（比较路线、镜像、联盟切换）中的**未经提示**的理解或行为评分：例如参与者主动说出换路线/镜像不会动到真实文件或机器人程序、主动询问是否保存了什么、或自己去核对/导出。主持人提起该话题之后参与者才说的不算。把观察到的依据逐字记入记录表（第 3 部分）。

1. **Get started / 入门:** bring robots onto the field — either via the built-in example ("Try an example" / 「体验示例」) or by importing your own team's files / 让机器人出现在场地上：通过内置示例（「体验示例」）或导入你自己队伍的文件。
2. **Replay together / 同时回放:** play the shared timeline so the robots move together, then pause / 播放共享时间轴，让机器人一起运动，然后暂停。
3. **Locate a check result / 定位检查结果:** find the checks panel and jump to a reported problem moment / 找到检查面板，并跳转到某个问题时刻。
4. **Compare a route / 比较路线:** open a robot's arrange timeline, try a different route, and watch what changes / 打开某个机器人的编排时间轴，换一条路线，观察变化。
5. **Find and use the mirror / 找到并使用左右镜像:** find the left/right mirror for a single robot and use it; say what you expect it to affect / 找到单个机器人的左右镜像并使用；说说你预期它影响什么。
6. **Tell the two flips apart / 区分两种翻转:** the session-wide alliance switch (red↔blue) versus the per-robot left/right mirror — say what each one changes / 会话级联盟切换（红↔蓝）与单机器人左右镜像——分别说明各自改变什么。
7. **Find in-app help / 找到应用内帮助:** suppose you are stuck — find help inside the app / 假设你卡住了——在应用内找到帮助。
8. **Skip the guidance / 跳过引导:** if a checklist card or hint appeared, dismiss or skip it / 若出现清单卡或提示，将其关闭或跳过.

## 3. Observation record sheet template / 观察记录表模板

One sheet per participant per session, filled by hand, stored anonymized / 每位参与者每场次一张，手工填写，匿名保存:

| Field / 字段 | Entry / 填写 |
|---|---|
| Participant code / 参与者代号 | P-__ (no names / 不写姓名) |
| Date / 日期 | |
| Cohort / 入口组 | A — README/download ／ B — direct / 直接打开 |
| Role / 角色 | strategy / drive / programming / mentor … |
| FRC experience / FRC 经历 | years / 年数 |
| Never used PathBlender before? / 此前从未用过？ | required: yes / 必须为「是」 |
| Consent given / 已知情同意 | yes / no |
| Separate recording consent / 单独录制同意 | no (default) / no（默认）；only with separate written consent / 仅凭另行书面同意 |

Per-task record / 逐任务记录:

| Task / 任务 | Completed unaided / 独立完成 (yes / after hint / no) | Where they stalled — what were they looking for? / 卡在哪一步——当时在找什么 | Misread buttons — clicked vs. expected / 误解按钮——实际点了什么、以为是什么 |
|---|---|---|---|
| 1 Get started / 入门 | | | |
| 2 Replay / 回放 | | | |
| 3 Locate check result / 定位 | | | |
| 4 Compare route / 比较路线 | | | |
| 5 Mirror / 镜像 | | | |
| 6 Alliance vs. mirror / 联盟 vs. 镜像 | | | |
| 7 In-app help / 应用内帮助 | | | |
| 8 Skip guidance / 跳过引导 | | | |

Closing fields / 收尾字段:

- Verbatim purpose answer (criterion 1) / 用途回答逐字记录（标准 1）: "________"
- Criterion 4 basis — unprompted understanding/behavior only; the preamble reassurance is excluded as evidence (quote it) / 标准 4 依据——仅限未经提示的理解或行为；引言安抚不作为证据（逐字引用）: ________
- Six-criteria checklist below: observed / not observed / not applicable, with a note each / 六条标准逐条勾选：观察到／未观察到／不适用，并附备注。
- Hints the moderator had to give, quoted / 主持人不得不给出的提示，逐字记录: ________
- Anything that surprised the moderator / 主持人意外之处: ________
- Did a dismissed hint or checklist stay dismissed? / 被关闭的提示/清单是否不再出现?: ________

**Anonymization rules / 匿名规则:** participant code only — no names, no team rosters, no contact details; do not list teammates or team numbers; recordings (screen, audio, video) exist only with separate explicit consent, and by default none are made / 只用参与者代号——不记姓名、不收集队名册、不留联系方式；不列队友或队号；屏幕/音频/视频录制仅凭另行明确同意才存在，默认一律不录制。

## 4. Informed consent / 知情同意

Read to (and, where customary, acknowledged by) the participant before the session / 场次开始前向参与者宣读（按惯例可签字确认）:

> - Your participation is **voluntary**. You may stop at any time, for any reason, with no consequence and no explanation needed.
> - **No telemetry.** PathBlender itself collects no telemetry, and this study adds none: there are no accounts, no uploads, and no automatic data collection. Observation is manual — handwritten notes only.
> - Notes are **anonymized**: your name is never recorded; the sheet uses a participant code.
> - No screen, audio, or video recording will be made without your separate explicit consent; by default none is made.
> - The notes are used only to improve PathBlender's interface and documentation.
>
> - 你的参与是**自愿的**。可以随时因任何原因停止，无需解释、不承担任何后果。
> - **无遥测。** PathBlender 本身不收集遥测，本研究也不添加：无账号、无上传、无自动数据收集。观察为人工方式——仅手写笔记。
> - 笔记已**匿名化**：不记录你的姓名，记录表只用参与者代号。
> - 未经你另行明确同意，不会进行任何屏幕、音频或视频录制；默认不录制。
> - 笔记仅用于改进 PathBlender 的界面与文档。

## 5. The six §六 success criteria (verbatim) / 六条 §六 成功标准（原文）

Chinese is the spec original; English is the faithful translation. Mark each observed / not observed / not applicable per participant / 中文为规范原文，英文为对照译文；按参与者逐条标记「观察到／未观察到／不适用」:

1. 能用自己的话说明软件用途及适用场景。
   Can explain, in their own words, what the software is for and which scenarios it fits.
2. 能通过示例或自己的文件完成导入、回放与检查结果定位。
   Can complete the import, replay, and check-result locating using the example or their own files.
3. 能发现空间反转入口，区分会话联盟切换与队伍左右镜像，并解释操作影响范围。
   Can find the spatial-flip entry, distinguish the session alliance switch from the per-team left/right mirror, and explain the scope each operation affects.
4. 知道分析视图的改变不会直接修改原始文件或实车程序。
   Know that changes in the analysis view do not directly modify the original files or the real robot program.
5. 遇到问题时能在应用内找到相应帮助。
   Can find the relevant help inside the app when they run into a problem.
6. 熟练用户能够跳过引导，关闭的提示不会持续重复。
   Experienced users can skip the guidance, and dismissed hints do not keep reappearing.

Moderator note on criterion 6 / 关于标准 6 的说明: recruited participants are new users, so this criterion is recorded from what happens naturally during and after the session — whether a dismissed onboarding checklist or hint stayed dismissed (task 8) and whether any participant who grew comfortable skipped remaining guidance / 招募的是新用户，本条从场次中自然发生的行为记录：被关闭的入门清单/提示是否不再出现（任务 8）、逐渐上手的参与者是否跳过后续引导.

## 6. After real sessions / 真实场次之后

- File an engineering-log entry for each session and store the anonymized record sheets with it / 每场次写一条工程日志，匿名记录表随日志归档。
- Only then may the status line change, and only to a truthful statement of what was actually run / 此后状态行才可更改，且只能如实描述实际执行情况。
- Findings feed fixes to the corresponding interface and copy (spec §六), never a claim that §六 passed without sessions / 发现用于修改对应界面与说明（规范 §六）；没有真实场次，绝不宣称 §六 通过。
