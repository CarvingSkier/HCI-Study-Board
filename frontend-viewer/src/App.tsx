import React, { useEffect, useMemo, useRef, useState } from "react";

/** 文件名匹配规则：Persona_17_Activity_145.jpg / Persona_17_Activity_145_Description.txt */
const IMAGE_RE = /^Persona_(\d+)_Activity_(\d+)\.(?:jpg|jpeg|png)$/i;
const NARR_RE = /^Persona_(\d+)_Activity_(\d+)_Description\.(?:txt|md|json)$/i;

// Import all PhaseData assets at build time
// Pattern: relative to this file location (src/App.tsx) 
// Files are in src/assets/PhaseData/
// Note: glob is evaluated at build time, so files must exist when bundling
const phaseDataImages = import.meta.glob('./assets/PhaseData/*.jpg', { eager: false });
const phaseDataTexts = import.meta.glob('./assets/PhaseData/*.txt', { eager: false });

// Debug: log immediately to see if glob worked at module load
console.log('[Module Load] phaseDataImages keys:', Object.keys(phaseDataImages));
console.log('[Module Load] phaseDataTexts keys:', Object.keys(phaseDataTexts));

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
  const phaseRef = useRef<Phase>(phase);
  const [userId, setUserId] = useState<string>("");

  // Keep ref in sync with state
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Phase I & Phase II 各自的图像 / narrator 映射
  const [imagesPhaseI, setImagesPhaseI] = useState<Record<Key, ImgRec>>({});
  const imagesPhaseIRef = useRef<Record<Key, ImgRec>>({});
  const [narrsPhaseI, setNarrsPhaseI] = useState<Record<Key, NarrRec>>({});
  const [byPersonaI, setByPersonaI] = useState<Record<number, number[]>>({});

  const [imagesPhaseII, setImagesPhaseII] = useState<Record<Key, ImgRec>>({});
  const imagesPhaseIIRef = useRef<Record<Key, ImgRec>>({});
  const [narrsPhaseII, setNarrsPhaseII] = useState<Record<Key, NarrRec>>({});
  const [byPersonaII, setByPersonaII] = useState<Record<number, number[]>>({});
  
  // Keep refs in sync with state
  useEffect(() => {
    imagesPhaseIRef.current = imagesPhaseI;
  }, [imagesPhaseI]);
  
  useEffect(() => {
    imagesPhaseIIRef.current = imagesPhaseII;
  }, [imagesPhaseII]);

  // 当前选中的图片
  const [selectedKey, setSelectedKey] = useState<Key | null>(null);
  const selectedKeyRef = useRef<Key | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [selectedAid, setSelectedAid] = useState<number | null>(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  // Narrator 解析出来的字段
  const [userNameFromNarr, setUserNameFromNarr] = useState<string>("");
  const [activityDesc, setActivityDesc] = useState<string>("");
  const [smartTextA, setSmartTextA] = useState<string>("");
  const [smartTextB, setSmartTextB] = useState<string>("");

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

  // 中间 splitter（左侧图像区域稍大）
  const [splitPct, setSplitPct] = useState<number>(70);
  const draggingRef = useRef(false);

  // Survey 弹窗
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  // Survey 表单（也是内存）
  const [survey, setSurvey] = useState<SurveyInfo>({
    overallChange: "",
    adaptPref: "",
    trustChange: "",
    comfortChange: "",
    satisfaction: "",
    comments: "",
  });

  // --------- Activation Steering 后端 WebSocket 状态 ---------
  const [llmResponse, setLlmResponse] = useState<string>(""); // Phase II 顶部模型返回文本
  const [isLoadingLLM, setIsLoadingLLM] = useState<boolean>(false);

  // Phase II：反馈选择（YES / NO）+ 满意度 + 标记类别
  const [feedbackChoice, setFeedbackChoice] = useState<"YES" | "NO">("NO");
  const [satisfaction, setSatisfaction] = useState({
    q1: 0,
    q2: 0,
    q3: 0,
    q4: 0,
    q5: 0,
  });
  // Mark categories: changed from array to object with category name as key and comment as value
  const [markComments, setMarkComments] = useState<Record<string, string>>({});
  // Category ranking: array ordered by user click order
  const [categoryRanking, setCategoryRanking] = useState<string[]>([]);
  // Expand/collapse states
  const [expandedSatisfaction, setExpandedSatisfaction] = useState(false);
  const [expandedMark, setExpandedMark] = useState(false);
  // Phase II start modal and method selection
  const [showPhaseIIModal, setShowPhaseIIModal] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<"vanilla" | "activation_steering" | "combined" | null>(null);
  const [phaseIIStarted, setPhaseIIStarted] = useState(false);

  const [wsStatus, setWsStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  const [sessionState, setSessionState] = useState<
    "idle" | "hello_sent" | "method_ready" | "waiting_response" | "waiting_feedback"
  >("idle");

  const [interactionCount, setInteractionCount] = useState<number>(0);

  // WebSocket bridge URL（见 FRONTEND_INTEGRATION_GUIDE）
  const wsUrl = (import.meta as any).env.VITE_WS_URL || "ws://137.184.192.144:8765/ui";
  const socketRef = useRef<WebSocket | null>(null);
  const autoSendTimeoutRef = useRef<number | null>(null);

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

  // --------- 从 assets 自动加载 Phase I / Phase II ---------
  async function loadPhaseFromAssets(which: Phase) {
    try {
      console.log(`Loading Phase ${which} from assets...`);
      console.log('Image modules:', Object.keys(phaseDataImages));
      console.log('Text modules:', Object.keys(phaseDataTexts));
      console.log('Image modules count:', Object.keys(phaseDataImages).length);
      console.log('Text modules count:', Object.keys(phaseDataTexts).length);
      if (Object.keys(phaseDataImages).length === 0) {
        console.warn('No image files found! Check glob pattern.');
      }
      
      const imgMap: Record<Key, ImgRec> = {};
      const narrMap: Record<Key, NarrRec> = {};
      const per: Record<number, Set<number>> = {};

      // Process image files
      for (const [path, moduleLoader] of Object.entries(phaseDataImages)) {
        // Extract filename from path
        const pathParts = path.split('/');
        const name = pathParts[pathParts.length - 1];

        // Match images
        const m = name.match(IMAGE_RE);
        if (m) {
          const pid = parseInt(m[1], 10);
          const aid = parseInt(m[2], 10);
          const key = makeKey(pid, aid);
          
          // Load the module and get the URL
          const module = await moduleLoader() as { default: string };
          const imageUrl = module.default;
          
          // Fetch and convert to File object
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const file = new File([blob], name, { type: blob.type });
          
          imgMap[key] = {
            key,
            pid,
            aid,
            file,
            url: imageUrl,
            name,
          };
          (per[pid] ||= new Set()).add(aid);
        }
      }

      // Process text files (only for Phase I)
      if (which === "I") {
        for (const [path, textLoader] of Object.entries(phaseDataTexts)) {
          // Extract filename from path
          const pathParts = path.split('/');
          const name = pathParts[pathParts.length - 1];

          // Match description files
          const m = name.match(NARR_RE);
          if (m) {
            const pid = parseInt(m[1], 10);
            const aid = parseInt(m[2], 10);
            const key = makeKey(pid, aid);
            
            // Load the module and get the URL, then fetch
            const module = await textLoader() as { default: string };
            const textUrl = module.default;
            
            // Fetch and convert to File object
            const response = await fetch(textUrl);
            const blob = await response.blob();
            const file = new File([blob], name, { type: 'text/plain' });
            
            narrMap[key] = { key, pid, aid, file, name };
          }
        }
      }

      const perOut: Record<number, number[]> = {};
      for (const [pidStr, aids] of Object.entries(per)) {
        perOut[Number(pidStr)] = Array.from(aids).sort((a, b) => a - b);
      }

      if (which === "I") {
        setImagesPhaseI((prev) => {
          // Revoke old blob URLs before setting new ones
          Object.values(prev).forEach((r) => {
            if (r.url.startsWith('blob:')) {
              URL.revokeObjectURL(r.url);
            }
          });
          return imgMap;
        });
        setNarrsPhaseI(narrMap);
        setByPersonaI(perOut);
      } else {
        setImagesPhaseII((prev) => {
          // Revoke old blob URLs before setting new ones
          Object.values(prev).forEach((r) => {
            if (r.url.startsWith('blob:')) {
              URL.revokeObjectURL(r.url);
            }
          });
          return imgMap;
        });
        setNarrsPhaseII(narrMap);
        setByPersonaII(perOut);
      }

      // Only set selected key if this phase matches the current phase
      // Use a ref to get the latest phase value to avoid stale closures
      if (phaseRef.current === which) {
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
      
      console.log(`Phase ${which} loaded: ${Object.keys(imgMap).length} images, ${Object.keys(narrMap).length} narrators`);
    } catch (e) {
      console.error("loadPhaseFromAssets error:", e);
      console.error("Error details:", e);
      alert("Failed to load Phase " + which + " from assets. Check console for details.");
    }
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

  // --------- 自动加载 Phase I 和 Phase II 数据 ---------
  useEffect(() => {
    loadPhaseFromAssets("I");
    loadPhaseFromAssets("II");
  }, []); // Run once on mount

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
          setSmartTextB("");
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
        // 兼容老字段 "Smart Assistant Interaction" 和新字段 A/B
        const smartA = (
          data["Smart Assistant Interaction A"] ??
          data["Smart Assistant Interaction"] ??
          ""
        ).toString();
        const smartB = (
          data["Smart Assistant Interaction B"] ??
          data["Smart Assistant Interaction"] ??
          smartA
        ).toString();

        setUserNameFromNarr(userName);
        setActivityDesc(activity);
        setSmartTextA(smartA);
        setSmartTextB(smartB);
      } catch (e) {
        console.error("read narrator error:", e);
        if (!cancelled) {
          setUserNameFromNarr("");
          setActivityDesc("");
          setSmartTextA("");
          setSmartTextB("");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedKey, phase, narrsPhaseI, narrsPhaseII]);

  // Track if we're starting Phase II to prevent clearing timeout
  const startingPhaseIIRef = useRef(false);
  
  // --------- 每次切换图片时清空 Phase II 输入框 ---------
  useEffect(() => {
    // Only clear timeout when selectedKey changes (user manually switches images)
    // Not when phase changes (that's handled separately)
    if (autoSendTimeoutRef.current && !startingPhaseIIRef.current) {
      clearTimeout(autoSendTimeoutRef.current);
      autoSendTimeoutRef.current = null;
    }
    
    setInteractionText("");
    setMarkComments({});
    setCategoryRanking([]);
    setFeedbackChoice("NO");
    setSatisfaction({ q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 });
    setExpandedSatisfaction(false);
    setExpandedMark(false);
  }, [selectedKey]);
  
  // Separate effect for phase changes that doesn't clear timeout
  useEffect(() => {
    if (phase === "I") {
      setInteractionText("");
      setMarkComments({});
      setCategoryRanking([]);
      setFeedbackChoice("NO");
      setSatisfaction({ q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 });
      setExpandedSatisfaction(false);
      setExpandedMark(false);
    }
  }, [phase]);

  // Handle ESC key to close Phase II modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showPhaseIIModal) {
        setShowPhaseIIModal(false);
        setSelectedMethod(null);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showPhaseIIModal]);

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

  // ================= Activation Steering WebSocket 集成 =================

  function handleWsMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      const type = (data.type || "").toLowerCase();

      if (type === "hello_confirm") {
        setSessionState("hello_sent");
      } else if (type === "resume_confirm" || type === "method_confirm") {
        setSessionState("method_ready");
        if (typeof data.interaction_count === "number") {
          setInteractionCount(data.interaction_count);
        }
        // Note: Context is now sent immediately after method, not waiting for confirmation
      } else if (type === "response") {
        setSessionState("waiting_feedback");
        if (typeof data.interaction_count === "number") {
          setInteractionCount(data.interaction_count);
        }
        const text =
          typeof data.response === "string"
            ? data.response
            : JSON.stringify(data.response, null, 2);
        setLlmResponse(text);
        setIsLoadingLLM(false);
      } else if (type === "error") {
        const msg = data.message || data.detail || data.code || "Unknown error";
        alert(`Model error: ${msg}`);
        setIsLoadingLLM(false);
      }
    } catch (e) {
      console.error("Failed to parse WS message", e);
      setIsLoadingLLM(false);
    }
  }

  function ensureSocketConnected() {
    if (
      socketRef.current &&
      socketRef.current.readyState === WebSocket.OPEN
    ) {
      return;
    }

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    setWsStatus("connecting");

    socket.onopen = () => {
      setWsStatus("connected");
      console.log("✅ Connected to bridge:", wsUrl);
      // 如果已经有 userId，自动发送 hello + method
      if (userId) {
        sendHello(false);
        sendMethod("activation_steering");
      }
    };

    socket.onmessage = handleWsMessage;

    socket.onerror = (event) => {
      console.error("⚠️ WebSocket error", event);
      setWsStatus("disconnected");
      setIsLoadingLLM(false);
    };

    socket.onclose = () => {
      console.log("🔌 WebSocket closed");
      setWsStatus("disconnected");
      setSessionState("idle");
      setIsLoadingLLM(false);
    };
  }

  function sendMessage(msg: any): boolean {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("Model connection not ready. Please connect and try again.");
      return false;
    }
    try {
      const messageStr = JSON.stringify(msg);
      console.log("📤 Sending message to backend:", msg);
      socket.send(messageStr);
      return true;
    } catch (err) {
      console.error("Error sending WS message:", err);
      alert("Failed to send message to model.");
      return false;
    }
  }

  function sendHello(isResume: boolean) {
    if (!userId) {
      alert("Please enter User ID before starting the model session.");
      return;
    }
    const msg: any = {
      type: "hello",
      user_id: userId,
    };
    if (isResume) {
      msg.resume = true;
    }
    if (sendMessage(msg)) {
      setSessionState("hello_sent");
    }
  }

  function sendMethod(method: "vanilla" | "activation_steering" | "combined") {
    sendMessage({
      type: "method",
      method,
    });
  }

  // 初次挂载时尝试连接 WebSocket
  useEffect(() => {
    ensureSocketConnected();
    return () => {
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------- Phase II：Back to Model（发送反馈给模型）---------
  async function onBackToModel() {
    if (!currentImg) {
      alert("No image selected.");
      return;
    }
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }
    if (!interactionText.trim()) {
      alert("Please enter interaction content first.");
      return;
    }

    // 确保 WebSocket 已连接
    if (wsStatus !== "connected") {
      ensureSocketConnected();
      alert("Connecting to model... please click Back to Model again in a moment.");
      return;
    }

    // 会话尚未开始时，先发送 hello + method
    if (sessionState === "idle") {
      sendHello(false);
      sendMethod("activation_steering");
      alert("Starting model session... please click Back to Model again in a moment.");
      return;
    }

    setIsLoadingLLM(true);

    // 将 Interaction 文本映射为 workflow 的 feedback payload
    // Format mark comments as "category: comment; category2: comment2" or "NONE"
    const markEntries = Object.entries(markComments).filter(([_, comment]) => comment.trim() !== "");
    const marksString = markEntries.length === 0 
      ? "NONE" 
      : markEntries.map(([cat, comment]) => `${cat}: ${comment.trim()}`).join("; ");

    // Format satisfaction survey - use actual values (0 if not selected)
    const feedbackPayload = {
      choice: feedbackChoice,
      response: interactionText,
      satisfaction_survey: `Q1:${satisfaction.q1 || 0} Q2:${satisfaction.q2 || 0} Q3:${satisfaction.q3 || 0} Q4:${satisfaction.q4 || 0} Q5:${satisfaction.q5 || 0}`,
      mark: marksString,
      category_ranking:
        categoryRanking.length > 0
          ? categoryRanking
          : [
              "timing_interruption",
              "communication_style",
              "autonomy_control",
              "context_adaptation",
              "domain_priorities",
            ], // Fallback to default if no ranking selected
    };

    const ok = sendMessage({
      type: "feedback",
      payload: feedbackPayload,
    });

    if (!ok) {
      setIsLoadingLLM(false);
      return;
    }

    setSessionState("method_ready");
    setIsLoadingLLM(false);
    alert("Interaction feedback sent to model.");
  }

  // Auto-send context function - uses refs to avoid stale closure issues
  function autoSendContext() {
    // Get current image using refs to ensure we have the latest values
    const currentKey = selectedKeyRef.current;
    const currentPhase = phaseRef.current;
    const currentImages = currentPhase === "I" ? imagesPhaseIRef.current : imagesPhaseIIRef.current;
    const currentImage = currentKey ? currentImages[currentKey] : undefined;
    
    if (!currentImage) {
      console.warn("⚠️ No image selected, cannot send context. Key:", currentKey, "Phase:", currentPhase);
      return;
    }
    
    // Always use fallback format: Persona {pid}, Activity {aid}
    const scenarioText = `Persona ${currentImage.pid}, Activity ${currentImage.aid}`;
    const timeframe = "N/A";

    console.log(`📤 Preparing to send context for: ${scenarioText} (key: ${currentKey}, phase: ${currentPhase})`);

    setIsLoadingLLM(true);
    const ok = sendMessage({
      type: "context",
      payload: {
        scenario_text: scenarioText,
        timeframe,
      },
    });

    if (!ok) {
      setIsLoadingLLM(false);
      return;
    }

    setSessionState("waiting_response");
  }

  // Continue/Next button - sends feedback then automatically sends next context
  function onContinueNext() {
    // Get current image from state to avoid stale closure issues
    const currentImage = selectedKey ? images[selectedKey] : undefined;
    if (!currentImage) {
      alert("No image selected.");
      return;
    }
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }
    if (!interactionText.trim()) {
      alert("Please enter interaction content first.");
      return;
    }
    if (wsStatus !== "connected") {
      alert("WebSocket not connected. Cannot continue.");
      return;
    }

    setIsLoadingLLM(true);

    // Format mark comments
    const markEntries = Object.entries(markComments).filter(([_, comment]) => comment.trim() !== "");
    const marksString = markEntries.length === 0 
      ? "NONE" 
      : markEntries.map(([cat, comment]) => `${cat}: ${comment.trim()}`).join("; ");

    // Format satisfaction survey
    const feedbackPayload = {
      choice: feedbackChoice,
      response: interactionText,
      satisfaction_survey: `Q1:${satisfaction.q1 || 0} Q2:${satisfaction.q2 || 0} Q3:${satisfaction.q3 || 0} Q4:${satisfaction.q4 || 0} Q5:${satisfaction.q5 || 0}`,
      mark: marksString,
      category_ranking:
        categoryRanking.length > 0
          ? categoryRanking
          : [
              "timing_interruption",
              "communication_style",
              "autonomy_control",
              "context_adaptation",
              "domain_priorities",
            ],
    };

    // Send feedback
    const feedbackOk = sendMessage({
      type: "feedback",
      payload: feedbackPayload,
    });

    if (!feedbackOk) {
      setIsLoadingLLM(false);
      return;
    }

    // Clear current feedback inputs
    setInteractionText("");
    setMarkComments({});
    setCategoryRanking([]);
    setFeedbackChoice("NO");
    setSatisfaction({ q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 });

    // Move to next image automatically
    goNextImage();

    // Wait a moment then auto-send next context (will use the new image after goNextImage)
    setTimeout(() => {
      autoSendContext();
    }, 500);
  }

  // --------- Phase II：Get New（发送 context，获取模型新响应）---------
  async function onGetNew() {
    if (!currentImg) {
      alert("No image selected.");
      return;
    }
    if (!userId) {
      alert("Please enter User ID first.");
      return;
    }

    if (wsStatus !== "connected") {
      ensureSocketConnected();
      alert("Connecting to model... please click Get New again in a moment.");
      return;
    }

    if (sessionState === "idle") {
      sendHello(false);
      sendMethod("activation_steering");
      alert("Starting model session... please click Get New again in a moment.");
      return;
    }

    setIsLoadingLLM(true);

    // Always use fallback format: Persona {pid}, Activity {aid}
    const scenarioText = `Persona ${currentImg.pid}, Activity ${currentImg.aid}`;
    const timeframe = "N/A";

    const ok = sendMessage({
      type: "context",
      payload: {
        scenario_text: scenarioText,
        timeframe,
      },
    });

    if (!ok) {
      setIsLoadingLLM(false);
      return;
    }

    setSessionState("waiting_response");
  }

// --------- Phase II：Save Interaction (Save to local state) ---------
function onSaveInteraction() {
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

  alert("Interaction saved for this image in Phase II.");
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
      pre: null,
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
        fontSize: 45,
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
        fontSize: 45,
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
          <div className="label" style={{ fontSize: 45 }}>
            File
          </div>
          <select
            className="select dark"
            style={{ fontSize: 45 }}
            value={currentImg?.name || ""}
            onChange={(e) => onFilenameChange(e.target.value)}
          >
            {filenameOptions.length === 0 && (
              <option value="">(N/A)</option>
            )}
            {filenameOptions.map((rec) => (
              <option key={rec.key} value={rec.name}>
                {rec.name}
              </option>
            ))}
          </select>

          <div className="label" style={{ fontSize: 45 }}>
            Persona
          </div>
          <select
            className="select dark"
            style={{ fontSize: 45 }}
            value={selectedPid != null ? String(selectedPid) : ""}
            onChange={(e) => onPersonaChange(e.target.value)}
          >
            {personaOptions.length === 0 && (
              <option value="">(N/A)</option>
            )}
            {personaOptions.map((pid) => (
              <option key={pid} value={String(pid)}>
                {pid}
              </option>
            ))}
          </select>

          <div className="label" style={{ fontSize: 45 }}>
            Activity
          </div>
          <select
            className="select dark"
            style={{ fontSize: 45 }}
            value={selectedAid != null ? String(selectedAid) : ""}
            onChange={(e) => onActivityChange(e.target.value)}
          >
            {activityOptions.length === 0 && (
              <option value="">(N/A)</option>
            )}
            {activityOptions.map((aid) => (
              <option key={aid} value={String(aid)}>
                {aid}
              </option>
            ))}
          </select>

          {/* User 输入 */}
          <div className="label" style={{ fontSize: 45 }}>
            User ID
          </div>
          <input
            className="input"
            style={{
              fontSize: 45,
              padding: "4px 10px",
              width: 180,
            }}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. 301"
          />

          <button
            className="btn btn-secondary"
            style={{ fontSize: 45 }}
            onClick={() => setShowSurveyModal(true)}
          >
            Survey
          </button>

          <button
            className="btn btn-secondary"
            style={{ fontSize: 45 }}
            onClick={chooseResultPath}
          >
            Result Path
          </button>

          <button
            className="btn btn-primary"
            style={{ fontSize: 45 }}
            onClick={saveAll}
          >
            Save ALL
          </button>

          {/* Phase 切换 */}
          <PhaseBtn active={phase === "I"} onClick={() => setPhase("I")}>
            Phase I
          </PhaseBtn>
          <PhaseBtn
            active={phase === "II"}
            onClick={() => {
              if (!phaseIIStarted) {
                setShowPhaseIIModal(true);
              } else {
                setPhase("II");
              }
            }}
          >
            Phase II
          </PhaseBtn>

          <div className="spacer" />

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
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          ) : (
            <div className="placeholder" style={{ fontSize: 45 }}>
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
                    fontSize: 45,
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
                      fontSize: 45,
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
                      fontSize: 45,
                      lineHeight: 1.5,
                      fontFamily: "monospace", // Better for JSON display
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
              <div style={{ fontWeight: 900, fontSize: 45 }}>
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
                  fontSize: 45,
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
                  fontSize: 45,
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
                  fontSize: 45,
                  lineHeight: 1.6,
                }}
              />
            </SectionBox>

            <SectionBox title="B" emphasized={variant === "B"}>
              <textarea
                className="narr"
                readOnly
                value={smartTextB || "PlaceHolder B"}
                style={{
                  height: "100%",
                  width: "100%",
                  resize: "none",
                  fontSize: 45,
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
              gridTemplateRows: "3fr 7fr",
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
                    fontSize: 45,
                    marginBottom: 10,
                    lineHeight: 1.2,
                  }}
                >
                  Based on the description of interaction with smart assistant.
                </div>

                <textarea
                  className="narr"
                  readOnly
                  value={llmResponse || smartTextA}
                  style={{
                    height: "100%",
                    width: "100%",
                    resize: "none",
                    fontSize: 45,
                    lineHeight: 1.5,
                    fontFamily: "monospace", // Better for JSON display
                  }}
                />
              </div>
            </SectionBox>
            {/* 下方：Choice + Interaction + Mark + Satisfaction Survey + 按钮 */}
            <SectionBox title="">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "4px 8px 8px 8px",
                  gap: 12,
                  overflowY: "auto",
                }}
              >
                {/* 1. Choice - Always visible, first */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 45,
                    flexShrink: 0,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Choice:</div>
                  <button
                    className="btn"
                    style={{
                      fontSize: 45,
                      padding: "6px 18px",
                      border:
                        feedbackChoice === "YES"
                          ? "2px solid #22c55e"
                          : "1px solid #374151",
                      background:
                        feedbackChoice === "YES" ? "#064e3b" : "#111827",
                    }}
                    onClick={() => setFeedbackChoice("YES")}
                  >
                    YES
                  </button>
                  <button
                    className="btn"
                    style={{
                      fontSize: 45,
                      padding: "6px 18px",
                      border:
                        feedbackChoice === "NO"
                          ? "2px solid #ef4444"
                          : "1px solid #374151",
                      background:
                        feedbackChoice === "NO" ? "#450a0a" : "#111827",
                    }}
                    onClick={() => setFeedbackChoice("NO")}
                  >
                    NO
                  </button>
                </div>

                {/* 2. Interaction - Always visible, second */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 45, marginBottom: 8 }}>
                    Interaction
                  </div>
                  <textarea
                    className="narr"
                    value={interactionText}
                    onChange={(e) => setInteractionText(e.target.value)}
                    placeholder="Type any interaction notes here..."
                    style={{
                      width: "100%",
                      minHeight: 120,
                      resize: "vertical",
                      fontSize: 45,
                      lineHeight: 1.5,
                    }}
                  />
                  
                  {/* Category Ranking */}
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 40, marginBottom: 8 }}>
                      Category Ranking (click order):
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        fontSize: 40,
                        marginBottom: 8,
                      }}
                    >
                      {[
                        "timing_interruption",
                        "communication_style",
                        "autonomy_control",
                        "context_adaptation",
                        "domain_priorities",
                      ].map((cat) => (
                        <label
                          key={cat}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            cursor: "pointer",
                            padding: "4px 0",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={categoryRanking.includes(cat)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                // Add to ranking in click order
                                setCategoryRanking((prev) => [...prev, cat]);
                              } else {
                                // Remove from ranking
                                setCategoryRanking((prev) =>
                                  prev.filter((c) => c !== cat)
                                );
                              }
                            }}
                            style={{
                              width: 28,
                              height: 28,
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ flex: 1 }}>{cat}</span>
                          {categoryRanking.includes(cat) && (
                            <span
                              style={{
                                fontSize: 35,
                                color: "#60a5fa",
                                flexShrink: 0,
                                marginLeft: 8,
                              }}
                            >
                              #{categoryRanking.indexOf(cat) + 1}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    {categoryRanking.length > 0 && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          backgroundColor: "#1e293b",
                          borderRadius: 4,
                          fontSize: 38,
                          color: "#cbd5e1",
                        }}
                      >
                        <strong>Current Ranking:</strong>{" "}
                        {categoryRanking
                          .map((cat, idx) => `${idx + 1}. ${cat}`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Mark - With expand/collapse toggle, third */}
                <div
                  style={{
                    border: "1px solid #374151",
                    borderRadius: 4,
                    padding: "8px",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      fontSize: 45,
                      fontWeight: 700,
                    }}
                    onClick={() => setExpandedMark(!expandedMark)}
                  >
                    <span>Mark</span>
                    <span>{expandedMark ? "▼" : "▶"}</span>
                  </div>
                  {expandedMark && (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        fontSize: 45,
                      }}
                    >
                      {[
                        "timing_interruption",
                        "communication_style",
                        "autonomy_control",
                        "context_adaptation",
                        "domain_priorities",
                      ].map((cat) => (
                        <div key={cat}>
                          <div style={{ marginBottom: 4, fontSize: 40 }}>
                            {cat}:
                          </div>
                          <input
                            type="text"
                            className="input"
                            value={markComments[cat] || ""}
                            onChange={(e) =>
                              setMarkComments((prev) => ({
                                ...prev,
                                [cat]: e.target.value,
                              }))
                            }
                            placeholder={`Enter comments for ${cat}...`}
                            style={{
                              width: "100%",
                              fontSize: 45,
                              padding: "8px 12px",
                              backgroundColor: "#111827",
                              color: "#ffffff",
                              border: "1px solid #374151",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4. Satisfaction Survey - With expand/collapse toggle, last */}
                <div
                  style={{
                    border: "1px solid #374151",
                    borderRadius: 4,
                    padding: "8px",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      fontSize: 45,
                      fontWeight: 700,
                    }}
                    onClick={() => setExpandedSatisfaction(!expandedSatisfaction)}
                  >
                    <span>Satisfaction Survey</span>
                    <span>{expandedSatisfaction ? "▼" : "▶"}</span>
                  </div>
                  {expandedSatisfaction && (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        fontSize: 45,
                      }}
                    >
                      <div>
                        <div style={{ marginBottom: 4 }}>
                          Q1 – Relevance & Timing (1 = irrelevant / bad timing, 5 = perfect)
                        </div>
                        <select
                          className="select dark"
                          style={{
                            fontSize: 45,
                            width: "100%",
                            padding: "10px 16px",
                            minHeight: 64,
                          }}
                          value={satisfaction.q1 || ""}
                          onChange={(e) =>
                            setSatisfaction((prev) => ({
                              ...prev,
                              q1: Number(e.target.value) || 0,
                            }))
                          }
                        >
                          <option value="">Select...</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                      </div>

                      <div>
                        <div style={{ marginBottom: 4 }}>
                          Q2 – Intrusiveness (1 = extremely disruptive, 5 = seamless)
                        </div>
                        <select
                          className="select dark"
                          style={{
                            fontSize: 45,
                            width: "100%",
                            padding: "10px 16px",
                            minHeight: 64,
                          }}
                          value={satisfaction.q2 || ""}
                          onChange={(e) =>
                            setSatisfaction((prev) => ({
                              ...prev,
                              q2: Number(e.target.value) || 0,
                            }))
                          }
                        >
                          <option value="">Select...</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                      </div>

                      <div>
                        <div style={{ marginBottom: 4 }}>
                          Q3 – Value (1 = useless / harmful, 5 = extremely helpful)
                        </div>
                        <select
                          className="select dark"
                          style={{
                            fontSize: 45,
                            width: "100%",
                            padding: "10px 16px",
                            minHeight: 64,
                          }}
                          value={satisfaction.q3 || ""}
                          onChange={(e) =>
                            setSatisfaction((prev) => ({
                              ...prev,
                              q3: Number(e.target.value) || 0,
                            }))
                          }
                        >
                          <option value="">Select...</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                      </div>

                      <div>
                        <div style={{ marginBottom: 4 }}>
                          Q4 – Appropriateness (1 = inappropriate, 5 = perfect for context)
                        </div>
                        <select
                          className="select dark"
                          style={{
                            fontSize: 45,
                            width: "100%",
                            padding: "10px 16px",
                            minHeight: 64,
                          }}
                          value={satisfaction.q4 || ""}
                          onChange={(e) =>
                            setSatisfaction((prev) => ({
                              ...prev,
                              q4: Number(e.target.value) || 0,
                            }))
                          }
                        >
                          <option value="">Select...</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                      </div>

                      <div>
                        <div style={{ marginBottom: 4 }}>
                          Q5 – Comfort with Autonomy (1 = too pushy, 5 = respectful)
                        </div>
                        <select
                          className="select dark"
                          style={{
                            fontSize: 45,
                            width: "100%",
                            padding: "10px 16px",
                            minHeight: 64,
                          }}
                          value={satisfaction.q5 || ""}
                          onChange={(e) =>
                            setSatisfaction((prev) => ({
                              ...prev,
                              q5: Number(e.target.value) || 0,
                            }))
                          }
                        >
                          <option value="">Select...</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                {phaseIIStarted ? (
                  /* New workflow: Only Continue/Next button */
                  <div
                    style={{
                      marginTop: 20,
                      paddingTop: 12,
                      borderTop: "1px solid #374151",
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 12,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      className="btn btn-primary"
                      style={{ 
                        fontSize: 45, 
                        padding: "8px 24px",
                        opacity: isLoadingLLM ? 0.5 : 1,
                        cursor: isLoadingLLM ? "not-allowed" : "pointer"
                      }}
                      onClick={onContinueNext}
                      disabled={isLoadingLLM}
                    >
                      {isLoadingLLM ? "Loading..." : "Continue / Next"}
                    </button>
                  </div>
                ) : (
                  /* Old workflow: Keep three buttons if Phase II not started yet */
                  <div
                    style={{
                      marginTop: 20,
                      paddingTop: 12,
                      borderTop: "1px solid #374151",
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 12,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      className="btn btn-secondary"
                      style={{ 
                        fontSize: 45, 
                        padding: "8px 24px",
                        opacity: isLoadingLLM ? 0.5 : 1,
                        cursor: isLoadingLLM ? "not-allowed" : "pointer"
                      }}
                      onClick={onBackToModel}
                      disabled={isLoadingLLM}
                    >
                      {isLoadingLLM ? "Loading..." : "Back to Model"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ 
                        fontSize: 45, 
                        padding: "8px 24px",
                        opacity: isLoadingLLM ? 0.5 : 1,
                        cursor: isLoadingLLM ? "not-allowed" : "pointer"
                      }}
                      onClick={onGetNew}
                      disabled={isLoadingLLM}
                    >
                      {isLoadingLLM ? "Loading..." : "Get New"}
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 45, padding: "8px 24px" }}
                      onClick={onSaveInteraction}
                    >
                      Save All
                    </button>
                  </div>
                )}
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
                fontSize: 45,
                marginBottom: 16,
                fontWeight: 900,
              }}
            >
              Section 4. Post-Study Survey
            </h2>

            <p style={{ fontSize: 45, marginBottom: 16 }}>
              Please reflect on your overall experience interacting with the smart
              assistant.
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <div style={{ fontSize: 45, marginBottom: 4 }}>
                  Over time, did the assistant’s responses seem to:
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 45, width: "100%" }}
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
                <div style={{ fontSize: 45, marginBottom: 4 }}>
                  How well did the assistant learn and adapt to your preferences?
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 45, width: "100%" }}
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
                <div style={{ fontSize: 45, marginBottom: 4 }}>
                  How much did you trust the assistant’s decisions and actions by
                  the end of the study?
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 45, width: "100%" }}
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
                <div style={{ fontSize: 45, marginBottom: 4 }}>
                  How did the assistant’s learning or changes affect your comfort,
                  satisfaction, or willingness to use it again?
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 45, width: "100%" }}
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
                <div style={{ fontSize: 45, marginBottom: 4 }}>
                  Overall satisfaction with the assistant:
                </div>
                <select
                  className="select dark"
                  style={{ fontSize: 45, width: "100%" }}
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
                <div style={{ fontSize: 45, marginBottom: 4 }}>
                  What features or behaviors would make a self-improving assistant
                  more useful and trustworthy for you in daily life?
                </div>
                <textarea
                  className="narr"
                  style={{
                    fontSize: 45,
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
                style={{ fontSize: 45, padding: "8px 24px" }}
                onClick={() => setShowSurveyModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 45, padding: "8px 24px" }}
                onClick={saveSurvey}
              >
                Save Survey
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase II Start Modal */}
      {showPhaseIIModal && (
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
          onClick={(e) => {
            // Close modal when clicking the overlay (outside the modal content)
            if (e.target === e.currentTarget) {
              setShowPhaseIIModal(false);
              setSelectedMethod(null);
            }
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
            onClick={(e) => {
              // Prevent modal from closing when clicking inside the modal content
              e.stopPropagation();
            }}
          >
            <h2
              style={{
                fontSize: 45,
                marginBottom: 16,
                fontWeight: 900,
              }}
            >
              Start Phase II
            </h2>

            {/* WebSocket Status */}
            <div style={{ marginBottom: 24, fontSize: 40 }}>
              <div style={{ marginBottom: 12 }}>
                <strong>WebSocket Status: </strong>
                <span
                  style={{
                    color:
                      wsStatus === "connected"
                        ? "#10b981"
                        : wsStatus === "connecting"
                        ? "#f59e0b"
                        : "#ef4444",
                  }}
                >
                  {wsStatus === "connected"
                    ? "✅ Connected"
                    : wsStatus === "connecting"
                    ? "🔄 Connecting..."
                    : "❌ Disconnected"}
                </span>
              </div>
            </div>

            {/* Method Selection - Only show if connected */}
            {wsStatus === "connected" && (
              <>
                <div style={{ marginBottom: 16, fontSize: 40 }}>
                  <strong>Select Interaction Method:</strong>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 24,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    className="btn"
                    style={{
                      fontSize: 45,
                      padding: "12px 24px",
                      border:
                        selectedMethod === "vanilla"
                          ? "2px solid #2563eb"
                          : "1px solid #374151",
                      background:
                        selectedMethod === "vanilla" ? "#1e3a8a" : "#111827",
                    }}
                    onClick={() => setSelectedMethod("vanilla")}
                  >
                    V 
                  </button>
                  <button
                    className="btn"
                    style={{
                      fontSize: 45,
                      padding: "12px 24px",
                      border:
                        selectedMethod === "activation_steering"
                          ? "2px solid #2563eb"
                          : "1px solid #374151",
                      background:
                        selectedMethod === "activation_steering"
                          ? "#1e3a8a"
                          : "#111827",
                    }}
                    onClick={() => setSelectedMethod("activation_steering")}
                  >
                    A 
                  </button>
                  <button
                    className="btn"
                    style={{
                      fontSize: 45,
                      padding: "12px 24px",
                      border:
                        selectedMethod === "combined"
                          ? "2px solid #2563eb"
                          : "1px solid #374151",
                      background:
                        selectedMethod === "combined" ? "#1e3a8a" : "#111827",
                    }}
                    onClick={() => setSelectedMethod("combined")}
                  >
                    C 
                  </button>
                </div>

                {/* Warning */}
                <div
                  style={{
                    marginBottom: 24,
                    padding: 16,
                    backgroundColor: "#450a0a",
                    borderRadius: 8,
                    border: "1px solid #7f1d1d",
                    fontSize: 38,
                    color: "#fca5a5",
                  }}
                >
                  ⚠️ <strong>Warning:</strong> After clicking "Start Phase II" and
                  continuing to the next context, you will not be able to return to
                  previous interactions.
                </div>

                {/* Start Button - Only enabled when method selected */}
                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                  <button
                    className="btn btn-hollow"
                    style={{ fontSize: 45, padding: "12px 24px" }}
                    onClick={() => {
                      setShowPhaseIIModal(false);
                      setSelectedMethod(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{
                      fontSize: 45,
                      padding: "12px 24px",
                      opacity: selectedMethod ? 1 : 0.5,
                      cursor: selectedMethod ? "pointer" : "not-allowed",
                    }}
                    onClick={async () => {
                      if (!selectedMethod || wsStatus !== "connected") return;
                      if (!userId) {
                        alert("Please enter User ID first.");
                        return;
                      }
                      if (!currentImg) {
                        alert("Please select an image first.");
                        return;
                      }
                      
                      // Capture current image info at this moment to avoid stale closure
                      const imageToSend = currentImg;
                      if (!imageToSend) {
                        alert("No image selected.");
                        return;
                      }
                      
                      // Set flag to prevent timeout from being cleared
                      startingPhaseIIRef.current = true;
                      
                      setShowPhaseIIModal(false);
                      setPhase("II");
                      setPhaseIIStarted(true);
                      
                      // Send hello + method, then immediately send context
                      sendHello(false);
                      sendMethod(selectedMethod);
                      
                      // Cancel any pending auto-send
                      if (autoSendTimeoutRef.current) {
                        clearTimeout(autoSendTimeoutRef.current);
                      }
                      
                      // Send context immediately after method using captured image
                      autoSendTimeoutRef.current = window.setTimeout(() => {
                        const scenarioText = `Persona ${imageToSend.pid}, Activity ${imageToSend.aid}`;
                        console.log(`📤 Sending initial context for: ${scenarioText} (captured at Start click)`);
                        setIsLoadingLLM(true);
                        const ok = sendMessage({
                          type: "context",
                          payload: {
                            scenario_text: scenarioText,
                            timeframe: "N/A",
                          },
                        });
                        if (ok) {
                          setSessionState("waiting_response");
                        } else {
                          setIsLoadingLLM(false);
                        }
                        autoSendTimeoutRef.current = null;
                        startingPhaseIIRef.current = false; // Reset flag after timeout executes
                      }, 800);
                    }}
                    disabled={!selectedMethod || wsStatus !== "connected"}
                  >
                    Start Phase II
                  </button>
                </div>
              </>
            )}

            {/* Show message if not connected */}
            {wsStatus !== "connected" && (
              <div
                style={{
                  padding: 16,
                  backgroundColor: "#450a0a",
                  borderRadius: 8,
                  fontSize: 40,
                  color: "#fca5a5",
                }}
              >
                Cannot start Phase II. WebSocket connection is not available. Please
                check your connection and try again.
              </div>
            )}
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
            fontSize: 45,
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

