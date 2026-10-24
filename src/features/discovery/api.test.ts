import { describe, expect, it } from "vitest";
import {
  AuthorizedScopeContractError,
  parseAuthorizedScope,
  parseAuthorizedScopePage,
} from "./api";

const scope = {
  scopeId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Office network",
  cidr: "192.0.2.0/24",
  status: "ACTIVE",
  createdByUserId: "14fb9d5d-b66a-454c-9fea-8dbdcc1c6ac7",
  createdAt: "2026-10-23T12:00:00Z",
  updatedAt: "2026-10-23T12:00:00Z",
  version: 0,
};

describe("Discovery API parsers", () => {
  it("accepts closed scope and page responses", () => {
    expect(parseAuthorizedScope(scope)).toEqual(scope);
    expect(parseAuthorizedScopePage({
      items: [scope], page: 0, size: 20, totalElements: 1, totalPages: 1,
    }).items).toEqual([scope]);
  });

  it("rejects extra fields and invalid status, UUID, timestamps, pagination, or CIDR", () => {
    expect(() => parseAuthorizedScope({ ...scope, secret: true })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, status: "PENDING" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, scopeId: "not-a-uuid" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, createdAt: "2026-10-23" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, createdAt: "2026-02-30T12:00:00Z" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, createdAt: "2026-01-01T24:00:00Z" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, cidr: "office.example" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, cidr: "999.999.999.999/99" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, cidr: "192.0.2.1/24" })).toThrow(AuthorizedScopeContractError);
    expect(() => parseAuthorizedScope({ ...scope, cidr: "2001:0db8::/64" })).toThrow(AuthorizedScopeContractError);
    expect(parseAuthorizedScope({ ...scope, cidr: "2001:db8::/64" }).cidr).toBe("2001:db8::/64");
    expect(() => parseAuthorizedScopePage({
      items: [scope], page: -1, size: 20, totalElements: 1, totalPages: 1,
    })).toThrow(AuthorizedScopeContractError);
  });
});
