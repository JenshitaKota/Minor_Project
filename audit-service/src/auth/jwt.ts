import jwt from "jsonwebtoken";

export interface JwtPayload {
  userId: string;
  email: string;
  role: "ADMIN" | "OPERATOR" | "QA_MANAGER" | "AUDITOR";
}

const EXPIRES_IN = "8h";

// Signed with AUDIT_JWT_SECRET - a distinct secret from the main backend's JWT_SECRET.
// A token this service issues is never accepted by the main backend and vice versa;
// this is what makes the two services' auth genuinely independent rather than one
// trusting a credential minted by a process that could itself be compromised.
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.AUDIT_JWT_SECRET as string, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, process.env.AUDIT_JWT_SECRET as string) as JwtPayload;
}
