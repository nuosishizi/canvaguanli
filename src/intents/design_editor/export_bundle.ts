import type { ExportCompleted } from "@canva/design";
import type { AssetDownloadItem } from "./export_manifest";

const sanitizeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

export const downloadExportBundle = async ({
  response,
  manifestText,
  manifestJson,
  assetDownloadItems,
}: {
  response: ExportCompleted;
  manifestText: string;
  manifestJson: string;
  assetDownloadItems: AssetDownloadItem[];
}) => {
  const fallbackName = `${sanitizeFileName(response.title ?? "canva-export")}-含素材清单.zip`;
  const res = await fetch(`${BACKEND_HOST}/export-bundle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: response.title ?? "canva-export",
      exportBlobs: response.exportBlobs,
      manifestText,
      manifestJson,
      assetDownloadItems,
    }),
  });

  if (!res.ok) {
    throw new Error(`打包服务失败: ${res.status}`);
  }

  const { fileName } = await res.json() as { id: string; fileName: string };
  return fileName || fallbackName;
};