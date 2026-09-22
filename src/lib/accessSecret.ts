import { createHash, randomBytes, scryptSync } from "node:crypto";
/** Access-code hashing (server only; middleware never needs this). */
export type StoredCode = { salt: string; hash: string } | null;
export const hashOf = (code: string, salt: string) => scryptSync(code.normalize("NFKC"), salt, 32).toString("hex");
export const makeHash = (code: string) => { const salt = randomBytes(16).toString("hex"); return { salt, hash: hashOf(code, salt) }; };
/** Cookie-signing secret derived from the stored hash: changing the code signs every device out. */
export const secretFor = (s: StoredCode) => (s ? createHash("sha256").update(`${s.salt}:${s.hash}`).digest("hex") : "");
