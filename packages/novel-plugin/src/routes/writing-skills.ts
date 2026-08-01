import { Hono } from "hono";

import {
  forkWritingSkillForEditing,
  getWritingSkillRawContentSync,
  loadWritingSkills,
  parseWritingSkill,
  removeAuthorWritingSkill,
  writeAuthorWritingSkill,
} from "../engine/writing-skills/loader.js";

export interface CreateWritingSkillsRouterOptions {
  /** 供测试注入；缺省使用当前作者的 home。 */
  readonly home?: string;
}

function normalizeSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toListItem(skill: Awaited<ReturnType<typeof loadWritingSkills>>[number]) {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    source: skill.source,
    mode: skill.mode,
    tags: skill.tags ?? [],
    version: skill.version ?? null,
    provenance: skill.provenance ?? null,
    editable: skill.source === "user",
  };
}

export function createWritingSkillsRouter(options: CreateWritingSkillsRouterOptions = {}): Hono {
  const app = new Hono();

  app.get("/api/writing-skills", async (c) => {
    const skills = await loadWritingSkills(options.home);
    return c.json({ skills: skills.map(toListItem) });
  });

  app.get("/api/writing-skills/:slug", async (c) => {
    const slug = c.req.param("slug");
    const skill = (await loadWritingSkills(options.home)).find((candidate) => candidate.slug === slug);
    if (!skill) {
      return c.json({
        error: "Writing Skill 不存在",
        explanation: `没有找到 slug 为「${slug}」的 Writing Skill。请刷新列表后重试。`,
      }, 404);
    }
    return c.json({
      skill: {
        ...toListItem(skill),
        body: skill.body,
        content: getWritingSkillRawContentSync(slug, options.home),
      },
    });
  });

  app.post("/api/writing-skills/:slug/fork", async (c) => {
    const slug = c.req.param("slug");
    const path = await forkWritingSkillForEditing(slug, options.home);
    if (!path) {
      return c.json({
        error: "无法创建作者副本",
        explanation: `找不到「${slug}」的 SKILL.md 原文，无法创建可编辑副本。`,
      }, 404);
    }
    const skill = (await loadWritingSkills(options.home)).find((candidate) => candidate.slug === slug);
    return c.json({ path, skill: skill ? { ...toListItem(skill), editable: true } : null });
  });

  app.put("/api/writing-skills/:slug", async (c) => {
    const slug = c.req.param("slug");
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const content = typeof body?.content === "string" ? body.content : "";
    const parsed = parseWritingSkill(content, slug, "user");
    if (!parsed) {
      return c.json({
        error: "SKILL.md 格式不合法",
        explanation: "文件必须包含 name、description、可识别的 frontmatter 和非空 Markdown 正文。",
      }, 400);
    }
    const path = await writeAuthorWritingSkill(slug, content, options.home);
    return c.json({ ok: true, path, skill: { ...toListItem(parsed), editable: true } });
  });

  app.post("/api/writing-skills/import", async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const slug = normalizeSlug(body?.slug);
    const content = typeof body?.content === "string" ? body.content : "";
    if (!slug) {
      return c.json({
        error: "缺少有效 slug",
        explanation: "slug 会作为目录名，只能包含字母、数字、连字符和下划线。",
      }, 400);
    }
    const parsed = parseWritingSkill(content, slug, "user");
    if (!parsed) {
      return c.json({
        error: "SKILL.md 格式不合法",
        explanation: "导入内容必须包含 name、description、可识别的 frontmatter 和非空 Markdown 正文。",
      }, 400);
    }
    const existing = (await loadWritingSkills(options.home)).find((candidate) => candidate.slug === slug);
    if (existing?.source === "user" && body?.overwrite !== true) {
      return c.json({
        error: "作者目录中已存在同名 Skill",
        explanation: `「${existing.name}」已有作者副本；如需覆盖，请提交 overwrite=true。`,
      }, 409);
    }
    const path = await writeAuthorWritingSkill(slug, content, options.home);
    return c.json({ ok: true, path, skill: { ...toListItem(parsed), editable: true } }, 201);
  });

  app.delete("/api/writing-skills/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (!(await removeAuthorWritingSkill(slug, options.home))) {
      return c.json({
        error: "没有作者副本可恢复",
        explanation: `「${slug}」当前没有可删除的作者副本；内置 Skill 只能停用或 fork 后修改。`,
      }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
