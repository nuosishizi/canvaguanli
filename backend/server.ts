/* eslint-disable no-console */
import express from "express";
import JSZip from "jszip";
import { randomUUID } from "crypto";

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

// 书签脚本轮询队列：ZIP 就绪后推入，书签取走即删
const pendingQueue: Array<{ id: string; fileName: string }> = [];

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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
  fileStore.delete(req.params.id);
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
      assetDownloadItems?: Array<{ label: string; url: string; assetType: string; urlExt?: string }>;
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

    // 2. 用户上传素材下载到 素材/ 子文件夹（Canva内置素材在前端已过滤）
    if (Array.isArray(assetDownloadItems) && assetDownloadItems.length > 0) {
      await Promise.all(
        assetDownloadItems.map(async (asset) => {
          try {
            const assetRes = await fetch(asset.url);
            if (!assetRes.ok) return;
            const assetContentType = assetRes.headers.get("content-type");
            const contentDisposition = assetRes.headers.get("content-disposition");

            // 优先用原始文件名，其次用 URL 扩展名，最后回退到类型推断
            const originalName = extractFileName(contentDisposition);
            let zipFileName: string;
            if (originalName) {
              zipFileName = sanitizeFileName(originalName);
            } else {
              const fallbackExt = asset.urlExt || (asset.assetType === "video" ? ".mp4" : ".jpg");
              const ext = guessExtension(assetContentType, fallbackExt);
              zipFileName = `${sanitizeFileName(asset.label)}${ext}`;
            }

            const data = await assetRes.arrayBuffer();
            zip.file(`素材/${zipFileName}`, Buffer.from(data));
          } catch {
            // 临时 URL 已过期或网络错误，跳过该素材
            console.warn(`[export-bundle] 素材下载失败: ${asset.label}`);
          }
        }),
      );
    }

    // 3. 清单文件放根目录
    zip.file("素材名称清单.txt", manifestText || "");
    zip.file("素材名称清单.json", manifestJson || "{}");

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
    console.error("Failed to create export bundle", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.listen(port, () => {
  console.log(`Export backend listening on http://localhost:${port}`);
});