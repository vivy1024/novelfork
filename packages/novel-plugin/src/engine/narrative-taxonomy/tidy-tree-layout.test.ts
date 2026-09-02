import { describe, expect, it } from "vitest";

import { layoutTidyTree, toRadial, type LayoutInputNode } from "./tidy-tree-layout";

function node(id: string, ...children: LayoutInputNode[]): LayoutInputNode {
  return { id, children };
}

describe("layoutTidyTree Buchheim 线性时间布局", () => {
  it("同深度节点的深度坐标一致", () => {
    const layout = layoutTidyTree(node("r", node("a", node("a1"), node("a2")), node("b", node("b1"))));
    const points = layout.points;
    expect(points.get("a")!.depthCoord).toBe(points.get("b")!.depthCoord);
    expect(points.get("a1")!.depthCoord).toBe(points.get("b1")!.depthCoord);
    // 深度递增
    expect(points.get("a")!.depthCoord).toBeGreaterThan(points.get("r")!.depthCoord);
  });

  it("父节点居中于首末子之间（tidy 的核心特征）", () => {
    const layout = layoutTidyTree(node("r", node("a"), node("b"), node("c")));
    const a = layout.points.get("a")!.breadthCoord;
    const c = layout.points.get("c")!.breadthCoord;
    const r = layout.points.get("r")!.breadthCoord;
    expect(r).toBeCloseTo((a + c) / 2, 6);
  });

  it("兄弟节点互不重叠且保持输入顺序", () => {
    const layout = layoutTidyTree(node("r", node("a"), node("b"), node("c"), node("d")));
    const coords = ["a", "b", "c", "d"].map((id) => layout.points.get(id)!.breadthCoord);
    for (let index = 1; index < coords.length; index += 1) {
      expect(coords[index]!).toBeGreaterThan(coords[index - 1]!);
    }
  });

  it("长子树不会压到兄弟子树（apportion 生效）", () => {
    // 左子树很宽，右子树只有一个节点：右子树必须被推到左子树右侧之外
    const layout = layoutTidyTree(node(
      "r",
      node("wide", node("w1"), node("w2"), node("w3"), node("w4")),
      node("narrow", node("n1")),
    ));
    const w4 = layout.points.get("w4")!.breadthCoord;
    const n1 = layout.points.get("n1")!.breadthCoord;
    expect(n1).toBeGreaterThan(w4);
  });

  it("深层子树之间也不重叠（缝合线 thread 生效）", () => {
    const deepLeft = node("dl", node("dl1", node("dl2", node("dl3"))));
    const deepRight = node("dr", node("dr1", node("dr2", node("dr3"))));
    const layout = layoutTidyTree(node("r", deepLeft, deepRight));
    // 同深度的左右两支必须分开
    for (const [left, right] of [["dl1", "dr1"], ["dl2", "dr2"], ["dl3", "dr3"]]) {
      expect(layout.points.get(right!)!.breadthCoord)
        .toBeGreaterThan(layout.points.get(left!)!.breadthCoord);
    }
  });

  it("输出每条父子边，供渲染连线", () => {
    const layout = layoutTidyTree(node("r", node("a", node("a1")), node("b")));
    const pairs = layout.edges.map((edge) => `${edge.from}->${edge.to}`).sort();
    expect(pairs).toEqual(["a->a1", "r->a", "r->b"]);
  });

  it("单节点树不报错", () => {
    const layout = layoutTidyTree(node("only"));
    expect(layout.points.size).toBe(1);
    expect(layout.edges).toEqual([]);
    expect(layout.maxDepth).toBe(0);
    expect(layout.points.get("only")!.breadthCoord).toBe(0);
  });

  it("间距可配置，深度与广度分别缩放", () => {
    const layout = layoutTidyTree(node("r", node("a"), node("b")), { depthSpacing: 100, breadthSpacing: 10 });
    expect(layout.points.get("a")!.depthCoord).toBe(100);
    const gap = layout.points.get("b")!.breadthCoord - layout.points.get("a")!.breadthCoord;
    expect(gap).toBeCloseTo(10, 6);
  });

  it("报告广度范围与最大深度，供视口计算", () => {
    const layout = layoutTidyTree(node("r", node("a", node("a1")), node("b")));
    const [min, max] = layout.breadthExtent;
    expect(min).toBeLessThanOrEqual(max);
    expect(layout.maxDepth).toBe(2);
  });

  it("不平衡树：单子链不产生偏移抖动", () => {
    const layout = layoutTidyTree(node("r", node("a", node("b", node("c")))));
    // 单链上所有节点广度坐标应相同（父居中于唯一子）
    const coords = ["r", "a", "b", "c"].map((id) => layout.points.get(id)!.breadthCoord);
    for (const coord of coords) expect(coord).toBeCloseTo(coords[0]!, 6);
  });

  it("规模较大时仍能完成（线性时间，不退化）", () => {
    // 构造 3 层扇出 12 的树 ≈ 1885 节点
    const build = (prefix: string, depth: number): LayoutInputNode => ({
      id: prefix,
      children: depth === 0
        ? []
        : Array.from({ length: 12 }, (_, index) => build(`${prefix}-${index}`, depth - 1)),
    });
    const started = Date.now();
    const layout = layoutTidyTree(build("root", 3));
    expect(layout.points.size).toBeGreaterThan(1800);
    // 线性算法在这个规模下应远低于 1s
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("toRadial 径向变体", () => {
  it("根节点固定圆心", () => {
    const layout = layoutTidyTree(node("r", node("a"), node("b")));
    const radial = toRadial(layout);
    expect(radial.get("r")).toEqual({ x: 0, y: 0, depth: 0 });
  });

  it("半径随深度增长", () => {
    const layout = layoutTidyTree(node("r", node("a", node("a1"))));
    const radial = toRadial(layout, { radiusStep: 100 });
    const a = radial.get("a")!;
    const a1 = radial.get("a1")!;
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(100, 6);
    expect(Math.hypot(a1.x, a1.y)).toBeCloseTo(200, 6);
  });

  it("同深度节点分布在不同角度", () => {
    const layout = layoutTidyTree(node("r", node("a"), node("b"), node("c")));
    const radial = toRadial(layout);
    const angles = ["a", "b", "c"].map((id) => {
      const point = radial.get(id)!;
      return Math.atan2(point.y, point.x);
    });
    expect(new Set(angles.map((angle) => angle.toFixed(4))).size).toBe(3);
  });

  it("单节点树不产生 NaN 坐标", () => {
    const radial = toRadial(layoutTidyTree(node("only")));
    const point = radial.get("only")!;
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
