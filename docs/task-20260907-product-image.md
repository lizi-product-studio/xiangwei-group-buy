# 商品主图上传与展示

- task_id: TASK-20260907-PRODUCT-IMAGE
- confirmed：用户要求后台新增商品主图上传；用户询问匿名首页展示是否合理。
- evidence-inferred：后台保存硬编码 imageUrl:null；首页、购物车、结算、订单使用固定米粉照片作为缺图替代，导致图文不符。
- default-assumption：保留匿名浏览公开商品，购买及个人订单保持已有登录边界；无图片允许保存，显示中性占位。
- 路由：涉及上传安全与持久部署，实施与独立验收分离，定向安全测试及完整产品检查、E2E；实际发布单独交付运维。

## 冻结范围

1. 后台新建/编辑商品支持单张主图上传、预览、更换和移除；保存保留图片字段，上传失败保留原图，处理上传中的保存及迟到响应。
2. POST /api/v1/admin/product-images，原始 JPEG/PNG/WebP 二进制，限5MB、1600万像素；仅 OPERATOR/SUPER_ADMIN。sharp 受限解码、重编码WebP最长边1600并清除元数据；控制并发、严格随机文件名、不可覆盖写入。
3. 返回 `{data:{imageUrl:"/api/v1/product-images/<UUID>.webp"}}`；公开GET严格文件名、固定MIME、nosniff及不可变缓存，不接受远程抓取。
4. 独立持久图片目录挂载，UID1001可写，保留跨部署文件并纳入备份。Nginx只为上传端点设置6m限额；旧uploads/public-media保持410。
5. 商品无图可保存，旧外部URL保留兼容；新本地引用检查存在。小程序解析相对API图片路径，无图或加载失败显示中性占位，不使用其他商品照片。
6. 非目标：自动删除历史图片、批量改变真实商品、媒体库、重新设计认证或下单逻辑。新用户管理提议另待用户确认，不混入本次冻结范围。

## 所有权与验证

- payment_repair：API/contracts、相关测试、依赖lock及infra配置；不修改前端或执行生产。
- login_ui：后台及小程序实现/定向测试；不修改API、infra、用户project.config或原型。
- auth_review：只读检查匿名边界、上传安全及最终独立验收。
- root：任务记录、接口裁决及汇总；发布运维收到已验收版本后准备部署。
- 保留工作树已有project.config、.codex、prototypes及手机号任务记录，不混入提交。
- 必须验证：正常上传/预览/保存回读、权限拒绝、伪图片/体积/像素/路径拒绝、无图及更换失败、mini真实URL、匿名公共信息和个人数据隔离、持久目录配置；不得用生产用户数据做破坏性测试。
- 状态：本地实现与独立QA通过，2026-09-08正式部署与独立技术后验通过；真实商品上传与小程序显示待用户操作验证。

## 本地实施与检查

- 后端15文件、前端18文件已冻结，清单分别为 `/tmp/product-images-backend-freeze.sha256` 与 `/tmp/product-image-frontend-freeze.sha256`；后者SHA256 `3e6b0fea08e886217fe880849dcf432992ac8c9dfabb2d8a774202eedc13596a`。
- sharp固定0.35.4，lock包含Linux musl x64原生包。本机没有Docker，实际Alpine镜像编码验证列为切换前门禁，不能用macOS结果替代。
- 后端定向7项通过（含权限、格式、像素、元数据、并发、路径、文件失败和重建实例读取）。产品lint、完整typecheck、423项测试、build通过；8项MySQL/Redis测试因无本地测试服务跳过，不使用生产数据库执行。
- 原始pnpm check仍因未跟踪prototypes的21项lint错误失败（`/tmp/product-image-full-check.log`）。仅验证命令排除该目录后执行原产品检查链，不修改原型、仓库lint规则或宣称原始命令通过。构建日志 `/tmp/product-image-build.log`。
- 全量E2E首轮14项旧流程通过、新图片项失败；已证实测试PNG的IDAT CRC损坏，随后修复有效fixture及Antd中文按钮插空格的测试定位。未放宽图片校验。新增图片流程单独重跑通过（`/tmp/product-image-e2e-repair.log`），覆盖真实上传/公开读取/上传中禁保存/保存后编辑保留/无效替换保留/移除；14项旧流程未受该测试修正影响。
- 视觉核查发现原生文件控件英文，已改为中文上传/更换按钮；仅控件与测试增量，typecheck/定向测试/lint/build通过。新增图片E2E再跑1/1通过（`/tmp/product-image-e2e-visual.log`），含720px高窗口滚动到保存按钮验证。
- 最终前端清单SHA256 `f47aa8f267307881a4a79cefe358afb7bb64a0bf4c974dee0bb1749984beaf67`。完整弹窗已由root查看，保留于 `/Users/lizi/Backups/TASK-20260907-PRODUCT-IMAGE/product-image-edit.png`。后端15文件不变；独立QA最终增量复核中，尚未部署，未改真实商品数据。

## 最终独立验收

- auth_review attempt3：PASS，限已审代码与本地产品验证，无OPEN P0/P1。后端15/前端18指纹匹配，独立11项定向测试及2个上传流式探针通过（无效Bearer先401、无Content-Length的超限请求413）。
- 423项产品测试与build/typecheck通过，原14项E2E及最终新增单例分别通过；原始check报错和8项条件跳过如上保留。
- 发布前门禁：Alpine镜像中sharp实际编码、UID1001持久目录可写与备份、Nginx配置检查；生产核心接口和静态版本核查。实际用户商品上传/小程序图片显示需发布后确认，本地结果不替代。
- 本地验收完成时尚未提交/部署；随后Git阶段已完成：local `0ac6ddfa34af9303dfff0e9b76b545ed695ef5be`，remote `638367b2d49f32c826be5018cf55c227efa0fff1`，tree `ed389b93f9b4f33f39f5c25d37d6259f781dcd62`，34文件逐一回读一致，非强制同步。用户现有商品数据未改。
- 2026-09-08用户在具体发布确认后回复“补上……先把这个补上吧”，已交发布运维执行该版本发布，结果待后验。图片目录随服务器保留，不随回滚删除；回滚API将停用新图片路由，已上传文件仍必须留存。

## 2026-09-08正式发布

- 发布运维 `TASK-20260908-PRODUCT-IMAGE-RELEASE` 已完成；API/static `638367b`，镜像前缀 `3597985d0975`，Nginx前缀 `13efd95`，目标仍为192.144.136.205。
- Alpine内UID1001、network-none条件下真实JPEG/PNG/WebP解码重编码通过，输出WebP最长边1600且清除元数据。持久目录750/UID1001，切后仍无用户上传文件；未制造真实商品/订单测试数据。
- 三服务健康，OOM=false/restart=0；数据/schema不变，privacy/AMAP/trial与已有资源约束保留。未授权401、超限413、公开不存在404、非法路径/旧410与三域静态资源核验通过。
- 独立生产QA PASS限技术门禁。部分远端/公网验证依据双端冻结同SHA证据，不扩大为QA自行全部重跑。用户真实上传、保存与小程序查看仍未执行。
- 本机证据 `/Users/lizi/Backups/TASK-20260908-PRODUCT-IMAGE-RELEASE/`；release-evidence SHA256 `597f409aed24608d8a8ed50d28d4094aaee3bab58754ffc65eb021d984f049d2`，backup SHA256 `c6258351c7dae975596b85e397c71facc691f61c817bf2c1cb30ada1a9e1ad1e`。旧版本及图片文件保留以备回滚，回滚不还原数据库覆盖后续用户操作。
