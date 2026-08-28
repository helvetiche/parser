import { app } from "../lib/firebase";
import { getDb, getDbPath } from "../lib/db/connection";

async function testSqliteConnection() {
  try {
    const db = getDb();
    const path = getDbPath();
    // Simple query - list candidates count
    const { candidates } = await import("../lib/db/schema");
    const rows = await db.select().from(candidates).limit(1);
    console.log(`SQLite connected: ${path} (${rows.length} sample rows)`);
    return true;
  } catch (error) {
    console.error("SQLite connection error:", error);
    return false;
  }
}

async function testFirebaseConnection() {
  try {
    if (!app) {
      throw new Error("Firebase app not initialized");
    }

    console.log("Firebase initialized successfully");
    console.log("App name:", app.name);
    console.log("Project ID:", app.options.projectId);
    return true;
  } catch (error) {
    console.error("Firebase connection error:", error);
    return false;
  }
}

async function testApiConnection(url: string) {
  try {
    const response = await fetch(url);
    console.log("API connected:", response.status);
    return response.ok;
  } catch (error) {
    console.error("API connection error:", error);
    return false;
  }
}

async function testOpenRouterConnection() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("OpenRouter connected: 200 OK");
      console.log("Response:", JSON.stringify(data.choices[0]?.message?.content || "No content"));
    } else {
      const errorData = await response.text();
      console.log("OpenRouter failed:", response.status);
      console.log("Error:", errorData);
    }
    return response.ok;
  } catch (error) {
    console.error("OpenRouter connection error:", error);
    return false;
  }
}

export { testFirebaseConnection, testApiConnection, testOpenRouterConnection, testSqliteConnection };
