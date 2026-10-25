import { describe, expect, it } from "vitest";
import {
  AuthorizedScopeContractError,
  DiscoveryExecutorContractError,
  parseAuthorizedScope,
  parseAuthorizedScopePage,
  parseDiscoveryExecutor,
  parseDiscoveryExecutorConnection,
  parseDiscoveryExecutorPage,
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
const executor = {
  executorId: "95e086af-07d1-49b9-b570-2b9b52878770",
  name: "Office executor",
  scopeIds: [scope.scopeId],
  status: "PENDING",
  publicKeyRegistered: false,
  publicKeyFingerprint: null,
  createdByUserId: scope.createdByUserId,
  createdAt: "2026-10-24T12:00:00Z",
  updatedAt: "2026-10-24T12:00:00Z",
  version: 0,
};
const connection = {
  host: "sftp.example.internal",
  port: 2022,
  username: `discovery-executor-${executor.executorId}`,
  hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKg2VaOybk2P/sGQKcJkL7QWqLpzaxLfOjfPCsqSy5aL",
  hostKeyFingerprint: "SHA256:s5flX5trJMwyaxA/ME8Kyid8X3Q4XdOM487UdG7jOnA",
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

  it("accepts closed Discovery Executor and page responses", () => {
    expect(parseDiscoveryExecutor(executor)).toEqual(executor);
    expect(parseDiscoveryExecutor({
      ...executor,
      status: "ACTIVE",
      publicKeyRegistered: true,
      publicKeyFingerprint: connection.hostKeyFingerprint,
      version: 1,
    })).toMatchObject({ status: "ACTIVE", version: 1 });
    expect(parseDiscoveryExecutorPage({
      items: [executor], page: 0, size: 20, totalElements: 1, totalPages: 1,
    }).items).toEqual([executor]);
  });

  it("rejects invalid executor fields and inconsistent key state", () => {
    expect(() => parseDiscoveryExecutor({ ...executor, secret: true })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({ ...executor, executorId: "invalid" })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({ ...executor, scopeIds: [] })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({ ...executor, scopeIds: [scope.scopeId, scope.scopeId] })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({ ...executor, status: "REVOKED" })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({ ...executor, status: "ACTIVE" })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({ ...executor, version: 1 })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({
      ...executor, publicKeyRegistered: true, publicKeyFingerprint: null,
    })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutor({
      ...executor, publicKeyFingerprint: "SHA256:invalid",
    })).toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutorPage({
      items: [executor], page: 0, size: 51, totalElements: 1, totalPages: 1,
    })).toThrow(DiscoveryExecutorContractError);
  });

  it("accepts only the closed public Discovery SFTP connection", () => {
    expect(parseDiscoveryExecutorConnection(connection, executor.executorId)).toEqual(connection);
    expect(() => parseDiscoveryExecutorConnection({ ...connection, password: "secret" }, executor.executorId))
      .toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutorConnection({ ...connection, port: 0 }, executor.executorId))
      .toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutorConnection({ ...connection, username: "agent-value" }, executor.executorId))
      .toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutorConnection({
      ...connection,
      username: `discovery-executor-${scope.scopeId}`,
    }, executor.executorId))
      .toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutorConnection({ ...connection, hostKey: "ssh-rsa AAAA" }, executor.executorId))
      .toThrow(DiscoveryExecutorContractError);
    expect(() => parseDiscoveryExecutorConnection({ ...connection, hostKeyFingerprint: "SHA256:bad" }, executor.executorId))
      .toThrow(DiscoveryExecutorContractError);
  });
});
