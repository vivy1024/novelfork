import { UnsupportedCapability } from "../../components/runtime/UnsupportedCapability";
import type { StudioResourceNode } from "./resource-adapter";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";

export type WorkspaceNodeViewKind =
  | "chapter-editor"
  | "candidate-editor"
  | "draft-editor"
  | "outline-editor"
  | "bible-category-view"
  | "bible-entry-editor"
  | "markdown-viewer"
  | "material-viewer"
  | "publish-report-viewer"
  | "unsupported";

export function resolveWorkspaceNodeViewKind(node: StudioResourceNode): WorkspaceNodeViewKind {
  switch (node.kind) {
    case "chapter":
      return "chapter-editor";
    case "generated-chapter":
      return "candidate-editor";
    case "draft":
      return "draft-editor";
    case "outline":
      return "outline-editor";
    case "bible-category":
      return "bible-category-view";
    case "bible-entry":
      return "bible-entry-editor";
    case "story-file":
    case "truth-file":
      return "markdown-viewer";
    case "material":
      return "material-viewer";
    case "publish-report":
      return "publish-report-viewer";
    default:
      return "unsupported";
  }
}

function PlaceholderSection({
  title,
  meta,
  description,
}: {
  readonly title: string;
  readonly meta: string;
  readonly description: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      <div className="rounded-lg border border-dashed border-border bg-background/60 p-4 text-sm text-muted-foreground">
        {description}
      </div>
    </div>
  );
}

export function DraftEditor({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="DraftEditor" description="草稿编辑器将在后续任务接入真实正文读取与保存。" />;
}

export function OutlineEditor({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="OutlineEditor" description="大纲查看与编辑将在后续任务接入真实 story/truth 文件。" />;
}

export function BibleEntryEditor({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="BibleEntryEditor" description="经纬条目编辑器将在后续任务接入真实资料读取与保存。" />;
}

export function MarkdownViewer({ node }: { readonly node: StudioResourceNode }) {
  return <WorkspaceFileViewer node={node} />;
}

export function MaterialViewer({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="MaterialViewer" description="素材查看器已注册，等待后续任务接入真实采风内容。" />;
}

export function PublishReportViewer({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="PublishReportViewer" description="发布报告查看器已注册，等待后续任务接入真实发布检查结果。" />;
}

export function UnsupportedWorkspaceNodeView({ node }: { readonly node: StudioResourceNode }) {
  return (
    <UnsupportedCapability
      title={`${node.title} 当前不可直接编辑`}
      reason="该资源节点当前只作为结构容器存在；后续若接入真实 viewer/editor，会在资源 registry 中显式替换。"
      status="planned"
      capability={`workspace.resource.${node.kind}`}
    />
  );
}
