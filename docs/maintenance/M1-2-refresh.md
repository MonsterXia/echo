# M1-2：安装/卸载完成后的并发刷新

2026-10-27 更新：用户提供专用 Hello World 1.0.0/1.0.1 HAP，已补齐本机真实安装、覆盖升级、卸载与自动刷新验收，M1-2 改为已完成（本机验收）。详见[新记录](hap-install.md)。以下保留当时验证状态，不再将缺测试包视作当前阻塞。

2026-10-22（Asia/Hong_Kong）/ Codex。基线 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`，独立 worktree / 分支 `codex/m1-2-app-refresh`。M1-2 状态仍为**待验收**；本轮仅补并发控制与无设备回归，未操作真机、未安装或卸载应用。

## 来源与根因

[上游 PR #31](https://github.com/liriliri/echo/pull/31) 正文、patch 与讨论已重新核对：其修复目标是逐应用 dump 失败隔离，没有处理 renderer 刷新竞争。此前隔离修复已合入 [PR #17](https://github.com/MonsterXia/scrcpy-harmony/pull/17)，安装/卸载验收仍待办，见 [M1-2 原报告](M1-2.md)。本次具体问题来自 RUNBOOK 的 M1-3 审查后续记录。

`Application.tsx` 原刷新入口以渲染闭包中的 `isLoading` 判断是否返回：

- 查询仍在进行时，用户开始安装；安装完成调用该轮闭包的 `refresh()`，因 `isLoading=true` 直接返回，列表可能一直停留在安装前。
- 从空闲渲染开始安装后，用户先触发另一次刷新；安装完成仍使用 `isLoading=false` 的旧闭包，会并发启动查询，结果可能互相覆盖。
- 查询拒绝时没有 `finally`，加载状态不能恢复；面板卸载后仍会发布结果、继续剩余批次。空列表刷新也未清空图标引用。

## 修复行为

生产改动限定 `src/renderer/main/components/application/Application.tsx`。同步引用保存本轮面板的 active / running / pending 状态，React 的 `isLoading` 只用于界面显示。刷新期间的多个请求合并成一个待刷新标记；当前轮完成或失败后消费该标记，按当时的系统应用选项再查一次。在后续一轮又收到请求时，同样合并；没有新请求就停止，不因失败自行重试。

每轮开始同时清空列表与图标，继续保留每五个应用的增量显示。每次 IPC 返回后检查生命周期、引用身份和当前目标；旧面板的迟到结果不更新界面、不启动下一批。effect 清理后再次启动（含 React StrictMode）使用独立状态，旧查询不会覆盖新结果。查询失败显示现有通用错误提示，`finally` 释放加载状态，允许后续手动恢复。

安装与卸载成功后仍调用同一个刷新入口。已发送的 IPC 不被取消；用户已启动的安装/卸载操作也不会因切换设备而回滚。本轮不修改 `hdc/base.ts`、`hdc/bundle.ts`，不解决底层永不返回的命令；有限等待边界由 M2-2 独立处理。

## 可复现的回归与验证

新增 `test/application-refresh.test.cjs`，通过 jsdom 中的真实 React `createRoot` / `act`、MobX observer、真实 Application 与公共 installBundles 执行控制路径。Luna 组件替换为可观察的展示边界，设备 IPC、文件选择和确认框采用受控 Promise。用实际按钮事件/菜单回调触发操作，不复制刷新算法、不使用固定延时。全部目标、包名、HAP 路径均为虚构 fixture。

jsdom 仅为开发测试依赖，选用 26.x 以兼容项目 Node >=22.12.0；依赖锁文件同步更新，不进入发行应用运行依赖。

| 检查 | 结果 |
| --- | --- |
| 修复前单项失败 | 安装发生于在途查询期间；释放初次查询后，断言需要第 2 次查询，实际只有 1 次，`1 !== 2` |
| 修复前首批回归 | 12 项中 11 失败、1 通过；旧空闲闭包用例实际启动第 3 次查询而预期仍为 2 次，证明存在重叠；查询拒绝用例暴露未处理拒绝 |
| 修复后新增回归 | 15/15 通过，覆盖安装请求合并、旧闭包、后续轮新增请求、分批加载期间卸载、空图标与列表、最新选项、两类查询失败与恢复、失败后继续待刷新、安装失败、卸载与设备重建、StrictMode；审查后补后续元数据批次失败、旧设备迟到拒绝、多选安装部分成功 |
| 完整测试 | `npm test`：81/81 通过 |
| 静态检查 | `npm run lint`、`git diff --check` 通过 |
| 完整构建 | `npm run build` 通过；保留既有 Vite CJS、Sass 弃用、Licia eval 与 chunk 大小警告，不将构建转译称为完整 TypeScript 检查 |
| 本地环境 | Windows x64，Node 22.21.1、npm 10.9.4；本 worktree 独立安装依赖、初始化固定子模块、下载资源和构建 |
| 独立审查 | 只读 reviewer 未发现阻止合入的正确性或回归问题，独立复跑首批 12/12；其三项非阻塞测试建议均已补充，本地完整 81/81 |
| PR / CI | [PR #21](https://github.com/MonsterXia/scrcpy-harmony/pull/21)；本 PR 五项必需检查为 test、lint、windows-package、macos-package-arm64、macos-package-x64，最终提交结果见[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/21/checks)。本地验证与 CI 分开记录，不能引用其他 PR 的通过结果代替 |

复跑命令（已按锁文件安装依赖）：

```sh
node --test test/application-refresh.test.cjs
npm test
npm run lint
npm run build
```

## 未验收边界与下一步

本轮没有运行 Electron 真机流程，没有枚举设备或应用，没有安装/卸载任何真实应用，没有停止共享 HDC。React DOM 回归保留真实刷新路径，但不验证 Luna 的实际视觉效果、HDC 命令结果或设备安装语义；CI 的安装启动检查也不能替代这些设备验收。

用户没有本地专用 bilibili HAP；取得适用且获准使用的测试 HAP 后，仍需通过应用实际入口完成安装/卸载，核对自动刷新的包名、版本、名称和移除结果，并按用户授权范围保存必要证据。不得用其他个人或内部应用代替，不采集完整应用列表或设备标识。该条件满足前，M1-2 保持待验收。

本 PR 留待维护者审查，以自身最终提交的五项必需 CI 为审查依据，不自行合并或发布。
