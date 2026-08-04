import { NextFunction, Request, Response } from "express";

interface EthersRevertError {
  code?: string;
  reason?: string | null;
  shortMessage?: string;
}

function isEthersRevertError(err: unknown): err is EthersRevertError {
  return typeof err === "object" && err !== null && "code" in err;
}

interface StatusCodedError {
  statusCode: number;
  message: string;
}

function hasStatusCode(err: unknown): err is StatusCodedError {
  return err instanceof Error && "statusCode" in err && typeof (err as StatusCodedError).statusCode === "number";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (hasStatusCode(err)) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (isEthersRevertError(err) && err.code === "CALL_EXCEPTION") {
    return res.status(409).json({ error: err.reason ?? "Blockchain transaction reverted" });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
