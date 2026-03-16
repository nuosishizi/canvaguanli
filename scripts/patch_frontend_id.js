
const fs = require("fs");
const p = "C:/Users/newnew/canva-tools/src/intents/design_editor/export_tools.tsx";
let code = fs.readFileSync(p, "utf8");

code = code.replace(
  `import { useState, useCallback, useRef } from "react";`,
  `import { useState, useCallback, useRef, useEffect } from "react";`
);

code = code.replace(
  `import { requestExport } from "@canva/design";`,
  `import { requestExport, getDesignMetadata } from "@canva/design";`
);

const effectCode = `  const [generatorInit, setGeneratorInit] = useState(false);
  useEffect(() => {
    if (!generatorInit) {
      getDesignMetadata().then((meta) => {
        const now = new Date();
        // Generate formatting like 202603151741003 (YYYYMMDDHHMMSS + random digit)
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        const msId = yyyy + mm + dd + hh + min + ss + Math.floor(Math.random() * 10);
        
        setCanvaId(msId);
        if (meta && meta.title) {
          setTemplateName(meta.title + "【" + msId + "】");
        } else {
          setTemplateName("未命名设计【" + msId + "】");
        }
        setGeneratorInit(true);
      }).catch((e) => console.warn("Failed to get design meta", e));
    }
  }, [generatorInit]);

`;

code = code.replace(
  `const [registering, setRegistering] = useState(false);`,
  `const [registering, setRegistering] = useState(false);\n\n${effectCode}`
);

fs.writeFileSync(p, code);

