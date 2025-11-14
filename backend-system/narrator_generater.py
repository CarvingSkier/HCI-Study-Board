"""
narrator_generater.py — Simple JSON Narrator Generator (No Smart Assistant summary)

Reads:
    prompts/Persona_*_Activity_*.txt   (each file is a JSON with persona_desc, context_scenario, assistant_feedback, etc.)

Writes:
    Narrator/Persona_*_Activity_*_Description.txt

Each output file is a JSON with the structure:
{
  "User Name": "<string>",
  "Activity Description": "<string>",
  "Smart Assistant Interaction": "PlaceHolderA"
}

行为约定：
- 默认情况下：只为“还没有 _Description.txt 的 Prompt”生成文件；
- 已经存在的 *_Description.txt 会被跳过（除非显式加 --overwrite）。
"""

import os
import json
import argparse
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from openai import OpenAI


# -----------------------------
# Basic FS helpers
# -----------------------------
def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def write_text(p: Path, text: str) -> None:
    p.write_text(text, encoding="utf-8")


def load_json(p: Path) -> Dict[str, Any]:
    try:
        return json.loads(read_text(p))
    except Exception as e:
        raise RuntimeError(f"Failed to parse JSON in {p}: {e}")


# -----------------------------
# OpenAI helpers
# -----------------------------
def extract_text(resp) -> str:
    """
    尝试从 OpenAI SDK 返回对象中提取纯文本。
    兼容 Responses API 和 Chat Completions。
    """
    # 1) Responses API: output_text
    try:
        if hasattr(resp, "output_text") and resp.output_text:
            return resp.output_text.strip()
    except Exception:
        pass

    # 2) Responses API: 遍历 output -> content -> text
    try:
        parts = []
        for item in getattr(resp, "output", []) or []:
            for c in getattr(item, "content", []) or []:
                t = getattr(c, "text", None)
                if t:
                    parts.append(t)
        text = "\n".join(parts).strip()
        if text:
            return text
    except Exception:
        pass

    # 3) Chat Completions
    try:
        choices = getattr(resp, "choices", None)
        if choices and len(choices) > 0:
            msg = choices[0].message
            if msg and getattr(msg, "content", ""):
                return msg.content.strip()
    except Exception:
        pass

    snippet = repr(resp)
    if len(snippet) > 800:
        snippet = snippet[:800] + "... <truncated>"
    raise RuntimeError(
        "Unable to extract text from response; unexpected SDK structure or empty result.\n"
        f"Raw resp: {snippet}"
    )


def call_llm(client: OpenAI, model: str, sys_prompt: Optional[str], user_prompt: str, temperature: float) -> str:
    """
    优先使用 Responses API，失败则回退到 Chat Completions。
    返回纯文本。
    """
    # Try Responses API
    try:
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
        try:
            return extract_text(resp)
        except Exception as inner_e:
            print(f"⚠️ Responses API returned unusable payload, falling back to chat.completions: {inner_e}")
    except Exception as e:
        print(f"⚠️ Responses API call failed, falling back to chat.completions: {e}")

    # Fallback: Chat Completions
    messages = [{"role": "user", "content": user_prompt}]
    if sys_prompt:
        messages.insert(0, {"role": "system", "content": sys_prompt})

    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    return extract_text(resp)


def parse_json_from_model_output(text: str) -> Dict[str, Any]:
    """
    模型必须输出 JSON，但为了防御：
    - 去掉 ```json ... ``` 或 ``` 包裹
    - 再做 json.loads
    """
    s = text.strip()

    # 去掉代码块
    if s.startswith("```"):
        # 可能是 ```json ... ```
        lines = s.splitlines()
        if len(lines) >= 2 and lines[0].startswith("```"):
            # 找到最后一个 ``` 的行号
            end_idx = None
            for i in range(len(lines) - 1, -1, -1):
                if lines[i].strip().startswith("```"):
                    end_idx = i
                    break
            if end_idx is not None and end_idx > 0:
                s = "\n".join(lines[1:end_idx]).strip()

    try:
        return json.loads(s)
    except Exception as e:
        raise RuntimeError(f"Failed to parse model output as JSON.\nOutput was:\n{s}\nError: {e}")


# -----------------------------
# Prompt builder
# -----------------------------
def build_user_prompt_for_narrator(full_data: Dict[str, Any]) -> str:
    """
    构造 user prompt：
    - 输入：整个 JSON（包含 persona_desc, context_scenario, assistant_feedback 等）
    - 输出：只需要两个字段：
        "User Name"
        "Activity Description"
    之后 Python 再补上 "Smart Assistant Interaction": "PlaceHolderA"
    """
    full_json_block = json.dumps(full_data, ensure_ascii=False, indent=2)

    return f"""You are given a full JSON object describing a persona and a specific scenario.

[FULL_JSON]
{full_json_block}

Your task is to produce a VERY COMPACT JSON summary with EXACTLY TWO fields:

1) "User Name"
   - Infer the preferred name or nickname of the person from the persona description.
   - Look for how they are referred to (e.g., "Wes" instead of "Wilfredo").
   - Use 1–2 words only.
   - Do not add any extra explanation.

2) "Activity Description"
   - Write 1–3 sentences in English.
   - Summarize what the person is doing in this scenario, based on the context_scenario
     (activity, expanded_activity, reasoning, time, and setting), and overall context.
   - Focus on the concrete real-world action and situation.

IMPORTANT:
- Ignore any requirement to summarize the smart assistant.
- Do NOT include anything about how the assistant behaves.

RESPONSE FORMAT (IMPORTANT):
- Return ONLY a single valid JSON object.
- Do NOT include any comments, explanations, or extra text.
- Keys must be exactly:
  "User Name"
  "Activity Description"

Example shape (values are just placeholders):

{{
  "User Name": "Wes",
  "Activity Description": "Short paragraph about what the user is doing in this scenario."
}}
"""


# -----------------------------
# Main
# -----------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Simple Narrator Generator: output JSON with User Name, Activity Description, Smart Assistant Interaction=PlaceHolderA."
    )
    parser.add_argument("--prompts_dir", default="prompts", help="Directory containing Persona_*_Activity_*.txt JSON files")
    parser.add_argument("--out_dir", default="Narrator", help="Output directory for *_Description.txt JSON files")
    parser.add_argument("--model", default="gpt-4o-mini", help="OpenAI model name")
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--limit", type=int, default=None, help="Optional limit on number of files to process")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output files")
    parser.add_argument("--system", default=None, help="Custom system prompt string or @path/to/file")
    args = parser.parse_args()

    # --- API client ---
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("❌ Missing OPENAI_API_KEY in .env or environment")
    client = OpenAI(api_key=api_key)

    # --- System prompt ---
    base_system_prompt = (
        "You are a careful summarizer. "
        "You must follow the output JSON schema exactly and never add extra commentary."
    )
    sys_prompt: Optional[str] = base_system_prompt
    if args.system:
        # 允许从文件读取 system prompt: 传入形式为 @path/to/file
        if args.system.startswith("@"):
            sys_prompt = read_text(Path(args.system[1:]))
        else:
            sys_prompt = args.system

    # --- IO paths ---
    prompts_dir = Path(args.prompts_dir)
    out_dir = Path(args.out_dir)
    ensure_dir(out_dir)

    files = sorted(prompts_dir.glob("Persona_*_Activity_*.txt"))
    if args.limit:
        files = files[: args.limit]
    if not files:
        raise SystemExit(f"❌ No prompt files found under {prompts_dir}/Persona_*_Activity_*.txt")

    processed = 0
    for pf in files:
        try:
            base_stem = pf.stem  # e.g. Persona_1_Activity_35
            out_path = out_dir / f"{base_stem}_Description.txt"  # 与旧命名保持一致

            # 关键逻辑：默认不覆盖，只补缺失文件
            if out_path.exists() and not args.overwrite:
                print(f"⏭️  Skip (exists): {out_path.name}")
                continue

            print(f"📝 Processing {pf.name}")
            data = load_json(pf)

            user_prompt = build_user_prompt_for_narrator(data)

            # 调用一次 LLM，返回文本，再 parse 为 JSON
            try:
                raw_output = call_llm(
                    client=client,
                    model=args.model,
                    sys_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    temperature=args.temperature,
                )
            except Exception as e:
                print(f"⚠️  LLM call failed for {pf.name}: {e}")
                continue

            try:
                partial_obj = parse_json_from_model_output(raw_output)
            except Exception as e:
                print(f"⚠️  Failed to parse JSON for {pf.name}: {e}")
                continue

            # 取出名称与活动描述，稍微防御一下 key 大小写或下划线
            user_name = (
                partial_obj.get("User Name")
                or partial_obj.get("user_name")
                or partial_obj.get("name")
                or ""
            )
            activity_desc = (
                partial_obj.get("Activity Description")
                or partial_obj.get("activity_description")
                or partial_obj.get("Activity")
                or ""
            )

            narrator_obj = {
                "User Name": user_name,
                "Activity Description": activity_desc,
                "Smart Assistant Interaction": "PlaceHolderA",
            }

            json_text = json.dumps(narrator_obj, ensure_ascii=False, indent=2)
            write_text(out_path, json_text)
            print(f"✅ Saved: {out_path.name}")
            processed += 1

        except Exception as e:
            print(f"❌ Error: {pf.name}: {e}")

    print(f"\n🎉 Done. Generated {processed} file(s) into: {out_dir}")


if __name__ == "__main__":
    main()
