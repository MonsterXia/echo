# M3-3：发行版与用户 / 构建指南一致性复核

日期：2026-10-23（Asia/Hong_Kong）。执行者：Codex。M3-3 状态仍为**待验收**；本项完成无设备文档核对，不代替用户操作或 macOS 本机人工走读。

## 基线与范围

- fetch 后的 `origin/master`：`8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`（README 双语 PR #34 已合并）。独立工作树、分支 `codex/m3-3-release-guide-audit`，本检出独立安装依赖并生成 dist，未复用其他任务的依赖或构建输出。
- 只修改用户指南、构建指南、M3-3 专项记录及 RUNBOOK 对应条目。不修改 README、生产代码、版本号、锁文件、CI、Release 或 tag。
- 已读 AGENTS、项目 skill、RUNBOOK、来源索引、首次 M3-3 与 HiLog 专报，并按指南入口核对当前源码。早期报告的测试数量和构建产物是历史证据，保留原日期和基线，不改成当前结果。

## 发行信息核验

GitHub 官方 REST API 的 `/releases`、`/releases/latest`、tag ref 和 annotated tag object 均通过只读请求核验；匿名 API 受共享 IP 限流，改用已认证的 `gh api` 完成读取。没有创建或修改发行内容。

| 项目 | 实际结果 |
| --- | --- |
| 公开 Release | [Scrcpy Harmony 1.0.2 / v1.0.2](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.2)，非 draft、非 prerelease；发布时间 2026-10-22 12:47:24（UTC+8） |
| tag | annotated tag object `404146dce3ac00da7766f38ba6c96e907b65831d` → commit `1c545a7702547d8c53e31bcbfe7d76febc326cba`；本地 `git rev-parse 'v1.0.2^{commit}'` 一致 |
| 当前仓库版本 | package.json 与锁文件两处根版本仍为 `1.0.2`；版本号相同不表示源码与发行包相同 |
| 附件 | 共 14 个：3 安装包、3 blockmap、3 更新 YAML、3 平台验证报告、SHA256SUMS.txt、release-validation.json |
| 轻量下载核验 | 只下载 3 YAML、SHA256SUMS.txt、release-validation.json，5 个文件的本地 SHA-256 均与 API digest 一致；校验清单的 13 个条目均与 API digest 一致 |
| 安装包元数据 | 三个平台的 publishedName、size、SHA-256 与 API 一致；YAML 版本、URL、size、SHA-512 与 release-validation.json 一致。**未重新下载或计算安装包字节的哈希** |

机器可读的[发行快照](m3-3-release-guide/release-snapshot.json)记录核验时间、完整源 SHA、14 个附件名称 / 大小 / digest 和已执行范围。原始发行安装与系统信任证据仍见 [1.0.2 发布记录](../releases/1.0.2.md)；本次元数据核对不追加安装、签名、公证或 Gatekeeper 验收结论。

## 文档失败证据与修订

这里的失败证据是基线文档与实际版本 / 源码的对照，不是运行时故障，也未为文档编造红灯单测。

| 基线文档情况 | 当前真实路径证据 | 修订 |
| --- | --- | --- |
| 两份指南仍标记 master `9e944ae`；用户指南仅概括较早的枚举 / 应用读取修复 | `git diff --name-only v1.0.2 HEAD -- src` 已有 18 个生产文件变化；#22、#25、#26–#32 均已进入本基线 | 标明本次 master `8d1cfab` 和发行源 `1c545a7`，新增仅 master 具备的行为表，保留支持范围 |
| 排错表只解释“未连接设备”；读者无法对应 master 新增的“设备刷新失败” | `toolbar/Target.tsx` 使用 targetsError 区分失败与空列表；Store.refreshTargets 拒绝旧请求覆盖，并在失败时清空旧目标 | 分开解释正常空列表、全部失败、部分成功；不把刷新成功当作有设备，也不声称取消 HDC 请求 |
| HiLog 段落称“后续源码修复会丢弃”，未明确已进入此次 master | `hdc/hilog.ts` 的 generation、closed 和查询后检查来自已合并 #29 | 改为“本次核对的 master 已丢弃”；仍保留未发行、未取消底层查询及导出裁剪要求 |
| 旧报告末尾仍“保持待审查”，容易与当前交付状态混淆 | 本基线历史含 #19 merge `92a0725` 与 #29 merge `5dcc7bd` | 明确旧报告为历史记录，更新其源码交付状态并链接本次复核；M3-3 不标为完成 |
| 构建指南未给出 tag 的完整源 SHA，容易把同版本 master 包视为发行包 | tag 与 master package 版本相同，但源提交不同；resources 脚本仍读取可变上游 master | 补完整源 SHA、切 tag 后核对命令和重构建非逐字节复现说明；区分本地包与公开附件校验值 |

新增版本差异表逐项核对：设备枚举 / 参数错误处理（`hdc.ts`、`hdc/parameters.ts`、Store / Target）；应用隔离与设备名称回退（`hdc/bundle.ts`、`Application.tsx`）；投屏队列 / 关闭清理及窗口、工具栏适配（ScreencastClient、screencast window / SCSS）；HiLog 生命周期；WebView 精确进程与 HTTP 截止（`hdc/webview.ts`）；概览内存有限读取（`hdc.ts`、`hdc/finiteShell.ts`）。这些源码差异不证明原机型、无线调试、离线图标或长时卡死已解决。

以下仍正确，未凭空改写：安装包三个名称；设备选择 / 投屏工具栏 / 设置 / 菜单入口；HiLog 保存仍导出 entriesRef 全量而非显示过滤结果；Electron preload 必需。`script/resources.mjs`、`script/build.mjs`、`script/pack.mjs`、Vite 配置、菜单与固定共享子模块自 v1.0.2 未变；package 的 npm scripts、Node engine 和 Electron 版本亦未变。Git Bash、两终端启动、资源 TLS / 哈希现状、no-publish 和 CI 隔离限制继续适用。未执行或重新验收指南中的设备授权步骤。

## 本轮执行与验证

环境：Windows x64，Node `22.21.1`，npm `10.9.4`。仅使用本次独立检出；以下为实际执行结果。

| 检查 | 结果 |
| --- | --- |
| `git submodule update --init --recursive` | 固定 share `f9898acb070bbadb7d9b9ea2b72ec2e40c26e943`、icon `b463613b5ad5829131ab73268cfdc8910869a1d5`，无偏离 |
| `npm ci --no-audit --no-fund` | 退出 0，592 packages；锁文件未变化 |
| `npm test` | 250/250 通过，0 失败 / 跳过 / TODO / 取消；包含与版本差异有关的现有真实路径合成回归 |
| `npm run lint` | 通过 |
| `npm run build:main`、`build:preload`、`build:renderer` | 均通过，输出只在本检出 dist；保留既有 Vite CJS、Sass、Licia eval 与 chunk 大小警告 |
| 发行元数据 | 见上表与 JSON；安装包名、更新通道和 hash 元数据一致 |
| 本地 Markdown 路径 / 锚点 | 两份指南、首次 M3-3 报告、本报告及 RUNBOOK 共 69 个引用，0 缺失 |
| 命令 / 源码一致性 | 指南引用的 npm script 均存在；三处根版本一致；scripts、Node engine、Electron 版本与 v1.0.2 相同，资源 / build / pack / Vite / 菜单 / share 差异为空 |
| `git diff --check` | 通过 |

本次未运行资源下载、完整 `build`、`pack` 或安装启动；模块构建不涵盖资源复制、dist npm 安装及安装包生成，历史完整构建证据不冒充本轮重跑。

## 交接与剩余验收

- 未启动 Electron、HDC 或设备验收脚本；未枚举设备 / 应用、未操作真机或 HAP、未安装卸载应用、未停止共享服务。没有设备日志、内部应用信息或用户截图。
- M3-3 继续待验收：需按选定发行版本走读安装、授权、设备选择、投屏 / 输入、脱敏 HiLog 导出，以及 macOS 本机人工流程；CI 打包和无设备测试不能代替。
- 本项交付独立文档 PR；最终 SHA、独立审查与五项 CI 以 PR 页面 / 交付消息为准，由主对话审查整合，不自行合并或发布。
- 发布工作可能并行推进。本报告是带时间的 v1.0.2 快照；合入前若最新 Release 改变，重新读取 Release / tag / 资产，更新两份指南的版本与已发行能力，不能只替换版本数字或沿用旧包哈希。
