import os
import json
import argparse
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

# -----------------------------
# Utility functions
# -----------------------------
def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")

def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")

def slug(s: Any) -> str:
    import re
    s = re.sub(r"[^\w\-]+", "_", str(s).strip())
    return s.strip("_") or "untitled"

def coalesce(d: Dict[str, Any], *keys, default=None):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return default

def extract_text(resp) -> str:
    """
    从 Responses API 返回结构里抽出文本。
    如果未来 SDK 结构有变化，这里可能需要更新。
    """
    if hasattr(resp, "output_text") and resp.output_text:
        return resp.output_text.strip()
    try:
        parts = []
        for item in getattr(resp, "output", []):
            for c in getattr(item, "content", []):
                t = getattr(c, "text", None)
                if t:
                    parts.append(t)
        text = "\n".join(parts).strip()
        if text:
            return text
    except Exception:
        pass
    raise RuntimeError("Unable to extract text from response; SDK return structure may have changed.")

def call_llm(client: OpenAI, model: str, sys_prompt: Optional[str], user_prompt: str, temperature: float) -> str:
    if sys_prompt:
        resp = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
    else:
        resp = client.responses.create(
            model=model,
            input=user_prompt,
            temperature=temperature,
        )
    return extract_text(resp)

def find_template_file(templates_dir: Path, keyword: str) -> Optional[Path]:
    for f in templates_dir.glob("*.txt"):
        if keyword.lower() in f.name.lower():
            return f
    return None

def safe_json_loads(text: str) -> Optional[Any]:
    text = text.strip()
    # 直接尝试整体解析
    try:
        return json.loads(text)
    except Exception:
        pass
    # 尝试截取最外层 {...}
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
    except Exception:
        pass
    return None

# -----------------------------
# Validators & repair helpers
# （现在不再关心 caption，只关注结构完整性和 assistant 规则）
# -----------------------------
def has_dialogue_exchange(panels: List[Dict]) -> bool:
    """
    松一点：检查至少有一个 panel 的 assistant_action 像是“说话”——
    含有引号、问号或感叹号等。
    """
    for p in panels:
        txt = (p.get("assistant_action") or "").strip()
        if any(ch in txt for ch in ['"', "“", "”", "?", "!"]):
            return True
    return False

def assistant_rules_ok(panels: List[Dict]) -> bool:
    # Assistant 必须出现，不能在 screen 里
    for p in panels:
        if p.get("assistant_presence") != "must_show":
            return False
        combo = (p.get("assistant_action", "") + " " + p.get("action", "")).lower()
        if "screen" in combo:
            return False
    return True

def panel_has_min_fields(p: Dict) -> bool:
    required = [
        "action",
        "composition",
        "camera",
        "key_objects",
        "narration",
        "assistant_action",
        "assistant_position",
        "assistant_scale",
        "assistant_interaction",
    ]
    return all((p.get(k) not in (None, "") for k in required))

def validate_section5(s5: Dict) -> Tuple[bool, str]:
    panels = s5.get("panels") or []
    if len(panels) < 4:
        return False, "Needs 4 panels."
    if not all(panel_has_min_fields(p) for p in panels):
        return False, "Missing required panel fields."
    if not assistant_rules_ok(panels):
        return False, "Assistant must appear, float in air, and never be inside screens."
    if not has_dialogue_exchange(panels):
        return False, "At least one panel needs an assistant dialogue line that feels like spoken text."
    return True, "ok"

def repair_section5_prompt(bad_json: Dict, template_text: str, persona_json: Dict, context_json: Dict) -> str:
    """
    如果未来你要启用“修复回路”，可以用这个函数：
    传入模型输出的 JSON，检查不满足就给模型一条带违规原因的 prompt。
    当前 main() 没有调用它，只是保留以备后续需要。
    """
    violations = []
    ok, msg = validate_section5(bad_json)
    if not ok:
        violations.append(f"- {msg}")
    else:
        return json.dumps(bad_json, ensure_ascii=False, indent=2)

    return (
        template_text
        + "\n\n---\nThe previous output violated constraints:\n"
        + "\n".join(violations)
        + "\n\nPlease regenerate a corrected JSON that strictly follows the OUTPUT SCHEMA and all rules."
        + "\n\nPersona Style to consider:\n"
        + json.dumps(persona_json, ensure_ascii=False, indent=2)
        + "\n\nContext Scenario:\n"
        + json.dumps(context_json, ensure_ascii=False, indent=2)
    )

def strip_panel_captions(sec5: dict) -> dict:
    """
    清理每个 panel 的 caption 字段：
    - 如果模型还是生成了 caption，就把这个字段直接删掉
    - Panel 里的 narration / assistant_action 等内容原样保留
    """
    panels = sec5.get("panels") or []
    for p in panels:
        if "caption" in p:
            del p["caption"]
    return sec5

# -----------------------------
# Main logic
# -----------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Prompt Factory: generate image prompts (Sections 1–5) with Persona & Activity JSON"
    )
    parser.add_argument(
        "--contexts", required=True, help="JSON file (array). Items can use flexible field names."
    )
    parser.add_argument(
        "--templates_dir", default="templates", help="Directory containing Section templates"
    )
    parser.add_argument(
        "--outdir", default="prompts", help="Output directory for generated prompts"
    )
    parser.add_argument("--model", default="gpt-4o-mini", help="Text model for Sections 4 & 5")
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument(
        "--system", default=None, help="Optional system prompt string or @path/to/file"
    )
    args = parser.parse_args()

    # API Key
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("❌ Missing OPENAI_API_KEY in .env or environment")

    client = OpenAI(api_key=api_key)

    # Templates
    templates_dir = Path(args.templates_dir)
    if not templates_dir.exists():
        raise SystemExit(f"❌ templates directory not found: {templates_dir}")

    section1_file = find_template_file(templates_dir, "DrawingStyle")
    section2_file = find_template_file(templates_dir, "PanelDesignStyle")
    section3_file = find_template_file(templates_dir, "SmartAssistantStyle")
    sec4_tmpl_file = find_template_file(templates_dir, "PersonaStyle")
    sec5_tmpl_file = find_template_file(templates_dir, "ActivityOfPanel")

    required = {
        "Section1_DrawingStyle": section1_file,
        "Section2_PanelDesignStyle": section2_file,
        "Section3_SmartAssistantStyle": section3_file,
        "Section4_PersonaStyle": sec4_tmpl_file,
        "Section5_ActivityOfPanel": sec5_tmpl_file,
    }
    missing = [k for k, v in required.items() if v is None]
    if missing:
        raise SystemExit(f"❌ Missing template files: {', '.join(missing)}")

    print("✅ Detected template files:")
    for k, v in required.items():
        print(f"  - {k}: {v.name}")

    # Read fixed JSON (Sections 1–3)
    try:
        section1_json = json.loads(read_text(section1_file))
        section2_json = json.loads(read_text(section2_file))
        section3_json = json.loads(read_text(section3_file))
        # 不再在代码里强行塞 caption 相关规则，
        # Section1/2 的“文字只能在 panel 内、不允许 bottom captions”已经直接写在模板 JSON 里。
    except Exception as e:
        raise SystemExit(
            f"❌ Section1/2/3 templates are not valid JSON, please check: {e}"
        )

    # Dynamic templates (raw prompts with placeholders)
    sec4_template = read_text(sec4_tmpl_file)
    sec5_template = read_text(sec5_tmpl_file)

    # Optional system instruction
    sys_prompt: Optional[str] = None
    if args.system:
        if args.system.startswith("@"):
            sys_prompt = read_text(Path(args.system[1:]))
        else:
            sys_prompt = args.system

    # Contexts
    ctx_path = Path(args.contexts)
    if not ctx_path.exists():
        raise SystemExit(f"❌ contexts file not found: {ctx_path}")
    try:
        items = json.loads(read_text(ctx_path))
    except Exception as e:
        raise SystemExit(f"❌ Failed to parse contexts JSON: {e}")
    if not isinstance(items, list):
        raise SystemExit("❌ contexts JSON top level must be an array ([...])")

    outdir = Path(args.outdir)
    ensure_dir(outdir)

    manifest = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "model": args.model,
        "temperature": args.temperature,
        "count": 0,
        "items": [],
    }

    for it in items:
        pid_val = coalesce(
            it,
            "persona_id",
            "personaId",
            "personaID",
            "persona_index",
            "id",
        )
        cid_val = coalesce(
            it, "context_id", "contextId", "contextID", "cid"
        )
        if pid_val is None or cid_val is None:
            print(
                f"⏭️  Skip non-persona item (missing persona_id/context_id): {it.get('id', '<no-id>')}"
            )
            continue

        pid = slug(pid_val)
        cid = slug(cid_val)

        # persona_desc normalize
        pdesc = it.get("persona_desc")
        if isinstance(pdesc, str):
            persona_desc_obj = {"raw": pdesc}
        elif isinstance(pdesc, dict):
            persona_desc_obj = pdesc
        else:
            pdesc = coalesce(it, "persona", "personaDescription", "persona_profile")
            if isinstance(pdesc, str):
                persona_desc_obj = {"raw": pdesc}
            elif isinstance(pdesc, dict):
                persona_desc_obj = pdesc
            else:
                raise SystemExit(f"❌ persona_desc must be string or object: {it}")
        persona_desc_json = json.dumps(
            persona_desc_obj, ensure_ascii=False, indent=2
        )

        # context_scenario normalize
        csc = it.get("context_scenario")
        if not isinstance(csc, dict):
            csc = {
                "activity": coalesce(it, "activity", "task", default=""),
                "expanded_activity": coalesce(
                    it, "expanded_activity", "steps", default=""
                ),
                "time": coalesce(
                    it,
                    "time",
                    "start_timestamp",
                    "end_timestamp",
                    default="",
                ),
            }
        activity_json = json.dumps(csc, ensure_ascii=False, indent=2)

        # ---------- Generate Section 4 ----------
        sec4_user_prompt = sec4_template.replace(
            "{persona_desc}", persona_desc_json
        )
        try:
            sec4_out = call_llm(
                client,
                args.model,
                sys_prompt,
                sec4_user_prompt,
                temperature=min(args.temperature, 0.75),
            ).strip()
        except Exception as e:
            raise SystemExit(
                f"❌ LLM call failed for Section 4 ({pid}/{cid}): {e}"
            )

        sec4_json = safe_json_loads(sec4_out) or {"raw": sec4_out}

        # ---------- Generate Section 5 (optionally conditioned on Section 4) ----------
        # 你当前的 Section 5 模板如果不包含 {persona_style} 占位符，
        # 这行 replace 也不会产生副作用，只是多给一点上下文。
        sec5_user_prompt = (
            sec5_template.replace("{activity}", activity_json).replace(
                "{persona_style}",
                json.dumps(sec4_json, ensure_ascii=False, indent=2),
            )
        )
        try:
            sec5_out = call_llm(
                client,
                args.model,
                sys_prompt,
                sec5_user_prompt,
                temperature=min(args.temperature, 0.65),
            ).strip()
        except Exception as e:
            raise SystemExit(
                f"❌ LLM call failed for Section 5 ({pid}/{cid}): {e}"
            )

        sec5_json = safe_json_loads(sec5_out)
        if isinstance(sec5_json, dict):
            # 安全清除 caption 字段，避免画 panel 底字幕
            sec5_json = strip_panel_captions(sec5_json)
        else:
            sec5_json = {"raw": sec5_out}

        # Combine
        full_prompt = {
            "section_1_drawing_style": section1_json,
            "section_2_panel_design_style": section2_json,
            "section_3_smart_assistant_style": section3_json,
            "section_4_persona_style": sec4_json,
            "section_5_activity_of_the_panel": sec5_json,
        }

        out_file = outdir / f"Persona_{pid}_Activity_{cid}.txt"
        write_text(
            out_file, json.dumps(full_prompt, ensure_ascii=False, indent=2)
        )
        print(f"✅ Saved: {out_file}")

        manifest["items"].append(
            {"file": str(out_file), "persona_id": pid, "context_id": cid}
        )
        manifest["count"] += 1

    write_text(
        outdir / "manifest.json",
        json.dumps(manifest, ensure_ascii=False, indent=2),
    )
    print(f"🗂 Manifest written: {outdir/'manifest.json'}")


if __name__ == "__main__":
    main()
