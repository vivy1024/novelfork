#!/bin/bash
# Lorebook API 测试脚本

BASE_URL="http://localhost:4567"
BOOK_ID="test-book"

echo "=== Lorebook API 测试 ==="
echo ""

echo "1. 获取维度列表"
curl -s "${BASE_URL}/api/books/${BOOK_ID}/lorebook/dimensions" | jq '.' || echo "需要启动服务器"
echo ""

echo "2. 获取词条列表"
curl -s "${BASE_URL}/api/books/${BOOK_ID}/lorebook/entries" | jq '.' || echo "需要启动服务器"
echo ""

echo "3. 创建词条（示例）"
cat << 'JSON'
POST /api/books/test-book/lorebook/entries
{
  "dimension": "characters",
  "name": "张三",
  "keywords": "张三,主角",
  "content": "男主角，修仙者",
  "priority": 100,
  "enabled": true
}
JSON
echo ""

echo "4. 更新词条（示例）"
cat << 'JSON'
PUT /api/books/test-book/lorebook/entries/1
{
  "content": "男主角，修仙者，筑基期"
}
JSON
echo ""

echo "5. 删除词条（示例）"
echo "DELETE /api/books/test-book/lorebook/entries/1"
echo ""

echo "=== API 端点总结 ==="
echo "GET    /api/books/:id/lorebook/dimensions       - 获取维度列表"
echo "POST   /api/books/:id/lorebook/dimensions       - 创建自定义维度"
echo "DELETE /api/books/:id/lorebook/dimensions/:key  - 删除自定义维度"
echo "GET    /api/books/:id/lorebook/entries          - 获取词条列表"
echo "POST   /api/books/:id/lorebook/entries          - 创建词条"
echo "PUT    /api/books/:id/lorebook/entries/:eid     - 更新词条"
echo "DELETE /api/books/:id/lorebook/entries/:eid     - 删除词条"
echo "POST   /api/books/:id/lorebook/import           - 导入 Markdown"
echo "GET    /api/books/:id/lorebook/bloat            - 分析冗余词条"
