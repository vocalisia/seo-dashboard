import { describe, expect, it } from "vitest";
import { isRecord, readApiJson } from "@/lib/api-response";

interface SuccessPayload {
  success: true;
}

function isSuccessPayload(payload: unknown): payload is SuccessPayload {
  return isRecord(payload) && payload.success === true;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("readApiJson", () => {
  it("accepts a successful HTTP response with the expected contract", async () => {
    await expect(
      readApiJson(jsonResponse({ success: true }), isSuccessPayload, "Échec"),
    ).resolves.toEqual({ success: true });
  });

  it("rejects an HTTP error even if its body claims success", async () => {
    await expect(
      readApiJson(
        jsonResponse({ success: true }, 500),
        isSuccessPayload,
        "Échec",
      ),
    ).rejects.toThrow("Échec (HTTP 500)");
  });

  it("rejects a false success carried by HTTP 200", async () => {
    await expect(
      readApiJson(
        jsonResponse({ success: false, error: "Échec interne" }),
        isSuccessPayload,
        "Échec",
      ),
    ).rejects.toThrow("Échec interne");
  });

  it("rejects a malformed JSON response", async () => {
    const response = new Response("not-json", { status: 200 });
    await expect(
      readApiJson(response, isSuccessPayload, "Échec"),
    ).rejects.toThrow("réponse JSON invalide");
  });
});
