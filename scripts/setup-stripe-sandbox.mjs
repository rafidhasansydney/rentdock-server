import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { isStripeTestKey, readSandboxOutput } from "./lib/stripe-sandbox.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");

try {
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : readFileSync(resolve(root, ".env.example"), "utf8");
  const values = parseEnv(current);
  if (isStripeTestKey(values.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY)) {
    console.log("A Stripe test key is already configured. Next: npm.cmd --prefix server run stripe:check");
  } else {
    if (values.STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim()) throw new Error("An existing Stripe key is configured. Review it before creating another sandbox.");
    const npmCli = process.env.npm_execpath;
    if (!npmCli || !existsSync(npmCli)) throw new Error("Run this helper through npm.cmd --prefix server run stripe:setup.");
    console.log("Preparing an official Stripe test sandbox using the server repository's Git identity.");
    const output = await new Promise((resolveOutput, reject) => {
      const child = spawn(process.execPath, [npmCli, "exec", "--yes", "--package=@stripe/cli", "--", "stripe", "sandbox", "create", "--from-git", "--non-interactive"], {
        cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
      });
      let text = "";
      child.stdout.on("data", chunk => {
        text += chunk;
        if (text.length > 1000000) child.kill();
      });
      child.stderr.on("data", () => {});
      child.on("error", () => reject(new Error("Could not launch the official Stripe CLI setup.")));
      child.on("close", code => code === 0 ? resolveOutput(text) : reject(new Error(`Stripe sandbox setup did not finish (exit ${code}). Check registry access, Git identity and Stripe CLI availability.`)));
    });
    const sandbox = readSandboxOutput(output);
    const line = `STRIPE_SECRET_KEY=${sandbox.secret_key}`;
    const next = /^STRIPE_SECRET_KEY=.*$/m.test(current) ? current.replace(/^STRIPE_SECRET_KEY=.*$/m, line) : `${current.trimEnd()}\n${line}\n`;
    writeFileSync(envFile, next, { mode: 0o600 });
    writeFileSync(resolve(root, ".stripe-sandbox.json"), JSON.stringify({
      accountId: sandbox.account_id, claimUrl: sandbox.claim_url, expiresAt: sandbox.expires_at,
    }, null, 2), { mode: 0o600 });
    console.log("Stripe test key saved locally. No key values are displayed.");
    console.log("Sandbox ownership details saved in server/.stripe-sandbox.json. Claim the sandbox within 7 days to keep it.");
    console.log("Next: npm.cmd --prefix server run stripe:check");
  }
} catch {
  console.error("Stripe sandbox setup failed. No successful payment is claimed. Check normal-terminal internet access, the Git name/email, and official Stripe CLI sandbox support.");
  process.exitCode = 1;
}
