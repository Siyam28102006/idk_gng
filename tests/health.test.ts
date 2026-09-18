import { describe, expect, test } from "bun:test";
import { GET } from "../src/app/health/route";

describe("GET /health", () => {
  test("returns 200 with {status:ok}", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
