import { testFirebaseConnection, testOpenRouterConnection, testSqliteConnection } from "./connection-check";

async function main() {
  console.log("--- SQLite Connection Test ---");
  const sqliteOk = await testSqliteConnection();
  console.log(sqliteOk ? "PASS" : "FAIL");

  console.log("\n--- Firebase Connection Test (Auth only) ---");
  const firebaseOk = await testFirebaseConnection();
  console.log(firebaseOk ? "PASS" : "FAIL");

  console.log("\n--- OpenRouter Connection Test ---");
  const openRouterOk = await testOpenRouterConnection();
  console.log(openRouterOk ? "PASS" : "FAIL");
}

main();
