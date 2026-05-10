import type { StorageDatabase } from "../../../storage/db.js";
import { createQuestionnaireTemplateRepository } from "../../repositories/questionnaire-template-repo.js";
import type { BuiltinQuestionnaireTemplate } from "../../types.js";
import { validateQuestionnaireTemplate } from "../template-validator.js";
import { builtinQuestionnaireTemplates } from "./builtin.js";

const seedCreatedAt = new Date("2026-04-25T00:00:00.000Z");

export interface SeedQuestionnaireTemplatesResult {
  inserted: number;
  total: number;
}

export function loadBuiltinQuestionnaireTemplates(): BuiltinQuestionnaireTemplate[] {
  return builtinQuestionnaireTemplates.map((template) => ({
    ...template,
    genreTags: [...template.genreTags],
    questions: template.questions.map((question) => ({
      ...question,
      options: question.options ? [...question.options] : undefined,
      mapping: { ...question.mapping },
      dependsOn: question.dependsOn ? { ...question.dependsOn } : undefined,
    })),
  }));
}

export async function seedQuestionnaireTemplates(storage: StorageDatabase): Promise<SeedQuestionnaireTemplatesResult> {
  const repo = createQuestionnaireTemplateRepository(storage);
  let inserted = 0;
  for (const template of loadBuiltinQuestionnaireTemplates()) {
    validateQuestionnaireTemplate(template);
    const result = await repo.upsertBuiltin({
      id: template.id,
      version: template.version,
      genreTagsJson: JSON.stringify(template.genreTags),
      tier: template.tier,
      targetObject: template.targetObject,
      questionsJson: JSON.stringify(template.questions),
      isBuiltin: true,
      createdAt: seedCreatedAt,
    });
    if (result.inserted) inserted += 1;
  }
  return { inserted, total: builtinQuestionnaireTemplates.length };
}
