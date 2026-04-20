/**
 * AI 提供商管理页面
 * 提供商列表（拖拽排序）、启用/禁用、配置、模型池展示
 */

import { useState, useEffect } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Search } from "lucide-react";
import { ProviderCard } from "../components/ProviderCard";
import { fetchJson } from "../hooks/use-api";
import type { ManagedProvider, ModelPoolEntry } from "../shared/provider-catalog";

interface ProviderManagerProps {
  onBack: () => void;
}

function SortableProviderCard({
  provider,
  onToggle,
  onConfigure,
  onTest,
}: {
  provider: ManagedProvider;
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (id: string) => void;
  onTest: (id: string) => Promise<{ success: boolean; latency?: number; error?: string }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button {...attributes} {...listeners} className="p-2 hover:bg-accent rounded cursor-grab active:cursor-grabbing">
        <GripVertical size={16} className="text-muted-foreground" />
      </button>
      <div className="flex-1">
        <ProviderCard provider={provider} onToggle={onToggle} onConfigure={onConfigure} onTest={onTest} />
      </div>
    </div>
  );
}

export function ProviderManager({ onBack }: ProviderManagerProps) {
  const [providers, setProviders] = useState<ManagedProvider[]>([]);
  const [modelPool, setModelPool] = useState<ModelPoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"providers" | "models">("providers");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadProviders();
    loadModelPool();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await fetchJson<{ providers: ManagedProvider[] }>("/api/providers");
      setProviders(data.providers);
    } catch (error) {
      console.error("Failed to load providers:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadModelPool = async () => {
    try {
      const data = await fetchJson<{ models: ModelPoolEntry[] }>("/api/providers/models");
      setModelPool(data.models);
    } catch (error) {
      console.error("Failed to load model pool:", error);
    }
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = providers.findIndex((p) => p.id === active.id);
      const newIndex = providers.findIndex((p) => p.id === over.id);

      const newProviders = arrayMove(providers, oldIndex, newIndex);
      setProviders(newProviders);

      // 保存新顺序到后端
      try {
        await fetchJson("/api/providers/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: newProviders.map((p) => p.id) }),
        });
      } catch (error) {
        console.error("Failed to reorder providers:", error);
        // 回滚
        loadProviders();
      }
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetchJson(`/api/providers/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      loadProviders();
    } catch (error) {
      console.error("Failed to toggle provider:", error);
    }
  };

  const handleConfigure = (id: string) => {
    // TODO: 打开配置弹窗
    console.log("Configure provider:", id);
  };

  const handleTest = async (id: string) => {
    try {
      const result = await fetchJson<{ success: boolean; latency?: number; error?: string }>(
        `/api/providers/${id}/test`,
        { method: "POST" }
      );
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Test failed",
      };
    }
  };

  const filteredProviders = providers.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredModels = modelPool.filter(
    (m) =>
      m.modelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.providerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground mb-2">
              ← Back
            </button>
            <h1 className="text-2xl font-serif">AI Providers</h1>
          </div>
          <button className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2">
            <Plus size={16} />
            Add Provider
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b">
          <button
            onClick={() => setActiveTab("providers")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "providers"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Providers ({providers.length})
          </button>
          <button
            onClick={() => setActiveTab("models")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "models"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Model Pool ({modelPool.length})
          </button>
        </div>

        {/* Search */}
        <div className="mt-4 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={activeTab === "providers" ? "Search providers..." : "Search models..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "providers" ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredProviders.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {filteredProviders.map((provider) => (
                  <SortableProviderCard
                    key={provider.id}
                    provider={provider}
                    onToggle={handleToggle}
                    onConfigure={handleConfigure}
                    onTest={handleTest}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="space-y-2">
            {filteredModels.map((model) => (
              <div
                key={model.modelId}
                className={`p-3 rounded-lg border ${model.enabled ? "bg-card" : "bg-muted/30"}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">{model.modelName}</h3>
                    <p className="text-xs text-muted-foreground">{model.providerName}</p>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs ${
                    model.enabled
                      ? "bg-green-500/20 text-green-600"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {model.enabled ? "Enabled" : "Disabled"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
