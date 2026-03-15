import { useState, useCallback } from "react";
import {
  Button,
  Rows,
  Text,
  Select,
  Alert,
} from "@canva/app-ui-kit";
import { requestExport } from "@canva/design";
import type { ExportFileType } from "@canva/design";

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

  const handleExport = useCallback(async () => {
    setLoading(true);
    setStatus(null);

    try {
      const response = await requestExport({
        acceptedFileTypes: [format],
      });

      if (response.status === "completed") {
        const count = response.exportBlobs.length;
        setStatus({
          type: "positive",
          message: `已完成 Canva 导出流程，共 ${count} 个文件${response.title ? ` (${response.title})` : ""}。请到浏览器下载目录查看。`,
        });
      } else {
        setStatus({ type: "info", message: "导出已取消" });
      }
    } catch (err) {
      setStatus({
        type: "critical",
        message: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }, [format]);

  return (
    <Rows spacing="2u">
      <Text variant="bold">设计导出</Text>
      <Text size="small" tone="tertiary">
        点击导出后，会打开 Canva 原生下载面板；你需要在面板里再点一次“下载”
      </Text>
      <Text size="small" tone="tertiary">
        下载后的文件由浏览器保存，通常在系统的“下载”文件夹里
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
        导出
      </Button>

      {status && <Alert tone={status.type}>{status.message}</Alert>}
    </Rows>
  );
};
