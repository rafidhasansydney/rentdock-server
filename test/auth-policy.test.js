import test from "node:test";
import assert from "node:assert/strict";
import { passwordError, profileError, publicUser } from "../src/auth/policy.js";

test("assignment password rules reject weak and oversized passwords", () => {
  for (const value of [undefined, "abcde", "abcdef", "ABCDEF", "Ab".repeat(65)]) assert.ok(passwordError(value));
  assert.equal(passwordError("Abc123"), null);
});

test("profile validation rejects permission escalation and credential-bearing photo URLs", () => {
  const profile = { name: "Rafid Hasan", image: "https://images.example/avatar.png" };
  assert.equal(profileError(profile, { registration: true }), null);
  for (const field of ["role", "suspended", "emailVerified", "id", "userId"]) assert.ok(profileError({ ...profile, [field]: "admin" }, { registration: true }));
  assert.ok(profileError({ ...profile, image: "https://name:password@images.example/a.png" }, { registration: true }));
  assert.ok(profileError({ ...profile, image: "javascript:alert(1)" }, { registration: true }));
  assert.equal(profileError({ phone: "+880 1712 345678", address: "Dhaka" }), null);
  assert.ok(profileError({ phone: "+1 1234567890" }));
});

test("public account output excludes authentication secrets and suspension internals", () => {
  const user = publicUser({ id: "u1", name: "Name", email: "user@example.com", role: "owner", password: "hidden", suspended: false, token: "private", createdAt: new Date(0) });
  assert.equal(user.role, "owner");
  assert.equal(user.phone, "");
  assert.doesNotMatch(JSON.stringify(user), /password|hidden|token|private|suspended/);
});
