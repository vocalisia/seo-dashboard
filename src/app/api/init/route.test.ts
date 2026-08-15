import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initDB: vi.fn(),
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ initDB: mocks.initDB }));
vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));

import { POST } from "./route";

describe("init route contract", () => {
  beforeEach(() => {
    mocks.initDB.mockReset();
    mocks.requireApiSession.mockReset().mockResolvedValue({
      session: { user: { email: "tester@example.com" } },
      unauthorized: null,
    });
  });

  it("returns explicit success after initialization", async () => {
    mocks.initDB.mockResolvedValue(undefined);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Database initialized",
    });
  });

  it("returns success false with HTTP 500 when initialization fails", async () => {
    mocks.initDB.mockRejectedValue(new Error("Migration failed"));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Migration failed",
    });
  });

  it("preserves the authentication response", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.initDB).not.toHaveBeenCalled();
  });
});
