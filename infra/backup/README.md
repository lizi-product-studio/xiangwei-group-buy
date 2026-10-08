# 数据库备份与恢复演练

要求 Python 3.11+、Docker CLI 和 MySQL 8.4。凭据从已有 MySQL 容器环境读取，不写入脚本参数、回执或日志。默认目标仅为 `hometown-food-mysql-1` 中的 `hometown_food`。

每日 systemd timer 在服务器时间 03:20 后五分钟内执行。私有目录 `/var/backups/hometown-database` 保存 gzip 快照和 JSON 摘要回执，当前不自动删除任何历史备份。执行失败进入 systemd failed 状态；检查 `systemctl status hometown-database-backup.service` 和相应 journal。磁盘可用空间低于 512 MiB 时拒绝启动备份。

手动执行：

```sh
python3 /usr/local/lib/hometown-backup/database_backup.py
python3 /usr/local/lib/hometown-backup/database_backup.py --restore-drill
```

恢复演练先生成并校验新快照，再在同一 MySQL 内创建随机 `hometown_restore_*` 隔离库。恢复客户端与导出客户端都显式使用 utf8mb4。重新导出与原快照解压后 SHA-256 一致才算通过，随后只删除本轮新建的隔离库。失败回执保留隔离库名称供调查；不得用其覆盖正式库。演练不将正式数据传到测试机。

定时周期对应的备份数据损失窗口最多约 24 小时加随机延迟，前提是最近任务成功；实际恢复耗时以回执为准。2026-09-30 已将新备份加密发布，并由隔离测试机通过受限 SFTP 拉取校验；具体运行证据见项目交付记录。生产业务库恢复及历史备份删除仍须具体授权。

回退只需停用 `hometown-database-backup.timer`；保留已有备份和证据文件。此操作不涉及 API 或数据库容器切换。


## 异机加密副本

2026-09-30 两台服务器已按本节接线：正式机只持加密公钥，测试机受限目录保存解密密钥和密文；首份真实备份拉取及完整性校验成功。正式机未启用参数时，原每日备份行为不变；配置了 recipient/export 参数后，若 `age` 缺失、recipient 无效或加密失败，备份服务会失败关闭，原始 `.sql.gz` 与回执仍保留供恢复/调查。副本只允许密文进入测试机；不得将正式 SQL 解密到测试机文件系统或测试 MySQL。

### 工具和密钥

age 工具已由主 Agent 分别安装并核对版本：测试机 Ubuntu 24.04 与正式机均使用发行版 Ubuntu APT 包 `1.1.1-1ubuntu0.24.04.3`（正式机 `/usr/local/bin/age`，SHA-256 `529450dfeaf3055cb24d76789d0b1f5eb8cd23e03dc4add64f84776df1272b02`）；两机均已验证版本 `1.1.1` 与 GLIBC 兼容性。部署回执见 `docs/task-20260928-operations-v2.md` 对应交付记录。上游发行版指引和二进制 Sigsum 校验入口见 [age 官方 README](https://github.com/FiloSottile/age#installation) 与 [官方 Sigsum 说明](https://github.com/FiloSottile/age/blob/main/SIGSUM.md)。

由测试机生成 age identity，私钥放在测试机仅 root 可读目录（目录 0700、identity 0600），不传给正式机。额外恢复副本需由主 Agent 放在独立、加密且受控的恢复介质/密码管理器中；不在测试机本地单独保存第二份。正式机只接收一个或多个 `age1…` 公钥 recipient 文本，放入 root-only 配置文件。轮换期间，发布清单逐行包含当前和新 recipient，直到新旧 recipient 的加密包均有已验证副本；此代码的发布结果本身不清理旧版本。

### 正式机发布与测试机拉取

发布目录 `/var/backups/hometown-database/replica-export` 必须预创建为 root:`hometown-replica` 所有、2750（setgid 用于新 bundle 继承受限组）；bundle 子目录 0750，清单与密文 0640，group 仅授予受限 SFTP 账户读取权限，无 group write/world 权限。发布器会核对出口目录 uid 为 root、setgid/mode 与目标组，不匹配则失败关闭。受限 SFTP 账号的 chroot 根只指向该目录；配置为 `internal-sftp -R`（read-only），同时设置 `PermitTTY no`、`AllowTcpForwarding no`、`AllowAgentForwarding no`、`X11Forwarding no` 和仅 key 登录。不要把账号加入 Docker 组，也不要让它读取 `/var/backups/hometown-database` 的其他内容、compose 环境文件或密钥。`internal-sftp` 由 sshd 内置，不依赖两台机器上的外部 sftp-server 路径；账户强制命令应使用 OpenSSH `internal-sftp -R`，不能用可登录 shell 替代。

正式机 `sshd_config` 的账户匹配规则应限制到专用用户，并先按目标机现有配置核对合并；示意如下：

```text
Match User replica-reader
    ChrootDirectory /var/backups/hometown-database/replica-export
    ForceCommand internal-sftp -R -d /
    AuthenticationMethods publickey
    PasswordAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
```

主 Agent 安装时须核对正式机 OpenSSH 当前版本的 `sshd -t` 和 chroot 所有权要求。

正式机每日备份服务完成新的 `.sql.gz` 后，启用参数（仅修改服务配置，不创建第二个备份或清理 timer）：

```sh
/usr/bin/python3 /usr/local/lib/hometown-backup/database_backup.py \
  --replica-recipients /etc/hometown-backup/replica-recipients.txt \
  --replica-export /var/backups/hometown-database/replica-export
```

正式机源文件应先通过既有备份校验。脚本再次核对回执和 SQL/gzip SHA-256，再用 `age` 将每个 recipient 加密；在同文件系统 staging 目录中写 payload、摘要清单和最终 complete marker，最后原子改名发布。SFTP 只能看到完整目录。失败时清理 staging，不覆盖源备份，也不发布 complete marker。若目标已存在，重复调用会重新校验 manifest、complete marker、精确文件集、密文大小及 SHA-256，并核对对应源备份摘要；全部一致才返回 `ALREADY_PUBLISHED`。已有 bundle 缺文件、损坏或摘要不符时失败关闭并保留现场，不自动覆盖。

测试机使用独立 SSH key、主机指纹固定的 `known_hosts` 和 `StrictHostKeyChecking=yes` 只拉取 complete package。收到文件后先核对 marker、manifest 和密文 SHA，再运行：

```sh
sudo -n /usr/bin/python3 /usr/local/lib/hometown-backup/encrypted_replica.py verify \
  --bundle /var/lib/hometown-replica/incoming/<bundle-id> \
  --identity /etc/hometown-replica/age-identity.txt
```

校验器从 age 解密流直接进入 gzip/hash 校验，计算压缩内容及 SQL SHA，明文只在内存块中流过，不落地、不输出、不导入 MySQL。失败则保留 SFTP 收到的密文和非敏感错误类型供调查；源端原件不删。清单通过受限 SFTP 主机认证和 pinned host key 建立可信来源；age 认证标签验证密文完整性。manifest 与 complete marker 都不含密钥或订单内容。

### 恢复与留存边界

自动副本只做密文和内容完整性验证。恢复演练使用人工构造的合成数据库导出文件，在测试机隔离 MySQL 临时 schema 中完成加密、拉取、解密、恢复和反向摘要对账；正式备份 SQL 不解密到测试机，也不进入测试数据库。部署接线、密钥生成/托管、SSH chroot、主机指纹录入、systemd 修改、试跑与演练由主 Agent 在隔离窗口执行，生产明文不进入测试库，真实数据库恢复须在受限恢复环境单独执行。

现有所有备份保持不动。拟议保留规则仅作用于未来且已验证的加密副本：覆盖最近 7 个自然日的每日点及至少 4 个周点；凡属于仍有效 recipient/key-rotation 的最新可恢复副本均保留。当前只允许 dry-run 清单；未形成精确文件名、SHA、来源回执和“删除后仍满足最近 7 日/4 周/全部有效 key 可解密”的审核记录前，禁止删除。备份删除不启用定时器；可再生临时文件清理使用下节单独的受限定时器。

### 自动拉取与状态

测试机侧源码还提供受限拉取流程：每 15 分钟通过固定 `known_hosts`、专用 SSH key 和 `StrictHostKeyChecking=yes` 查询一次只读 SFTP 出口；只接受命名匹配的已完成目录。先拉取小型 completion marker/manifest 并检查 hash 与剩余空间门槛，再拉取密文，完成 age/gzip/SQL 摘要流校验后原子归档。已有成功回执的本地包再次出现时仍核对 manifest/complete 与密文大小、SHA-256，并与回执比对；状态查询也重验最新副本。检测到本地 bitrot 时状态失败并保留副本与证据。新包或密文校验失败时保留 `.failed-*` 收件目录与之前已验证副本，服务以失败状态退出。不会将正式数据恢复到测试 MySQL。systemd unit 设 `LimitCORE=0`，避免进程崩溃时将解密管道数据写入 core dump。隔离真实 age/SFTP 验证及一次生产到测试机密文拉取均已完成；同源有效证据见项目交付记录。

主 Agent 安装 `hometown-encrypted-replica-pull.service` 与 `.timer` 时，需将 `source.env.example` 复制为 `/etc/hometown-replica/source.env` 并填入专用只读账户名与生产地址；其余文件按 unit 中给定路径落地。私钥、host key、age identity 目录设为 root-only。没有完整配置时，`encrypted_replica.py status` 返回 `NOT_CONFIGURED`；首次未产出备份为 `WAITING_FOR_FIRST_BACKUP`；超过 26 小时无成功校验为 `STALE`；失败写入本地非敏感状态并令 systemd unit failed。检查：

```sh
systemctl status hometown-encrypted-replica-pull.timer hometown-encrypted-replica-pull.service
journalctl -u hometown-encrypted-replica-pull.service --since today
/usr/bin/python3 /usr/local/lib/hometown-backup/encrypted_replica.py status
```

当前没有经用户指定的外部通知接收端，因此状态由 systemd failed 与 journal 记录；不能声称短信、邮件或 webhook 告警已配置。若后续配置外部通知，需由主 Agent依据明确接收目标单独接线，不把密钥或备份清单内容写入通知。

### 一次性清理清单

`infra/cleanup/cleanup-manifest.json` 当前为空。`cleanup_manifest.py` 默认 dry-run，只接受清单中的精确目录、任务结束状态、固定 staging 根、未被持有的 `.active.lock` 及复核一致的 tree SHA。它拒绝备份、Docker 数据、系统配置和正式服务目录；没有通配符、递归扫前缀、docker prune 或定时器。只有针对确切 task-ended 临时包逐条填入 manifest，经 dry-run 复核后才允许 `--apply`。现有/未知历史备份、compose/密钥、数据卷、当前候选和可用回滚副本不属于其清理范围。当前没有待删除候选，未执行清理。

### 未来副本的 rotation dry-run / apply-plan

`encrypted_replica.py retention` 是针对测试机加密副本目录的手动容量轮换命令，没有配套 timer。必须显式给 `--managed-after` 时间和活动 recipient ID 清单（SHA-256 公钥 ID，不是密钥）；仅纳管时间之后、manifest 明确 `retentionEligible=true`、已有成功验证回执且当前密文/manifest hash 仍匹配的精确 bundle。旧历史数据、未验证/篡改数据、`.pending-*`、`failed-*`、状态/锁文件和测试机外生产备份均只列为保留对象，不参与候选。规则同时保留最新整体可恢复副本、最近 7 个有数据自然日、最近 4 个有数据 ISO 周点和每个活动 key 的最后一个已验证副本。

先生成和保存完整 dry-run 报告（包括精确候选名称与摘要、受保护理由、未纳管/失败/进行中清单、估算可释放字节）：

```sh
/usr/bin/python3 /usr/local/lib/hometown-backup/encrypted_replica.py retention \\
  --active-key-ids /etc/hometown-replica/active-recipient-key-ids.json \\
  --managed-after '<reviewed UTC timestamp>' \\
  --plan-out /var/tmp/hometown-replica-retention-plan.json
```

执行 `--apply-plan` 会重新计算候选，要求候选 ID 与加密/manifest 摘要完全相同、计划不超过 24 小时，并与拉取任务共用互斥锁；执行前还会逐个复核所有路径和摘要。apply 先原子写入本地轮换状态，记录精确源名与 manifest、压缩源和密文摘要，再删除测试机已审核的 bundle/receipt。下一次 pull 只有在远端同名包的受校验 marker/manifest 与该状态逐项完全一致时才跳过；同名包摘要或状态改变会失败关闭，绝不凭名字跳过新内容。源端导出文件不会被此轮换删除，因此生产出口占用继续增长；释放测试机空间不等于回收生产端空间，源端清理必须另有明确候选和授权。该命令具有删除能力，本次没有执行。两机已保存活动 key-ID 清单与纳管起始时间用于定期审核，首次计划均为 0 候选。真实备份删除未启用；非空计划须在具体授权范围内调用 `--apply-plan`。不为轮换另建调度器。

### 正式机备份与出口留存（仅提供手动 dry-run / apply-plan）

`source_retention.py` 管理正式机同一备份根下的源 `.sql.gz`、对应 `BACKUP_OK` 回执及完全匹配的 `replica-export/<bundle-id>`。默认只输出 dry-run；只纳管明确 `--managed-after` 之后、回执/gzip/SQL 摘要一致，且 `retentionEligible=true` 的完整同版导出包。旧历史、未知、失败、缺回执、缺包、在途和 symlink 都保留，不进入删除候选。保护最近 7 个有备份日、最近 4 个有备份 ISO 周、最新可恢复包，以及每个活动 recipient key 的最后一个副本；缺少任一活动 key 的可验证包时 apply 被阻止。

dry-run 计划绑定 backup/export 根目录身份、生成时间、每个源 gzip/receipt、manifest/complete/cipher 摘要和 inode、候选与保护集。apply 只接受 24 小时内、根身份和候选/保护集完全未变的计划；它同时持有现有备份 `.lock` 和独立 `.source-retention.lock`，再按 no-follow 文件描述符逐个复核后删除精确候选。计划、活动 key ID、managed-after 任一变化都会拒绝执行。工具不设 timer，也不调用真实生产删除。

先由主 Agent 配置经过审核的活动 key ID 清单及启用时间，再生成计划：

```sh
/usr/bin/python3 /usr/local/lib/hometown-backup/source_retention.py \
  --active-key-ids /etc/hometown-backup/active-recipient-key-ids.json \
  --managed-after '<reviewed UTC timestamp>' \
  --plan-out /var/tmp/hometown-source-retention-plan.json
```

只有在向用户展示该计划的确切文件名、SHA、保护理由与释放空间，并获得具体生产删除授权后，主 Agent 才可显式传入 `--apply-plan /var/tmp/hometown-source-retention-plan.json`。两机已执行真实 dry-run，首轮候选均为 0；未运行实际备份删除。

源端工具只接受纳管时间之后、回执为 `BACKUP_OK` 且 gzip/解压 SQL SHA 一致，并同时存在 `retentionEligible=true` 的完整 export manifest、complete marker 与匹配密文的新副本。它保留最近 7 个有数据自然日、最近 4 个有数据 ISO 周点、最新可恢复版本及每个有效 recipient 的最后副本；任一有效 key 缺少可验证副本时阻止 apply。旧历史、未知、失败、缺件和在途项会列为保留对象。计划绑定 backup/export 根目录设备号/inode/owner/mode、生成时间、候选及保护集、gzip/receipt/manifest/complete/cipher 哈希与 inode；apply 持有正式备份共用的 `.lock` 与 `.source-retention.lock`，重算计划、核对活动 key 列表，再以 no-follow 文件描述符复查后只删除精确 gzip、receipt 和对应 export bundle，不扫描或进入其他目录。该工具没有自动 timer；即使 apply-plan 文件存在，也不等于生产删除授权。


## 已结束临时产物的每周清理

`infra/cleanup/hometown-temp-cleanup.service` 调用同一已审核清理工具，timer 每周一北京时间 04:15 后五分钟内执行；它只处理 `/tmp/hometown-release-staging` 和 `/var/tmp/hometown-release-staging` 中已列入精确 manifest 的 `TASK_ENDED` 目录。服务不依赖维护者电脑在线，不递归清除未知项目，不操作 Docker 数据卷或备份。

每次交付结束后，将该次可再生临时包移入唯一 staging 目录，创建 `.active.lock`，确认没有使用者，再登记目录 SHA-256。运行 dry-run 核对后，定时器或手动启动该服务会再次核验内容与锁状态；有变化或仍在使用则拒绝。已删除的条目会被跳过。保留线上及回退产物、备份、用户素材与验证证据。日常磁盘与副本状态由现有每天 09:00 巡检汇总；该巡检依赖本机 Codex 可运行，外部短信或邮件告警未配置。
