# M2-2 / M2-5：端口映射弹窗读取生命周期

日期：2026-10-23。基线：`0bcbcca71a59b1b52b6f1e60e154ae51338f126e`。分支：`codex/m2-port-mapping-lifecycle`。状态：无设备回归通过；M2-2 / M2-5 整体仍进行中。

## 来源与范围

前轮概览验收发现，隐藏的 PortMappingModal 挂载时也调用 listForwards。本轮核对实际 `Overview.tsx`：它始终挂载该弹窗，初始 visible=false；再核对 `PortMappingModal.tsx` 的 mount effect 和无 catch 的 refresh，建立真实组件失败证据。此缺陷不等于上游长期空闲或无线连接问题的根因。

在独立 worktree 使用独立依赖和构建输出，仅修改该弹窗、独占测试和对应维护资料。并行设备参数读取任务负责主进程，本轮不修改主进程、preload、公共 API、锁文件或 CI。未操作 HDC、手机、HAP、真实端口或内部应用；所有设备 key、映射和错误均为合成样本。

## 修复与保留语义

- 只有 visible=true 且存在当前 connectKey 才读取；关闭、无设备或目标变更会清空列表与选择。重新打开会重新读取当前方向。
- 每个可见期/设备有独立的读取函数和清理标志；卸载、关闭或设备切换后旧结果失效。App 的设备 key 重挂载和组件自身 target 更新均有回归覆盖。
- 同一可见期内按发起顺序递增请求号，只有最后发起的读取可以发布结果或提示。方向改变立即清空旧列表/选择并读取新方向；旧成功不能覆盖新列表，旧拒绝不会清空新结果或重复通知。
- 新读取开始清空旧列表和选择，防止用户在方向切换或刷新期间删除旧记录。活动读取拒绝被消费并显示既有 commonErr 通用提示；不会产生自动重试，用户可手动重试或关闭后重开。
- forward(local, remote)、reverse(remote, local)、removeForward/local-remote 与 removeReverse/remote-local 的顺序、normalizePort 和原写入错误提示均保留。只把写入成功后的读取回调绑定到发起写入的弹窗可见期，关闭/切换后不启动隐藏或新会话的读取。已发出的写入不会被取消，迟到写入错误仍按既有写入语义提示。

这里选择“最后发起的读取生效”，没有合并或串行排队：较新的手动刷新和方向切换可直接发起，不必等旧请求完成；已经发出的 IPC 仍可能并行。此保护不取消底层 IPC、不设总截止、不停止 HDC，也不保证端口操作完成。重新打开的查询早于旧写入完成时，用户仍可能需要手动刷新查看设备最终状态。

## 验证证据

`test/port-mapping-lifecycle.test.cjs` 执行实际 PortMappingModal 和 normalizePort，使用真实 React、MobX、createPortal、安装版本的 Luna Modal/Toolbar/DataGrid。Luna ESM 通过 esbuild 打包，保持与 Vite 一致的模块解析；布局 API 与共享 ToolbarIcon 是替身，bridge 使用受控 promise。选择经过真实 grid.selectSingle，方向变化经过真实 select DOM 事件；部分异步操作通过实际注册的处理器调用以便等待返回 promise。不复制读取算法，不加载主进程、连接设备或创建真实转发。

- 首轮 16 项在旧实现上 **3 通过、13 失败**，退出码 1：隐藏读取、重开/目标更新、迟到结果/拒绝、方向竞争、StrictMode、写入完成后的隐藏读取等。原正向/反向写入参数用例及 App key 重挂载隔离成功结果的用例原本通过，不计为原有缺陷。
- 修复后新增初始 effect 拒绝、旧写入跨关闭/重开、写入失败保留行为三项，最终专项 **19/19** 通过。
- 全量 `npm test`：**380/380**，0 跳过；`npm run lint`、`npm run build:renderer` 通过。构建保留既有 Vite/Sass 弃用与大 chunk 提示。
- 测试本身无需共享子模块。renderer 构建使用该独立 worktree 初始化的只读子模块源码，不修改子模块、不共享可写依赖或输出；未下载设备资源或启动 Electron。

## 下一步与验收边界

最终提交、独立审查、五项必需 CI 和合并状态以交付 PR 页面为准；本聊天不自行合并或发布。独立审查不能代替实际设备验收。

尚未验证真实 Electron 弹窗布局、HDC 映射列表格式、设备转发/反向转发、物理断连或无线环境。后续由设备负责人在授权环境验证打开/关闭/切换设备与方向、失败恢复及原有添加/删除流程。M2-2 的长期空闲及 M2-5 的无线、授权、物理断连验收保持待办。
