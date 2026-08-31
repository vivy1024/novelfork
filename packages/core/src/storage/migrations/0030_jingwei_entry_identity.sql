-- P0.5: entry_key + source_refs_json —— 经纬条目确定性身份与来源引用。
--
-- entry_key:       同一 book 内的人类可读稳定标识（category/normalized-title 格式）。
--                  不加唯一约束——允许重复，由上层业务按需去重。
-- source_refs_json: 结构化来源引用 [{chapterNumber, excerpt}]，只从已有可信数据复制，不伪造。

-- Step 1: 新增两列
ALTER TABLE "story_jingwei_entry" ADD COLUMN "entry_key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "story_jingwei_entry" ADD COLUMN "source_refs_json" TEXT NOT NULL DEFAULT '[]';

-- Step 2: 普通索引（非唯一）
CREATE INDEX IF NOT EXISTS "story_jingwei_entry_book_entry_key_idx"
  ON "story_jingwei_entry" ("book_id", "entry_key");

-- Step 3: 确定性回填 entry_key
--
-- 优先级：
--   A) chapter-summary 类条目 → chapter-summaries/ch<N>
--   B) 普通条目 → category/normalized-title（lower+trim, 空格→-）
--   C) 兜底 → legacy:<id>

-- A: chapter-summary 条目 —— 从 fields_json 提取 chapterNumber
UPDATE "story_jingwei_entry"
SET "entry_key" = 'chapter-summaries/ch' || CAST(
  json_extract("fields_json", '$.chapterNumber') AS INTEGER
)
WHERE "entry_key" = ''
  AND "category" IN ('chapter-summary', 'chapter-summaries')
  AND json_valid("fields_json") = 1
  AND json_extract("fields_json", '$.chapterNumber') IS NOT NULL;

-- B: 普通条目 —— category/normalized-title
UPDATE "story_jingwei_entry"
SET "entry_key" = LOWER(REPLACE(TRIM("category"), ' ', '-'))
  || '/'
  || LOWER(REPLACE(REPLACE(REPLACE(TRIM("title"), ' ', '-'), '　', '-'), '/', '_'))
WHERE "entry_key" = ''
  AND TRIM("title") <> '';

-- C: 兜底 —— legacy:<id>
UPDATE "story_jingwei_entry"
SET "entry_key" = 'legacy:' || "id"
WHERE "entry_key" = '';

-- Step 4: 合并 aliases
--   将 fields_json.aliases 中的条目合并到 aliases_json，去重。
--   仅处理 fields_json 有效 JSON 且含 aliases 数组、aliases_json 也有效的行。
--   SQLite 没有原生数组去重，使用 CTE + json_each 展开后 DISTINCT 再聚合。
UPDATE "story_jingwei_entry"
SET "aliases_json" = (
  SELECT '[' || GROUP_CONCAT(DISTINCT val_item) || ']'
  FROM (
    SELECT json_quote(value) AS val_item
    FROM json_each("story_jingwei_entry"."aliases_json")
    WHERE json_valid("story_jingwei_entry"."aliases_json") = 1
      AND json_type("story_jingwei_entry"."aliases_json") = 'array'
    UNION
    SELECT json_quote(value) AS val_item
    FROM json_each(json_extract("story_jingwei_entry"."fields_json", '$.aliases'))
    WHERE json_valid("story_jingwei_entry"."fields_json") = 1
      AND json_type(json_extract("story_jingwei_entry"."fields_json", '$.aliases')) = 'array'
  )
)
WHERE json_valid("fields_json") = 1
  AND json_type(json_extract("fields_json", '$.aliases')) = 'array'
  AND json_array_length(json_extract("fields_json", '$.aliases')) > 0;

-- Step 5: 复制可信 source_refs
--   仅从 fields_json 中已有的 sourceRefs / source_refs 字段复制，不伪造。
--   只处理有效 JSON 数组、且至少有一个元素的行。

-- 5a: fields_json.sourceRefs (camelCase，book-dissect 写入的格式)
UPDATE "story_jingwei_entry"
SET "source_refs_json" = json_extract("fields_json", '$.sourceRefs')
WHERE "source_refs_json" = '[]'
  AND json_valid("fields_json") = 1
  AND json_type(json_extract("fields_json", '$.sourceRefs')) = 'array'
  AND json_array_length(json_extract("fields_json", '$.sourceRefs')) > 0;

-- 5b: fields_json.source_refs (snake_case 变体)
UPDATE "story_jingwei_entry"
SET "source_refs_json" = json_extract("fields_json", '$.source_refs')
WHERE "source_refs_json" = '[]'
  AND json_valid("fields_json") = 1
  AND json_type(json_extract("fields_json", '$.source_refs')) = 'array'
  AND json_array_length(json_extract("fields_json", '$.source_refs')) > 0;
