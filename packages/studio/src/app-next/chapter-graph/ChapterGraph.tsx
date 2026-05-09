/**
 * ChapterGraph — react-flow 章节图
 *
 * 对标 NarraFork 项目页：章节作为可拖拽节点，边表示 fork/merge 关系。
 */

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { ChapterNode, type ChapterNodeData, type ChapterNodeType } from "./ChapterNode";

export interface ChapterGraphChapter {
  id: string;
  title: string;
  status: "active" | "dormant" | "merged" | "abandoned" | "frozen";
  branch?: string;
  changes?: number;
  narratorId?: string;
  position?: { x: number; y: number };
}

export interface ChapterGraphEdge {
  id: string;
  source: string;
  target: string;
  type: "fork" | "merge" | "dependency" | "cherry_pick" | "review";
}

export interface ChapterGraphProps {
  chapters: ChapterGraphChapter[];
  edges: ChapterGraphEdge[];
  onChapterSelect?: (chapterId: string) => void;
  onPositionChange?: (positions: Record<string, { x: number; y: number }>) => void;
  onNewChapter?: () => void;
  onForkChapter?: (chapterId: string) => void;
  onMergeChapters?: (sourceId: string, targetId: string) => void;
}

const nodeTypes = { chapterNode: ChapterNode } as const;

const EDGE_COLORS: Record<string, string> = {
  fork: "#4c6ef5",
  merge: "#40c057",
  dependency: "#fd7e14",
  cherry_pick: "#7950f2",
  review: "#fab005",
};

export function ChapterGraph({ chapters, edges: graphEdges, onChapterSelect, onPositionChange, onNewChapter, onForkChapter }: ChapterGraphProps) {
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const nodes: ChapterNodeType[] = useMemo(
    () =>
      chapters.map((ch, i) => ({
        id: ch.id,
        type: "chapterNode",
        position: ch.position ?? { x: i * 420, y: 0 },
        data: {
          id: ch.id,
          title: ch.title,
          status: ch.status,
          branch: ch.branch,
          changes: ch.changes,
          narratorId: ch.narratorId,
        },
        style: { width: 380, height: 500 },
      })),
    [chapters],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      graphEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.type,
        style: { stroke: EDGE_COLORS[e.type] ?? "#aaa" },
        animated: e.type === "fork",
      })),
    [graphEdges],
  );

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const updated = applyNodeChanges(changes, nodes);
      // 通知位置变化
      const positionChanges = changes.filter((c) => c.type === "position" && c.position);
      if (positionChanges.length > 0 && onPositionChange) {
        const positions: Record<string, { x: number; y: number }> = {};
        for (const node of updated) {
          positions[node.id] = node.position;
        }
        onPositionChange(positions);
      }
    },
    [nodes, onPositionChange],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      applyEdgeChanges(changes, flowEdges);
    },
    [flowEdges],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setSelectedChapterId(node.id);
      onChapterSelect?.(node.id);
    },
    [onChapterSelect],
  );

  return (
    <div className="flex h-full w-full flex-col">
      {/* 操作栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        {onNewChapter && (
          <Button size="sm" onClick={onNewChapter}>
            新建章节
          </Button>
        )}
        {onForkChapter && selectedChapterId && (
          <Button variant="outline" size="sm" onClick={() => onForkChapter(selectedChapterId)}>
            分叉
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{chapters.length} 个章节</span>
      </div>

      {/* 图画布 */}
      <div className="flex-1">
        <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.3}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
      </ReactFlow>
      </div>
    </div>
  );
}
