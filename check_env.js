import "dotenv/config";
console.log("DATABASE_URL defined:", !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
    console.log("URL Starts with:", process.env.DATABASE_URL.substring(0, 10));
} else {
    console.log("ENV Content keys:", Object.keys(process.env));
}
