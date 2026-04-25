import type { StorageDatabase } from "../../storage/db.js";
import { createQuestionnaireResponseRepository } from "../repositories/questionnaire-response-repo.js";
import { createQuestionnaireTemplateRepository } from "../repositories/questionnaire-template-repo.js";
import type { QuestionnaireQuestion, QuestionnaireResponseRecord } from "../types.js";
import { applyQuestionnaireMappings, type QuestionnaireAnswers } from "./apply-mapping.js";

export interface SubmitQuestionnaireResponseInput {
  storage: StorageDatabase;
  bookId: string;
  templateId: string;
  responseId?: string;
  answers: QuestionnaireAnswers;
  answeredVia?: "author" | "ai-assisted";
  submittedAt?: Date;
  status?: "draft" | "submitted" | "skipped";
}

export interface SubmitQuestionnaireResponseResult {
  response: QuestionnaireResponseRecord;
  targetObjectId: string | null;
}

function parseQuestions(raw: string): QuestionnaireQuestion[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Questionnaire template questions_json must be an array.");
  return parsed as QuestionnaireQuestion[];
}

export async function submitQuestionnaireResponse(input: SubmitQuestionnaireResponseInput): Promise<SubmitQuestionnaireResponseResult> {
  const template = await createQuestionnaireTemplateRepository(input.storage).getById(input.templateId);
  if (!template) throw new Error(`Questionnaire template not found: ${input.templateId}`);
  const timestamp = input.submittedAt ?? new Date();
  const responseId = input.responseId ?? crypto.randomUUID();
  const status = input.status ?? "submitted";
  const questions = parseQuestions(template.questionsJson);

  const run = input.storage.sqlite.transaction(() => {
    const targetObjectId = status === "submitted"
      ? applyQuestionnaireMappings({
        sqlite: input.storage.sqlite,
        bookId: input.bookId,
        targetObject: template.targetObject,
        questions,
        answers: input.answers,
        timestamp,
      })
      : null;

    input.storage.sqlite.prepare(`
      INSERT INTO "questionnaire_response" (
        "id", "book_id", "template_id", "target_object_type", "target_object_id", "answers_json",
        "status", "answered_via", "created_at", "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("id") DO UPDATE SET
        "target_object_type" = excluded."target_object_type",
        "target_object_id" = excluded."target_object_id",
        "answers_json" = excluded."answers_json",
        "status" = excluded."status",
        "answered_via" = excluded."answered_via",
        "updated_at" = excluded."updated_at"
    `).run(
      responseId,
      input.bookId,
      input.templateId,
      template.targetObject,
      targetObjectId,
      JSON.stringify(input.answers),
      status,
      input.answeredVia ?? "author",
      timestamp.getTime(),
      timestamp.getTime(),
    );
    return targetObjectId;
  });

  const targetObjectId = run();
  const response = await createQuestionnaireResponseRepository(input.storage).getById(input.bookId, responseId);
  if (!response) throw new Error("Submitted questionnaire response could not be read back.");
  return { response, targetObjectId };
}
