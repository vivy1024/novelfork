/**
 * 人物关系网的节点与连线。连线两端挂在节点中心（隐藏的手柄），画成直线；
 * 颜色表示最近一条看得出亲疏的关系，粗细表示共同事件数。
 */

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";

import type { RelationPolarityLabel } from "../../../engine/narrative-entity/relation-graph";
import {
  NETWORK_NODE_HEIGHT,
  NETWORK_NODE_WIDTH,
  type RelationFlowEdge,
  type RelationFlowNode,
} from "./relation-network-layout";

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  character: "角色",
  location: "地点",
  faction: "势力",
  item: "道具",
};

/** 亲疏配色全部取主题令牌，明暗主题自动跟随。 */
export const POLARITY_STROKE: Record<RelationPolarityLabel, string> = {
  紧密: "var(--primary)",
  友好: "color-mix(in oklch, var(--primary) 60%, transparent)",
  中性: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)",
  紧张: "color-mix(in oklch, var(--destructive) 55%, transparent)",
  敌对: "var(--destructive)",
};

const centerHandle = "!left-1/2 !top-1/2 !size-1 !min-h-0 !min-w-0 !-translate-x-1/2 !-translate-y-1/2 !border-0 !bg-transparent";

function EntityNodeView({ data }: NodeProps<RelationFlowNode>) {
  const { node, selected, dimmed } = data;
  const focus = node.hop === 0;
  return (
    <div
      className={`relative flex flex-col justify-center overflow-hidden rounded-md border px-2 text-left shadow-sm transition-opacity bg-card ${focus ? "border-primary" : ""} ${selected ? "ring-2 ring-primary" : ""} ${dimmed ? "opacity-30" : ""} ${node.hop === 2 ? "border-dashed" : ""}`}
      style={{ width: NETWORK_NODE_WIDTH, height: NETWORK_NODE_HEIGHT }}
      data-testid={`relation-node-${node.id}`}
      data-hop={node.hop}
      title={focus ? "焦点人物" : "单击查看，双击设为焦点"}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className={centerHandle} />
      {/* 底色不透明（连线画在节点下面，不能透出来），焦点再叠一层主色。 */}
      {focus ? <span className="pointer-events-none absolute inset-0 bg-primary/10" /> : null}
      <span className={`relative truncate text-xs ${focus ? "font-semibold" : "font-medium"}`}>{node.name}</span>
      <span className="relative truncate text-2xs text-muted-foreground">
        {ENTITY_TYPE_LABEL[node.type] ?? node.type}
        {focus ? " · 焦点" : ` · ${node.hop} 跳`}
        {node.degree > 0 ? ` · ${node.degree} 条关系` : ""}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={centerHandle} />
    </div>
  );
}

export const relationNodeTypes = { entity: memo(EntityNodeView) };

function RelationEdgeView(props: EdgeProps<RelationFlowEdge>) {
  const [path, labelX, labelY] = getStraightPath(props);
  const data = props.data;
  if (!data) return null;
  const { edge, selected, dimmed, showLabel } = data;
  const width = 1.2 + Math.min(4, edge.sharedEvents) * 0.6 + (selected ? 1 : 0);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={16}
        style={{ stroke: POLARITY_STROKE[edge.latestPolarity.label], strokeWidth: width, opacity: dimmed ? 0.12 : 0.9 }}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute max-w-40 truncate rounded border bg-background/95 px-1 py-0.5 text-2xs ${selected ? "border-primary text-foreground" : "text-muted-foreground"}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            data-testid={`relation-edge-label-${edge.id}`}
          >
            {edge.latestPredicate}
            {edge.relationCount > 1 ? ` 等 ${edge.relationCount} 条` : ""}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const relationEdgeTypes = { relation: memo(RelationEdgeView) };
