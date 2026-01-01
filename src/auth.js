import { betterAuth } from "better-auth";
import "dotenv/config";
import { pool } from "./db.js";
import { magicLink } from "better-auth/plugins";

export const auth = betterAuth({
  database: pool,
  trustedOrigins: ["http://localhost:5173"],
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, token, url }, request) => {
          console.log(`Generated magic link for ${email}: ${url}`);
        if (process.env.NODE_ENV !== "production") {
          console.log(`\n================ MAGIC LINK ================`);
          console.log(`To: ${email}`);
          console.log(`Link: ${url}`);
          console.log(`============================================\n`);
        } else {
          console.error(
            "Critical: Email transport not configured for production."
          );
        }
      },
    }),
  ],
});
