import { describe, expect, it } from "vitest";
import {
  FREE_DAILY_IMAGE_GENERATIONS,
  PLUS_DAILY_IMAGE_GENERATIONS,
  getImageGenerationPolicyForAccount,
} from "./db/imageQuotas";

describe("image generation allowance policy", () => {
  it("gives free accounts three images a day", () => {
    expect(getImageGenerationPolicyForAccount("user", "free")).toEqual({
      limit: FREE_DAILY_IMAGE_GENERATIONS,
      unlimited: false,
    });
    expect(FREE_DAILY_IMAGE_GENERATIONS).toBe(3);
  });

  it("raises Plus to ten images a day", () => {
    expect(getImageGenerationPolicyForAccount("user", "plus")).toEqual({
      limit: PLUS_DAILY_IMAGE_GENERATIONS,
      unlimited: false,
    });
    expect(PLUS_DAILY_IMAGE_GENERATIONS).toBe(10);
  });

  it("makes Pro unlimited", () => {
    expect(getImageGenerationPolicyForAccount("user", "paid")).toEqual({
      limit: null,
      unlimited: true,
    });
  });

  it("treats console operators as unlimited, matching the credit policy", () => {
    expect(getImageGenerationPolicyForAccount("admin", "free")).toEqual({
      limit: null,
      unlimited: true,
    });
    expect(getImageGenerationPolicyForAccount("developer", "free")).toEqual({
      limit: null,
      unlimited: true,
    });
  });
});
