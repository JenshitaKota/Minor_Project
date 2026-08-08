import bcrypt from "bcrypt";

// Only comparePassword is needed here - this service never creates or changes a
// password, it only independently verifies one against the bcrypt hash it reads
// (read-only) from the User table.
export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
