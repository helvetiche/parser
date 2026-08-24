import { testFirebaseConnection, testOpenRouterConnection } from "./connection-check";

async function main() {
  console.log("--- Firebase Connection Test ---");
  const firebaseOk = await testFirebaseConnection();
  console.log(firebaseOk ? "PASS" : "FAIL");

  console.log("\n--- OpenRouter Connection Test ---");
  const openRouterOk = await testOpenRouterConnection();
  console.log(openRouterOk ? "PASS" : "FAIL");
}

main();
