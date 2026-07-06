import { describe, expect, it } from "vitest";
import { createAppI18n, resolveInitialLang, supportedLangs } from "./i18n";

describe("resolveInitialLang", () => {
  it("uses a stored supported language first", () => {
    expect(resolveInitialLang({ storedLang: "ja", detectedLang: "zh-CN" })).toBe("ja");
  });

  it("uses the detected supported language when no stored language exists", () => {
    expect(resolveInitialLang({ storedLang: null, detectedLang: "ja" })).toBe("ja");
  });

  it("falls back to English for unsupported values", () => {
    expect(resolveInitialLang({ storedLang: "fr", detectedLang: "de" })).toBe("en");
  });
});

describe("createAppI18n", () => {
  it("creates an i18n instance with app translations", () => {
    const i18n = createAppI18n("ja");

    expect(i18n.lang).toBe("ja");
    expect(i18n.t("nav.providers")).toBe("プロバイダー");
    expect(i18n.t("language.ja")).toBe("日本語");
    expect(supportedLangs).toEqual(["en", "zh-CN", "ja"]);
  });
});
