import { describe, it, expect, beforeEach } from "vitest";
import { registerPluginSection, getPluginSection, getRegisteredSectionKeys, clearPluginSections } from "./section-registry";

const Dummy = () => null;

describe("plugin section registry", () => {
  beforeEach(() => clearPluginSections());

  it("registers and retrieves a section component", () => {
    registerPluginSection("novel-writing-config", Dummy);
    expect(getPluginSection("novel-writing-config")).toBe(Dummy);
  });

  it("returns undefined for unknown key", () => {
    expect(getPluginSection("nope")).toBeUndefined();
  });

  it("lists registered keys", () => {
    registerPluginSection("a", Dummy);
    registerPluginSection("b", Dummy);
    expect(getRegisteredSectionKeys().sort()).toEqual(["a", "b"]);
  });

  it("overwrites on duplicate key", () => {
    const Other = () => null;
    registerPluginSection("k", Dummy);
    registerPluginSection("k", Other);
    expect(getPluginSection("k")).toBe(Other);
  });
});
