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
- 状态：本地实现与独立QA通过，生产发布待执行。

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
- 当前未提交/未部署，用户现有商品数据未改。图片目录随服务器保留，不随回滚删除；回滚API将停用新图片路由，已上传文件仍必须留存。
