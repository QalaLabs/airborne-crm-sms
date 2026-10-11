import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function main() {
  console.log("Reading courses from DB...");
  const courses = await prisma.course.findMany();
  console.log(`Found ${courses.length} courses.`);
  
  const jobs = await prisma.job.findMany();
  console.log(`Found ${jobs.length} jobs.`);
  
  const org = await prisma.organization.findFirst();
  console.log(`Org: ${org ? org.name : "none"}`);
  
  const dump = {
    organization: org,
    courses: courses,
    jobs: jobs
  };
  
  const outputPath = "C:\\Users\\pc\\.gemini\\antigravity\\brain\\64848318-9c88-41bf-b33f-0b01c969e301\\scratch\\db_dump.json";
  fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2), "utf-8");
  console.log(`Successfully written DB dump to ${outputPath}`);
}

main()
  .catch(e => {
    console.error("Error dumping DB:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
