import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Shuffle, PenLine, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { postApi } from "../../hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideQuestion {
  id: string;
  prompt: string;
  /** 预设选项（用户可从中选择） */
  presets?: string[];
  /** 是否支持文本输入 */
  allowCustom: boolean;
  /** 占位提示 */
  placeholder?: string;
  /** 映射到经纬的字段 */
  fieldPath: string;
}

type AnswerMode = "preset" | "custom" | "random";

interface GuideAnswer {
  mode: AnswerMode;
  value: string;
}

export interface NewBookGuideProps {
  bookId: string;
  bookTitle: string;
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// 问题定义 — 覆盖建书所需的核心设定
// ---------------------------------------------------------------------------

const GUIDE_QUESTIONS: GuideQuestion[] = [
  {
    id: "genre",
    prompt: "你想写什么类型的故事？",
    presets: ["玄幻", "仙侠", "都市", "科幻", "历史", "言情", "悬疑", "游戏", "无限流", "西幻"],
    allowCustom: true,
    placeholder: "输入你想写的类型，如：末日废土、赛博朋克、盗墓灵异…",
    fieldPath: "genre",
  },
  {
    id: "premise",
    prompt: "故事的核心前提是什么？（一句话概括）",
    presets: ["废柴逆袭成神", "穿越异世重生", "都市隐藏高手", "星际文明崛起", "修仙问道长生", "系统流升级打怪"],
    allowCustom: true,
    placeholder: "用一句话描述你的故事核心，如：一个快递员意外获得了时间倒流的能力…",
    fieldPath: "premise",
  },
  {
    id: "protagonist",
    prompt: "主角是什么样的人？",
    presets: ["隐忍型天才", "热血莽夫", "腹黑谋士", "佛系咸鱼", "冷面杀手", "苟住发育型"],
    allowCustom: true,
    placeholder: "描述主角的核心特质，如：表面平庸实则心思缜密的大学生…",
    fieldPath: "protagonist",
  },
  {
    id: "goldenFinger",
    prompt: "主角的金手指（独有优势）是什么？",
    presets: ["系统面板", "前世记忆", "特殊血脉", "神秘空间", "时间回溯", "无金手指（凡人流）"],
    allowCustom: true,
    placeholder: "描述主角独有的成长加速机制，如：能看到他人头顶好感度…",
    fieldPath: "goldenFinger",
  },
  {
    id: "world",
    prompt: "故事发生在什么样的世界？",
    presets: ["九州大陆修真界", "现代都市暗面", "星际联邦时代", "架空古代王朝", "末日废墟", "蒸汽朋克异世"],
    allowCustom: true,
    placeholder: "描述世界观设定，如：灵气复苏后的现代地球…",
    fieldPath: "worldModel",
  },
  {
    id: "powerSystem",
    prompt: "力量体系是怎样的？",
    presets: ["练气→筑基→金丹→元婴", "武者九重→宗师→大宗师", "序列途径（诡秘类）", "异能觉醒等级", "斗气大陆式", "无超凡（纯现实）"],
    allowCustom: true,
    placeholder: "描述你的力量等级划分，如：灵根→练气→筑基→结丹→元婴→化神…",
    fieldPath: "powerSystem",
  },
  {
    id: "tone",
    prompt: "整体基调和文风是什么？",
    presets: ["热血爽文", "轻松日常", "沉重黑暗", "悬疑烧脑", "温馨治愈", "黑色幽默", "冷峻质朴", "沙雕轻快"],
    allowCustom: true,
    placeholder: "描述你想要的阅读感受和文风…",
    fieldPath: "tone",
  },
  {
    id: "writingPhilosophy",
    prompt: "你的创作方式更偏向哪种？",
    presets: ["建筑师派（先大纲后写作）", "花园派（边写边发现）", "混合（粗纲+自由发挥）"],
    allowCustom: true,
    placeholder: "描述你的创作习惯…",
    fieldPath: "writingPhilosophy",
  },
  {
    id: "platform",
    prompt: "打算在哪个平台发布？",
    presets: ["起点中文网", "番茄小说", "飞卢小说", "晋江文学城", "七猫小说", "暂不确定"],
    allowCustom: true,
    placeholder: "输入平台名称…",
    fieldPath: "platform",
  },
  {
    id: "chapterLength",
    prompt: "每章大约多少字？",
    presets: ["2000字（短章）", "3000字（标准）", "4000字（长章）", "5000字+（超长章）"],
    allowCustom: true,
    placeholder: "输入你期望的每章字数…",
    fieldPath: "chapterWordCount",
  },
  {
    id: "aiTaste",
    prompt: "对 AI 味的容忍度？",
    presets: ["零容忍（必须过朱雀检测）", "低容忍（明显 AI 味需修改）", "中等（能读通就行）", "不在意"],
    allowCustom: true,
    placeholder: "描述你对 AI 生成痕迹的要求…",
    fieldPath: "aiTasteLevel",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewBookGuide({ bookId, bookTitle, onComplete }: NewBookGuideProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, GuideAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = GUIDE_QUESTIONS[step];
  const total = GUIDE_QUESTIONS.length;
  const currentAnswer = answers[question.id];
  const isLast = step === total - 1;

  const setAnswer = (mode: AnswerMode, value: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: { mode, value } }));
  };

  const handlePresetSelect = (preset: string) => {
    const current = currentAnswer;
    // 如果已选中同一个，取消选择
    if (current?.mode === "preset" && current.value === preset) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[question.id];
        return next;
      });
    } else {
      setAnswer("preset", preset);
    }
  };

  const handleCustomInput = (value: string) => {
    setAnswer("custom", value);
  };

  const handleRandom = () => {
    setAnswer("random", "");
  };

  const handleNext = () => {
    // 如果没有回答，默认为随机
    if (!currentAnswer) {
      setAnswer("random", "");
    }
    if (!isLast) {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleSubmit = async () => {
    // 确保最后一题有答案
    const finalAnswers = { ...answers };
    if (!finalAnswers[question.id]) {
      finalAnswers[question.id] = { mode: "random", value: "" };
    }

    setSubmitting(true);
    setError(null);
    try {
      // 构建提交数据
      const payload: Record<string, { mode: AnswerMode; value: string }> = {};
      for (const q of GUIDE_QUESTIONS) {
        payload[q.fieldPath] = finalAnswers[q.id] ?? { mode: "random", value: "" };
      }

      await postApi(`/books/${bookId}/guided-setup`, { answers: payload });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // 判断当前模式
  const activeMode: AnswerMode | null = currentAnswer?.mode ?? null;

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* 标题 */}
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold">
            {bookTitle === "未命名作品" ? "开始你的创作之旅" : `设定《${bookTitle}》`}
          </h2>
          <p className="text-sm text-muted-foreground">
            回答几个问题帮助 AI 理解你的创作意图。每个问题都可以跳过，AI 会随机发挥。
          </p>
        </div>

        {/* 进度条 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>第 {step + 1} / {total} 题</span>
            <span>{Object.keys(answers).length} 题已回答</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((step + 1) / total) * 100}%` }}
            />
          </div>
        </div>

        {/* 问题 */}
        <div className="space-y-4">
          <p className="text-sm font-medium">{question.prompt}</p>

          {/* 预设选项 */}
          {question.presets && (
            <div className="flex flex-wrap gap-2">
              {question.presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-sm transition border ${
                    activeMode === "preset" && currentAnswer?.value === preset
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted"
                  }`}
                  onClick={() => handlePresetSelect(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          {/* 自定义输入 */}
          {question.allowCustom && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PenLine className="size-3" />
                <span>或者自己描述：</span>
              </div>
              {question.id === "premise" || question.id === "protagonist" || question.id === "world" ? (
                <Textarea
                  value={activeMode === "custom" ? (currentAnswer?.value ?? "") : ""}
                  onChange={(e) => handleCustomInput(e.target.value)}
                  placeholder={question.placeholder}
                  className="min-h-20 text-sm"
                  onFocus={() => {
                    if (activeMode !== "custom") setAnswer("custom", "");
                  }}
                />
              ) : (
                <Input
                  value={activeMode === "custom" ? (currentAnswer?.value ?? "") : ""}
                  onChange={(e) => handleCustomInput(e.target.value)}
                  placeholder={question.placeholder}
                  className="text-sm"
                  onFocus={() => {
                    if (activeMode !== "custom") setAnswer("custom", "");
                  }}
                />
              )}
            </div>
          )}

          {/* 随机/跳过按钮 */}
          <button
            type="button"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition border w-full ${
              activeMode === "random"
                ? "border-amber-500/50 bg-amber-500/10 text-amber-700"
                : "border-border text-muted-foreground hover:border-amber-500/30 hover:bg-amber-500/5"
            }`}
            onClick={handleRandom}
          >
            <Shuffle className="size-4" />
            <span>跳过，让 AI 随机发挥</span>
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* 导航按钮 */}
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={step === 0 || submitting}
          >
            <ChevronLeft className="size-4 mr-1" />
            上一题
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
            >
              <Sparkles className="size-4 mr-1" />
              {submitting ? "生成中…" : "全部跳过，直接开始"}
            </Button>

            {isLast ? (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={submitting}
              >
                <Check className="size-4 mr-1" />
                {submitting ? "生成中…" : "完成设定"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleNext}
                disabled={submitting}
              >
                下一题
                <ChevronRight className="size-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
