# 跨电脑投屏残留恢复（2026-10-30）

状态：源码修复、自动回归和 macOS arm64 连接真实手机的独立配置恢复验证已完成。交付与最终验证见[独立审查记录](cross-host-store-review.md)。尚未发布新包或在内网 Windows 安装包上复测；当前发布的 dev.2 不包含本次修复。

## 来源与根因

用户提供的 `error.txt` 有七次 `Control recovery blocked by another native capture`，并确认手机此前在其他电脑投屏。旧恢复仅依赖本机用户目录中的 journal，换电脑后没有旧记录，无法清理占用固定 Unix socket 的手机端扩展。应用商店 HTTPS 超时是另一条查询，不在投屏初始化链路。原始日志含设备标识及路径，不复制入仓库。

用户将手机连接 Mac 后，只读检查发现一个随机命名的 Scrcpy Harmony 扩展、单个空闲视频 listener、无 8012 控制客户端，库 SHA-256 匹配内置清单；本机无对应 journal。未读取或保存手机屏幕内容。设备不允许读取其他进程 fd，恢复不依赖该权限。

## 修复与边界

- 前台新建、复用 driver 和失败重试在本机 journal 回收后补充跨电脑检查；后台预热不回收，自己的 standby 和仍有其他本机 owner 记录的会话保留。同一 NativeVideo 实例的并发前台检查合并。
- 仅识别本应用完整启动命令、随机库名和内置清单中的 SHA-256；要求恰好一个匹配进程、可读 PID/starttime、单个未连接视频 listener，IPv4/IPv6 均没有已建立或正在握手的 8012 控制连接。不是按文件名前缀批量杀进程。
- 间隔一秒重复检查相同身份、哈希和 socket inode；终止前在设备上再次检查完整命令、哈希、视频/控制连接及 starttime。确认进程消失才删除该随机库副本。未知库、活跃连接、损坏清单或身份变化均不回收；只读预检异常跳过接管并继续健康控制/JPEG 查询，终止命令及后续清理失败仍传播；不修改另一电脑的转发表、journal 或其他扩展。控制 daemon 继续通过原有独立身份保护恢复。
- 真机发现 HarmonyOS 表头为 `Proto / State`，原检查仅接受 `Protocol / St`。已兼容两种表头，同时修正原有同 profile 转发回收路径；缺行、损坏或未知 TCP 状态仍拒绝。
- 普通 shell 的最后检查到 kill 仍有很短的竞态窗口，不具备 pidfd 原子性；一秒观察也不等于远端主机租约。尚未连接的空闲服务可能被接管。未知历史库、不可读清单和其他固件不承诺自动恢复；不将其他工具正在使用的服务当残留处理。

Socket 状态解释参考 [Linux AF_UNIX 实现](https://kernel.googlesource.com/pub/scm/linux/kernel/git/torvalds/linux/+/534293368afa1a953c283310b82e4dc58309d51e/net/unix/af_unix.c) 的 `unix_seq_show`，并用当前手机实际表格式验证；上游参考不等于所有 HarmonyOS 固件兼容性证明。

## 验证证据

- 首轮新增测试在原实现上 8 项失败，包含没有本地记录不恢复的主路径。两种表头的新增用例修复前各失败，异常 TCP 状态的两项用例也先失败后修复。
- `test/native-video-cross-host.test.cjs` 执行真实恢复逻辑及生成的 POSIX shell guard，仅替换设备文件/信号；覆盖空闲恢复、重复恢复、并发合并、后台/自身 standby/活跃 owner 保护、IPv4/IPv6 连接、未知库、观察期出现客户端、最后检查的 PID/命令/哈希/socket 变化与非法清单。`capture-sessions` 验证前台接入顺序和关闭自己的失效控制连接后再检查；既有 deployment 测试补充真实表头。
- [首轮真机未出图](cross-host-capture/initial-foreign-session.json)：表头兼容缺口导致检查拒绝，记录保留为失败，不从成功统计中删除。
- [真实外来残留恢复](cross-host-capture/foreign-session-recovered.json)：无本机记录，生产恢复清理原残留；三轮 JPEG 实际绘制，首图 4077 / 542 / 516 ms。静止画面导致 native 首帧超时，严格 H.264 断言失败，报告 `passed: false`；只证明该轮恢复和 JPEG 显示。
- [配置 A 异常退出](cross-host-capture/host-a-crash.json)：实际 H.264 绘制 438 帧后强制结束本次测试应用，留下其 native 进程及 A 的 journal。
- [全新配置 B 恢复](cross-host-capture/host-b-recovery.json)：B 本地记录初始为零，自动恢复日志确认走跨电脑路径；三次打开首图 3906 / 523 / 558 ms，分别绘制 484 / 584 / 581 个 H.264 帧。另一个无 cache 的独立 Node 进程通过真实 HDC 检查恢复时，B 的 PID/starttime 保持不变，之后 H.264 帧继续增长。正常退出后 B 记录清空。未重启手机，记录只含统计及实际构建摘要。
- 上述 A/B 是同一 Mac、相互隔离配置的真实设备验证，覆盖缺失旧主机 journal 的关键条件；不能冒充两台物理电脑换线或内网 Windows 发布包验收。真实现场旧残留来源未直接取得旧主机证据。H.264 矩阵之后收紧了非法 TCP 状态的拒绝条件，并在独立审查中修正只读预检异常阻断健康控制的问题；最终自动回归覆盖这些修正，未重复动态画面矩阵。

最终回归统计与源码摘要见 [验证清单](cross-host-capture/verification.json)。下一步：跟进修复 PR 的 CI/审查、Windows 构建与同手机跨物理电脑切换验收、其他固件和真实并发连接竞态验证；发布新包后才能在内网 Windows 使用本修复。
