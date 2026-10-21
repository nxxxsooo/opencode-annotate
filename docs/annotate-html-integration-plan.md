# opencode-annotate：TUI 与 HTML 批注整合计划

状态：2026-10-19 经用户「doit」确认后，已完成本地目录／源码包重命名、显式路由、浏览器增强和 Native Messaging 整合，并完成本机安装替换。GitHub 远端与已发布 npm 标识保持原样，未发布、未推送、未重启共享服务。日常 OpenCode 终端需重新打开以确保加载更新后的 CLI 插件。

## 恢复入口（2026-10-20 完整保存）

- 当前源码／已加载 Chrome 扩展为本地 0.4.1。显式 HTML 分流、侧栏反馈及 Native Messaging 的现行用法以 [README](../README.md#local-browser-enabled-installation) 为准；上游取舍与隐私／交互经验见 [发布包评估](annotate-html-evaluation.md)。
- 验证边界：0.4.1 已通过 29 项核心测试及 16 组隔离 Chrome 回归；13 组真实 OpenCode smoke 在初次整合阶段通过，不把它们记成此次 Save 重新运行的测试。
- 日常安装入口已指向本 checkout，保留原自定义 TUI binary；Chrome 旧 Page Context 已停用，1 条旧草稿已迁移。私有恢复材料位于忽略提交的 `.local/migration/`、`.local/fixes/`，回滚操作见 [releasing.md](releasing.md#local-rename-and-browser-enabled-version)。
- 保存时 Git HEAD 为 `8f1cea6`（0.3.0）；本轮实现、原有 `README.md`／`smoke.py` 改动及新增文件仍在工作区，未提交、未推送。本次 Save 只补文档，不把混合工作区自动提交为发布状态。
- 用户原页面刷新后的最终体验、当前终端热重载和公开发行仍属验证边界；不将这些边界自动转成任务或宣称已验收。

## 0.4.1 可用性修复

- 根据真实使用反馈，取消「查找 → 下拉选择 → Pair」主流程。扩展自动查询会话：只有一个可用目标时仅预选并显示，发送点击才授权绑定；多个目标时选择一次即可。已断开的目标不会自动改投另一个会话。
- 「Send & continue」会先保存当前编辑内容，再发送待处理批注；无需单独先按 Save。原 Save 按钮保留用于批量积累。
- 容器含有隐藏图标、表单或编辑区时，过滤这些子树的文本而非拒绝整块容器。输入控件可用类型／标签作为批注目标，不读取其值。
- 点选成功或失败都退出拦截模式；Esc／取消状态可见，重新启用时清理旧监听器，避免页面点击被持续占用。旧版已注入的页面升级后可能需刷新一次。
- 回归包含隐藏 SVG、CSS 隐藏文本、编辑区、密码控件、失败后正常页面点击、单／多会话选择、发送时自动保存及重复入队保护。
- 0.4.1 已在日常 Chrome 重新加载，确认旧 Pair 按钮消失、唯一在线目标自动显示、Native Messaging 正常，保留 1 条既有草稿；29 项核心测试和 16 组隔离浏览器回归通过。用户截图中的原页面未自动刷新或操作，避免改变应用状态。

## 初次整合执行记录

- 当前本地仓库为 `GitHub/opencode-annotate/`，重命名前后校验了文件字节、权限、符号链接、Git index 与用户未提交改动。
- 本地源码包为 `opencode-annotate@0.4.0`；原远端和已发布 `opencode-plannotator-tui` 包仍可使用。
- 新 Chrome 扩展已启用并固定，授权本地 HTML；正式 Chrome 中的侧栏及 Native Messaging host 均已验证。Page Context 已停用，保留为回滚入口。
- 已备份并迁移 1 条旧批注；原数据不删除。安装与配置回滚材料保留在忽略提交的 `.local/migration/`。
- CLI 配置仅将旧插件条目切换到此 checkout，保留原 `options.binary` 与其他配置。真实无头 OpenCode smoke 使用该自定义 binary 和原有居中边距通过。
- 验证：29 项 Node 核心／协议／原 TUI 回归测试，11 组隔离 Chrome 场景，13 组真实 OpenCode smoke 场景；smoke 的实际消息投递均为 `resume: false`，不调用模型。
- 公开发行、远端命名迁移、跨平台支持和当前终端热重载不在已验证范围。

## 名称与仓库归属

- 项目名称确定为 `opencode-annotate`，以当前独立仓库 `GitHub/opencode-plannotator-tui/` 为演进起点，不合并到 `opencode-plugins`。
- 同一项目提供 TUI 和浏览器两种批注入口，共用会话定位与反馈投递；浏览器扩展仍是单独安装的组件。
- 实施时浏览器增强源码归入本仓库 `browser/`，本机桥接归入 `bridge/`，保留现有插件入口，避免继续维护独立浏览器标注器项目。
- 最终本地目录为 `GitHub/opencode-annotate/`。本地目录迁移、GitHub 仓库重命名、npm 包名迁移分别验证，不把本地安装视为已完成外部迁移。
- 当前日常安装使用本地 checkout；已发布 `opencode-plannotator-tui` 标识保持原样，不发布替代包。

## 已确认的目标

- 基于现成 Annotate HTML 修复已分析的短板，取代 Page Context，不继续维护独立自研标注器。
- 整合现有 `opencode-plannotator-tui` 的 `/annotate`，支持从浏览器一键向明确配对的会话发送反馈。
- 保留原有 `/annotate`、`/annotate N`、`/annotate 文档.md`、`/annotate-last` 的行为和确认流程。
- 浏览器仍可复制 Markdown、导出完整 JSON，供其他 agent 使用。

## 事实来源与改动边界

- 发布包：`~/.agent-reach/artifacts/annotate-html-20261019-3k2f84xn/`，Annotate HTML 1.0.0；保留原始包、哈希和 REA 证据不变。
- 原浏览器工具：`Tuning/plannotator-web-annotate/`，已安装 Page Context；旧数据在替换前导出，不提前卸载或删除。
- 现有插件由 `GitHub/opencode-plannotator-tui/` 本地迁移为 `GitHub/opencode-annotate/`，入口 `tui.ts`、行为 `review.mjs`。
- 已发现插件工作区 `README.md`、`smoke.py` 有未提交修改，属于既有工作，实施时先读差异并保留。
- 本地增强版归入当前插件仓库的 `browser/`，固定上游来源和 MIT 许可；只做本地安装，不新建远端仓库、不发布 npm 或商店、不推送上游。

## 交互与通信

### 已确认的 HTML 触发规则

仅按用户明确指定的目标分流，不根据最近产物、回复里的链接或 HTML 代码块自动切换。

| 输入 | 处理方式 |
|---|---|
| `/annotate` | TUI，批注最近一条完整助手回复 |
| `/annotate N` | TUI，批注第 N 条最近的完整回复；沿用现有正整数校验 |
| `/annotate 文档.md`（含 `.mdx/.markdown/.txt`） | TUI，批注指定文档的快照 |
| `/annotate 页面.html` 或 `.htm` | 打开明确指定的本地 HTML，进入浏览器批注流程 |
| `/annotate https://...` 或 `http://...` | 打开明确指定的网页，进入浏览器批注流程；受限页面明确报错 |
| `/annotate file:///.../页面.html` | 作为本地 HTML 处理，要求 Chrome 文件网址授权 |
| `/annotate web` | 发起当前会话与浏览器批注的显式配对；用户在浏览器启用扩展后批注当前页 |
| `/annotate-last` | 固定走 TUI、批注最近一条完整回复，继续忽略参数 |

HTML 后缀大小写不敏感，支持引号包裹的空格／中文路径。相对路径仍以发起会话目录解析。路径必须存在；不把目录、未知后缀或普通文本内容猜成 HTML，不自动把 `.src.html` 改成另一个 `index.html`。URL 仅接收 HTTP、HTTPS 和明确的 HTML file URL，拒绝 javascript/data 等协议。

浏览器路由只打开并绑定用户明确选择的对象；首次页面访问仍要求用户通过 Chrome 扩展图标／快捷键授予 activeTab，不能借终端命令绕过浏览器授权。目标绑定在发起命令时捕获的会话，不随标签页切换而改投。

### 一键发送流程

1. 用户在目标 OpenCode 会话运行新增的 `/annotate web`。
2. 插件立即捕获该会话 ID／标题／目录，注册一个可撤销的本机接收目标；此时不发提示、不调用模型。
3. 浏览器侧栏自动查询已开放的目标。唯一目标仅预选并显示，多个目标时用户明确选择一次；不自动猜「最新会话」，不跟随终端活跃标签，不对已断开目标静默改投。
4. 用户在页面选字或点元素、写批注；正文及草稿在扩展自身的侧栏／存储中，网页只得到目标高亮和编号。
5. 侧栏固定显示目标标题，目录在悬停信息和可展开的目标选择器中。短按钮「Send & continue」先保存当前反馈，其点击就是本批反馈的发送确认；不再要求独立 Pair 按钮或终端二次确认。
6. `chrome.runtime.sendNativeMessage` 启动本机桥接进程，桥接只连接该用户的 Unix socket；插件复用已认证的 `context.client.session.prompt`，以 `delivery: queue, resume: true` 发回配对会话。
7. OpenCode 确认接收后返回回执，浏览器才把该批标为已发送。回执表示已入队，不宣称 agent 已处理完成。

不开放 HTTP 端口，不把 OpenCode 凭证、服务地址或任意 sessionID 写进网页／浏览器配置。Native Messaging host 按需启动；本地 socket 只在插件启用网页接收期间存在，无独立常驻守护进程。

## 数据与失败语义

- 反馈封包版本化，包含 reviewID、稳定批注 ID／修订、原页面 URL／标题／采集时间、用户批注、选区引用与前后文、元素选择器、位置、样式和无障碍信息。
- 明确区分网页证据与用户意见；不把网页 DOM 元素当作 Markdown 源码字节坐标，也不把网页文本冒充用户指令。
- 草稿按页面地址隔离；SPA 路由切换不混页，同址多标签以批注 ID 和修订合并，避免整页快照互相覆盖。
- 稳定的唯一选择器配合引用／前后文重新定位；目标删除、重复或不确定时标为失效／歧义，不静默改绑。
- 发送前持久化不可变 outbox 批次及 message ID。回执丢失时沿用同一 ID 重试，避免重复入队；发送后的修订属于新批次。
- 目标离线、配对失效、权限拒绝、超限或消息入队失败，均明确报错并保留草稿／待发送批次，可复制或导出；不自动另选会话。
- 网页反馈包及桥接消息上限先定 512 KiB UTF-8；超限提示拆批，不静默截断。

## 修复与权限

- 增加持久草稿、SPA 隔离、完整导出、编辑／删除、剪贴板失败恢复、选择器校验、动态布局重新定位。
- 排除表单、contenteditable、隐藏脚本等敏感上下文；常见 URL 凭证脱敏；导出前可预览。
- Chrome 原生侧栏承载批注正文、列表与目标配对；页面内不插入批注正文，避免原实现共享 DOM 暴露意见。
- 新权限为 `storage`、`sidePanel`、`nativeMessaging`；保留 `activeTab`、`scripting`，不增加全站 host permissions。
- 本机 host 注册于 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/fun.mjshao.annotate.json`，仅白名单允许本地增强版的固定独立扩展 ID。
- 桥接入口使用绝对 Node 路径；Native Messaging 的 stdout 只输出长度前缀 JSON，日志使用 stderr。
- 接收目标注册目录／socket 采用用户私有权限；插件关闭、目标会话删除或显式断开时撤销配对。仅支持同一台 Mac 上的 Chrome 与 OpenCode TUI；SSH 远端 TUI不在首版范围。

## 实施切片

1. **上游基线与扩展修复**：保留来源、许可与原始快照，复用元素指认／标记交互，完成数据层与独立侧栏。增加实际 Chrome 扩展测试。
2. **插件入口与本机桥接**：为现有插件新增网页接收入口及独立模块，保留 TUI 批注流程；实现可撤销配对、原会话投递、回执和重试去重。
3. **隔离联调**：使用临时 Chrome 配置和 OpenCode 测试会话；消息入队测试使用 `resume: false`，验证精确路由而不调用模型。
4. **本机替换**：备份 Page Context 的存储和安装信息；加载增强版、注册受限 host、启用本地 HTML访问；验证成功后停用 Page Context，保留回滚数据。配置只切换这个插件，保留 binary 选项和其他插件，不重启共享服务。
5. **交付**：安装／卸载／回滚脚本、上游差异记录、桥接协议和测试结果。插件安装包必须验证实际加载入口；仅源码通过不视为部署完成。

## 必须通过的场景

- 文字选区、重复文字、跨段中文／emoji、SVG 元素、HTTP/HTTPS/localhost/授权 file 页面。
- 刷新后恢复、SPA 往返、同址多标签并发、不确定元素不误绑。
- 表单／相邻编辑区不进入 context，网页 DOM 读不到批注正文，导出完整 URL 与所需样式，凭证脱敏。
- 剪贴板拒绝、存储失败、桥接缺失、过期配对、目标会话关闭和消息过大时不丢反馈。
- 多 OpenCode 会话、多 TUI 实例、用户切换终端标签后仍发给原配对目标。
- 未配对／非白名单来源拒绝发送；重复点击与回执丢失重试只接收一次；编辑已发送批注形成新修订。
- 旧 `/annotate` 回复／文档批注、取消、空反馈、归档恢复及自定义 TUI binary 回归不变。
- 新安装成功才停用旧工具；失败时可恢复旧插件入口、扩展与草稿，保留无关配置和用户改动。

## 非目标与剩余边界

不支持浏览器内部页、商店页、PDF、跨域 iframe、Canvas、远端 SSH TUI、截图／录屏、自动上传、自动选择会话或跨平台公开发行。点击「发送并继续」会让目标会话发起正常模型执行；配对或保存批注本身不调用模型。侧栏隔离批注正文，但所选元素及高亮仍是网页可见信息。

## 官方接口参考

- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/build/plugins/cli
- https://opencode.ai/v2/docs/build/plugins/rpc
