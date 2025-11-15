import React, { useEffect, useMemo, useRef, useState } from "react";

/** 与 PySide 完全一致的命名/匹配规则 */
const IMAGE_RE = /^Persona_(?<pid>\d+)_Activity_(?<aid>\d+)\.(?:jpg|jpeg|png)$/i;
const NARR_RE  = /^Persona_(?<pid>\d+)_Activity_(?<aid>\d+)_Description\.(?:txt|md)$/i;
const API_BASE = "http://localhost:4000/api";

type Key = `${number}-${number}`;
type ImgRec  = { key: Key; pid: number; aid: number; file: File; url: string; name: string };
type NarrRec = { key: Key; pid: number; aid: number; file: File; name: string };

type UserInfo = {
  id: number;
  age: string;
  gender: string;
  education: string;
  occupation: string;
  smartAssistantExp: string;
  techComfort: string; // "1"–"7"
};

type ApiUserRow = {
  id: number;
  age_range: string | null;
  gender: string | null;
  education_level: string | null;
  occupation: string | null;
  smart_assistant_exp: string | null;
  tech_comfort: number | null;
};

type ApiSelectionRow = {
  user_id: number;
  image_id: string;
  selection: "A" | "B";
};

type Choice = "A" | "B";

export default function App() {
  // 目录输入（隐藏的 <input type="file" webkitdirectory>）
  const imgDirRef  = useRef<HTMLInputElement>(null);
  const narrDirRef = useRef<HTMLInputElement>(null);

  // 原始文件
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [narratorFiles, setNarratorFiles] = useState<File[]>([]);

  // File System Access API 目录句柄（可真正读盘刷新）
  const [imgHandle, setImgHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [narrHandle, setNarrHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // 索引与映射
  const [images, setImages] = useState<Record<Key, ImgRec>>({});
  const [narrs,  setNarrs]  = useState<Record<Key, NarrRec>>({});
  const [byPersona, setByPersona] = useState<Record<number, number[]>>({});

  // 选择项（以 File 为唯一真相）
  const [selectedKey, setSelectedKey] = useState<Key | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [selectedAid, setSelectedAid] = useState<number | null>(null);

  // User 相关：从数据库加载 + 下拉选择
  const [userInfos, setUserInfos] = useState<Record<number, UserInfo>>({});
  const [nextUserId, setNextUserId] = useState<number>(1); // 只作为前端备用，不再决定实际 ID
  const [userId, setUserId] = useState<string>("");  // 当前选中的 User ID（字符串形式）
  const [showUserForm, setShowUserForm] = useState<boolean>(false); // 是否显示“单独一页”的 User 信息录入界面

  // Storyboard：当前高亮 A/B + 每个 user 对每张图的选择
  const [variant, setVariant] = useState<Choice>("A");
  const [choices, setChoices] = useState<Record<string, Choice>>({}); // key = `${userId}::${imgName}`

  // Narrator JSON 中解析出来的字段
  const [userNameFromNarr, setUserNameFromNarr] = useState<string>("");  // "User Name"
  const [activityDesc, setActivityDesc]       = useState<string>("");    // "Activity Description"
  const [smartTextA, setSmartTextA]           = useState<string>("");    // "Smart Assistant Interaction"

  // 中间 splitter（可拖动）
  const [splitPct, setSplitPct] = useState<number>(58);
  const draggingRef = useRef(false);

  // 当前选中 user 的信息
  const currentUserIdNum = userId ? Number(userId) : null;
  const currentUserInfo: UserInfo | undefined =
    currentUserIdNum != null ? userInfos[currentUserIdNum] : undefined;

  // ============== 启动时从后端加载已有用户 ==============
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/users`);
        if (!resp.ok) {
          console.error("Failed to load users:", resp.status);
          return;
        }
        const rows: ApiUserRow[] = await resp.json();
        const map: Record<number, UserInfo> = {};
        let maxId = 0;
        for (const r of rows) {
          const id = r.id;
          if (id > maxId) maxId = id;
          map[id] = {
            id,
            age: r.age_range ?? "",
            gender: r.gender ?? "",
            education: r.education_level ?? "",
            occupation: r.occupation ?? "",
            smartAssistantExp: r.smart_assistant_exp ?? "",
            techComfort: (r.tech_comfort ?? 4).toString(),
          };
        }
        setUserInfos(map);
        setNextUserId(maxId + 1);
      } catch (e) {
        console.error("Error loading users:", e);
      }
    })();
  }, []);

  // ============== 构建索引（与 PySide 逻辑一致） ==============
  useEffect(() => {
    const imgMap: Record<Key, ImgRec> = {};
    const per: Record<number, Set<number>> = {};
    for (const f of imageFiles) {
      const name = f.name.trim();
      const m = name.match(IMAGE_RE); if (!m?.groups) continue;
      const pid = parseInt(m.groups.pid, 10);
      const aid = parseInt(m.groups.aid, 10);
      const key: Key = `${pid}-${aid}`;
      imgMap[key] = { key, pid, aid, file: f, url: URL.createObjectURL(f), name };
      (per[pid] ||= new Set()).add(aid);
    }

    const narrMap: Record<Key, NarrRec> = {};
    for (const f of narratorFiles) {
      const name = f.name.trim();
      const m = name.match(NARR_RE); if (!m?.groups) continue;
      const pid = parseInt(m.groups.pid, 10);
      const aid = parseInt(m.groups.aid, 10);
      const key: Key = `${pid}-${aid}`;
      narrMap[key] = { key, pid, aid, file: f, name };
    }

    const perOut: Record<number, number[]> = {};
    for (const [pidStr, aids] of Object.entries(per)) {
      perOut[Number(pidStr)] = Array.from(aids).sort((a,b)=>a-b);
    }

    setImages(imgMap);
    setNarrs(narrMap);
    setByPersona(perOut);

    const sorted = Object.values(imgMap).sort((a,b)=> a.pid-b.pid || a.aid-b.aid);
    if (sorted.length) {
      const first = sorted[0];
      setSelectedKey(first.key); setSelectedPid(first.pid); setSelectedAid(first.aid);
    } else {
      setSelectedKey(null); setSelectedPid(null); setSelectedAid(null);
    }

    return () => { Object.values(imgMap).forEach(r => URL.revokeObjectURL(r.url)); };
  }, [imageFiles, narratorFiles]);

  // ============== 当选中图片变更时，读取对应 Narrator JSON ==============
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
        const smart    = (data["Smart Assistant Interaction"] ?? "").toString();

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

    return () => { cancelled = true; };
  }, [selectedKey, narrs]);

  // ============== 当前图片 + 当前 user 的已选 A/B 同步到 variant ==============
  useEffect(() => {
    const img = selectedKey ? images[selectedKey] : null;
    if (!img || !userId) return;
    const key = `${userId}::${img.name}`;
    const c = choices[key];
    if (c === "A" || c === "B") {
      setVariant(c);
    } else {
      setVariant("A");
    }
  }, [selectedKey, images, userId, choices]);

  // ============== 下拉选项 ==============
  const filenameOptions = useMemo(
    () => Object.values(images).sort((a,b)=> a.pid-b.pid || a.aid-b.aid),
    [images]
  );
  const personaOptions = useMemo(
    () => Object.keys(byPersona).map(Number).sort((a,b)=>a-b),
    [byPersona]
  );
  const activityOptions = useMemo(
    () => (selectedPid==null? [] : (byPersona[selectedPid]||[])),
    [byPersona, selectedPid]
  );
  const userIdOptions = useMemo(
    () => Object.keys(userInfos).map(Number).sort((a,b)=>a-b),
    [userInfos]
  );

  // ============== 选择联动（与 PySide 一致） ==============
  function selectByKey(key: Key | null) {
    if (!key) return; const rec = images[key]; if (!rec) return;
    setSelectedKey(key); setSelectedPid(rec.pid); setSelectedAid(rec.aid);
  }
  function onFilenameChange(name: string) {
    const rec = filenameOptions.find(r=>r.name===name); if (rec) selectByKey(rec.key);
  }
  function onPersonaChange(pidStr: string) {
    const pid = Number(pidStr); setSelectedPid(pid);
    const aids = byPersona[pid] || [];
    if (aids.length) {
      const key: Key = `${pid}-${aids[0]}`;
      if (images[key]) selectByKey(key);
    }
  }
  function onActivityChange(aidStr: string) {
    if (selectedPid==null) return;
    const key: Key = `${selectedPid}-${Number(aidStr)}`;
    if (images[key]) selectByKey(key);
  }

  // ============== 选择 User：顺便加载该用户的历史选择 ==============
  async function onUserSelect(idStr: string) {
    setUserId(idStr);
    const uid = Number(idStr);
    if (!uid) return;

    try {
      const resp = await fetch(`${API_BASE}/users/${uid}/selections`);
      if (!resp.ok) {
        console.error("Failed to load selections:", resp.status);
        return;
      }
      const rows: ApiSelectionRow[] = await resp.json();
      setChoices(prev => {
        const copy = { ...prev };
        const prefix = `${uid}::`;
        // 清理旧记录
        for (const key of Object.keys(copy)) {
          if (key.startsWith(prefix)) delete copy[key];
        }
        // 写入新记录
        for (const row of rows) {
          copy[`${uid}::${row.image_id}`] = row.selection === "B" ? "B" : "A";
        }
        return copy;
      });
    } catch (e) {
      console.error("Error loading selections:", e);
    }
  }

  // ============== User 信息管理 ==============
  async function createNewUser() {
    try {
      const resp = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age_range: null,
          gender: null,
          education_level: null,
          occupation: null,
          smart_assistant_exp: null,
          tech_comfort: 4
        })
      });
      if (!resp.ok) {
        console.error("Failed to create user:", resp.status);
        flash("Failed to create user");
        return;
      }
      const row: ApiUserRow = await resp.json();
      const id = row.id;
      const info: UserInfo = {
        id,
        age: row.age_range ?? "",
        gender: row.gender ?? "",
        education: row.education_level ?? "",
        occupation: row.occupation ?? "",
        smartAssistantExp: row.smart_assistant_exp ?? "",
        techComfort: (row.tech_comfort ?? 4).toString(),
      };
      setUserInfos(prev => ({ ...prev, [id]: info }));
      setUserId(String(id));
      setShowUserForm(true);
      setNextUserId(Math.max(nextUserId, id + 1));
      flash(`Created User ID: ${id}`);
    } catch (e) {
      console.error("createNewUser error:", e);
      flash("Failed to create user");
    }
  }

  function openCurrentUserForm() {
    if (!currentUserIdNum) {
      flash("Please select a User first");
      return;
    }
    setShowUserForm(true);
  }

  // 只更新本地 state，真正写库在 Save User 时做
  function updateUserField<K extends keyof Omit<UserInfo, "id">>(
    field: K,
    value: UserInfo[K]
  ) {
    if (currentUserIdNum == null) {
      flash("Please create/select a User first");
      return;
    }

    setUserInfos(prev => {
      const existing = prev[currentUserIdNum] || {
        id: currentUserIdNum,
        age: "",
        gender: "",
        education: "",
        occupation: "",
        smartAssistantExp: "",
        techComfort: "4"
      };
      const newInfo: UserInfo = { ...existing, [field]: value };
      return {
        ...prev,
        [currentUserIdNum]: newInfo
      };
    });
  }

  // Save User：写入数据库 + 导出 txt + 弹 toast
  async function onSaveUserInfo() {
    if (currentUserIdNum == null) {
      flash("No User selected");
      return;
    }
    const info = userInfos[currentUserIdNum];
    if (!info) {
      flash("No User info to save");
      return;
    }

    // 1) 先写入数据库
    try {
      const resp = await fetch(`${API_BASE}/users/${currentUserIdNum}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age_range: info.age || null,
          gender: info.gender || null,
          education_level: info.education || null,
          occupation: info.occupation || null,
          smart_assistant_exp: info.smartAssistantExp || null,
          tech_comfort: Number(info.techComfort) || 4
        })
      });

      if (!resp.ok) {
        console.error("onSaveUserInfo failed:", resp.status);
        flash("Failed to save user info to DB");
        return;
      }
    } catch (e) {
      console.error("onSaveUserInfo error:", e);
      flash("Failed to save user info to DB");
      return;
    }

    // 2) 再导出一份 txt 备份
    const lines: string[] = [];
    lines.push(`User ID: ${info.id}`);
    lines.push("");
    lines.push("Section 1. Basic Demographics");
    lines.push(`Age: ${info.age || "<empty>"}`);
    lines.push(`Gender: ${info.gender || "<empty>"}`);
    lines.push(`Education Level: ${info.education || "<empty>"}`);
    lines.push(`Occupation / Field of Work or Study: ${info.occupation || "<empty>"}`);
    lines.push(`Experience with Smart Assistants: ${info.smartAssistantExp || "<empty>"}`);
    lines.push(`Comfort with technology (1–7): ${info.techComfort || "<empty>"}`);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `User_${info.id}_Info.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 0);

    // 3) 弹出成功提示
    flash("User info saved to DB");
  }

  // ============== Storyboard 选择记录 ==============
  async function recordChoiceForCurrentImage(choice: Choice) {
    const img = selectedKey ? images[selectedKey] : null;
    if (!img) {
      flash("No image selected");
      return;
    }
    if (!userId) {
      flash("Please create/select a User before Storyboard");
      return;
    }

    const uidNum = Number(userId);
    if (!uidNum) {
      flash("Invalid User ID");
      return;
    }

    const key = `${userId}::${img.name}`;
    // 本地先更新
    setChoices(prev => ({ ...prev, [key]: choice }));

    // 写入 PostgreSQL（upsert）
    try {
      await fetch(`${API_BASE}/selections`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uidNum,
          image_id: img.name,
          selection: choice
        })
      });
    } catch (e) {
      console.error("recordChoiceForCurrentImage error:", e);
    }

    // 记录之后再自动跳到下一张
    const idx = filenameOptions.findIndex(r => r.key === img.key);
    if (idx >= 0 && idx + 1 < filenameOptions.length) {
      const nextRec = filenameOptions[idx + 1];
      selectByKey(nextRec.key);
    } else {
      flash("Already at last image");
    }
  }

  // 导出当前 user 的 Choices 为本地 txt（额外方便检查）
  function onExportChoices() {
    if (!userId) {
      flash("Please select a User first");
      return;
    }
    const uid = userId;
    const entries: [string, Choice][] = [];
    for (const img of filenameOptions) {
      const k = `${uid}::${img.name}`;
      const c = choices[k];
      if (c === "A" || c === "B") {
        entries.push([img.name, c]);
      }
    }
    if (!entries.length) {
      flash("No choices for this User yet");
      return;
    }
    const lines: string[] = [];
    lines.push(`User ID: ${uid}`);
    lines.push("Image Name, Choice (A/B)");
    for (const [name, c] of entries) {
      lines.push(`${name}, ${c}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `User_${uid}_Choices.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 0);
  }

  // ============== 真正“读盘”的刷新（优先使用目录句柄） ==============
  async function reloadFromHandle(
    h: FileSystemDirectoryHandle | null,
    re: RegExp,
    setter: (fs: File[]) => void
  ) {
    if (!h) return;
    const files: File[] = [];
    // @ts-ignore
    for await (const [, entry] of h.entries()) {
      if (entry.kind === "file") {
        const f = await (entry as FileSystemFileHandle).getFile();
        if (re.test(f.name)) files.push(f);
      }
    }
    setter(files);
  }

  async function chooseImagesDirFS() {
    // @ts-ignore
    if (!window.showDirectoryPicker) { pickImagesDir(); return; }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "images-dir" });
    setImgHandle(handle);
    await reloadFromHandle(handle, IMAGE_RE, setImageFiles);
  }

  async function chooseNarrDirFS() {
    // @ts-ignore
    if (!window.showDirectoryPicker) { pickNarrDir(); return; }
    // @ts-ignore
    const handle = await window.showDirectoryPicker({ id: "narr-dir" });
    setNarrHandle(handle);
    await reloadFromHandle(handle, NARR_RE, setNarratorFiles);
  }

  // ============== 保存 File Name / User ID / Storyboard(A/B) 为本地 txt（保留原有功能） ==============
  function onSaveSelection() {
    const img = selectedKey ? images[selectedKey] : null;
    if (!img) {
      flash("No file selected");
      return;
    }
    if (!userId) {
      flash("Please create/select a User ID first");
      return;
    }
    if (!/^\d*$/.test(userId)) {
      flash("User ID must be digits");
      return;
    }
    const ts = new Date().toISOString();
    const contents =
`File Name: ${img.name}
Persona: ${img.pid}
Activity: ${img.aid}
User ID: ${userId || "<empty>"}
Storyboard (current highlight): ${variant}
Saved At: ${ts}
`;
    const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const safeName = img.name.replace(/[^\w.-]+/g, "_");
    a.download = `Selection_${safeName}_${userId || "NA"}_${variant}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 0);
  }

  // ============== Splitter 拖动 ==============
  function onMouseMove(e: MouseEvent) {
    if (!draggingRef.current) return;
    const container = document.querySelector(".center-split") as HTMLElement | null;
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

  // ============== 辅助：加载目录按钮（fallback 输入） ==============
  function pickImagesDir() {
    if (imgDirRef.current) { imgDirRef.current.value = ""; imgDirRef.current.click(); }
  }
  function pickNarrDir() {
    if (narrDirRef.current) { narrDirRef.current.value = ""; narrDirRef.current.click(); }
  }

  const currentImg = selectedKey ? images[selectedKey] : null;
  const statusLeft  = currentImg ? `Image: images/${currentImg.name}` : "Image: <none>";
  const statusRight = selectedKey && narrs[selectedKey]
      ? `Narrator: Narrator/${narrs[selectedKey].name}`
      : "Narrator: <missing>";

  // 大号深色按钮
  const DarkBtn: React.FC<{
    active?: boolean; onClick: () => void; children: React.ReactNode;
  }> = ({active, onClick, children}) => (
    <button
      onClick={onClick}
      className="btn"
      style={{
        padding:"14px 24px",
        fontSize:35,
        fontWeight:800,
        color:"#e5e7eb",
        background: active ? "#0b1220" : "#111827",
        border: active ? "2px solid #60a5fa" : "1px solid #374151",
        borderRadius:12
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  );

  // ============== 主渲染 ==============
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
    <div className="label" style={{ fontSize: 35 }}>File</div>
    <select
      className="select dark"
      style={{ fontSize: 35 }}
      value={currentImg?.name || ""}
      onChange={(e)=>onFilenameChange(e.target.value)}
    >
      {filenameOptions.length===0 && <option value="">(no images)</option>}
      {filenameOptions.map(rec => (
        <option key={rec.key} value={rec.name}>{rec.name}</option>
      ))}
    </select>

    <div className="label" style={{ fontSize: 35 }}>Persona</div>
    <select
      className="select dark"
      style={{ fontSize: 35 }}
      value={selectedPid!=null? String(selectedPid):""}
      onChange={(e)=>onPersonaChange(e.target.value)}
    >
      {personaOptions.length===0 && <option value="">(no personas)</option>}
      {personaOptions.map(pid => (
        <option key={pid} value={String(pid)}>{pid}</option>
      ))}
    </select>

    <div className="label" style={{ fontSize: 35 }}>Activity</div>
    <select
      className="select dark"
      style={{ fontSize: 35 }}
      value={selectedAid!=null? String(selectedAid):""}
      onChange={(e)=>onActivityChange(e.target.value)}
    >
      {activityOptions.length===0 && <option value="">(no activities)</option>}
      {activityOptions.map(aid => (
        <option key={aid} value={String(aid)}>{aid}</option>
      ))}
    </select>

    {/* User 选择 */}
    <div className="label" style={{ fontSize: 35 }}>User</div>
    <select
      className="select dark"
      style={{ fontSize: 35, minWidth: 140 }}
      value={userId}
      onChange={(e)=>onUserSelect(e.target.value)}
    >
      {userIdOptions.length === 0 && <option value="">(no users)</option>}
      {userIdOptions.map(id => (
        <option key={id} value={String(id)}>User {id}</option>
      ))}
    </select>

    <button
      className="btn btn-secondary"
      style={{ fontSize: 35 }}
      onClick={createNewUser}
    >
      New User
    </button>

    <button
      className="btn btn-hollow"
      style={{ fontSize: 35 }}
      onClick={openCurrentUserForm}
      disabled={!currentUserInfo}
    >
      Edit User
    </button>

    {/* 导出 & 保存 */}
    <button
      className="btn btn-primary"
      style={{ fontSize: 35 }}
      onClick={onExportChoices}
      disabled={!userId}
    >
      Export Choices
    </button>
    <button
      className="btn btn-hollow"
      style={{ fontSize: 35 }}
      onClick={onSaveSelection}
    >
      Save Selection
    </button>

    <div className="spacer" />

    <button
      className="btn btn-hollow"
      style={{ fontSize: 35 }}
      onClick={chooseImagesDirFS}
    >
      Load images/
    </button>
    <button
      className="btn btn-hollow"
      style={{ fontSize: 35 }}
      onClick={chooseNarrDirFS}
    >
      Load Narrator/
    </button>

    {/* 隐藏 input 作为回退 */}
    <input
      ref={imgDirRef}
      type="file" multiple
      // @ts-ignore
      webkitdirectory="true"
      hidden
      onChange={(e)=>setImageFiles(e.target.files? Array.from(e.target.files): [])}
    />
    <input
      ref={narrDirRef}
      type="file" multiple
      // @ts-ignore
      webkitdirectory="true"
      hidden
      onChange={(e)=>setNarratorFiles(e.target.files? Array.from(e.target.files): [])}
    />
  </div>
</div>


      {/* 中部内容：根据 showUserForm 决定显示“单独一页”用户信息，还是 Storyboard 主界面 */}
      {showUserForm && currentUserInfo ? (
        // ========== 用户信息独立页面 ==========
        <div
          style={{
            flex:1,
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:16
          }}
        >
          <div style={{ width:"100%", maxWidth:960, height:"100%", maxHeight:"100%" }}>
            <SectionBox title={`User Information Record (User ${currentUserInfo.id})`}>
              <div
                style={{
                  display:"grid",
                  gridTemplateColumns:"1fr 1fr",
                  gap:8,
                  fontSize:35
                }}
              >
                <div>
                  <div style={{ marginBottom:4 }}>User ID: <strong>{currentUserInfo.id}</strong></div>

                  <div style={{ marginBottom:4 }}>Age</div>
                  <select
                    className="select dark"
                    style={{ width:"100%", minWidth:0 }}
                    value={currentUserInfo.age}
                    onChange={(e)=>updateUserField("age", e.target.value)}
                  >
                    <option value="">-- select --</option>
                    <option value="18–24">18–24</option>
                    <option value="25–34">25–34</option>
                    <option value="35–44">35–44</option>
                    <option value="45–54">45–54</option>
                    <option value="55–60">55–60</option>
                  </select>

                  <div style={{ marginTop:8, marginBottom:4 }}>Gender</div>
                  <select
                    className="select dark"
                    style={{ width:"100%", minWidth:0 }}
                    value={currentUserInfo.gender}
                    onChange={(e)=>updateUserField("gender", e.target.value)}
                  >
                    <option value="">-- select --</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Non-binary / Self-describe">Non-binary / Self-describe</option>
                    <option value="Prefer not to answer">Prefer not to answer</option>
                  </select>

                  <div style={{ marginTop:8, marginBottom:4 }}>Education Level</div>
                  <select
                    className="select dark"
                    style={{ width:"100%", minWidth:0 }}
                    value={currentUserInfo.education}
                    onChange={(e)=>updateUserField("education", e.target.value)}
                  >
                    <option value="">-- select --</option>
                    <option value="High school diploma or equivalent">High school diploma or equivalent</option>
                    <option value="Some college">Some college</option>
                    <option value="Bachelor’s degree">Bachelor’s degree</option>
                    <option value="Master’s degree">Master’s degree</option>
                    <option value="Doctoral degree">Doctoral degree</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <div style={{ marginBottom:4 }}>Occupation / Field of Work or Study</div>
                  <input
                    className="input"
                    style={{ width:"100%", padding:"6px 8px" }}
                    value={currentUserInfo.occupation}
                    onChange={(e)=>updateUserField("occupation", e.target.value)}
                  />

                  <div style={{ marginTop:8, marginBottom:4 }}>Experience with Smart Assistants</div>
                  <select
                    className="select dark"
                    style={{ width:"100%", minWidth:0 }}
                    value={currentUserInfo.smartAssistantExp}
                    onChange={(e)=>updateUserField("smartAssistantExp", e.target.value)}
                  >
                    <option value="">-- select --</option>
                    <option value="None">None</option>
                    <option value="Occasional user">Occasional user</option>
                    <option value="Regular user">Regular user</option>
                    <option value="Daily user">Daily user</option>
                  </select>

                  <div style={{ marginTop:8, marginBottom:4 }}>
                    Comfort with technology (1 = Not comfortable, 7 = Very comfortable)
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <input
                      type="range"
                      min={1}
                      max={7}
                      value={currentUserInfo.techComfort}
                      onChange={(e)=>updateUserField("techComfort", e.target.value)}
                    />
                    <div style={{ width:24, textAlign:"center" }}>{currentUserInfo.techComfort}</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end", gap:8 }}>
                <button
                  className="btn btn-hollow"
                  onClick={()=>setShowUserForm(false)}
                >
                  Back to Storyboard
                </button>
                <button
                  className="btn btn-primary"
                  onClick={onSaveUserInfo}
                >
                  Save User Info
                </button>
              </div>
            </SectionBox>
          </div>
        </div>
      ) : (
        // ========== 正常 Storyboard 主界面 ==========
        <>
          {/* 中部：可拖动分隔的左右面板 */}
          <div
            className="center-split"
            style={{
              display:"grid",
              gridTemplateColumns: `${splitPct}% 6px ${100 - splitPct}%`,
              height:"calc(100vh - 120px)",
              minHeight:0
            }}
          >
            {/* 左：单张图片 */}
            <div
              className="panel image-panel"
              style={{
                position:"relative",
                width:"100%",
                height:"100%",
                border:"1px solid #e2e8f0",
                borderRadius:12,
                overflow:"hidden",
                background:"#0b1220",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                minHeight:0
              }}
            >
              {currentImg ? (
                <img
                  src={currentImg.url}
                  alt={currentImg.name}
                  style={{
                    maxWidth:"100%",
                    maxHeight:"100%",
                    objectFit:"contain",
                    display:"block"
                  }}
                />
              ) : (
                <div className="placeholder">No image</div>
              )}
            </div>

            {/* 分隔条 */}
            <div
              className="divider"
              onMouseDown={(e)=>{ e.preventDefault(); draggingRef.current=true; document.body.style.cursor="col-resize"; }}
              onDoubleClick={()=> setSplitPct(58)}
              title="Drag to resize"
              style={{cursor:"col-resize", background:"#94a3b8"}}
            />

            {/* 右：Narrator + Storyboard + A + B */}
            <div
              className="panel text-panel"
              style={{
                display:"grid",
                gridTemplateRows:"5fr auto 3fr 3fr",
                gap:10,
                minHeight:0
              }}
            >
              {/* Narrator */}
              <SectionBox title="">
                <div
                  style={{
                    display:"flex",
                    flexDirection:"column",
                    height:"100%",
                    padding:"4px 8px 8px 8px"
                  }}
                >
                  <div
                    style={{
                      fontWeight:900,
                      fontSize:35,
                      marginBottom:10,
                      lineHeight:1.2
                    }}
                  >
                    Based on the following activity description:
                  </div>

                  <div
                    style={{
                      display:"flex",
                      flexDirection:"column",
                      height:"100%"
                    }}
                  >
                    <div style={{fontWeight:400, fontSize:35, marginBottom:6}}>
                      User Name: {userNameFromNarr || "PlaceHolder"}
                    </div>
                    <textarea
                      className="narr"
                      value={activityDesc}
                      onChange={(e)=>setActivityDesc(e.target.value)}
                      style={{
                        height:"100%",
                        width:"100%",
                        resize:"none",
                        fontSize:35,
                        lineHeight:1.5
                      }}
                    />
                  </div>
                </div>
              </SectionBox>

              {/* Storyboard 选择：放在 Narrator 下方 */}
              <div
                className="card"
                style={{
                  padding:10,
                  display:"flex",
                  alignItems:"center",
                  gap:12
                }}
              >
                <div style={{fontWeight:900, fontSize:35}}>
                  Which Smart Assistant interaction method do you prefer?
                </div>
                {/* A/B 现在只负责高亮选择，不立即记录 */}
                <DarkBtn
                  active={variant==="A"}
                  onClick={()=>setVariant("A")}
                >
                  A
                </DarkBtn>
                <DarkBtn
                  active={variant==="B"}
                  onClick={()=>setVariant("B")}
                >
                  B
                </DarkBtn>

                {/* Confirm Choice 按钮，点击后才真正记录并跳到下一张 */}
                <button
                  className="btn btn-primary"
                  style={{ marginLeft:16, fontSize:35, fontWeight:500, padding:"10px 24px" }}
                  onClick={()=>recordChoiceForCurrentImage(variant)}
                >
                  Confirm Choice
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

              {/* B：目前共用同一段文案（如果之后有 B 文案可以再拆） */}
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
          </div>
        </>
      )}

      {/* 底部状态栏 */}
      <div className="statusbar">
        <div className="status-left" title={statusLeft}>{statusLeft}</div>
        <div className="status-right" title={statusRight}>
          {statusRight}
          &nbsp; | &nbsp; User ID: {userId || "<empty>"}
          &nbsp; | &nbsp; Storyboard: {variant}
        </div>
      </div>
    </div>
  );
}

/** 小标题盒子：填满父容器的高度，A/B 为完整外框 */
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

/** 顶部提示 */
function flash(text: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(()=> el.classList.add("show"));
  setTimeout(()=>{
    el.classList.remove("show");
    setTimeout(()=> document.body.removeChild(el), 250);
  }, 1400);
}
