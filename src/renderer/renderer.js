import { cleanLinksForAI } from "./helpers/cleanLinksForAI.js";
const input = document.getElementById("input");
const webview = document.getElementById("webview");

input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;

  const goal = input.value;
  console.log("USER GOAL:", goal);

  runAgent(goal);
});

async function runAgent(goal) {
  // 1. ask webview for DOM snapshot
  console.log("run agent called")
  webview.send("extract-dom");

}
// 2. receive result
webview.addEventListener("ipc-message", (event) => {
  if (event.channel === "dom-data") {
    console.log("DOM:", event.args[0]);
    const data = event.args[0];
    console.log(cleanLinksForAI(data.links));
  }
});
