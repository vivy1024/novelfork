import {
  Bell,
  Bot,
  Boxes,
  Cable,
  Cloud,
  Cpu,
  Database,
  HardDrive,
  Info,
  KeyRound,
  MonitorSmartphone,
  PackageCheck,
  Palette,
  ReceiptText,
  Search,
  Server,
  Shield,
  SquareTerminal,
  User,
  Users,
  Waypoints,
} from "lucide-react";

import type { SettingsSectionItem } from "../components/layouts";

export const SETTINGS_SECTION_IDS = [
  "profile",
  "security",
  "models",
  "agents",
  "notifications",
  "appearance",
  "gateway",
  "providers",
  "search",
  "proxy",
  "chapters",
  "server",
  "authentication",
  "users",
  "terminals",
  "devices",
  "storage",
  "dependencies",
  "runtime",
  "usage",
  "about",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface NovelForkSettingsSection extends SettingsSectionItem {
  readonly id: SettingsSectionId;
  readonly adminOnly: boolean;
}

export const SETTINGS_SECTIONS: readonly NovelForkSettingsSection[] = [
  { id: "profile", label: "个人资料", group: "个人设置", icon: User, adminOnly: false },
  { id: "security", label: "安全", group: "个人设置", icon: Shield, adminOnly: false },
  { id: "models", label: "模型", group: "个人设置", icon: Cpu, adminOnly: false },
  { id: "agents", label: "AI 代理", group: "个人设置", icon: Bot, adminOnly: false },
  { id: "notifications", label: "通知", group: "个人设置", icon: Bell, adminOnly: false },
  { id: "appearance", label: "外观与界面", group: "个人设置", icon: Palette, adminOnly: false },
  { id: "gateway", label: "消息网关", group: "个人设置", icon: Waypoints, adminOnly: false },
  { id: "providers", label: "AI 供应商", group: "实例管理", icon: Cloud, adminOnly: true },
  { id: "search", label: "搜索", group: "实例管理", icon: Search, adminOnly: true },
  { id: "proxy", label: "代理管理", group: "实例管理", icon: Cable, adminOnly: true },
  { id: "chapters", label: "Chapter 与容器", group: "实例管理", icon: Boxes, adminOnly: true },
  { id: "server", label: "服务器与系统", group: "实例管理", icon: Server, adminOnly: true },
  { id: "authentication", label: "实例认证", group: "实例管理", icon: KeyRound, adminOnly: true },
  { id: "users", label: "用户", group: "实例管理", icon: Users, adminOnly: true },
  { id: "terminals", label: "终端", group: "实例管理", icon: SquareTerminal, adminOnly: true },
  { id: "devices", label: "设备", group: "实例管理", icon: MonitorSmartphone, adminOnly: true },
  { id: "storage", label: "存储空间", group: "实例管理", icon: HardDrive, adminOnly: true },
  { id: "dependencies", label: "外部依赖", group: "实例管理", icon: PackageCheck, adminOnly: true },
  { id: "runtime", label: "运行时环境", group: "实例管理", icon: Database, adminOnly: true },
  { id: "usage", label: "使用历史", group: "实例管理", icon: ReceiptText, adminOnly: true },
  { id: "about", label: "关于", group: "实例管理", icon: Info, adminOnly: true },
] as const;

const LEGACY_SETTINGS_SECTION_ALIASES: Readonly<Record<string, SettingsSectionId>> = {
  agent: "agents",
  "agent-hardening": "agents",
  "custom-subagents": "agents",
  mcp: "agents",
  skills: "agents",
  data: "storage",
  resources: "runtime",
  monitoring: "runtime",
};

export function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return Boolean(value && (SETTINGS_SECTION_IDS as readonly string[]).includes(value));
}

export function resolveSettingsSectionId(value: string | undefined): SettingsSectionId {
  if (isSettingsSectionId(value)) return value;
  return value ? (LEGACY_SETTINGS_SECTION_ALIASES[value] ?? "profile") : "profile";
}
