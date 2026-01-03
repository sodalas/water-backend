import { betterAuth } from "better-auth";
import "dotenv/config";
import { pool } from "./db.js";
import { magicLink } from "better-auth/plugins";

if (!process.env.FRONTEND_ORIGIN) {
  throw new Error("FATAL: FRONTEND_ORIGIN is not defined.");
}

export const auth = betterAuth({
  database: pool,
  trustedOrigins: [process.env.FRONTEND_ORIGIN],
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, token, url }, request) => {
        if (process.env.NODE_ENV !== "production") {
          console.log("[AUTH] magicLink invoked for:", email);
          console.log("[AUTH] url:", url);
        } else {
          console.error(
            "Critical: Email transport not configured for production."
          );
        }
      },
    }),
  ],
});
