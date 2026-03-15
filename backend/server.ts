/* eslint-disable no-console */
import express from "express";
import JSZip from "jszip";

const app = express();
const port = Number(process.env.CANVA_BACKEND_PORT || 3001);

app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

app.post("/export-bundle", async (req, res) => {
  try {
    const {
      title,
      exportBlobs,
      manifestText,
      manifestJson,
    } = req.body as {
      title?: string;
      exportBlobs?: Array<{ url: string }>;
      manifestText?: string;
      manifestJson?: string;
    };

    if (!Array.isArray(exportBlobs) || exportBlobs.length === 0) {
      res.status(400).json({ error: "exportBlobs is required" });
      return;
    }

    const zip = new JSZip();
    const baseName = sanitizeFileName(title || "canva-export");

    await Promise.all(
      exportBlobs.map(async (item, index) => {
        const response = await fetch(item.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch export blob: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        const extension = guessExtension(
          contentType,
          exportBlobs.length > 1 ? ".bin" : ".zip",
        );
        const fileName = `${baseName}-${String(index + 1).padStart(2, "0")}${extension}`;
        const arrayBuffer = await response.arrayBuffer();
        zip.file(fileName, Buffer.from(arrayBuffer));
      }),
    );

    zip.file("素材名称清单.txt", manifestText || "");
    zip.file("素材名称清单.json", manifestJson || "{}");

    const bundle = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const bundleName = `${baseName}-含素材清单.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(bundleName)}`,
    );
    res.status(200).send(bundle);
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