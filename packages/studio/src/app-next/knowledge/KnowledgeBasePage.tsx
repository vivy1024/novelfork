import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  addKnowledgeRevision,
  createKnowledgeCollection,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeCollections,
  listKnowledgeEntries,
  updateKnowledgeEntry,
  type KnowledgeCollection,
  type KnowledgeEntry,
  type KnowledgeEntryStatus,
  type KnowledgeEntrySummary,
} from "../runtime-admin/knowledge";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function splitTerms(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((term) => term.trim()).filter(Boolean))];
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function collectionName(collections: readonly KnowledgeCollection[], collectionId: string): string {
  return collections.find((collection) => collection.id === collectionId)?.name ?? "未知集合";
}

export function KnowledgeBasePage() {
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntrySummary[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [collectionNameInput, setCollectionNameInput] = useState("");
  const [collectionSlug, setCollectionSlug] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");

  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryCollectionId, setEntryCollectionId] = useState("");
  const [entryTitle, setEntryTitle] = useState("");
  const [entrySlug, setEntrySlug] = useState("");
  const [entryContent, setEntryContent] = useState("");
  const [entryTags, setEntryTags] = useState("");
  const [entryKeywords, setEntryKeywords] = useState("");
  const [entryChangeNote, setEntryChangeNote] = useState("");

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [editMetadata, setEditMetadata] = useState("");
  const [editStatus, setEditStatus] = useState<KnowledgeEntryStatus>("active");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [revisionContent, setRevisionContent] = useState("");
  const [revisionNote, setRevisionNote] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const refreshData = useCallback(async () => {
    setListLoading(true);
    setLoadError(null);
    try {
      const [nextCollections, nextEntries] = await Promise.all([
        listKnowledgeCollections(),
        listKnowledgeEntries({
          collectionId: selectedCollectionId || undefined,
          query: appliedQuery || undefined,
        }),
      ]);
      setCollections(nextCollections);
      setEntries(nextEntries);
    } catch (error) {
      setLoadError(errorMessage(error, "知识库加载失败"));
    } finally {
      setListLoading(false);
    }
  }, [appliedQuery, selectedCollectionId]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!selectedEntryId) {
      setSelectedEntry(null);
      setDetailError(null);
      return;
    }

    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    getKnowledgeEntry(selectedEntryId)
      .then((entry) => {
        if (active) setSelectedEntry(entry);
      })
      .catch((error) => {
        if (active) {
          setSelectedEntry(null);
          setDetailError(errorMessage(error, "条目内容加载失败"));
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedEntryId]);

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = searchInput.trim();
    if (nextQuery === appliedQuery) void refreshData();
    else setAppliedQuery(nextQuery);
  }

  function openCollectionDialog() {
    setActionError(null);
    setCollectionNameInput("");
    setCollectionSlug("");
    setCollectionDescription("");
    setCollectionDialogOpen(true);
  }

  function openEntryDialog() {
    setActionError(null);
    setEntryCollectionId(selectedCollectionId || collections[0]?.id || "");
    setEntryTitle("");
    setEntrySlug("");
    setEntryContent("");
    setEntryTags("");
    setEntryKeywords("");
    setEntryChangeNote("");
    setEntryDialogOpen(true);
  }

  function openEditDialog() {
    if (!selectedEntry) return;
    setActionError(null);
    setMetadataError(null);
    setEditTitle(selectedEntry.title);
    setEditTags(selectedEntry.tags.join(", "));
    setEditKeywords(selectedEntry.keywords.join(", "));
    setEditMetadata(selectedEntry.metadata ? JSON.stringify(selectedEntry.metadata, null, 2) : "{}");
    setEditStatus(selectedEntry.status);
    setRevisionContent(selectedEntry.currentContent);
    setRevisionNote("");
    setEditDialogOpen(true);
  }

  async function submitCollection(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      const collection = await createKnowledgeCollection({
        name: collectionNameInput.trim(),
        ...(collectionSlug.trim() ? { slug: collectionSlug.trim() } : {}),
        ...(collectionDescription.trim() ? { description: collectionDescription.trim() } : {}),
      });
      setCollectionDialogOpen(false);
      setSelectedEntryId(null);
      setSearchInput("");
      setAppliedQuery("");
      setSelectedCollectionId(collection.id);
    } catch (error) {
      setActionError(errorMessage(error, "创建集合失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!entryCollectionId) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const entry = await createKnowledgeEntry({
        collectionId: entryCollectionId,
        title: entryTitle.trim(),
        ...(entrySlug.trim() ? { slug: entrySlug.trim() } : {}),
        content: entryContent,
        format: "markdown",
        tags: splitTerms(entryTags),
        keywords: splitTerms(entryKeywords),
        ...(entryChangeNote.trim() ? { changeNote: entryChangeNote.trim() } : {}),
      });
      setEntryDialogOpen(false);
      setSelectedCollectionId(entry.collectionId);
      setSelectedEntryId(entry.id);
      setSelectedEntry(entry);
      await refreshData();
    } catch (error) {
      setActionError(errorMessage(error, "创建条目失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMetadata(event: FormEvent) {
    event.preventDefault();
    if (!selectedEntry) return;

    let metadata: Record<string, unknown>;
    try {
      const parsed = JSON.parse(editMetadata || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("元数据必须是 JSON 对象");
      }
      metadata = parsed as Record<string, unknown>;
      setMetadataError(null);
    } catch (error) {
      setMetadataError(errorMessage(error, "元数据 JSON 无效"));
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      const entry = await updateKnowledgeEntry(selectedEntry.id, {
        title: editTitle.trim(),
        tags: splitTerms(editTags),
        keywords: splitTerms(editKeywords),
        metadata,
        status: editStatus,
      });
      setSelectedEntry(entry);
      await refreshData();
      setEditDialogOpen(false);
    } catch (error) {
      setActionError(errorMessage(error, "更新条目元数据失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRevision(event: FormEvent) {
    event.preventDefault();
    if (!selectedEntry) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await addKnowledgeRevision(selectedEntry.id, {
        content: revisionContent,
        format: "markdown",
        ...(revisionNote.trim() ? { changeNote: revisionNote.trim() } : {}),
      });
      const entry = await getKnowledgeEntry(selectedEntry.id);
      setSelectedEntry(entry);
      await refreshData();
      setEditDialogOpen(false);
    } catch (error) {
      setActionError(errorMessage(error, "新增修订失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!selectedEntry) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await deleteKnowledgeEntry(selectedEntry.id);
      setDeleteDialogOpen(false);
      setSelectedEntryId(null);
      setSelectedEntry(null);
      await refreshData();
    } catch (error) {
      setActionError(errorMessage(error, "删除条目失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">
            管理 Runtime 中经过权限过滤的知识集合、条目与版本内容。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openCollectionDialog}>新建集合</Button>
          <Button onClick={openEntryDialog} disabled={collections.length === 0}>新建条目</Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-4">
          {loadError ? (
            <Alert>
              <AlertTitle>知识库加载失败</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{loadError}</span>
                <Button size="sm" variant="outline" onClick={() => void refreshData()}>重试</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {actionError ? (
            <Alert>
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="entries">
            <TabsList variant="line">
              <TabsTrigger value="entries">知识条目</TabsTrigger>
              <TabsTrigger value="collections">集合</TabsTrigger>
            </TabsList>

            <TabsContent value="entries" className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>筛选知识</CardTitle>
                  <CardDescription>集合与搜索条件会直接传给 Runtime 的条目列表接口。</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2" aria-label="按集合筛选">
                    <Button
                      size="sm"
                      variant={selectedCollectionId ? "outline" : "default"}
                      onClick={() => {
                        setSelectedCollectionId("");
                        setSelectedEntryId(null);
                      }}
                    >
                      全部集合
                    </Button>
                    {collections.map((collection) => (
                      <Button
                        key={collection.id}
                        size="sm"
                        variant={selectedCollectionId === collection.id ? "default" : "outline"}
                        onClick={() => {
                          setSelectedCollectionId(collection.id);
                          setSelectedEntryId(null);
                        }}
                      >
                        {collection.name}
                      </Button>
                    ))}
                  </div>
                  <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submitSearch}>
                    <Input
                      aria-label="搜索知识条目"
                      placeholder="搜索标题或正文..."
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                    />
                    <Button type="submit" variant="outline">搜索</Button>
                    {appliedQuery ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setSearchInput("");
                          setAppliedQuery("");
                        }}
                      >
                        清除
                      </Button>
                    ) : null}
                  </form>
                </CardContent>
              </Card>

              <div className="grid min-h-[32rem] gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
                <EntryListCard
                  entries={entries}
                  collections={collections}
                  loading={listLoading}
                  selectedEntryId={selectedEntryId}
                  filterLabel={activeCollection?.name ?? "全部集合"}
                  onSelect={setSelectedEntryId}
                />
                <EntryDetailCard
                  entry={selectedEntry}
                  loading={detailLoading}
                  error={detailError}
                  collectionLabel={selectedEntry ? collectionName(collections, selectedEntry.collectionId) : ""}
                  onEdit={openEditDialog}
                  onDelete={() => {
                    setActionError(null);
                    setDeleteDialogOpen(true);
                  }}
                  onRetry={() => {
                    if (!selectedEntryId) return;
                    setDetailLoading(true);
                    setDetailError(null);
                    void getKnowledgeEntry(selectedEntryId)
                      .then(setSelectedEntry)
                      .catch((error) => setDetailError(errorMessage(error, "条目内容加载失败")))
                      .finally(() => setDetailLoading(false));
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="collections">
              <CollectionListCard collections={collections} loading={listLoading} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <CollectionDialog
        open={collectionDialogOpen}
        submitting={submitting}
        error={actionError}
        name={collectionNameInput}
        slug={collectionSlug}
        description={collectionDescription}
        onOpenChange={setCollectionDialogOpen}
        onNameChange={setCollectionNameInput}
        onSlugChange={setCollectionSlug}
        onDescriptionChange={setCollectionDescription}
        onSubmit={submitCollection}
      />

      <EntryDialog
        open={entryDialogOpen}
        collections={collections}
        collectionId={entryCollectionId}
        title={entryTitle}
        slug={entrySlug}
        content={entryContent}
        tags={entryTags}
        keywords={entryKeywords}
        changeNote={entryChangeNote}
        submitting={submitting}
        error={actionError}
        onOpenChange={setEntryDialogOpen}
        onCollectionChange={setEntryCollectionId}
        onTitleChange={setEntryTitle}
        onSlugChange={setEntrySlug}
        onContentChange={setEntryContent}
        onTagsChange={setEntryTags}
        onKeywordsChange={setEntryKeywords}
        onChangeNoteChange={setEntryChangeNote}
        onSubmit={submitEntry}
      />

      <EditEntryDialog
        open={editDialogOpen}
        entry={selectedEntry}
        title={editTitle}
        tags={editTags}
        keywords={editKeywords}
        metadata={editMetadata}
        status={editStatus}
        metadataError={metadataError}
        revisionContent={revisionContent}
        revisionNote={revisionNote}
        submitting={submitting}
        error={actionError}
        onOpenChange={setEditDialogOpen}
        onTitleChange={setEditTitle}
        onTagsChange={setEditTags}
        onKeywordsChange={setEditKeywords}
        onMetadataChange={setEditMetadata}
        onStatusChange={setEditStatus}
        onRevisionContentChange={setRevisionContent}
        onRevisionNoteChange={setRevisionNote}
        onSubmitMetadata={submitMetadata}
        onSubmitRevision={submitRevision}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除知识条目</DialogTitle>
            <DialogDescription>
              将永久删除“{selectedEntry?.title ?? "当前条目"}”及其修订记录。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          {actionError ? <InlineError title="删除失败" message={actionError} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button type="button" variant="destructive" disabled={submitting} onClick={() => void confirmDelete()}>
              {submitting ? "正在删除..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryListCard({
  entries,
  collections,
  loading,
  selectedEntryId,
  filterLabel,
  onSelect,
}: {
  readonly entries: readonly KnowledgeEntrySummary[];
  readonly collections: readonly KnowledgeCollection[];
  readonly loading: boolean;
  readonly selectedEntryId: string | null;
  readonly filterLabel: string;
  readonly onSelect: (entryId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>条目列表</CardTitle>
        <CardDescription>{filterLabel} · {entries.length} 个结果</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-3" aria-label="正在加载知识条目">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        ) : entries.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有匹配的知识条目</EmptyTitle>
              <EmptyDescription>调整集合或搜索条件，或创建一个新条目。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>集合</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} data-state={selectedEntryId === entry.id ? "selected" : undefined}>
                  <TableCell>
                    <Button variant="ghost" className="justify-start" onClick={() => onSelect(entry.id)}>
                      {entry.title}
                    </Button>
                  </TableCell>
                  <TableCell>{collectionName(collections, entry.collectionId)}</TableCell>
                  <TableCell>
                    <Badge variant={entry.status === "active" ? "secondary" : "outline"}>
                      {entry.status === "active" ? "启用" : "已归档"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(entry.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function EntryDetailCard({
  entry,
  loading,
  error,
  collectionLabel,
  onEdit,
  onDelete,
  onRetry,
}: {
  readonly entry: KnowledgeEntry | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly collectionLabel: string;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry?.title ?? "条目内容"}</CardTitle>
        <CardDescription>{entry ? `${collectionLabel} · ${entry.slug}` : "从列表选择条目查看完整内容"}</CardDescription>
        {entry ? (
          <CardAction className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>编辑</Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="min-h-80">
        {loading ? (
          <div className="flex flex-col gap-3" aria-label="正在加载条目内容">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <Alert>
            <AlertTitle>条目内容加载失败</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
            </AlertDescription>
          </Alert>
        ) : !entry ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyTitle>尚未选择条目</EmptyTitle>
              <EmptyDescription>条目正文仅在打开详情时从 Runtime 获取。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{entry.status === "active" ? "启用" : "已归档"}</Badge>
              {entry.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
              {entry.currentContent || "（空内容）"}
            </pre>
            {entry.keywords.length > 0 ? (
              <p className="text-xs text-muted-foreground">关键词：{entry.keywords.join("、")}</p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CollectionListCard({
  collections,
  loading,
}: {
  readonly collections: readonly KnowledgeCollection[];
  readonly loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>知识集合</CardTitle>
        <CardDescription>当前身份可读取的 Runtime Knowledge collections。</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : collections.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>暂无可访问集合</EmptyTitle>
              <EmptyDescription>创建首个集合后即可添加知识条目。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>说明</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((collection) => (
                <TableRow key={collection.id}>
                  <TableCell className="font-medium">{collection.name}</TableCell>
                  <TableCell><Badge variant="outline">{collection.slug}</Badge></TableCell>
                  <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                    {collection.description || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(collection.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function InlineError({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function CollectionDialog({
  open,
  submitting,
  error,
  name,
  slug,
  description,
  onOpenChange,
  onNameChange,
  onSlugChange,
  onDescriptionChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onNameChange: (value: string) => void;
  readonly onSlugChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>新建知识集合</DialogTitle>
            <DialogDescription>集合名称必填；Slug 留空时由 Runtime 自动生成。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="knowledge-collection-name">名称</FieldLabel>
              <Input id="knowledge-collection-name" required maxLength={200} value={name} onChange={(event) => onNameChange(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-collection-slug">Slug</FieldLabel>
              <Input id="knowledge-collection-slug" pattern="[a-z0-9-]+" maxLength={200} value={slug} onChange={(event) => onSlugChange(event.target.value)} />
              <FieldDescription>仅支持小写字母、数字和连字符。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-collection-description">说明</FieldLabel>
              <Textarea id="knowledge-collection-description" maxLength={2000} value={description} onChange={(event) => onDescriptionChange(event.target.value)} />
            </Field>
          </FieldGroup>
          {error ? <InlineError title="创建集合失败" message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !name.trim()}>{submitting ? "正在创建..." : "创建集合"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntryDialog({
  open,
  collections,
  collectionId,
  title,
  slug,
  content,
  tags,
  keywords,
  changeNote,
  submitting,
  error,
  onOpenChange,
  onCollectionChange,
  onTitleChange,
  onSlugChange,
  onContentChange,
  onTagsChange,
  onKeywordsChange,
  onChangeNoteChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly collections: readonly KnowledgeCollection[];
  readonly collectionId: string;
  readonly title: string;
  readonly slug: string;
  readonly content: string;
  readonly tags: string;
  readonly keywords: string;
  readonly changeNote: string;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCollectionChange: (value: string) => void;
  readonly onTitleChange: (value: string) => void;
  readonly onSlugChange: (value: string) => void;
  readonly onContentChange: (value: string) => void;
  readonly onTagsChange: (value: string) => void;
  readonly onKeywordsChange: (value: string) => void;
  readonly onChangeNoteChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>新建知识条目</DialogTitle>
            <DialogDescription>正文以 Markdown 创建，并成为条目的第一个 revision。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>所属集合</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {collections.map((collection) => (
                  <Button
                    key={collection.id}
                    type="button"
                    size="sm"
                    variant={collectionId === collection.id ? "default" : "outline"}
                    onClick={() => onCollectionChange(collection.id)}
                  >
                    {collection.name}
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-entry-title">标题</FieldLabel>
              <Input id="knowledge-entry-title" required maxLength={500} value={title} onChange={(event) => onTitleChange(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-entry-slug">Slug</FieldLabel>
              <Input id="knowledge-entry-slug" pattern="[a-z0-9-]+" maxLength={200} value={slug} onChange={(event) => onSlugChange(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-entry-content">正文</FieldLabel>
              <Textarea id="knowledge-entry-content" className="min-h-48 font-mono" value={content} onChange={(event) => onContentChange(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-entry-tags">标签</FieldLabel>
              <Input id="knowledge-entry-tags" value={tags} onChange={(event) => onTagsChange(event.target.value)} placeholder="世界观, 角色" />
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-entry-keywords">注入关键词</FieldLabel>
              <Input id="knowledge-entry-keywords" value={keywords} onChange={(event) => onKeywordsChange(event.target.value)} placeholder="逗号分隔" />
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-entry-note">变更说明</FieldLabel>
              <Input id="knowledge-entry-note" maxLength={1000} value={changeNote} onChange={(event) => onChangeNoteChange(event.target.value)} />
            </Field>
          </FieldGroup>
          {error ? <InlineError title="创建条目失败" message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !collectionId || !title.trim()}>{submitting ? "正在创建..." : "创建条目"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditEntryDialog({
  open,
  entry,
  title,
  tags,
  keywords,
  metadata,
  status,
  metadataError,
  revisionContent,
  revisionNote,
  submitting,
  error,
  onOpenChange,
  onTitleChange,
  onTagsChange,
  onKeywordsChange,
  onMetadataChange,
  onStatusChange,
  onRevisionContentChange,
  onRevisionNoteChange,
  onSubmitMetadata,
  onSubmitRevision,
}: {
  readonly open: boolean;
  readonly entry: KnowledgeEntry | null;
  readonly title: string;
  readonly tags: string;
  readonly keywords: string;
  readonly metadata: string;
  readonly status: KnowledgeEntryStatus;
  readonly metadataError: string | null;
  readonly revisionContent: string;
  readonly revisionNote: string;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onTitleChange: (value: string) => void;
  readonly onTagsChange: (value: string) => void;
  readonly onKeywordsChange: (value: string) => void;
  readonly onMetadataChange: (value: string) => void;
  readonly onStatusChange: (value: KnowledgeEntryStatus) => void;
  readonly onRevisionContentChange: (value: string) => void;
  readonly onRevisionNoteChange: (value: string) => void;
  readonly onSubmitMetadata: (event: FormEvent) => void;
  readonly onSubmitRevision: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑“{entry?.title ?? "知识条目"}”</DialogTitle>
          <DialogDescription>元数据通过 PATCH 更新；正文变更会追加新的 revision。</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="metadata">
          <TabsList>
            <TabsTrigger value="metadata">元数据</TabsTrigger>
            <TabsTrigger value="revision">新增修订</TabsTrigger>
          </TabsList>
          <TabsContent value="metadata">
            <form className="flex flex-col gap-4" onSubmit={onSubmitMetadata}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="knowledge-edit-title">标题</FieldLabel>
                  <Input id="knowledge-edit-title" required maxLength={500} value={title} onChange={(event) => onTitleChange(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>状态</FieldLabel>
                  <Tabs value={status} onValueChange={(value) => onStatusChange(value as KnowledgeEntryStatus)}>
                    <TabsList>
                      <TabsTrigger value="active">启用</TabsTrigger>
                      <TabsTrigger value="archived">归档</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </Field>
                <Field>
                  <FieldLabel htmlFor="knowledge-edit-tags">标签</FieldLabel>
                  <Input id="knowledge-edit-tags" value={tags} onChange={(event) => onTagsChange(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="knowledge-edit-keywords">注入关键词</FieldLabel>
                  <Input id="knowledge-edit-keywords" value={keywords} onChange={(event) => onKeywordsChange(event.target.value)} />
                </Field>
                <Field data-invalid={Boolean(metadataError)}>
                  <FieldLabel htmlFor="knowledge-edit-metadata">元数据 JSON</FieldLabel>
                  <Textarea
                    id="knowledge-edit-metadata"
                    className="min-h-36 font-mono"
                    aria-invalid={Boolean(metadataError)}
                    value={metadata}
                    onChange={(event) => onMetadataChange(event.target.value)}
                  />
                  <FieldError>{metadataError}</FieldError>
                </Field>
              </FieldGroup>
              {error ? <InlineError title="更新失败" message={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button type="submit" disabled={submitting || !title.trim()}>{submitting ? "正在保存..." : "保存元数据"}</Button>
              </DialogFooter>
            </form>
          </TabsContent>
          <TabsContent value="revision">
            <form className="flex flex-col gap-4" onSubmit={onSubmitRevision}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="knowledge-revision-content">Markdown 正文</FieldLabel>
                  <Textarea
                    id="knowledge-revision-content"
                    className="min-h-72 font-mono"
                    value={revisionContent}
                    onChange={(event) => onRevisionContentChange(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="knowledge-revision-note">修订说明</FieldLabel>
                  <Input id="knowledge-revision-note" maxLength={1000} value={revisionNote} onChange={(event) => onRevisionNoteChange(event.target.value)} />
                </Field>
              </FieldGroup>
              {error ? <InlineError title="新增修订失败" message={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "正在保存..." : "保存为新修订"}</Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default KnowledgeBasePage;
