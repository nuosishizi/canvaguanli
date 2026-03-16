
const fs = require("fs");
const p = "C:/Users/newnew/canva-tools/backend/server.ts";
let code = fs.readFileSync(p, "utf8");

const registerEndpoint = `
app.post("/register-assets", async (req, res) => {
  const { creator, canvaId, templateName, assets } = req.body as {
    creator: string;
    canvaId: string;
    templateName: string;
    assets: Array<any>;
  };

  if (!Array.isArray(assets) || assets.length === 0) {
    res.status(400).json({ error: "No assets provided" });
    return;
  }

  try {
    const resolvedAssets: any[] = [];
    
    await Promise.all(assets.map(async (asset) => {
      let hash = "";
      let fileName = asset.label;
      
      if (asset.stagedId && stagedStore.has(asset.stagedId)) {
        const staged = stagedStore.get(asset.stagedId)!;
        hash = staged.hash;
        fileName = staged.fileName;
      } else {
        const assetRes = await fetch(asset.url);
        if (!assetRes.ok) return;
        const buffer = Buffer.from(await assetRes.arrayBuffer());
        
        const fallbackExt = asset.urlExt || (asset.assetType === "video" ? ".mp4" : ".jpg");
        const ext = guessExtension(assetRes.headers.get("content-type"), fallbackExt);
        const originalName = extractFileName(assetRes.headers.get("content-disposition"));
        fileName = originalName ? sanitizeFileName(originalName) : asset.label + ext;
        
        const tempFilePath = path.join(TEMP_DIR, randomUUID() + "_" + fileName);
        fs_sync.writeFileSync(tempFilePath, buffer);
        
        try {
          const pyScript = path.join(__dirname, "calculate_hash.py");
          hash = execSync(\`python "\${pyScript}" "\${tempFilePath}"\`).toString().trim();
        } catch (e) {
          console.warn("[register] phash calculation failed:", e);
        }
        
        fs_sync.unlinkSync(tempFilePath);
      }
      
      if (hash) {
        resolvedAssets.push({ hash, label: fileName, assetType: asset.assetType });
      }
    }));

    const pyDbScript = path.join(__dirname, "register_db.py");
    const jsonPath = path.join(TEMP_DIR, randomUUID() + "_register.json");
    fs_sync.writeFileSync(jsonPath, JSON.stringify({
      creator, canvaId, templateName, assets: resolvedAssets
    }));
    
    try {
       execSync(\`python "\${pyDbScript}" "\${jsonPath}"\`);
    } catch(dbErr: any) {
       console.error("DB error:", dbErr.toString());
       throw new Error("Local DB registration failed.");
    } finally {
       if (fs_sync.existsSync(jsonPath)) fs_sync.unlinkSync(jsonPath);
    }
    
    res.status(200).json({ success: true, count: resolvedAssets.length });
  } catch (err: any) {
    console.error("Failed to register assets:", err);
    res.status(500).json({ error: err.message });
  }
});
`;

code = code.replace(`app.listen(port, () => {`, registerEndpoint + `\napp.listen(port, () => {`);
fs.writeFileSync(p, code);

