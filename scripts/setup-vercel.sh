#!/bin/bash
# Vercel 环境变量配置脚本
# 设置前端 API URL 指向 Supabase Edge Function

set -e

echo "=== BigBottle Vercel 配置 ==="
echo ""

# 检查 vercel CLI
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI 未安装"
    echo "安装: npm i -g vercel"
    exit 1
fi

# 检查登录
if ! vercel whoami &> /dev/null; then
    echo "❌ 请先登录 Vercel:"
    echo "   vercel login"
    exit 1
fi

echo "✅ Vercel CLI 已配置"
echo ""

# 项目信息（以仓库根目录 .vercel/project.json 为准）
ROOT_PROJECT_JSON=".vercel/project.json"
if [ ! -f "$ROOT_PROJECT_JSON" ]; then
    echo "❌ 缺少 $ROOT_PROJECT_JSON"
    exit 1
fi

PROJECT_NAME=$(jq -r '.projectName' "$ROOT_PROJECT_JSON")
echo "项目: $PROJECT_NAME"
echo ""

# 当前环境变量
echo "=== 当前环境变量 ==="
vercel env ls production 2>/dev/null || echo "(无法列出环境变量)"
echo ""

# 设置 VITE_API_URL
API_URL="https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api"

echo "=== 设置 VITE_API_URL ==="
echo "值: $API_URL"
echo ""

read -p "是否设置 Production 环境? (y/n): " SET_PROD
if [ "$SET_PROD" = "y" ]; then
    echo "$API_URL" | vercel env add VITE_API_URL production
    echo "✅ Production 环境变量已设置"
fi

read -p "是否设置 Preview 环境? (y/n): " SET_PREVIEW
if [ "$SET_PREVIEW" = "y" ]; then
    echo "$API_URL" | vercel env add VITE_API_URL preview
    echo "✅ Preview 环境变量已设置"
fi

read -p "是否设置 Development 环境? (y/n): " SET_DEV
if [ "$SET_DEV" = "y" ]; then
    echo "$API_URL" | vercel env add VITE_API_URL development
    echo "✅ Development 环境变量已设置"
fi

echo ""
echo "=== 重新部署 ==="
read -p "是否触发 Production 重新部署? (y/n): " REDEPLOY
if [ "$REDEPLOY" = "y" ]; then
    vercel --prod
    echo "✅ 已触发重新部署"
fi

echo ""
echo "完成!"
