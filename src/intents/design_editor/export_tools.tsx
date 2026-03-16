import { useState, useCallback, useRef } from "react";
import {
  Button,
  Rows,
  Text,
  Select,
  Alert,
  MultilineInput,
} from "@canva/app-ui-kit";
import { requestExport } from "@canva/design";
import type { ExportCompleted, ExportFileType } from "@canva/design";
import { downloadExportBundle } from "./export_bundle";
import { buildManifest, scanCurrentPageAssets } from "./export_manifest";
import type { AssetDownloadItem } from "./export_manifest";

const BOOKMARKLET =
  "javascript:(function(){if(window._cvt){clearInterval(window._cvt);}window._cvt=setInterval(function(){fetch('https://canvaguanli-production.up.railway.app/pending',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(d.id){clearInterval(window._cvt);window.location.href='https://canvaguanli-production.up.railway.app/download/'+d.id;}}).catch(function(){});},900);})();";

type FormatOption = {
  label: string;
  value: ExportFileType;
};

const FORMAT_OPTIONS: FormatOption[] = [
  { label: "MP4 视频", value: "video" },
  { label: "PNG 图片", value: "png" },
  { label: "JPG 图片", value: "jpg" },
  { label: "GIF 动图", value: "gif" },
  { label: "PDF 文档", value: "pdf_standard" },
  { label: "PPT 演示文稿", value: "pptx" },
  { label: "SVG 矢量图", value: "svg" },
];

export const ExportTools = () => {
  const [format, setFormat] = useState<ExportFileType>("video");
  const [status, setStatus] = useState<{
    type: "positive" | "info" | "warn" | "critical";
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [bundleName, setBundleName] = useState<string | null>(null);
  const [bookmarkCopied, setBookmarkCopied] = useState(false);

  // 多页扫描状态
  const [scannedAssets, setScannedAssets] = useState<AssetDownloadItem[]>([]);
  const [scannedPageCount, setScannedPageCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const seenRefKeysRef = useRef(new Set<string>());
  const labelCountersRef = useRef({ image: 0, video: 0 });

  const handleExport = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    setBundleName(null);

    try {
      setStatus({ type: "info", message: "正在打开 Canva 导出面板...导出完成后自动打包" });

      const response = await requestExport({ acceptedFileTypes: [format] });

      if (response.status === "completed") {
        const completedResponse = response as ExportCompleted;
        const count = completedResponse.exportBlobs.length;
        setStatus({ type: "info", message: "正在打包 ZIP + 素材清单，请稍候..." });

        const manifest = await buildManifest(
          completedResponse,
          scannedPageCount > 0 ? scannedAssets : undefined,
        );
        const name = await downloadExportBundle({
          response: completedResponse,
          manifestText: manifest.text,
          manifestJson: manifest.json,
          assetDownloadItems: manifest.assetDownloadItems,
        });

        const assetCount = (scannedPageCount > 0 ? scannedAssets : manifest.assetDownloadItems).length;
        const assetNote = scannedPageCount > 0
          ? `已扫描 ${scannedPageCount} 页、共 ${assetCount} 个素材`
          : `素材仅含当前页，多页请逐页点据“扫描当前页素材”`;
        setBundleName(name);
        setStatus({
          type: "positive",
          message: `ZIP 已就绪（成品 ${count} 个 + 用户素材 ${assetCount} 个 + 清单）。${assetNote}。`,
        });
      } else {
        setStatus({ type: "info", message: "导出已取消" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const userMessage = message.includes("Failed to fetch")
        ? "打包失败：请确认本地 3001 服务已启动"
        : `导出失败: ${message}`;
      setStatus({ type: "critical", message: userMessage });
    } finally {
      setLoading(false);
    }
  }, [format, scannedPageCount, scannedAssets]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const newAssets = await scanCurrentPageAssets(
        seenRefKeysRef.current,
        labelCountersRef.current,
      );
      setScannedAssets((prev) => [...prev, ...newAssets]);
      setScannedPageCount((prev) => prev + 1);
      setStatus({
        type: "info",
        message: `当前页扫描完成，新增 ${newAssets.length} 个素材。请切换到下一页继续扫描，或直接点“导出并打包”。`,
      });
    } catch (err) {
      setStatus({
        type: "critical",
        message: `扫描失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setScanning(false);
    }
  }, []);

  const handleClearScan = useCallback(() => {
    setScannedAssets([]);
    setScannedPageCount(0);
    seenRefKeysRef.current = new Set<string>();
    labelCountersRef.current = { image: 0, video: 0 };
    setStatus(null);
  }, []);

  return (
    <Rows spacing="2u">
      <Text variant="bold">设计导出</Text>

      <Rows spacing="1u">
        <Text size="small" tone="tertiary">
          【一次性设置】复制下方书签代码 → 浏览器书签栏右键"添加书签" → 粘贴为网址并命名 → 完成。每次导出前点一次书签，ZIP 就绪后会自动下载。
        </Text>
        <MultilineInput
          value={BOOKMARKLET}
          onChange={() => undefined}
          minRows={2}
          maxRows={3}
        />
        <Button
          variant="secondary"
          stretch
          onClick={() => {
            navigator.clipboard.writeText(BOOKMARKLET).then(() => {
              setBookmarkCopied(true);
              setTimeout(() => setBookmarkCopied(false), 2500);
            });
          }}
        >
          {bookmarkCopied ? "✓ 已复制" : "复制书签代码"}
        </Button>
      </Rows>

      <Rows spacing="1u">
        <Button
          variant="secondary"
          stretch
          onClick={handleScan}
          loading={scanning}
          disabled={scanning || loading}
        >
          {scanning ? "扫描中..." : "扫描当前页素材"}
        </Button>
        {scannedPageCount > 0 && (
          <Rows spacing="1u">
            <Text size="small" tone="tertiary">
              已扫 {scannedPageCount} 页 / 共 {scannedAssets.length} 个用户素材（跨页去重）
            </Text>
            <Button
              variant="tertiary"
              stretch
              onClick={handleClearScan}
              disabled={scanning || loading}
            >
              清空已扫描素材
            </Button>
          </Rows>
        )}
      </Rows>

      <Select
        options={FORMAT_OPTIONS}
        value={format}
        onChange={setFormat}
        stretch
      />

      <Button
        variant="primary"
        onClick={handleExport}
        loading={loading}
        disabled={loading}
        stretch
      >
        导出并打包
      </Button>

      {status && <Alert tone={status.type}>{status.message}</Alert>}

      {bundleName && (
        <Text size="small" tone="tertiary">
          最近生成: {bundleName}
        </Text>
      )}
    </Rows>
  );
};
