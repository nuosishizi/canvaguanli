import { useState, useCallback, useRef, useEffect } from "react";
import {
  Button,
  Rows,
  Text,
  Alert,
  TextInput,
  FormField,
  Box,
} from "@canva/app-ui-kit";
import { requestExport, getDesignMetadata } from "@canva/design";
import type { ExportCompleted } from "@canva/design";
import { preStageAssets, downloadExportBundle } from "./export_bundle";
import { scanCurrentPageAssets } from "./export_manifest";
import type { AssetDownloadItem } from "./export_manifest";

export const ExportTools = () => {
  const [status, setStatus] = useState<{
    type: "positive" | "info" | "warn" | "critical";
    message: string;
  } | null>(null);
  const [bundleName, setBundleName] = useState<string | null>(null);
  const [downloadId, setDownloadId] = useState<string | null>(null);

  // 多页扫描状态
  const [scannedAssets, setScannedAssets] = useState<AssetDownloadItem[]>([]);
  const [scannedPageCount, setScannedPageCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const seenRefKeysRef = useRef(new Set<string>());
  const labelCountersRef = useRef({ image: 0, video: 0 });

  const [packing, setPacking] = useState(false);

  const [creator, setCreator] = useState<string>("");
  const [canvaId, setCanvaId] = useState<string>("");
  const [templateName, setTemplateName] = useState<string>("");
  const [registering, setRegistering] = useState(false);

  const [generatorInit, setGeneratorInit] = useState(false);
  useEffect(() => {
    if (!generatorInit) {
      getDesignMetadata().then((meta) => {
        const now = new Date();
        // Generate formatting like 202603151741003 (YYYYMMDDHHMMSS + random digit)
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        const msId = yyyy + mm + dd + hh + min + ss + Math.floor(Math.random() * 10);
        
        setCanvaId(msId);
        if (meta && meta.title) {
          setTemplateName(meta.title + "【" + msId + "】");
        } else {
          setTemplateName("未命名设计【" + msId + "】");
        }
        setGeneratorInit(true);
      }).catch((e) => console.warn("Failed to get design meta", e));
    }
  }, [generatorInit]);






  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const newAssets = await scanCurrentPageAssets(
        seenRefKeysRef.current,
        labelCountersRef.current,
      );
      const staged = await preStageAssets(newAssets);
      const stagedAssets = newAssets.map((a) => {
        const match = staged.find((s) => s.label === a.label);
        return match ? { ...a, stagedId: match.stagedId } : a;
      });
      setScannedAssets((prev) => [...prev, ...stagedAssets]);
      setScannedPageCount((prev) => prev + 1);
      setStatus({
        type: "info",
        message: `当前页扫描完成，新增 ${newAssets.length} 个素材。切换到下一页继续扫描，或直接点"打包下载"。`,
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

  
  const handleRegisterDB = useCallback(async () => {
    if (!creator) {
       setStatus({ type: "warn", message: "人员名字 (creator) 为必填项" });
       return;
    }
    if (scannedAssets.length === 0) {
       setStatus({ type: "warn", message: "没有扫描到任何素材，请先扫描页面素材" });
       return;
    }
    setRegistering(true);
    setStatus({ type: "info", message: "正在计算 Hash 并注册到数据库..." });
    try {
      const res = await fetch("http://localhost:3001/register-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator,
          canvaId,
          templateName,
          assets: scannedAssets,
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "请求失败");
      }
      setStatus({ type: "positive", message: `✓ 成功注册了 ${data.count} 个素材到数据库` });
    } catch (err: any) {
      setStatus({ type: "critical", message: `注册失败: ${err.message}` });
    } finally {
      setRegistering(false);
    }
  }, [creator, canvaId, templateName, scannedAssets]);


  const handleExport = useCallback(async () => {
    setPacking(true);
    setStatus(null);
    setBundleName(null);
    setDownloadId(null);
    try {
      setStatus({ type: "info", message: "正在打开 Canva 导出面板..." });
      const response = await requestExport({
        acceptedFileTypes: ["video", "png", "jpg", "gif", "pdf_standard", "pptx"],
      });
      if (response.status !== "completed") {
        setStatus({ type: "info", message: "导出已取消" });
        return;
      }
      const assets = scannedAssets;
      const manifestText = assets.map((a, i) => `${i + 1}. ${a.label} (${a.assetType})`).join("\n");
      const manifestJson = JSON.stringify({ assets }, null, 2);
      setStatus({ type: "info", message: "正在打包 ZIP，请稍候..." });
      const { id, fileName } = await downloadExportBundle({
        response: response as ExportCompleted,
        manifestText,
        manifestJson,
        assetDownloadItems: assets,
      });
      setBundleName(fileName);
      setDownloadId(id);
      
      // 尝试向父窗口发送下载指令 (兼容扩展)
      try {
        const downloadUrl = `http://localhost:3001/download/${id}`;
        window.parent.postMessage({ type: 'CANVA_DOWNLOAD_RELAY', payload: { url: downloadUrl, filename: fileName } }, '*');
      } catch (e) {}

      setStatus({ type: "positive", message: "✓ ZIP 已就绪！若您的 Chrome 插件开了自动下载开关将自动保存，否则请点击下方按钮。" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({
        type: "critical",
        message: message.includes("Failed to fetch")
          ? "打包失败：请确认本地 3001 服务已启动"
          : `打包失败: ${message}`,
      });
    } finally {
      setPacking(false);
    }
  }, [scannedAssets]);

  return (
    <Rows spacing="2u">
      <Text variant="bold">设计导出</Text>

      {/* 素材扫描区 */}
      <Rows spacing="1u">
        <Button
          variant="secondary"
          stretch
          onClick={handleScan}
          loading={scanning}
          disabled={scanning || packing}
        >
          {scanning ? "扫描中..." : "扫描当前页素材（可选）"}
        </Button>
        {scannedPageCount > 0 && (
          <Rows spacing="1u">
            <Text size="small" tone="tertiary">
              已扫 {scannedPageCount} 页 / 共 {scannedAssets.length} 个用户素材
            </Text>
            <Button
              variant="tertiary"
              stretch
              onClick={handleClearScan}
              disabled={scanning || packing}
            >
              清空已扫描素材
            </Button>
          </Rows>
        )}
      </Rows>

      <Box padding="1u" background="neutralLow" borderRadius="standard">
        <Rows spacing="1u">
          <Text variant="bold" size="small">数据库关联信息</Text>
          <input
            type="text"
            placeholder="人员名字 (必填)"
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
          />
          <input
            type="text"
            placeholder="Canva 模板 ID (可选)"
            value={canvaId}
            onChange={(e) => setCanvaId(e.target.value)}
            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
          />
          <input
            type="text"
            placeholder="模板名称 (可选)"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
          />
          <Button
            variant="primary"
            onClick={handleRegisterDB}
            loading={registering}
            disabled={scanning || packing || registering}
            stretch
          >
            哈希并写入到数据库
          </Button>
        </Rows>
      </Box>

      <Button
        variant="secondary"
        onClick={handleExport}
        loading={packing}
        disabled={scanning || packing || registering}
        stretch
      >
        打包导出ZIP
      </Button>

      {status && <Alert tone={status.type}>{status.message}</Alert>}

      {bundleName && (
        <Rows spacing="1u">
          <Text size="small" tone="tertiary">
            最近生成: {bundleName}
          </Text>
          {downloadId && (
            <Button
              variant="secondary"
              stretch
              onClick={() => {
                const a = document.createElement("a");
                a.href = `http://localhost:3001/download/${downloadId}`;
                a.download = bundleName;
                a.target = "_blank";
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
            >
              点击手动下载该 ZIP
            </Button>
          )}
        </Rows>
      )}
    </Rows>
  );
};

