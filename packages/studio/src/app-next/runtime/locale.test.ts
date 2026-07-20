import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RuntimeLocaleDocumentSync,
  publishRuntimeLocale,
  resetRuntimeLocale,
  toStudioLanguage,
} from "./locale";

afterEach(() => {
  cleanup();
  resetRuntimeLocale();
});

describe("Runtime locale adapter", () => {
  it("maps canonical and legacy Runtime values into the Studio string-table key", () => {
    expect(toStudioLanguage("en-US")).toBe("en");
    expect(toStudioLanguage("zh")).toBe("zh");
    expect(toStudioLanguage("unknown")).toBe("zh");
  });

  it("keeps only an in-memory mirror of the authenticated Runtime preference", () => {
    resetRuntimeLocale();
    expect(publishRuntimeLocale("en")).toBe("en");
    expect(publishRuntimeLocale("zh-Hans")).toBe("zh-CN");
  });

  it("projects the authenticated locale into the document without persisting a second setting", () => {
    publishRuntimeLocale("en");
    render(createElement(RuntimeLocaleDocumentSync));
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
