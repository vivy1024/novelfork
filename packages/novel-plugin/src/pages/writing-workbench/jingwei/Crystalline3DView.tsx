import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Sparkles, ExternalLink, HelpCircle, Eye, Info, Database, Layers, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/hooks/use-api";

interface NarrativeFact {
  id: string;
  bookId: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer: "canon" | "dynamic" | "reference";
  confidence: number;
  sourceType: "jingwei" | "runtime-state" | "event" | "manual" | "import";
  sourceId?: string;
  sourceChapter?: number;
  evidenceText?: string;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
  originalX: number;
  originalY: number;
  originalZ: number;
  label: string;
  id: string;
  size: number;
  color: string;
  energy: number;
}

interface Edge3D {
  source: Point3D;
  target: Point3D;
  label: string;
  energy: number;
}

interface Particle3D {
  x: number;
  y: number;
  z: number;
  source: Point3D;
  target: Point3D;
  progress: number;
  speed: number;
  color: string;
}

interface Star3D {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  alphaSpeed: number;
}

interface Crystalline3DViewProps {
  bookId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  relationship: "关系",
  hook: "伏笔",
  timeline: "时间线",
  conflict: "矛盾冲突",
  world_fact: "世界事实",
  character_state: "角色状态",
  location: "地点状态",
};

const CATEGORY_COLORS: Record<string, string> = {
  relationship: "rgba(244, 63, 94, 1)",  // rose-500
  hook: "rgba(99, 102, 241, 1)",         // indigo-500
  timeline: "rgba(100, 116, 139, 1)",     // slate-500
  conflict: "rgba(249, 115, 22, 1)",      // orange-500
  world_fact: "rgba(16, 185, 129, 1)",    // emerald-500
  character_state: "rgba(168, 85, 247, 1)", // purple-500
  location: "rgba(14, 165, 233, 1)",      // sky-500
};

export function Crystalline3DView({ bookId }: Crystalline3DViewProps) {
  const [facts, setFacts] = useState<NarrativeFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 3D 旋转视角控制 (拖拽 canvas 旋转星空网络)
  const [rotX, setRotX] = useState(-0.1);
  const [rotY, setRotY] = useState(0.4);

  // 卡片仓 Y 轴偏置角度 (滚轮或卡片拖拽产生的旋转)
  const [carouselAngle, setCarouselAngle] = useState(0);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Canvas Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingCanvasRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // 3D 物理网络节点与边缓存
  const nodesRef = useRef<Point3D[]>([]);
  const edgesRef = useRef<Edge3D[]>([]);
  const particlesRef = useRef<Particle3D[]>([]);
  const starsRef = useRef<Star3D[]>([]);

  // ---------------------------------------------------------------------------
  // 1. 数据加载与 3D 拓扑网络初始化
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchJson<{ facts: NarrativeFact[] }>(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/facts`)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.facts) ? data.facts : [];
        setFacts(list);
        setLoading(false);

        // 初始化 3D 星尘 (Starfield)
        const stars: Star3D[] = [];
        for (let i = 0; i < 80; i++) {
          stars.push({
            x: (Math.random() - 0.5) * 800,
            y: (Math.random() - 0.5) * 800,
            z: (Math.random() - 0.5) * 800,
            size: Math.random() * 2 + 0.5,
            alpha: Math.random() * 0.7 + 0.3,
            alphaSpeed: (Math.random() * 0.02 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
          });
        }
        starsRef.current = stars;

        // 构建 3D 力导向实体节点
        const entitySet = new Set<string>();
        for (const fact of list) {
          entitySet.add(fact.subject);
          entitySet.add(fact.object);
        }
        const entities = Array.from(entitySet);

        // 在 3D 球面上随机分布节点
        const nodes: Point3D[] = entities.map((name, idx) => {
          const phi = Math.acos(-1 + (2 * idx) / entities.length);
          const theta = Math.sqrt(entities.length * Math.PI) * phi;
          const r = 180 + Math.random() * 30; // 节点分布球半径

          const x = r * Math.sin(phi) * Math.cos(theta);
          const y = r * Math.sin(phi) * Math.sin(theta);
          const z = r * Math.cos(phi);

          const matches = list.filter((f) => f.subject === name || f.object === name);
          const val = matches[0];
          const color = val ? (CATEGORY_COLORS[val.category] ?? "rgba(147, 197, 253, 1)") : "rgba(147, 197, 253, 1)";

          return {
            id: `node:${idx}`,
            label: name,
            x, y, z,
            originalX: x, originalY: y, originalZ: z,
            size: 5 + Math.min(matches.length * 1.5, 12),
            color,
            energy: 1.0,
          };
        });
        nodesRef.current = nodes;

        // 构建发光连线
        const edges: Edge3D[] = [];
        for (const fact of list) {
          const srcNode = nodes.find((n) => n.label === fact.subject);
          const tgtNode = nodes.find((n) => n.label === fact.object);
          if (srcNode && tgtNode && srcNode !== tgtNode) {
            edges.push({
              source: srcNode,
              target: tgtNode,
              label: fact.predicate,
              energy: fact.confidence,
            });
          }
        }
        edgesRef.current = edges;

        // 初始化少许发光粒子
        const particles: Particle3D[] = [];
        for (let i = 0; i < Math.min(edges.length, 15); i++) {
          const edge = edges[i];
          if (edge) {
            particles.push({
              x: 0, y: 0, z: 0,
              source: edge.source,
              target: edge.target,
              progress: Math.random(),
              speed: 0.005 + Math.random() * 0.01,
              color: edge.source.color,
            });
          }
        }
        particlesRef.current = particles;
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "获取叙事事实失败");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // ---------------------------------------------------------------------------
  // 2. 动画渲染主循环 (Starfield + Node Graph + Particle Stream)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;

    // 适配高清屏
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    // 坐标旋转投影公式
    const transformPoint = (p: { x: number; y: number; z: number }, angleY: number, angleX: number) => {
      // 绕 Y 轴旋转 (rotY)
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      let x1 = p.x * cosY - p.z * sinY;
      let z1 = p.x * sinY + p.z * cosY;

      // 绕 X 轴旋转 (rotX)
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      let y2 = p.y * cosX - z1 * sinX;
      let z2 = p.y * sinX + z1 * cosX;

      // 透视投影
      const fov = 400; // 焦距
      const scale = fov / (fov + z2 + 250); // 往后平移 250 像素放置在视口深处
      return {
        x: x1 * scale + canvas.clientWidth / 2,
        y: y2 * scale + canvas.clientHeight / 2,
        scale,
        depth: z2,
      };
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // --- A. 绘制 3D 星尘 (Starfield) ---
      for (const star of starsRef.current) {
        star.alpha += star.alphaSpeed;
        if (star.alpha > 0.9) {
          star.alpha = 0.9;
          star.alphaSpeed = -Math.abs(star.alphaSpeed);
        } else if (star.alpha < 0.1) {
          star.alpha = 0.1;
          star.alphaSpeed = Math.abs(star.alphaSpeed);
        }
        const proj = transformPoint(star, rotY, rotX);
        if (proj.scale > 0) {
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, star.size * proj.scale, 0, 2 * Math.PI);
          ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha * Math.min(1.0, proj.scale * 1.5)})`;
          ctx.fill();
        }
      }

      // 慢慢自转图谱网络 (如果用户没在拖拽)
      if (!isDraggingCanvasRef.current) {
        setRotY((v) => v + 0.001);
      }

      // --- B. 绘制连线 (Edges) ---
      ctx.lineWidth = 1.0;
      for (const edge of edgesRef.current) {
        const p1 = transformPoint(edge.source, rotY, rotX);
        const p2 = transformPoint(edge.target, rotY, rotX);

        if (p1.scale > 0 && p2.scale > 0) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          // 连线透明度由可信度及透视深度共同决定
          const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          gradient.addColorStop(0, edge.source.color.replace("1)", "0.2"));
          gradient.addColorStop(1, edge.target.color.replace("1)", "0.2"));
          ctx.strokeStyle = gradient;
          ctx.stroke();
        }
      }

      // --- C. 更新和绘制发光能量粒子流 (Particles) ---
      for (const p of particlesRef.current) {
        p.progress += p.speed;
        if (p.progress >= 1.0) {
          p.progress = 0;
          // 节点被粒子击中后，爆发瞬间脉冲亮光 (能量反馈)
          p.target.energy = 2.0;
        }

        // 沿 3D 连接线插值运算
        p.x = p.source.x + p.progress * (p.target.x - p.source.x);
        p.y = p.source.y + p.progress * (p.target.y - p.source.y);
        p.z = p.source.z + p.progress * (p.target.z - p.source.z);

        const proj = transformPoint(p, rotY, rotX);
        if (proj.scale > 0) {
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, 3 * proj.scale, 0, 2 * Math.PI);
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 10 * proj.scale;
          ctx.shadowColor = p.color;
          ctx.fill();
          ctx.shadowBlur = 0; // 重置阴影避免影响其他绘制
        }
      }

      // --- D. 绘制发光实体结晶节点 (Nodes) ---
      // 先排个序，做深度缓存，后面节点盖住前面节点
      const projectedNodes = nodesRef.current
        .map((n) => {
          n.energy = Math.max(1.0, n.energy - 0.05); // 节点激发能量缓慢衰减
          return { n, proj: transformPoint(n, rotY, rotX) };
        })
        .sort((a, b) => b.proj.depth - a.proj.depth);

      for (const item of projectedNodes) {
        const { n, proj } = item;
        if (proj.scale > 0) {
          // 绘制外发光霓虹圈
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, n.size * proj.scale * n.energy, 0, 2 * Math.PI);
          ctx.fillStyle = n.color.replace("1)", `${0.2 * n.energy}`);
          ctx.fill();

          // 核心实体点
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, n.size * 0.6 * proj.scale, 0, 2 * Math.PI);
          ctx.fillStyle = n.color;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
          ctx.lineWidth = 1.0 * proj.scale;
          ctx.stroke();
          ctx.fill();

          // 实体文字标签 (随近大远小淡入淡出)
          const textAlpha = Math.min(1.0, Math.max(0.0, proj.scale * 2 - 0.8));
          if (textAlpha > 0.15) {
            ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha})`;
            ctx.font = `${Math.round(11 * proj.scale)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(n.label, proj.x, proj.y - n.size * proj.scale - 5);
          }
        }
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [rotX, rotY]);

  // ---------------------------------------------------------------------------
  // 3. 鼠标/手势拖动 Canvas 旋转 3D 星空
  // ---------------------------------------------------------------------------
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingCanvasRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCanvasRef.current) return;
    const deltaX = e.clientX - lastMousePosRef.current.x;
    const deltaY = e.clientY - lastMousePosRef.current.y;
    setRotY((v) => v + deltaX * 0.005);
    setRotX((v) => Math.max(-Math.PI / 3, Math.min(Math.PI / 3, v + deltaY * 0.005)));
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUpOrLeave = () => {
    isDraggingCanvasRef.current = false;
  };

  // ---------------------------------------------------------------------------
  // 4. CSS 3D 卡片筒 Carousel 的旋转与点击交互
  // ---------------------------------------------------------------------------
  const totalCards = facts.length;

  const rotateCarousel = useCallback((direction: "prev" | "next") => {
    if (totalCards === 0) return;
    setIsFlipped(false);
    setActiveCardIndex((prev) => {
      const nextIdx = direction === "next"
        ? (prev + 1) % totalCards
        : (prev - 1 + totalCards) % totalCards;
      setCarouselAngle(-nextIdx * (360 / totalCards));
      return nextIdx;
    });
  }, [totalCards]);

  const handleCardClick = (idx: number) => {
    if (idx === activeCardIndex) {
      // 已经是活动卡片，双击翻页查看出处
      setIsFlipped(!isFlipped);
    } else {
      setIsFlipped(false);
      setActiveCardIndex(idx);
      setCarouselAngle(-idx * (360 / totalCards));
    }
  };

  // 键盘左右方向键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 输入框/文本域内移动光标时不拦截方向键
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        rotateCarousel("prev");
      } else if (e.key === "ArrowRight") {
        rotateCarousel("next");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rotateCarousel]);

  // 鼠标滚轮在卡片架上的滚动支持
  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) > 5) {
      rotateCarousel(e.deltaY > 0 ? "next" : "prev");
    }
  };

  // ---------------------------------------------------------------------------
  // 5. 渲染
  // ---------------------------------------------------------------------------
  const activeFact = useMemo(() => {
    return facts[activeCardIndex] ?? null;
  }, [facts, activeCardIndex]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950/40 text-xs text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-primary" />
        正在结晶 3D 叙事记忆星空...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-950/40 text-xs text-destructive p-4 text-center">
        <span>加载失败: {error}</span>
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950 bg-radial p-6 text-center text-muted-foreground">
        <Brain className="size-10 opacity-20 text-primary" />
        <p className="text-sm">暂无叙事事实，请先运行写作产生记忆</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950 text-white select-none"
      onWheel={handleWheel}
    >
      {/* C. 3D 粒子星空 (发光 Canvas) */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        className="absolute inset-0 block h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* 顶部标题与数据度量 */}
      <header className="absolute top-4 left-4 z-10 space-y-1 p-2 bg-slate-950/60 backdrop-blur-md border border-white/5 rounded-xl shadow-lg">
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-pink-500 animate-pulse" />
          <h2 className="text-xs font-semibold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-indigo-300">
            3D 结晶记忆空间 (NARRATIVE ORB)
          </h2>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>事实节点: {nodesRef.current.length}</span>
          <span>连接测地线: {facts.length}</span>
          <span>激发星云: {particlesRef.current.length}P</span>
        </div>
      </header>

      {/* 底部视图控制说明 */}
      <footer className="absolute bottom-4 left-4 z-10 text-[9px] text-muted-foreground/60 max-w-48 space-y-0.5 p-2 bg-slate-950/40 rounded-lg">
        <div className="flex items-center gap-1"><Eye className="size-3 text-sky-400" /><span>拖拽背景: 旋转 3D 拓扑粒子连线</span></div>
        <div className="flex items-center gap-1"><Layers className="size-3 text-pink-400" /><span>鼠标滚轮 / 键盘左右键: 旋转 3D 结晶卡片仓</span></div>
        <div className="flex items-center gap-1"><Sparkles className="size-3 text-violet-400" /><span>双击焦点卡片: 3D 翻转卡片，查阅其证据与信度</span></div>
      </footer>

      {/* A. 3D 结晶卡片架 (3D Carousel Container) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="relative flex items-center justify-center"
          style={{
            perspective: "1000px",
            width: "360px",
            height: "240px",
          }}
        >
          <div
            className="relative flex items-center justify-center transition-transform duration-700 ease-out"
            style={{
              transformStyle: "preserve-3d",
              width: "100%",
              height: "100%",
              transform: `rotateY(${carouselAngle}deg)`,
            }}
          >
            {facts.map((fact, index) => {
              const theta = 360 / totalCards;
              const angle = index * theta;
              const isSelected = index === activeCardIndex;
              const cardColor = CATEGORY_COLORS[fact.category] ?? "rgba(147, 197, 253, 1)";

              return (
                <div
                  key={fact.id}
                  onClick={() => handleCardClick(index)}
                  className="absolute pointer-events-auto cursor-pointer transition-transform duration-500"
                  style={{
                    transformStyle: "preserve-3d",
                    width: "280px",
                    height: "180px",
                    // 每一个卡片绕 Y 轴旋转不同的偏角，然后向屏幕外 translation
                    transform: `rotateY(${angle}deg) translateZ(${Math.max(220, totalCards * 22)}px)`,
                    backfaceVisibility: "visible",
                    zIndex: isSelected ? 200 : Math.round(100 - Math.abs(index - activeCardIndex) * 10),
                  }}
                >
                  {/* Glassmorphic 3D Card shell */}
                  <div
                    className="relative w-full h-full transition-transform duration-700 ease-out"
                    style={{
                      transformStyle: "preserve-3d",
                      transform: isSelected && isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                    }}
                  >
                    {/* CARD FRONT — 正面: 事实关系组 */}
                    <div
                      className={`absolute inset-0 rounded-2xl p-4 flex flex-col justify-between select-none bg-slate-900/60 border backdrop-blur-lg shadow-2xl transition-all duration-300 ${
                        isSelected
                          ? "border-white/20 shadow-[0_0_25px_rgba(255,255,255,0.15)] ring-1 ring-white/10"
                          : "border-white/5 bg-slate-900/40 opacity-40 hover:opacity-60 grayscale hover:grayscale-0"
                      }`}
                      style={{
                        backfaceVisibility: "hidden",
                        borderColor: isSelected ? cardColor.replace("1)", "0.3") : "rgba(255,255,255,0.05)",
                        boxShadow: isSelected ? `0 0 30px ${cardColor.replace("1)", "0.2")}` : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: cardColor.replace("1)", "0.15"), color: cardColor }}>
                          {CATEGORY_LABELS[fact.category] ?? fact.category}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {fact.layer === "canon" && <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-amber-500/10 text-[9px] px-1 py-0 h-4 shrink-0">正史</Badge>}
                          {fact.layer === "dynamic" && <Badge variant="secondary" className="bg-pink-500/10 text-pink-500 border-pink-500/10 text-[9px] px-1 py-0 h-4 shrink-0">动态</Badge>}
                        </div>
                      </div>

                      {/* 核心事实组展示 */}
                      <div className="my-auto space-y-1 p-1">
                        <div className="text-xs font-semibold text-sky-200 truncate">{fact.subject}</div>
                        <div className="text-[10px] text-muted-foreground/80 italic pl-2 border-l border-white/10">{fact.predicate}</div>
                        <div className="text-xs font-semibold text-indigo-200 truncate pl-2">{fact.object.length > 50 ? fact.object.slice(0, 50) + "..." : fact.object}</div>
                      </div>

                      <div className="flex items-center justify-between text-[9px] text-muted-foreground/60 border-t border-white/5 pt-2">
                        <span>信度: {(fact.confidence * 100).toFixed(0)}%</span>
                        {fact.sourceChapter && <span>出处: 第 {fact.sourceChapter} 章</span>}
                      </div>
                    </div>

                    {/* CARD BACK — 反面: 证据链和可信度明细 */}
                    <div
                      className="absolute inset-0 rounded-2xl p-4 flex flex-col justify-between bg-slate-900/90 border border-pink-500/30 backdrop-blur-xl shadow-2xl"
                      style={{
                        transform: "rotateY(180deg)",
                        backfaceVisibility: "hidden",
                        boxShadow: `0 0 35px ${cardColor.replace("1)", "0.25")}`,
                      }}
                    >
                      <div className="flex items-center justify-between border-b border-white/5 pb-1.5 shrink-0">
                        <span className="text-[10px] font-semibold text-pink-400 flex items-center gap-1">
                          <Database className="size-3" />
                          记忆出处 / 证据文本
                        </span>
                        <span className="text-[9px] text-muted-foreground">出处: {fact.sourceType}</span>
                      </div>

                      {/* 证据文本段落 */}
                      <div className="flex-1 min-h-0 overflow-y-auto my-1.5 p-1 text-[10px] text-muted-foreground/90 whitespace-pre-wrap leading-relaxed italic">
                        {fact.evidenceText || fact.object || "暂无直接引用证据。"}
                      </div>

                      <div className="flex items-center justify-between text-[9px] border-t border-white/5 pt-1.5 text-muted-foreground/50 shrink-0">
                        <span>ID: {fact.id.slice(0, 15)}...</span>
                        <div className="flex items-center gap-1 text-pink-300">
                          <Info className="size-3" />
                          <span>双击翻回</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 右侧活动卡片浮动面板 (辅助查看) */}
      {activeFact && (
        <div className="absolute top-4 right-4 z-10 w-64 max-h-[calc(100%-40px)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 backdrop-blur-md shadow-2xl space-y-3 transition-opacity duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white truncate max-w-40">{activeFact.subject}</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-white/10 text-muted-foreground uppercase">{CATEGORY_LABELS[activeFact.category] ?? activeFact.category}</Badge>
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">测地线关系特征</p>
            <div className="text-xs text-sky-200 bg-white/5 rounded-lg p-2 font-mono break-all leading-relaxed">
              {activeFact.subject} <span className="text-pink-400 italic text-[10px] mx-1">({activeFact.predicate})</span> {activeFact.object.length > 120 ? activeFact.object.slice(0, 120) + "..." : activeFact.object}
            </div>
          </div>

          {activeFact.evidenceText && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">底层事实证据 (EVIDENCE)</p>
              <div className="text-[11px] leading-relaxed text-muted-foreground italic bg-slate-900/50 p-2.5 rounded-lg border border-white/5 max-h-36 overflow-y-auto whitespace-pre-wrap">
                "{activeFact.evidenceText}"
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-muted-foreground">
            <span>置信概率: {(activeFact.confidence * 100).toFixed(0)}%</span>
            <span>层级: {activeFact.layer === "canon" ? "正史" : "动态细节"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
