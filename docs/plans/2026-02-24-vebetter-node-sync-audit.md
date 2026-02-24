# VeBetterDAO 节点同步方案审计（V1）

日期：2026-02-24  
范围：`thorNodes` 的 `owner + level`（可附带 `isX`），**不包含 delegation 目标关系**。  
数据源：`https://graph.vet/subgraphs/name/vebetter/dao`

## 1) 审计结论

**Verdict: GO_WITH_FIXES**

方案可行，但在落地前必须补齐以下风险控制：

1. 分页必须稳定排序（`orderBy: identifier`, `orderDirection: asc`）
2. 必须记录同步锚点（`sync_block_number`）
3. 每日快照必须幂等（`snapshot_date + identifier` 唯一键 upsert）
4. current 表必须具备“全集覆盖”语义（同步结束清理本轮未出现的旧记录）
5. 与需求对齐：只保留 VeBetterDAO 节点 owner/level 口径，不引入委托目标

## 2) 修正后的数据契约

### 2.1 `vebetter_node_current`（当前态）

- `identifier` bigint PK
- `owner_address` text not null (lowercase)
- `level` integer not null
- `is_x` boolean not null
- `sync_block_number` bigint not null
- `sync_run_id` uuid not null
- `updated_at` timestamptz not null

### 2.2 `vebetter_node_snapshot_daily`（日快照）

- `snapshot_date` date not null
- `identifier` bigint not null
- `owner_address` text not null
- `level` integer not null
- `is_x` boolean not null
- `sync_block_number` bigint not null
- `sync_run_id` uuid not null
- `updated_at` timestamptz not null
- PK(`snapshot_date`, `identifier`)

## 3) 同步契约（Sync Contract）

每日一次：

1. 生成 `sync_run_id`。
2. 分页拉取 `thorNodes`：
   - 固定排序：`identifier asc`
   - 游标：`identifier_gt`
   - 过滤：`owner_not = 0x000...000`
3. 每条记录写入：
   - `bb_upsert_vebetter_node_current(...)`
   - `bb_upsert_vebetter_node_snapshot_daily(...)`
4. 全量完成后执行：
   - `bb_finalize_vebetter_node_current_sync(sync_run_id)`
   - 清理本轮未出现的旧 current 记录（实现“全集覆盖”）。

## 4) 变化定义（Diff）

与前一日快照对比：

- Added：昨日无、今日有
- Removed：昨日有、今日无
- OwnerChanged：identifier 相同，owner 变化
- LevelChanged：identifier 相同，level 变化

## 5) 审计留档与实现映射

本次审计建议已映射到以下实现文件：

- `supabase/migrations/20260224_vebetter_nodes_sync.sql`
- `apps/api/src/vebetter-nodes.ts`
- `apps/api/src/vebetter-node-sync.ts`
- `.github/workflows/vebetter-node-sync.yml`

包含：

- 两张表（current + daily snapshot）
- 幂等 upsert 函数
- 同步收敛（finalize cleanup）函数
- 稳定分页查询与 owner/level 归一化逻辑
- 每日定时工作流

## 6) 约束与非目标

- 非目标：委托目标地址跟踪（node delegation receiver）
- 非目标：泛 VeChain 节点全网扩展逻辑
- 当前仅保障 VeBetterDAO `thorNodes` owner/level 的可追踪与可审计
