/**
 * EntityMentionExtension —— 正文里高亮经纬实体（角色 / 地点 / 势力 / 道具）的提及（T4.1）。
 *
 * - 名单来自叙事结构快照的实体（规范名 + 别名），由宿主传入；编辑器不自己取数。
 * - 按「最长匹配优先」在每个文本节点里找名字，同一处只标一个实体，避免「陈默」被「陈」截断。
 * - 只做装饰（Decoration.inline），不改文档内容，不影响保存与撤销。
 * - Ctrl / ⌘ + 点击高亮调用 onOpen(规范名)，由宿主打开只读资料卡；普通点击照常定位光标，不打断写作。
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface MentionEntity {
  /** 规范名：打开资料卡时用它。 */
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly entityType?: string;
}

export interface MentionMatch {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly entityType?: string;
}

interface NameIndex {
  /** 按长度从长到短排好的称呼 → 实体；长度相同按字典序，保证结果确定。 */
  readonly labels: readonly { readonly label: string; readonly entity: MentionEntity }[];
}

/** 单字称呼误报太多（「林」「山」），不参与高亮。 */
const MIN_LABEL_LENGTH = 2;

export function buildMentionIndex(entities: readonly MentionEntity[]): NameIndex {
  const seen = new Set<string>();
  const labels: { label: string; entity: MentionEntity }[] = [];
  for (const entity of entities) {
    for (const raw of [entity.name, ...(entity.aliases ?? [])]) {
      const label = raw?.trim();
      if (!label || label.length < MIN_LABEL_LENGTH || seen.has(label)) continue;
      seen.add(label);
      labels.push({ label, entity });
    }
  }
  labels.sort((a, b) => b.label.length - a.label.length || a.label.localeCompare(b.label));
  return { labels };
}

/** 在一段纯文本里找提及，返回相对偏移；已被更长称呼覆盖的位置不再匹配。 */
export function findMentionsInText(text: string, index: NameIndex): { start: number; end: number; entity: MentionEntity }[] {
  if (!text || index.labels.length === 0) return [];
  const taken = new Uint8Array(text.length);
  const found: { start: number; end: number; entity: MentionEntity }[] = [];
  for (const { label, entity } of index.labels) {
    let offset = 0;
    while (offset <= text.length - label.length) {
      const at = text.indexOf(label, offset);
      if (at === -1) break;
      let free = true;
      for (let i = at; i < at + label.length; i += 1) {
        if (taken[i]) { free = false; break; }
      }
      if (free) {
        taken.fill(1, at, at + label.length);
        found.push({ start: at, end: at + label.length, entity });
      }
      offset = at + label.length;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function findEntityMentions(doc: ProseMirrorNode, index: NameIndex): MentionMatch[] {
  const matches: MentionMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const hit of findMentionsInText(node.text, index)) {
      matches.push({
        from: pos + hit.start,
        to: pos + hit.end,
        name: hit.entity.name,
        ...(hit.entity.entityType ? { entityType: hit.entity.entityType } : {}),
      });
    }
  });
  return matches;
}

export const entityMentionPluginKey = new PluginKey<DecorationSet>("entity-mention");

export interface EntityMentionOptions {
  /** 读取当前名单；用函数而非值，名单变化时不必重建编辑器。 */
  readonly getEntities: () => readonly MentionEntity[];
  readonly onOpen?: (name: string) => void;
}

function buildDecorations(doc: ProseMirrorNode, entities: readonly MentionEntity[]): DecorationSet {
  if (entities.length === 0) return DecorationSet.empty;
  const index = buildMentionIndex(entities);
  return DecorationSet.create(doc, findEntityMentions(doc, index).map((match) => Decoration.inline(match.from, match.to, {
    class: "nf-entity-mention",
    "data-entity-name": match.name,
    ...(match.entityType ? { "data-entity-type": match.entityType } : {}),
    title: `${match.name}：Ctrl（⌘）+ 点击查看资料卡`,
  })));
}

/** 名单变化后派发这个 meta，插件重算装饰。 */
export const ENTITY_MENTION_REFRESH = "entity-mention-refresh";

export const EntityMentionExtension = Extension.create<EntityMentionOptions>({
  name: "entityMention",

  addOptions() {
    return { getEntities: () => [], onOpen: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: entityMentionPluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, options.getEntities()),
          apply: (tr, previous, _oldState, newState) => {
            if (tr.docChanged || tr.getMeta(ENTITY_MENTION_REFRESH)) {
              return buildDecorations(newState.doc, options.getEntities());
            }
            return previous;
          },
        },
        props: {
          decorations: (state) => entityMentionPluginKey.getState(state),
          handleClick: (view, pos, event) => {
            if (!options.onOpen) return false;
            if (!(event.ctrlKey || event.metaKey)) return false;
            const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".nf-entity-mention") : null;
            const name = target?.dataset.entityName;
            if (!name) return false;
            void view;
            void pos;
            options.onOpen(name);
            return true;
          },
        },
      }),
    ];
  },
});
