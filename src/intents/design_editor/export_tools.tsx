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
import { requestOpenExternalUrl } from "@canva/platform";

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
    type: "success" | "info" | "warn" | "error";
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportUrls, setExportUrls] = useState<string[]>([]);

  const handleExport = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    setExportUrls([]);

    try {
      const response = await requestExport({
        acceptedFileTypes: [format],
      });

      if (response.status === "completed") {
        const urls = response.exportBlobs.map((b) => b.url);
        setExportUrls(urls);
        setStatus({
          type: "success",
          message: `导出成功！点击下方按钮下载（共 ${urls.length} 个文件）`,
        });
      } else {
        setStatus({ type: "info", message: "导出已取消" });
      }
    } catch (err) {
      setStatus({
        type: "error",
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
        将当前设计导出为指定格式
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

      {exportUrls.length > 0 && (
        <Rows spacing="1u">
          <Text size="small" variant="bold">
            下载链接：
          </Text>
          {exportUrls.map((url, i) => (
            <Button
              key={i}
              variant="secondary"
              onClick={() => requestOpenExternalUrl({ url })}
              stretch
            >
              文件 {i + 1}
            </Button>
          ))}
        </Rows>
      )}
    </Rows>
  );
};
