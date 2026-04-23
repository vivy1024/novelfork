# Benchmark Engineer 考核任务

## 背景
我们需要构建一套用于评估 AI 编程能力的测试集。你的任务是创建一个完整的 Benchmark Task。

## 题目要求
请创建一个名为 `csv-cleaner-cli` 的任务。
**场景**：AI 需要编写一个 Python 命令行工具，用于清洗脏乱的 CSV 数据。

## 你的交付物
请提交一个压缩包，包含以下目录结构（严格遵守）：
csv-cleaner-cli/
├── task.toml                 # [必填] 按照 V1.0 规范填写元数据
├── instruction.md            # [必填] 清晰的英文题目描述
├── environment/              # [必填]
│   ├── Dockerfile            # 必须锁定 Python 版本
│   └── dirty_data.csv        # 初始的脏数据（请自己构造）
├── solution/                 # [必填]
│   ├── cleaner.py            # 标准答案代码
│   └── solve.sh              # 运行答案的脚本
└── tests/                    # [核心]
    ├── test_logic.py         # 验证逻辑
    └── test.sh               # 测试入口 (必须返回 exit code 0 或 1)

## 评分标准
1. **可运行性**：我们会在纯净的 Linux 环境下执行 `docker build` 和 `tests/test.sh`，必须一次跑通。
2. **鲁棒性**：你的测试脚本必须能拦截“错误答案”（例如：如果 AI 只是复制了文件没做清洗，测试必须报错）。
3. **规范性**：`task.toml` 填写是否完整，Dockerfile 是否锁定了版本。
4. **数据构造能力**：`dirty_data.csv` 是否包含足够的边界情况（如空行、非法字符）。

## 提交方式
请将文件夹打包为 `yourname_assessment.zip` 发送回邮件。