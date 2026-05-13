#!/usr/bin/env python3
"""
NovelFork MCP Server — 让 AstrBot（羽书）通过 MCP 协议调用 NovelFork API。

启动方式：python novelfork_mcp_server.py
配置到 AstrBot 的 mcp_server.json 中即可。

提供的工具：
- novelfork_search_docs: 搜索学习中心文档
- novelfork_get_doc: 获取单篇文档全文
- novelfork_list_books: 列出所有作品
- novelfork_get_cockpit: 获取作品驾驶舱快照
- novelfork_send_message: 向叙述者发送消息
- novelfork_list_sessions: 列出所有会话
"""

import json
import sys
import asyncio
import httpx
from typing import Any

# ─── 配置 ───────────────────────────────────────────────────────────────────

NOVELFORK_URL = "http://localhost:4567"
API_TOKEN = ""  # 如果 NovelFork 配置了 apiToken，填在这里

# ─── HTTP 客户端 ─────────────────────────────────────────────────────────────

def get_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if API_TOKEN:
        headers["Authorization"] = f"Bearer {API_TOKEN}"
    return headers

def nf_get(path: str) -> dict:
    resp = httpx.get(f"{NOVELFORK_URL}{path}", headers=get_headers(), timeout=30)
    return resp.json()

def nf_post(path: str, body: dict) -> dict:
    resp = httpx.post(f"{NOVELFORK_URL}{path}", json=body, headers=get_headers(), timeout=60)
    return resp.json()

# ─── MCP 工具定义 ─────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "novelfork_search_docs",
        "description": "搜索 NovelFork 学习中心文档。用于回答关于 NovelFork 功能、使用方法的问题。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词，如'驾驶舱'、'AI写作'、'经纬'"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "novelfork_get_doc",
        "description": "获取 NovelFork 学习中心单篇文档的完整内容。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "doc_id": {"type": "string", "description": "文档 ID，如 '00-overview'、'01-book-management'、'08-agent-pipeline'"}
            },
            "required": ["doc_id"]
        }
    },
    {
        "name": "novelfork_list_books",
        "description": "列出 NovelFork 中所有作品。返回书名、章节数、字数等基本信息。",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "novelfork_get_cockpit",
        "description": "获取指定作品的驾驶舱快照：章节进度、字数、伏笔状态、健康度等。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "book_id": {"type": "string", "description": "作品 ID"}
            },
            "required": ["book_id"]
        }
    },
    {
        "name": "novelfork_send_message",
        "description": "向 NovelFork 叙述者发送消息并获取回复。用于触发写作、审校等操作。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "会话 ID"},
                "content": {"type": "string", "description": "要发送的消息内容"}
            },
            "required": ["session_id", "content"]
        }
    },
    {
        "name": "novelfork_list_sessions",
        "description": "列出 NovelFork 中所有叙述者会话。",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
]

# ─── 工具执行 ─────────────────────────────────────────────────────────────────

def execute_tool(name: str, arguments: dict) -> Any:
    if name == "novelfork_search_docs":
        return nf_get(f"/api/learn/search?q={arguments['query']}")

    elif name == "novelfork_get_doc":
        return nf_get(f"/api/learn/doc/{arguments['doc_id']}")

    elif name == "novelfork_list_books":
        return nf_get("/api/books")

    elif name == "novelfork_get_cockpit":
        return nf_get(f"/api/books/{arguments['book_id']}/cockpit")

    elif name == "novelfork_send_message":
        # 通过 HTTP API 发送消息（非 WebSocket，简化版）
        return nf_post(f"/api/sessions/{arguments['session_id']}/messages", {
            "content": arguments["content"]
        })

    elif name == "novelfork_list_sessions":
        return nf_get("/api/sessions")

    else:
        return {"error": f"Unknown tool: {name}"}

# ─── MCP 协议处理（stdio JSON-RPC） ──────────────────────────────────────────

def handle_request(request: dict) -> dict:
    method = request.get("method", "")
    req_id = request.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "novelfork-mcp", "version": "0.4.0"}
            }
        }

    elif method == "notifications/initialized":
        return None  # No response needed

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS}
        }

    elif method == "tools/call":
        params = request.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})

        try:
            result = execute_tool(tool_name, arguments)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]
                }
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": f"Error: {str(e)}"}],
                    "isError": True
                }
            }

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"}
        }

# ─── 主循环 ───────────────────────────────────────────────────────────────────

def main():
    """stdio JSON-RPC 主循环"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        response = handle_request(request)
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
