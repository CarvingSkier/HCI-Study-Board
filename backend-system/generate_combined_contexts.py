import json
import random
from pathlib import Path

# ==== 输入文件路径（你要求的新的 persona 文件） ====
PERSONA_FILE = Path("/Users/joeyyan/PyHCI/data/persona_reflections.json")

# ==== 场景描述文件 ====
CONTEXT_FILE = Path("/Users/joeyyan/PyHCI/data/context_seen+unseen.json")

# ==== 输出文件路径（保持你原来的文件名） ====
OUT_FILE = Path("/Users/joeyyan/PyHCI/data/combined_contexts_100.json")


def main():
    # 1. 读取 Persona JSON
    with PERSONA_FILE.open("r", encoding="utf-8") as f:
        personas = json.load(f)

    # 至少需要 6 个
    if len(personas) < 6:
        raise ValueError(f"需要至少 6 个 persona，但目前只有 {len(personas)} 个")

    # 2. 从 personas 随机挑选 6 个不同的人物
    selected_personas = random.sample(personas, 6)

    # 3. 读取 Context 场景 JSON
    with CONTEXT_FILE.open("r", encoding="utf-8") as f:
        contexts = json.load(f)

    results = []
    context_id_counter = 100  # context_id: 100 → 199

    for ctx in contexts:
        # 从 6 个随机挑一个 persona
        persona = random.choice(selected_personas)

        # 构建新的 JSON 条目
        new_item = {
            "persona_id": persona["persona_id"],   # 保留原 persona_id
            "context_id": context_id_counter,       # 递增 context_id
            "persona_index": persona.get("persona_index", persona["persona_id"]),
            "persona_desc": persona["persona_desc"],

            # context_scenario 完全替换
            "context_scenario": {
                "start_timestamp": ctx["start_timestamp"],
                "activity": ctx["activity"],
                "expanded_activity": ctx["expanded_activity"],
                "end_timestamp": ctx["end_timestamp"],
                "reasoning": ctx["reasoning"],
                "seed_category": ctx["seed_category"],
            }

            # 不包含 assistant_feedback 或 user_reflection
        }

        results.append(new_item)
        context_id_counter += 1

    # 写入输出文件
    with OUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"✔ 成功随机挑选 6 个 persona，并与场景组合生成 {len(results)} 条记录 → {OUT_FILE}")


if __name__ == "__main__":
    main()
