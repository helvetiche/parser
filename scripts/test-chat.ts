import { chat } from "../lib/chat";

async function main() {
  const res = await chat([{ role: "user", content: "Hello" }]);
  console.log("Chatbot test:", res);
}

main();
