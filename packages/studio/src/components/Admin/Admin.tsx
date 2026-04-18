/**
 * Admin 管理面板
 * 用户管理、API 供应商管理、资源监控、请求历史
 */

import { useState } from "react";
import { Users, Server, Activity, FileText } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { ProvidersTab } from "./ProvidersTab";
import { ResourcesTab } from "./ResourcesTab";
import { RequestsTab } from "./RequestsTab";

type TabType = "users" | "providers" | "resources" | "requests";

interface AdminProps {
  onBack?: () => void;
}

export function Admin({ onBack }: AdminProps) {
  const [activeTab, setActiveTab] = useState<TabType>("users");

  const tabs = [
    { id: "users" as const, label: "用户管理", icon: Users },
    { id: "providers" as const, label: "API 供应商", icon: Server },
    { id: "resources" as const, label: "资源监控", icon: Activity },
    { id: "requests" as const, label: "请求历史", icon: FileText },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900" data-testid="admin-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">管理面板</h1>
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            返回
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "users" && <UsersTab />}
        {activeTab === "providers" && <ProvidersTab />}
        {activeTab === "resources" && <ResourcesTab />}
        {activeTab === "requests" && <RequestsTab />}
      </div>
    </div>
  );
}
