#!/bin/bash
# NovelFork Studio 启动脚本

echo "🚀 启动 NovelFork Studio..."
echo ""

# 检查依赖
if ! command -v pnpm &> /dev/null; then
    echo "❌ 错误：未找到 pnpm，请先安装 pnpm"
    exit 1
fi

# 检查是否已构建
if [ ! -d "packages/studio/dist" ]; then
    echo "📦 首次运行，正在构建..."
    pnpm run build
fi

# 启动后端服务器（端口 4569）
echo "🔧 启动后端服务器（端口 4569）..."
cd packages/studio
NOVELFORK_STUDIO_PORT=4569 node dist/api/server.js &
BACKEND_PID=$!
cd ../..

# 等待后端启动
sleep 2

# 启动前端开发服务器（端口 4567）
echo "🎨 启动前端开发服务器（端口 4567）..."
cd packages/studio
pnpm run dev &
FRONTEND_PID=$!
cd ../..

echo ""
echo "✅ NovelFork Studio 已启动！"
echo ""
echo "📍 访问地址："
echo "   前端：http://localhost:4567"
echo "   后端：http://localhost:4569"
echo ""
echo "🛑 按 Ctrl+C 停止服务器"
echo ""

# 等待用户中断
trap "echo ''; echo '🛑 正在停止服务器...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

wait
