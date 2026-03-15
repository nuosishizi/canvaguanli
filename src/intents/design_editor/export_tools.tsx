import { useState, useCallback } from "react";
import {
  Button,
  Rows,
  Text,
  Select,
  Alert,
} from "@canva/app-ui-kit";
import { requestExport } from "@canva/design";
import type { ExportCompleted, ExportFileType } from "@canva/design";
import { downloadExportBundle } from "./export_bundle";
import { buildManifest } from "./export_manifest";

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

  const handleExport = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    setBundleName(null);

    try {
      setStatus({ type: "info", message: "正在打开 Canva 导出面板..." });

      const response = await requestExport({
        acceptedFileTypes: [format],
      });

      if (response.status === "completed") {
        const completedResponse = response as ExportCompleted;
        const count = completedResponse.exportBlobs.length;

        setStatus({
          type: "info",
          message: "正在生成含素材清单的打包文件，请稍候...",
        });

        const manifest = await buildManifest(completedResponse);
        const downloadedBundleName = await downloadExportBundle({
          response: completedResponse,
          manifestText: manifest.text,
          manifestJson: manifest.json,
        });

        setBundleName(downloadedBundleName);
        setStatus({
          type: "positive",
          message: `已开始下载 ${downloadedBundleName}。压缩包内包含导出文件和素材名称清单；原始 Canva 下载任务也会继续执行。共 ${count} 个导出文件。`,
        });
      } else {
        setStatus({ type: "info", message: "导出已取消" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const userMessage = message.includes("Failed to fetch")
        ? "打包下载失败：本地后端未连通或浏览器拦截了请求。请确认本地 3001 服务已启动。"
        : message.includes("打包服务失败")
          ? `打包下载失败：${message}`
          : `导出失败: ${message}`;

      setStatus({
        type: "critical",
        message: userMessage,
      });
    } finally {
      setLoading(false);
    }
  }, [format]);

  return (
    <Rows spacing="2u">
      <Text variant="bold">设计导出</Text>
      <Text size="small" tone="tertiary">
        点击导出后，会打开 Canva 原生下载面板，并预选你当前选择的格式
      </Text>
      <Text size="small" tone="tertiary">
        在面板里点“下载”后，app 会额外生成一个“含素材清单.zip”并自动下载
      </Text>

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
