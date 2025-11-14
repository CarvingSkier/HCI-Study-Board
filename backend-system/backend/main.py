import os
from typing import List, Optional

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# ================= 环境变量 & DB 配置 =================

load_dotenv()

# 优先使用 .env 里的完整 DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    USE_DSN = True
else:
    USE_DSN = False
    # 如果没有 DATABASE_URL，就用拆开的 PG* 变量（并给出合理默认值）
    PGHOST = os.getenv("PGHOST", "localhost")
    PGPORT = int(os.getenv("PGPORT", "5432"))
    PGUSER = os.getenv("PGUSER", "hci_user")          # <== 默认改成 hci_user
    PGPASSWORD = os.getenv("PGPASSWORD", "hci_pass_2024")
    PGDATABASE = os.getenv("PGDATABASE", "hci_study")

API_PORT = int(os.getenv("API_PORT", "4000"))

app = FastAPI(title="HCI Study Backend")

# 前端（Vite）默认端口 5173
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= Pydantic 模型 =================

class UserIn(BaseModel):
    age_range: Optional[str] = None
    gender: Optional[str] = None
    education_level: Optional[str] = None
    occupation: Optional[str] = None
    smart_assistant_exp: Optional[str] = None
    tech_comfort: Optional[int] = None  # 1–7


class UserOut(UserIn):
    id: int


class SelectionIn(BaseModel):
    user_id: int
    image_id: str
    selection: str  # "A" / "B"


class SelectionOut(BaseModel):
    user_id: int
    image_id: str
    selection: str


# ================= PostgreSQL 连接池 =================

@app.on_event("startup")
async def startup():
    if USE_DSN:
        # 用 DATABASE_URL 这种完整 DSN 连接
        app.state.pool = await asyncpg.create_pool(
            dsn=DATABASE_URL,
            min_size=1,
            max_size=5,
        )
        print(f"Connected to PostgreSQL via DSN: {DATABASE_URL}")
    else:
        # 用拆开的参数连接
        app.state.pool = await asyncpg.create_pool(
            host=PGHOST,
            port=PGPORT,
            user=PGUSER,
            password=PGPASSWORD,
            database=PGDATABASE,
            min_size=1,
            max_size=5,
        )
        print(f"Connected to PostgreSQL as {PGUSER}@{PGHOST}:{PGPORT}/{PGDATABASE}")


@app.on_event("shutdown")
async def shutdown():
    pool = app.state.pool
    await pool.close()
    print("PostgreSQL pool closed")


async def get_pool() -> asyncpg.pool.Pool:
    return app.state.pool


# ================= 健康检查 =================

@app.get("/api/health")
async def health_check():
    return {"ok": True}


# ================= Users APIs =================

@app.get("/api/users", response_model=List[UserOut])
async def list_users():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, age_range, gender, education_level, occupation,
                   smart_assistant_exp, tech_comfort
            FROM users
            ORDER BY id ASC
            """
        )
    return [
        UserOut(
            id=r["id"],
            age_range=r["age_range"],
            gender=r["gender"],
            education_level=r["education_level"],
            occupation=r["occupation"],
            smart_assistant_exp=r["smart_assistant_exp"],
            tech_comfort=r["tech_comfort"],
        )
        for r in rows
    ]


@app.get("/api/users/{user_id}", response_model=UserOut)
async def get_user(user_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, age_range, gender, education_level, occupation,
                   smart_assistant_exp, tech_comfort
            FROM users
            WHERE id = $1
            """,
            user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(
        id=row["id"],
        age_range=row["age_range"],
        gender=row["gender"],
        education_level=row["education_level"],
        occupation=row["occupation"],
        smart_assistant_exp=row["smart_assistant_exp"],
        tech_comfort=row["tech_comfort"],
    )


@app.post("/api/users", response_model=UserOut, status_code=201)
async def create_user(payload: UserIn):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO users
              (age_range, gender, education_level, occupation,
               smart_assistant_exp, tech_comfort)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, age_range, gender, education_level, occupation,
                      smart_assistant_exp, tech_comfort
            """,
            payload.age_range,
            payload.gender,
            payload.education_level,
            payload.occupation,
            payload.smart_assistant_exp,
            payload.tech_comfort,
        )
    return UserOut(
        id=row["id"],
        age_range=row["age_range"],
        gender=row["gender"],
        education_level=row["education_level"],
        occupation=row["occupation"],
        smart_assistant_exp=row["smart_assistant_exp"],
        tech_comfort=row["tech_comfort"],
    )


@app.put("/api/users/{user_id}", response_model=UserOut)
async def update_user(user_id: int, payload: UserIn):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE users
            SET age_range = $1,
                gender = $2,
                education_level = $3,
                occupation = $4,
                smart_assistant_exp = $5,
                tech_comfort = $6,
                updated_at = NOW()
            WHERE id = $7
            RETURNING id, age_range, gender, education_level, occupation,
                      smart_assistant_exp, tech_comfort
            """,
            payload.age_range,
            payload.gender,
            payload.education_level,
            payload.occupation,
            payload.smart_assistant_exp,
            payload.tech_comfort,
            user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(
        id=row["id"],
        age_range=row["age_range"],
        gender=row["gender"],
        education_level=row["education_level"],
        occupation=row["occupation"],
        smart_assistant_exp=row["smart_assistant_exp"],
        tech_comfort=row["tech_comfort"],
    )


# ================= Selections APIs =================

@app.get("/api/users/{user_id}/selections", response_model=List[SelectionOut])
async def list_user_selections(user_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT user_id, image_id, selection
            FROM user_selections
            WHERE user_id = $1
            ORDER BY image_id ASC
            """,
            user_id,
        )
    return [
        SelectionOut(
            user_id=r["user_id"],
            image_id=r["image_id"],
            selection=r["selection"],
        )
        for r in rows
    ]


@app.put("/api/selections", response_model=SelectionOut)
async def upsert_selection(payload: SelectionIn):
    if payload.selection not in ("A", "B"):
        raise HTTPException(status_code=400, detail="selection must be 'A' or 'B'")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO user_selections (user_id, image_id, selection)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, image_id)
            DO UPDATE SET selection = EXCLUDED.selection,
                          updated_at = NOW()
            RETURNING user_id, image_id, selection
            """,
            payload.user_id,
            payload.image_id,
            payload.selection,
        )
    return SelectionOut(
        user_id=row["user_id"],
        image_id=row["image_id"],
        selection=row["selection"],
    )
