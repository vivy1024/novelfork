/**
 * Pipeline event emitter for real-time visualization
 *
 * This module provides a simple event system for pipeline stages to emit
 * progress updates that can be consumed by Studio's Pipeline Visualization.
 */

export interface PipelineStageUpdate {
  readonly runId: string;
  readonly stageName: string;
  readonly status: "waiting" | "running" | "completed" | "failed";
  readonly agent?: string;
  readonly model?: string;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly error?: string;
}

export interface PipelineRunStart {
  readonly runId: string;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly chapterNumber: number;
}

export interface PipelineRunComplete {
  readonly runId: string;
  readonly status: "completed" | "failed";
  readonly error?: string;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

export type PipelineEvent =
  | { type: "run:start"; data: PipelineRunStart }
  | { type: "stage:update"; data: PipelineStageUpdate }
  | { type: "run:complete"; data: PipelineRunComplete };

class PipelineEventEmitter {
  private handlers: PipelineEventHandler[] = [];

  on(handler: PipelineEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index !== -1) {
        this.handlers.splice(index, 1);
      }
    };
  }

  emit(event: PipelineEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Pipeline event handler error:", error);
      }
    }
  }

  clear(): void {
    this.handlers = [];
  }
}

export const pipelineEvents = new PipelineEventEmitter();
