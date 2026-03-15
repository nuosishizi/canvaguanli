import { useState, useCallback } from "react";
import {
  Button,
  Rows,
  Text,
  TextInput,
  FormField,
  Alert,
} from "@canva/app-ui-kit";
import { editContent } from "@canva/design";
import type { RichtextRange } from "@canva/design";

export const TextTools = () => {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [status, setStatus] = useState<{
    type: "positive" | "info" | "warn" | "critical";
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReplace = useCallback(async () => {
    if (!findText) {
      setStatus({ type: "warn", message: "请输入要查找的文字" });
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      let totalReplaced = 0;

      await editContent(
        { contentType: "richtext", target: "current_page" },
        async (session) => {
          for (const content of session.contents) {
            const range = content as RichtextRange;
            const plaintext = range.readPlaintext();

            if (plaintext.includes(findText)) {
              // Count occurrences
              const regex = new RegExp(
                findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "g",
              );
              const matches = plaintext.match(regex);
              totalReplaced += matches ? matches.length : 0;

              // Replace by rebuilding the text
              const newText = plaintext.replaceAll(findText, replaceText);
              range.replaceText(
                { index: 0, length: plaintext.length },
                newText,
              );
            }
          }
          await session.sync();
        },
      );

      if (totalReplaced > 0) {
        setStatus({
          type: "positive",
          message: `已替换 ${totalReplaced} 处`,
        });
      } else {
        setStatus({ type: "info", message: "未找到匹配文字" });
      }
    } catch (err) {
      setStatus({
        type: "critical",
        message: `替换失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }, [findText, replaceText]);

  return (
    <Rows spacing="2u">
      <Text variant="bold">文字查找替换</Text>
      <Text size="small" tone="tertiary">
        替换当前页面中的文字内容
      </Text>

      <FormField
        label="查找"
        control={(props) => (
          <TextInput
            {...props}
            value={findText}
            onChange={setFindText}
            placeholder="输入要查找的文字"
          />
        )}
      />

      <FormField
        label="替换为"
        control={(props) => (
          <TextInput
            {...props}
            value={replaceText}
            onChange={setReplaceText}
            placeholder="输入替换后的文字"
          />
        )}
      />

      <Button
        variant="primary"
        onClick={handleReplace}
        loading={loading}
        disabled={loading}
        stretch
      >
        替换当前页
      </Button>

      {status && (
        <Alert tone={status.type}>{status.message}</Alert>
      )}
    </Rows>
  );
};
