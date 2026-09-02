/**
 * Tidy tree 布局：Reingold-Tilford (1981) 经 Buchheim, Jünger, Leipert (2002)
 * 改进的**线性时间**版本（d3.tree 用的同一套算法）。
 *
 * 为什么必须是这套算法而不是简单缩进：
 *   · 同深度节点严格对齐，父节点居于子节点中央 —— 层级关系一眼可读
 *   · 子树紧凑排布且互不重叠，长子树不会把兄弟推歪
 *   · 连线零交叉。Purchase 2002【实证】显示减少边交叉对可读性的收益最大，
 *     这是层级数据该用树布局、而非力导向的根本原因
 *
 * 复杂度 O(n)：靠 thread（缝合线）+ ancestor/shift 机制避免 Walker 原版
 * 最坏 O(n²) 的重复扫描。
 *
 * 坐标系：算法在「深度 × 兄弟序」的抽象空间求解，输出时再乘以间距，
 * 因此同一份布局结果可渲染成横向（根在左）或纵向（根在上）。
 */

export interface LayoutInputNode {
  readonly id: string;
  readonly children: readonly LayoutInputNode[];
}

export interface LayoutPoint {
  readonly id: string;
  /** 沿层级方向的坐标（横向布局时是 x，纵向时是 y）。 */
  readonly depthCoord: number;
  /** 沿兄弟展开方向的坐标。 */
  readonly breadthCoord: number;
  readonly depth: number;
}

export interface TidyTreeLayout {
  readonly points: ReadonlyMap<string, LayoutPoint>;
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly breadthExtent: readonly [number, number];
  readonly maxDepth: number;
}

export interface TidyTreeOptions {
  /** 层级间距（深度方向）。 */
  readonly depthSpacing?: number;
  /** 兄弟间距（广度方向）。 */
  readonly breadthSpacing?: number;
}

/** 布局内部节点：承载算法需要的可变中间量。 */
interface WorkNode {
  readonly id: string;
  readonly depth: number;
  readonly children: WorkNode[];
  parent: WorkNode | null;
  /** 在兄弟中的序号（1-based，算法要求）。 */
  number: number;
  /** 相对父节点的初步位置。 */
  prelim: number;
  /** 子树整体偏移量。 */
  modifier: number;
  /** 缝合线：指向下一个轮廓节点，让跨子树比较不必逐层下降。 */
  thread: WorkNode | null;
  /** 用于 apportion 的祖先候选。 */
  ancestor: WorkNode;
  change: number;
  shift: number;
  /** 最终广度坐标。 */
  coord: number;
}

function toWorkTree(node: LayoutInputNode, depth: number, parent: WorkNode | null, index: number): WorkNode {
  const work: WorkNode = {
    id: node.id,
    depth,
    children: [],
    parent,
    number: index + 1,
    prelim: 0,
    modifier: 0,
    thread: null,
    ancestor: null as unknown as WorkNode,
    change: 0,
    shift: 0,
    coord: 0,
  };
  work.ancestor = work;
  node.children.forEach((child, childIndex) => {
    work.children.push(toWorkTree(child, depth + 1, work, childIndex));
  });
  return work;
}

function firstChild(node: WorkNode): WorkNode | undefined {
  return node.children[0];
}

function lastChild(node: WorkNode): WorkNode | undefined {
  return node.children[node.children.length - 1];
}

/** 左轮廓的下一个节点：有子节点走最左子，否则走缝合线。 */
function nextLeft(node: WorkNode): WorkNode | null {
  return firstChild(node) ?? node.thread;
}

/** 右轮廓的下一个节点。 */
function nextRight(node: WorkNode): WorkNode | null {
  return lastChild(node) ?? node.thread;
}

function leftSibling(node: WorkNode): WorkNode | null {
  if (!node.parent) return null;
  const index = node.parent.children.indexOf(node);
  return index > 0 ? node.parent.children[index - 1]! : null;
}

function leftmostSibling(node: WorkNode): WorkNode | null {
  if (!node.parent) return null;
  const first = firstChild(node.parent);
  return first && first !== node ? first : null;
}

/**
 * 选定用于消解冲突的祖先：若候选与目标同父则用它，否则回退到默认祖先。
 * 这一步是 Buchheim 把复杂度压到线性的关键。
 */
function ancestorFor(candidate: WorkNode, node: WorkNode, defaultAncestor: WorkNode): WorkNode {
  return candidate.ancestor.parent === node.parent ? candidate.ancestor : defaultAncestor;
}

function moveSubtree(shiftFrom: WorkNode, shiftTo: WorkNode, shift: number): void {
  const subtrees = shiftTo.number - shiftFrom.number;
  if (subtrees === 0) return;
  shiftTo.change -= shift / subtrees;
  shiftTo.shift += shift;
  shiftFrom.change += shift / subtrees;
  shiftTo.prelim += shift;
  shiftTo.modifier += shift;
}

function executeShifts(node: WorkNode): void {
  let shift = 0;
  let change = 0;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]!;
    child.prelim += shift;
    child.modifier += shift;
    change += child.change;
    shift += child.shift + change;
  }
}

/** 把当前子树与左侧兄弟子树分开，必要时整体右移。 */
function apportion(node: WorkNode, defaultAncestor: WorkNode, spacing: number): WorkNode {
  const sibling = leftSibling(node);
  if (!sibling) return defaultAncestor;

  let insideRight: WorkNode | null = node;
  let outsideRight: WorkNode | null = node;
  let insideLeft: WorkNode | null = sibling;
  let outsideLeft: WorkNode | null = leftmostSibling(node);

  let insideRightMod = node.modifier;
  let outsideRightMod = node.modifier;
  let insideLeftMod = sibling.modifier;
  let outsideLeftMod = outsideLeft ? outsideLeft.modifier : 0;

  let ancestor = defaultAncestor;

  while (insideLeft && insideRight && nextRight(insideLeft) && nextLeft(insideRight)) {
    insideLeft = nextRight(insideLeft);
    insideRight = nextLeft(insideRight);
    outsideLeft = outsideLeft ? nextLeft(outsideLeft) : null;
    outsideRight = outsideRight ? nextRight(outsideRight) : null;
    if (!insideLeft || !insideRight) break;
    if (outsideRight) outsideRight.ancestor = node;

    const shift = insideLeft.prelim + insideLeftMod - (insideRight.prelim + insideRightMod) + spacing;
    if (shift > 0) {
      moveSubtree(ancestorFor(insideLeft, node, ancestor), node, shift);
      insideRightMod += shift;
      outsideRightMod += shift;
    }
    insideLeftMod += insideLeft.modifier;
    insideRightMod += insideRight.modifier;
    if (outsideLeft) outsideLeftMod += outsideLeft.modifier;
    if (outsideRight) outsideRightMod += outsideRight.modifier;
  }

  // 缝合：把较短一侧的轮廓接到较长一侧，供后续兄弟直接沿用
  if (insideLeft && nextRight(insideLeft) && outsideRight && !nextRight(outsideRight)) {
    outsideRight.thread = nextRight(insideLeft);
    outsideRight.modifier += insideLeftMod - outsideRightMod;
  }
  if (insideRight && nextLeft(insideRight) && outsideLeft && !nextLeft(outsideLeft)) {
    outsideLeft.thread = nextLeft(insideRight);
    outsideLeft.modifier += insideRightMod - outsideLeftMod;
    ancestor = node;
  }
  return ancestor;
}

/** 第一遍自底向上：算出每个节点相对父的初步位置。 */
function firstWalk(node: WorkNode, spacing: number): void {
  if (node.children.length === 0) {
    const sibling = leftSibling(node);
    node.prelim = sibling ? sibling.prelim + spacing : 0;
    return;
  }
  let defaultAncestor = firstChild(node)!;
  for (const child of node.children) {
    firstWalk(child, spacing);
    defaultAncestor = apportion(child, defaultAncestor, spacing);
  }
  executeShifts(node);

  // 父节点居中于首末子之间——这是「tidy」的核心观感
  const first = firstChild(node)!;
  const last = lastChild(node)!;
  const midpoint = (first.prelim + last.prelim) / 2;
  const sibling = leftSibling(node);
  if (sibling) {
    node.prelim = sibling.prelim + spacing;
    node.modifier = node.prelim - midpoint;
  } else {
    node.prelim = midpoint;
  }
}

/** 第二遍自顶向下：累加 modifier 得到最终坐标。 */
function secondWalk(node: WorkNode, offset: number, out: WorkNode[]): void {
  node.coord = node.prelim + offset;
  out.push(node);
  for (const child of node.children) {
    secondWalk(child, offset + node.modifier, out);
  }
}

/**
 * 计算 tidy tree 布局。
 *
 * 返回的坐标是「深度方向 × 广度方向」的抽象坐标，渲染层决定映射到 x/y
 * （横向布局：depthCoord→x, breadthCoord→y；纵向布局反之）。
 */
export function layoutTidyTree(root: LayoutInputNode, options: TidyTreeOptions = {}): TidyTreeLayout {
  const depthSpacing = options.depthSpacing ?? 180;
  const breadthSpacing = options.breadthSpacing ?? 28;

  const work = toWorkTree(root, 0, null, 0);
  firstWalk(work, 1);
  const ordered: WorkNode[] = [];
  secondWalk(work, -work.prelim, ordered);

  const points = new Map<string, LayoutPoint>();
  const edges: { from: string; to: string }[] = [];
  let minBreadth = Number.POSITIVE_INFINITY;
  let maxBreadth = Number.NEGATIVE_INFINITY;
  let maxDepth = 0;

  for (const node of ordered) {
    const breadthCoord = node.coord * breadthSpacing;
    points.set(node.id, {
      id: node.id,
      depthCoord: node.depth * depthSpacing,
      breadthCoord,
      depth: node.depth,
    });
    minBreadth = Math.min(minBreadth, breadthCoord);
    maxBreadth = Math.max(maxBreadth, breadthCoord);
    maxDepth = Math.max(maxDepth, node.depth);
    if (node.parent) edges.push({ from: node.parent.id, to: node.id });
  }

  return {
    points,
    edges,
    breadthExtent: [
      Number.isFinite(minBreadth) ? minBreadth : 0,
      Number.isFinite(maxBreadth) ? maxBreadth : 0,
    ],
    maxDepth,
  };
}

/**
 * 径向变体：把 tidy tree 的广度坐标映射成角度、深度映射成半径。
 * 适合层级浅但分支多的情形（如角色关系放射）。
 */
export function toRadial(
  layout: TidyTreeLayout,
  options: { readonly radiusStep?: number; readonly sweep?: number } = {},
): Map<string, { x: number; y: number; depth: number }> {
  const radiusStep = options.radiusStep ?? 110;
  const sweep = options.sweep ?? Math.PI * 2;
  const [minBreadth, maxBreadth] = layout.breadthExtent;
  const span = Math.max(1e-6, maxBreadth - minBreadth);
  /**
   * 整圈（sweep=2π）时首尾会重合（角度 0 与 2π 同向），需留一格间隙：
   * 用「广度格数 +1」作分母，让最后一个节点停在 2π 之前。
   * 非整圈（如扇形 π）不需要这个修正。
   */
  const isFullCircle = Math.abs(sweep - Math.PI * 2) < 1e-9;
  const result = new Map<string, { x: number; y: number; depth: number }>();
  for (const point of layout.points.values()) {
    // 根节点固定圆心，避免 depth 0 时角度无意义
    if (point.depth === 0) {
      result.set(point.id, { x: 0, y: 0, depth: 0 });
      continue;
    }
    const rawRatio = (point.breadthCoord - minBreadth) / span;
    const ratio = isFullCircle ? rawRatio * (1 - 1 / (span + 1)) : rawRatio;
    const angle = -Math.PI / 2 + ratio * sweep;
    const radius = point.depth * radiusStep;
    result.set(point.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      depth: point.depth,
    });
  }
  return result;
}
