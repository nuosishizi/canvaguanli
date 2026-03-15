import type { ExportCompleted } from "@canva/design";

const sanitizeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

const triggerDownload = (blob: Blob, fileName: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
};

const extractFileName = (contentDisposition: string | null, fallback: string) => {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
};

export const downloadExportBundle = async ({
  response,
  manifestText,
  manifestJson,
}: {
  response: ExportCompleted;
  manifestText: string;
  manifestJson: string;
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
    }),
  });

  if (!res.ok) {
    throw new Error(`打包服务失败: ${res.status}`);
  }

  const bundleBlob = await res.blob();
  const bundleName = extractFileName(
    res.headers.get("content-disposition"),
    fallbackName,
  );
  triggerDownload(bundleBlob, bundleName);
  return bundleName;
};