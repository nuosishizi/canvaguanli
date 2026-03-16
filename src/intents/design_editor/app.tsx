import { Rows } from "@canva/app-ui-kit";
import * as styles from "styles/components.css";
import { ExportTools } from "./export_tools";

export const App = () => {
  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="3u">
        <ExportTools />
      </Rows>
    </div>
  );
};
