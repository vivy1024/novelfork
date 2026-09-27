/**
 * 因果画布的节点与连线：泳道底纹、场景卡片、剧情线线路、伏笔回收线。
 */

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";

import { SCENE_FUNCTION_LABEL } from "../../../engine/narrative-taxonomy/causal-graph";
import type { CausalCanvasEdge, CausalLaneNodeData, CausalSceneNodeData } from "./causal-canvas-layout";
import { SCENE_HEIGHT, SCENE_WIDTH } from "./causal-canvas-layout";

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function LaneView({ data }: NodeProps & { data: CausalLaneNodeData }) {
  return (
    <div
      className={`h-full w-full border-y border-dashed ${data.striped ? "bg-muted/40" : "bg-transparent"} ${data.dropTarget ? "!bg-primary/10 outline outline-2 outline-primary/50" : ""}`}
      style={{ borderColor: `${data.color}33` }}
      data-testid={`causal-lane-${data.lane.id}`}
    />
  );
}

function SceneView({ data, selected }: NodeProps & { data: CausalSceneNodeData }) {
  const { scene, openHooks } = data.node;
  const planted = scene.hooksPlanted?.length ?? 0;
  const used = scene.hooksUsed?.length ?? 0;
  const pending = scene.status === "needs-review";
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border bg-card px-2 py-1.5 text-xs shadow-sm transition-opacity ${selected ? "ring-2 ring-primary" : ""} ${data.matched ? "ring-2 ring-amber-400" : ""} ${data.dimmed ? "opacity-30" : ""} ${pending ? "border-dashed" : ""}`}
      style={{ width: SCENE_WIDTH, height: SCENE_HEIGHT, borderLeft: `4px solid ${data.homeColor}` }}
      data-testid={`causal-scene-${scene.id}`}
      title={scene.summary || undefined}
    >
      <Handle id="in" type="target" position={Position.Left} className={hiddenHandle} isConnectable={false} />
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-1 font-medium leading-snug">{scene.title?.trim() || `第 ${scene.ordinal} 场`}</span>
        {pending ? <span className="shrink-0 rounded bg-amber-100 px-1 text-2xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">待审</span> : null}
      </div>
      <div className="text-2xs text-muted-foreground">
        第 {scene.chapterNumber} 章 · 第 {scene.ordinal} 场{scene.function ? ` · ${SCENE_FUNCTION_LABEL[scene.function] ?? scene.function}` : ""}
      </div>
      <div className="mt-auto flex items-center gap-1">
        {data.mountDots.map((dot) => (
          <span
            key={dot.name}
            title={`${dot.primary ? "主" : "辅"}：${dot.name}`}
            className="inline-block size-2.5 rounded-full"
            style={dot.primary ? { background: dot.color } : { boxShadow: `inset 0 0 0 2px ${dot.color}` }}
          />
        ))}
        <span className="ml-auto flex gap-1 text-2xs text-muted-foreground">
          {planted > 0 ? <span title="这里埋下的伏笔">埋 {planted}</span> : null}
          {used > 0 ? <span title="这里回收的伏笔">收 {used}</span> : null}
          {openHooks.length > 0 ? (
            <span className="text-amber-600" title={`之后还没有场景回收：${openHooks.join("、")}`}>悬 {openHooks.length}</span>
          ) : null}
        </span>
      </div>
      <Handle id="out" type="source" position={Position.Right} className={hiddenHandle} isConnectable={false} />
    </div>
  );
}

export const causalNodeTypes = {
  lane: memo(LaneView),
  scene: memo(SceneView),
};

/** 剧情线线路：实线，颜色随剧情线。 */
function LineEdgeView(props: EdgeProps<CausalCanvasEdge>) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 12 });
  return (
    <BaseEdge
      id={props.id}
      path={path}
      style={{ stroke: props.data?.color, strokeWidth: 2.5, opacity: props.data?.dimmed ? 0.12 : 0.85 }}
    />
  );
}

/** 伏笔回收：虚线，从埋下的场景指向回收的场景，标签是伏笔名。 */
function HookEdgeView(props: EdgeProps<CausalCanvasEdge>) {
  const [path, labelX, labelY] = getBezierPath({ ...props, curvature: 0.35 });
  const dimmed = props.data?.dimmed;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: props.data?.color, strokeWidth: 1.5, strokeDasharray: "5 4", opacity: dimmed ? 0.15 : 0.9 }}
      />
      {props.data?.label && !dimmed ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded border border-amber-400/70 bg-amber-50 px-1 py-0.5 text-2xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {props.data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const causalEdgeTypes = {
  line: memo(LineEdgeView),
  hook: memo(HookEdgeView),
};
