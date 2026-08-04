import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/auth/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEMO_USERS = [
  { email: "admin@pharmachain.demo", name: "Ava Administrator", role: "ADMIN" as const },
  { email: "operator@pharmachain.demo", name: "Oscar Operator", role: "OPERATOR" as const },
  { email: "qa@pharmachain.demo", name: "Quinn QA-Manager", role: "QA_MANAGER" as const },
  { email: "auditor@pharmachain.demo", name: "Aria Auditor", role: "AUDITOR" as const },
];

const DEMO_PASSWORD = "demo1234";

async function main() {
  for (const demoUser of DEMO_USERS) {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {},
      create: { ...demoUser, passwordHash },
    });
    console.log(`Seeded ${demoUser.role}: ${demoUser.email} (password: ${DEMO_PASSWORD})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
