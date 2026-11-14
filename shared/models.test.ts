import { describe, expect, it } from "vitest";
import {
  CHAT_EFFORT_OPTIONS,
  DEFAULT_CHAT_MODELS,
  effortOptionsForModel,
  effortOptionsForModelId,
  getChatModelById,
  getChatModels,
  FREE_CHAT_MODEL_ID,
} from "./models";

describe("shared model catalogue - effort options", () => {
  it("gives the built-in Nova models the full depth range", () => {
    const models = getChatModels();
    const lite = getChatModelById(FREE_CHAT_MODEL_ID, models)!;
    const ultra = getChatModelById("nova-ultra", models)!;
    expect(lite.efforts).toEqual(CHAT_EFFORT_OPTIONS);
    expect(ultra.efforts).toEqual(CHAT_EFFORT_OPTIONS);
  });

  it("maps nova-ultra to Pollinations MiniMax M3.1 Flash", () => {
    const ultra = getChatModelById("nova-ultra")!;
    expect(ultra.tier).toBe("pro");
    expect(ultra.upstreamModel).toBe("minimax/minimax-m3.1-flash");
  });

  it("offers only auto on external premium models", () => {
    const models = getChatModels();
    for (const id of ["deepseek-v4.1-flash", "gemini-3-pro", "grok-4.1"]) {
      expect(effortOptionsForModelId(id, models)).toEqual(["auto"]);
    }
  });

  it("always includes auto in a model's effort options", () => {
    for (const model of DEFAULT_CHAT_MODELS) {
      expect(effortOptionsForModel(model)).toContain("auto");
    }
  });

  it("falls back to the default model's options for an unknown id", () => {
    const models = getChatModels();
    expect(effortOptionsForModelId("nope", models)).toEqual(
      getChatModelById(FREE_CHAT_MODEL_ID, models)!.efforts
    );
  });

  it("normalises an env-supplied effort list down to the known ids", () => {
    const json = JSON.stringify(
      DEFAULT_CHAT_MODELS.map(model => ({
        ...model,
        efforts:
          model.id === FREE_CHAT_MODEL_ID
            ? ["high", "max", "low", "high", "bogus"]
            : ["low", "auto"],
      }))
    );
    const models = getChatModels(json);
    const lite = getChatModelById(FREE_CHAT_MODEL_ID, models)!;
    // De-duped, order-preserving, unknown ids dropped, auto prepended.
    expect(lite.efforts).toEqual(["auto", "high", "max", "low"]);
  });

  it("rejects a catalogue without the free model and keeps its default efforts", () => {
    const json = JSON.stringify([
      {
        id: "nova-ultra",
        label: "Nova Ultra",
        description: "x",
        tier: "pro",
        upstreamModel: "minimax/minimax-m3.1-flash",
      },
    ]);
    const models = getChatModels(json);
    // The catalogue is rejected (no free model), so the defaults are used and
    // their efforts are guaranteed present.
    expect(getChatModelById(FREE_CHAT_MODEL_ID, models)?.efforts).toEqual(
      CHAT_EFFORT_OPTIONS
    );
    // The defaulted nova-ultra keeps the full built-in depth range.
    expect(effortOptionsForModelId("nova-ultra", models)).toEqual(
      CHAT_EFFORT_OPTIONS
    );
  });
});
