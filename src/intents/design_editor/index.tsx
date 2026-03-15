import "@canva/app-ui-kit/styles.css";
import { AppI18nProvider } from "@canva/app-i18n-kit";
import { AppUiProvider } from "@canva/app-ui-kit";
import type { DesignEditorIntent } from "@canva/intents/design";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { App } from "./app";

let appRoot: Root | null = null;

function renderApp() {
  const container = document.getElementById("root") as Element;
  if (!appRoot) {
    appRoot = createRoot(container);
  }
  appRoot.render(
    <AppI18nProvider>
      <AppUiProvider>
        <App />
      </AppUiProvider>
    </AppI18nProvider>,
  );
}

async function render() {
  renderApp();
}

const designEditor: DesignEditorIntent = { render };
export default designEditor;

if (module.hot) {
  module.hot.accept("./app", renderApp);
}
