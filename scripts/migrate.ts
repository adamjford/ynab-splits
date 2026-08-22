import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDatabase } from "../app/db/database.server";

const filename = process.env.DATABASE_PATH;
if (!filename) throw new Error("DATABASE_PATH is required; choose the development or production database explicitly");

mkdirSync(dirname(filename), { recursive: true });
const db = createDatabase(filename);
db.close();
console.log(`Database ready at ${filename}`);
