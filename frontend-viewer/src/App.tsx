import React, { useEffect, useMemo, useRef, useState } from "react";

/** 与 PySide 完全一致的命名/匹配规则 */
const IMAGE_RE = /^Persona_(?<pid>\d+)_Activity_(?<aid>\d+)\.(?:jpg|jpeg|png)$/i;
const NARR_RE  = /^Persona_(?<pid>\d+)_Activity_(?<aid>\d+)_Description\.(?:txt|md)$/i;

type Key = `${number}-${number}`;
type ImgRec  = { key: Key; pid: number; aid: number; file: File; url: string; name: string };
type NarrRec = { key: Key; pid: number; aid: number; file: File; name: string };

type Phase = "I" | "II";

type UserForm = {
  id: string;
  age: string;
  gender: string;
  education: string;
  occupation: string;
  smartAssistantExp: string;
  techComfort: string; // "1"–"7"
};

type Choice = "A" | "B";

/** 小标题盒子：填满父容器的高度 */
type SectionBoxProps = {
  title: string;
  children: React.ReactNode;
  emphasized?: boolean;
};

const SectionBox: React.FC<SectionBoxProps> = ({ title, children, emphasized }) => {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        borderRadius: 12,
        border: emphasized ? "2px solid #60a5fa" : "2px solid #4b5563",
        boxShadow: emphasized ? "0 0 0 1px rgba(37,99,235,0.4)" : "none",
        background: "#020617",
        overflow: "hidden"
      }}
    >
      {title && (
        <div
          className="card-header"
          style={{
            fontWeight: 900,
            fontSize: 35,
            padding: "6px 10px",
            borderBottom: "1px solid #1f2937",
            color: emphasized ? "#93c5fd" : "#e5e7eb"
          }}
        >
          {title}
        </div>
      )}

      <div className="card-body" style={{ padding: 8, minHeight: 0, height: "100%" }}>
        <div style={{ display: "flex", minHeight: 0, height: "100%" }}>
          <div style={{ flex: "1 1 auto", minHeight: 0 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/** 顶部提示（保留，以后用得上） */
function flash(text: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => document.body.removeChild(el), 250);
  }, 1400);
}

const DarkBtn: React.FC<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className="btn"
    style={{
      padding: "14px 24px",
      fontSize: 35,
      fontWeight: 800,
      color: "#e5e7eb",
      background: active ? "#0b1220" : "#111827",
      border: active ? "2px solid #60a5fa" : "1px solid #374151",
      borderRadius: 12
    }}
    aria-pressed={active}
  >
    {children}
  </button>
);

const PhaseBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    className="btn"
    onClick={onClick}
    style={{
      fontSize: 35,
      fontWeight: 700,
      padding: "6px 14px",
      borderRadius: 12,
      border: active ? "2px solid #60a5fa" : "1px solid #4b5563",
      background: active ? "#0b1220" : "#111827",
      color: active ? "#93c5fd" : "#e5e7eb"
    }}
  >
    {children}
  </button>
);

export default function App() {
  // ------- Phase 切换 -------
  const [phase, setPhase] = useState<Phase>("I");

  // ------- TXT 输出文件夹句柄 -------
  const [txtDirHandle, setTxtDirHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // ------- User ID & User Info 表单 -------
  const [userId, setUserId] = useState<string>("");
  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>({
    id: "",
    age: "",
    gender: "",
    education: "",
    occupation: "",
    smartAssistantExp: "",
    techComfort: "4"
  });

  // ------- Survey -------
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyQ1, setSurveyQ1] = useState("");
  const [surveyQ2, setSurveyQ2] = useState("");
  const [surveyQ3, setSurveyQ3] = useState("");
  const [surveyQ4, setSurveyQ4] = useState("");
  const [surveyQ5, setSurveyQ5] = useState("");

  // ------- 目录输入（隐藏 input，分别给 Phase I/II） -------
  const imgDirRefI = useRef<HTMLInputElement>(null);
  const narrDirRefI = useRef<HTMLInputElement>(null);
  const imgDirRefII = useRef<HTMLInputElement>(null);
  const narrDirRefII = useRef<HTMLInputElement>(null);

  // 当前显示的文件（随着 phase 变化）
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [narratorFiles, setNarratorFiles] = useState<File[]>([]);

  // 各 Phase 自己的文件列表
  const [imageFilesI, setImageFilesI] = useState<File[]>([]);
  const [narratorFilesI, setNarratorFilesI] = useState<File[]>([]);
  const [imageFilesII, setImageFilesII] = useState<File[]>([]);
  const [narratorFilesII, setNarratorFilesII] = useState<File[]>([]);

  // File System Access API 目录句柄（images / narrator）
  const [imgHandleI, setImgHandleI] = useState<FileSystemDirectoryHandle | null>(null);
  const [narrHandleI, setNarrHandleI] = useState<FileSystemDirectoryHandle | null>(null);
  const [imgHandleII, setImgHandleII] = useState<FileSystemDirectoryHandle | null>(null);
  const [narrHandleII, setNarrHandleII] = useState<FileSystemDirectoryHandle | null>(null);

  // 索引与映射（当前 phase 的）
  const [images, setImages] = useState<Record<Key, ImgRec>>({});
  const [narrs, setNarrs] = useState<Record<Key, NarrRec>>({});
  const [byPersona, setByPersona] = useState<Record<number, number[]>>({});

  // 当前选中 image
  const [selectedKey, setSelectedKey] = useState<Key | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [selectedAid, setSelectedAid] = useState<number | null>(null);

  // Narrator JSON 字段
  const [userNameFromNarr, setUserNameFromNarr] = useState<string>("");
  const [activityDesc, setActivityDesc] = useState<string>("");
  const [smartTextA, setSmartTextA] = useState<string>("");

  // Phase I: A/B 选择
  const [variant, setVariant] = useState<Choice>("A");
  const [phaseIResults, setPhaseIResults] = useState<
    { image: string; choice: Choice }[]
  >([]);

  // Phase II: Interaction 文本
  const [interactionText, setInteractionText] = useState<string>("");

  // 拖动中间分隔
  const [splitPct, setSplitPct] = useState<number>(58);
  const draggingRef = useRef(false);

  // ============== 通用：保存 txt 文件 ==============
  async function saveTextFile(filename: string, contents: string) {
    if (txtDirHandle) {
      try {
        // @ts-ignore
        const fileHandle = await txtDirHandle.getFileHandle(filename, { create: true });
        // @ts-ignore
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
        return;
      } catch (e) {
        console.error("Failed to save to chosen folder, fallback to download", e);
      }
    }

    // fallback: 浏览器下载
    const blob = new Blob([contents], {
      type: "text/plain;charset=utf-8"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 0);
  }

  // 选择 TXT 文件夹按钮
  async function chooseTxtDirFS() {
    // @ts-ignore
    if (!window.showDirectoryPicker) {
      alert("Browser does not support choosing a folder. TXT files will be downloaded instead.");
      return;
    }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "txt-output-dir" });
    setTxtDirHandle(handle);
    alert("TXT output folder set successfully.");
  }

  // ============== 构建索引（当前 imageFiles + narratorFiles） ==============
  useEffect(() => {
    const imgMap: Record<Key, ImgRec> = {};
    const per: Record<number, Set<number>> = {};
    for (const f of imageFiles) {
      const name = f.name.trim();
      const m = name.match(IMAGE_RE);
      if (!m?.groups) continue;
      const pid = parseInt(m.groups.pid, 10);
      const aid = parseInt(m.groups.aid, 10);
      const key: Key = `${pid}-${aid}`;
      imgMap[key] = { key, pid, aid, file: f, url: URL.createObjectURL(f), name };
      (per[pid] ||= new Set()).add(aid);
    }

    const narrMap: Record<Key, NarrRec> = {};
    for (const f of narratorFiles) {
      const name = f.name.trim();
      const m = name.match(NARR_RE);
      if (!m?.groups) continue;
      const pid = parseInt(m.groups.pid, 10);
      const aid = parseInt(m.groups.aid, 10);
      const key: Key = `${pid}-${aid}`;
      narrMap[key] = { key, pid, aid, file: f, name };
    }

    const perOut: Record<number, number[]> = {};
    for (const [pidStr, aids] of Object.entries(per)) {
      perOut[Number(pidStr)] = Array.from(aids).sort((a, b) => a - b);
    }

    setImages(imgMap);
    setNarrs(narrMap);
    setByPersona(perOut);

    const sorted = Object.values(imgMap).sort(
      (a, b) => a.pid - b.pid || a.aid - b.aid
    );
    if (sorted.length) {
      const first = sorted[0];
      setSelectedKey(first.key);
      setSelectedPid(first.pid);
      setSelectedAid(first.aid);
    } else {
      setSelectedKey(null);
      setSelectedPid(null);
      setSelectedAid(null);
    }

    return () => {
      Object.values(imgMap).forEach(r => URL.revokeObjectURL(r.url));
    };
  }, [imageFiles, narratorFiles]);

  // ============== 当选中图片变更时，读取 Narrator JSON ==============
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!selectedKey) {
        if (!cancelled) {
          setUserNameFromNarr("");
          setActivityDesc("");
          setSmartTextA("");
        }
        return;
      }

      const rec = narrs[selectedKey];
      if (!rec) {
        if (!cancelled) {
          setUserNameFromNarr("");
          setActivityDesc("");
          setSmartTextA("");
        }
        return;
      }

      try {
        const raw = await rec.file.text();
        const data = JSON.parse(raw);

        if (cancelled) return;

        const userName = (data["User Name"] ?? "").toString();
        const activity = (data["Activity Description"] ?? "").toString();
        const smart = (data["Smart Assistant Interaction"] ?? "").toString();

        setUserNameFromNarr(userName);
        setActivityDesc(activity);
        setSmartTextA(smart);
      } catch (err) {
        if (!cancelled) {
          setUserNameFromNarr("");
          setActivityDesc("");
          setSmartTextA("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedKey, narrs]);

  // ============== Phase 切换时，清空 Interaction 文本 ==============
  useEffect(() => {
    setInteractionText("");
  }, [selectedKey, phase]);

  // ============== 下拉选项 ==============
  const filenameOptions = useMemo(
    () => Object.values(images).sort((a, b) => a.pid - b.pid || a.aid - b.aid),
    [images]
  );
  const personaOptions = useMemo(
    () => Object.keys(byPersona).map(Number).sort((a, b) => a - b),
    [byPersona]
  );
  const activityOptions = useMemo(
    () => (selectedPid == null ? [] : byPersona[selectedPid] || []),
    [byPersona, selectedPid]
  );

  // ============== 选择联动 ==============
  const currentImg = selectedKey ? images[selectedKey] : null;

  function selectByKey(key: Key | null) {
    if (!key) return;
    const rec = images[key];
    if (!rec) return;
    setSelectedKey(key);
    setSelectedPid(rec.pid);
    setSelectedAid(rec.aid);
  }
  function onFilenameChange(name: string) {
    const rec = filenameOptions.find(r => r.name === name);
    if (rec) selectByKey(rec.key);
  }
  function onPersonaChange(pidStr: string) {
    const pid = Number(pidStr);
    setSelectedPid(pid);
    const aids = byPersona[pid] || [];
    if (aids.length) {
      const key: Key = `${pid}-${aids[0]}`;
      if (images[key]) selectByKey(key);
    }
  }
  function onActivityChange(aidStr: string) {
    if (selectedPid == null) return;
    const key: Key = `${selectedPid}-${Number(aidStr)}`;
    if (images[key]) selectByKey(key);
  }

  // ============== User Info 表单 ==============
  function openUserForm() {
    setUserForm(prev => ({
      ...prev,
      id: userId || prev.id
    }));
    setShowUserForm(true);
  }

  async function onSaveUserInfo() {
    const u = userForm;
    if (!u.id) {
      alert("Please enter User ID");
      return;
    }
    setUserId(u.id);

    const lines: string[] = [];
    lines.push(`User ID: ${u.id}`);
    lines.push("");
    lines.push("Section 1. Basic Demographics");
    lines.push(`Age: ${u.age || "<empty>"}`);
    lines.push(`Gender: ${u.gender || "<empty>"}`);
    lines.push(`Education Level: ${u.education || "<empty>"}`);
    lines.push(`Occupation: ${u.occupation || "<empty>"}`);
    lines.push(
      `Experience with Smart Assistants: ${u.smartAssistantExp || "<empty>"}`
    );
    lines.push(
      `Comfort with technology (1–7): ${u.techComfort || "<empty>"}`
    );

    await saveTextFile(`User_${u.id}_Info.txt`, lines.join("\n"));

    alert("User info saved successfully.");
    setShowUserForm(false);
  }

  // ============== Phase I：A/B 选择记录 + 写 txt + 弹窗 + 可导出汇总 ==============
  async function recordChoiceForCurrentImage(choice: Choice) {
    if (!userId) {
      alert("Please enter User ID first");
      return;
    }
    if (!currentImg) {
      alert("No image selected");
      return;
    }

    setVariant(choice);

    // 本地记录到数组（用于 Export Phase I 汇总）
    const updated = [...phaseIResults, { image: currentImg.name, choice }];
    setPhaseIResults(updated);

    const lines: string[] = [];
    lines.push(`User ID: ${userId}`);
    lines.push(`Image Name: ${currentImg.name}`);
    lines.push(`Result: ${choice}`);
    lines.push(`Saved At: ${new Date().toISOString()}`);

    const safeName = currentImg.name.replace(/[^\w.-]+/g, "_");
    await saveTextFile(
      `Selection_User_${userId}_${safeName}_${choice}.txt`,
      lines.join("\n")
    );

    alert("Selection saved successfully.");
  }

  async function exportPhaseIResults() {
    if (!userId) {
      alert("Please enter User ID first");
      return;
    }
    if (!phaseIResults.length) {
      alert("No selections yet");
      return;
    }

    const lines: string[] = [];
    lines.push(`User ID: ${userId}`);
    lines.push("");
    lines.push("Image Name, Result (A/B)");
    for (const r of phaseIResults) {
      lines.push(`${r.image}, ${r.choice}`);
    }

    await saveTextFile(
      `Selections_User_${userId}.txt`,
      lines.join("\n")
    );

    alert("Exported Phase I selections.");
  }

  // ============== Phase I：Next Image ==============
  function goNextImage() {
    if (!currentImg) {
      alert("No image selected");
      return;
    }
    const idx = filenameOptions.findIndex(r => r.key === currentImg.key);
    if (idx >= 0 && idx + 1 < filenameOptions.length) {
      const nextRec = filenameOptions[idx + 1];
      selectByKey(nextRec.key);
    } else {
      alert("Already at last image.");
    }
  }

  // ============== Phase II：保存 Interaction ==============
  async function onSaveInteraction() {
    if (!userId) {
      alert("Please enter User ID first");
      return;
    }
    if (!currentImg) {
      alert("No image selected");
      return;
    }

    const safeName = currentImg.name.replace(/[^\w.-]+/g, "_");
    const contents = `User ID: ${userId}
Image Name: ${currentImg.name}

Interaction:
${interactionText || "<empty>"}
`;

    await saveTextFile(
      `Interaction_User_${userId}_${safeName}.txt`,
      contents
    );

    alert("Interaction saved successfully.");
  }

  // ============== Survey 保存 ==============
  async function onSaveSurvey() {
    if (!userId) {
      alert("Please enter User ID first");
      return;
    }

    const lines: string[] = [];
    lines.push(`User ID: ${userId}`);
    lines.push("");
    lines.push(`Q1 (Over time, did the assistant’s responses seem to): ${surveyQ1}`);
    lines.push(
      `Q2 (How well did the assistant learn and adapt to your preferences?): ${surveyQ2}`
    );
    lines.push(
      `Q3 (How much did you trust the assistant’s decisions and actions by the end of the study?): ${surveyQ3}`
    );
    lines.push(
      `Q4 (How did the assistant’s learning or changes affect your comfort, satisfaction, or willingness to use it again?): ${surveyQ4}`
    );
    lines.push(
      `Q5 (What features or behaviors would make a self-improving assistant more useful and trustworthy / Satisfaction): ${surveyQ5}`
    );

    await saveTextFile(
      `Survey_User_${userId}.txt`,
      lines.join("\n")
    );

    alert("Survey saved successfully.");
    setShowSurvey(false);
  }

  // ============== 真正“读盘”的刷新 ==============
  async function reloadFromHandle(
    h: FileSystemDirectoryHandle | null,
    re: RegExp
  ): Promise<File[]> {
    const files: File[] = [];
    if (!h) return files;
    // @ts-ignore
    for await (const [, entry] of h.entries()) {
      if (entry.kind === "file") {
        const f = await (entry as FileSystemFileHandle).getFile();
        if (re.test(f.name)) files.push(f);
      }
    }
    return files;
  }

  // ============== Phase I / II 的 Load 按钮 ==============
  function pickImagesDirI() {
    if (imgDirRefI.current) {
      imgDirRefI.current.value = "";
      imgDirRefI.current.click();
    }
  }
  function pickNarrDirI() {
    if (narrDirRefI.current) {
      narrDirRefI.current.value = "";
      narrDirRefI.current.click();
    }
  }
  function pickImagesDirII() {
    if (imgDirRefII.current) {
      imgDirRefII.current.value = "";
      imgDirRefII.current.click();
    }
  }
  function pickNarrDirII() {
    if (narrDirRefII.current) {
      narrDirRefII.current.value = "";
      narrDirRefII.current.click();
    }
  }

  async function chooseImagesDirFS_I() {
    // @ts-ignore
    if (!window.showDirectoryPicker) {
      pickImagesDirI();
      return;
    }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "images-dir-I" });
    setImgHandleI(handle);
    const files = await reloadFromHandle(handle, IMAGE_RE);
    setImageFilesI(files);
    if (phase === "I") setImageFiles(files);
  }

  async function chooseNarrDirFS_I() {
    // @ts-ignore
    if (!window.showDirectoryPicker) {
      pickNarrDirI();
      return;
    }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "narr-dir-I" });
    setNarrHandleI(handle);
    const files = await reloadFromHandle(handle, NARR_RE);
    setNarratorFilesI(files);
    if (phase === "I") setNarratorFiles(files);
  }

  async function chooseImagesDirFS_II() {
    // @ts-ignore
    if (!window.showDirectoryPicker) {
      pickImagesDirII();
      return;
    }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "images-dir-II" });
    setImgHandleII(handle);
    const files = await reloadFromHandle(handle, IMAGE_RE);
    setImageFilesII(files);
    if (phase === "II") setImageFiles(files);
  }

  async function chooseNarrDirFS_II() {
    // @ts-ignore
    if (!window.showDirectoryPicker) {
      pickNarrDirII();
      return;
    }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "narr-dir-II" });
    setNarrHandleII(handle);
    const files = await reloadFromHandle(handle, NARR_RE);
    setNarratorFilesII(files);
    if (phase === "II") setNarratorFiles(files);
  }

  // Phase 切换按钮
  function goPhaseI() {
    setPhase("I");
    setImageFiles(imageFilesI);
    setNarratorFiles(narratorFilesI);
  }

  function goPhaseII() {
    setPhase("II");
    setImageFiles(imageFilesII);
    setNarratorFiles(narratorFilesII);
  }

  // ============== Splitter 拖动 ==============
  function onMouseMove(e: MouseEvent) {
    if (!draggingRef.current) return;
    const container = document.querySelector(
      ".center-split"
    ) as HTMLElement | null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.min(80, Math.max(20, (x / rect.width) * 100));
    setSplitPct(pct);
  }
  function onMouseUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "default";
  }
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const statusLeft = currentImg
    ? `Image: images/${currentImg.name}`
    : "Image: <none>";
  const statusRight =
    selectedKey && narrs[selectedKey]
      ? `Narrator: Narrator/${narrs[selectedKey].name}`
      : "Narrator: <missing>";

  // ============== 主渲染 ==============
  return (
    <div className="page dark">
      {/* 顶部工具栏 */}
      <div
        className="toolbar card dark"
        style={{
          padding: "12px 18px"
        }}
      >
        <div
          className="toolbar-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12
          }}
        >
          <div className="label" style={{ fontSize: 35 }}>
            File
          </div>
          <select
            className="select dark"
            style={{ fontSize: 35 }}
            value={currentImg?.name || ""}
            onChange={e => onFilenameChange(e.target.value)}
          >
            {filenameOptions.length === 0 && (
              <option value="">(no images)</option>
            )}
            {filenameOptions.map(rec => (
              <option key={rec.key} value={rec.name}>
                {rec.name}
              </option>
            ))}
          </select>

          <div className="label" style={{ fontSize: 35 }}>
            Persona
          </div>
          <select
            className="select dark"
            style={{ fontSize: 35 }}
            value={selectedPid != null ? String(selectedPid) : ""}
            onChange={e => onPersonaChange(e.target.value)}
          >
            {personaOptions.length === 0 && (
              <option value="">(no personas)</option>
            )}
            {personaOptions.map(pid => (
              <option key={pid} value={String(pid)}>
                {pid}
              </option>
            ))}
          </select>

          <div className="label" style={{ fontSize: 35 }}>
            Activity
          </div>
          <select
            className="select dark"
            style={{ fontSize: 35 }}
            value={selectedAid != null ? String(selectedAid) : ""}
            onChange={e => onActivityChange(e.target.value)}
          >
            {activityOptions.length === 0 && (
              <option value="">(no activities)</option>
            )}
            {activityOptions.map(aid => (
              <option key={aid} value={String(aid)}>
                {aid}
              </option>
            ))}
          </select>

          {/* User ID */}
          <div className="label" style={{ fontSize: 35 }}>
            User ID
          </div>
          <input
            className="input"
            style={{ fontSize: 35, padding: "6px 8px", width: 160 }}
            value={userId}
            onChange={e =>
              setUserId(e.target.value.replace(/[^0-9]/g, ""))
            }
          />

          <button
            className="btn btn-secondary"
            style={{ fontSize: 35 }}
            onClick={openUserForm}
          >
            New User
          </button>

          <button
            className="btn btn-secondary"
            style={{ fontSize: 35 }}
            onClick={() => setShowSurvey(true)}
          >
            Survey
          </button>

          {/* Phase I 导出 */}
          <button
            className="btn btn-primary"
            style={{ fontSize: 35 }}
            onClick={exportPhaseIResults}
          >
            Export Phase I
          </button>

          {/* Phase 切换 */}
          <PhaseBtn active={phase === "I"} onClick={goPhaseI}>
            Phase I
          </PhaseBtn>
          <PhaseBtn active={phase === "II"} onClick={goPhaseII}>
            Phase II
          </PhaseBtn>

          {/* TXT 输出文件夹 */}
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={chooseTxtDirFS}
          >
            Set TXT Folder
          </button>

          <div className="spacer" />

          {/* Load 按钮：分别给 I / II */}
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={chooseImagesDirFS_I}
          >
            Load Images I
          </button>
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={chooseNarrDirFS_I}
          >
            Load Narrator I
          </button>
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={chooseImagesDirFS_II}
          >
            Load Images II
          </button>
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={chooseNarrDirFS_II}
          >
            Load Narrator II
          </button>

          {/* 隐藏 input 作为回退 */}
          <input
            ref={imgDirRefI}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            hidden
            onChange={e => {
              const fs = e.target.files ? Array.from(e.target.files) : [];
              setImageFilesI(fs);
              if (phase === "I") setImageFiles(fs);
            }}
          />
          <input
            ref={narrDirRefI}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            hidden
            onChange={e => {
              const fs = e.target.files ? Array.from(e.target.files) : [];
              setNarratorFilesI(fs);
              if (phase === "I") setNarratorFiles(fs);
            }}
          />
          <input
            ref={imgDirRefII}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            hidden
            onChange={e => {
              const fs = e.target.files ? Array.from(e.target.files) : [];
              setImageFilesII(fs);
              if (phase === "II") setImageFiles(fs);
            }}
          />
          <input
            ref={narrDirRefII}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            hidden
            onChange={e => {
              const fs = e.target.files ? Array.from(e.target.files) : [];
              setNarratorFilesII(fs);
              if (phase === "II") setNarratorFiles(fs);
            }}
          />
        </div>
      </div>

      {/* 中部内容：根据是否显示 User Form / Survey 决定内容 */}
      {showUserForm ? (
        // ========== 用户信息独立页面（竖排） ==========
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 900,
              height: "100%",
              maxHeight: "100%"
            }}
          >
            <SectionBox title={`User Information Record`}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  fontSize: 35
                }}
              >
                {/* User ID */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>User ID</div>
                  <input
                    className="input"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 35 }}
                    value={userForm.id}
                    onChange={e =>
                      setUserForm(f => ({
                        ...f,
                        id: e.target.value.replace(/[^0-9]/g, "")
                      }))
                    }
                  />
                </div>

                {/* Age */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>Age</div>
                  <select
                    className="select dark"
                    style={{ width: "100%", minWidth: 0, fontSize: 35 }}
                    value={userForm.age}
                    onChange={e =>
                      setUserForm(f => ({ ...f, age: e.target.value }))
                    }
                  >
                    <option value="">-- select --</option>
                    <option value="18–24">18–24</option>
                    <option value="25–34">25–34</option>
                    <option value="35–44">35–44</option>
                    <option value="45–54">45–54</option>
                    <option value="55–60">55–60</option>
                  </select>
                </div>

                {/* Gender */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>Gender</div>
                  <select
                    className="select dark"
                    style={{ width: "100%", minWidth: 0, fontSize: 35 }}
                    value={userForm.gender}
                    onChange={e =>
                      setUserForm(f => ({ ...f, gender: e.target.value }))
                    }
                  >
                    <option value="">-- select --</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Non-binary / Self-describe">
                      Non-binary / Self-describe
                    </option>
                    <option value="Prefer not to answer">
                      Prefer not to answer
                    </option>
                  </select>
                </div>

                {/* Education */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>Education Level</div>
                  <select
                    className="select dark"
                    style={{ width: "100%", minWidth: 0, fontSize: 35 }}
                    value={userForm.education}
                    onChange={e =>
                      setUserForm(f => ({
                        ...f,
                        education: e.target.value
                      }))
                    }
                  >
                    <option value="">-- select --</option>
                    <option value="High school diploma or equivalent">
                      High school diploma or equivalent
                    </option>
                    <option value="Some college">Some college</option>
                    <option value="Bachelor’s degree">Bachelor’s degree</option>
                    <option value="Master’s degree">Master’s degree</option>
                    <option value="Doctoral degree">Doctoral degree</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Occupation */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>Occupation / Field of Work or Study</div>
                  <input
                    className="input"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 35
                    }}
                    value={userForm.occupation}
                    onChange={e =>
                      setUserForm(f => ({
                        ...f,
                        occupation: e.target.value
                      }))
                    }
                  />
                </div>

                {/* Experience with Smart Assistants */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>Experience with Smart Assistants</div>
                  <select
                    className="select dark"
                    style={{ width: "100%", minWidth: 0, fontSize: 35 }}
                    value={userForm.smartAssistantExp}
                    onChange={e =>
                      setUserForm(f => ({
                        ...f,
                        smartAssistantExp: e.target.value
                      }))
                    }
                  >
                    <option value="">-- select --</option>
                    <option value="None">None</option>
                    <option value="Occasional user">Occasional user</option>
                    <option value="Regular user">Regular user</option>
                    <option value="Daily user">Daily user</option>
                  </select>
                </div>

                {/* Comfort with technology */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    Comfort with technology (1 = Not comfortable, 7 = Very
                    comfortable)
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12
                    }}
                  >
                    <input
                      type="range"
                      min={1}
                      max={7}
                      value={userForm.techComfort}
                      onChange={e =>
                        setUserForm(f => ({
                          ...f,
                          techComfort: e.target.value
                        }))
                      }
                    />
                    <div
                      style={{
                        width: 60,
                        textAlign: "center",
                        fontSize: 35
                      }}
                    >
                      {userForm.techComfort}
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 24,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 16
                }}
              >
                <button
                  className="btn btn-hollow"
                  style={{ fontSize: 35 }}
                  onClick={() => setShowUserForm(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 35 }}
                  onClick={onSaveUserInfo}
                >
                  Save User Info
                </button>
              </div>
            </SectionBox>
          </div>
        </div>
      ) : (
        <>
          {/* 中部：可拖动分隔的左右面板 */}
          <div
            className="center-split"
            style={{
              display: "grid",
              gridTemplateColumns: `${splitPct}% 6px ${100 - splitPct}%`,
              height: "calc(100vh - 120px)",
              minHeight: 0
            }}
          >
            {/* 左：单张图片 */}
            <div
              className="panel image-panel"
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                overflow: "hidden",
                background: "#0b1220",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 0
              }}
            >
              {currentImg ? (
                <img
                  src={currentImg.url}
                  alt={currentImg.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    display: "block"
                  }}
                />
              ) : (
                <div className="placeholder">No image</div>
              )}
            </div>

            {/* 分隔条 */}
            <div
              className="divider"
              onMouseDown={e => {
                e.preventDefault();
                draggingRef.current = true;
                document.body.style.cursor = "col-resize";
              }}
              onDoubleClick={() => setSplitPct(58)}
              title="Drag to resize"
              style={{ cursor: "col-resize", background: "#94a3b8" }}
            />

            {/* 右：Phase I / Phase II 不同内容 */}
            {phase === "I" ? (
              // ---------- Phase I：原 Storyboard 视图 ----------
              <div
                className="panel text-panel"
                style={{
                  display: "grid",
                  gridTemplateRows: "5fr auto 3fr 3fr",
                  gap: 10,
                  minHeight: 0
                }}
              >
                {/* Narrator */}
                <SectionBox title="">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      height: "100%",
                      padding: "4px 8px 8px 8px"
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: 35,
                        marginBottom: 10,
                        lineHeight: 1.2
                      }}
                    >
                      Based on the following activity description:
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%"
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 400,
                          fontSize: 35,
                          marginBottom: 6
                        }}
                      >
                        User Name: {userNameFromNarr || "PlaceHolder"}
                      </div>
                      <textarea
                        className="narr"
                        value={activityDesc}
                        onChange={e => setActivityDesc(e.target.value)}
                        style={{
                          height: "100%",
                          width: "100%",
                          resize: "none",
                          fontSize: 35,
                          lineHeight: 1.5
                        }}
                      />
                    </div>
                  </div>
                </SectionBox>

                {/* Storyboard 选择 */}
                <div
                  className="card"
                  style={{
                    padding: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 12
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 35 }}>
                    Which Smart Assistant interaction method do you prefer?
                  </div>

                  <DarkBtn
                    active={variant === "A"}
                    onClick={() => setVariant("A")}
                  >
                    A
                  </DarkBtn>
                  <DarkBtn
                    active={variant === "B"}
                    onClick={() => setVariant("B")}
                  >
                    B
                  </DarkBtn>

                  <button
                    className="btn btn-primary"
                    style={{
                      marginLeft: 16,
                      fontSize: 35,
                      fontWeight: 500,
                      padding: "10px 24px"
                    }}
                    onClick={() => recordChoiceForCurrentImage(variant)}
                  >
                    Confirm Selection
                  </button>

                  <button
                    className="btn btn-hollow"
                    style={{
                      marginLeft: 16,
                      fontSize: 35,
                      fontWeight: 500,
                      padding: "10px 24px"
                    }}
                    onClick={goNextImage}
                  >
                    Next Image
                  </button>
                </div>

                {/* A：展示 Smart Assistant Interaction 文案 */}
                <SectionBox title="A" emphasized={variant === "A"}>
                  <textarea
                    className="narr"
                    readOnly
                    value={smartTextA || "PlaceHolder A"}
                    style={{
                      height: "100%",
                      width: "100%",
                      resize: "none",
                      fontSize: 35,
                      lineHeight: 1.6
                    }}
                  />
                </SectionBox>

                {/* B：同一文案，PlaceHolder B */}
                <SectionBox title="B" emphasized={variant === "B"}>
                  <textarea
                    className="narr"
                    readOnly
                    value={smartTextA || "PlaceHolder B"}
                    style={{
                      height: "100%",
                      width: "100%",
                      resize: "none",
                      fontSize: 35,
                      lineHeight: 1.6
                    }}
                  />
                </SectionBox>
              </div>
            ) : (
              // ---------- Phase II：新的 Interaction 视图 ----------
              <div
                className="panel text-panel"
                style={{
                  display: "grid",
                  gridTemplateRows: "5fr 5fr",
                  gap: 10,
                  minHeight: 0
                }}
              >
                {/* 上方：根据 Smart Assistant Interaction */}
                <SectionBox title="">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      height: "100%",
                      padding: "4px 8px 8px 8px"
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: 35,
                        marginBottom: 10,
                        lineHeight: 1.2
                      }}
                    >
                      Based on the description of interaction with smart
                      assistant.
                    </div>

                    <textarea
                      className="narr"
                      readOnly
                      value={smartTextA}
                      style={{
                        height: "100%",
                        width: "100%",
                        resize: "none",
                        fontSize: 35,
                        lineHeight: 1.5
                      }}
                    />
                  </div>
                </SectionBox>

                {/* 下方：Interaction 输入 + SAVE */}
                <SectionBox title="Interaction">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      height: "100%",
                      padding: "4px 8px 8px 8px"
                    }}
                  >
                    <textarea
                      className="narr"
                      value={interactionText}
                      onChange={e => setInteractionText(e.target.value)}
                      placeholder="Type any interaction notes here..."
                      style={{
                        height: "100%",
                        width: "100%",
                        resize: "none",
                        fontSize: 35,
                        lineHeight: 1.5
                      }}
                    />
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        justifyContent: "flex-end"
                      }}
                    >
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 35, padding: "8px 24px" }}
                        onClick={onSaveInteraction}
                      >
                        SAVE Interaction
                      </button>
                    </div>
                  </div>
                </SectionBox>
              </div>
            )}
          </div>
        </>
      )}

      {/* Survey 弹窗 */}
      {showSurvey && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }}
        >
          <div
            style={{
              background: "#020617",
              borderRadius: 16,
              padding: 24,
              width: "80%",
              maxWidth: 900,
              maxHeight: "90vh",
              overflowY: "auto",
              color: "#e5e7eb"
            }}
          >
            <div
              style={{
                fontSize: 35,
                fontWeight: 900,
                marginBottom: 16
              }}
            >
              Section 4. Post-Study Survey
            </div>
            <div
              style={{
                fontSize: 35,
                marginBottom: 16
              }}
            >
              Please reflect on your overall experience interacting with the
              smart assistant.
            </div>

            {/* Q1 */}
            <div style={{ marginBottom: 16, fontSize: 35 }}>
              <div style={{ marginBottom: 8 }}>
                Over time, did the assistant’s responses seem to:
              </div>
              <select
                className="select dark"
                style={{ fontSize: 35, width: "100%" }}
                value={surveyQ1}
                onChange={e => setSurveyQ1(e.target.value)}
              >
                <option value="">-- select --</option>
                <option value="Strongly improved">Strongly improved</option>
                <option value="Somewhat improved">Somewhat improved</option>
                <option value="No change">No change</option>
                <option value="Somewhat worsened">Somewhat worsened</option>
                <option value="Strongly worsened">Strongly worsened</option>
              </select>
            </div>

            {/* Q2 */}
            <div style={{ marginBottom: 16, fontSize: 35 }}>
              <div style={{ marginBottom: 8 }}>
                How well did the assistant learn and adapt to your preferences?
              </div>
              <select
                className="select dark"
                style={{ fontSize: 35, width: "100%" }}
                value={surveyQ2}
                onChange={e => setSurveyQ2(e.target.value)}
              >
                <option value="">-- select --</option>
                <option value="Very well">Very well</option>
                <option value="Somewhat well">Somewhat well</option>
                <option value="Slightly">Slightly</option>
                <option value="Not at all">Not at all</option>
              </select>
            </div>

            {/* Q3 */}
            <div style={{ marginBottom: 16, fontSize: 35 }}>
              <div style={{ marginBottom: 8 }}>
                How much did you trust the assistant’s decisions and actions by
                the end of the study?
              </div>
              <select
                className="select dark"
                style={{ fontSize: 35, width: "100%" }}
                value={surveyQ3}
                onChange={e => setSurveyQ3(e.target.value)}
              >
                <option value="">-- select --</option>
                <option value="Strongly increased">Strongly increased</option>
                <option value="Somewhat increased">Somewhat increased</option>
                <option value="No change">No change</option>
                <option value="Somewhat decreased">Somewhat decreased</option>
                <option value="Strongly decreased">Strongly decreased</option>
              </select>
            </div>

            {/* Q4 */}
            <div style={{ marginBottom: 16, fontSize: 35 }}>
              <div style={{ marginBottom: 8 }}>
                How did the assistant’s learning or changes affect your comfort,
                satisfaction, or willingness to use it again?
              </div>
              <select
                className="select dark"
                style={{ fontSize: 35, width: "100%" }}
                value={surveyQ4}
                onChange={e => setSurveyQ4(e.target.value)}
              >
                <option value="">-- select --</option>
                <option value="Strongly increased">Strongly increased</option>
                <option value="Somewhat increased">Somewhat increased</option>
                <option value="No change">No change</option>
                <option value="Somewhat decreased">Somewhat decreased</option>
                <option value="Strongly decreased">Strongly decreased</option>
              </select>
            </div>

            {/* Q5 */}
            <div style={{ marginBottom: 16, fontSize: 35 }}>
              <div style={{ marginBottom: 8 }}>
                What features or behaviors would make a self-improving assistant
                more useful and trustworthy for you in daily life? (Overall
                satisfaction)
              </div>
              <select
                className="select dark"
                style={{ fontSize: 35, width: "100%" }}
                value={surveyQ5}
                onChange={e => setSurveyQ5(e.target.value)}
              >
                <option value="">-- select --</option>
                <option value="Very satisfied">Very satisfied</option>
                <option value="Somewhat satisfied">Somewhat satisfied</option>
                <option value="Neutral">Neutral</option>
                <option value="Somewhat dissatisfied">
                  Somewhat dissatisfied
                </option>
                <option value="Very dissatisfied">Very dissatisfied</option>
              </select>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 12,
                marginTop: 12
              }}
            >
              <button
                className="btn btn-hollow"
                style={{ fontSize: 35 }}
                onClick={() => setShowSurvey(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 35 }}
                onClick={onSaveSurvey}
              >
                Save Survey
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <div className="statusbar">
        <div className="status-left" title={statusLeft}>
          {statusLeft}
        </div>
        <div className="status-right" title={statusRight}>
          {statusRight}
          &nbsp; | &nbsp; User ID: {userId || "<empty>"}
          &nbsp; | &nbsp; Phase: {phase}
          &nbsp; | &nbsp; Storyboard (Phase I): {variant}
        </div>
      </div>
    </div>
  );
}
