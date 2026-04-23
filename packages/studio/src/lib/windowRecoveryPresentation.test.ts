import { describe, expect, it } from "vitest";
import {
  getRecoveryPresentation,
  getRecoveryToneBadgeClassName,
  getRecoveryToneBannerClassName,
} from "./windowRecoveryPresentation";

describe("getRecoveryPresentation", () => {
  it("presents the stable idle+online window as a positive success badge without banner", () => {
    const presentation = getRecoveryPresentation({ recoveryState: "idle", wsConnected: true });
    expect(presentation).toMatchObject({
      shortLabel: "实时同步",
      tone: "success",
      bannerVisible: false,
    });
  });

  it("surfaces an explicit offline notice when idle but disconnected", () => {
    const presentation = getRecoveryPresentation({ recoveryState: "idle", wsConnected: false });
    expect(presentation).toMatchObject({
      shortLabel: "离线",
      tone: "neutral",
      bannerVisible: true,
    });
  });

  it("returns transient info/warning tones for the four non-idle states", () => {
    expect(getRecoveryPresentation({ recoveryState: "recovering", wsConnected: true }).tone).toBe("info");
    expect(getRecoveryPresentation({ recoveryState: "reconnecting", wsConnected: false }).tone).toBe("warning");
    expect(getRecoveryPresentation({ recoveryState: "replaying", wsConnected: true }).tone).toBe("warning");
    expect(getRecoveryPresentation({ recoveryState: "resetting", wsConnected: true }).tone).toBe("danger");
  });

  it("keeps banner visibility truthy for every non-idle state", () => {
    for (const state of ["recovering", "reconnecting", "replaying", "resetting"] as const) {
      expect(getRecoveryPresentation({ recoveryState: state, wsConnected: true }).bannerVisible).toBe(true);
    }
  });

  it("returns distinct badge and banner class bundles per tone to keep visuals aligned", () => {
    const tones = ["success", "info", "warning", "danger", "neutral"] as const;
    const badges = new Set(tones.map((tone) => getRecoveryToneBadgeClassName(tone)));
    const banners = new Set(tones.map((tone) => getRecoveryToneBannerClassName(tone)));
    expect(badges.size).toBe(tones.length);
    expect(banners.size).toBe(tones.length);
  });
});
