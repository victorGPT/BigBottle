#!/bin/bash
# Supabase Edge Function 配置脚本
# 设置所需的 secrets 以启用认证和 API 功能

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_REF="tbvkyvxdhrmfprcjyvbk"
echo "=== BigBottle Supabase 配置 ==="
echo "项目: $PROJECT_REF"
echo ""

# 检查 supabase CLI
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI 未安装"
    echo "安装: https://supabase.com/docs/guides/cli/getting-started"
    exit 1
fi

# 检查登录状态
if ! supabase projects list &> /dev/null; then
    echo "❌ 请先登录 Supabase:"
    echo "   supabase login"
    exit 1
fi

echo "✅ Supabase CLI 已配置"
echo ""

# 检查当前 secrets
echo "=== 当前 Secrets ==="
supabase secrets list --project-ref $PROJECT_REF 2>/dev/null || echo "(无法列出 secrets)"
echo ""

# 必需 secrets
echo "=== 必需 Secrets ==="
echo "以下 secrets 必须设置:"
echo ""
echo "1. JWT_SECRET - 用于签名 JWT tokens (至少 32 字符随机字符串)"
echo "2. BB_SUPABASE_URL - Supabase 项目 URL"
echo "3. BB_SUPABASE_SERVICE_ROLE_KEY - Supabase service role key"
echo ""

# 生成 JWT_SECRET 建议
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || echo "")
if [ -n "$JWT_SECRET" ]; then
    echo "💡 建议的 JWT_SECRET (随机生成):"
    echo "   $JWT_SECRET"
    echo ""
fi

echo "=== 可选 Secrets (完整功能) ==="
echo ""
echo "AWS S3 配置 (图片上传):"
echo "   AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
echo ""
echo "Dify AI 配置 (收据识别):"
echo "   DIFY_MODE=workflow, DIFY_API_URL, DIFY_API_KEY, DIFY_WORKFLOW_ID"
echo ""
echo "CORS 配置:"
echo "   CORS_ORIGIN=https://your-frontend.vercel.app"
echo ""

# 交互式设置
echo "=== 设置 Secrets ==="
read -p "是否现在设置必需 secrets? (y/n): " SET_REQUIRED
if [ "$SET_REQUIRED" = "y" ]; then
    read -p "JWT_SECRET (留空使用随机生成): " INPUT_JWT_SECRET
    JWT_SECRET=${INPUT_JWT_SECRET:-$JWT_SECRET}
    
    read -p "BB_SUPABASE_URL [https://tbvkyvxdhrmfprcjyvbk.supabase.co]: " SUPABASE_URL
    SUPABASE_URL=${SUPABASE_URL:-https://tbvkyvxdhrmfprcjyvbk.supabase.co}
    
    read -p "BB_SUPABASE_SERVICE_ROLE_KEY: " SERVICE_ROLE_KEY
    
    echo ""
    echo "正在设置 secrets..."
    
    supabase secrets set JWT_SECRET="$JWT_SECRET" --project-ref $PROJECT_REF
    supabase secrets set BB_SUPABASE_URL="$SUPABASE_URL" --project-ref $PROJECT_REF
    supabase secrets set BB_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" --project-ref $PROJECT_REF
    
    echo "✅ 必需 secrets 已设置"
fi

echo ""
echo "=== 部署 Edge Function ==="
read -p "是否部署 Edge Function? (y/n): " DEPLOY
if [ "$DEPLOY" = "y" ]; then
    echo "通过 canonical 脚本部署中..."
    SUPABASE_PROJECT_REF="$PROJECT_REF" \
      bash "${SCRIPT_DIR}/ci/deploy_supabase_api.sh"
    echo "✅ Edge Function 已通过 canonical 脚本部署"
fi

echo ""
echo "=== 验证 ==="
API_BASE_URL="https://$PROJECT_REF.supabase.co/functions/v1/api"
if bash "${SCRIPT_DIR}/ci/check_supabase_public_auth_routes.sh" "$API_BASE_URL"; then
    echo "✅ Public auth routes 验证通过"
else
    echo "❌ Public auth routes 验证失败 (可能需要等待部署完成)"
fi

echo ""
echo "完成!"
echo ""
echo "下一步:"
echo "  1. 在 Vercel Dashboard 设置 VITE_API_URL"
echo "  2. 重新部署前端"
