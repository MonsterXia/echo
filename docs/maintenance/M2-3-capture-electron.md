# M2-3 实际 Electron 捕获生命周期检查

日期：2026-10-23。运行时 Electron 45.0.0，Windows。此检查不连接设备、不读取 HAP 或应用信息。

## 检查边界

`node script/check-capture-electron.cjs [源码检出目录]` 使用实际 BrowserWindow、WebContents、主 frame 与 ipcMain/ipcRenderer。加载生产 `screencast.ts`、`uitest.ts`、`captureSessions.ts`、`captureDriver.ts`，保留安装版 hdckit 捕获及 Emitter 方法。仅替换窗口工厂/页面、缓存与设备传输边界；所有设备回复及帧字节均为合成数据。验证页通过真实 IPC 调用捕获处理器，不加载产品 preload、React 投屏页面或执行 JPEG 解码。

验证用驱动只在测试边界替换传输和初始化停止，并通过公共 on/off 观察捕获监听。脚本使用隔离临时 Electron 配置和隐藏窗口，不启动 HDC。JSON 只包含固定检查结果、事件顺序及实际加载源码的 SHA-256；不采集设备标识、图像或原始应用日志。

## 发现与修正

基线 `e52021a` 上，初版脚本按旧 start IPC 参数验证，实际窗口关闭后捕获监听为 1，失败。引入会话协议后，脚本同步为 create/start/stop 的新参数；首次候选仅依赖 WebContents 的 destroyed 事件，等待实际 BrowserWindow closed 后仍为 1。记录的事件顺序为：closed 时 1，随后外部 close 监听时 1，最终 contents-destroyed 时 0。生产 close 回调内部直接 destroy，解释了 closed 嵌套在 close 分发期间发生的顺序。

据此，窗口创建时将 owner 释放回调同时绑定 close 与 closed，并保留 contents destroyed 兜底。修正后同一检查在上述三个事件处均观察到 0。这个发现来自实际 Electron 事件，不将原先替身事件顺序当作实际证明。

## 结果

[脱敏结果及源码哈希](evidence/M2-3-capture-electron/result.json)记录以下 8 项通过：

- 实际关窗立即释放本地捕获监听。
- 重开的窗口不接收旧会话帧。
- 旧 stop 返回 obsolete，不停止新会话。
- 实际 reload 废弃旧 token，新文档可建立会话。
- 实际 renderer 崩溃释放监听。
- start 尚未返回时关窗，新窗口等待旧启动及清理完成；迟到回复不重新挂上旧监听。
- stop 拒绝仍释放本地监听；停止仍失败时，新 start 不发送设备启动命令，成功停止后可重试。
- 直接 destroy 也释放监听。

`passed: true` 仅表示上述合成传输下的实际 Electron 检查通过。没有手机投屏、实际帧显示、触控、原应用兼容性或长期资源趋势证据。设备 start/stop 没有截止；永久未响应时只能撤销本地路由并保留该设备队列等待，不能声称设备停止或整个捕获链可取消。M2-2/M2-3 继续进行中。
