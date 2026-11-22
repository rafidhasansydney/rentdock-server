import { prepareApplication } from "./application.js";
export function createHostedHandler(initialize = prepareApplication) {
  let startup;
  function ready() {
    if (!startup) startup = Promise.resolve().then(initialize).catch(error => { startup = undefined; throw error; });
    return startup;
  }
  return async (req, res, next) => {
    let runtime;
    try { runtime = await ready(); }
    catch {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: { code: "SERVICE_STARTING", message: "RentDock is temporarily unavailable. Please try again shortly." } });
      return;
    }
    runtime.app(req, res, next);
  };
}
