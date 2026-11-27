import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import Faq from "./Faq";

/**
 * The public FAQ.
 *
 * The storage upgrade and the goodwill credits it caused are answered here
 * rather than left for the support bot alone: the landing page is not gated
 * during an outage, so it is the page a visitor actually reads.
 */
describe("the public FAQ", () => {
  it("asks why Nova was down", () => {
    const markup = renderToStaticMarkup(<Faq />);
    expect(markup).toContain("Was Nova down?");
  });

  it("answers it with the credits that were credited for it", () => {
    // The answer lives in a collapsed accordion, so the rendered markup does
    // not carry it. Assert the copy itself: the number and the fact that the
    // credits never expire are the two things a reader needs.
    const source = readFileSync(
      path.resolve(process.cwd(), "client/src/i18n/en.ts"),
      "utf8"
    );
    expect(source).toContain('"landing.faq.a7"');
    expect(source).toMatch(/1,000 credits/);
    expect(source).toMatch(/never expire/);
  });
});
