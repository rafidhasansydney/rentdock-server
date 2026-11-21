export function notFound(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "This API route does not exist." } });
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.type === "entity.too.large" ? 413 : error.type === "entity.parse.failed" ? 400 : error.status === 403 ? 403 : 500;
  const message = status === 413 ? "The request body is too large." : status === 400 ? "The request body is not valid JSON." : status === 403 ? "This origin is not allowed." : "The request could not be completed.";
  if (status === 500) console.error("Request failed:", error.message);
  res.status(status).json({ error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : status === 400 ? "INVALID_JSON" : status === 403 ? "FORBIDDEN_ORIGIN" : "INTERNAL_ERROR", message } });
}
