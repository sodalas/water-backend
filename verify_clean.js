const email = "directive-test@example.com";
const baseUrl = "http://localhost:8000/api/auth";

async function verify() {
  console.log(`Sending magic link request for ${email}...`);
  try {
    const response = await fetch(`${baseUrl}/sign-in/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/app" }),
    });
    if (response.ok) {
      console.log("Request Success!");
    } else {
      console.error("Request Failed!", response.status);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}
verify();
