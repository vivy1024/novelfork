import type { BuiltinQuestionnaireTemplate, QuestionnaireQuestion } from "../types.js";

const questionTypes = new Set(["single", "multi", "text", "ranged-number", "ai-suggest"]);
const targetObjects = new Set(["premise", "conflict", "world-model", "character-arc", "character", "setting"]);
const transforms = new Set(["identity", "join-comma", "parse-int", "ai-rewrite"]);

function assertQuestion(question: QuestionnaireQuestion, templateId: string): void {
  if (!/^[a-z0-9-]+$/u.test(question.id)) {
    throw new Error(`Invalid question id in ${templateId}: ${question.id}`);
  }
  if (!question.prompt.trim()) {
    throw new Error(`Question ${question.id} in ${templateId} is missing prompt.`);
  }
  if (!questionTypes.has(question.type)) {
    throw new Error(`Question ${question.id} in ${templateId} has unsupported type: ${question.type}`);
  }
  if ((question.type === "single" || question.type === "multi") && (!question.options || question.options.length === 0)) {
    throw new Error(`Question ${question.id} in ${templateId} requires options.`);
  }
  if (!question.mapping.fieldPath.trim()) {
    throw new Error(`Question ${question.id} in ${templateId} is missing mapping.fieldPath.`);
  }
  if (question.mapping.transform && !transforms.has(question.mapping.transform)) {
    throw new Error(`Question ${question.id} in ${templateId} has unsupported transform: ${question.mapping.transform}`);
  }
}

export function validateQuestionnaireTemplate(template: BuiltinQuestionnaireTemplate): void {
  if (!/^[a-z0-9-]+$/u.test(template.id)) {
    throw new Error(`Invalid questionnaire template id: ${template.id}`);
  }
  if (!template.version.trim()) {
    throw new Error(`Questionnaire template ${template.id} is missing version.`);
  }
  if (![1, 2, 3].includes(template.tier)) {
    throw new Error(`Questionnaire template ${template.id} has unsupported tier: ${template.tier}`);
  }
  if (!targetObjects.has(template.targetObject)) {
    throw new Error(`Questionnaire template ${template.id} has unsupported target object: ${template.targetObject}`);
  }
  if (template.genreTags.length === 0) {
    throw new Error(`Questionnaire template ${template.id} requires genre tags.`);
  }
  if (template.questions.length === 0) {
    throw new Error(`Questionnaire template ${template.id} requires questions.`);
  }
  const ids = new Set<string>();
  for (const question of template.questions) {
    assertQuestion(question, template.id);
    if (ids.has(question.id)) {
      throw new Error(`Duplicate question id in ${template.id}: ${question.id}`);
    }
    ids.add(question.id);
  }
}
