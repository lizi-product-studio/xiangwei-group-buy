# 活动与履约 V2

## 用户确认与范围

2026-09-28 用户确认 prototypes/operations-v2-concept-20260928 原型：“我觉得没问题，这次可以开发去了（尤其是开发之后测试阶段，要确保无任何问题）”。目标为实现已展示的后台与小程序链路，开发完成后充分风险验证、独立 QA 复验。此前存储迁移的停止测试/容量豁免仅用于已结束旧轮，不用于本轮。

确认基线：一个活动覆盖多个自提点；成团口径可配置各点独立或所有参与点合计，按已支付商品件数；库存按点分配、点位可设置不同领取时间；达到门槛仍可购买至截单或售罄。保留现有单点活动及历史订单兼容。跨点合计不混合订单归属、点位权限、配送与核销。

## 验收项

- V2-01：后台创建/编辑多点活动，产品、截单、成团口径、最低件数以及各点库存/领取时间实际保存；列表与小程序读取同一规则。活动与点位履约实体清楚，禁止通过UI组合造成重复销量。已发生交易后的配置修改不能改变历史事实或无约束重分配库存。
- V2-02：各点独立及跨点合计两种成团判定；截单、退款、取消与重复任务/并发回调一致；件数只计适用支付状态。库存按点扣减/释放，不能超卖或串点。原型的未达标取消退款为候选表现，落实时须核对既有正式顺延约定，若实质冲突先报告明确差异，不能暗改规则。
- V2-03：小程序按团期呈现商品、截单及领取时间；切换点位只展示可购团期；详情说明成团口径/进度/达标后继续购买。沿用现有购物车、合并支付、支付结果与返回恢复流程。
- V2-04：历史订单展示购买时商品信息，不依赖当前公开活动；订单筛选与加载更多有后端分页支持、稳定顺序/无重复遗漏；兼容旧订单缺快照场景且不捏造历史。
- V2-05：后台活动、订单、财务入口及详情支持URL/刷新/前进后退；订单取消核对支付并处理微信关单、迟到回调、未知结果；不以本地取消替代渠道状态。相关权限与幂等成立。
- V2-06：财务对账展示有来源的支付/退款/净额差异、核查记录与处理状态；实际数据不硬编码，不以登记核查冒充已同步/退款成功，不擅自更改原账单/订单金额。落实范围为原型展示的对账及人工核查闭环，未展示的自动调账不纳入。
- V2-07：后台与小程序关键页面渲染、移动布局、空/失败/加载/不可售状态；沿用现有视觉与既有功能，不把原型评审说明放入消费者界面。

## 版本与所有权

主仓 /Users/lizi/Desktop/拼团项目，起始 HEAD ef456000bfb71bb403a3923b5ea5807f2ca77ab4。已有 AGENTS.md 修改及所有未跟踪原型、用户文档、output 均保护。
唯一业务写入者：工程执行·开发修复（二代）01a0e5e9-65b5-7bd2-ba3f-c12a8843e19d。其 ae57 工作树先核对版本和未提交差异，再通过正常 Git 整合主仓基线，禁止 reset/覆盖资产。主编排只维护本记录并整合冻结候选。QA 为质量审核·验收复核（二代）01a0e5e9-65b5-7bd2-ba3f-c103c55e68a8，只读审核冻结对象。
本轮研发及QA各请求 high：跨端状态、金额和并发影响；不更换模型。冻结/风险变化时重评。

## 验证与交付

先实现与必要自测，再冻结候选交独立QA；必要真实MySQL/Redis验证使用180.76.100.156专用隔离资源，主编排独占服务器写入窗口，工程/QA先报运行方案不自行写服务器。只创建本轮可归属合成数据，结果保留后清理，不接触正式数据。已清理旧测试库不作为新结果。
必要覆盖：双点/多团期、阈值前后及边界、并发最后库存、重复/乱序回调、取消与支付竞争、部分退款后的数量口径、截单任务重放、跨点权限、旧订单/旧活动、分页边界、前后台一致、相关索引与有限资源代表性负载。各检查绑定版本/配置，缺失与跳过不得写通过；不为零缺陷承诺无限扩展。
本轮先完成开发与同版验证。服务器发布仍按既有授权和质量门核对后执行；新的不可逆迁移、真实交易、微信公开发布不由本次开发许可自动扩大。真实支付/履约的R-01由用户执行，mock不替代真实证据。所有影响本次交付的问题经修复复验关闭后才交付；其他建议单列。

## 当前状态

启动：主编排已核对主仓版本及两固定角色均idle。待工程提交方案/影响文件后实现、自测、冻结；QA待冻结候选。

## V2-08 自提点名称与地址重复（用户补充已确认）

用户澄清：不是首页/购物车/我的三个入口重复，而是同一张卡片的点位名称与下面地址重复表达“定兴三中”。2026-09-28 用户“开始吧”确认按以下方向开发：保留三处入口和页面结构；名称保留，地址仅在提供额外有效定位信息时展示，重复地点部分可省略；完整原始地址仍可在点位详情查看。具体门牌、校门/入口、楼栋/取货位置必须保留，不编造位置，不修改地址数据库或导航坐标。不能用简单包含关系把具有新定位信息的整条地址隐藏，不确定时保留。核对当前真实字段及地址构成选择最小稳妥展示实现；必要时统一展示函数避免三页面各自不同规则。验收覆盖完全重复、仅行政区划+同名地标、含独立门牌/入口、不同地址、空值及长文本；导航/电话功能保持。
主编排前一条拟删除购物车点位卡片的误解已撤回，未授权删除该卡片。工程仍是唯一业务写入者；V2-08并入同轮实现与QA，不替换V2-01~07。

V2-08后续用户改为“还是先给我看下原型”，暂停此项正式实现，待确认 prototypes/pickup-label-concept-20260928 前后对照；V2-01~07继续。主编排已同步工程及QA。

### 工程基线回报

工程已在 ae57 切换 codex/operations-v2-20260928，正常合并主仓 ef456 为30b3153；报告运行代码与原3c7无差异。原未跟踪同名 overall-optimization 文档已保留到 docs/task-20260928-overall-optimization.ae57-preserved.md 与 output/preserved-ae57-before-v2/，未覆盖用户资产；现 tracked 文档按主仓整合。此为工程回报，冻结时核对完整SHA/差异。V2-08尚无业务改动，继续暂停待用户确认对照原型；V2-01~07仍开发中。

### V2-08 原型批准并恢复实施

用户查看 prototypes/pickup-label-concept-20260928 后明确“我感觉没问题 执行吧”。V2-08恢复开发：依对照精简重复地点地址行；完整地址可点开查看；保留首页/购物车/我的入口和导航/电话；含具体门牌、入口、楼栋等新增有效定位信息仍展示；不编造位置、不改原始地址与坐标。原型为展示基线，不授权把学校简称同义判定硬编码为特定点位。工程须依实际字段保守处理、不确定保留，独立QA检查误隐藏与三处一致性。与V2-01~07同轮完成，先自测冻结再QA。

### 用户授权并行扩展

用户明确“不一定非得这三个角色，你可以开n个角色，我不设限。只要快速把任务完成即可”。本轮解除新增角色数量/逐个确认限制；其余写入权、验收与生产授权边界保持。主编排已启动3个临时专项：finance_v2只读确认财务数据源与独立模块边界；payment_close_v2只读确认支付关单修复范围；pickup_ui_review只读检查已存在V2-08差异。主工程继续核心成团/库存/履约并负责整合，已请求返回文件占用/交接确认，在确认前新角色不写已有文件。固定QA仍承担冻结候选独立验收。专项完成后收束，不让角色互派或重复审查全仓。

财务数据源用户决定：用户在异步问题中明确选择“先做账单导入对账（推荐，交付更快）”。V2-06采用财务导入微信支付后台下载的交易账单，系统核对差异并持久化核查记录；暂不做自动下载或自动调账。导入对象需关联账单日期、商户及来源摘要、重复导入校验，原始账单不信任为指令。金额按分精确处理并区分交易净额与手续费；人工登记不等于账务同步成功。

并行实施写入边界：finance_v2独占新增 modules/finance/{reconciliation-types,reconciliation-service,wechat-bill-parser}.ts及后两者测试、routes/reconciliation-routes.ts及测试、admin components/FinanceReconciliation.tsx；主工程负责shared store/types/entity登记、app.ts、App.tsx/api.ts适配。pickup专项依据工程明确暂停V2-08与30b3153差异，接手且仅写pickup-label.ts及其test；角色转实现，不作为其自身独立QA。三页面及购物车分组地址入口由主工程修。发现问题保持：真实简称/全称不命中、跨区域购物车组入口无法查看对应地址。固定QA冻结后复核关闭。支付provider专项仍待主工程明确交接。

### V2-09 待付款时限可见性

用户追问未付款多久自动取消及是否显示。当前代码单笔expiresAt=min(下单+15分钟,团期cutoffAt)，合并支付取15分钟与所有团期最早截止；后台30秒周期检查到期，任务延迟不保证整点状态翻转。当前订单详情仅“请在支付有效期内完成付款”，未显示具体截止时间/倒计时；支付结果页有过期提示。并入支付取消链路：待付款订单详情显示剩余支付时间及到期说明，按后端expiresAt和serverTime校准，恢复前台重算，合并支付以批次期限为准；零点禁用继续支付并查询真实状态，不仅靠客户端宣告取消/退款。未支付不叫退款，已扣款迟到结果按已有核对/退款路径显示。无需改15分钟业务规则。新增UI若需用户预览可沿既有订单卡局部展示，不扩展重设计。

阶段结果：pickup专项只改helper/test，用户真实案例及保守边界定向4组通过，已交回主工程；多点购物车完整地址入口仍由主工程完成。finance专项8文件已完成并停止写入：解析/差异/核查/组件，定向13项及当时API/admin类型检查通过；尚缺主工程持久化、实体登记、权限与页面挂载、MySQL和浏览器验证，未称交付完成。payment专项新增provider close测试草案，因现有provider写入权尚未确认而未实现，暂不能把整树typecheck失败当最终候选结果。

测试通道只读预检：主编排SSH BatchMode+known-host验证连接180.76.100.156成功；当前无运行Docker容器，MemAvailable2587MiB，磁盘可用18GiB。仅核对通道/资源，未创建库或写测试服务；候选冻结后按本轮专属资源与限制运行，不能将此预检写成业务验证。

支付provider交接完成：工程通过正确线程消息明确payment-provider.ts无其未提交改动并停止写入，允许支付专项独占该文件及close.test。主编排已授予专项立即实施query/close/time_expire/签名204与异常分类。PaymentService、OrderService、取消路由、共享适配和晚回调/取消恢复仍归主工程。上一轮交接延迟因回复使用本线程collaboration根路径，现已纠正为主编排线程消息通道。

支付provider专项完成并交回：两文件，26协议测试、11并发及1部分退款回归通过，API typecheck/diffcheck通过；未真实请求微信，尚需主工程取消恢复/库存/批次接线。接口对自定义mock兼容为可选，但生产缺query/close必须fail closed。微信不足一分钟支付窗口会延长，provider拒绝剩余<=60秒新下单，整合须处理用户提示/既有预支付可重试边界，不能误报已取消。
主工程报告倒计时/cart/pickup定向11测与API/miniprogram类型通过，未冻结。成团前取消退款是否扣量及达标后可回落的问题已发用户异步确认，依赖此决定的最终成团规则暂不定案，其他实现继续。

财务辅助审查问题保持编号：F-01/P1标准ALL特约商户号0误拒绝；F-02/P1官方反斜杠转义双引号解析失败；finance专项仅恢复parser/test两文件修复与官方完整样例测试。F-03/P2商户筛选在分页后，主工程修types/routes/store查询前隔离；F-04/P2相同requestId不同内容并发可能返回他人记录当成功，主工程补原子返回内容复核/冲突及并发测试。4项均OPEN，未因已有13测试通过而关闭。辅助审查只读8文件前后hash一致，原parser ad7e3ea73cad0ce69b6e34da8a82e2ee77a624e8ed02c5a1a9ec5d725470b08e。

财务F-01/F-02关闭依据：parser专项以完整官方ALL样例修复，3文件16项定向通过；原独立只读审查者复核两文件hash一致并确认两项关闭。parser=4fea95206dcf0e659c69ab26a2fd3f3d0ed4d5bf3545d49ba9b8310d9fd56dd1，test=9dcfbe0524d80a0db82f29b2e010732ea3e4132e952c2759be4daa02cfc911f5。F-03/F-04仍OPEN，持久化/权限/页面整合与真实MySQL未验证，非财务整链通过。V2-09用户ok明确确认并继续实施。

固定QA provider正式结果：PV-01/P2 OPEN，SUCCESS/REFUND查单总额0被接受，provider自身应严格>0（未证明能绕过上层订单金额匹配）。其余签名204/错误/NOT_FOUND/状态/超时边界通过专项；整体取消链路及60秒接线仍未验收。已结束旧冻结审核，原支付专项独占两文件做最小修复与签名0金额两状态回归；新hash再交固定QA复核。

PV-01修复已提交增量QA：SUCCESS/REFUND总额改为严格>0，新增两状态签名零额拒绝；provider专项28/28通过。冻结provider hash8ac658206047ffeaa45c12e8d9cdd43e2da2d7332c93da3300387afac7bc9b04；close.test hash8f14faf00d8dd47b162af3ffebe66894d460e657c0e9a157413d7cfd96d1f094。状态FIXED_PENDING_QA，未提前关闭。主工程报告消费者取消与过期任务已接同一查单/关单/复查路径，渠道未知保留库存，生命周期回归通过，仍待冻结完整验收。

PV-01已正式关闭：固定QA核对新hash及基线30b3153，成功/退款查单金额严格>0，两零金额拒绝用例，28/28通过，无新反例。仅provider小批次通过，不代表V2整轮。
工程最新回报：API398通过/31跳过、小程序204通过、后台100通过、root typecheck含e2e配置通过；此后paid_at索引与60秒支付用例改动已定向测试/API类型通过。主编排尚未核实完整命令证据，已请求冻结可独立验收批次及31跳过项/测试机命令。共享Store/App/payment-service/order-service仍未冻结，V2整体尚未验收/发布，成团退款口径待用户答复。

## 2026-09-29 成团件数最终规则确认

用户对A/B明确回复“按你推荐的来”，批准方案A：截单前取消订单或退款应扣减成团有效件数；已达到门槛的进度允许回落，不锁定此前达标结果；最终按截单时有效已付款商品件数判定。例：门槛20件，付20件后退2件则为18件、还差2件。未达标沿用活动failureAction，最多顺延一次，再次未达标取消并创建原路退款义务。该决定解除V2-01~03的成团口径阻断。按各点独立/所有参与点合计配置分别计算，不能因拆分订单/配送计划重复计数；部分退款要关联退货数量，不把退款金额简单按比例折算件数。支付/退款处理中或结果未知的口径需与既有状态及最终核对一致，不能当作已成功退款或已支付；已完成截单/履约的历史事实不追溯改写。

9月29恢复核对：ae57仍HEAD30b3153605506ad42aef3e01d73c01d652adf15a，业务差异未提交，未把昨日测试当新冻结验收。工程线程发送恢复指令成功。旧固定QA线程发送返回thread not found（notLoaded历史仍可读），未假称已通知；待候选冻结时按用户已授权临时多角色，用新的独立只读QA接替验收，保留旧问题与PV-01关闭证据，不重置历史状态。

工程9/29恢复回报补充：ae57分支codex/operations-v2，HEAD30b3153，仍未提交。报告上一轮API402通过/31跳过、mini205、admin100及三个typecheck通过，与此前计数不同，应以具体版本日志核对；“17/4 E2E”含义未清，已要求明确失败/跳过/通过及日志。lint96项声称既有，尚缺同配置基线证据，不据此免责本轮引入。31skip确认为未配置真实MySQL/Redis。主仓记录按绝对路径只读，无需复制覆盖ae57；服务器窗口仍由主编排独占。

### 明确未完成范围与失败（工程9/29回报）

E2E实际为21项：17通过/4失败/0跳过（5.8分钟），失败campaign-crud heading超时、operations-closure订单搜索框超时、pickup-location-recovery Select overlay拦截保存、role-defaults菜单点击超时。证据ae57/test-results/.last-run.json及对应trace.zip；不能报浏览器通过。首次无浏览器启动失败另列环境，不混入21项。
V2-01~03多点核心尚无模型/API实现，现Campaign仍单区域/计划，库存键campaign+sku；须兼容逻辑活动/点位独立库存归属，实现合计与独立两口径。V2-05 URL状态仍未实现。V2-04/06/08/09及取消接线已有未冻结实现。V2-07等待相关页面失败闭合。lint96归属未明，不能称既有。
真实集成31项未跑：mysql-redis9、mysql-store.snapshot19、consumer-public-number-migration3；候选冻结后专用数据库/Redis配置REQUIRE_INTEGRATION_TESTS=true REQUIRE_ENTITY_STORE_INTEGRATION_TESTS=true及对应三种URL，跑这三个测试文件。主编排独占服务器窗口。

### 第一批冻结与独立审核启动

已核完整候选e4d0b58c84652b1b9c6d8e77aacb510fefcd3bdd（47文件，1594增/49删），范围V2-04/06/08/09及V2-05取消/provider，不含多点核心与URL。源归档output/v2-20260929/e4d0b58-source.tar.gz，SHA256 a955d5042983f53b390df75ff44ddbc86def460455c735eacb6622e6951bb06a。新独立qa_batch1按冻结git对象/独立快照只读审核，工程继续后续提交。
QA首报QB1-01 OPEN：订单状态筛选仅已载20条客户端过滤，需后端筛选再分页；QB1-02 OPEN：取消查单发现已付款返回已付订单，小程序仍提示已取消。已交工程整改，等待完整证据/新候选复核。
E2E专项已从只读转执行：工程确认campaign-crud/operations-closure/role-defaults/pickup-location-recovery四spec无改动并停止写，授权专项只改四测试；3项旧词/定位器匹配现有语义，保留行为权限断言；第4项Select浮层需复现，不force click/扩大timeout。App.tsx仍工程独占。服务器集成尚未运行，需核LEGACY/ENTITY套件适用及初始化方案。

工程多点核心进行中方案：e4后新增CampaignGroup统一标题/阈值口径/failureAction/子campaignIds/version，旧Campaign无groupId兼容；各点保留Campaign/DeliveryPlan/独立CampaignItem库存；统一商品价、按点库存及dispatch/arrival。拟复用实体存储新collection和group投影，不改DDL。当前仅实施第一步，创建/开售/关团/退款规则测试、后台表单、小程序合计呈现仍待。已要求完整collection登记/导入导出恢复兼容、统一cutoff与顺延窗口、唯一订单行计数、退款截单并发、库存权限及交易后配置约束验证。

### 首批QA正式FAIL及返修

独立qa_batch1固定e4d0b58，报告已保留output/v2-20260929/QA-BATCH1-e4d0b58.md及反例qa-batch1.evidence.test.ts。QB1-01/P1状态筛选假空且无法加载；QB1-02/P2取消发现已付前端仍报取消；QB1-03/P1过期initiationClaimToken无payload永久阻止渠道核对/取消并占库存；QB1-04/P1成功退款时间未知且账单未含时漏退款/差异却complete=true；QB1-05/P1旧ENTITY支付paid_at为NULL，新写映射改用succeededAt未兼容旧索引，按日漏历史支付。01~04运行反例确认，05旧新序列化差异确认并待真实MySQL复验。5项OPEN，已派工程按编号整改，不发布e4。
F-03/F-04服务/Memory独立8测通过，MySQL并发持久化待测；财务路由权限20测、地址/cart/detail12测独立通过，不抵消上述失败。PV-01指纹一致沿用关闭。
E2E专项已停止写入，3spec定位器修正8增8删分别通过，相关证据ae57/output/e2e-triage-three-fixed与operations-fixed；运行期间业务树变化，仅定位器定向证据非最终候选全量通过。第4Select保存遮挡在e4单项稳定复现，OPEN，业务组件归主工程修，未force click/延timeout。31项数据库集成仍待新候选适用验证。

## 用户授权主编排持续把关（9月29）

用户明确“他们返回结果你来把关…再上线…项目都交给你”，主编排负责持续整合/独立验收/整改闭合与按现有具体授权交付，普通技术细节不重复询问。此授权不把未测试说通过或扩大真实交易/不可逆迁移/微信公开发布范围。已在当前线程创建heartbeat自动跟进v2（ACTIVE，每10分钟），查看执行返回并推进，仅实质变化/需用户行动/审核或交付结果通知，无变化安静；任务完成停用。既有三角色负载巡检职责不改。

### 9月29日09:07自动跟进

工程线程仍active，增量游标`4f9afc3a-7168-4f3f-885b-a236c2c75aab:46`，未重复派发。实查ae57 HEAD仍e4d0b58，后续整改/多点核心尚为未冻结差异；工程报告订单筛选与财务未知退款定向回归、小程序205项及后台类型检查通过，正在补分组活动后台入口、小程序展示和成团回落/库存隔离用例。该报告不替代独立复验，QB1-01~05及Select仍保持OPEN，真实MySQL和正式发布均未进行。待新候选冻结后复用独立qa_batch1按稳定编号验收；不对开发中源码重复开展整轮检查。

### 9月29日09:17核心规则纠偏

实查ae57 HEAD仍e4d0b58、工程active，游标`4f9afc3a-7168-4f3f-885b-a236c2c75aab:47`。新增V2-CORE-01 OPEN：当前未冻结closeCampaignGroup将PER_POINT用quantities.every汇总，再给所有点统一nextStatus；因此一点达标/另一点不足会整体顺延或取消，与已批准各点独立成团冲突。已交工程同轮修正为逐点判定、未达标点按failureAction处理，已成团点不受其他点顺延/取消影响；组状态、调度和操作预览随实际目标适配。统一初始截单与原子决策不能改变独立成团语义。新增生命周期测试退款后两个点均不足，尚未覆盖混合结果反例，要求补足并在冻结后独立复验。已完整读取最新focused-delivery并同步工程读全文按需应用要求；原有QB1/F/Select状态与发布限制保持。

09:37跟进：工程仍active、HEAD e4d0b58未新增冻结提交；游标`4f9afc3a-7168-4f3f-885b-a236c2c75aab:49`。工程报告独立成团混合结果/仅失败点顺延回归通过，V2-CORE-01仍待独立复验；后台URL恢复及订单/账单详情直达已实现并在自测，API报告408通过/32跳过，已要求说明比此前31新增的跳过项。读取线程确认命令执行成功（contracts/API/admin类型、生命周期/调度测试、后台构建），未外推浏览器/数据库通过。已向工程重申已确定的微信账单导入范围和当前记录绝对路径，避免重复等待财务选型；独立QA仍由主编排安排qa_batch1，待完整冻结候选后执行。

### 候选2冻结、真实数据库与独立QA（9月29日09:55）

基线e4d0b58+32个tracked业务/测试文件及新增url-state.spec.ts，排除用户AGENTS差异。主编排复算combined diff SHA256 `8b91d0c6e2a7c01d071e27c769b5709b078eb2c81d633cd2846658f79b0ed689`匹配工程，源包`output/v2-20260929/candidate2-source.tar.gz` SHA256 `ca4c643ac97d7cfe8204670c70ebaf31e815f4e0763a0f98f001b0eea2308077`，独立QA在/tmp/qa-v2-candidate2审核。未提交候选不含其他未跟踪用户资产。工程报告21原E2E+1URL通过、API408通过/32跳过、admin101通过；完整stdout主要在工程对话，不能拿旧triage trace作新候选成功证据。

测试机180.76.100.156已创建本轮专属internal网络及容器`v2-20260929-c2-{mysql,redis,runner}`，MySQL8.4/Redis7.4，Node22.23.2，源包远端摘要一致，依赖锁摘要与现有运行镜像一致。仅使用v2_legacy/v2_entity合成库；临时凭据在测试机私有文件不入报告。0001~0005初始化；ENTITY通过数据库身份校验和prepare/verify/activate，单写入者确认仅限专属空测试库。LEGACY三文件29通过/1失败/3ENTITY适用项另跑；失败V2-DB-01为旧精确SQL断言忽略只读mode查询。ENTITY专用3项+前置4通过，含QB1-05；F03/F04独立QA跨真实池探针2通过。证据同目录candidate2-legacy-tests.log、candidate2-entity-tests.log、candidate2-finance-mysql-tests.log及qa-finance-mysql.evidence.test.ts。两模式结果不是全套零失败；保留V2-DB-01待整改。测试资源为后续复验暂留，完成后清理本轮容器/卷/网络与私有临时文件，不碰其他资源。

独立QA集中返修：QB1-01仍OPEN（品质售后订单在AFTER遗漏）；QB2-01/P1 OPEN（4新增路由未登记权限映射，正确授权员工403）；QB2-02/P1 OPEN（进度计入REFUNDING未成功退款，但截单未计入，1已付+1退款处理中进度2却判不足）；V2-DB-01 OPEN（最小修精确SQL断言，保留单连接/单payload/无写无锁断言）。已将四项一次交唯一工程写入者修复并新冻结。V2-CORE-01混合独立成团具体缺陷独立3例通过，QB1-02/03/04独立复验通过；QA核对真实数据库日志后关闭QB1-05及F03/F04。CampaignGroup真实重开持久化证据尚待。当前候选不发布，正式机和微信未更新。

09:56补充：CampaignGroup独立真实ENTITY重开探针1/1通过，验证组/两子团期关联、版本更新与过期版本拒绝、再次重开读取。证据output/v2-20260929/candidate2-group-mysql-tests.log及qa-campaign-group-mysql.evidence.test.ts。该结果关闭此持久化证据缺口，不抵消当前四项返修。

09:58独立QA候选2正式FAIL报告已归档output/v2-20260929/QA-CANDIDATE2.md。本轮实际解析器hash为76c717efd9e8dd418d7b15eda0f2352ed654e280da7872732ff7713591a82aef，与e4一致、与早期记录4fea不同；QA解析7例独立通过，F01/F02沿新证据关闭，不误称旧hash相同。原验收缺口已随四项整改一次同步工程：V2-03同点两团期实际渲染对照（当前首页展平待核），成功订单/账单及员工权限URL浏览器场景，以及新增组规则受影响并发边界。已有同版证据可复用，缺证据不报整体通过。工程active游标53，本轮未重复派发执行实例。

### 10:21候选3增量复验

基线仍e4d0b58，diff SHA256 a412416dcc3d491fa10da95adbca726b07ec81520de7de61afbcbe4403a312c8，源包SHA256 19bcdf0d7864c20fc4d3b341eb154ab0e3dccf00648b6805b190ef0ca0cb7180，均归档output/v2-20260929/candidate3*，独立QA已核对。工程保持后端冻结，继续原V2-03候选目录下的同点两团期渲染核对，不能因开发工具当前打开主工作区而结束验收，禁止覆盖用户源码/正式数据。
主编排同测试机、同runner更新至候选3源码，V2-DB-01断言在真实LEGACY已过。复用旧库时另遇旧测试session已过期污染限额清理断言，保留candidate3-snapshot.log；新专用v2_legacy_c3初始化后同版snapshot适用17通过/3ENTITY另模式，证据candidate3-snapshot-fresh.log，不删除旧数据或削弱断言。QA独立新增AFTER真实ENTITY探针1/1通过：品质案REGISTERED/RESOLVED、普通取消、三页游标与total、无重复及跨用户隔离，证据candidate3-after-mysql.log和qa-after-filter-mysql.evidence.test.ts。QA报告局部7项独立通过，最终结论待整理；正式机/微信仍未发布。

### 10:29候选3四项关闭及首页原型缺口

独立QA增量PASS报告output/v2-20260929/QA-CANDIDATE3.md，关闭QB1-01/QB2-01/QB2-02/V2-DB-01；7项定向、额外组退款1项通过，数据库证据沿用本轮真实日志。不表示整体V2发布通过。工程实际隔离预览两条同点合成团期后确认首页平铺遗漏原型的团期标题/状态/进度和数量，正在仅修改首页index.ts/wxml/wxss，后台/后端保持候选3冻结。新分组末件/截单支付竞争此前仅MemoryStore证据，已派独立QA准备有界真实ENTITY跨池并发探针，由主编排测试机独占执行，不扩展容量扫描。正式/微信未发布，工程active游标57。

### 候选4首页收尾与真实并发补验

候选4 diff a277179b463914bb30a87ff96babaa494e257bf53bb43e650d4e1a81e91c9995，源包be80882b9a638dec1799878f7b390f65f77e5c8a15e1007f5fd0d83c6eab8c55，归档output/v2-20260929/candidate4*。与候选3逐文件比较仅首页index.ts/wxml/wxss/test四文件不同。工程报告微信离线同点两团期实际渲染、首页8/8与类型/局部lint通过；截图/AX仅在工程CUA输出，未落盘，QA正在现有预览独立核对。
真实ENTITY跨池并发探针2/2通过：同点末件201/409且另一点独立库存；截单期间支付挂起、迟到成功双回调、跨池并发退款最终唯一退款调用/义务及释放库存。首轮因探针loadConfig未设SINGLE_WRITER_CONFIRMED而503，QA仅补隔离前置配置后通过，未改业务维护保护。证据candidate3-concurrency-mysql.log、qa-group-concurrency-mysql.evidence.test.ts，首轮candidate3-concurrency-precondition.log保留。provider合成，非真实微信交易。此前lint96归因仍未知，已派工程只读对照本轮变更文件与30b3153，不改冻结代码或扩大历史修复。正式机只读预检API healthy，当前hometown-api:75defbf、compose路径/root/hometown-readiness-a-20260908/compose.yaml，尚无正式写入。

候选4独立QA增量PASS：home-tests 9/9、实际模拟器两团期画面及预览源码hash匹配、真实ENTITY并发2/2核对通过，报告output/v2-20260929/QA-CANDIDATE4.md。HOME-ADVISORY-01搜索无结果文案/查看全部仍保留词为既有非阻断建议，清空按钮恢复，不扩本轮。工程只读变更TS/TSX 54文件lint发现3项本轮新问题（两处type import、一处未用CampaignGroup），已仅解冻两文件import修正及精确业务本地提交，其余保持冻结。最终提交需核对除import外与候选4相同。

用户截图反馈后台工具分类未在小程序显示：实查截图项目是/tmp/operations-v2-miniprogram-preview-20260929离线验收副本，preview-fixtures注入全部/主食/鲜食；首页另自带全部导致重复。主编排实时公开GET https://liziqi.icu/api/v1/catalog/categories返回工具/水果/熟食/蔬菜全部4项，未发现正式分类接口缺项。已交预览创建者切回用户正常主项目并只读验证，不覆盖主源码、不将fixture当生产。该反馈为环境恢复问题，候选分类业务未据此改写。

### 用户要求恢复正式开发入口并清理（9月29日）

最终本地提交6558fac05a9cbe9b78f10197243648f2fba54716已核对：与候选4逐文件只有campaign-service未用类型导入删除及url-state显式Page类型导入，业务源码无额外变化；用户AGENTS与无关未跟踪资产未提交。
用户要求删除测试数据/缓存/构建垃圾。已归档本轮服务器日志与独立探针为output/v2-20260929/v2-20260929-cleanup-evidence.tar.gz，再按task标签核验并删除v2-20260929-c2的runner/redis/mysql、专属匿名MySQL数据卷8a661b903555b172fda90fb367ffbf42d185058c2aeaf50cf34578c78de3f7d1及network，确认卷已不存在；删除本轮/tmp目录、源包、临时凭据。正式服务器无本轮测试数据写入，未清正式库或旧恢复镜像。
本地四份/tmp/qa-v2-*隔离快照已保存报告/探针后删除；ae57本轮apps/admin-web/dist、apps/api/dist、packages/domain/dist、packages/api-contracts/dist、test-results、node_modules/.vite及output/v2-candidate3/4重复包已清。未跟随node_modules链接删除共享依赖，必要证据在cleanup-local-evidence，原型/源码/用户素材保留。工程负责切回正常微信项目并删除其离线预览，结果待返回。V2尚未部署；后续构建需重新生成产物，已通过测试证据继续有效。

恢复结果：工程已在微信开发者工具打开/Users/lizi/Desktop/拼团项目/apps/miniprogram并确认模拟器显示全部/工具/水果/熟食/蔬菜（无本期商品时仍显示）。主编排另行实查/tmp/operations-v2-miniprogram-preview-20260929已不存在，离线预览删除完成。恢复当前正式数据入口与V2发布分开，V2仍待构建部署。

### 正式发布构建（6558fac）

最终提交6558fac05a9cbe9b78f10197243648f2fba54716源包SHA256 3f7e2f57c13e9cbf880f3936e5cb57044e1ba4894a5ad3878b1fd3212c089eec。隔离机本轮新builder v2-release-6558fac-builder，Node22环境，依赖锁和API manifest与复用builder/runtime基底均核对相同；网络隔离下使用缓存构建domain/contracts/API/admin成功，pnpm版本更新查询失败不影响构建，Vite保留已知大chunk警告。runtime通过已存在hometown-api:b758daa同锁依赖基底只替换最终编译API/packages/migrations，生成hometown-api:6558fac ID sha256:d8a85add196f046abaf0ed0afdda3877c7fee2d31bcef6f053ea7a4b1491438b，revision标签完整匹配。临时memory/mock启动产物health/catalog/campaigns均200，非真实微信。
API传输包SHA256 3253079040f0a49437a11d99f62b4782ff2f224d0d092d20504c2117b8346bce；admin静态包SHA256 25e9e1345a442ec26c30ab61b1120e425abe85a3b2b91adcd2d3d709e633f67e。同一产物正在传往正式机/root/hometown-v2-6558fac，尚未切换。恢复依据：旧API hometown-api:75defbf image18cfbfbfd007c8e45d12f0af778d1ae5e8ede62f2ee974dd0cf0ea957a1332fe，旧后台symlink目标/var/www/hometown-admin-9e3e12e；本次无DDL/数据迁移，保留旧版与原配置。构建与冒烟日志已存release-build.log、release-artifact-smoke.log。

### V2服务器交付完成（2026-09-29 10:52 CST）

已按持续授权部署正式192.144.136.205。先核对两包SHA256完全一致，再加载API镜像并确认ID d8a85add196f046abaf0ed0afdda3877c7fee2d31bcef6f053ea7a4b1491438b、revision6558fac05a9cbe9b78f10197243648f2fba54716；仅docker compose --no-deps更新api，未重建MySQL/Redis。后台静态目录/var/www/hometown-admin-6558fac，current软链接原子切换，公网返回HTML与同包index逐字匹配。后验API healthy、health/campaigns/admin/saas均200，公开分类仍工具/水果/熟食/蔬菜。启动期短暂连接reset在健康等待内恢复，最终成功。部署日志release-deploy.log、公网健康release-public-health.json；前一API镜像和后台静态目录、原compose配置保留供回退，无DDL或正式数据迁移。
已删除测试机本轮release-builder/smoke容器、临时生成API镜像与构建/传输目录，正式机传输tar包和中间env文件已删除；保留正在运行产物、必要回退配置/旧产物和日志。先前合成库/Redis/QA副本清理结果仍有效。
交付边界：API/运营后台/点位工作台服务器已更新；微信新小程序代码在本地提交6558fac，尚未上传体验版、提交审核或公开发布。按用户最新要求，开发者工具保持主工作区正常项目并读取正式数据，没有自动把主目录改成候选或恢复测试预览。真实微信支付/退款/订阅触达和R-01真实履约未由合成测试替代，需具体真实交易范围/平台发布授权。HOME-ADVISORY-01为既有非阻断体验建议保留后续。授权服务器交付及清理已完成，自动跟进将停用，外部待办向用户说明。


### 三代会话交接（2026-09-29，用户明确要求立即替换）

用户反馈上下文压缩本身耗时数分钟，监控启动替换。旧主编排与工程均确认停止新增派发、写入、测试和发布；无遗留活动命令，旧v2自动化PAUSED，finance_v2/pickup_ui_review/qa_batch1均completed。旧工程释放写入权，新工程只读核验HEAD和资产后接任。实际目录仍为/Users/lizi/.codex/worktrees/ae57/拼团项目，HEAD 6558fac05a9cbe9b78f10197243648f2fba54716；仅已有AGENTS修改及testdata/docs/output/prototypes未跟踪资产，均保留，不归档工作树。

新主编排01a0eb1b-7c44-7142-8272-8388aa571d3d；新工程01a0eb1b-1e4b-7e90-a730-997a8272dd9b；新QA01a0eb1b-1cfa-7a60-a62f-d917768b1f91。三者已确认接手，新主编排接管协调与发布窗口；固定角色索引已更新，未指定模型或推理强度。

未完成事项：移除独立人工账单导入/差异/人工核查前后端，保留自动payment/refund reconciliation及ledger功能，旧工程仅只读检索尚未实现；另有旧主编排交接的最新独立用户授权——清空商品、自提点、团期、其他账号、全部订单（含真实交易记录），仅保留超管与系统配置，删除尚未执行。新主编排须从旧主编排最近用户消息核对原始授权及关联/队列/恢复边界后独占执行，不将清理数据与删除业务功能混同，不重复询问已明确范围。

上轮服务器6558fac已部署，小程序未上传，证据与恢复依据沿用上节；新任务不得重复发布或重跑未受影响验证。新主编排已确认继续上述两项。监控仅更新角色索引及交接记录，无业务代码或服务器写入。

归档结果：旧主编排01a0e5e9-65b4-7aa0-86bf-0407d172aacb、旧工程01a0e5e9-65b5-7bd2-ba3f-c12a8843e19d、旧固定QA01a0e5e9-65b5-7bd2-ba3f-c103c55e68a8均由归档工具确认archived=true；工作树与证据保留。

### 三代首轮：人工对账移除与业务数据重置

唯一引用 OPS-20260929-REMOVE-RECON-RESET。主编排已直接读取旧主编排最近用户原文，确认用户选择“只保留超管及系统配置，商品、自提点、团期、其他账号和全部订单也清空”；该授权包含问题中明确提示的真实支付/退款相关记录，不重复确认。数据重置与人工对账功能移除分别验收；支付/退款自动核对及ledger功能保留。
新工程为ae57唯一业务/必要运维脚本写入者，基线6558fac05a9cbe9b78f10197243648f2fba54716；已派发完整实现、自测、冻结及重置方案，禁止其自行操作服务器。新QA先只读检查基线的关联数据、队列、回调和回填风险，冻结后独立审核。工程与QA均请求high，原因是跨端移除及数据重置边界，下一评估点为方案/候选冻结；工具已确认派发，不据此声称运行参数已实证生效。正式库/发布窗口由新主编排独占，尚未执行任何删除或新发布。记录所有权已由监控移交主编排。

本轮只读预检：正式API运行hometown-api:6558fac且healthy，后台current指向/var/www/hometown-admin-6558fac；备份timer active，受限备份脚本存在，磁盘可用26G。测试机无运行容器、可用内存约2.5G，MySQL8.4/Redis7.4与Node22构建缓存可用。正式库hometown_food/ENTITY，server_uuid 8a48799d-aa5c-11f1-8297-4a0d012feec7。订单CANCELLED1/REFUNDED2、支付REFUNDED2/FAILED1、全额退款SUCCEEDED2；删除前停写后须重核，当前未发现进行中交易义务。仅一个ACTIVE且关联一致的SUPER_ADMIN，已向工程提供受限执行标识，不更改凭据。
QA基线只读检查完成：保留超管完整身份关系、accessRoles及删除标记、序列高水位、ENTITY/schema控制；业务目录含区域/分类/banner清空。未知支付回调404不重建订单，未知退款回调仅新增去重记录、不触发退款或重建账务，该运行痕迹不算旧数据残留。真实隔离库演练、失败回滚、重复执行、超管保留、旧会话失效、重启无历史回填仍待候选验证。服务器独立恢复备份及本地素材保留，数据库内活动旧快照属于清理范围。

测试机已创建本轮专属internal网络ops-reset-20260929及同前缀mysql/redis容器（标签codex.task=OPS-20260929-REMOVE-RECON-RESET，MySQL768MiB/Redis128MiB）；受限临时连接文件位于/tmp/ops-reset-20260929，仅用于本轮合成验证。尚待候选传输及初始化，正式机仍只读。验证后清理本轮资源及凭据，保留验收回执。

### b07cc827 冻结与独立验收

工程冻结 b07cc8277f93a26f60353f86fafe991224f3df89（基线6558fac，29文件），源包SHA256 a8b7f23c52e25f3b55689e01e83fddf9400ca633b742b1f0d308cb942ca93b5e，主编排本地和测试机复算匹配；源包来自工程output/ops-reset-20260929-engineering。报告API定向59+app/store27、导航19、浏览器URL1、类型及lint通过，后台构建通过；真实演练尚未执行时保持2项未通过状态。已派新固定QA对同一冻结版审核，工程停止业务写入。主编排在本轮隔离runner /candidate加载同一源包，Node22.23.2/pnpm11.16.0，执行构建共享包、空测试库迁移及真实重置演练；证据归档output/ops-reset-20260929。依赖锁与缓存一致，API package差异相对缓存需按依赖字段核对，不因整文件hash不同自动换依赖。正式库未修改。

b07真实隔离演练失败：标准5项迁移成功，但beforeAll误把迁移产生的staff/users/sessions/credentials及系统编号标记当已有业务，suite FAIL、2项skip，日志output/ops-reset-20260929/rehearsal-b07cc827.log。RESET-01/P1 OPEN交工程只修必要演练前提，保留未知/非空数据拒绝。QA独立报告output/ops-reset-20260929-qa/QA-b07cc827.md结论FAIL仅阻断数据重置；人工对账移除未发现新增阻断，4项独立补验通过。QA-ADV-01指出集成旧会话断言缺Bearer且token无效，已要求同轮修正确认清理前有效/后失效，真实持久化证据尚缺。b07 API/admin已在测试机构建成功，后续测试文件变化可按产物输入核对复用；不能据此清库或宣布全通过。

### 2ce86890 实测通过与QA PASS

最终冻结2ce86890cee6c19bff3344f07db6d4fba9e00090，源包SHA256 7a780b2eb3a07d3f0e62a75a0f1c1e255292e134fed2b34b14152f1cd0e10534，本机/测试机一致。相对b07仅三处测试/演练辅助文件，正式清理CLI/业务不变。真实MySQL8.4/Redis7.4演练2/2通过、零skip（12.96秒），日志output/ops-reset-20260929/rehearsal-2ce86890.log；前次失败保留。独立QA最终PASS报告output/ops-reset-20260929-qa/QA-2ce86890.md，关闭RESET-01与QA-ADV-01，无本轮未关闭阻断。API新构建、后台同输入沿用测试机构建，已核依赖字段与缓存一致；镜像hometown-api:2ce86890 ID sha256:15ad0f4a12ab26aaf9f2342cfcf447b2e4763171db70a32e86e589a5f74f1401，revision完整SHA。正准备产物冒烟/传输；正式数据库尚未清理。

正式备份恢复演练已通过：20260929T033211Z-e1088fb0.sql.gz，压缩SHA256 077cb22e61f7c76e69b1bf04711b64da3a554bd2ce10533ff66f108ef9bf8114，SQL SHA256 a29f29069b8323ae0029bd766e52e47894ad405e5e13aa7f5620c722f351592d，restoreStatus PASS，临时恢复库已删；原始敏感备份仅保留正式机私有目录，非敏感回执output/ops-reset-20260929/backup-receipt.json。备份在停服前完成以缩短窗口，实际删除时另保存精确停写前像。第二次只读交易/claim检查仍终态且无活动标记。产物API包a14aeeac05c2cc8d08a5995fbd558a032809f7d26c58d9a6ab0230f82a1746a0、后台包233a6bc66ec827f684896196eb6632edd57093cc490b41bfe8e358f636aba376，传输中尚未切换。

### 正式业务数据重置与对账移除发布完成（2026-09-29 11:38 CST）

正式机两包摘要及镜像ID/完整revision核对通过后，暂停备份timer、停止唯一API（其内含worker/后台循环），在停写窗口运行同一已验收镜像内的编译CLI。inspect再次验证专用库UUID/schema/ENTITY、迁移校验和、账号关联及交易终态：records136→4，仅users/staff/credentials/roles各1；业务关联4→0、迁移journal42→0、旧snapshot1→0，序列1与迁移5保留，旧aggregate净化。停写beforeHash917969b5830ebe0ca3c7e433d6e051977e6bb02a56455f8da8ba59d273d1f25e，apply committed afterHash1bd04d17e7f6e7baca519f4181d4dd60645afd170132d45389705973864f3751。完整敏感前像仅在正式机/root/hometown-reset-2ce86890/private，未复制本地/聊天。保留账号逐记录摘要43153f903e3116d1eb0f34e6856741375fa42d9c379ff32aa0a8040bd43ece7c前后相同。
Redis首次inspect4键，apply前一键到期变为3，摘要保护拒绝且未产生删除回执；保持停写重新inspect核实3键后apply committed，removed3/remaining0，未FLUSHDB。MySQL与Redis后验通过才启动新API并原子切换后台current到/var/www/hometown-admin-2ce86890。镜像15ad0f4...与测试机一致；API healthy、公网health/admin/saas正常，备份timer恢复active。启动期两次连接reset在健康等待内恢复，不是最终失败。原6558fac镜像/静态目录及compose配置保留，未重建MySQL/Redis、未改密钥或调用真实交易。
后验线上实体仅四条超管身份记录、relations/snapshots/reverse exports均0，ENTITY和5项迁移保留；公开分类/团期/区域/点位应为空。首次探测误用不存在的/api/v1/areas，已按源码实际/service-areas更正，仅为检查路径错误。账号原密码hash/盐/授权版本逐记录保留，登录就绪health为ok，原密码与旧会话行为经真实隔离演练；生产未掌握明文密码，未冒称人工密码登录。全部旧会话已清，需要重新登录。文件系统媒体/本地素材及恢复备份按边界保留。本轮微信未上传或发布。

公开后验最终确认：/health/ready全部依赖ok（含adminBootstrap、自动reconciliation）、分类/团期/service-areas/pickup-points均200且data=[]，admin/saas均200；已运行后台周期后在线业务无回填。日志/回执见output/ops-reset-20260929/{db-inspect.log,db-apply.log,db-after-inspect.log,redis-apply2.log,activate-production.log,public-verification.json}。测试机同标签4容器/专属匿名MySQL卷/网络、临时新镜像、/tmp/ops-reset-20260929源包及凭据已删除；确认匿名卷734daca148a1683aae2ea58d728eb42fd982618685000d30d99ba07ae0025f93不存在。正式机传输tar及本轮临时连接env已删，保留在线新产物、旧版回退产物/配置、受限完整前像/正式备份及非敏感证据。工程正在仅清理本轮本地可再生产物，用户资产及共享依赖保留。

本地清理完成：工程确认删除本轮admin/domain/api-contracts dist、test-results（摘要先归档）及三个临时source.tar.gz；API dist原本不存在，所有日志/manifest/验收证据保留，详见ae57/output/ops-reset-20260929-engineering/cleanup.json。最终工程Git无本轮业务未提交差异，既有AGENTS差异及用户未跟踪资产保留。本轮两项授权工作完成：人工对账功能服务器发布、业务数据重置；微信仍未上传/审核/发布。无本轮未关闭阻断项。

### 用户反馈超管密码无法登录（9月29日，重新打开登录验收）

用户反馈admin原密码失败。线上3次POST /auth/admin/login均401，非429限流或403停用。主编排在正式机内将当前admin完整credential与清理前受限preimage比较，文档/密码hash/salt逐项一致；应用MysqlStore可以查到该凭据。调用部署版本verifyAdminCredentialPassword校验用户此次提供的密码，返回false；说明该输入与清理前后保存的凭据均不匹配，不能归因为清理改密，也不能据此声称用户已成功登录。未输出密码/hash/salt，未修改凭据、未创建会话。LOGIN-01 OPEN：需用户确认是否将admin重置为此次指定密码；项目第8节对凭据变更要求具体授权，当前仅收到账号密码核对信息，尚未执行重置。

LOGIN-01 CLOSED：用户明确回复“可以”授权将admin重置为其指定密码。主编排通过现有MysqlStore事务核验唯一超管ID/ACTIVE状态/版本3，按既有密码算法重置凭据，staff与credential授权版本同步升为4，清除旧会话并写入不含密码的审计记录。重读密码校验通过；正式HTTPS POST /api/v1/auth/admin/login返回200/LOGIN/SUPER_ADMIN，携返回令牌访问/admin/me/access返回200。探测会话随后删除，未输出密码/hash/salt/token，未改其他账号/权限/业务数据。此次明确凭据变更独立于此前清库保留，未修改源码或重部署。

### 客户交付修复 DELIVERY-20260930-CUSTOMER（9月30日）

上线专项01a0efe5-c8e5-7bd3-a2a0-31cefdb6e706转来用户当前要求；主编排已读取用户原文确认：内容此前测过，空数据是交付客户准备，解决此次发现问题并给可交付版本。不得把空业务/此前接受跳过的完整容量/未重复真实交易变成新门槛，也不得写成这些验证通过。
实查工程ae57 HEAD2ce86890cee6c19bff3344f07db6d4fba9e00090，无业务未提交差异；主目录ef456000bfb71bb403a3923b5ea5807f2ca77ab4及用户资产保留，不能拿主目录旧源码构建交付。固定工程已接派，唯一写入者；主编排独占记录与服务器窗口，专项只读核查/汇总，QA待冻结候选。
本轮验收D01退款记录超过每类500后仍可通过有界后端分页/筛选查全；D02账务流水无全量读取、前后台分页筛选完整且金额/权限不变；D03多组结算逐组展示既有成团条件及未成团处理，不改交易逻辑；D04冻结源码/小程序产物及入口一致可追溯，不覆盖主目录或擅自微信上传。D05异机备份/失败通知只读确定接入点并准备方案，目的地与传输授权由专项询问待回；D06通知trial核验客户交付渠道，不擅自formal或公开发布。工程high已请求，原因跨层财务完整性与查询成本，方案/冻结时评估。适用真实MySQL>500混合退款与ledger页间无漏重/过滤权限/有界查询验证，冻结后由主编排在测试机执行；同版有效证据复用。

专项补充：用户对备份/告警问题回复不懂，未提供新接收目的地或敏感传输/付费/外部消息授权。主编排已让工程在本轮软件范围准备最小可配置接入和明确未配置状态、systemd失败接入/合成验证；默认不外传或通知，具体接收方/费用若需新增最后给用户可审方案一次确认，不阻碍D01–D04。固定QA已开始只读基线风险核对，待工程冻结再正式审核。本轮不使用测试机存放生产敏感备份。

D05后续明确决定取代上段“目的地待定”：主编排直接读取专项用户两次“测试服务器和正式服务器分开”原文及解释，批准192.144.136.205运行业务、180.76.100.156专用受限目录存加密异机备份，不新增机器；不授权在测试库恢复生产明文、修改业务凭据或外发通知。用户再要求定期维护两机容量；专项核对既有自动化，服务器写入窗口仍主编排唯一协调。已派工程落实加密复制/落盘/摘要/失败保留/私钥异机保管及合成恢复演练方案，固定QA在设计阶段核对，备份接收目录排除普通测试清理。轮换必须先定义受保护的最新可恢复副本，未知资源/在用及回退版本不盲删。D06按同版源码交付和trial状态处理，用户未要求公开发布。此次新决定与早先禁止未知目的地传输不存在并行冲突，以本段为准。

本轮服务器预检：正式API2ce86890 healthy、根盘37%/可用26G；测试根盘55%/可用18G、可用内存约2.6G，无运行容器，但有5个停止容器/9个卷，归属尚未核对，不按reclaimable标记擅删。专项已创建每日09:00容量heartbeat id=automation，仅监测及调用已审核工具，实际写前须协调窗口；80%或<5GiB预警，90%或<2GiB紧急。新备份与清理实现仍在工程中，不据自动化创建声称已完成服务器端维护。

工程方案已提交：D01/D02专用SQL keyset分页及精确COUNT，D03仅checkout逐组现存规则文案。固定QA前置审设计；分页必修为数据库过滤/排序和有限页document读取，COUNT的索引扫描成本单列，不要求常数时间或引入计数缓存。D05采用age公钥正式机加密、测试机受限只读拉取至专用密文目录，流式完整性验证不得落明文或导入生产数据；恢复私钥额外托管、受限出口、原子manifest与失败保留待细化审核。两机只读确认尚未安装age：正式OpenCloudOS9.4 x86_64/dnf、测试Ubuntu24.04.4 x86_64/apt；SSH服务名与SFTP路径不同，安装配置尚未执行。新轮换只出dry-run清单、原备份全部保留；未冻结、未进入本轮真实测试或发布。

测试环境准备：已在180.76.100.156创建本轮独立internal网络delivery-20260930、同前缀mysql(768MiB)/redis(128MiB)/runner(1280MiB)，均标注codex.task=DELIVERY-20260930-CUSTOMER；专用合成库delivery_finance，临时连接只存/tmp/delivery-20260930内0600文件，未输出。runner复用已装Node22依赖镜像，尚未传入候选或执行验收。正式机无本轮写入。验证完成后仅清本轮标识资源并保留证据。

QA方案级PASS-with-conditions：output/delivery-20260930-qa/proposal-review-d05-pagination.md，后续经主编排核对修正为测试机受限常驻私钥支持自动校验+独立恢复拷贝、固定known_hosts的认证SSH足够，额外签名为可选加固；不得把每次人工离线取钥/第三副本扩成门槛。该结论非候选验收。测试机已安装发行版age 1.1.1-1ubuntu0.24.04.3，无服务重启；正式dnf无对应包，测试机age二进制仅依赖glibc且最高符号2.34，正式glibc2.38，后续可核摘要测试同工具兼容性，当前未安装正式机。

D05运行依赖准备完成：测试机apt发行版age 1.1.1-1ubuntu0.24.04.3的/usr/bin/age，经本地中转与正式机复算SHA256 529450dfeaf3055cb24d76789d0b1f5eb8cd23e03dc4add64f84776df1272b02一致；正式机/usr/local/bin/age此前不存在，验证临时工具--version为1.1.1后root:root0755安装，临时远端文件删除。无服务重启、备份任务配置/账号/密钥尚未修改、生产数据未传输；本地中转文件仅可再生工具，任务后清理。

容量维护验收补充：专项再次核对用户要求，区分每日巡检、每周明确manifest临时产物真实清理、备份轮换三项。已派工程补齐只针对纳管后新验证副本的dry-run/apply-plan，7日每日+4周每周并保护最新有效/有效密钥最后副本/在途/失败证据，历史旧备份排除。实际备份删除尚无具体授权，默认dry-run；准备并验证后由专项向用户集中确认执行开关，不以代码未实现收尾。空manifest不代表实际释放空间。两机依赖准备完成，工程本地模拟publish/pull/status与cleanup守卫通过报告待冻结核对，正式未切业务版本或备份任务。

D01-D04业务快照冻结并测试机通过：工程确认基线2ce86890+12文件manifest，源包SHA256 f15e5d403c517c3f02921048acc2f179dbcbe80ce5fc5421810acabb71d7fa17，本机/测试机一致，证据output/delivery-20260930/{business-manifest.json,test-build.log}。测试机构建domain/contracts/API/admin、mini typecheck成功，专用MySQL完成5项迁移，API定向20/checkout7通过；pnpm更新检查隔离网失败及Vite大chunk为非阻断warning。固定QA审核同一不可变快照并准备真实>500财务探针；工程仅继续D05，不改这12文件。工程本地误跑mini全套205通过2失败为home标记断言，归因待QA对照基线，未写全套通过；未进入正式发布。

完整候选1：基线2ce86890+21文件，源包efcab2a45c41f81d8aee8043aeb4cfcb899a37bf86f091f06d488c54818040b5，存output/delivery-20260930/full-candidate1。真实财务探针首轮fixture违反整单退款订单唯一性，在beforeAll失败，原日志保留；QA仅修合成样本后，探针在真实MySQL8.4 PASS1/1无skip。520FULL+520PARTIAL+1037ledger同时间跨页完整、过滤精确总数、金额平衡、权限负例通过。8个EXPLAIN计划在finance-plans.json，原日志finance-mysql-probe2.log；估计行数不冒充实际执行行数。

D05-01/P1：主编排真实OpenSSH发现ls根目录输出前导斜杠被旧parser过滤；仅解冻encrypted_replica.py及test修复，6/6通过。候选2只这2文件变化，源包4c1e4bf786bcf1c6f4d6aab9f8536236e87b04049f06bd3cc19e704604574db7。真实age发布、verify、组读取权限通过；合成SQL一表一行恢复与hash一致，错误key、腐坏cipher、缺marker拒绝且旧有效密文保留，日志real-age-candidate1.log及real-age-restore-negative.log。

候选2在测试机独立临时SFTP账号/chroot完成真实pull、写删/路径逃逸拒绝、hostkey错误拒绝、重复拉取、status及旧副本保留；证据sftp-synthetic-probe.log和同名脚本。probe最后userdel遇短暂sshd残留失败，专属SSH配置/auth已先删除并验证reload；随后单独userdel/groupdel成功，未kill其他进程。合成目录/var/lib/hometown-replica-probe及/tmp/delivery-20260930待任务结束清理。此为测试机真实协议验证，非生产跨机备份接通。正式仅age工具已装，账号、密钥、备份服务未改。QA仍审核完整候选，尚未发布。

候选3修复 D05-02 接收端 bitrot、D05-03 源端重复发布校验、D05-04 轮换后重拉、D05-05 禁用 core dump；源包 c893df0692f89797abd1f0444cbfe429c6a2ea3e80d867c7841179aff3db14fc。测试机真实 age/SFTP 15 套合成包验证拒绝腐坏/远端摘要改变、轮换7套后再次pull跳过、8套保护、源端原件保留；systemd LimitCORE 实测(0,0)，日志 sftp-synthetic-probe3.log、sftp-probe3-cleanup.log、systemd-core-limit.log。临时专用账号61191及配置已清理，无生产备份传输。
候选4增加 D05-06 源端留存工具，23文件，源包 d5287c72f245b9b77e3791d6b12465ffe22d36c7004d1ed349a2c94934374f28。真实 age 合成源端留存 dry-run 6候选/8保护，apply 删除6套释放10776B，8套及未纳管orphan保留；日志 source-retention-real.log，纯隔离合成数据，不代表生产释放容量。正式 Python3.11.6、测试3.12.3，均满足README3.11+，不以Mac系统3.9验证部署兼容。

用户看到QA无栈直达checkout与本地demo手机号登录提示后提出返回/取消支付问题。核对原项目购物车使用navigateTo，QA副本为合成数据、未创建订单/支付；同时正常checkout缺少常驻返回入口，列 D03-EXIT-01/P1 修复，不能只归咎测试副本。工程仅修改checkout四文件：始终显示返回购物车、switchTab保留cart与draft、提交中禁用，未修改支付/退款/取消订单语义。候选5仅覆盖这4文件，源包7d1e2690f6db10420a2a2f4abb1b51ac15cd9758d2a2cad0a55dfa680cff8cae，其他19文件与候选4一致。隔离测试机mini typecheck及checkout10/payment4/payment-result8共22/22通过，mini-exit-payment-regression.log。QA实际验证无栈返回购物车；正常多团内容和真实微信取消支付未重新实测，不能冒称视觉通过。QA副本已关闭、原始乡味集项目恢复，临时模拟API停止。完整独立结论与正式部署仍待收尾，未微信上传。

独立QA结论：output/delivery-20260930-qa/frozen-review-D01-D06-candidate5.md，D01/D02 PASS，D03/D04 PASS-with-limits，D05-01–06候选与隔离证据PASS，无新增本地阻断。正常多团页面再次渲染因QA fixture模拟器启动失败未验，通过范围不包含真实微信取消支付；QA副本与mock API已关闭并恢复原项目。
D05正式接线（9月30日11:20 CST）：部署候选5同hash脚本；正式专用replica-reader UID/GID61192仅受限internal-sftp -R、来源IP限测试机、无TTY/转发，export root:hometown-replica2750，生产仅持公钥；测试机/etc/hometown-replica0700与age/SSH私钥0600、固定生产host key。age私钥独立恢复拷贝保存在本机login Keychain，service=hometown-production-backup-age-recovery-20260930/account=replica-recovery，内容为Base64编码identity文本，由Keychain加密存储，读取后解码逐字节一致。首次交互式多行写入未通过比对，已改单行编码覆写并验证，无私钥打印或临时明文落本机文件；证据key-custody-receipt.json。恢复时应通过Keychain访问该项并解码到受限恢复环境，不将值写日志。
正式原每日备份service追加受控drop-in并保留原脚本/配置到/root/delivery-20260930，原timer维持。首次新包20260930T032048Z-91a79a04 BACKUP_OK/PUBLISHED；测试机真实systemd拉取Result=success、ExecMainStatus=0、LimitCORE=0，status REPLICATED/verifiedBundleCount1，15分钟timer已enable/active。明文仅流式内存核对，未存测试机文件或导入MySQL。日志production-encrypted-backup.log、live-cross-host-replica.log、source-backup-effective.log、receiver-backup-effective.log。正式业务仍旧应用版本，备份完成不等于应用已部署。
两机目标Python真实retention dry-run均0候选、最新一套受保护，旧6套生产历史备份全部保留，未调用apply。review key-ID/plan仅在/root/delivery-20260930，不启用自动备份删除。源端与接收端计划证据retention-plan-192.144.136.205.json、retention-plan-180.76.100.156.json。当前无删除候选，无需空审批；后续非空候选按既定具体授权边界办理。普通临时产物清理工具已安装，现manifest空，尚不能声称释放空间。


### 用户指定单人接管（2026-09-30）

用户明确要求原主编排、工程和审核停手，由上线专项本会话 01a0efe5-c8e5-7bd3-a2a0-31cefdb6e706 接替。三方已回传目录、HEAD、未提交差异/冻结候选及真实进程状态，并释放文件、UI及服务器写入权。接手者成为本轮唯一写入者；复用 candidate5 独立QA与测试机有效证据，不重新派发。唯一遗留外部命令是已开始的API源包scp传输，接手先核文件完整摘要后加载，正式应用切换尚未发生。D04-TAB-01底栏图标空白仍待定位；不把切回旧主目录视为新交付包。


### 单人接管交付完成（2026-09-30 11:36 CST）

最终本地提交 `479fd7e16f36c7c1fadba7929a10841b6bc1aacf`，精确25个本轮文件，未纳入用户AGENTS或无关资产。candidate5可执行/测试/配置22文件哈希未变，另修正文档运行状态并增加调用同一已审核清理工具的service/timer；两机systemd-analyze verify、实际服务执行成功。原独立QA及同版数据库/业务检查复用。

正式源包完整传输后 SHA256 与测试机一致，11:30以同产物切换 API `hometown-api:delivery-20260930-c5`（镜像ID aaa1b70890eef11fac96d5fed95cbabfd680208e2f882f174aa1499f11fb2a40）和后台 `/var/www/hometown-admin-delivery-20260930-c5`。公网API/后台/点位及公开查询200，财务路由未登录401，全部健康依赖ok；无DDL、业务数据删除或真实交易，旧2ce86890镜像/静态目录/配置保留。继承镜像旧revision标签不作为新提交身份，真实身份以candidate/sourceArchive标签、镜像ID与本轮final-source.json映射为准。日志 activate-production.log、post-deploy-check.json。

D04-TAB-01现场主项目六PNG及包哈希相同，模拟器会话图标空白；仅“项目→重新打开此项目”后六状态恢复，未改代码/清空数据。随后在最终交付目录实际导入、编译、重新编译及三个tab切换验证正常，记录为开发工具会话故障已恢复，内部根因未确认，不保证不再复发。最终目录 `/Users/lizi/Desktop/乡味集交付-20260930`，真实HTTPS/wechat配置、不带QA合成数据；开发工具当前打开该目录，原主目录未覆盖。包逐文件/ZIP校验在manifest.json；微信未上传/提审/发布。

每周一北京时间04:15+最多5分钟的 `hometown-temp-cleanup.timer` 两机均enable/active。只清审核manifest的结束任务staging目录，既有备份轮换仍dry-run。首次实际清理测试机4容器、2专属匿名卷、1网络、临时API镜像及合成/tmp/probe文件；正式仅清完成的两传输包。目录摘要工具拦住测试runtime-image内zod符号链接，核实为本任务依赖链接后仅unlink该链接、未跟随目标，再重新dry-run与服务apply成功。实际可再生文件：测试135196073B、正式122992699B，另测试容器/卷释放未单独精确计量。见actual-cleanup*.log；不把合成备份删除计作生产释放。实际加密副本/密钥目录、原6备份、线上/回退、未知资源保护。

本地仅清candidate1–5可由保留源码包重建的展开目录，保留其tar/manifest、QA和测试日志、最终客户包。最终交付说明/限制已写入客户目录，完整结果索引 output/delivery-20260930/handoff-result.json。真实手机号授权、微信支付/退款/通知未在本轮重复实测；原先明确跳过的容量验收未改成通过。后续本轮唯一执行者为上线专项，原三角色按用户要求停止。

### D04-TAB-01 重新打开：图标与文字选中状态不同步（2026-09-30）

用户截图显示购物车文字红色、图标灰色，而“我的”图标红色、文字灰色。上线专项在 Stable 2.02.2608040 现场点击购物车并再次静态截图复现。当前工具打开的是桌面原项目 `apps/miniprogram`；交付目录、ae57 源码及原项目的 tabBar 配置和六个 PNG SHA-256 完全一致，实际查看 cart/profile 两组资源的灰色 default、红色 active 均正确，未发现 setTabBarItem 等动态覆盖。

工具的可访问性树显示当前路由 `pages/cart/index`，三个图标请求分别为 home-default、cart-active、profile-default，但画面仍为购物车灰图标、我的红图标，说明观察到的资源选择与最终画面不同步。运行时图像刷新/渲染异常是证据支持的排查方向，尚未证明具体内部原因，也未证明真机是否受影响。此前“重新打开后恢复、短时切换正常”不再作为本项已彻底解决的结论；D04-TAB-01 状态恢复为 OPEN。本轮用户询问状态，完成只读核对，未修改业务源码、未重启或清空缓存、未改变交付包或进行微信发布。
