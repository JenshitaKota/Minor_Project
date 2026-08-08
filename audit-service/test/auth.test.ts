import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("audit-service auth - independent of the main backend's session", () => {
  it("lets an Auditor log in directly and sets its own audit_token cookie", async () => {
    const res = await request(app).post("/auth/login").send({ email: "test-auditor@pharmachain.test", password: "demo1234" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("AUDITOR");
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("audit_token="))).toBe(true);
    // Never sets a cookie literally named "token" - that's the main backend's cookie
    // name, and both run on localhost in dev, so a same-named cookie would clobber it.
    expect(cookies.some((c) => c.startsWith("token="))).toBe(false);
  });

  it("lets an Admin log in too", async () => {
    const res = await request(app).post("/auth/login").send({ email: "test-admin@pharmachain.test", password: "demo1234" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("ADMIN");
  });

  it("rejects a non-Auditor, non-Admin role even with a correct password", async () => {
    const res = await request(app).post("/auth/login").send({ email: "test-operator@pharmachain.test", password: "demo1234" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only auditor and admin/i);
  });

  it("rejects an incorrect password", async () => {
    const res = await request(app).post("/auth/login").send({ email: "test-auditor@pharmachain.test", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("blocks /auth/me without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the Auditor's own profile from /auth/me once authenticated", async () => {
    const login = await request(app).post("/auth/login").send({ email: "test-auditor@pharmachain.test", password: "demo1234" });
    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("test-auditor@pharmachain.test");
  });
});
