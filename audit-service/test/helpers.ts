import request from "supertest";
import { app } from "../src/app";

export async function loginAs(role: "admin" | "operator" | "auditor"): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: `test-${role}@pharmachain.test`, password: "demo1234" });
  return res.body.token;
}

export function auth(token: string) {
  return `Bearer ${token}`;
}

/** Unique per call so parallel/repeated test runs never collide on unique constraints. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
