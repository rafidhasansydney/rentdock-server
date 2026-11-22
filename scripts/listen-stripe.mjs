import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli) || !config.stripeSecretKey) {
  console.error("Run npm.cmd --prefix server run stripe:listen after configuring the Stripe test key."); process.exit(1);
}
console.log("Starting the official Stripe test webhook forwarder. Keep this terminal open; Ctrl+C stops it.");
let ready = false, stopping = false;
const child = spawn(process.execPath, [npmCli, "exec", "--yes", "--package=@stripe/cli@1.55.14", "--", "stripe", "listen", "--forward-to", `http://127.0.0.1:${config.port}/api/payments/webhook`, "--events", "checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed", "--color", "off"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, STRIPE_API_KEY: config.stripeSecretKey } });
function stop() {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}
const startup = setTimeout(() => { if (!ready) { console.error("Stripe forwarding did not start within 60 seconds. Check network access and test-key permissions, then retry."); stop(); process.exitCode = 1; } }, 60000);
function line(value) {
  const text = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const secret = text.match(/\bwhsec_[A-Za-z0-9]+\b/)?.[0];
  if (secret && !ready) {
    const original = readFileSync(envFile, "utf8");
    const unchanged = original.match(/^STRIPE_WEBHOOK_SECRET=(.*)$/m)?.[1]?.trim() === secret;
    const next = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(original) ? original.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, `STRIPE_WEBHOOK_SECRET=${secret}`) : `${original.trimEnd()}\nSTRIPE_WEBHOOK_SECRET=${secret}\n`;
    if (!unchanged) writeFileSync(envFile, next, { mode: 0o600 });
    ready = true; clearTimeout(startup);
    console.log("Webhook signing key saved locally. No key values are displayed.");
    console.log(unchanged ? "Forwarding is ready. The signing key is unchanged; the running website can continue. Keep this listener open while testing payment." : "Forwarding is ready. Restart npm.cmd run dev in the website terminal, then leave this listener open while testing payment.");
    return;
  }
  const event = text.match(/\bcheckout\.session\.(?:completed|expired|async_payment_succeeded|async_payment_failed)\b/);
  if (event) console.log(`Received ${event[0]}`);
  const status = text.match(/\[(\d{3})\].*POST/);
  if (status) console.log(`Local webhook response: HTTP ${status[1]}`);
}
for (const stream of [child.stdout, child.stderr]) {
  let buffer = "";
  stream.on("data", chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    if (buffer.length > 100000) { console.error("Unexpected Stripe CLI output. Forwarding stopped."); stop(); }
  });
}
child.on("error", () => { clearTimeout(startup); console.error("Could not launch the Stripe CLI. Check npm and network access."); process.exitCode = 1; });
child.on("close", code => { clearTimeout(startup); if (!stopping && code !== 0) { console.error(`Stripe forwarding stopped (exit ${code}). Check test-key permissions, sandbox expiry and network access.`); process.exitCode = 1; } });
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
