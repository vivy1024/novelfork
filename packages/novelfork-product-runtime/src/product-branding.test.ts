import { describe, expect, test } from "bun:test";

import { novelForkProductIntegration } from "./index";

describe("产品品牌", () => {
	test("反馈入口指向 NovelFork 仓库，而不是上游 NarraFork", () => {
		const branding = novelForkProductIntegration.branding?.();
		expect(branding?.feedbackUrl).toBe("https://github.com/vivy1024/novelfork/issues");
		expect(branding?.feedbackUrl).not.toContain("NarraFork");
	});
});
