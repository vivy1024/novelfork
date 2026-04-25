import type { AiTasteLevel } from "./types";

const levelClass: Record<AiTasteLevel, string> = {
  clean: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  mild: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  moderate: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  severe: "bg-red-500/10 text-red-700 border-red-500/30",
};

export function AiTasteBadge({ score, level }: { score: number; level: AiTasteLevel }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${levelClass[level]}`}>AI 味 {score} · {level}</span>;
}
