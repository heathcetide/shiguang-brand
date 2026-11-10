import { db, initDatabase } from "../src/storage/db.js";

initDatabase();
db.close();
