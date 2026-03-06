# BigBottle Account 页面 401 问题诊断报告

## 问题现象
每次 push 新内容后，Account 页面显示 HTTP 401 错误，需要重新登录。

---

## 根本原因分析

### 1. JWT 密钥不一致（最可能原因）

项目使用 JWT (JSON Web Token) 进行认证，token 签名使用 `JWT_SECRET` 环境变量。

**关键发现**：项目有两套 API 部署：

| 部署方式 | 代码位置 | JWT 配置来源 |
|---------|---------|-------------|
| Vercel (Fastify) | `apps/api/src/index.ts` | 环境变量 `JWT_SECRET` |
| Supabase Edge Function | `supabase/functions/api/index.ts` | 环境变量 `JWT_SECRET` |

**问题**：如果两套部署的 `JWT_SECRET` 不一致：
1. 用户在 Vercel API 登录 → token 用 Vercel 的 secret 签发
2. Push 后前端切换到 Supabase Edge Function API → 用不同的 secret 验证 → **401 Unauthorized**

### 2. Token 验证流程

```
AccountPage.tsx
    ↓ 调用 apiGet('/account/summary', token)
    ↓
auth.tsx (useAuth hook)
    ↓ 从 localStorage 读取 token
    ↓
api.ts (request 函数)
    ↓ 添加 Authorization: Bearer <token> 头
    ↓
后端验证
    ↓ Fastify: @fastify/jwt 验证
    ↓ Supabase Edge: jose 库验证
    ↓ 都需要相同的 JWT_SECRET
```

### 3. Token 有效期

代码中 token 有效期设置为 **7 天**：
```typescript
// apps/api/src/index.ts
const token = await reply.jwtSign(
  { sub: user.id, wallet: user.wallet_address },
  { expiresIn: '7d' }
);

// supabase/functions/api/index.ts
return await new SignJWT({ wallet: user.wallet })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("7d")
  .setSubject(user.sub)
  .sign(jwtKey(config));
```

所以不是 token 过期导致的问题。

---

## 验证方法

### 检查环境变量是否一致

**Vercel 环境变量检查**（需要在 Vercel Dashboard 中确认）：
```bash
# 项目: big-bottle-web (prj_tT4Rco10SiEzQGtIwOGvfLiznVVW)
# 检查 Settings → Environment Variables
JWT_SECRET=???
```

**Supabase Edge Function 环境变量检查**：
```bash
# 在 Supabase Dashboard → Edge Functions → api → Configuration
# 或使用 CLI:
supabase secrets list
# 应该显示 JWT_SECRET 的值
```

### 检查前端 API URL 配置

**apps/web/.env.example**:
```bash
# 本地开发
VITE_API_URL=http://localhost:4000

# 生产环境（Supabase Edge Function）
# VITE_API_URL=https://<project>.supabase.co/functions/v1/api
```

**关键问题**：检查 Vercel 部署的 web 应用使用的 `VITE_API_URL` 是：
1. 指向 Vercel 的 Fastify API？
2. 还是指向 Supabase Edge Function？

---

## 修复方案

### 方案 1: 统一 JWT_SECRET（推荐）

确保 Vercel 和 Supabase 两个环境使用**完全相同的 JWT_SECRET**。

**步骤**：
1. 生成一个强密钥（至少 32 字符）：
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. 在 Vercel Dashboard 设置 `JWT_SECRET`

3. 在 Supabase Dashboard 设置相同的 `JWT_SECRET`：
   ```bash
   supabase secrets set JWT_SECRET=your-secret-here
   ```

### 方案 2: 统一使用单一 API 部署

**选项 A: 仅使用 Supabase Edge Function**
- 删除 Vercel Fastify API 部署
- 前端 `VITE_API_URL` 指向 Supabase

**选项 B: 仅使用 Vercel Fastify API**
- 禁用 Supabase Edge Function
- 前端 `VITE_API_URL` 指向 Vercel API

### 方案 3: 添加 Token 失效自动重登录（用户体验优化）

即使修复了 JWT_SECRET，也可以添加更好的错误处理：

**修改 `apps/web/src/state/auth.tsx`**:
```typescript
// 在 apiGet 调用失败时自动登出
async function run() {
  const token = readToken();
  if (!token) {
    if (!cancelled) setState({ status: 'anonymous', token: null, user: null });
    return;
  }

  try {
    const res = await apiGet<{ user: ApiUser }>('/me', token);
    if (cancelled) return;
    setState({ status: 'logged_in', token, user: res.user });
  } catch (error) {
    if (cancelled) return;
    // Token 验证失败，自动清除并设为匿名状态
    writeToken(null);
    setState({ status: 'anonymous', token: null, user: null });
  }
}
```

**修改 `apps/web/src/util/api.ts`** 添加 401 自动登出：
```typescript
async function request<T>(...): Promise<T> {
  // ... existing code ...
  
  if (!res.ok) {
    const msg = ...;
    // 如果是 401，触发全局登出事件
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  
  return json as T;
}
```

---

## 立即检查清单

请检查以下配置：

- [ ] Vercel 项目 `big-bottle-web` 的 `JWT_SECRET` 环境变量
- [ ] Supabase Edge Function `api` 的 `JWT_SECRET` secret
- [ ] 两个值是否完全相同
- [ ] 前端 `VITE_API_URL` 指向哪个 API
- [ ] 是否存在多个 API 部署同时运行

---

## 建议的下一步行动

1. **立即**：确认 Vercel 和 Supabase 的 `JWT_SECRET` 是否一致
2. **短期**：统一两个环境的 JWT_SECRET，或统一使用单一 API 部署
3. **中期**：添加 token 失效的优雅处理（自动跳转到登录页）
4. **长期**：考虑使用 refresh token 机制，减少用户重新登录频率
