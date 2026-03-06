# 远程配置指南（不在家也能完成）

> 使用 GitHub Actions 从任何地方（包括手机）完成 Supabase 和 Vercel 配置

---

## 📱 手机/远程配置方法

### 方法 1: GitHub Actions（推荐）

我为你创建了两个 GitHub Actions 工作流，可以在 GitHub 网站或手机 App 上直接触发：

#### 第一步：添加 GitHub Secrets

你需要在 GitHub 仓库设置中添加两个 secrets（只需一次）：

1. 打开 https://github.com/victorGPT/BigBottle/settings/secrets/actions
2. 添加以下 secrets：

| Secret Name | 获取方式 |
|------------|---------|
| `SUPABASE_ACCESS_TOKEN` | https://app.supabase.com/account/tokens → "New access token" |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens → "Create" |

#### 第二步：配置 Supabase（手机可操作）

1. 打开 GitHub App 或浏览器访问仓库
2. 进入 **Actions** → **Setup Supabase Secrets**
3. 点击 **Run workflow**
4. 填写表单：
   - `jwt_secret`: 留空（自动生成）
   - `supabase_url`: `https://tbvkyvxdhrmfprcjyvbk.supabase.co`
   - `service_role_key`: 从 Supabase Dashboard → Project Settings → API → service_role key
   - `cors_origin`: 你的 Vercel 前端 URL，如 `https://bigbottle.vercel.app`
   - `deploy_function`: ✅ 勾选
5. 点击 **Run workflow**

#### 第三步：配置 Vercel（手机可操作）

1. 进入 **Actions** → **Setup Vercel Environment**
2. 点击 **Run workflow**
3. 表单保持默认即可，点击 **Run workflow**

---

### 方法 2: 短信/消息获取配置命令

如果你现在能收发短信或消息，我可以把具体命令发给你，复制粘贴即可执行。

#### Supabase 配置命令：

```bash
# 1. 登录 Supabase
supabase login

# 2. 设置必需 secrets
supabase secrets set JWT_SECRET="$(openssl rand -hex 32)" --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set BB_SUPABASE_URL="https://tbvkyvxdhrmfprcjyvbk.supabase.co" --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set BB_SUPABASE_SERVICE_ROLE_KEY="YOUR_KEY_HERE" --project-ref tbvkyvxdhrmfprcjyvbk

# 3. 部署 Edge Function
supabase functions deploy api --project-ref tbvkyvxdhrmfprcjyvbk --no-verify-jwt --use-api
```

#### Vercel 配置命令：

```bash
# 1. 登录 Vercel
vercel login

# 2. 进入项目
cd apps/web

# 3. 设置环境变量
echo "https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api" | vercel env add VITE_API_URL production
echo "https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api" | vercel env add VITE_API_URL preview

# 4. 重新部署
vercel --prod
```

---

### 方法 3: 回家后再完成

如果你暂时无法操作，以下是**最快**的回家完成步骤：

#### 5 分钟快速配置：

1. **Supabase Dashboard** (1分钟)
   - 打开 https://supabase.com/dashboard/project/tbvkyvxdhrmfprcjyvbk/settings/functions
   - Edge Functions → `api` → Secrets
   - 添加: `JWT_SECRET` = 任意 32+ 字符随机字符串
   - 添加: `BB_SUPABASE_URL` = `https://tbvkyvxdhrmfprcjyvbk.supabase.co`
   - 添加: `BB_SUPABASE_SERVICE_ROLE_KEY` = Settings → API → service_role key

2. **Vercel Dashboard** (1分钟)
   - 打开 https://vercel.com/dashboard
   - 选择 `web` 项目
   - Settings → Environment Variables
   - 添加: `VITE_API_URL` = `https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api`
   - 应用到 Production 和 Preview

3. **重新部署** (3分钟自动完成)
   - 推送任意 commit 或点击 Redeploy

---

## 🔐 需要准备的信息

配置前请准备好：

1. **Supabase Service Role Key**
   - 位置: Supabase Dashboard → Project Settings → API → `service_role` (注意不是 `anon`)
   - 格式: `eyJhbG...`

2. **Vercel 项目 Token** (如果用 GitHub Actions)
   - 位置: https://vercel.com/account/tokens

3. **Supabase Access Token** (如果用 GitHub Actions)
   - 位置: https://app.supabase.com/account/tokens

---

## ✅ 配置完成后的验证

配置完成后，访问你的 Vercel 网站：
1. 打开 Account 页面
2. 登录钱包
3. 刷新页面 - 不应再出现 401 错误
4. Push 新代码后再次验证

如果仍有问题，检查：
- Supabase secrets 是否设置正确
- Vercel 环境变量是否指向正确的 API URL
- 浏览器是否清除了旧 token
