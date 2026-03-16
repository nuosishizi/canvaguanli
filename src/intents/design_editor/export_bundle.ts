import type { ExportCompleted } from "@canva/design";
import type { AssetDownloadItem } from "./export_manifest";

const sanitizeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

/** 扫描后立即调用，把素材推到后端缓存，避免 Canva 临时 URL 过期 */
export const preStageAssets = async (assets: AssetDownloadItem[]): Promise<Array<{ stagedId: string; label: string }>> => {
  if (assets.length === 0) return [];
  try {
    const res = await fetch(`${BACKEND_HOST}/pre-stage-assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assets }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { staged: Array<{ stagedId: string; label: string }> };
    return data.staged ?? [];
  } catch {
    return [];
  }
};

export const downloadExportBundle = async ({
  response,
  manifestText,
  manifestJson,
  assetDownloadItems,
  selectedPages,
}: {
  response: ExportCompleted;
  manifestText: string;
  manifestJson: string;
  assetDownloadItems: AssetDownloadItem[];
  selectedPages?: Set<number>;
}) => {
  const fallbackName = `${sanitizeFileName(response.title ?? "canva-export")}-含素材清单.zip`;
  const blobs =
    selectedPages && selectedPages.size > 0
      ? response.exportBlobs.filter((_, i) => selectedPages.has(i + 1))
      : response.exportBlobs;
  const res = await fetch(`${BACKEND_HOST}/export-bundle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: response.title ?? "canva-export",
      exportBlobs: blobs,
      manifestText,
      manifestJson,
      assetDownloadItems,
    }),
  });

  if (!res.ok) {
    throw new Error(`打包服务失败: ${res.status}`);
  }

  const { id, fileName } = await res.json() as { id: string; fileName: string };
  return { id: id as string, fileName: fileName || fallbackName };
};

/** 合并 Chrome 插件已下载的页面 + 扫描素材 + 清单 → 推送 ZIP（无需 requestExport 弹窗） */
export const packPluginPages = async (params: {
  title?: string;
  manifestText: string;
  manifestJson: string;
  assetDownloadItems: AssetDownloadItem[];
}): Promise<{ id: string; fileName: string }> => {
  const res = await fetch(`${BACKEND_HOST}/pack-plugin-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `打包失败: ${res.status}`);
  }
  return await res.json() as { id: string; fileName: string };
};