
const fs = require("fs");
const p = "C:/Users/newnew/canva-tools/backend/server.ts";
let code = fs.readFileSync(p, "utf8");

code = code.replace(
  /throw new Error\("Local DB registration failed\."\);/,
  `const out = dbErr.stdout ? dbErr.stdout.toString() : "";
       const err = dbErr.stderr ? dbErr.stderr.toString() : dbErr.message;
       throw new Error("DB失败: " + err + " | " + out);`
);

fs.writeFileSync(p, code);

