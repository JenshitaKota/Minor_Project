import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("auth", () => {
  it("logs in with valid credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "test-operator@pharmachain.test", password: "demo1234" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("OPERATOR");
  });

  it("rejects an invalid password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "test-operator@pharmachain.test", password: "wrong" });

    expect(res.status).toBe(401);
  });

  it("rejects requests to protected routes without a token", async () => {
    const res = await request(app).get("/records");
    expect(res.status).toBe(401);
  });
});
