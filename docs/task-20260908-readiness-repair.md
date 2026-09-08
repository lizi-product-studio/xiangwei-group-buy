# 千人就绪缺陷修复

- task_id：TASK-20260908-READINESS-REPAIR
- confirmed：用户明确要求修复此前评估所发现问题，替代上一轮只读评估边界；沿会话既有GitHub同步和生产更新授权，不自动扩为真实交易、生产压测、付费扩容或不可逆迁移。
- route：GOVERNED_DELIVERY；root负责产品冻结与本文档，flow_engineering独占源码/测试/Git/部署，flow_qa独立只读验收。
- 批次A：服务端角色/状态筛选后分页，取消/品质/领取/人工通知待办全部可达；后台分页接通；差异退款按实际订单行精确关联，缺资金事实不得回退0且拒绝执行；501+历史回归。
- 批次B：无schema的隔离只读快照，消除读方法全量锁写与公开列表重复读；不得共享this.data导致并发污染。通知受控并发与预算保持claim/lease/unknown/at-most-once语义。真实MySQL隔离集成与容量测试，内存模拟不得代替真实证据。
- 验收：每批冻结差异后独立QA，产品lint/typecheck/tests/build与E2E；保留既有原型lint和未跑项目的事实。Git精确同步、生产备份、版本一致性及发布后验。先独立交付A，不因大架构方案拖延已知业务缺陷。
- 保留：用户project.config.json、.codex、prototypes；不篡改金额/库存/权限规则，无生产模拟数据、真实支付或微信消息。
- 环境：本机目前无brew/Docker/MySQL/Redis；root核实可逆用户目录隔离运行方案。未确认环境前不压生产。
- status：IN_PROGRESS，两项P1本地独立验收通过正在发布，容量优化待实施与实测。

## 验收冻结补充

### A：业务待办与资金复核
- 501+记录下，各角色允许的旧未处理取消/品质/领取/人工通知记录可达；服务端过滤先于分页，总数正确，稳定排序，不因其他角色记录挤占。
- 缺省查询兼容既有客户端；后台有真实翻页入口，切换筛选重置页码；全量精确订单号查询继续有效。
- 历史订单单价1200分短少1件显示12.00元及正确商品/订单号。缺订单或行时明确“数据异常/不可执行”，UI禁用，直接调用执行API也拒绝且无资金/订单/provider副作用。

### B：容量与通知
- 所有读取使用各自隔离状态，不能互相覆盖或读取未提交写状态；事务内读取仍复用当前受锁上下文。
- 精确识别只读方法，不按模糊名称将get...ForUpdate等语义随意移出事务；新增方法默认安全写路径，回滚兼容旧payload。
- 正常替身provider100ms响应下，1000条已授权待发通知目标≤5分钟排空；慢调用有并发及时间预算，未知提交不自动重发，失租/迟到完成不能覆盖新持有人，保留授权消费语义。
- 本机真实MySQL8.4/Redis7.4可用于正确性与本机容量基线；不同硬件结果不宣传为线上100RPS已达标。
- 本机隔离runtime由runtime_setup独占用户目录准备，无sudo/系统守护服务，不碰现有业务库，结束后停止本任务进程。

- A必要依赖扩展（root确认）：payment-service.executePartialRefund在REFUND_CONFIRMED但无allocations时事务内明确拒绝，防止无事实返回空成功；保留已有完成记录的幂等和正常金额状态，补零副作用测试。

- runtime_setup attempt1 READY：官方MySQL8.4.11 ARM tar校验通过；Redis7.4.11官方SHA256通过并本机编译。仅127.0.0.1:13306/16379，独立空库与Redis PONG通过。连接文件位于任务runtime/local-test.env（0600），不入Git。macOS lower_case_table_names=2，实际结果不得直接外推Linux生产容量。

- A工程首轮定向API10/10通过：7类历史待办与502通知、分页完整性/角色total隔离、旧1200分订单金额及缺关联拒绝。API/admin类型检查通过；UI/E2E、直接service缺分配及真实集成待执行，尚未最终验收或部署。

- A attempt1冻结12文件，证据batch-a/freeze-attempt1.sha256；API11定向与UI第26页/缺金额禁用通过。全产品466测试通过，其中API222、真实mysql-redis.integration8/8零skip；产品lint/typecheck/build通过。原check仍仅用户prototypes21既有lint错误；18项E2E及独立QA进行中。工程发现履约差异筛选OPEN应为REGISTERED，冻结期间不改，待QA合并一次修复。

- A独立QA attempt1确认两P1修复及12项独立定向通过；唯一已确认UI筛选缺陷OPEN→REGISTERED需修。工程attempt2已修两处枚举并将队列筛选/错误/表格包同一div以恢复旧页面结构。全E2E发现旧治理测试mock仅匹配无query路径，root允许按已批准分页契约适配query/metadata，保留权限/迟到响应/UNKNOWN与金额断言，不调大超时。最终结果待attempt3冻结重验。

- A attempt3独立SHA/增量通过，但受影响E2E固定版本3PASS/2FAIL；两项race失败点均为通知请求count预期1实际3，未进入泄露断言，不能称泄露。根因确认：新队列StrictMode mount两请求+父旧通知读取setNotifications触发refreshToken又请求。root批准分页组件作为五类队列唯一读取者、首次mount不额外刷新、微任务generation取消已清理effect，保留账号/迟到响应保护及业务动作后刷新。attempt4待冻结验收。

## A最终本地验收与发布窗口
- QA attempt4 PASS限A：14文件SHA一致，两原P1关闭，队列唯一读取者与generation保护通过；固定版本受影响4spec/5case全部PASS。首次18项15P/3F及中间失败保留，不能写成单次全绿。
- 产品466PASS含真实MySQLRedis8/8零skip；原型21lint例外保留。UI读取替身与真实501API边界证据分开。
- root沿用户“推完自动更新服务器”及本轮明确修复授权放行工程唯一A发布窗口：精确14文件Git同步、新鲜备份、API_READY后static、版本/健康/资源挂载后验；无真实业务造数/交易。

## B方案确认
- MysqlStore每事务和显式readSnapshot持有独立MemoryStore及连接上下文，读不FOR UPDATE/不persist；写仍事务锁，未知方法默认安全写路径。只读scope不能无锁写回，尝试写应明确拒绝。
- 公开团期整次读取复用单快照；通知每轮最多100、并发5、小批claim、20秒预算，超预算不再认领，保持UNKNOWN/lease/fence/授权语义。
- A发布后继续B，无需重新请求同范围授权；真实MySQL读不写、读写隔离/回滚、1000身份1万历史与通知吞吐实测分别验收。

- A源码同步：local1fc2a121、remote a904ad98135e790ad9828750dc2de50e538ec7c1、tree cb446f96639bcfe0ca4782233f5f5a2f698a3d12一致。发布证据RELEASE-A，备份及后台包已准备；真实切换待完成。
- B互斥所有权追加：runtime_setup转backend_worker，唯一改mysql-store.ts及mysql-store.snapshot.integration.test.ts；flow_engineering唯一改CommerceStore/Memory接口、app与通知实现，仍为集成/Git/部署负责人。readSnapshot<T>(work:(store:CommerceStore)=>Promise<T>)；写事务内复用快照，readonly内写或transaction拒绝。隔离DB测试由worker独占至冻结，不同角色避免重置冲突。

## A正式发布完成
- 工程32HTTP PASS，API_READY后current切至/var/www/hometown-admin-a904ad9；image sha256:f494d34d44ab05baf7aa0377d14ab75a4ac80f1819ed3d3d840d374fa65a8fbf。
- index SHA dcad6bd6345e76e8ff85777870dc1a34c58304e64bce9875e01c699f27439553，主JS index-Cl7_6k7G.js SHA416dcf3b7792a82a004b31c79fba1cfa50218471bd4398bcfcb019d04e48bf1c。
- 发布备份c33d94b81932e0d06871f7ae27bb3643075609c1f8124e86cafc7bf291cd31e7，切前第二份数据备份4cb2d23a366377abc9619ec8ed2d94a431679c52407508e47ee26903e761489a均异机保存；环境/资源挂载不变，DBRedis未重建，无业务数据写入。
- QA独立实时5HTTP PASS，页面/JS字节与prepared精确一致、ready五依赖ok；归档保留项最终复核待返回。root在线GitHub compare A与分支identical。

## B快照子包交接
- runtime_setup attempt4冻结mysql-store.ts及mysql-store.snapshot.integration.test.ts；新增真实12/12零skip，此前新10+旧8在独立空库18/18PASS。最终typecheck/定向lint/diffcheck通过；仅子包完成未最终整体验收。
- 证据runtime/SNAPSHOT-HANDOFF.md及snapshot-tests-attempt1..4.log，保留历史测试fixture失败。两个文件所有权已转回flow_engineering整合。

## 用户限时收口与容量实测结论
- confirmed：用户追加“快点，2分钟以内完工”；root停止扩大本轮实现与负载，按实际完成状态收口，不把限时视为降低发布门槛。
- A COMPLETE：两P1已修复、Git同步并正式发布；QA发布attempt2 PASS，线上运行a904ad9，B候选未进入生产。
- B IMPLEMENTED_NOT_RELEASED：7文件候选快照/通知优化已实现，真实快照12项、通知含wall-clock11项通过；1000通知×100ms替身并发5实际23.16秒，仅Memory/provider替身，不是DB吞吐。B未完成最终源码QA，源码保留工作树，不混入已验收A提交。
- 容量BLOCKED：独立合成库1000身份、1万历史订单、payload8428905字节。public10RPS p95约68ms但峰RSS454MiB；public100RPS实际仅17.1RPS且397/501受测试保护未发送，p95约1.34s、RSS580MiB。Bearer10RPS实际1.73RPS、p95约10.65秒；100RPS实际1.65RPS，481/501未发送，RSS688MiB。均超过生产384MiB预算，不能以HTTP已完成请求零失败称通过。
- 初测每档5秒，仅定位瓶颈，不是长期容量/稳定性验收；mac硬件及MySQL大小写差异仍保留。负载已停止，无生产压测。
- 新发现：管理员及微信认证对同消费者令牌各调用一次带清理副作用的getAuthSession，造成每请求至少两次聚合锁写；后续可拆显式有效会话只读方法并保留过期拒绝/清理语义；mysql2 JSON双转换也需优化。这些尚未实施，不记录为修复。
- 当前交付：A线上可用；B候选及可复现测试证据保留，禁止发布；千人放量仍BLOCKED。真实微信交易和自动备份告警的剩余验收未被本轮替代。

## 后续用户决定：继续执行有依据的解决方案
- confirmed：用户随后明确“有没有好的解决方案，有的话可以直接执行”，替代上段限时收口/停止实施决定。继续B修复，不提交未验收候选、不停止隔离runtime。两分钟不能作为未经验证发布依据。
- root冻结B增量：新增getActiveAuthSession纯只读有效会话方法，认证改用该方法，原getAuthSession过期清理保持；保留过期、停用、改密/改角色/换点位立即失效。mysql2 jsonStrings减少JSON重复转换，不迁移schema。
- 再跑同一1000身份/1万订单、公开及真实Bearer短阶梯，容量结果嵌入运行源码指纹及环境参数；实际RPS、未发送准入数、RSS全列。1000DAU与1000同时在线分别评价，未通过的高档不冒充通过。
- 若仍不达标，依据下一轮数据定位并继续最小修复；费用/不可逆迁移仍保持独立边界，当前未涉及。

## 最新决定：停止开发，GitHub 交接
- confirmed：用户要求停止修复及部署，将全部最新代码与剩余方案同步 GitHub 给另一 agent；替代上一节继续实施和不提交未验收候选的安排。本次明确允许 WIP 交接，不代表 B 发布批准。
- getActiveAuthSession 与 jsonStrings 已实现；最新 API typecheck PASS，认证与快照53/53 PASS（真实快照13项），通知11/11 PASS。B完整QA与全量门禁未完成。
- 优化后 Bearer10RPS 实际9.85、p95 222ms、锁写0，但RSS505MiB；100RPS实际10.26、440/501未发送、p95 2.06秒、RSS656MiB。公开100RPS实际26.96、348/501未发送、p95 825ms、RSS502MiB。容量仍未通过，完整前后JSON随交接入库。
- QA指出通知Promise.race不取消底层provider.send，跨轮残留请求未证明受全局并发5限制；保留为待调查限制，未宣称生产故障或已修复。
- 已停止任务MySQL/Redis并确认13306/16379端口关闭；保留数据日志，生产未操作。
- 当前权威交接入口：[接手说明](handoff-20260908-readiness.md)。生产仍A；B仅同步GitHub，不自动部署。
