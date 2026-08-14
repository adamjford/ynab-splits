import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDatabase } from "../app/db/database.server";

const filename = process.env.DATABASE_PATH ?? "./data/ynab-splits.sqlite";
mkdirSync(dirname(filename), { recursive: true });
const db = createDatabase(filename);
db.close();
console.log(`Database ready at ${filename}`);
