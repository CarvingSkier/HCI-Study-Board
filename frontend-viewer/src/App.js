import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
/** 文件名匹配规则：Persona_17_Activity_145.jpg / Persona_17_Activity_145_Description.txt */
const IMAGE_RE = /^Persona_(\d+)_Activity_(\d+)\.(?:jpg|jpeg|png)$/i;
const NARR_RE = /^Persona_(\d+)_Activity_(\d+)_Description\.(?:txt|md|json)$/i;
function makeKey(pid, aid) {
    return `${pid}-${aid}`;
}
/** 下载 JSON（作为没有目录权限时的 fallback） */
function downloadJson(filename, data) {
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
    const [phase, setPhase] = useState("I");
    const [userId, setUserId] = useState("");
    // Phase I & Phase II 各自的图像 / narrator 映射
    const [imagesPhaseI, setImagesPhaseI] = useState({});
    const [narrsPhaseI, setNarrsPhaseI] = useState({});
    const [byPersonaI, setByPersonaI] = useState({});
    const [imagesPhaseII, setImagesPhaseII] = useState({});
    const [narrsPhaseII, setNarrsPhaseII] = useState({});
    const [byPersonaII, setByPersonaII] = useState({});
    // 当前选中的图片
    const [selectedKey, setSelectedKey] = useState(null);
    const [selectedPid, setSelectedPid] = useState(null);
    const [selectedAid, setSelectedAid] = useState(null);
    // Narrator 解析出来的字段
    const [userNameFromNarr, setUserNameFromNarr] = useState("");
    const [activityDesc, setActivityDesc] = useState("");
    const [smartTextA, setSmartTextA] = useState("");
    // Phase I：A/B 选择（只存内存）
    const [variant, setVariant] = useState("A");
    const [phaseISelections, setPhaseISelections] = useState({}); // key = imageName
    // Phase II：当前 Interaction 文本 & 累积（只存内存）
    const [interactionText, setInteractionText] = useState("");
    const [phaseIIInteractions, setPhaseIIInteractions] = useState({});
    // 结果 JSON 的目录句柄（Result Path）
    const [resultDirHandle, setResultDirHandle] = useState(null);
    // 中间 splitter
    const [splitPct, setSplitPct] = useState(58);
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
    const [preInfo, setPreInfo] = useState(null);
    // Survey 表单（也是内存）
    const [survey, setSurvey] = useState({
        overallChange: "",
        adaptPref: "",
        trustChange: "",
        comfortChange: "",
        satisfaction: "",
        comments: "",
    });
    // --------- Activation Steering 后端 WebSocket 状态 ---------
    const [llmResponse, setLlmResponse] = useState(""); // Phase II 顶部模型返回文本
    const [isLoadingLLM, setIsLoadingLLM] = useState(false);
    const [wsStatus, setWsStatus] = useState("disconnected");
    const [sessionState, setSessionState] = useState("idle");
    const [interactionCount, setInteractionCount] = useState(0);
    // WebSocket bridge URL（见 FRONTEND_INTEGRATION_GUIDE）
    const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8765/ui";
    const socketRef = useRef(null);
    // --------- 根据 phase 取当前的 images / narrs / byPersona ---------
    const images = phase === "I" ? imagesPhaseI : imagesPhaseII;
    const narrs = phase === "I" ? narrsPhaseI : narrsPhaseII;
    const byPersona = phase === "I" ? byPersonaI : byPersonaII;
    const currentImg = selectedKey ? images[selectedKey] : undefined;
    // --------- File input 作为 fallback （不走 showDirectoryPicker 时用）---------
    const folderInputRef = useRef(null);
    function openFolderInput(phase) {
        const el = folderInputRef.current;
        if (!el)
            return;
        el.dataset.phase = phase;
        el.value = "";
        el.click();
    }
    // --------- 目录加载：Phase I / Phase II 各自一套 ---------
    async function loadPhaseDir(which) {
        const canPick = window.showDirectoryPicker;
        if (!canPick) {
            openFolderInput(which);
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({
                id: which === "I" ? "phase-i-dir" : "phase-ii-dir",
            });
            const imgMap = {};
            const narrMap = {};
            const per = {};
            // @ts-ignore
            for await (const [, entry] of handle.entries()) {
                if (entry.kind !== "file")
                    continue;
                const file = await entry.getFile();
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
            const perOut = {};
            for (const [pidStr, aids] of Object.entries(per)) {
                perOut[Number(pidStr)] = Array.from(aids).sort((a, b) => a - b);
            }
            if (which === "I") {
                Object.values(imagesPhaseI).forEach((r) => URL.revokeObjectURL(r.url));
                setImagesPhaseI(imgMap);
                setNarrsPhaseI(narrMap);
                setByPersonaI(perOut);
            }
            else {
                Object.values(imagesPhaseII).forEach((r) => URL.revokeObjectURL(r.url));
                setImagesPhaseII(imgMap);
                setNarrsPhaseII(narrMap);
                setByPersonaII(perOut);
            }
            if (phase === which) {
                const sorted = Object.values(imgMap).sort((a, b) => a.pid - b.pid || a.aid - b.aid);
                if (sorted.length) {
                    const first = sorted[0];
                    setSelectedKey(first.key);
                    setSelectedPid(first.pid);
                    setSelectedAid(first.aid);
                }
                else {
                    setSelectedKey(null);
                    setSelectedPid(null);
                    setSelectedAid(null);
                }
            }
        }
        catch (e) {
            console.error("loadPhaseDir error:", e);
            alert("Failed to load folder for Phase " + which);
        }
    }
    // fallback: input[type=file, webkitdirectory]
    function onFolderInputChange(e) {
        const phaseAttr = e.target.dataset.phase;
        const which = phaseAttr === "II" ? "II" : "I";
        const files = Array.from(e.target.files ?? []);
        const imgMap = {};
        const narrMap = {};
        const per = {};
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
        const perOut = {};
        for (const [pidStr, aids] of Object.entries(per)) {
            perOut[Number(pidStr)] = Array.from(aids).sort((a, b) => a - b);
        }
        if (which === "I") {
            Object.values(imagesPhaseI).forEach((r) => URL.revokeObjectURL(r.url));
            setImagesPhaseI(imgMap);
            setNarrsPhaseI(narrMap);
            setByPersonaI(perOut);
        }
        else {
            Object.values(imagesPhaseII).forEach((r) => URL.revokeObjectURL(r.url));
            setImagesPhaseII(imgMap);
            setNarrsPhaseII(narrMap);
            setByPersonaII(perOut);
        }
        if (phase === which) {
            const sorted = Object.values(imgMap).sort((a, b) => a.pid - b.pid || a.aid - b.aid);
            if (sorted.length) {
                const first = sorted[0];
                setSelectedKey(first.key);
                setSelectedPid(first.pid);
                setSelectedAid(first.aid);
            }
            else {
                setSelectedKey(null);
                setSelectedPid(null);
                setSelectedAid(null);
            }
        }
    }
    // --------- 切换 phase 时，确保选中的 key 来自该 phase ---------
    useEffect(() => {
        const imgs = phase === "I" ? imagesPhaseI : imagesPhaseII;
        if (selectedKey && imgs[selectedKey])
            return;
        const sorted = Object.values(imgs).sort((a, b) => a.pid - b.pid || a.aid - b.aid);
        if (sorted.length) {
            const first = sorted[0];
            setSelectedKey(first.key);
            setSelectedPid(first.pid);
            setSelectedAid(first.aid);
        }
        else {
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
                let data;
                try {
                    data = JSON.parse(raw);
                }
                catch {
                    data = {};
                }
                if (cancelled)
                    return;
                const userName = (data["User Name"] ?? "").toString();
                const activity = (data["Activity Description"] ?? "").toString();
                const smart = (data["Smart Assistant Interaction"] ?? "").toString();
                setUserNameFromNarr(userName);
                setActivityDesc(activity);
                setSmartTextA(smart);
            }
            catch (e) {
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
    const filenameOptions = useMemo(() => Object.values(images).sort((a, b) => a.pid - b.pid || a.aid - b.aid), [images]);
    const personaOptions = useMemo(() => Object.keys(byPersona).map(Number).sort((a, b) => a - b), [byPersona]);
    const activityOptions = useMemo(() => selectedPid == null ? [] : byPersona[selectedPid] || [], [byPersona, selectedPid]);
    function selectByKey(key) {
        if (!key)
            return;
        const rec = images[key];
        if (!rec)
            return;
        setSelectedKey(key);
        setSelectedPid(rec.pid);
        setSelectedAid(rec.aid);
    }
    function onFilenameChange(name) {
        const rec = filenameOptions.find((r) => r.name === name);
        if (rec)
            selectByKey(rec.key);
    }
    function onPersonaChange(pidStr) {
        const pid = Number(pidStr);
        setSelectedPid(pid);
        const aids = byPersona[pid] || [];
        if (aids.length) {
            const key = makeKey(pid, aids[0]);
            selectByKey(key);
        }
    }
    function onActivityChange(aidStr) {
        if (selectedPid == null)
            return;
        const aid = Number(aidStr);
        const key = makeKey(selectedPid, aid);
        selectByKey(key);
    }
    // --------- Next Image（Phase I & II 共用）---------
    function goNextImage() {
        const list = filenameOptions;
        if (!list.length)
            return;
        if (!selectedKey) {
            const first = list[0];
            selectByKey(first.key);
            return;
        }
        const idx = list.findIndex((r) => r.key === selectedKey);
        if (idx >= 0 && idx + 1 < list.length) {
            const next = list[idx + 1];
            selectByKey(next.key);
        }
        else {
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
    function handleWsMessage(event) {
        try {
            const data = JSON.parse(event.data);
            const type = (data.type || "").toLowerCase();
            if (type === "hello_confirm") {
                setSessionState("hello_sent");
            }
            else if (type === "resume_confirm" || type === "method_confirm") {
                setSessionState("method_ready");
                if (typeof data.interaction_count === "number") {
                    setInteractionCount(data.interaction_count);
                }
            }
            else if (type === "response") {
                setSessionState("waiting_feedback");
                if (typeof data.interaction_count === "number") {
                    setInteractionCount(data.interaction_count);
                }
                const text = typeof data.response === "string"
                    ? data.response
                    : JSON.stringify(data.response, null, 2);
                setLlmResponse(text);
                setIsLoadingLLM(false);
            }
            else if (type === "error") {
                const msg = data.message || data.detail || data.code || "Unknown error";
                alert(`Model error: ${msg}`);
                setIsLoadingLLM(false);
            }
        }
        catch (e) {
            console.error("Failed to parse WS message", e);
            setIsLoadingLLM(false);
        }
    }
    function ensureSocketConnected() {
        if (socketRef.current &&
            socketRef.current.readyState === WebSocket.OPEN) {
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
    function sendMessage(msg) {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            alert("Model connection not ready. Please connect and try again.");
            return false;
        }
        try {
            socket.send(JSON.stringify(msg));
            return true;
        }
        catch (err) {
            console.error("Error sending WS message:", err);
            alert("Failed to send message to model.");
            return false;
        }
    }
    function sendHello(isResume) {
        if (!userId) {
            alert("Please enter User ID before starting the model session.");
            return;
        }
        const msg = {
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
    function sendMethod(method) {
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
        const feedbackPayload = {
            choice: "NO", // 用户提供改进意见
            response: interactionText,
            satisfaction_survey: "Q1:3 Q2:3 Q3:3 Q4:3 Q5:3", // 如有需要可改为真实问卷
            mark: "NONE",
            category_ranking: [
                "timing_interruption",
                "communication_style",
                "autonomy_control",
                "context_adaptation",
                "domain_priorities",
            ],
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
        // 使用 narrator 的 Activity Description 作为 scenario_text
        const scenarioText = activityDesc && activityDesc.trim().length > 0
            ? activityDesc
            : `Persona ${currentImg.pid}, Activity ${currentImg.aid}`;
        const timeframe = "N/A"; // 如有具体时间可以替换
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
        const record = {
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
        const info = {
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
        const canPick = window.showDirectoryPicker;
        if (!canPick) {
            alert("Your browser does not support folder selection. The JSON file will be downloaded instead.");
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({
                id: "result-dir",
            });
            setResultDirHandle(handle);
            alert("Result path selected.");
        }
        catch (e) {
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
            if (!choice)
                return null;
            return {
                persona: rec.pid,
                activity: rec.aid,
                imageName: rec.name,
                choice,
            };
        })
            .filter(Boolean);
        // Phase II：用已存的 interactions
        const phaseIIArray = Object.values(phaseIIInteractions).sort((a, b) => a.persona - b.persona || a.activity - b.activity);
        const result = {
            userId,
            generatedAt: new Date().toISOString(),
            pre: preInfo,
            phaseI: phaseIArray,
            phaseII: phaseIIArray,
            post: survey,
        };
        const fileName = `${safeId}_Reflection.json`;
        if (resultDirHandle && window.showDirectoryPicker) {
            try {
                const fileHandle = await resultDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(result, null, 2));
                await writable.close();
                alert("Saved ALL to selected result folder.");
                return;
            }
            catch (e) {
                console.error("saveAll via directory handle failed:", e);
                alert("Failed to save to selected folder. The JSON file will be downloaded instead.");
            }
        }
        // fallback：直接下载
        downloadJson(fileName, result);
    }
    // --------- Splitter 拖动 ---------
    function onMouseMove(e) {
        if (!draggingRef.current)
            return;
        const container = document.querySelector(".center-split");
        if (!container)
            return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = Math.min(80, Math.max(20, (x / rect.width) * 100));
        setSplitPct(pct);
    }
    function onMouseUp() {
        if (!draggingRef.current)
            return;
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
    const PhaseBtn = ({ active, onClick, children }) => (_jsx("button", { className: "btn", onClick: onClick, style: {
            fontSize: 35,
            fontWeight: 700,
            padding: "6px 14px",
            borderRadius: 12,
            border: active ? "2px solid #60a5fa" : "1px solid #4b5563",
            background: active ? "#0b1220" : "#111827",
            color: active ? "#93c5fd" : "#e5e7eb",
        }, children: children }));
    const DarkBtn = ({ active, onClick, children }) => (_jsx("button", { onClick: onClick, className: "btn", style: {
            padding: "14px 24px",
            fontSize: 35,
            fontWeight: 800,
            color: "#e5e7eb",
            background: active ? "#0b1220" : "#111827",
            border: active ? "2px solid #60a5fa" : "1px solid #374151",
            borderRadius: 12,
        }, "aria-pressed": active, children: children }));
    // ---------- 主渲染 ----------
    return (_jsxs("div", { className: "page dark", children: [_jsx("div", { className: "toolbar card dark", style: {
                    padding: "12px 18px",
                }, children: _jsxs("div", { className: "toolbar-row", style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                    }, children: [_jsx("div", { className: "label", style: { fontSize: 35 }, children: "File" }), _jsxs("select", { className: "select dark", style: { fontSize: 35 }, value: currentImg?.name || "", onChange: (e) => onFilenameChange(e.target.value), children: [filenameOptions.length === 0 && (_jsx("option", { value: "", children: "(N/A)" })), filenameOptions.map((rec) => (_jsx("option", { value: rec.name, children: rec.name }, rec.key)))] }), _jsx("div", { className: "label", style: { fontSize: 35 }, children: "Persona" }), _jsxs("select", { className: "select dark", style: { fontSize: 35 }, value: selectedPid != null ? String(selectedPid) : "", onChange: (e) => onPersonaChange(e.target.value), children: [personaOptions.length === 0 && (_jsx("option", { value: "", children: "(N/A)" })), personaOptions.map((pid) => (_jsx("option", { value: String(pid), children: pid }, pid)))] }), _jsx("div", { className: "label", style: { fontSize: 35 }, children: "Activity" }), _jsxs("select", { className: "select dark", style: { fontSize: 35 }, value: selectedAid != null ? String(selectedAid) : "", onChange: (e) => onActivityChange(e.target.value), children: [activityOptions.length === 0 && (_jsx("option", { value: "", children: "(N/A)" })), activityOptions.map((aid) => (_jsx("option", { value: String(aid), children: aid }, aid)))] }), _jsx("div", { className: "label", style: { fontSize: 35 }, children: "User ID" }), _jsx("input", { className: "input", style: {
                                fontSize: 35,
                                padding: "4px 10px",
                                width: 180,
                            }, value: userId, onChange: (e) => setUserId(e.target.value), placeholder: "e.g. 301" }), _jsx("button", { className: "btn btn-secondary", style: { fontSize: 35 }, onClick: openUserModal, children: "User Info" }), _jsx("button", { className: "btn btn-secondary", style: { fontSize: 35 }, onClick: () => setShowSurveyModal(true), children: "Survey" }), _jsx("button", { className: "btn btn-secondary", style: { fontSize: 35 }, onClick: chooseResultPath, children: "Result Path" }), _jsx("button", { className: "btn btn-primary", style: { fontSize: 35 }, onClick: saveAll, children: "Save ALL" }), _jsx(PhaseBtn, { active: phase === "I", onClick: () => setPhase("I"), children: "Phase I" }), _jsx(PhaseBtn, { active: phase === "II", onClick: () => setPhase("II"), children: "Phase II" }), _jsx("div", { className: "spacer" }), _jsx("button", { className: "btn btn-hollow", style: { fontSize: 35 }, onClick: () => loadPhaseDir("I"), children: "Load Phase I" }), _jsx("button", { className: "btn btn-hollow", style: { fontSize: 35 }, onClick: () => loadPhaseDir("II"), children: "Load Phase II" }), _jsx("input", { ref: folderInputRef, type: "file", multiple: true, 
                            // @ts-ignore
                            webkitdirectory: "true", hidden: true, onChange: onFolderInputChange })] }) }), _jsxs("div", { className: "center-split", style: {
                    display: "grid",
                    gridTemplateColumns: `${splitPct}% 6px ${100 - splitPct}%`,
                    height: "calc(100vh - 120px)",
                    minHeight: 0,
                }, children: [_jsx("div", { className: "panel image-panel", style: {
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
                        }, children: currentImg ? (_jsx("img", { src: currentImg.url, alt: currentImg.name, style: {
                                maxWidth: "100%",
                                maxHeight: "100%",
                                objectFit: "contain",
                                display: "block",
                            } })) : (_jsx("div", { className: "placeholder", style: { fontSize: 35 }, children: "No image" })) }), _jsx("div", { className: "divider", onMouseDown: (e) => {
                            e.preventDefault();
                            draggingRef.current = true;
                            document.body.style.cursor = "col-resize";
                        }, onDoubleClick: () => setSplitPct(58), title: "Drag to resize", style: { cursor: "col-resize", background: "#94a3b8" } }), phase === "I" ? (
                    // -------------- Phase I：A/B 选择 --------------
                    _jsxs("div", { className: "panel text-panel", style: {
                            display: "grid",
                            gridTemplateRows: "5fr auto 3fr 3fr",
                            gap: 10,
                            minHeight: 0,
                        }, children: [_jsx(SectionBox, { title: "", children: _jsxs("div", { style: {
                                        display: "flex",
                                        flexDirection: "column",
                                        height: "100%",
                                        padding: "4px 8px 8px 8px",
                                    }, children: [_jsx("div", { style: {
                                                fontWeight: 900,
                                                fontSize: 35,
                                                marginBottom: 10,
                                                lineHeight: 1.2,
                                            }, children: "Based on the following activity description:" }), _jsxs("div", { style: {
                                                display: "flex",
                                                flexDirection: "column",
                                                height: "100%",
                                            }, children: [_jsxs("div", { style: {
                                                        fontWeight: 400,
                                                        fontSize: 35,
                                                        marginBottom: 6,
                                                    }, children: ["User Name: ", userNameFromNarr || "PlaceHolder"] }), _jsx("textarea", { className: "narr", readOnly: true, value: llmResponse || smartTextA, style: {
                                                        height: "100%",
                                                        width: "100%",
                                                        resize: "none",
                                                        fontSize: 35,
                                                        lineHeight: 1.5,
                                                        fontFamily: "monospace", // Better for JSON display
                                                    } })] })] }) }), _jsxs("div", { className: "card", style: {
                                    padding: 10,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                }, children: [_jsx("div", { style: { fontWeight: 900, fontSize: 35 }, children: "Which Smart Assistant interaction method do you prefer?" }), _jsx(DarkBtn, { active: variant === "A", onClick: () => setVariant("A"), children: "A" }), _jsx(DarkBtn, { active: variant === "B", onClick: () => setVariant("B"), children: "B" }), _jsx("button", { className: "btn btn-primary", style: {
                                            marginLeft: 16,
                                            fontSize: 35,
                                            fontWeight: 500,
                                            padding: "10px 24px",
                                        }, onClick: onConfirmSelection, children: "Confirm Selection" }), _jsx("button", { className: "btn btn-hollow", style: {
                                            fontSize: 35,
                                            fontWeight: 500,
                                            padding: "10px 24px",
                                        }, onClick: goNextImage, children: "Next Image" })] }), _jsx(SectionBox, { title: "A", emphasized: variant === "A", children: _jsx("textarea", { className: "narr", readOnly: true, value: smartTextA || "PlaceHolder A", style: {
                                        height: "100%",
                                        width: "100%",
                                        resize: "none",
                                        fontSize: 35,
                                        lineHeight: 1.6,
                                    } }) }), _jsx(SectionBox, { title: "B", emphasized: variant === "B", children: _jsx("textarea", { className: "narr", readOnly: true, value: smartTextA || "PlaceHolder B", style: {
                                        height: "100%",
                                        width: "100%",
                                        resize: "none",
                                        fontSize: 35,
                                        lineHeight: 1.6,
                                    } }) })] })) : (
                    // -------------- Phase II：Smart Interaction + 输入框 --------------
                    _jsxs("div", { className: "panel text-panel", style: {
                            display: "grid",
                            gridTemplateRows: "5fr 5fr",
                            gap: 10,
                            minHeight: 0,
                        }, children: [_jsx(SectionBox, { title: "", children: _jsxs("div", { style: {
                                        display: "flex",
                                        flexDirection: "column",
                                        height: "100%",
                                        padding: "4px 8px 8px 8px",
                                    }, children: [_jsx("div", { style: {
                                                fontWeight: 900,
                                                fontSize: 35,
                                                marginBottom: 10,
                                                lineHeight: 1.2,
                                            }, children: "Based on the description of interaction with smart assistant." }), _jsx("textarea", { className: "narr", readOnly: true, value: llmResponse || smartTextA, style: {
                                                height: "100%",
                                                width: "100%",
                                                resize: "none",
                                                fontSize: 35,
                                                lineHeight: 1.5,
                                                fontFamily: "monospace", // Better for JSON display
                                            } })] }) }), _jsx(SectionBox, { title: "Interaction", children: _jsxs("div", { style: {
                                        display: "flex",
                                        flexDirection: "column",
                                        height: "100%",
                                        padding: "4px 8px 8px 8px",
                                    }, children: [_jsx("textarea", { className: "narr", value: interactionText, onChange: (e) => setInteractionText(e.target.value), placeholder: "Type any interaction notes here...", style: {
                                                height: "100%",
                                                width: "100%",
                                                resize: "none",
                                                fontSize: 35,
                                                lineHeight: 1.5,
                                            } }), _jsxs("div", { style: {
                                                marginTop: 12,
                                                display: "flex",
                                                justifyContent: "flex-end",
                                                gap: 12,
                                            }, children: [_jsx("button", { className: "btn btn-secondary", style: {
                                                        fontSize: 35,
                                                        padding: "8px 24px",
                                                        opacity: isLoadingLLM ? 0.5 : 1,
                                                        cursor: isLoadingLLM ? "not-allowed" : "pointer"
                                                    }, onClick: onBackToModel, disabled: isLoadingLLM, children: isLoadingLLM ? "Loading..." : "Back to Model" }), _jsx("button", { className: "btn btn-secondary", style: {
                                                        fontSize: 35,
                                                        padding: "8px 24px",
                                                        opacity: isLoadingLLM ? 0.5 : 1,
                                                        cursor: isLoadingLLM ? "not-allowed" : "pointer"
                                                    }, onClick: onGetNew, disabled: isLoadingLLM, children: isLoadingLLM ? "Loading..." : "Get New" }), _jsx("button", { className: "btn btn-primary", style: { fontSize: 35, padding: "8px 24px" }, onClick: onSaveInteraction, children: "Save All" })] })] }) })] }))] }), _jsxs("div", { className: "statusbar", children: [_jsx("div", { className: "status-left", title: statusLeft, children: statusLeft }), _jsxs("div", { className: "status-right", title: statusRight, children: [statusRight, "\u00A0 | \u00A0 User ID: ", userId || "<empty>", "\u00A0 | \u00A0 Phase: ", phase, "\u00A0 | \u00A0 Storyboard (Phase I): ", variant] })] }), showUserModal && (_jsx("div", { style: {
                    position: "fixed",
                    inset: 0,
                    background: "rgba(15,23,42,0.8)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 50,
                }, children: _jsxs("div", { style: {
                        background: "#020617",
                        borderRadius: 16,
                        padding: 24,
                        maxWidth: 900,
                        width: "90%",
                        maxHeight: "90%",
                        overflow: "auto",
                        border: "1px solid #1f2937",
                    }, children: [_jsx("h2", { style: {
                                fontSize: 35,
                                marginBottom: 16,
                                fontWeight: 900,
                            }, children: "User Information (Pre-Study)" }), _jsxs("div", { style: {
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                            }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "User ID" }), _jsx("input", { className: "input", style: { fontSize: 35, padding: "4px 8px", width: "100%" }, value: userForm.id, onChange: (e) => setUserForm((f) => ({ ...f, id: e.target.value })) })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Age" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: userForm.age, onChange: (e) => setUserForm((f) => ({ ...f, age: e.target.value })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "18\u201324", children: "18\u201324" }), _jsx("option", { value: "25\u201334", children: "25\u201334" }), _jsx("option", { value: "35\u201344", children: "35\u201344" }), _jsx("option", { value: "45\u201354", children: "45\u201354" }), _jsx("option", { value: "55\u201360", children: "55\u201360" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Gender" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: userForm.gender, onChange: (e) => setUserForm((f) => ({ ...f, gender: e.target.value })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "Female", children: "Female" }), _jsx("option", { value: "Male", children: "Male" }), _jsx("option", { value: "Non-binary / Self-describe", children: "Non-binary / Self-describe" }), _jsx("option", { value: "Prefer not to answer", children: "Prefer not to answer" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Education Level" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: userForm.education, onChange: (e) => setUserForm((f) => ({
                                                ...f,
                                                education: e.target.value,
                                            })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "High school diploma or equivalent", children: "High school diploma or equivalent" }), _jsx("option", { value: "Some college", children: "Some college" }), _jsx("option", { value: "Bachelor\u2019s degree", children: "Bachelor\u2019s degree" }), _jsx("option", { value: "Master\u2019s degree", children: "Master\u2019s degree" }), _jsx("option", { value: "Doctoral degree", children: "Doctoral degree" }), _jsx("option", { value: "Other", children: "Other" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Occupation / Field of Work or Study" }), _jsx("input", { className: "input", style: { fontSize: 35, padding: "4px 8px", width: "100%" }, value: userForm.occupation, onChange: (e) => setUserForm((f) => ({ ...f, occupation: e.target.value })) })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Experience with Smart Assistants" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: userForm.smartAssistantExp, onChange: (e) => setUserForm((f) => ({
                                                ...f,
                                                smartAssistantExp: e.target.value,
                                            })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "None", children: "None" }), _jsx("option", { value: "Occasional user", children: "Occasional user" }), _jsx("option", { value: "Regular user", children: "Regular user" }), _jsx("option", { value: "Daily user", children: "Daily user" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Comfort with technology (1 = Not comfortable, 7 = Very comfortable)" }), _jsxs("div", { style: {
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }, children: [_jsx("input", { type: "range", min: 1, max: 7, value: userForm.techComfort, onChange: (e) => setUserForm((f) => ({
                                                        ...f,
                                                        techComfort: e.target.value,
                                                    })) }), _jsx("div", { style: { width: 40, textAlign: "center", fontSize: 35 }, children: userForm.techComfort })] })] })] }), _jsxs("div", { style: {
                                marginTop: 24,
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 12,
                            }, children: [_jsx("button", { className: "btn btn-hollow", style: { fontSize: 35, padding: "8px 24px" }, onClick: () => setShowUserModal(false), children: "Cancel" }), _jsx("button", { className: "btn btn-primary", style: { fontSize: 35, padding: "8px 24px" }, onClick: saveUserInfo, children: "Save User Info" })] })] }) })), showSurveyModal && (_jsx("div", { style: {
                    position: "fixed",
                    inset: 0,
                    background: "rgba(15,23,42,0.8)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 50,
                }, children: _jsxs("div", { style: {
                        background: "#020617",
                        borderRadius: 16,
                        padding: 24,
                        maxWidth: 900,
                        width: "90%",
                        maxHeight: "90%",
                        overflow: "auto",
                        border: "1px solid #1f2937",
                    }, children: [_jsx("h2", { style: {
                                fontSize: 35,
                                marginBottom: 16,
                                fontWeight: 900,
                            }, children: "Section 4. Post-Study Survey" }), _jsx("p", { style: { fontSize: 35, marginBottom: 16 }, children: "Please reflect on your overall experience interacting with the smart assistant." }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Over time, did the assistant\u2019s responses seem to:" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: survey.overallChange, onChange: (e) => setSurvey((s) => ({ ...s, overallChange: e.target.value })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "Strongly improved", children: "Strongly improved" }), _jsx("option", { value: "Somewhat improved", children: "Somewhat improved" }), _jsx("option", { value: "No change", children: "No change" }), _jsx("option", { value: "Somewhat worsened", children: "Somewhat worsened" }), _jsx("option", { value: "Strongly worsened", children: "Strongly worsened" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "How well did the assistant learn and adapt to your preferences?" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: survey.adaptPref, onChange: (e) => setSurvey((s) => ({ ...s, adaptPref: e.target.value })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "Very well", children: "Very well" }), _jsx("option", { value: "Somewhat well", children: "Somewhat well" }), _jsx("option", { value: "Slightly", children: "Slightly" }), _jsx("option", { value: "Not at all", children: "Not at all" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "How much did you trust the assistant\u2019s decisions and actions by the end of the study?" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: survey.trustChange, onChange: (e) => setSurvey((s) => ({ ...s, trustChange: e.target.value })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "Strongly increased", children: "Strongly increased" }), _jsx("option", { value: "Somewhat increased", children: "Somewhat increased" }), _jsx("option", { value: "No change", children: "No change" }), _jsx("option", { value: "Somewhat decreased", children: "Somewhat decreased" }), _jsx("option", { value: "Strongly decreased", children: "Strongly decreased" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "How did the assistant\u2019s learning or changes affect your comfort, satisfaction, or willingness to use it again?" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: survey.comfortChange, onChange: (e) => setSurvey((s) => ({
                                                ...s,
                                                comfortChange: e.target.value,
                                            })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "Strongly increased", children: "Strongly increased" }), _jsx("option", { value: "Somewhat increased", children: "Somewhat increased" }), _jsx("option", { value: "No change", children: "No change" }), _jsx("option", { value: "Somewhat decreased", children: "Somewhat decreased" }), _jsx("option", { value: "Strongly decreased", children: "Strongly decreased" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "Overall satisfaction with the assistant:" }), _jsxs("select", { className: "select dark", style: { fontSize: 35, width: "100%" }, value: survey.satisfaction, onChange: (e) => setSurvey((s) => ({
                                                ...s,
                                                satisfaction: e.target.value,
                                            })), children: [_jsx("option", { value: "", children: "-- select --" }), _jsx("option", { value: "Very satisfied", children: "Very satisfied" }), _jsx("option", { value: "Somewhat satisfied", children: "Somewhat satisfied" }), _jsx("option", { value: "Neutral", children: "Neutral" }), _jsx("option", { value: "Somewhat dissatisfied", children: "Somewhat dissatisfied" }), _jsx("option", { value: "Very dissatisfied", children: "Very dissatisfied" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 35, marginBottom: 4 }, children: "What features or behaviors would make a self-improving assistant more useful and trustworthy for you in daily life?" }), _jsx("textarea", { className: "narr", style: {
                                                fontSize: 35,
                                                width: "100%",
                                                minHeight: 150,
                                                resize: "vertical",
                                            }, value: survey.comments, onChange: (e) => setSurvey((s) => ({ ...s, comments: e.target.value })) })] })] }), _jsxs("div", { style: {
                                marginTop: 24,
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 12,
                            }, children: [_jsx("button", { className: "btn btn-hollow", style: { fontSize: 35, padding: "8px 24px" }, onClick: () => setShowSurveyModal(false), children: "Cancel" }), _jsx("button", { className: "btn btn-primary", style: { fontSize: 35, padding: "8px 24px" }, onClick: saveSurvey, children: "Save Survey" })] })] }) }))] }));
}
const SectionBox = ({ title, children, emphasized, }) => {
    return (_jsxs("div", { className: "card", style: {
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            height: "100%",
            borderRadius: 12,
            border: emphasized ? "2px solid #60a5fa" : "2px solid #4b5563",
            boxShadow: emphasized ? "0 0 0 1px rgba(37,99,235,0.4)" : "none",
            background: "#020617",
            overflow: "hidden",
        }, children: [title && (_jsx("div", { className: "card-header", style: {
                    fontWeight: 900,
                    fontSize: 35,
                    padding: "6px 10px",
                    borderBottom: "1px solid #1f2937",
                    color: emphasized ? "#93c5fd" : "#e5e7eb",
                }, children: title })), _jsx("div", { className: "card-body", style: { padding: 8, minHeight: 0, height: "100%" }, children: _jsx("div", { style: { display: "flex", minHeight: 0, height: "100%" }, children: _jsx("div", { style: { flex: "1 1 auto", minHeight: 0 }, children: children }) }) })] }));
};
