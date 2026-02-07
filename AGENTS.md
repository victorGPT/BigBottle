# BigBottle Agent Notes (Repo-Specific)

This file contains **BigBottle-specific** engineering constraints and verification notes.
It is intended to **complement** the global `AGENTS.md` constitution used in this workspace.

If a rule here conflicts with the global constitution, **this repo file wins** (project files have higher authority).

## VeWorld iOS Login Stability (重要)

现象：在 **VeWorld iOS 内置浏览器**里，钱包连接流程在完成 **certificate 签名**后，若紧接着触发下一次签名/bridge 调用，可能导致 VeWorld 直接闪退。

当前仓库的已验证 workaround（见 `apps/web/src/app/pages/WalletPage.tsx`）：

- 在 `connect()` 成功后，**等待一小段时间**（当前实现是 `450ms`）再进行后续的 typed data 签名流程。
- 进行 typed data 签名时，**显式传入 signer**（`{ signer: <connectedAddress> }`）。
- 统一使用 `useWallet().requestTypedData(...)` 调用签名，不要直接使用底层 `signer.signTypedData(...)`（避免参数/桥接差异）。

注意：

- 这个问题发生在原生层/bridge，**单元测试无法证明“不闪退”**；自动化测试只能做“回归护栏”（防止 workaround 被误删/误改）。

## Frontend Testing Strategy

目标：对“我们可控的逻辑”提供回归保护，不对原生稳定性做虚假保证。

- 推荐在 `apps/web` 使用 `Vitest + React Testing Library (RTL)`：
  - 覆盖登录流程的关键行为（调用顺序、参数）作为护栏测试。
  - 不要在测试描述里声称覆盖/修复 VeWorld 原生闪退。
- 真机验收仍是必需项（见下方 Verification）。

## Verification (必做)

在触及钱包登录流程（尤其是 `WalletPage`）的改动后，至少完成：

- `pnpm -C apps/web typecheck`
- 真机 VeWorld iOS（最新版本）手工回归：
  - 连续登录 10 次（或冷启动后重复）不闪退
  - 能正常拿到 `access_token` 并进入已登录状态

