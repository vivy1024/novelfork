  /**
   * Execute hooks for a given pipeline stage
   */
  private async executeHook(stage: PipelineStage, ctx: HookContext): Promise<void> {
    try {
      await this.hookManager.execute(stage, ctx);
    } catch (e) {
      // Hooks should not block pipeline - log and continue
      this.config.logger?.error(`Hook execution failed at stage ${stage}: ${e}`);
    }
  }
