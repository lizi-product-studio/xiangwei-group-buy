# 资料编辑与同类会话问题修复

## 范围和依据

用户反馈头像选择被微信隐私声明拦截、姓名输入裁切、已绑定手机仍提示授权未完成，并要求按根因反查同类问题。修复基线为本地 `3ceec21`（与 GitHub `accd21d581ba82169fc5978733c08770c2947eef` 的 tree 相同）。

2026-09-21 继续时，桌面主目录处于旧 `main / c7321f8`；使用临时独立工作树完成收尾，保留主目录状态。

## 修复分类

- 会话失效：资料加载、头像上传、保存和更换手机号沿用既有会话代次保护；有效归属的 401 清除页面旧资料并进入统一登录。个人中心、消息中心和开通意向同步处理此前吞掉的 401。写操作不会自动重放。
- 错误状态：表单是否已加载使用显式状态，不再以姓名非空作为依据；取消更换手机号明确表示本次更换取消，保留原号码。
- 布局：明确姓名输入高度、行高和卡片间距；已于 2026-09-16 在微信开发者工具 iPhone 12/13 模拟器检查资料页，姓名和手机号完整显示。2026-09-21 未重新声称真机验收。
- 失效本地选择：服务区实际失效时统一清除依赖的自提点、购物车和结算草稿；仅因查看另一团期而过滤区域，不清除仍有效的数据。网络请求失败不触发该清理。

## 平台待办

截图中的 `chooseAvatar:fail api scope is not declared in the privacy agreement` 属于微信平台隐私声明拦截；代码修复不代表该配置已完成。

需要在该小程序的微信公众平台「用户隐私保护指引」检查实际生效声明，按平台展示的个人信息类型登记：

| 使用位置 | 能力 | 对应用途草案 |
| --- | --- | --- |
| 个人资料 | `button open-type="chooseAvatar"` | 在用户主动选择后上传并展示账户头像 |
| 登录、更换手机号 | `button open-type="getPhoneNumber"` | 账号绑定和手机号更新，支持订单联系与取货服务 |

声明必须与实际平台表单、实际业务和小程序主体确认一致。本文不是已提交的法律声明。`requiredPrivateInfos` 不是头像/手机号声明入口，不向其中添加这两个能力。

平台声明生效后还需真实微信验证：选择头像、保存后重新进入、手机号授权成功/取消、过期登录恢复。此前的数据清理会使原会话失效；客户端显示过旧手机号不代表该会话仍被服务端接受。

## 验证

- 2026-09-21：小程序 TypeScript 检查通过。
- 2026-09-21：36 个测试文件、150 个测试通过，包括失效会话、空姓名取消更换、失效区域清理、跨团期过滤保留有效数据及撤回后刷新失效不弹成功提示。
- Luna 独立复核未发现实质回归或误清数据；提示的撤回后刷新遇到 401 仍弹成功提示问题已修复并补测试。
- Git 差异空白检查通过。仅小程序与本记录变更；不需服务端部署。
- 未执行微信上传、审核或公开发布；平台隐私配置和真机授权结果未验证。


## 用户变更：统一默认头像（2026-09-21）

用户明确决定取消更换头像，所有用户使用默认头像。本决定替代上文头像选择能力的交付要求；手机号授权仍是独立能力，不能据此取消其平台要求。

- 个人中心的登录/未登录态与资料编辑页统一展示本地 `/assets/user-gray.png`。资料页头像为静态展示，没有按钮或 chooseAvatar 事件。
- 移除两页的历史头像下载与资料页头像上传处理；个人资料入口文案改为“姓名与手机号”。旧账号即使保存过自定义头像也不再加载展示该图片。
- 姓名/手机号、登录过期处理继续沿用既有逻辑。保存姓名时按原接口保留历史头像引用，不清库、不删除历史文件；旧版客户端接口兼容保留。
- 定向验证：profile-edit与profile共7项测试通过，覆盖旧头像不下载、保存姓名保留原数据、401恢复和取消更换手机号；小程序TypeScript检查通过，git diff空白检查通过。
- 当前工具无法读取已运行微信开发者工具窗口（noWindowsAvailable），未将代码/单测结果冒充模拟器或真机视觉验收。此变更仅小程序源码，不涉及服务器发布；本轮未执行微信上传、审核或发布。


### 默认头像视觉资产

用户要求默认头像需要实际小图。使用内置image_gen生成“微笑小柿子”：米白底、暖橙柿子和两片绿叶，简洁无性别、无文字；保留圆形裁切留白。运行资产为 `apps/miniprogram/src/assets/avatar-persimmon.png`，256×256、约71KiB，个人中心两种登录态和资料页统一引用；个人资料功能菜单仍沿用线性人形图标。生成原图保留在Codex generated_images，项目仅打包缩小后的文件。

最终提示词（内置工具）：Use case: illustration-story. Create ONE polished default account avatar illustration for 乡味集, a Chinese neighborhood group-buying mini program. A friendly gender-neutral little persimmon mascot: warm burnt-orange rounded persimmon face/body, two simple dark seed-shaped eyes and a small relaxed curved smile, a broad two-leaf deep green sprout on top. Sophisticated minimal flat illustration with very subtle paper softness, not a 3D toy. Warm ivory uniform background #fff4df, burnt orange #c2412d and leaf green #416744, dark brown facial marks. Centered symmetrical square composition 1:1, very large simple silhouette filling 75 percent of frame, generous safe margins for circular cropping, no hands, no props, no letters, no text, no watermark, no decorative rings, no tiny details, no drop shadows. Must read clearly as a personable avatar at 48px and 56px. Output a square PNG asset, ideally 256x256 and compact file size suitable for a mini program.

已直接查看256px产物；包资源3项检查通过，上传源码仍在现有1.2MiB预算内。未读取到微信开发者工具窗口，不声称真机视觉已验收。服务器当前86e27b0的API及后台源码与最新提交相关目录无差异；此后修改仅为小程序和文档，不触发服务器重部署。本轮资源须随微信新版上传发布。
