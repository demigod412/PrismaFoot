import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/lib/demo/generate";

const db = new PrismaClient();
seedDemo(db)
  .then(async () => {
    const n = await db.prediction.count({ where: { fixture: { provider: "DEMO" } } });
    console.log(`DEMO seeded: ${n} predictions (model dc-xg-cal-v1).`);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
