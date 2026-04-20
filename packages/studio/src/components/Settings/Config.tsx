import React from "react";
import { ArrowRight, Database, Palette, SlidersHorizontal, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SettingsSection } from "../../routes";

interface ConfigProps {
  theme: "light" | "dark";
  onNavigateSection?: (section: SettingsSection) => void;
  variant?: "dialog" | "embedded";
}

const MIGRATED_SECTIONS: Array<{
  section: Extract<SettingsSection, "profile" | "appearance" | "editor" | "data">;
  label: string;
  description: string;
  icon: typeof User;
}> = [
  {
    section: "profile",
    label: "个人资料",
    description: "姓名、邮箱与 Git 身份已并入设置中心主导航。",
    icon: User,
  },
  {
    section: "appearance",
    label: "外观",
    description: "主题与字号跟随设置页的统一配置流。",
    icon: Palette,
  },
  {
    section: "editor",
    label: "编辑器",
    description: "自动保存、字体与行高以页内编辑器设置为准。",
    icon: SlidersHorizontal,
  },
  {
    section: "data",
    label: "数据管理",
    description: "导入、导出和备份入口已在设置页中收口。",
    icon: Database,
  },
];

export const Config = React.memo(function Config({ theme, onNavigateSection, variant = "dialog" }: ConfigProps) {
  void theme;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">配置入口已迁移到设置中心</h2>
          <p className="text-sm text-muted-foreground">
            主题、编辑器、个人资料、数据管理与新补上的运行控制字段，现都以 SettingsView 和同一份 /api/settings 用户配置为主事实源。
          </p>
        </div>
        <Badge variant={variant === "embedded" ? "default" : "secondary"}>
          {variant === "embedded" ? "当前页主入口" : "兼容入口"}
        </Badge>
      </div>

      <Card className="border-dashed bg-muted/20">
        <CardHeader>
          <CardTitle>旧弹窗不再持有独立设置数据</CardTitle>
          <CardDescription>
            这一块现在只负责承接迁移说明和剩余兼容能力，避免出现“只有弹窗才是真设置”的双轨状态。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {MIGRATED_SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.section} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-primary" />
                  {item.label}
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() => onNavigateSection?.(item.section)}
                  disabled={!onNavigateSection}
                >
                  前往{item.label}
                  <ArrowRight className="size-4" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-base">当前兼容容器保留范围</CardTitle>
          <CardDescription>
            这里主要承接系统状态与使用统计；供应商配置已转到管理中心的供应商页继续收口，不再作为设置页主入口的一部分。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
});
