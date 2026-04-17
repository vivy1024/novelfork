/**
 * Hooks Countdown API
 * 伏笔倒计时系统 API
 */

import { Router } from "express";
import type { RouterContext } from "./context.js";
import { asyncHandler } from "../errors.js";
import type { StoredHook } from "@inkos/core/state/memory-db";

export function createHooksCountdownRouter(ctx: RouterContext): Router {
  const router = Router();

  /**
   * GET /api/hooks/:bookId
   * 获取书籍的所有伏笔（含倒计时计算）
   */
  router.get(
    "/:bookId",
    asyncHandler(async (req, res) => {
      const { bookId } = req.params;
      const book = ctx.workspace.getBook(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      const db = book.getMemoryDB();
      const allHooks = db.getAllHooks();
      const currentChapter = book.chaptersWritten;

      // 计算倒计时和状态
      const enrichedHooks = allHooks.map((hook) => {
        const remainingChapters =
          hook.expectedResolveChapter !== undefined
            ? hook.expectedResolveChapter - currentChapter
            : null;

        const isOverdue =
          remainingChapters !== null && remainingChapters < 0;

        const computedStatus = isOverdue ? "overdue" : hook.status;

        return {
          id: hook.hookId,
          description: hook.expectedPayoff,
          plantedAt: hook.startChapter,
          expectedResolveAt: hook.expectedResolveChapter ?? null,
          status: computedStatus,
          remainingChapters,
          type: hook.type,
          lastAdvancedChapter: hook.lastAdvancedChapter,
          payoffTiming: hook.payoffTiming,
          notes: hook.notes,
        };
      });

      res.json({ hooks: enrichedHooks, currentChapter });
    })
  );

  /**
   * POST /api/hooks/:bookId
   * 创建新伏笔
   */
  router.post(
    "/:bookId",
    asyncHandler(async (req, res) => {
      const { bookId } = req.params;
      const book = ctx.workspace.getBook(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      const {
        hookId,
        description,
        expectedResolveChapter,
        type = "plot",
        notes = "",
      } = req.body;

      if (!hookId) {
        return res.status(400).json({ error: "hookId is required" });
      }

      const db = book.getMemoryDB();
      const currentChapter = book.chaptersWritten;

      const newHook: StoredHook = {
        hookId,
        startChapter: currentChapter,
        type,
        status: "pending",
        lastAdvancedChapter: currentChapter,
        expectedPayoff: description || "",
        payoffTiming: expectedResolveChapter
          ? `第${expectedResolveChapter}章`
          : "",
        expectedResolveChapter,
        notes,
      };

      db.upsertHook(newHook);

      res.status(201).json({
        success: true,
        hook: {
          id: newHook.hookId,
          description: newHook.expectedPayoff,
          plantedAt: newHook.startChapter,
          expectedResolveAt: newHook.expectedResolveChapter ?? null,
          status: newHook.status,
          remainingChapters: expectedResolveChapter
            ? expectedResolveChapter - currentChapter
            : null,
        },
      });
    })
  );

  /**
   * PATCH /api/hooks/:bookId/:hookId
   * 更新伏笔状态
   */
  router.patch(
    "/:bookId/:hookId",
    asyncHandler(async (req, res) => {
      const { bookId, hookId } = req.params;
      const book = ctx.workspace.getBook(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      const db = book.getMemoryDB();
      const existingHook = db.getHookById(hookId);
      if (!existingHook) {
        return res.status(404).json({ error: "Hook not found" });
      }

      const { status, expectedResolveChapter, notes } = req.body;

      const updatedHook: StoredHook = {
        ...existingHook,
        status: status ?? existingHook.status,
        expectedResolveChapter:
          expectedResolveChapter !== undefined
            ? expectedResolveChapter
            : existingHook.expectedResolveChapter,
        notes: notes !== undefined ? notes : existingHook.notes,
        payoffTiming:
          expectedResolveChapter !== undefined
            ? `第${expectedResolveChapter}章`
            : existingHook.payoffTiming,
      };

      db.upsertHook(updatedHook);

      const currentChapter = book.chaptersWritten;
      const remainingChapters =
        updatedHook.expectedResolveChapter !== undefined
          ? updatedHook.expectedResolveChapter - currentChapter
          : null;

      res.json({
        success: true,
        hook: {
          id: updatedHook.hookId,
          description: updatedHook.expectedPayoff,
          plantedAt: updatedHook.startChapter,
          expectedResolveAt: updatedHook.expectedResolveChapter ?? null,
          status: updatedHook.status,
          remainingChapters,
        },
      });
    })
  );

  /**
   * DELETE /api/hooks/:bookId/:hookId
   * 删除伏笔
   */
  router.delete(
    "/:bookId/:hookId",
    asyncHandler(async (req, res) => {
      const { bookId, hookId } = req.params;
      const book = ctx.workspace.getBook(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      const db = book.getMemoryDB();
      const existingHook = db.getHookById(hookId);
      if (!existingHook) {
        return res.status(404).json({ error: "Hook not found" });
      }

      db.deleteHook(hookId);

      res.json({ success: true });
    })
  );

  /**
   * GET /api/hooks/:bookId/overdue
   * 获取过期伏笔
   */
  router.get(
    "/:bookId/overdue",
    asyncHandler(async (req, res) => {
      const { bookId } = req.params;
      const book = ctx.workspace.getBook(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      const db = book.getMemoryDB();
      const currentChapter = book.chaptersWritten;
      const overdueHooks = db.getOverdueHooks(currentChapter);

      const enriched = overdueHooks.map((hook) => ({
        id: hook.hookId,
        description: hook.expectedPayoff,
        plantedAt: hook.startChapter,
        expectedResolveAt: hook.expectedResolveChapter ?? null,
        status: "overdue",
        remainingChapters: hook.expectedResolveChapter
          ? hook.expectedResolveChapter - currentChapter
          : null,
      }));

      res.json({ hooks: enriched, currentChapter });
    })
  );

  return router;
}
