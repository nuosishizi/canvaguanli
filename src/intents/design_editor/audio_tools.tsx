import { useState, useCallback } from "react";
import {
  Button,
  Rows,
  Text,
  TextInput,
  NumberInput,
  FormField,
  Select,
  Alert,
} from "@canva/app-ui-kit";
import { upload } from "@canva/asset";
import { addAudioTrack } from "@canva/design";
import type { AudioMimeType } from "@canva/asset";

type MimeOption = {
  label: string;
  value: AudioMimeType;
};

const MIME_OPTIONS: MimeOption[] = [
  { label: "MP3 (audio/mp3)", value: "audio/mp3" },
  { label: "MP4 (audio/mp4)", value: "audio/mp4" },
  { label: "MPEG (audio/mpeg)", value: "audio/mpeg" },
];

export const AudioTools = () => {
  const [audioUrl, setAudioUrl] = useState("");
  const [title, setTitle] = useState("");
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [mimeType, setMimeType] = useState<AudioMimeType>("audio/mp3");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    type: "positive" | "info" | "warn" | "critical";
    message: string;
  } | null>(null);

  const handleUploadAndAdd = useCallback(async () => {
    if (!audioUrl) {
      setStatus({ type: "warn", message: "请输入音频 URL" });
      return;
    }
    if (!title) {
      setStatus({ type: "warn", message: "请输入音频标题" });
      return;
    }
    if (!durationMs || durationMs <= 0) {
      setStatus({ type: "warn", message: "请输入有效的音频时长" });
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      // Step 1: Upload audio asset
      setStatus({ type: "info", message: "正在上传音频..." });

      const queuedAudio = await upload({
        type: "audio",
        url: audioUrl,
        mimeType,
        title,
        durationMs,
        aiDisclosure: "none",
      });

      // Wait for upload to complete
      await queuedAudio.whenUploaded();

      // Step 2: Add audio track to design
      setStatus({ type: "info", message: "正在添加到设计..." });

      await addAudioTrack({ ref: queuedAudio.ref });

      setStatus({ type: "positive", message: `音频 "${title}" 已添加到设计中` });
    } catch (err) {
      setStatus({
        type: "critical",
        message: `失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }, [audioUrl, title, durationMs, mimeType]);

  return (
    <Rows spacing="2u">
      <Text variant="bold">音频管理</Text>
      <Text size="small" tone="tertiary">
        上传音频并添加到当前设计的音轨
      </Text>

      <FormField
        label="音频 URL (HTTPS)"
        control={(props) => (
          <TextInput
            {...props}
            value={audioUrl}
            onChange={setAudioUrl}
            placeholder="https://example.com/audio.mp3"
          />
        )}
      />

      <FormField
        label="标题"
        control={(props) => (
          <TextInput
            {...props}
            value={title}
            onChange={setTitle}
            placeholder="背景音乐"
          />
        )}
      />

      <FormField
        label="时长 (毫秒)"
        control={(props) => (
          <NumberInput
            {...props}
            value={durationMs}
            onChange={(valueAsNumber) => setDurationMs(valueAsNumber)}
            placeholder="30000"
            min={1}
          />
        )}
      />

      <Select
        options={MIME_OPTIONS}
        value={mimeType}
        onChange={setMimeType}
        stretch
      />

      <Button
        variant="primary"
        onClick={handleUploadAndAdd}
        loading={loading}
        disabled={loading}
        stretch
      >
        上传并添加音频
      </Button>

      {status && <Alert tone={status.type}>{status.message}</Alert>}
    </Rows>
  );
};
