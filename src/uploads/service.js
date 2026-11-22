import { createHash, randomUUID } from "node:crypto";
export const maxImageBytes = 3 * 1024 * 1024;
export const imageTypes = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export function imageError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function validateImage(bytes, declaredType) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > maxImageBytes) throw imageError("Choose a JPG, PNG or WebP image up to 3 MB.");
  let actual;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) actual = "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) actual = "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") actual = "image/webp";
  if (!actual || actual !== declaredType) throw imageError("The file does not match its image type. Choose a JPG, PNG or WebP image.");
  return actual;
}
export function createImageUploadService({ database, settings, request = fetch, clock = () => Date.now() }) {
  const enabled = Boolean(settings.imgbbApiKey);
  async function consume(userId, address) {
    const db = await database.connect();
    const now = clock();
    const bucket = Math.floor(now / 600000);
    const digest = createHash("sha256").update(userId ? `user:${userId}` : `ip:${address}`).digest("hex");
    const limits = db.collection("uploadLimits");
    async function increment(id, expiresAt) {
      const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt } };
      const options = { returnDocument: "after", includeResultMetadata: false };
      try { return await limits.findOneAndUpdate({ _id: id }, update, { ...options, upsert: true }); }
      catch (error) {
        if (error.code !== 11000) throw error;
        return limits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, options);
      }
    }
    const entries = await Promise.all([
      increment(`${bucket}:${digest}`, new Date((bucket + 2) * 600000)),
      increment(`daily:${Math.floor(now / 86400000)}`, new Date(now + 2 * 86400000)),
    ]);
    if (entries[0].count > (userId ? 20 : 6) || entries[1].count > 200) throw imageError("Image upload limit reached. Please try again later.", 429);
  }
  return {
    enabled,
    async ensureIndexes() { await (await database.connect()).collection("uploadLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); },
    async upload({ bytes, type, userId, address }) {
      if (!enabled) throw imageError("Image upload is currently unavailable. Please try again later.", 503);
      validateImage(bytes, type);
      await consume(userId, address);
      const form = new FormData();
      form.append("key", settings.imgbbApiKey);
      form.append("image", new Blob([bytes], { type }), `photo.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`);
      let body;
      try {
        const response = await request("https://api.imgbb.com/1/upload", { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error("Upload rejected");
        body = await response.json();
        const url = new URL(body.data?.url);
        if (!body.success || url.protocol !== "https:" || url.hostname !== "i.ibb.co" || url.username || url.password) throw new Error("Invalid image response");
      } catch { throw imageError("The image could not be uploaded. Please try again.", 502); }
      const id = randomUUID();
      const url = new URL(body.data.url).href;
      await (await database.connect()).collection("imageUploads").insertOne({ _id: id, userId: userId ?? null, url, createdAt: new Date(clock()) });
      return { id, url };
    },
  };
}
