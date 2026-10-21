import { describe, expect, it } from "vitest";
import { HumanUserContractError, parseHumanUser } from "./api";

const validUser = {
  userId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  username: "support.user",
  status: "ACTIVE",
  roles: ["AUDITOR", "SUPPORT_TECHNICIAN"],
  createdAt: "2026-10-20T12:00:00Z",
};

describe("parseHumanUser", () => {
  it("accepts a closed response with deterministic explicit roles", () => {
    expect(parseHumanUser(validUser)).toEqual(validUser);
  });

  it("rejects extra fields, duplicates, and non-deterministic role order", () => {
    expect(() => parseHumanUser({ ...validUser, password: "secret" })).toThrow(HumanUserContractError);
    expect(() => parseHumanUser({ ...validUser, roles: ["AUDITOR", "AUDITOR"] })).toThrow(HumanUserContractError);
    expect(() => parseHumanUser({ ...validUser, roles: ["SUPPORT_TECHNICIAN", "AUDITOR"] })).toThrow(HumanUserContractError);
  });
});
