/**
 * 工作流画布：编辑与执行监视用同一张图。
 *
 * 受控组件：图结构由父组件持有，画布上的结构改动（连线、删除）换算成编辑指令交给 onOps，
 * 拖动只改排版位置（onMoveNode）。只读模式用于运行中的叠加监视。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  WorkflowGraphIssue,
  WorkflowGraphOp,
  WorkflowNodePosition,
} from "../../../engine/workflows/workflow-graph.js";
import {
  connectionToOp,
  toCanvasEdges,
  toCanvasNodes,
  type CanvasRunStep,
  type CanvasSelection,
  type WorkflowGraphShape,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
} from "./workflow-canvas-model";
import { useCanvasColorMode } from "../use-canvas-color-mode";
import { workflowEdgeTypes, workflowNodeTypes } from "./WorkflowCanvasNodes";

export interface WorkflowCanvasProps {
  readonly recipe: WorkflowGraphShape;
  readonly issues: readonly WorkflowGraphIssue[];
  readonly editable: boolean;
  readonly runSteps?: readonly CanvasRunStep[];
  readonly selection?: CanvasSelection;
  readonly onSelect?: (selection: CanvasSelection) => void;
  readonly onOps?: (ops: WorkflowGraphOp[]) => void;
  readonly onMoveNode?: (id: string, position: WorkflowNodePosition) => void;
  /** 变化时重新适配视口（自动排版、加节点之后）。 */
  readonly fitViewKey?: number;
  readonly className?: string;
}

const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };

/** 放在 ReactFlow 里面才能拿到视口控制。 */
function FitViewOnChange({ signal }: { signal: number | undefined }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (signal === undefined || signal === 0) return;
    // 等新节点量完尺寸再适配。
    const timer = setTimeout(() => void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 }), 50);
    return () => clearTimeout(timer);
  }, [signal, fitView]);
  return null;
}

const defaultEdgeOptions = { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } };

export function WorkflowCanvas({
  recipe,
  issues,
  editable,
  runSteps,
  selection = null,
  onSelect,
  onOps,
  onMoveNode,
  fitViewKey,
  className,
}: WorkflowCanvasProps) {
  const colorMode = useCanvasColorMode();
  const selectedId = selection?.id ?? null;
  const derivedNodes = useMemo(
    () => toCanvasNodes(recipe, issues, { editable, runSteps, selectedId }),
    [recipe, issues, editable, runSteps, selectedId],
  );
  const derivedEdges = useMemo(
    () => toCanvasEdges(recipe, issues, { editable, runSteps, selectedId }).map((edge) => ({ ...edge, ...defaultEdgeOptions })),
    [recipe, issues, editable, runSteps, selectedId],
  );

  // 画布内部状态只为拖动时的流畅；图结构一变就以父组件为准重新派生。
  const [nodes, setNodes] = useState<WorkflowCanvasNode[]>(derivedNodes);
  const [edges, setEdges] = useState<WorkflowCanvasEdge[]>(derivedEdges);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);
  useEffect(() => setEdges(derivedEdges), [derivedEdges]);

  const onNodesChange = useCallback((changes: NodeChange<WorkflowCanvasNode>[]) => {
    // 删除走 onDelete 统一换算成一批指令；这里只处理位置、尺寸与选中。
    setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== "remove"), current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<WorkflowCanvasEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes.filter((change) => change.type !== "remove"), current));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const op = connectionToOp(connection);
    if (op) onOps?.([op]);
  }, [onOps]);

  const onDelete = useCallback(({ nodes: removedNodes, edges: removedEdges }: { nodes: WorkflowCanvasNode[]; edges: WorkflowCanvasEdge[] }) => {
    const removedNodeIds = new Set(removedNodes.map((node) => node.id));
    const ops: WorkflowGraphOp[] = [
      // 挂在被删节点上的线会随节点一起删掉，不再单独断开。
      ...removedEdges
        .filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target))
        .map((edge): WorkflowGraphOp => ({ op: "disconnect", id: edge.id })),
      ...removedNodes.map((node): WorkflowGraphOp => ({ op: "remove_node", id: node.id })),
    ];
    if (ops.length > 0) {
      onOps?.(ops);
      onSelect?.(null);
    }
  }, [onOps, onSelect]);

  return (
    <div className={className ?? "h-[600px] w-full"} data-testid="workflow-canvas">
      <ReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={workflowNodeTypes}
        edgeTypes={workflowEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={editable ? onConnect : undefined}
        onDelete={editable ? onDelete : undefined}
        onNodeClick={(_, node) => onSelect?.({ kind: "node", id: node.id })}
        onEdgeClick={(_, edge) => onSelect?.({ kind: "edge", id: edge.id })}
        onPaneClick={() => onSelect?.(null)}
        onNodeDragStop={(_, node) => onMoveNode?.(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        colorMode={colorMode}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.25}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        <FitViewOnChange signal={fitViewKey} />
      </ReactFlow>
    </div>
  );
}
