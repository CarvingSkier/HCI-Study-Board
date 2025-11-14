import os
import base64
from io import BytesIO
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image

load_dotenv()

#Open AI API Key
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# === 你的 Prompt 模板 ===
PROMPT_TEMPLATE = """You are a senior prompt engineer for image generation.
Given the user's idea and constraints, produce ONE polished English prompt for the GPT image model.
Requirements:
- Explicit and visual description (subject, scene, style, lighting, color, composition, camera, detail).
- Include a short "negative prompt" to avoid unwanted elements.
- Output ONLY the final prompt, no explanation.

User brief:
{brief}
Constraints:
{constraints}
"""

# === 输入：用户描述 ===
user_brief = "A cozy sci-fi reading nook set inside a transparent bubble on a cliff by the sea."
user_constraints = "Style: cinematic, volumetric lighting, golden hour; Composition: rule of thirds; Lens: 35mm; Aspect: portrait."

def generate_image_prompt(brief, constraints):
    """生成英文出图Prompt"""
    filled = PROMPT_TEMPLATE.format(brief=brief, constraints=constraints)
    response = client.responses.create(
        model="gpt-4o-mini",
        input=filled,
        temperature=0.7,
    )
    prompt_text = response.output[0].content[0].text.strip()
    return prompt_text

def generate_image(prompt, out_path="result.jpg"):
    """使用 GPT-Image-1 生成图像"""
    result = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        size="1024x1536",
        quality="auto",
        output_format="jpeg",
        output_compression=90,
    )

    b64 = result.data[0].b64_json
    img_bytes = base64.b64decode(b64)
    image = Image.open(BytesIO(img_bytes))
    image.save(out_path)
    print(f"✅ Image saved to: {out_path}")

def main():
    print("🧠 Generating prompt...")
    final_prompt = generate_image_prompt(user_brief, user_constraints)
    print("\n=== Final Prompt ===\n")
    print(final_prompt)

    print("\n🎨 Generating image...")
    generate_image(final_prompt, "output.jpg")

if __name__ == "__main__":
    main()
