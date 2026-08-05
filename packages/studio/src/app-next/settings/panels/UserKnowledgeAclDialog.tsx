import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getUserKnowledgeAcl,
  listKnowledgeLevels,
  listKnowledgeTags,
  setUserKnowledgeAcl,
  type KnowledgeLevel,
  type KnowledgeTag,
  type SetUserKnowledgeAclInput,
  type UserKnowledgeAcl,
} from "../../runtime-admin/knowledge";

const NO_CLEARANCE = "__none__";

export interface UserKnowledgeAclDialogProps {
  readonly userId: string | null;
  readonly username: string;
  readonly onClose: () => void;
  /** Test seam so the dialog can be exercised without the module-level client. */
  readonly api?: {
    readonly getAcl: typeof getUserKnowledgeAcl;
    readonly setAcl: typeof setUserKnowledgeAcl;
    readonly listLevels: typeof listKnowledgeLevels;
    readonly listTags: typeof listKnowledgeTags;
  };
}

const defaultApi = {
  getAcl: getUserKnowledgeAcl,
  setAcl: setUserKnowledgeAcl,
  listLevels: listKnowledgeLevels,
  listTags: listKnowledgeTags,
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Grants one user their knowledge-base credentials: a clearance level, the
 * compartment tags they may read, the subset they may review, and whether they
 * may write. Without this dialog an administrator has no way to authorize
 * knowledge access from the product UI at all.
 */
export function UserKnowledgeAclDialog({
  userId,
  username,
  onClose,
  api = defaultApi,
}: UserKnowledgeAclDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<readonly KnowledgeLevel[]>([]);
  const [tags, setTags] = useState<readonly KnowledgeTag[]>([]);
  const [draft, setDraft] = useState<UserKnowledgeAcl | null>(null);
  const [saved, setSaved] = useState<UserKnowledgeAcl | null>(null);

  const load = useCallback(async (targetUserId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [acl, levelList, tagList] = await Promise.all([
        api.getAcl(targetUserId),
        api.listLevels(),
        api.listTags(),
      ]);
      setDraft(acl);
      setSaved(acl);
      setLevels(levelList);
      setTags(tagList);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!userId) {
      setDraft(null);
      setSaved(null);
      setError(null);
      return;
    }
    void load(userId);
  }, [userId, load]);

  async function save() {
    if (!userId || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const input: SetUserKnowledgeAclInput = {
        clearanceLevel: draft.clearanceLevel,
        tagIds: draft.tagIds,
        reviewTagIds: draft.reviewTagIds,
        canWrite: draft.canWrite,
      };
      const updated = await api.setAcl(userId, input);
      setDraft(updated);
      setSaved(updated);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tagId: string, granted: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const tagIds = granted
        ? [...new Set([...current.tagIds, tagId])]
        : current.tagIds.filter((id) => id !== tagId);
      // Review implies read: revoking read must also revoke review.
      const reviewTagIds = granted
        ? current.reviewTagIds
        : current.reviewTagIds.filter((id) => id !== tagId);
      return { ...current, tagIds, reviewTagIds };
    });
  }

  function toggleReviewTag(tagId: string, granted: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const reviewTagIds = granted
        ? [...new Set([...current.reviewTagIds, tagId])]
        : current.reviewTagIds.filter((id) => id !== tagId);
      const tagIds = granted ? [...new Set([...current.tagIds, tagId])] : current.tagIds;
      return { ...current, tagIds, reviewTagIds };
    });
  }

  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));

  return (
    <Dialog open={userId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            知识库权限 · {username}
          </DialogTitle>
          <DialogDescription>
            分级决定可读到的密级上限；分区标签是额外的隔离条件，两者都满足才能读取条目。
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert>
            <AlertTitle>知识库权限操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="flex flex-col gap-3" aria-label="正在读取知识库权限">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : draft ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="user-acl-clearance">分级</FieldLabel>
              <SimpleSelect
                aria-label="分级"
                value={draft.clearanceLevel ?? NO_CLEARANCE}
                onValueChange={(value) => setDraft({
                  ...draft,
                  clearanceLevel: value === NO_CLEARANCE ? null : value,
                })}
                options={[
                  { value: NO_CLEARANCE, label: "未授予（只能读取公开条目）" },
                  ...levels.map((level) => ({
                    value: level.name,
                    label: `${level.label || level.name} · rank ${level.rank}`,
                  })),
                ]}
              />
              <FieldDescription>
                取该用户全部分级授权中最高的一档；未授予时只能读取无密级要求的条目。
              </FieldDescription>
            </Field>

            <Field orientation="horizontal">
              <div className="min-w-0">
                <FieldLabel htmlFor="user-acl-write">允许写入</FieldLabel>
                <FieldDescription>可新建与修改条目，而不只是读取。</FieldDescription>
              </div>
              <Switch
                aria-label="允许写入"
                checked={draft.canWrite}
                onCheckedChange={(canWrite) => setDraft({ ...draft, canWrite })}
              />
            </Field>

            <Field>
              <FieldLabel>分区标签</FieldLabel>
              {tags.length === 0 ? (
                <FieldDescription>
                  尚未定义任何分区标签，此时只有分级生效。
                </FieldDescription>
              ) : (
                <div className="flex flex-col gap-2">
                  {tags.map((tag) => {
                    const granted = draft.tagIds.includes(tag.id);
                    const review = draft.reviewTagIds.includes(tag.id);
                    return (
                      <div key={tag.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                        <span className="min-w-0 flex-1 text-sm">
                          {tag.name}
                          {tag.controlled ? (
                            <Badge variant="outline" className="ml-2">受控</Badge>
                          ) : null}
                        </span>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          可读
                          <Switch
                            aria-label={`可读 ${tag.name}`}
                            checked={granted}
                            onCheckedChange={(value) => toggleTag(tag.id, value)}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          可审阅
                          <Switch
                            aria-label={`可审阅 ${tag.name}`}
                            checked={review}
                            onCheckedChange={(value) => toggleReviewTag(tag.id, value)}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field>
              <FieldLabel>当前生效范围</FieldLabel>
              <FieldDescription>
                分级 {draft.clearanceLevel ?? "未授予"} ·
                {" "}可读标签 {draft.tagIds.length} 个 ·
                {" "}可审阅 {draft.reviewTagIds.length} 个 ·
                {" "}{draft.canWrite ? "可写入" : "只读"}
              </FieldDescription>
            </Field>
          </FieldGroup>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!draft || !dirty || saving} onClick={() => void save()}>
            {saving ? "正在保存…" : "保存权限"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
