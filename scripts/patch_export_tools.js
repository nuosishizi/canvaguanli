
const fs = require("fs");
const p = "C:/Users/newnew/canva-tools/src/intents/design_editor/export_tools.tsx";
let code = fs.readFileSync(p, "utf8");

// 1. Add states
const statesToAdd = `
  const [creator, setCreator] = useState<string>("");
  const [canvaId, setCanvaId] = useState<string>("");
  const [templateName, setTemplateName] = useState<string>("");
  const [registering, setRegistering] = useState(false);

`;
code = code.replace("const [packing, setPacking] = useState(false);", "const [packing, setPacking] = useState(false);\n" + statesToAdd);

// 2. Add handleRegisterDB
const handleRegisterDB = `
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
      setStatus({ type: "positive", message: \`✓ 成功注册了 \${data.count} 个素材到数据库\` });
    } catch (err: any) {
      setStatus({ type: "critical", message: \`注册失败: \${err.message}\` });
    } finally {
      setRegistering(false);
    }
  }, [creator, canvaId, templateName, scannedAssets]);
`;
code = code.replace("const handleExport = useCallback(async () => {", handleRegisterDB + "\n\n  const handleExport = useCallback(async () => {");

// 3. Add UI elements
const formUI = `      <Box padding="1u" background="neutralLow" borderRadius="standard">
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

`;
code = code.replace("<Button\n        variant=\"primary\"\n        onClick={handleExport}", formUI + "      <Button\n        variant=\"secondary\"\n        onClick={handleExport}");

fs.writeFileSync(p, code);

