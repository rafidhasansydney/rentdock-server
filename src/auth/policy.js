export const roles = Object.freeze(["customer", "owner", "admin"]);

export function passwordError(value) {
  if (typeof value !== "string" || value.length < 6 || value.length > 128) return "Use a password between 6 and 128 characters.";
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) return "Include at least one uppercase and one lowercase letter.";
  return null;
}

export function profileError(body, { registration = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Enter valid profile details.";
  if (registration || body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80) return "Enter a name between 2 and 80 characters.";
  }
  if (registration || body.image !== undefined) {
    if (typeof body.image !== "string" || body.image.length > 2048) return "Enter a valid HTTPS photo URL.";
    try {
      const photo = new URL(body.image);
      if (photo.protocol !== "https:" || photo.username || photo.password) return "Use an HTTPS photo URL without credentials.";
    } catch {
      return "Enter a valid HTTPS photo URL.";
    }
  }
  if (body.phone !== undefined && (typeof body.phone !== "string" || (body.phone.trim() && !/^(?:\+?88)?01[3-9]\d{8}$/.test(body.phone.replace(/[\s()-]/g, ""))))) return "Enter a valid Bangladesh mobile number.";
  if (body.address !== undefined && (typeof body.address !== "string" || body.address.length > 500)) return "Keep the address within 500 characters.";
  for (const field of ["role", "suspended", "emailVerified", "id", "userId"]) {
    if (Object.hasOwn(body, field)) return "Account permissions and identity cannot be changed here.";
  }
  return null;
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: roles.includes(user.role) ? user.role : "customer",
    phone: user.phone ?? "",
    address: user.address ?? "",
    createdAt: user.createdAt,
  };
}
