import { Hono } from "hono";
import { z } from "zod/v4";
import { requireAdmin, ValidationError } from "@vivy1024/narrafork-runtime-bridge";
import { bookRuntimeBindingService } from "../services/book-binding";

const projectQuerySchema = z.object({ projectId: z.string().trim().min(1) }).strict();
const upsertSchema = z
	.object({ projectId: z.string().trim().min(1), bookId: z.string().trim().min(1) })
	.strict();

export const novelRuntimeBindingRoutes = new Hono();

// This maintenance route can attach a controlled book to an arbitrary Runtime
// project, so it is intentionally limited to administrators. Product flows use
// the actor-bound claim/repair service instead of this generic escape hatch.
novelRuntimeBindingRoutes.use("*", requireAdmin);

novelRuntimeBindingRoutes.get("/", async (c) => {
	const parsed = projectQuerySchema.safeParse({ projectId: c.req.query("projectId") });
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(await bookRuntimeBindingService.getByProjectId(parsed.data.projectId));
});

novelRuntimeBindingRoutes.put("/", async (c) => {
	const parsed = upsertSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const user = c.get("user");
	return c.json(
		await bookRuntimeBindingService.upsert(parsed.data.projectId, parsed.data.bookId, user.sub),
	);
});

novelRuntimeBindingRoutes.delete("/", async (c) => {
	const parsed = projectQuerySchema.safeParse({ projectId: c.req.query("projectId") });
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json({
		deleted: await bookRuntimeBindingService.deleteByProjectId(parsed.data.projectId),
	});
});
