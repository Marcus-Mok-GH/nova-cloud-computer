import { describe, expect, it } from "vitest";
import { NOVA_PUBLIC_APP_URL } from "@shared/const";
import { isHtmlFileName, NOVA_BADGE_HTML, NOVA_BADGE_TEXT, withNovaBadge } from "./novaBadge";

describe("withNovaBadge", () => {
  it("injects a clickable badge before the closing body tag", () => {
    const html = "<html><body><h1>Hello</h1></body></html>";
    const result = withNovaBadge(html);
    expect(result).toContain(NOVA_BADGE_HTML);
    expect(result.indexOf(NOVA_BADGE_HTML)).toBeLessThan(result.indexOf("</body>"));
    expect(result).toContain(`href="${NOVA_PUBLIC_APP_URL}"`);
    expect(result).toContain(NOVA_BADGE_TEXT);
    expect(result).toContain("background:#f08a3c");
    expect(result).toContain("color:#21150e");
    expect(result).toContain("aria-hidden=\"true\">↗</span>");
    expect(result).toContain("border-radius:8px");
  });

  it("is idempotent", () => {
    const once = withNovaBadge("<html><body>Hi</body></html>");
    expect(withNovaBadge(once)).toBe(once);
  });

  it("leaves non-HTML and fragments untouched", () => {
    expect(withNovaBadge("hello world")).toBe("hello world");
    expect(withNovaBadge("<div>fragment</div>")).toBe("<div>fragment</div>");
  });

  it("recognises html file names only", () => {
    expect(isHtmlFileName("index.html")).toBe(true);
    expect(isHtmlFileName("PAGE.HTM")).toBe(true);
    expect(isHtmlFileName("style.css")).toBe(false);
  });
});
