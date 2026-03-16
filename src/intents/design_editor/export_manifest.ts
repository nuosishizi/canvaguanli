import { getDesignMetadata, openDesign } from "@canva/design";
import { getTemporaryUrl } from "@canva/asset";
import type { ImageRef, VideoRef } from "@canva/asset";
import type { ExportResponse } from "@canva/design";
import type { DesignEditing } from "@canva/design";

export type ManifestItem = {
  index: number;
  label: string;
  type: string;
  detail: string;
};

export type AssetDownloadItem = {
  /** 文件名前缀，如 "图片-01" */
  label: string;
  /** Canva 临时下载 URL（扫描后可能过期） */
  url: string;
  assetType: "image" | "video";
  /** 从 URL 中解析出的扩展名，如 ".jpg" */
  urlExt: string;
  /** 已在后端预缓存的 ID，存在时优先用缓存，不再请求 url */
  stagedId?: string;
};

type CollectedRef =
  | { label: string; itemIndex: number; refType: "image"; ref: ImageRef }
  | { label: string; itemIndex: number; refType: "video"; ref: VideoRef };

type Counters = {
  text: number;
  image: number;
  video: number;
  embed: number;
  shape: number;
  unsupported: number;
};

const truncate = (value: string, max = 48) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
};

const pushItem = (
  items: ManifestItem[],
  label: string,
  type: string,
  detail: string,
) => {
  items.push({
    index: items.length + 1,
    label,
    type,
    detail,
  });
};

const inspectRectElement = (
  element: DesignEditing.RectElement,
  items: ManifestItem[],
  counters: Counters,
  collectedRefs: CollectedRef[],
) => {
  const media = element.fill.mediaContainer.ref;

  if (media?.type === "image") {
    counters.image += 1;
    const label = `图片-${String(counters.image).padStart(2, "0")}`;
    collectedRefs.push({ label, itemIndex: items.length + 1, refType: "image", ref: media.imageRef });
    pushItem(items, label, "image", `imageRef=${media.imageRef}`);
    return;
  }

  if (media?.type === "video") {
    counters.video += 1;
    const label = `视频-${String(counters.video).padStart(2, "0")}`;
    collectedRefs.push({ label, itemIndex: items.length + 1, refType: "video", ref: media.videoRef });
    pushItem(items, label, "video", `videoRef=${media.videoRef}`);
  }
};

const inspectShapeElement = (
  element: DesignEditing.ShapeElement,
  items: ManifestItem[],
  counters: Counters,
  collectedRefs: CollectedRef[],
) => {
  let hasMedia = false;

  element.paths.forEach((path) => {
    const media = path.fill.mediaContainer.ref;
    if (media?.type === "image") {
      counters.image += 1;
      hasMedia = true;
      const label = `形状图片-${String(counters.image).padStart(2, "0")}`;
      collectedRefs.push({ label, itemIndex: items.length + 1, refType: "image", ref: media.imageRef });
      pushItem(items, label, "shape-image", `imageRef=${media.imageRef}`);
    } else if (media?.type === "video") {
      counters.video += 1;
      hasMedia = true;
      const label = `形状视频-${String(counters.video).padStart(2, "0")}`;
      collectedRefs.push({ label, itemIndex: items.length + 1, refType: "video", ref: media.videoRef });
      pushItem(items, label, "shape-video", `videoRef=${media.videoRef}`);
    }
  });

  if (!hasMedia) {
    counters.shape += 1;
    pushItem(
      items,
      `形状-${String(counters.shape).padStart(2, "0")}`,
      "shape",
      `${element.paths.count()} 条路径`,
    );
  }
};

const inspectTextElement = (
  element: DesignEditing.TextElement,
  items: ManifestItem[],
  counters: Counters,
) => {
  counters.text += 1;
  const text = truncate(element.text.readPlaintext() || "(空文本)");
  pushItem(
    items,
    `文本-${String(counters.text).padStart(2, "0")}`,
    "text",
    text,
  );
};

const inspectEmbedElement = (
  element: DesignEditing.EmbedElement,
  items: ManifestItem[],
  counters: Counters,
) => {
  counters.embed += 1;
  pushItem(
    items,
    `嵌入-${String(counters.embed).padStart(2, "0")}`,
    "embed",
    truncate(element.url, 80),
  );
};

const inspectElements = (
  elements: readonly DesignEditing.AbsoluteElement[] | readonly DesignEditing.GroupContentElement[],
  items: ManifestItem[],
  counters: Counters,
  collectedRefs: CollectedRef[],
) => {
  for (const element of elements) {
    switch (element.type) {
      case "rect":
        inspectRectElement(element, items, counters, collectedRefs);
        break;
      case "shape":
        inspectShapeElement(element, items, counters, collectedRefs);
        break;
      case "group":
        inspectElements(element.contents.toArray(), items, counters, collectedRefs);
        break;
      default:
        break;
    }
  }
};

/**
 * 扫描当前页的用户上传素材，返回新增的下载条目。
 * seenRefKeys  跨页去重集合（传入后会被原地修改）
 * labelCounters 跨页序号计数器（传入后会被原地修改）
 */
export const scanCurrentPageAssets = async (
  seenRefKeys: Set<string>,
  labelCounters: { image: number; video: number },
): Promise<AssetDownloadItem[]> => {
  const counters: Counters = {
    text: 0,
    image: labelCounters.image,
    video: labelCounters.video,
    embed: 0,
    shape: 0,
    unsupported: 0,
  };
  const collectedRefs: CollectedRef[] = [];
  const items: ManifestItem[] = [];
  const newAssets: AssetDownloadItem[] = [];

  await openDesign({ type: "current_page" }, async (session) => {
    if (session.page.type === "absolute") {
      inspectElements(session.page.elements.toArray(), items, counters, collectedRefs);

      // 扫描页面背景（视频设计中，时间轴上的主视频轨道是页面背景而非元素）
      const bgMedia = session.page.background?.mediaContainer?.ref;
      if (bgMedia?.type === "image") {
        counters.image += 1;
        const label = `背景图片-${String(counters.image).padStart(2, "0")}`;
        collectedRefs.push({ label, itemIndex: items.length + 1, refType: "image", ref: bgMedia.imageRef });
        pushItem(items, label, "background-image", `imageRef=${bgMedia.imageRef}`);
      } else if (bgMedia?.type === "video") {
        counters.video += 1;
        const label = `背景视频-${String(counters.video).padStart(2, "0")}`;
        collectedRefs.push({ label, itemIndex: items.length + 1, refType: "video", ref: bgMedia.videoRef });
        pushItem(items, label, "background-video", `videoRef=${bgMedia.videoRef}`);
      }

      await Promise.all(
        collectedRefs.map(async (collected) => {
          const refKey = String(collected.ref);
          if (seenRefKeys.has(refKey)) return; // 跨页相同素材去重
          seenRefKeys.add(refKey);

          try {
            const options =
              collected.refType === "image"
                ? { type: "image" as const, ref: collected.ref }
                : { type: "video" as const, ref: collected.ref };
            const result = await getTemporaryUrl(options);
            newAssets.push({
              label: collected.label,
              url: result.url,
              assetType: collected.refType,
              urlExt: collected.refType === "video" ? ".mp4" : ".jpg",
            });
          } catch {
            // Canva 内置素材或无权访问，跳过
          }
        }),
      );
    }
  });

  // 更新外部计数器，使下次扫描从正确序号续编
  labelCounters.image = counters.image;
  labelCounters.video = counters.video;

  return newAssets;
};

export const buildManifest = async (
  response: ExportResponse,
  preCollectedAssets?: AssetDownloadItem[],
) => {
  const items: ManifestItem[] = [];
  const counters: Counters = {
    text: 0,
    image: 0,
    video: 0,
    embed: 0,
    shape: 0,
    unsupported: 0,
  };
  const collectedRefs: CollectedRef[] = [];
  const assetDownloadItems: AssetDownloadItem[] = [];

  const metadata = await getDesignMetadata();

  // getTemporaryUrl 必须在 openDesign 会话内调用，否则 ref 无效
  await openDesign({ type: "current_page" }, async (session) => {
    if (session.page.type === "absolute") {
      inspectElements(session.page.elements.toArray(), items, counters, collectedRefs);

      // 多页预扫描模式时跳过 URL 解析（使用传入的预收集素材）
      if (preCollectedAssets) return;

      // 在会话内解析 ref → 临时 URL
      await Promise.all(
        collectedRefs.map(async (collected) => {
          try {
            const options =
              collected.refType === "image"
                ? { type: "image" as const, ref: collected.ref }
                : { type: "video" as const, ref: collected.ref };
            const result = await getTemporaryUrl(options);

            // Canva CDN URL 不含原始文件名；用序号标签作为 ZIP 内文件名
            // 扩展名由 server.ts 根据 Content-Type 推断
            assetDownloadItems.push({
              label: collected.label,
              url: result.url,
              assetType: collected.refType,
              urlExt: collected.refType === "video" ? ".mp4" : ".jpg",
            });

            const item = items.find((i) => i.index === collected.itemIndex);
            if (item) item.detail = `已收录 → 素材/${collected.label}`;
          } catch (err) {
            // 记录真实错误原因（Canva 内置素材、权限不足等）
            const reason = err instanceof Error ? err.message : String(err);
            const item = items.find((i) => i.index === collected.itemIndex);
            if (item) {
              const isNative =
                reason.toLowerCase().includes("permission") ||
                reason.toLowerCase().includes("not found") ||
                reason.toLowerCase().includes("unauthorized");
              item.detail += isNative
                ? ` (Canva内置素材，无法下载)`
                : ` (获取失败: ${reason.slice(0, 60)})`;
            }
          }
        }),
      );
    }
  });

  const title =
    response.status === "completed"
      ? (response.title ?? metadata.title ?? "canva-export")
      : (metadata.title ?? "canva-export");

  const designTitle =
    response.status === "completed"
      ? (response.title ?? metadata.title ?? "未命名设计")
      : (metadata.title ?? "未命名设计");

  const exportedFileCount =
    response.status === "completed" ? response.exportBlobs.length : 0;

  const lines = [
    `设计标题: ${designTitle}`,
    `导出时间: ${new Date().toLocaleString("zh-CN")}`,
    `导出文件数: ${exportedFileCount}`,
    preCollectedAssets
      ? `素材扫描范围: 多页手动扫描汇总（共 ${preCollectedAssets.length} 个不重复用户素材）`
      : `素材扫描范围: 仅当前显示页（SDK 限制，多页设计请逐页切换后分别导出）`,
    `素材条目数: ${items.length}（已收录用户上传素材: ${(preCollectedAssets ?? assetDownloadItems).length} 个）`,
    "",
    "素材名称清单",
    ...items.map(
      (item) => `${item.index}. ${item.label} [${item.type}] ${item.detail}`,
    ),
  ];

  return {
    title,
    items,
    text: lines.join("\n"),
    json: JSON.stringify(
      {
        designTitle,
        exportedFileCount,
        generatedAt: new Date().toISOString(),
        userAssetCount: assetDownloadItems.length,
        items,
      },
      null,
      2,
    ),
    assetDownloadItems: preCollectedAssets ?? assetDownloadItems,
  };
};