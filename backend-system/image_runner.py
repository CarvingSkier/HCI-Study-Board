# image_runner.py — Generate ONE 2×2 image per Prompt, skip existing JPGs

import os, json, argparse, base64
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI


# -----------------------------------------
# Helpers
# -----------------------------------------
def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def load_json(p: Path) -> dict:
    return json.loads(read_text(p))


# -----------------------------------------
# Build final prompt for image generation
# -----------------------------------------
def build_combined_prompt(full_prompt: dict) -> str:
    s1 = full_prompt.get("section_1_drawing_style", {})
    s2 = full_prompt.get("section_2_panel_design_style", {})
    s3 = full_prompt.get("section_3_smart_assistant_style", {})
    s4 = full_prompt.get("section_4_persona_style", {})
    s5 = full_prompt.get("section_5_activity_of_the_panel", {}) or {}

    panels = (s5.get("panels") or [])[:4]

    # Global prompt
    out = []
    out.append("Render a single clean 2x2 comic grid (equal-size panels, thin gutters).")
    out.append("NO bottom captions, NO subtitles, NO text outside panels.")
    out.append("All visible text must appear ONLY inside speech bubbles.")
    out.append("Do NOT draw narration text, labels, or floating descriptions inside backgrounds.")
    out.append("Avoid background posters, signs, UI screens with readable text.")

    # Visual style (Section 1)
    out.append("Drawing style: " + s1.get("style_summary",""))
    out.append("Color palette: " + s1.get("color_palette",""))
    out.append("Lighting: " + s1.get("lighting",""))
    out.append("Line quality: " + s1.get("line_quality",""))

    # Persona summary
    out.append("Persona tone: " + (s4.get("summary","") or ""))

    # Smart Assistant (Section 3 强化版)
    out.append(
        "Smart assistant: exactly ONE per panel. "
        "A small floating blue orb with a VERY CLEAR emoji face: "
        "two solid dark round eyes + one curved smiling mouth. "
        "Face must be crisp, high-contrast, not blurred, not washed out by glow."
    )
    out.append(
        "The assistant must float beside the user, never inside screens. "
        "Glow must NOT obscure facial features."
    )

    # Avoid multiple assistants
    out.append("Never draw multiple assistant orbs in one panel.")

    # Negative cues (merge)
    neg = []
    neg.extend(s5.get("negative_cues") or [])
    neg.extend(s2.get("negative_cues") or [])
    neg.extend([
        "assistant inside screen",
        "multiple assistants",
        "blurred emoji face",
        "glow hiding facial features",
        "background text",
        "bottom subtitles",
        "floating narration text",
    ])
    out.append("Avoid: " + ", ".join(dict.fromkeys(neg)) + ".")

    # Panel-by-panel details
    grid_order = [
        "Top-left panel (Panel 1)",
        "Top-right panel (Panel 2)",
        "Bottom-left panel (Panel 3)",
        "Bottom-right panel (Panel 4)",
    ]

    for i, panel in enumerate(panels):
        slot = grid_order[i]
        act = panel.get("action","")
        cmpo = panel.get("composition","")
        cam = panel.get("camera","")
        objs = ", ".join(panel.get("key_objects",[])[:6])
        orb_pos = panel.get("assistant_position","near user")
        orb_scale = panel.get("assistant_scale","small")
        orb_int = panel.get("assistant_interaction","ambient")

        # Speech
        texts = []
        aa = (panel.get("assistant_action") or "").strip()
        if aa:
            texts.append(f'Assistant says (bubble): "{aa}"')

        ud = (panel.get("user_dialogue") or "").strip()
        if ud:
            texts.append(f'User says (bubble): "{ud}"')

        # Start writing
        out.append(
            f"{slot}: action={act}; composition={cmpo}; camera={cam}; "
            f"key objects={objs}. Draw the assistant orb at {orb_pos}, scale={orb_scale}, interaction={orb_int}."
        )

        # Narration removed (你不再允许 narration)
        # Caption removed (你不再允许 bottom captions)

        if texts:
            out.append("Dialogue inside speech bubbles: " + " ".join(texts))

    return " ".join(out)


# -----------------------------------------
# Call OpenAI image generation
# -----------------------------------------
def call_image(client: OpenAI, prompt: str, size: str, quality: str) -> bytes:
    res = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        size=size,
        quality=quality,
    )
    b64 = res.data[0].b64_json
    return base64.b64decode(b64)


# -----------------------------------------
# Main
# -----------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Generate 2x2 images per Prompt (skip existing JPGs).")
    parser.add_argument("--prompts_dir", default="prompts")
    parser.add_argument("--out_dir", default="images")
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--quality", default="high")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing JPGs")
    args = parser.parse_args()

    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("❌ Missing OPENAI_API_KEY in .env")
    client = OpenAI(api_key=api_key)

    prompts_dir = Path(args.prompts_dir)
    out_dir = Path(args.out_dir)
    ensure_dir(out_dir)

    files = sorted(prompts_dir.glob("Persona_*_Activity_*.txt"))
    if args.limit:
        files = files[:args.limit]
    if not files:
        raise SystemExit("❌ No prompt files found")

    for pf in files:
        out_path = out_dir / (pf.stem + ".jpg")

        # ⭐ 跳过已经生成的文件（除非 --overwrite）
        if out_path.exists() and not args.overwrite:
            print(f"⏭️ Skip existing image: {out_path.name}")
            continue

        print(f"🎨 Generating for {pf.name} ...")
        data = load_json(pf)
        prompt = build_combined_prompt(data)
        img_bytes = call_image(client, prompt, size=args.size, quality=args.quality)

        with open(out_path, "wb") as f:
            f.write(img_bytes)

        print(f"✅ Saved: {out_path}")

    print("\n🎉 All done.")


if __name__ == "__main__":
    main()
