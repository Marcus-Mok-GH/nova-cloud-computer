import { describe, expect, it } from "vitest";
import { AiGatewayClientError } from "./aiGateway";
import {
  modelFailureDetail,
  redactModelCredentials,
} from "./modelFailureDetail";

describe("modelFailureDetail", () => {
  it("discloses a model failure's full error text", () => {
    const error = new AiGatewayClientError(
      "Gateway request failed (Provider overloaded · HTTP 503)",
      "unavailable"
    );
    expect(modelFailureDetail(error, "generic lead", "nova-pro")).toBe(
      "\n\nError details (nova-pro, unavailable):\nGateway request failed (Provider overloaded · HTTP 503)"
    );
  });

  it("keeps errors that never came from the model call out of the chat", () => {
    const wrapped = new Error(
      'Failed query: select "deploymentKey" from "site_deployments"'
    );
    expect(modelFailureDetail(wrapped, "generic lead", "nova-pro")).toBe("");
  });

  it("keeps deployment-internal failure kinds out of the chat", () => {
    const configuration = new AiGatewayClientError(
      "TOKENHARBOR_API_KEY is missing",
      "configuration"
    );
    expect(modelFailureDetail(configuration, "lead", "nova-pro")).toBe("");
    const stopped = new AiGatewayClientError(
      "This reply was stopped with /stop.",
      "stopped"
    );
    expect(modelFailureDetail(stopped, "lead", "nova-pro")).toBe("");
  });

  it("adds nothing when the lead already carries the same text", () => {
    const detail = "Your daily Nova credits are used up. They reset tomorrow.";
    const error = new AiGatewayClientError(detail, "credits_exhausted");
    expect(modelFailureDetail(error, `Lead. ${detail}`, "nova-pro")).toBe("");
  });

  it("caps a chatty provider's error text", () => {
    const error = new AiGatewayClientError("x".repeat(5_000), "client_error");
    const detail = modelFailureDetail(error, "lead", "nova-pro");
    expect(detail.length).toBeLessThan(700);
    expect(detail).toContain("Error details (nova-pro, client_error):");
  });
});

describe("redactModelCredentials", () => {
  it("hides Bearer lines and key-shaped values", () => {
    expect(
      redactModelCredentials(
        "Unauthorized: Bearer sk-abc123456789 rejected, api_key=tky-987654321"
      )
    ).toBe(
      "Unauthorized: Bearer [private credential] rejected, [private credential]"
    );
  });

  it("leaves ordinary error text untouched", () => {
    expect(redactModelCredentials("HTTP 503: upstream overloaded")).toBe(
      "HTTP 503: upstream overloaded"
    );
  });

  it("does not mangle short hyphenated words that only look like keys", () => {
    expect(
      redactModelCredentials("token-harbor failed over to key-rotation")
    ).toBe("token-harbor failed over to key-rotation");
  });
});
