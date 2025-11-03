// scripts/generate_jwt.ts
// Uso: JWT_SECRET=... ts-node scripts/generate_jwt.ts <USER_ID> <email>
// Saída: token JWT válido por 7 dias.

import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error("ERR: defina JWT_SECRET no ambiente");
  process.exit(1);
}
const [userId, email] = process.argv.slice(2);
if (!userId) {
  console.error("Uso: ts-node scripts/generate_jwt.ts <USER_ID> <email>");
  process.exit(1);
}

const token = jwt.sign(
  email ? { email } : {},
  secret,
  { subject: String(userId), expiresIn: "7d" }
);

console.log(token);
