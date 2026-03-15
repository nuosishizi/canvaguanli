import { useState } from "react";
import {
  Rows,
  SegmentedControl,
} from "@canva/app-ui-kit";
import * as styles from "styles/components.css";
import { TextTools } from "./text_tools";
import { ExportTools } from "./export_tools";
import { AudioTools } from "./audio_tools";

const TABS = [
  { label: "文字", value: "text" },
  { label: "导出", value: "export" },
  { label: "音频", value: "audio" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export const App = () => {
  const [activeTab, setActiveTab] = useState<TabValue>("text");

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="3u">
        <SegmentedControl
          options={TABS.map((t) => ({ label: t.label, value: t.value }))}
          value={activeTab}
          onChange={setActiveTab}
        />
        {activeTab === "text" && <TextTools />}
        {activeTab === "export" && <ExportTools />}
        {activeTab === "audio" && <AudioTools />}
      </Rows>
    </div>
  );
};
