import { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Parses req.body against `schema`; on failure responds 400 with a readable message,
 * on success replaces req.body with the parsed (and coerced/defaulted) data. */
export function validate(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      return res.status(400).json({ error: message });
    }
    req.body = result.data;
    next();
  };
}
