# Beta Update 状态反馈

日期：2026-10-31（Asia/Hong_Kong）。基线 `ef387af`，分支 `codex/fix-beta-update-feedback`。

## 复现与修复

Windows 本地完整构建中，用真实标题栏菜单点击 Beta Update：主进程设置和 DOM 的 `aria-checked` 从 false 变为 true，但界面不显示勾号。`src/share/renderer/main.scss` 中 `.cet-menu-item-icon { width: 0 }` 隐藏了 checkbox 图标；原有单测只覆盖逻辑值与刷新消息，未检查实际图标尺寸。

现在移除零宽度覆盖，所有菜单行保留组件原生的 14px 图标栏，让文字统一左对齐；勾号显示在独立图标栏。菜单同时显示 `Beta Update: On / Off` 或“接收预发布更新：已开启 / 已关闭”。点击保存后刷新标签，重建菜单从持久化配置恢复状态，更新筛选规则保持原有行为。首版只恢复 checkbox 宽度造成该行缩进，经用户指出后修正为所有行统一图标栏。

## 验证与边界

- 新增中英文菜单状态回归，在旧源码上因缺少状态文字失败；修改后菜单、更新配置、国际化共 16 项通过，lint/词条检查通过。
- `node script/check-beta-menu-live.cjs <证据目录>` 使用隔离用户配置，真实 Electron/标题栏 DOM 点击和生产设置 IPC；在旧构建上因 checkbox 宽度为 0 失败。脚本覆盖中英文、深浅色、开/关两方向和分别重启后的状态，并保存菜单局部截图。
- 完整回归：应用 793 passing / 1 项 Windows 不适用的 POSIX shell 测试跳过 / 0 failed；Licia 两模式各 606 passing / 4 pending。完整 build、最终样式的 renderer 重建通过。
- 最终 Windows 实际菜单验证通过：两种语言 × 两种主题，各检查关闭、点击开启、重启保持开启、点击关闭、重启保持关闭，共 20 个状态；图标尺寸、可见性、状态文字、IPC/磁盘配置及所有非空菜单文字左边缘一致。见[运行数据](beta-update-feedback/verification.json)、[中文开启](beta-update-feedback/enabled-zh.png)、[英文关闭](beta-update-feedback/disabled-en.png)。对齐探针排除了分隔线的空标签，不把空标签位置当作菜单文字。
- 独立复审和 PR 必需 CI 以交付 PR 为准。该探针专门验证 Windows 自定义标题栏，不冒充 macOS 原生菜单或真机投屏验收。

下一步：完成 PR 必需 CI 后合入，并在后续开发版本中交付；macOS 原生菜单人工验收待办。本轮未发布新版本或替换已安装应用。
