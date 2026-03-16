
const fs = require("fs");
const p = "C:/Users/newnew/canva-tools/backend/server.ts";
let code = fs.readFileSync(p, "utf8");

// Remove everything from the first "app.post(\"/register-assets\"" up to "app.listen" and replace with a SINGLE instance
const startStr = "app.post(\"/register-assets\", async (req, res) => {";
const endStr = "app.listen(port, () => {";

const firstIdx = code.indexOf(startStr);
const endIdx = code.lastIndexOf(endStr);

if (firstIdx !== -1 && endIdx !== -1) {
  const block = code.substring(firstIdx, endIdx);
  
  // We can just keep the first instance of register-assets and crop out duplicates
  // Find the closing brace of the first block 
  // It ends right before the second "app.post("/register-assets""
  const secondIdx = code.indexOf(startStr, firstIdx + 10);
  if (secondIdx !== -1) {
      code = code.substring(0, secondIdx) + "\n" + code.substring(endIdx);
      fs.writeFileSync(p, code);
      console.log("Cleaned duplicate /register-assets");
  }
}

