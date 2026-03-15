import { getDesignMetadata, openDesign } from "@canva/design";
import type { ExportResponse } from "@canva/design";
import type { DesignEditing } from "@canva/design";

export type ManifestItem = {
  index: number;
  label: string;
  type: string;
  detail: string;
};

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
) => {
  const media = element.fill.mediaContainer.ref;

  if (media?.type === "image") {
    counters.image += 1;
    pushItem(
      items,
      `图片-${String(counters.image).padStart(2, "0")}`,
      "image",
      `imageRef=${media.imageRef}`,
    );
    return;
  }

  if (media?.type === "video") {
    counters.video += 1;
    pushItem(
      items,
      `视频-${String(counters.video).padStart(2, "0")}`,
      "video",
      `videoRef=${media.videoRef}`,
    );
  }
};

const inspectShapeElement = (
  element: DesignEditing.ShapeElement,
  items: ManifestItem[],
  counters: Counters,
) => {
  let hasMedia = false;

  element.paths.forEach((path) => {
    const media = path.fill.mediaContainer.ref;
    if (media?.type === "image") {
      counters.image += 1;
      hasMedia = true;
      pushItem(
        items,
        `形状图片-${String(counters.image).padStart(2, "0")}`,
        "shape-image",
        `imageRef=${media.imageRef}`,
      );
    } else if (media?.type === "video") {
      counters.video += 1;
      hasMedia = true;
      pushItem(
        items,
        `形状视频-${String(counters.video).padStart(2, "0")}`,
        "shape-video",
        `videoRef=${media.videoRef}`,
      );
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
) => {
  for (const element of elements) {
    switch (element.type) {
      case "text":
        inspectTextElement(element, items, counters);
        break;
      case "rect":
        inspectRectElement(element, items, counters);
        break;
      case "shape":
        inspectShapeElement(element, items, counters);
        break;
      case "embed":
        inspectEmbedElement(element, items, counters);
        break;
      case "group":
        inspectElements(element.contents.toArray(), items, counters);
        break;
      case "unsupported":
        counters.unsupported += 1;
        pushItem(
          items,
          `未支持元素-${String(counters.unsupported).padStart(2, "0")}`,
          "unsupported",
          "Apps SDK 无法读取详细信息",
        );
        break;
      default:
        break;
    }
  }
};

export const buildManifest = async (response: ExportResponse) => {
  const items: ManifestItem[] = [];
  const counters: Counters = {
    text: 0,
    image: 0,
    video: 0,
    embed: 0,
    shape: 0,
    unsupported: 0,
  };

  const metadata = await getDesignMetadata();

  await openDesign({ type: "current_page" }, async (session) => {
    if (session.page.type === "absolute") {
      inspectElements(session.page.elements.toArray(), items, counters);
    }
  });

  const lines = [
    `设计标题: ${response.status === "completed" ? response.title ?? metadata.title ?? "未命名设计" : metadata.title ?? "未命名设计"}`,
    `导出时间: ${new Date().toLocaleString("zh-CN")}`,
    `导出文件数: ${response.status === "completed" ? response.exportBlobs.length : 0}`,
    `素材条目数: ${items.length}`,
    "",
    "素材名称清单",
    ...items.map(
      (item) => `${item.index}. ${item.label} [${item.type}] ${item.detail}`,
    ),
  ];

  return {
    title: response.status === "completed" ? response.title ?? metadata.title ?? "canva-export" : metadata.title ?? "canva-export",
    items,
    text: lines.join("\n"),
    json: JSON.stringify(
      {
        designTitle:
          response.status === "completed"
            ? response.title ?? metadata.title ?? "未命名设计"
            : metadata.title ?? "未命名设计",
        exportedFileCount:
          response.status === "completed" ? response.exportBlobs.length : 0,
        generatedAt: new Date().toISOString(),
        items,
      },
      null,
      2,
    ),
  };
};