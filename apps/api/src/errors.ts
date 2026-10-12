export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Sign in required.");
export const forbidden = (message = "Not allowed.") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
