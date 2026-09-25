import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_FORESHADOW_DEBT_THRESHOLDS,
  FORESHADOW_THRESHOLD_MAX_CHAPTERS,
  checkForeshadowDebtThresholds,
  type ForeshadowDebtThresholds,
} from "../../../engine/narrative-taxonomy/foreshadow-debts";

interface ForeshadowThresholdFieldProps {
  /** book.json 里的原始值；未设置时为 undefined。 */
  readonly initial: unknown;
  /** 保存；null 表示恢复默认。返回是否保存成功。 */
  readonly onSave: (value: ForeshadowDebtThresholds | null) => Promise<boolean>;
}

const SAVE_DELAY_MS = 800;

/**
 * 书籍设置里的伏笔阈值。节奏快的书可以调小、慢热长篇可以调大；
 * 校验规则与保存接口共用 checkForeshadowDebtThresholds，不合法时不保存并就地说明原因。
 */
export function ForeshadowThresholdField({ initial, onSave }: ForeshadowThresholdFieldProps) {
  const initialCheck = checkForeshadowDebtThresholds(initial);
  const start = initialCheck.ok ? initialCheck.value : DEFAULT_FORESHADOW_DEBT_THRESHOLDS;
  const [watch, setWatch] = useState(String(start.watchChapters));
  const [overdue, setOverdue] = useState(String(start.overdueChapters));
  const [usingDefault, setUsingDefault] = useState(!initialCheck.ok);
  const [saveFailed, setSaveFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const check = checkForeshadowDebtThresholds({
    watchChapters: watch.trim() === "" ? Number.NaN : Number(watch),
    overdueChapters: overdue.trim() === "" ? Number.NaN : Number(overdue),
  });

  const schedule = (nextWatch: string, nextOverdue: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const next = checkForeshadowDebtThresholds({
      watchChapters: nextWatch.trim() === "" ? Number.NaN : Number(nextWatch),
      overdueChapters: nextOverdue.trim() === "" ? Number.NaN : Number(nextOverdue),
    });
    if (!next.ok) return;
    timerRef.current = setTimeout(() => {
      void onSave(next.value).then((saved) => {
        setSaveFailed(!saved);
        if (saved) setUsingDefault(false);
      });
    }, SAVE_DELAY_MS);
  };

  const restoreDefault = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setWatch(String(DEFAULT_FORESHADOW_DEBT_THRESHOLDS.watchChapters));
    setOverdue(String(DEFAULT_FORESHADOW_DEBT_THRESHOLDS.overdueChapters));
    void onSave(null).then((saved) => {
      setSaveFailed(!saved);
      if (saved) setUsingDefault(true);
    });
  };

  return (
    <div className="space-y-2" data-testid="foreshadow-threshold-field">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>伏笔提醒阈值</span>
        {usingDefault ? <span className="text-2xs">当前为默认值</span> : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1 text-xs text-muted-foreground">
          临近提醒（章）
          <Input
            type="number"
            min={1}
            max={FORESHADOW_THRESHOLD_MAX_CHAPTERS}
            className="w-28"
            value={watch}
            aria-label="伏笔临近提醒章数"
            data-testid="foreshadow-threshold-watch"
            onChange={(event) => {
              setWatch(event.target.value);
              schedule(event.target.value, overdue);
            }}
          />
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          判为超期（章）
          <Input
            type="number"
            min={2}
            max={FORESHADOW_THRESHOLD_MAX_CHAPTERS}
            className="w-28"
            value={overdue}
            aria-label="伏笔超期章数"
            data-testid="foreshadow-threshold-overdue"
            onChange={(event) => {
              setOverdue(event.target.value);
              schedule(watch, event.target.value);
            }}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={usingDefault}
          onClick={restoreDefault}
          data-testid="foreshadow-threshold-reset"
        >
          恢复默认（{DEFAULT_FORESHADOW_DEBT_THRESHOLDS.watchChapters} / {DEFAULT_FORESHADOW_DEBT_THRESHOLDS.overdueChapters}）
        </Button>
      </div>
      {saveFailed ? (
        <p className="text-2xs text-destructive" data-testid="foreshadow-threshold-save-failed">
          保存没有成功，阈值仍按上一次保存的值判定。请检查网络或稍后再改一次。
        </p>
      ) : null}
      {check.ok ? (
        <p className="text-2xs text-muted-foreground">
          伏笔埋下后悬置满 {check.value.watchChapters} 章开始提醒，满 {check.value.overdueChapters} 章判为超期。
          快节奏的书可以调小，慢热长篇可以调大；伏笔看板、推进看板、驾驶舱与写前简报都按这里判定。
        </p>
      ) : (
        <p className="text-2xs text-destructive" data-testid="foreshadow-threshold-error">
          {check.explanation}（未保存）
        </p>
      )}
    </div>
  );
}
