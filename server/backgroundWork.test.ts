import { afterEach, describe, expect, it, vi } from "vitest";
import { trackBackgroundWork } from "./backgroundWork";

/**
 * Mirrors the key @vercel/functions uses to expose the request context
 * (see its get-context module): the runtime stores an accessor object under
 * this global symbol, and waitUntil reads `waitUntil` off the context.
 */
const requestContextSymbol = Symbol.for("@vercel/request-context");

function setVercelRequestContext(waitUntil: ((promise: Promise<unknown>) => void) | undefined) {
  Reflect.set(globalThis, requestContextSymbol, { get: () => ({ waitUntil }) });
}

describe("trackBackgroundWork", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, requestContextSymbol as symbol);
    vi.restoreAllMocks();
  });

  it("binds the promise to the Vercel request context via waitUntil", () => {
    const waitUntil = vi.fn();
    setVercelRequestContext(waitUntil);
    const work = Promise.resolve("done");
    trackBackgroundWork(work);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it("keeps fire-and-forget semantics when no request context exists", () => {
    Reflect.deleteProperty(globalThis, requestContextSymbol as symbol);
    const work = vi.fn(() => Promise.resolve("ok"));
    expect(() => trackBackgroundWork(work())).not.toThrow();
  });

  it("does not throw when the context has no waitUntil available", () => {
    setVercelRequestContext(undefined);
    expect(() => trackBackgroundWork(Promise.resolve(1))).not.toThrow();
  });
});
