import React, { useEffect, useMemo, useRef, useState } from "react";

/** 文件名匹配规则：Persona_17_Activity_145.jpg / Persona_17_Activity_145_Description.txt */
const IMAGE_RE = /^Persona_(\d+)_Activity_(\d+)\.(?:jpg|jpeg|png)$/i;
const NARR_RE = /^Persona_(\d+)_Activity_(\d+)_Description\.(?:txt|md|json)$/i;

type Phase = "I" | "II";
type Key = `${number}-${number}`;

type ImgRec = {
  key: Key;
  pid: number;
  aid: number;
  file: File;
  url: string;
  name: string;
};
type NarrRec = { key: Key; pid: number; aid: number; file: File; name: string };

type Choice = "A" | "B";

type PreInfo = {
  userId: string;
  savedAt: string;
  demographics: {
    age: string;
    gender: string;
    education: string;
    occupation: string;
    smartAssistantExp: string;
    techComfort: string;
  };
};

type PhaseIIInteraction = {
  persona: number;
  activity: number;
  imageName: string;
  interaction: string;
};

type SurveyInfo = {
  overallChange: string;
  adaptPref: string;
  trustChange: string;
  comfortChange: string;
  satisfaction: string;
  comments: string;
};

function makeKey(pid: number, aid: number): Key {
  return `${pid}-${aid}` as Key;
}

/** 下载 JSON（作为没有目录权限时的 fallback） */
function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
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

export default function App() {
  // --------- 基本 state ---------
  const [phase, setPhase] = useState<Phase>("I");
  const [userId, setUserId] = useState<string>("");

  // Phase I & Phase II 各自的图像 / narrator 映射
  const [imagesPhaseI, setImagesPhaseI] = useState<Record<Key, ImgRec>>({});
  const [narrsPhaseI, setNarrsPhaseI] = useState<Record<Key, NarrRec>>({});
  const [byPersonaI, setByPersonaI] = useState<Record<number, number[]>>({});

  const [imagesPhaseII, setImagesPhaseII] = useState<Record<Key, ImgRec>>({});
  const [narrsPhaseII, setNarrsPhaseII] = useState<Record<Key, NarrRec>>({});
  const [byPersonaII, setByPersonaII] = useState<Record<number, number[]>>({});

  // 当前选中的图片
  const [selectedKey, setSelectedKey] = useState<Key | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [selectedAid, setSelectedAid] = useState<number | null>(null);

  // Narrator 解析出来的字段
  const [userNameFromNarr, setUserNameFromNarr] = useState<string>("");
  const [activityDesc, setActivityDesc] = useState<string>("");
  const [smartTextA, setSmartTextA] = useState<string>("");

  // Phase I：A/B 选择（只存内存）
  const [variant, setVariant] = useState<Choice>("A");
  const [phaseISelections, setPhaseISelections] =
    useState<Record<string, Choice>>({}); // key = imageName

  // Phase II：当前 Interaction 文本 & 累积（只存内存）
  const [interactionText, setInteractionText] = useState<string>("");
  const [phaseIIInteractions, setPhaseIIInteractions] = useState<
    Record<string, PhaseIIInteraction>
  >({});

  // 结果 JSON 的目录句柄（Result Path）
  const [resultDirHandle, setResultDirHandle] = useState<any | null>(null);

  // 中间 splitter
  const [splitPct, setSplitPct] = useState<number>(58);
  const draggingRef = useRef(false);

  // New User / Survey 弹窗
  const [showUserModal, setShowUserModal] = useState(false);
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  // New User 弹窗里的表单
  const [userForm, setUserForm] = useState({
    id: "",
    age: "",
    gender: "",
    education: "",
    occupation: "",
    smartAssistantExp: "",
    techComfort: "4",
  });

  // 保存好的 Pre 信息（只存内存）
  const [preInfo, setPreInfo] = useState<PreInfo | null>(null);

  // Survey 表单（也是内存）
  const [survey, setSurvey] = useState<SurveyInfo>({
    overallChange: "",
    adaptPref: "",
    trustChange: "",
    comfortChange: "",
    satisfaction: "",
    comments: "",
  });

  // --------- 根据 phase 取当前的 images / narrs / byPersona ---------
  const images = phase === "I" ? imagesPhaseI : imagesPhaseII;
  const narrs = phase === "I" ? narrsPhaseI : narrsPhaseII;
  const byPersona = phase === "I" ? byPersonaI : byPersonaII;

  const currentImg = selectedKey ? images[selectedKey] : undefined;

  // --------- File input 作为 fallback （不走 showDirectoryPicker 时用）---------
  const folderInputRef = useRef<HTMLInputElement>(null);

  function openFolderInput(phase: Phase) {
    const el = folderInputRef.current;
    if (!el) return;
    (el as any).dataset.phase = phase;
    el.value = "";
    el.click();
  }

  // --------- 目录加载：Phase I / Phase II 各自一套 ---------
  async function loadPhaseDir(which: Phase) {
    const canPick = (window as any).showDirectoryPicker;
    if (!canPick) {
      openFolderInput(which);
      return;
    }

    try {
      const handle: any = await (window as any).showDirectoryPicker({
        id: which === "I" ? "phase-i-dir" : "phase-ii-dir",
      });

      const imgMap: Record<Key, ImgRec> = {};
      const narrMap: Record<Key, NarrRec> = {};
      const per: Record<number, Set<number>> = {};

      // @ts-ignore
      for await (const [, entry] of handle.entries()) {
        if (entry.kind !== "file") continue;
        const file = await (entry as any).getFile();
        const name = file.name.trim();

        let m = name.match(IMAGE_RE);
        if (m) {
          const pid = parseInt(m[1], 10);
          const aid = parseInt(m[2], 10);
          const key = makeKey(pid, aid);
          imgMap[key] = {
            key,
            pid,
            aid,
            file,
            url: URL.createObjectURL(file),
            name,
          };
          (per[pid] ||= new Set()).add(aid);
          continue;
        }

        m = name.match(NARR_RE);
        if (m) {
          const pid = parseInt(m[1], 10);
          const aid = parseInt(m[2], 10);
          const key = makeKey(pid, aid);
          narrMap[key] = { key, pid, aid, file, name };
        }
      }

      const perOut: Record<number, number[]> = {};
      for (const [pidStr, aids] of Object.entries(per)) {
        perOut[Number(pidStr)] = Array.from(aids).sort((a, b) => a - b);
      }

      if (which === "I") {
        Object.values(imagesPhaseI).forEach((r) => URL.revokeObjectURL(r.url));
        setImagesPhaseI(imgMap);
        setNarrsPhaseI(narrMap);
        setByPersonaI(perOut);
      } else {
        Object.values(imagesPhaseII).forEach((r) => URL.revokeObjectURL(r.url));
        setImagesPhaseII(imgMap);
        setNarrsPhaseII(narrMap);
        setByPersonaII(perOut);
      }

      if (phase === which) {
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
      }
    } catch (e) {
      console.error("loadPhaseDir error:", e);
      alert("Failed to load folder for Phase " + which);
    }
  }

  // fallback: input[type=file, webkitdirectory]
  function onFolderInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const phaseAttr = (e.target as any).dataset.phase;
    const which: Phase = phaseAttr === "II" ? "II" : "I";
    const files = Array.from(e.target.files ?? []);

    const imgMap: Record<Key, ImgRec> = {};
    const narrMap: Record<Key, NarrRec> = {};
    const per: Record<number, Set<number>> = {};

    for (const file of files) {
      const name = file.name.trim();

      let m = name.match(IMAGE_RE);
      if (m) {
        const pid = parseInt(m[1], 10);
        const aid = parseInt(m[2], 10);
        const key = makeKey(pid, aid);
        imgMap[key] = {
          key,
          pid,
          aid,
          file,
          url: URL.createObjectURL(file),
          name,
        };
        (per[pid] ||= new Set()).add(aid);
        continue;
      }

      m = name.match(NARR_RE);
      if (m) {
        const pid = parseInt(m[1], 10);
        const aid = parseInt(m[2], 10);
        const key = makeKey(pid, aid);
        narrMap[key] = { key, pid, aid, file, name };
      }
    }

    const perOut: Record<number, number[]> = {};
    for (const [pidStr, aids] of Object.entries(per)) {
      perOut[Number(pidStr)] = Array.from(aids).sort((a, b) => a - b);
    }

    if (which === "I") {
      Object.values(imagesPhaseI).forEach((r) => URL.revokeObjectURL(r.url));
      setImagesPhaseI(imgMap);
      setNarrsPhaseI(narrMap);
      setByPersonaI(perOut);
    } else {
      Object.values(imagesPhaseII).forEach((r) => URL.revokeObjectURL(r.url));
      setImagesPhaseII(imgMap);
      setNarrsPhaseII(narrMap);
      setByPersonaII(perOut);
    }

    if (phase === which) {
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
    }
  }

  // --------- 切换 phase 时，确保选中的 key 来自该 phase ---------
  useEffect(() => {
    const imgs = phase === "I" ? imagesPhaseI : imagesPhaseII;
    if (selectedKey && imgs[selectedKey]) return;
    const sorted = Object.values(imgs).sort(
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
  }, [phase, imagesPhaseI, imagesPhaseII]);

  // --------- 选中图片或 phase 变化时，读取 Narrator JSON ---------
  useEffect(() => {
    let cancelled = false;

    const narrMap = phase === "I" ? narrsPhaseI : narrsPhaseII;
    const rec = selectedKey ? narrMap[selectedKey] : undefined;

    async function run() {
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
        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          data = {};
        }

        if (cancelled) return;

        const userName = (data["User Name"] ?? "").toString();
        const activity = (data["Activity Description"] ?? "").toString();
        const smart = (data["Smart Assistant Interaction"] ?? "").toString();

        setUserNameFromNarr(userName);
        setActivityDesc(activity);
        setSmartTextA(smart);
      } catch (e) {
        console.error("read narrator error:", e);
        if (!cancelled) {
          setUserNameFromNarr("");
          setActivityDesc("");
          setSmartTextA("");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedKey, phase, narrsPhaseI, narrsPhaseII]);

  // --------- 每次切换图片 / phase 时清空 Phase II 输入框 ---------
  useEffect(() => {
    setInteractionText("");
  }, [selectedKey, phase]);

  // --------- persona / activity / file 下拉 ---------
  const filenameOptions = useMemo(
    () => Object.values(images).sort((a, b) => a.pid - b.pid || a.aid - b.aid),
    [images]
  );

  const personaOptions = useMemo(
    () => Object.keys(byPersona).map(Number).sort((a, b) => a - b),
    [byPersona]
  );

  const activityOptions = useMemo(
    () =>
      selectedPid == null ? [] : byPersona[selectedPid] || [],
    [byPersona, selectedPid]
  );

  function selectByKey(key: Key | null) {
    if (!key) return;
    const rec = images[key];
    if (!rec) return;
    setSelectedKey(key);
    setSelectedPid(rec.pid);
    setSelectedAid(rec.aid);
  }

  function onFilenameChange(name: string) {
    const rec = filenameOptions.find((r) => r.name === name);
    if (rec) selectByKey(rec.key);
  }

  function onPersonaChange(pidStr: string) {
    const pid = Number(pidStr);
    setSelectedPid(pid);
    const aids = byPersona[pid] || [];
    if (aids.length) {
      const key = makeKey(pid, aids[0]);
      selectByKey(key);
    }
  }

  function onActivityChange(aidStr: string) {
    if (selectedPid == null) return;
    const aid = Number(aidStr);
    const key = makeKey(selectedPid, aid);
    selectByKey(key);
  }

  // --------- Next Image（Phase I & II 共用）---------
  function goNextImage() {
    const list = filenameOptions;
    if (!list.length) return;
    if (!selectedKey) {
      const first = list[0];
      selectByKey(first.key);
      return;
    }
    const idx = list.findIndex((r) => r.key === selectedKey);
    if (idx >= 0 && idx + 1 < list.length) {
      const next = list[idx + 1];
      selectByKey(next.key);
    } else {
      alert("Already at last image.");
    }
  }

  // --------- Phase I：Confirm Selection（只存内存）---------
  function onConfirmSelection() {
    if (!currentImg) {
      alert("No image selected.");
      return;
    }
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }

    const newSelections = {
      ...phaseISelections,
      [currentImg.name]: variant,
    };
    setPhaseISelections(newSelections);

    alert("Selection recorded for this image in Phase I.");
  }

  // --------- Phase II：Save and Continue（存内存 + 下一张）---------
  function onSaveInteractionAndContinue() {
    if (!currentImg) {
      alert("No image selected.");
      return;
    }
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }

    const record: PhaseIIInteraction = {
      persona: currentImg.pid,
      activity: currentImg.aid,
      imageName: currentImg.name,
      interaction: interactionText || "",
    };

    setPhaseIIInteractions((prev) => ({
      ...prev,
      [currentImg.name]: record,
    }));

    alert("Interaction recorded for this image in Phase II.");
    goNextImage();
  }

  // --------- New User 弹窗：只存内存 ---------
  function openUserModal() {
    setUserForm((prev) => ({
      ...prev,
      id: userId || prev.id,
    }));
    setShowUserModal(true);
  }

  function saveUserInfo() {
    const id = userForm.id.trim();
    if (!id) {
      alert("Please enter User ID in the form.");
      return;
    }
    setUserId(id);

    const info: PreInfo = {
      userId: id,
      savedAt: new Date().toISOString(),
      demographics: {
        age: userForm.age,
        gender: userForm.gender,
        education: userForm.education,
        occupation: userForm.occupation,
        smartAssistantExp: userForm.smartAssistantExp,
        techComfort: userForm.techComfort,
      },
    };
    setPreInfo(info);
    setShowUserModal(false);
    alert("User info saved in memory.");
  }

  // --------- Survey 弹窗：结果只存 survey state ---------
  function saveSurvey() {
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }
    setShowSurveyModal(false);
    alert("Survey saved in memory.");
  }

  // --------- 选择 Result Path（结果 JSON 输出目录）---------
  async function chooseResultPath() {
    const canPick = (window as any).showDirectoryPicker;
    if (!canPick) {
      alert(
        "Your browser does not support folder selection. The JSON file will be downloaded instead."
      );
      return;
    }
    try {
      const handle = await (window as any).showDirectoryPicker({
        id: "result-dir",
      });
      setResultDirHandle(handle);
      alert("Result path selected.");
    } catch (e) {
      console.error("chooseResultPath error:", e);
    }
  }

  // --------- Save ALL：合并所有阶段，输出一个 UserID_Reflection.json ---------
  async function saveAll() {
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }
    const safeId = userId.replace(/[^\w.-]+/g, "_");

    // Phase I：根据 imagesPhaseI + phaseISelections 组合
    const phaseIArray = Object.values(imagesPhaseI)
      .sort((a, b) => a.pid - b.pid || a.aid - b.aid)
      .map((rec) => {
        const choice = phaseISelections[rec.name];
        if (!choice) return null;
        return {
          persona: rec.pid,
          activity: rec.aid,
          imageName: rec.name,
          choice,
        };
      })
      .filter(Boolean) as {
      persona: number;
      activity: number;
      imageName: string;
      choice: Choice;
    }[];

    // Phase II：用已存的 interactions
    const phaseIIArray = Object.values(phaseIIInteractions).sort(
      (a, b) => a.persona - b.persona || a.activity - b.activity
    );

    const result = {
      userId,
      generatedAt: new Date().toISOString(),
      pre: preInfo,
      phaseI: phaseIArray,
      phaseII: phaseIIArray,
      post: survey,
    };

    const fileName = `${safeId}_Reflection.json`;

    if (resultDirHandle && (window as any).showDirectoryPicker) {
      try {
        const fileHandle = await (resultDirHandle as any).getFileHandle(
          fileName,
          { create: true }
        );
        const writable = await (fileHandle as any).createWritable();
        await writable.write(JSON.stringify(result, null, 2));
        await writable.close();
        alert("Saved ALL to selected result folder.");
        return;
      } catch (e) {
        console.error("saveAll via directory handle failed:", e);
        alert(
          "Failed to save to selected folder. The JSON file will be downloaded instead."
        );
      }
    }

    // fallback：直接下载
    downloadJson(fileName, result);
  }

  // --------- Splitter 拖动 ---------
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

  const statusLeft = currentImg ? `Image: ${currentImg.name}` : "Image: <none>";
  const narrRec = selectedKey ? narrs[selectedKey] : undefined;
  const statusRight = narrRec
    ? `Narrator: ${narrRec.name}`
    : "Narrator: <missing>";

  // ---------- 一些按钮组件 ----------
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
        color: active ? "#93c5fd" : "#e5e7eb",
      }}
    >
      {children}
    </button>
  );

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
        borderRadius: 12,
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  );

  // ---------- 主渲染 ----------
  return (
    <div className="page dark">
      {/* 顶部工具栏 */}
      <div
        className="toolbar card dark"
        style={{
          padding: "12px 18px",
        }}
      >
        <div
          className="toolbar-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div className="label" style={{ fontSize: 35 }}>
            File
          </div>
          <select
            className="select dark"
            style={{ fontSize: 35 }}
            value={currentImg?.name || ""}
            onChange={(e) => onFilenameChange(e.target.value)}
          >
            {filenameOptions.length === 0 && (
              <option value="">(no images)</option>
            )}
            {filenameOptions.map((rec) => (
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
            onChange={(e) => onPersonaChange(e.target.value)}
          >
            {personaOptions.length === 0 && (
              <option value="">(no personas)</option>
            )}
            {personaOptions.map((pid) => (
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
            onChange={(e) => onActivityChange(e.target.value)}
          >
            {activityOptions.length === 0 && (
              <option value="">(no activities)</option>
            )}
            {activityOptions.map((aid) => (
              <option key={aid} value={String(aid)}>
                {aid}
              </option>
            ))}
          </select>

          {/* User 输入 */}
          <div className="label" style={{ fontSize: 35 }}>
            User ID
          </div>
          <input
            className="input"
            style={{
              fontSize: 35,
              padding: "4px 10px",
              width: 180,
            }}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. 301"
          />

          <button
            className="btn btn-secondary"
            style={{ fontSize: 35 }}
            onClick={openUserModal}
          >
            New / Edit User
          </button>

          <button
            className="btn btn-secondary"
            style={{ fontSize: 35 }}
            onClick={() => setShowSurveyModal(true)}
          >
            Survey
          </button>

          <button
            className="btn btn-secondary"
            style={{ fontSize: 35 }}
            onClick={chooseResultPath}
          >
            Result Path
          </button>

          <button
            className="btn btn-primary"
            style={{ fontSize: 35 }}
            onClick={saveAll}
          >
            Save ALL
          </button>

          {/* Phase 切换 */}
          <PhaseBtn active={phase === "I"} onClick={() => setPhase("I")}>
            Phase I
          </PhaseBtn>
          <PhaseBtn active={phase === "II"} onClick={() => setPhase("II")}>
            Phase II
          </PhaseBtn>

          <div className="spacer" />

          {/* 载入 Phase I / II */}
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={() => loadPhaseDir("I")}
          >
            Load Phase I
          </button>
          <button
            className="btn btn-hollow"
            style={{ fontSize: 35 }}
            onClick={() => loadPhaseDir("II")}
          >
            Load Phase II
          </button>

          {/* 隐藏 input 作为目录选择 fallback */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            hidden
            onChange={onFolderInputChange}
          />
        </div>
      </div>

      {/* 中部内容：左图右文本 */}
      <div
        className="center-split"
        style={{
          display: "grid",
          gridTemplateColumns: `${splitPct}% 6px ${100 - splitPct}%`,
          height: "calc(100vh - 120px)",
          minHeight: 0,
        }}
      >
        {/* 左边图片 */}
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
            minHeight: 0,
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
                display: "block",
              }}
            />
          ) : (
            <div className="placeholder" style={{ fontSize: 35 }}>
              No image
            </div>
          )}
        </div>

        {/* 分隔条 */}
        <div
          className="divider"
          onMouseDown={(e) => {
            e.preventDefault();
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
          }}
          onDoubleClick={() => setSplitPct(58)}
          title="Drag to resize"
          style={{ cursor: "col-resize", background: "#94a3b8" }}
        />

        {/* 右侧：Phase I / Phase II 不同布局 */}
        {phase === "I" ? (
          // -------------- Phase I：A/B 选择 --------------
          <div
            className="panel text-panel"
            style={{
              display: "grid",
              gridTemplateRows: "5fr auto 3fr 3fr",
              gap: 10,
              minHeight: 0,
            }}
          >
            {/* Narrator：User Name + Activity Description */}
            <SectionBox title="">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "4px 8px 8px 8px",
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: 35,
                    marginBottom: 10,
                    lineHeight: 1.2,
                  }}
                >
                  Based on the following activity description:
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 400,
                      fontSize: 35,
                      marginBottom: 6,
                    }}
                  >
                    User Name: {userNameFromNarr || "PlaceHolder"}
                  </div>
                  <textarea
                    className="narr"
                    readOnly
                    value={activityDesc}
                    style={{
                      height: "100%",
                      width: "100%",
                      resize: "none",
                      fontSize: 35,
                      lineHeight: 1.5,
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
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 35 }}>
                Which Smart Assistant interaction method do you prefer?
              </div>
              <DarkBtn active={variant === "A"} onClick={() => setVariant("A")}>
                A
              </DarkBtn>
              <DarkBtn active={variant === "B"} onClick={() => setVariant("B")}>
                B
              </DarkBtn>

              <button
                className="btn btn-primary"
                style={{
                  marginLeft: 16,
                  fontSize: 35,
                  fontWeight: 500,
                  padding: "10px 24px",
                }}
                onClick={onConfirmSelection}
              >
                Confirm Selection
              </button>

              <button
                className="btn btn-hollow"
                style={{
                  fontSize: 35,
                  fontWeight: 500,
                  padding: "10px 24px",
                }}
                onClick={goNextImage}
              >
                Next Image
              </button>
            </div>

            {/* A / B 文案 */}
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
                  lineHeight: 1.6,
                }}
              />
            </SectionBox>

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
                  lineHeight: 1.6,
                }}
              />
            </SectionBox>
          </div>
        ) : (
          // -------------- Phase II：Smart Interaction + 输入框 --------------
          <div
            className="panel text-panel"
            style={{
              display: "grid",
              gridTemplateRows: "5fr 5fr",
              gap: 10,
              minHeight: 0,
            }}
          >
            {/* 上方：基于 Smart Assistant Interaction */}
            <SectionBox title="">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "4px 8px 8px 8px",
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: 35,
                    marginBottom: 10,
                    lineHeight: 1.2,
                  }}
                >
                  Based on the description of interaction with smart assistant.
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
                    lineHeight: 1.5,
                  }}
                />
              </div>
            </SectionBox>

            {/* 下方：Interaction 输入 + Save and Continue */}
            <SectionBox title="Interaction">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "4px 8px 8px 8px",
                }}
              >
                <textarea
                  className="narr"
                  value={interactionText}
                  onChange={(e) => setInteractionText(e.target.value)}
                  placeholder="Type any interaction notes here..."
                  style={{
                    height: "100%",
                    width: "100%",
                    resize: "none",
                    fontSize: 35,
                    lineHeight: 1.5,
                  }}
                />
                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 12,
                  }}
                >
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 35, padding: "8px 24px" }}
                    onClick={onSaveInteractionAndContinue}
                  >
                    Save and Continue
                  </button>
                </div>
              </div>
            </SectionBox>
          </div>
        )}
      </div>

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

      {/* New User / Edit User 弹窗 */}
      {showUserModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#020617",
              borderRadius: 16,
              padding: 24,
              maxWidth: 900,
              width: "90%",
              maxHeight: "90%",
              overflow: "auto",
              border: "1px solid #1f2937",
            }}
          >
            <h2
              style={{
                fontSize: 35,
                marginBottom: 16,
                fontWeight: 900,
              }}
            >
              User Information (Pre-Study)
            </h2>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>User ID</div>
                <input
                  className="input"
                  style={{ fontSize: 35, padding: "4px 8px", width: "100%" }}
                  value={userForm.id}
                  onChange={(e) =>
                    setUserForm((f) => ({ ...f, id: e.target.value }))
                  }
                />
              </div>

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>Age</div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={userForm.age}
                  onChange={(e) =>
                    setUserForm((f) => ({ ...f, age: e.target.value }))
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

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>Gender</div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={userForm.gender}
                  onChange={(e) =>
                    setUserForm((f) => ({ ...f, gender: e.target.value }))
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

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  Education Level
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={userForm.education}
                  onChange={(e) =>
                    setUserForm((f) => ({
                      ...f,
                      education: e.target.value,
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

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  Occupation / Field of Work or Study
                </div>
                <input
                  className="input"
                  style={{ fontSize: 35, padding: "4px 8px", width: "100%" }}
                  value={userForm.occupation}
                  onChange={(e) =>
                    setUserForm((f) => ({ ...f, occupation: e.target.value }))
                  }
                />
              </div>

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  Experience with Smart Assistants
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={userForm.smartAssistantExp}
                  onChange={(e) =>
                    setUserForm((f) => ({
                      ...f,
                      smartAssistantExp: e.target.value,
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

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  Comfort with technology (1 = Not comfortable, 7 = Very
                  comfortable)
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="range"
                    min={1}
                    max={7}
                    value={userForm.techComfort}
                    onChange={(e) =>
                      setUserForm((f) => ({
                        ...f,
                        techComfort: e.target.value,
                      }))
                    }
                  />
                  <div style={{ width: 40, textAlign: "center", fontSize: 35 }}>
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
                gap: 12,
              }}
            >
              <button
                className="btn btn-hollow"
                style={{ fontSize: 35, padding: "8px 24px" }}
                onClick={() => setShowUserModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 35, padding: "8px 24px" }}
                onClick={saveUserInfo}
              >
                Save User Info
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Survey 弹窗 */}
      {showSurveyModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#020617",
              borderRadius: 16,
              padding: 24,
              maxWidth: 900,
              width: "90%",
              maxHeight: "90%",
              overflow: "auto",
              border: "1px solid #1f2937",
            }}
          >
            <h2
              style={{
                fontSize: 35,
                marginBottom: 16,
                fontWeight: 900,
              }}
            >
              Section 4. Post-Study Survey
            </h2>

            <p style={{ fontSize: 35, marginBottom: 16 }}>
              Please reflect on your overall experience interacting with the smart
              assistant.
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  Over time, did the assistant’s responses seem to:
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={survey.overallChange}
                  onChange={(e) =>
                    setSurvey((s) => ({ ...s, overallChange: e.target.value }))
                  }
                >
                  <option value="">-- select --</option>
                  <option value="Strongly improved">Strongly improved</option>
                  <option value="Somewhat improved">Somewhat improved</option>
                  <option value="No change">No change</option>
                  <option value="Somewhat worsened">Somewhat worsened</option>
                  <option value="Strongly worsened">Strongly worsened</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  How well did the assistant learn and adapt to your preferences?
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={survey.adaptPref}
                  onChange={(e) =>
                    setSurvey((s) => ({ ...s, adaptPref: e.target.value }))
                  }
                >
                  <option value="">-- select --</option>
                  <option value="Very well">Very well</option>
                  <option value="Somewhat well">Somewhat well</option>
                  <option value="Slightly">Slightly</option>
                  <option value="Not at all">Not at all</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  How much did you trust the assistant’s decisions and actions by
                  the end of the study?
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={survey.trustChange}
                  onChange={(e) =>
                    setSurvey((s) => ({ ...s, trustChange: e.target.value }))
                  }
                >
                  <option value="">-- select --</option>
                  <option value="Strongly increased">Strongly increased</option>
                  <option value="Somewhat increased">Somewhat increased</option>
                  <option value="No change">No change</option>
                  <option value="Somewhat decreased">Somewhat decreased</option>
                  <option value="Strongly decreased">Strongly decreased</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  How did the assistant’s learning or changes affect your comfort,
                  satisfaction, or willingness to use it again?
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={survey.comfortChange}
                  onChange={(e) =>
                    setSurvey((s) => ({
                      ...s,
                      comfortChange: e.target.value,
                    }))
                  }
                >
                  <option value="">-- select --</option>
                  <option value="Strongly increased">Strongly increased</option>
                  <option value="Somewhat increased">Somewhat increased</option>
                  <option value="No change">No change</option>
                  <option value="Somewhat decreased">Somewhat decreased</option>
                  <option value="Strongly decreased">Strongly decreased</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  Overall satisfaction with the assistant:
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 35, width: "100%" }}
                  value={survey.satisfaction}
                  onChange={(e) =>
                    setSurvey((s) => ({
                      ...s,
                      satisfaction: e.target.value,
                    }))
                  }
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

              <div>
                <div style={{ fontSize: 35, marginBottom: 4 }}>
                  What features or behaviors would make a self-improving assistant
                  more useful and trustworthy for you in daily life?
                </div>
                <textarea
                  className="narr"
                  style={{
                    fontSize: 35,
                    width: "100%",
                    minHeight: 150,
                    resize: "vertical",
                  }}
                  value={survey.comments}
                  onChange={(e) =>
                    setSurvey((s) => ({ ...s, comments: e.target.value }))
                  }
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 24,
                display: "flex",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              <button
                className="btn btn-hollow"
                style={{ fontSize: 35, padding: "8px 24px" }}
                onClick={() => setShowSurveyModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 35, padding: "8px 24px" }}
                onClick={saveSurvey}
              >
                Save Survey
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 通用卡片盒子 */
type SectionBoxProps = {
  title: string;
  children: React.ReactNode;
  emphasized?: boolean;
};

const SectionBox: React.FC<SectionBoxProps> = ({
  title,
  children,
  emphasized,
}) => {
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
        overflow: "hidden",
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
            color: emphasized ? "#93c5fd" : "#e5e7eb",
          }}
        >
          {title}
        </div>
      )}

      <div
        className="card-body"
        style={{ padding: 8, minHeight: 0, height: "100%" }}
      >
        <div style={{ display: "flex", minHeight: 0, height: "100%" }}>
          <div style={{ flex: "1 1 auto", minHeight: 0 }}>{children}</div>
        </div>
      </div>
    </div>
  );
};
