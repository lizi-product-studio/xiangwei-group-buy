# OPS-20260921-01 服务器内存与巡检

用户要求：统一正式、测试服务器的合理配置，清理内存，设置自清理和自检测，支持后续代码与测试运行。

范围：正式 `housekeeping-server / 192.144.136.205`，测试 `180.76.100.156`。本任务 `01a0c270-d115-7bd2-92aa-ffe15e8cbe3e` 是唯一配置写入者；已通知产品交付主编排避免并行发布。独立审核复用 `01a0c195-b199-7813-b368-8c60f6f01fdf`，Luna high。本地基线 `7b252b9f3e85f87a74dae3c3cae0a0790cb88bb5`；不修改业务源码，不纳入用户未跟踪原型。

## 基线与验收

- 2026-09-21 13:31–13:38 CST 只读检查：正式内存1963MiB、可用约800MiB、2GiB swap使用约842MiB，短时采样无持续换页；测试3403MiB、可用2681MiB、无swap、无运行容器。根盘分别45%与70%。
- 正式OpenCloudOS9.4 / Docker29.3.1，测试Ubuntu24.04.4 / Docker29.7.2，均cgroup v2 / systemd255。不通过重装系统、降级Docker或复制生产凭据实现表面一致。
- 两端现有MySQL与Redis镜像完全一致：MySQL `sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb`；Redis `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`。正式API为Node v22.23.2；项目pnpm固定11.16.0。
- OPS-01：已部署相同巡检代码与定时器、2GiB应急swap、swappiness20；因角色不同，预警阈值分别384/768MiB。测试机独立后验通过，正式后验见下。
- OPS-02：正式PM2零应用且开机服务disabled，已退出闲置守护；测试初始没有待停止进程。未执行drop_caches、swapoff清数值、Docker重启、全局prune或删除旧容器/卷/证据。
- OPS-03：受限测试入口 `/usr/local/sbin/server-test-run` 已安装；固定容器名互斥、1800MiB含swap、1.5CPU、512PIDs、Node堆1152MiB、默认20分钟最长60分钟；启动需可用内存2000MiB、磁盘4GiB、巡检新鲜。每10秒采样、连续两次低于512MiB仅停止本工具标记的测试容器。真实smoke及独立后验通过。
- OPS-04：正式主机绝不因监测而停止业务容器；每小时只读审计SSH/容器/监听端口，报告root-only、本工具事件日志轮转。源码独立审核和测试机后验通过；正式后验见下。
- OPS-05：配置备份、可执行回退、实际安装摘要及使用说明已落地；测试机回退及重装实测通过。源码同步结果随本轮提交报告。

## 安全边界与使用

两个主机当前都允许root+密码SSH；云安全组尚未核实。本轮不更改凭据、SSH登录方式、防火墙、云代理或生产服务发布，不能把巡检安装称为完成所有安全加固。工具只管理明确标记的专用测试容器，不接管其他任务。

测试源码放在 `/srv/server-tests/<项目目录>`。使用已存在、含 `/usr/bin/timeout` 的可信镜像，通过受限入口运行；不复制生产.env、密钥或业务数据。安装完成后的示例：

```sh
server-test-run --workdir /srv/server-tests/my-project --image node:22-bookworm-slim --minutes 20 -- node --version
docker logs -f server-test-runner
docker inspect --format '{{.State.ExitCode}}' server-test-runner
server-health
```

浏览器或数据库集成测试需对应镜像、独立测试网络和隔离依赖；默认 `server-tests` 专用网络，入口强制校验local bridge与owner标签，禁止共享默认bridge或host网络。使用单worker，依赖内存计入整机预算。未经入口直接执行的宿主任务不自动受此限制。SSH断开后查看固定名容器，不重复启动。任务结束/超时释放进程内存；旧受管容器替换前先保存日志和退出状态，不删除卷。历史未受管容器保持原位。新工具的运行归档达到256MiB时拒绝启动新任务，保留证据交人工归档；阈值检查前一轮日志尚未归档，允许单次有限上冲。

巡检：`server-health`；`systemctl status server-guard.timer server-audit.timer`；`journalctl -u server-guard.service -u server-audit.service`。结构化快照 `/var/lib/server-guard/latest.json`、`security.json`；事件 `/var/log/server-guard/events.jsonl`。这属于服务器本地定时任务，未配置向用户发送外部通知。

配置备份由安装器输出到 `/root/server-guard-backups/<UTC时间>-<角色>/`。可执行回退为 `python3 <备份目录>/rollback.py <备份目录>`；安装持久修改阶段失败时ERR trap自动调用。回退停用本工具unit，严格读取备份present/absent白名单，只恢复本工具文件，恢复记录的swappiness和原unit启用/运行状态。测试swap不自动swapoff，状态、日志、专网和swap文件保留；须核实占用与可用内存，再决定卸载，避免回退造成OOM。旧服务、数据、证据不在回退删除范围。

## 审核与验证记录

- v1独立审核确认生产保护和停止策略8/8通过，指出网络归属、安装失败状态、归档长期增长风险。保留问题修正定性：OPS-03-NET-01为集成场景条件P1，缺少自动回退本身非硬阻断；仍主动补齐。
- v2新增专用带owner标签网络、全部5unit预检、可执行rollback/失败trap、256MiB归档门禁；独立增量审核允许测试机安装与回退演练。测试机systemd-analyze verify exit0（仅既有rdma.service未知键警告），9/9停止与网络策略测试PASS。
- v2归档SHA256 `b3545079ee56a4758599255696574d6267bcba94a95fe00300f948ee90a2b9c2`；server_guard.py `4777b61e126f81afe1b93da26f6d09c7d38a66721823276f73b5059de3ea79ae`，install.sh `f3eeb1994bfe4882bd68c900d926de5f0054c31e93d200acbed6016c795916fc`，rollback.py `4de95a0d66c99035ab112f55c064890382c9cdc0c66b523b6ae68a29065f64b1`。
- 正式PM2在再次核实应用数0后退出；原PID4143917已消失，API/MySQL/Redis均healthy，未重启业务服务。正式可用约804MiB；不将采样波动当作净回收量。
- 测试机首次安装成功，备份 `/root/server-guard-backups/20260921T055014Z-test`；源码/原始安装日志 `/root/ops-20260921-server-maintenance-v2/`。
- 真实smoke：受限容器Node v22.23.2退出0，与正式API版本一致；实际inspect内存/含swap1800MiB、1.5CPU、512PIDs、cap-drop ALL、无公开端口、专用server-tests网络全部符合；重复启动及共享bridge均拒绝。
- SSH断开后独立60秒任务正常超时，退出124、OOM=false。低内存验证使用注入MemAvailable=100MiB的采样值，未真实耗尽主机内存：第一次保留运行、第二次通过真实Docker stop停止唯一受管runner，恢复真实采样。初次演练脚本漏传config导致TypeError，修正演练脚本后PASS，受审源代码未修改；timer已恢复。
- 测试机执行首次备份的rollback.py成功：工具文件恢复为不存在、swappiness回到60，swap保持active且占用0、日志保留；随后同版重装成功，最终备份 `/root/server-guard-backups/20260921T055241Z-test`。两个timer与swap service均active，部署脚本摘要和源码一致。原始回退/重装记录分别rollback-smoke.log/install-final.log；静态service被disable时的systemd提示不影响恢复断言。
- 正式机同版暂存路径与测试相同，5unit预检和9/9单测通过，health/ready=200；此前已有云代理tat_agent的旧PIDFile路径警告，与本次unit无关。业务容器ID基线：API52b80d3b110f、Redis e82f411b3a36、MySQL e32829415a22。
- 独立QA通过SSH只读验证测试机配置权限、timer/swap enabled+active、专网owner、实际runner限制、日志退出0/124/143、无OOM、回退/重装及代码摘要一致，放行同版production安装。
- 正式安装成功，备份 `/root/server-guard-backups/20260921T055515Z-production`；guard/audit timer均active，Python摘要与测试机相同。production-containers.before/after逐字diff无差异，健康接口200，可用内存793MiB/1963MiB；2GiB swap使用824MiB。未进行Docker/业务/SSH重启。
- 最终独立生产后验PASS：production角色、两个timer enabled/active、快照root-only且新鲜、源码及unit摘要一致、runner_id=null；API/MySQL/Redis身份/镜像/端口/healthy与安装前相同，live/ready与全部依赖ok。测试与正式的本轮运维验收完成；保留SSH密码登录和未核实云安全组的安全边界。
- 最终主验快照（约13:57 CST）：正式可用807MiB/1963MiB，swap2047MiB/已用824MiB，磁盘余22853MiB；测试可用2665MiB/3403MiB，swap2047MiB/已用0，磁盘余9670MiB；两个主机timer均开机启用且active。数值是低负载快照，不代表容量压测。
