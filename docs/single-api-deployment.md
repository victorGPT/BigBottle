# 单一 API 部署方案（Supabase Edge Function）

> 方案 B 实施文档：统一使用 Supabase Edge Function 作为唯一 API 部署

---

## 🎯 目标

- ✅ 使用 Supabase Edge Function 作为唯一 Production API
- ✅ 废弃/停止使用 Vercel Fastify API 部署
- ✅ 统一 JWT_SECRET，彻底解决 401 问题

---

## 📋 前置检查清单

- [ ] Supabase 项目已创建：`tbvkyvxdhrmfprcjyvbk`
- [ ] Supabase Edge Function `api` 已部署
- [ ] Vercel 项目已创建：`big-bottle-web`
- [ ] 数据库 migrations 已应用

---

## 1. 配置 Supabase Edge Function Secrets

### 必需 Secrets（认证相关）

```bash
# 进入项目目录
cd /path/to/BigBottle

# 设置 JWT_SECRET（至少 16 字符，推荐 32+ 随机字符）
supabase secrets set JWT_SECRET=your-random-secret-here --project-ref tbvkyvxdhrmfprcjyvbk

# 设置 Supabase 连接（注意：Edge Functions 需要使用 BB_ 前缀避免冲突）
supabase secrets set BB_SUPABASE_URL=https://tbvkyvxdhrmfprcjyvbk.supabase.co --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set BB_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key --project-ref tbvkyvxdhrmfprcjyvbk
```

### 可选 Secrets（完整功能）

```bash
# AWS S3 配置（图片上传）
supabase secrets set AWS_REGION=ap-northeast-1 --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set S3_BUCKET=your-bucket-name --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set AWS_ACCESS_KEY_ID=your-key --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set AWS_SECRET_ACCESS_KEY=your-secret --project-ref tbvkyvxdhrmfprcjyvbk

# Dify AI 配置（收据识别）
supabase secrets set DIFY_MODE=workflow --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set DIFY_API_URL=https://api.dify.ai/v1 --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set DIFY_API_KEY=your-dify-key --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set DIFY_WORKFLOW_ID=your-workflow-id --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set DIFY_IMAGE_INPUT_KEY=image_url --project-ref tbvkyvxdhrmfprcjyvbk
supabase secrets set DIFY_TIMEOUT_MS=20000 --project-ref tbvkyvxdhrmfprcjyvbk

# CORS 配置
supabase secrets set CORS_ORIGIN=https://your-frontend-url.vercel.app --project-ref tbvkyvxdhrmfprcjyvbk
```

### 验证 Secrets

```bash
supabase secrets list --project-ref tbvkyvxdhrmfprcjyvbk
```

---

## 2. 部署 Supabase Edge Function

### 使用部署脚本（推荐）

```bash
bash scripts/ci/deploy_supabase_api.sh
```

### 手动部署

```bash
supabase functions deploy api \
  --project-ref tbvkyvxdhrmfprcjyvbk \
  --no-verify-jwt \
  --use-api
```

### 验证部署

```bash
# 检查路由公开性
bash scripts/ci/check_supabase_public_auth_routes.sh

# 手动测试
curl https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/health
curl -X POST https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/auth/challenge \
  -H "Content-Type: application/json" \
  -d '{"address": "0x1234567890123456789012345678901234567890"}'
```

---

## 3. 配置 Vercel 前端环境变量

### 通过 Vercel Dashboard 配置

1. 打开 https://vercel.com/dashboard
2. 选择项目 `big-bottle-web`
3. 进入 `Settings` → `Environment Variables`
4. 添加以下变量（Production 和 Preview 环境）：

| 变量名 | 值 |
|--------|-----|
| `VITE_API_URL` | `https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api` |

### 或使用 Vercel CLI

```bash
vercel env add VITE_API_URL production
# 输入: https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api

vercel env add VITE_API_URL preview
# 输入: https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api
```

---

## 4. 重新部署前端

```bash
# 推送到 main 分支触发自动部署
git add .
git commit -m "chore: switch to Supabase Edge Function API"
git push origin main

# 或手动触发 Vercel 重新部署
vercel --prod
```

---

## 5. 废弃 Vercel Fastify API（可选）

### 方案 A：完全删除（如果不使用本地开发）

```bash
# 在 Vercel Dashboard 中删除项目
# 或使用 CLI
vercel remove big-bottle-api  # 如果存在的话
```

### 方案 B：保留但禁用（推荐，用于本地开发）

保留 `apps/api` 目录用于本地开发，但确保：
- Vercel 不部署此目录
- 生产环境不使用此 API

---

## 6. 验证修复

### 端到端测试

1. **访问前端页面**
   - 打开 `https://your-app.vercel.app`

2. **测试登录流程**
   - 点击登录
   - 完成钱包签名
   - 确认 Account 页面正常显示（无 401 错误）

3. **测试 push 后状态**
   - 推送新代码到 main
   - 等待 Vercel 部署完成
   - 刷新页面，确认仍保持登录状态

### 调试命令

```bash
# 检查 JWT 内容（替换为你的 token）
echo "eyJhbG..." | cut -d'.' -f2 | base64 -d 2>/dev/null | jq

# 测试 API 端点
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/me

curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/account/summary
```

---

## 🔧 故障排查

### 问题：仍然出现 401

**检查清单：**
1. [ ] `JWT_SECRET` 在 Supabase secrets 中已设置
2. [ ] `VITE_API_URL` 在 Vercel 环境变量中正确设置
3. [ ] 用户清除浏览器缓存后重新登录
4. [ ] Supabase Edge Function 已重新部署（修改 secrets 后需要重新部署）

### 问题：CORS 错误

**解决：**
```bash
# 设置正确的 CORS_ORIGIN
supabase secrets set CORS_ORIGIN=https://your-frontend-url.vercel.app --project-ref tbvkyvxdhrmfprcjyvbk
supabase functions deploy api --project-ref tbvkyvxdhrmfprcjyvbk --no-verify-jwt --use-api
```

### 问题：API 返回 404

**检查：**
```bash
# 确认 Edge Function 状态
supabase functions list --project-ref tbvkyvxdhrmfprcjyvbk

# 查看函数日志
supabase functions logs api --project-ref tbvkyvxdhrmfprcjyvbk
```

---

## 📚 相关文件

- `supabase/functions/api/index.ts` - Edge Function 源码
- `supabase/functions/api/config.toml` - Function 配置
- `apps/web/.env.example` - 前端环境变量模板
- `docs/jwt-401-analysis.md` - 401 问题根因分析

---

## ✅ 完成确认

部署完成后请确认：
- [ ] Supabase Edge Function 运行正常
- [ ] 前端使用正确的 `VITE_API_URL`
- [ ] JWT_SECRET 已配置且一致
- [ ] 登录/刷新页面无 401 错误
- [ ] Push 新代码后用户保持登录状态
