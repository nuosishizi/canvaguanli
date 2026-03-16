/* eslint-disable no-console */
import express from "express";
import JSZip from "jszip";
import { randomUUID, createHash } from "crypto";
import { execSync } from "child_process";
import path from "path";
import fs_sync from "fs";


const TEMP_DIR = path.join(__dirname, "temp");
if (!fs_sync.existsSync(TEMP_DIR)) {
  fs_sync.mkdirSync(TEMP_DIR, { recursive: true });
}

const app = express();
// Railway 用 PORT 环境变量；本地开发用 CANVA_BACKEND_PORT
const port = Number(process.env.PORT || process.env.CANVA_BACKEND_PORT || 3001);

app.use(express.json({ limit: "10mb" }));

// 暂存已生成的 zip，5 分钟后自动清理
const fileStore = new Map<string, { buffer: Buffer; fileName: string; createdAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of fileStore) {
    if (now - entry.createdAt > 5 * 60 * 1000) fileStore.delete(id);
  }
}, 60_000);

// 扫描时预下载的素材缓存（不自动过期，导出时用完即删）
const stagedStore = new Map<string, { hash: string; fileName: string }>();

// Chrome 插件转发的鉴权凭证（供未来后端自动触发导出使用）
let pluginExportToken: { exportUrl: string; exportHeaders: Record<string, string>; exportBody: unknown } | null = null;

// Chrome 插件下载的页面 blob（按文件名存储，/pack-plugin-pages 时合并进 ZIP）
const pluginPageStore = new Map<string, { buffer: Buffer; fileName: string }>();

// 书签脚本轮询队列：ZIP 就绪后推入，书签取走即删
const pendingQueue: Array<{ id: string; fileName: string; url?: string; filename?: string }> = [];

app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  const isCanvaOrigin =
    origin.endsWith(".canva-apps.com") ||
    origin.endsWith(".canva.com") ||
    origin === "https://canva.com" ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1");

  // GET 接口（/pending /download /health）无敏感数据，允许所有来源
  // POST 接口（/export-bundle）含导出内容，仅允许 Canva 域
  if (req.method === "GET" || req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (isCanvaOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, ngrok-skip-browser-warning");
  // Chrome 私有网络访问（Public→localhost）需要此头，否则预检 CORS 失败
  res.setHeader("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

const sanitizeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

/** 从 Content-Disposition 响应头提取文件名（支持 filename* 和 filename 两种形式） */
const extractFileName = (contentDisposition: string | null): string | null => {
  if (!contentDisposition) return null;
  // filename*=UTF-8''encoded%20name.jpg
  const starMatch = contentDisposition.match(/filename\*\s*=\s*[^']*''([^;\s]+)/i);
  if (starMatch?.[1]) {
    try { return decodeURIComponent(starMatch[1]); } catch { /* fall through */ }
  }
  // filename="name.jpg" or filename=name.jpg
  const plainMatch = contentDisposition.match(/filename\s*=\s*"?([^"\s;]+)"?/i);
  if (plainMatch?.[1]) {
    try { return decodeURIComponent(plainMatch[1]); } catch { return plainMatch[1]; }
  }
  return null;
};

const guessExtension = (contentType: string | null, fallback: string) => {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "video/mp4":
      return ".mp4";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "application/pdf":
      return ".pdf";
    case "image/svg+xml":
      return ".svg";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return ".pptx";
    case "application/zip":
    case "application/x-zip-compressed":
      return ".zip";
    default:
      return fallback;
  }
};

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// 扫描时立即预下载素材，存入 stagedStore，避免 Canva 临时 URL 过期
app.post("/pre-stage-assets", async (req, res) => {
  const { assets } = req.body as {
    assets?: Array<{ label: string; url: string; assetType: string; urlExt?: string }>;
  };
  if (!Array.isArray(assets) || assets.length === 0) {
    res.status(200).json({ staged: [] });
    return;
  }
  const staged: Array<{ stagedId: string; label: string }> = [];
  await Promise.all(
    assets.map(async (asset) => {
      try {
        const assetRes = await fetch(asset.url);
        if (!assetRes.ok) return;
        const contentType = assetRes.headers.get("content-type");
        const contentDisposition = assetRes.headers.get("content-disposition");
        const buffer = Buffer.from(await assetRes.arrayBuffer());
        const originalName = extractFileName(contentDisposition);
        let fileName: string;
        if (originalName) {
          fileName = sanitizeFileName(originalName);
        } else {
          const fallbackExt = asset.urlExt || (asset.assetType === "video" ? ".mp4" : ".jpg");
          const ext = guessExtension(contentType, fallbackExt);
          fileName = `${sanitizeFileName(asset.label)}${ext}`;
        }
        // removed extra stagedId
        const stagedId = randomUUID();
        // Since we are in an async map, we write to temp array, invoke python, then delete
        const tempFilePath = path.join(TEMP_DIR, stagedId + "_" + fileName);
        fs_sync.writeFileSync(tempFilePath, buffer);
        let phash = "";
        try {
           const pyScript = path.join(__dirname, "calculate_hash.py");
           phash = execSync(`python "${pyScript}" "${tempFilePath}"`).toString().trim();
        } catch(e) {
           console.warn(`[pre-stage] Python pHash failed for ${fileName}`);
        }
        fs_sync.unlinkSync(tempFilePath);
        
        stagedStore.set(stagedId, { hash: phash, fileName });
        staged.push({ stagedId, label: asset.label });
        console.log(`[pre-stage] 已缓存: ${asset.label} → ${fileName} (${buffer.length} bytes)`);
      } catch (err) {
        console.warn(`[pre-stage] 失败: ${asset.label}`, err);
      }
    }),
  );
  res.status(200).json({ staged });
});

// Chrome 插件转发鉴权凭证
app.post("/set-export-token", (req, res) => {
  pluginExportToken = (req.body as typeof pluginExportToken) ?? null;
  console.log("[plugin-token] 已收到鉴权凭证");
  res.status(200).json({ ok: true });
});

// Chrome 插件每页下载完成后转发 URL，后端立即下载缓存（趁 URL 未过期）
app.post("/add-page-blob", async (req, res) => {
  const { pageNum, url, ext, projectName } = req.body as {
    pageNum?: number; url?: string; ext?: string; projectName?: string;
  };
  if (!url) { res.status(200).json({ ok: false }); return; }
  try {
    const r = await fetch(url);
    if (!r.ok) { res.status(200).json({ ok: false }); return; }
    const buffer = Buffer.from(await r.arrayBuffer());
    const safeName = sanitizeFileName(projectName || "Canva");
    const fileName = `${safeName}_Page${String(pageNum ?? 0).padStart(2, "0")}.${ext ?? "mp4"}`;
    pluginPageStore.set(fileName, { buffer, fileName });
    console.log(`[page-blob] 已缓存: ${fileName} (${buffer.length} bytes)`);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.warn("[page-blob] 下载失败:", e);
    res.status(200).json({ ok: false });
  }
});

// 合并插件已下载的页面 + App 扫描的素材 + 清单 → ZIP

async function processAssetHashes(assetDownloadItems: any[], manifestText: string, manifestJson: string) {
  let parsedManifestJson: any = {};
  try { parsedManifestJson = JSON.parse(manifestJson || "{}"); } catch {}
  let updatedManifestText = manifestText || "";

  if (Array.isArray(assetDownloadItems) && assetDownloadItems.length > 0) {
    await Promise.all(
      assetDownloadItems.map(async (asset) => {
        try {
          let hash = "";
          let zipFileName = "";
          
          if (asset.stagedId && stagedStore.has(asset.stagedId)) {
            // Already computed dynamically at pre-stage
            const staged = stagedStore.get(asset.stagedId)!;
            hash = staged.hash;
            zipFileName = staged.fileName;
            stagedStore.delete(asset.stagedId);
          } else {
            // Uncached: we need to download it to temp, run Python, then delete it.
            const assetRes = await fetch(asset.url);
            if (!assetRes.ok) return;
            const buffer = Buffer.from(await assetRes.arrayBuffer());
            
            const contentDisposition = assetRes.headers.get("content-disposition");
            const originalName = extractFileName(contentDisposition);
            zipFileName = originalName ? sanitizeFileName(originalName) : asset.label;
            
            // Add extension if missing but needed for cv2/Image detection
            if (!zipFileName.includes(".")) {
               const fallbackExt = asset.urlExt || (asset.assetType === "video" ? ".mp4" : ".jpg");
               const ext = guessExtension(assetRes.headers.get("content-type"), fallbackExt);
               zipFileName += ext;
            }
            
            const tempFilePath = path.join(TEMP_DIR, randomUUID() + "_" + zipFileName);
            fs_sync.writeFileSync(tempFilePath, buffer);
            
            try {
              const pyScript = path.join(__dirname, "calculate_hash.py");
              hash = execSync(`python "${pyScript}" "${tempFilePath}"`).toString().trim();
            } catch (pyErr) {
              console.warn(`[Python Hash Error] `, pyErr);
            }
            
            // Clean up immediately
            fs_sync.unlinkSync(tempFilePath);
          }
          
          if ((parsedManifestJson.items || parsedManifestJson.assets) && hash) {
            
            const itemsList = parsedManifestJson.items || parsedManifestJson.assets;
            const item = itemsList.find((i: any) => i.label === asset.label);
            if (item) {
              item.phash = hash;
              item.detail = `文件 pHash: ${hash} (原名:${zipFileName})`;
            }
          }
          if (hash) {
            
            // Legacy format matching
            const textRegexOld = new RegExp(`已收录 → 素材/${asset.label}`, "g");
            updatedManifestText = updatedManifestText.replace(textRegexOld, `pHash: ${hash}`);
            // New format matching 
            const textRegexNew = new RegExp(`${asset.label} \\(${asset.assetType}\\)`, "g");
            updatedManifestText = updatedManifestText.replace(textRegexNew, `${asset.label} (pHash: ${hash})`);

          }
        } catch (e) {
          console.warn(`[asset-hash] 获取素材 pHash 失败: ${asset.label}`, e);
        }
      })
    );
  }
  return { newManifestText: updatedManifestText, newManifestJson: JSON.stringify(parsedManifestJson, null, 2) };
}

app.post("/pack-plugin-pages", async (req, res) => {
  try {
    const { title, manifestText, manifestJson, assetDownloadItems } = req.body as {
      title?: string;
      manifestText?: string;
      manifestJson?: string;
      assetDownloadItems?: Array<{ label: string; url: string; assetType: string; urlExt?: string; stagedId?: string }>;
    };

    if (pluginPageStore.size === 0) {
      res.status(400).json({ error: "插件尚未下载任何页面，请先在 Canva 下载加速器中选择页面并点击下载" });
      return;
    }

    const zip = new JSZip();
    const baseName = sanitizeFileName(title || "canva-export");

    // 1. 插件下载的页面文件放根目录
    for (const [, entry] of pluginPageStore) {
      zip.file(entry.fileName, entry.buffer);
    }
    pluginPageStore.clear();


    // 2. 扫描的用户素材：不打包，计算哈希并更新清单
    const { newManifestText, newManifestJson } = await processAssetHashes(
      assetDownloadItems || [],
      manifestText || "",
      manifestJson || "{}"
    );

    // 3. 清单文件放根目录

    zip.file("素材名称清单.txt", newManifestText);
    zip.file("素材名称清单.json", newManifestJson);

    const bundle = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const bundleName = `${baseName}-含素材清单.zip`;
    const id = randomUUID();
    fileStore.set(id, { buffer: bundle, fileName: bundleName, createdAt: Date.now() });
    pendingQueue.push({ id, fileName: bundleName });
    res.status(200).json({ id, fileName: bundleName });
  } catch (error) {
    console.error("[pack-plugin] 失败", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// 书签脚本轮询此接口，有待下载文件时返回并出队
app.get("/pending", (_req, res) => {
  const item = pendingQueue.shift();
  if (item) {
    res.status(200).json(item);
  } else {
    res.status(200).json({ id: null });
  }
});

// 供前端 window.open() 直接触发下载
app.get("/download/:id", (req, res) => {
  const entry = fileStore.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "File not found or expired" });
    return;
  }
  // 不要删，让它靠 5 分钟定时器清理。这样可以支持既被插件捕获，又能被用户手动再点一次下载
  // fileStore.delete(req.params.id);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
  );
  res.status(200).send(entry.buffer);
});

app.post("/export-bundle", async (req, res) => {
  try {
    const {
      title,
      exportBlobs,
      manifestText,
      manifestJson,
      assetDownloadItems,
    } = req.body as {
      title?: string;
      exportBlobs?: Array<{ url: string }>;
      manifestText?: string;
      manifestJson?: string;
      assetDownloadItems?: Array<{ label: string; url: string; assetType: string; urlExt?: string; stagedId?: string }>;
    };

    if (!Array.isArray(exportBlobs) || exportBlobs.length === 0) {
      res.status(400).json({ error: "exportBlobs is required" });
      return;
    }

    const zip = new JSZip();
    const baseName = sanitizeFileName(title || "canva-export");

    // 1. 导出成品文件放根目录；若 Canva 返回的是嵌套 ZIP（多页视频），自动解包
    await Promise.all(
      exportBlobs.map(async (item, index) => {
        const response = await fetch(item.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch export blob: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const isZip =
          contentType?.includes("zip") ||
          contentType?.includes("x-zip") ||
          (contentType === null && exportBlobs.length === 1 && buffer[0] === 0x50 && buffer[1] === 0x4b);

        if (isZip) {
          // 解包嵌套 ZIP，把每个文件直接放到根目录
          const innerZip = await JSZip.loadAsync(buffer);
          await Promise.all(
            Object.entries(innerZip.files).map(async ([innerName, innerFile]) => {
              if (!innerFile.dir) {
                const content = await innerFile.async("nodebuffer");
                zip.file(innerName, content);
              }
            }),
          );
        } else {
          const extension = guessExtension(contentType, ".bin");
          const fileName =
            exportBlobs.length > 1
              ? `${baseName}-${String(index + 1).padStart(2, "0")}${extension}`
              : `${baseName}${extension}`;
          zip.file(fileName, buffer);
        }
      }),
    );


    // 2. 扫描的用户素材：不打包，计算哈希并更新清单
    const { newManifestText, newManifestJson } = await processAssetHashes(
      assetDownloadItems || [],
      manifestText || "",
      manifestJson || "{}"
    );

    // 3. 清单文件放根目录

    zip.file("素材名称清单.txt", newManifestText);
    zip.file("素材名称清单.json", newManifestJson);

    const bundle = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const bundleName = `${baseName}-含素材清单.zip`;
    const id = randomUUID();
    fileStore.set(id, { buffer: bundle, fileName: bundleName, createdAt: Date.now() });
    
    // 把可以直接下载的完整 URL 发给插件做轮询
    const downloadUrl = `http://localhost:${port}/download/${id}`;
    pendingQueue.push({ id, url: downloadUrl, fileName: bundleName, filename: bundleName });    
    res.status(200).json({ id, fileName: bundleName });
  } catch (error) {
    console.error("Failed to create export bundle", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


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
          hash = execSync(`python "${pyScript}" "${tempFilePath}"`).toString().trim();
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
       execSync(`python "${pyDbScript}" "${jsonPath}"`);
    } catch(dbErr: any) {
       console.error("DB error:", dbErr.toString());
       const out = dbErr.stdout ? dbErr.stdout.toString() : "";
       const err = dbErr.stderr ? dbErr.stderr.toString() : dbErr.message;
       throw new Error("DB失败: " + err + " | " + out);
    } finally {
       if (fs_sync.existsSync(jsonPath)) fs_sync.unlinkSync(jsonPath);
    }
    
    res.status(200).json({ success: true, count: resolvedAssets.length });
  } catch (err: any) {
    console.error("Failed to register assets:", err);
    res.status(500).json({ error: err.message });
  }
});



app.listen(port, () => {
  console.log(`Export backend listening on http://localhost:${port}`);
});