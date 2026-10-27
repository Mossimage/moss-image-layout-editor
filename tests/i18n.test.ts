import { describe, expect, it } from "vitest";
import { messages, pickLocale, t, type MessageKey } from "../src/i18n.ts";

describe("ui dictionaries", () => {
  it("uses the same keys in English and Chinese", () => {
    const enKeys = Object.keys(messages.en).sort();
    const zhKeys = Object.keys(messages.zh).sort();
    expect(zhKeys).toEqual(enKeys);
    for (const key of enKeys) {
      const messageKey = key as MessageKey;
      expect(messages.en[messageKey].length).toBeGreaterThan(0);
      expect(messages.zh[messageKey].length).toBeGreaterThan(0);
    }
  });

  it("prefers the URL language, then the saved choice, then the browser", () => {
    expect(pickLocale("zh", "en", "en-US")).toBe("zh");
    expect(pickLocale("en", "zh", "zh-CN")).toBe("en");
    expect(pickLocale(null, "zh", "en-US")).toBe("zh");
    expect(pickLocale(null, null, "zh-CN")).toBe("zh");
    expect(pickLocale("zh-Hans", null, "en")).toBe("zh");
    expect(pickLocale("fr", "de", "en-GB")).toBe("en");
    expect(pickLocale(null, null, "fr")).toBe("en");
  });

  it("fills placeholders without changing the surrounding words", () => {
    expect(t("en", "flash.canvasSet", { width: 800, height: 600 })).toBe("Canvas set to 800×600.");
    expect(t("zh", "flash.canvasSet", { width: 800, height: 600 })).toBe("画布已改为 800×600。");
    expect(t("en", "prompt.meta", { width: 1024, height: 1536, count: 1, unit: t("en", "unit.one") })).toBe(
      "1024×1536 · 1 item. Set that size in the image workflow. It is not part of the prompt.",
    );
  });
});
