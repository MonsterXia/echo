# M2-2 概览 renderer 读取生命周期

2026-10-23；起点 `4f514989ac2e7e2a0f03788286bd2441fb386e5b`。

## 结论与范围

真实 `Overview.tsx` 组件回归确认：React state 尚未提交时连续调用刷新会发出重复 IPC；组件卸载或断连后，旧读取拒绝仍产生全局错误通知；StrictMode 废弃的首次读取可覆盖后一次成功结果。组件自身也没有在目标对象替换后建立新的读取生命周期。

`App.tsx` 已按 target key 重建面板，因此常规不同 key 切换并不是“旧组件数据覆盖新组件”的已证实生产路径。测试另外覆盖不重挂载的不同 key / 同 key 对象替换，保证 Overview 自身处理边界。以上证据**不证明前两轮物理重连失败的根因**，不改变物理验收报告的失败记录和待定位状态。

修复仅在 Overview 内为每个目标对象建立读取会话：同步 pending 标记阻止同 tick 重入；effect cleanup 废弃旧会话；结果、失败通知及 loading 清理均检查会话仍有效且 store 仍选择原目标。目标替换清空旧详情并发起新读；当前读失败继续清空详情、通知并允许手动重试。现有 IPC 不可取消，已发出的读取仍会在主进程完成或失败；不增加自动轮询或后台重试。

## 回归证据

命令在隔离 `overview-lifecycle` 工作树运行，独立 `npm ci --ignore-scripts --no-audit --no-fund` 安装依赖。测试只使用合成目标与详情，不访问 HDC、手机、设备应用清单或内部应用信息。

| 验证 | 结果 |
| --- | --- |
| 修复前 `node --test test/overview-lifecycle.test.cjs` | 0/9；同 tick 请求数量分别为 3 而非 2、4 而非 3；四种替换无新读；断连/卸载后各出现一条不应出现的通知；StrictMode 当前详情被旧结果覆盖。均为断言失败，没有夹具加载错误。 |
| 修复后 `node --test test/overview-lifecycle.test.cjs test/overview-refresh.test.cjs` | 10/10；含原有失败刷新清空与恢复。此时 `src/share` 尚未初始化，验证适用于 CI 无子模块 checkout。 |
| `npm test` | 402/402，0 fail / cancelled / skipped。 |
| `npm run lint` | exit 0。 |
| `npm run build:renderer` | 初始化锁定版本 `src/share` 后 exit 0；832 modules transformed。保留 Vite CJS、Sass if()、licia eval 及大 chunk 警告。 |

新增夹具保留真实 React hooks、MobX observer、observable store 和安装版 Luna toolbar；仅适配共享图标的展示转发、IPC/通知及无关弹窗，不复制生产读取逻辑。独立延迟 promise 控制旧/新读取完成顺序，检查请求目标、界面内容、loading/按钮状态和全局通知。StrictMode 会确实启动两轮 effect，此测试不把开发模式的 effect 重放误当作普通刷新防重入。

## 下一步与边界

独立审查和 PR CI 结果在任务记录/PR 中补充；未经确认不标完成。此次无 Electron 运行或真机验收，不证明 IPC 可取消、物理恢复稳定、长期空闲无泄漏或设备负载预算达标。M2-2 仍进行中。
