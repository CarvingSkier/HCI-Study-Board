import json
import random
from pathlib import Path

# === 参数 ===
SOURCE_PATH = Path("data/persona_reflections.json")
OUTPUT_PATH = Path("data/contexts.json")
PERSONA_ID = 1           # 固定 persona_id
SAMPLE_SIZE = 48         # 随机选取的 context 数量

# === 读取主数据集 ===
with open(SOURCE_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

# === 筛选指定 persona_id 的所有条目 ===
persona_data = [item for item in data if item.get("persona_id") == PERSONA_ID]

if not persona_data:
    raise ValueError(f"No entries found for persona_id={PERSONA_ID}")

# === 如果总数不足 48，就全部保留 ===
if len(persona_data) <= SAMPLE_SIZE:
    sampled_data = persona_data
else:
    sampled_data = random.sample(persona_data, SAMPLE_SIZE)

# === 输出结果到 data/contexts.json ===
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(sampled_data, f, ensure_ascii=False, indent=2)

print(f"✅ 已生成 {len(sampled_data)} 条样本到 {OUTPUT_PATH}")
