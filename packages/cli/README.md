# @vivy1024/novelfork-cli

NovelFork CLI 工具 — 命令行入口。

---

## 目录结构

```
src/
├── index.ts          # CLI 入口
├── commands/         # 子命令
│   ├── config.ts     # novelfork config
│   ├── dev.ts        # novelfork dev
│   └── compile.ts    # novelfork compile
└── utils/            # CLI 工具函数
```

---

## 使用

```bash
# 启动开发服务器
novelfork dev

# 配置
novelfork config set-global

# 编译
novelfork compile
```

---

## 构建

```bash
bun run build    # tsc → dist/
```
