import { betterAuth } from "better-auth";
import { pool } from "./db.js";

export const auth = betterAuth({
    database: pool,
    emailAndPassword: {
        enabled: true
    }
});
