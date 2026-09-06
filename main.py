from __future__ import annotations

import json
import mimetypes
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from passlib.context import CryptContext
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "gapino.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

SESSION_SECRET = os.getenv("GAPINO_SESSION_SECRET", "change-this-gapino-secret-before-production")
MAX_UPLOAD_SIZE = 10 * 1024 * 1024
MAX_AVATAR_SIZE = 5 * 1024 * 1024
WS_TICKET_TTL = 10 * 60

app = FastAPI(title="GAPINO Pro", version="1.0.0", description="GAPINO Messenger API")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, session_cookie="gapino_session", same_site="lax", https_only=False)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
connections: dict[int, set[WebSocket]] = {}
ws_tickets: dict[str, dict[str, Any]] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            display_name TEXT NOT NULL,
            bio TEXT DEFAULT '',
            avatar TEXT DEFAULT '',
            status TEXT DEFAULT 'در دسترس',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER,
            group_id INTEGER,
            text TEXT DEFAULT '',
            file_name TEXT DEFAULT '',
            file_url TEXT DEFAULT '',
            mime_type TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            edited INTEGER DEFAULT 0,
            deleted INTEGER DEFAULT 0,
            FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY(group_id, user_id),
            FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS reactions (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY(message_id, user_id, emoji),
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()
    conn.close()


init_db()


def user_by_id(user_id: int) -> dict[str, Any] | None:
    conn = db()
    row = conn.execute(
        "SELECT id, username, display_name, bio, avatar, status, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "bio": user.get("bio", ""),
        "avatar": user.get("avatar", ""),
        "status": user.get("status", "در دسترس"),
        "created_at": user.get("created_at", ""),
    }


def current_user(request: Request) -> dict[str, Any] | None:
    uid = request.session.get("uid")
    if uid is None:
        return None
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return None
    return user_by_id(uid)


def require_user(request: Request) -> dict[str, Any]:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="نیاز به ورود دارید")
    return user


def cleanup_tickets() -> None:
    current = time.time()
    for ticket in list(ws_tickets):
        if float(ws_tickets[ticket].get("expires", 0)) <= current:
            ws_tickets.pop(ticket, None)


def make_ws_ticket(user_id: int) -> str:
    cleanup_tickets()
    ticket = secrets.token_urlsafe(32)
    ws_tickets[ticket] = {"uid": int(user_id), "expires": time.time() + WS_TICKET_TTL}
    return ticket


def consume_ws_ticket(ticket: str) -> int | None:
    cleanup_tickets()
    info = ws_tickets.pop(ticket, None)
    if not info or float(info.get("expires", 0)) <= time.time():
        return None
    try:
        return int(info["uid"])
    except (KeyError, TypeError, ValueError):
        return None


def set_ws_cookie(user_id: int, response: JSONResponse) -> None:
    ticket = make_ws_ticket(user_id)
    response.set_cookie(
        "gapino_ws_ticket",
        ticket,
        max_age=WS_TICKET_TTL,
        httponly=True,
        samesite="lax",
        secure=False,
    )


async def broadcast(user_id: int, payload: dict[str, Any]) -> None:
    sockets = connections.get(int(user_id), set())
    if not sockets:
        return
    text = json.dumps(payload, ensure_ascii=False)
    dead: list[WebSocket] = []
    for websocket in list(sockets):
        try:
            await websocket.send_text(text)
        except Exception:
            dead.append(websocket)
    for websocket in dead:
        sockets.discard(websocket)
    if not sockets:
        connections.pop(int(user_id), None)


@app.get("/", response_class=HTMLResponse)
def root(request: Request):
    filename = "chat.html" if current_user(request) else "login.html"
    path = FRONTEND_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"{filename} پیدا نشد")
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.get("/login.html", response_class=HTMLResponse)
def login_page():
    path = FRONTEND_DIR / "login.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="login.html پیدا نشد")
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.get("/chat.html", response_class=HTMLResponse)
def chat_page():
    path = FRONTEND_DIR / "chat.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="chat.html پیدا نشد")
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.get("/profile.html", response_class=HTMLResponse)
def profile_page():
    path = FRONTEND_DIR / "profile.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="profile.html پیدا نشد")
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.get("/health")
def health():
    return {
        "ok": True,
        "app": "GAPINO Pro",
        "version": "1.0.0",
        "time": now(),
        "database": DB_PATH.exists(),
        "frontend": FRONTEND_DIR.exists(),
    }


@app.post("/api/register")
def register(request: Request, username: str = Form(...), password: str = Form(...), display_name: str = Form(...)):
    username = username.strip().lower()
    display_name = display_name.strip() or username
    if len(username) < 3 or len(username) > 32:
        raise HTTPException(status_code=400, detail="نام کاربری باید بین ۳ تا ۳۲ کاراکتر باشد")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="رمز عبور حداقل ۶ کاراکتر باشد")
    if len(display_name) > 60:
        raise HTTPException(status_code=400, detail="نام نمایشی خیلی طولانی است")
    conn = db()
    try:
        cursor = conn.execute(
            "INSERT INTO users(username, password, display_name, created_at) VALUES(?,?,?,?)",
            (username, pwd.hash(password), display_name, now()),
        )
        conn.commit()
        user_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="این نام کاربری قبلاً ثبت شده است")
    finally:
        conn.close()
    request.session.clear()
    request.session["uid"] = user_id
    user = user_by_id(user_id)
    return {"ok": True, "user": public_user(user)}


@app.post("/api/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower()
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور نادرست است")
    try:
        valid = pwd.verify(password, row["password"])
    except Exception:
        valid = False
    if not valid:
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور نادرست است")
    request.session.clear()
    request.session["uid"] = int(row["id"])
    user = user_by_id(int(row["id"]))
    return {"ok": True, "user": public_user(user)}


@app.post("/api/logout")
def logout(request: Request):
    uid = request.session.get("uid")
    request.session.clear()
    if uid is not None:
        try:
            connections.pop(int(uid), None)
        except (TypeError, ValueError):
            pass
    response = JSONResponse({"ok": True})
    response.delete_cookie("gapino_session")
    response.delete_cookie("gapino_ws_ticket")
    return response


@app.get("/api/me")
def me(request: Request):
    user = require_user(request)
    response = JSONResponse(public_user(user))
    set_ws_cookie(int(user["id"]), response)
    return response


@app.put("/api/profile")
async def update_profile(request: Request):
    user = require_user(request)
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="داده پروفایل نامعتبر است")
    display_name = str(data.get("display_name", user["display_name"]) or "").strip()
    bio = str(data.get("bio", user["bio"]) or "").strip()
    status = str(data.get("status", user["status"]) or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="نام نمایشی نمی‌تواند خالی باشد")
    if len(display_name) > 60:
        raise HTTPException(status_code=400, detail="نام نمایشی خیلی طولانی است")
    if len(bio) > 250:
        raise HTTPException(status_code=400, detail="بیوگرافی حداکثر ۲۵۰ کاراکتر است")
    if len(status) > 40:
        raise HTTPException(status_code=400, detail="وضعیت خیلی طولانی است")
    conn = db()
    conn.execute(
        "UPDATE users SET display_name = ?, bio = ?, status = ? WHERE id = ?",
        (display_name, bio, status, int(user["id"])),
    )
    conn.commit()
    conn.close()
    updated = user_by_id(int(user["id"]))
    return {"ok": True, "user": public_user(updated)}


@app.post("/api/profile/avatar")
async def update_avatar(request: Request, file: UploadFile = File(...)):
    user = require_user(request)
    extension = Path(file.filename or "").suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp"}
    if extension not in allowed:
        raise HTTPException(status_code=400, detail="فقط PNG، JPG، JPEG و WEBP مجاز است")
    content = await file.read()
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=413, detail="حجم عکس نباید بیشتر از ۵ مگابایت باشد")
    filename = f"{user['id']}_{secrets.token_hex(8)}{extension}"
    path = UPLOADS_DIR / filename
    path.write_bytes(content)
    avatar_url = f"/uploads/{filename}"
    conn = db()
    conn.execute("UPDATE users SET avatar = ? WHERE id = ?", (avatar_url, int(user["id"])))
    conn.commit()
    conn.close()
    return {"ok": True, "avatar": avatar_url}


@app.get("/api/users")
def users(request: Request):
    user = require_user(request)
    query = request.query_params.get("q", "").strip().lower()
    conn = db()
    if query:
        pattern = f"%{query}%"
        rows = conn.execute(
            """SELECT id, username, display_name, bio, avatar, status, created_at
               FROM users
               WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
               ORDER BY display_name COLLATE NOCASE""",
            (int(user["id"]), pattern, pattern),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, username, display_name, bio, avatar, status, created_at
               FROM users
               WHERE id != ?
               ORDER BY display_name COLLATE NOCASE""",
            (int(user["id"]),),
        ).fetchall()
    conn.close()
    online_ids = set(connections.keys())
    result = []
    for row in rows:
        item = dict(row)
        item["online"] = int(row["id"]) in online_ids
        result.append(item)
    return result


@app.get("/api/messages/{other_id}")
def get_messages(request: Request, other_id: int):
    user = require_user(request)
    if other_id == int(user["id"]):
        raise HTTPException(status_code=400, detail="گفتگو با خودتان مجاز نیست")
    if not user_by_id(other_id):
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد")
    conn = db()
    rows = conn.execute(
        """SELECT * FROM messages
           WHERE (sender_id = ? AND receiver_id = ?)
              OR (sender_id = ? AND receiver_id = ?)
           ORDER BY id ASC""",
        (int(user["id"]), other_id, other_id, int(user["id"])),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/api/messages")
async def create_message(request: Request):
    user = require_user(request)
    try:
        data = await request.json()
        receiver_id = int(data.get("receiver_id"))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="گیرنده پیام نامعتبر است")
    text = str(data.get("text", "") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="پیام خالی است")
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="پیام نمی‌تواند بیشتر از ۵۰۰۰ کاراکتر باشد")
    if receiver_id == int(user["id"]):
        raise HTTPException(status_code=400, detail="ارسال پیام به خودتان مجاز نیست")
    if not user_by_id(receiver_id):
        raise HTTPException(status_code=404, detail="کاربر گیرنده پیدا نشد")
    conn = db()
    cursor = conn.execute(
        "INSERT INTO messages(sender_id, receiver_id, text, created_at) VALUES(?,?,?,?)",
        (int(user["id"]), receiver_id, text, now()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
    conn.close()
    payload = dict(row)
    outgoing = {"type": "message", "message": payload}
    await broadcast(receiver_id, outgoing)
    return payload


@app.post("/api/messages/{message_id}/edit")
async def edit_message(request: Request, message_id: int):
    user = require_user(request)
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="داده ویرایش نامعتبر است")
    text = str(data.get("text", "") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="متن جدید نمی‌تواند خالی باشد")
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="پیام خیلی طولانی است")
    conn = db()
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="پیام پیدا نشد")
    if int(row["sender_id"]) != int(user["id"]):
        conn.close()
        raise HTTPException(status_code=403, detail="اجازه ویرایش این پیام را ندارید")
    if int(row["deleted"] or 0) == 1:
        conn.close()
        raise HTTPException(status_code=400, detail="پیام حذف شده قابل ویرایش نیست")
    conn.execute("UPDATE messages SET text = ?, edited = 1 WHERE id = ?", (text, message_id))
    conn.commit()
    updated = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    conn.close()
    payload = dict(updated)
    receiver_id = payload.get("receiver_id")
    if receiver_id is not None:
        await broadcast(int(receiver_id), {"type": "message:update", "message": payload})
    return payload


@app.delete("/api/messages/{message_id}")
async def delete_message(request: Request, message_id: int):
    user = require_user(request)
    conn = db()
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="پیام پیدا نشد")
    if int(row["sender_id"]) != int(user["id"]):
        conn.close()
        raise HTTPException(status_code=403, detail="اجازه حذف این پیام را ندارید")
    conn.execute(
        "UPDATE messages SET deleted = 1, text = '', file_name = '', file_url = '' WHERE id = ?",
        (message_id,),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    conn.close()
    payload = dict(updated)
    receiver_id = payload.get("receiver_id")
    if receiver_id is not None:
        await broadcast(int(receiver_id), {"type": "message:update", "message": payload})
    return payload


@app.post("/api/upload")
async def upload(request: Request, receiver_id: int = Form(...), file: UploadFile = File(...)):
    user = require_user(request)
    if receiver_id == int(user["id"]):
        raise HTTPException(status_code=400, detail="نمی‌توانید فایل را برای خودتان ارسال کنید")
    if not user_by_id(receiver_id):
        raise HTTPException(status_code=404, detail="کاربر گیرنده پیدا نشد")
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="حداکثر اندازه فایل ۱۰ مگابایت است")
    original_name = Path(file.filename or "file").name or "file"
    extension = Path(original_name).suffix.lower()
    allowed = {
        ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".pdf", ".txt", ".csv", ".zip", ".rar",
        ".mp3", ".wav", ".ogg", ".webm", ".mp4", ".mov",
        ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    }
    if extension and extension not in allowed:
        raise HTTPException(status_code=400, detail="فرمت این فایل مجاز نیست")
    filename = f"{secrets.token_hex(8)}_{original_name}"
    path = UPLOADS_DIR / filename
    path.write_bytes(content)
    file_url = f"/uploads/{filename}"
    mime_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    conn = db()
    cursor = conn.execute(
        """INSERT INTO messages(sender_id, receiver_id, text, file_name, file_url, mime_type, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (int(user["id"]), receiver_id, "", original_name, file_url, mime_type, now()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
    conn.close()
    payload = dict(row)
    await broadcast(receiver_id, {"type": "message", "message": payload})
    return payload


@app.post("/api/groups")
async def create_group(request: Request):
    user = require_user(request)
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="داده گروه نامعتبر است")
    name = str(data.get("name", "") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام گروه الزامی است")
    if len(name) > 80:
        raise HTTPException(status_code=400, detail="نام گروه خیلی طولانی است")
    raw_members = data.get("members", [])
    if not isinstance(raw_members, list):
        raw_members = []
    members: set[int] = set()
    for value in raw_members:
        try:
            member_id = int(value)
        except (TypeError, ValueError):
            continue
        if member_id != int(user["id"]):
            members.add(member_id)
    conn = db()
    cursor = conn.execute(
        "INSERT INTO groups(name, owner_id, created_at) VALUES(?,?,?)",
        (name, int(user["id"]), now()),
    )
    group_id = int(cursor.lastrowid)
    conn.execute(
        "INSERT OR IGNORE INTO group_members(group_id, user_id) VALUES(?,?)",
        (group_id, int(user["id"])),
    )
    for member_id in members:
        if conn.execute("SELECT id FROM users WHERE id = ?", (member_id,)).fetchone():
            conn.execute(
                "INSERT OR IGNORE INTO group_members(group_id, user_id) VALUES(?,?)",
                (group_id, member_id),
            )
    conn.commit()
    conn.close()
    return {"ok": True, "id": group_id, "name": name}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    ticket = websocket.cookies.get("gapino_ws_ticket")
    if not ticket:
        await websocket.close(code=4401, reason="Authentication required")
        return
    uid = consume_ws_ticket(ticket)
    if uid is None or not user_by_id(uid):
        await websocket.close(code=4401, reason="Invalid authentication")
        return
    connections.setdefault(uid, set()).add(websocket)
    try:
        await websocket.send_text(
            json.dumps(
                {"type": "ready", "online": list(connections.keys())},
                ensure_ascii=False,
            )
        )
        for other_uid in list(connections.keys()):
            if int(other_uid) != int(uid):
                await broadcast(other_uid, {"type": "user_online", "user_id": uid})
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(data, dict):
                continue
            message_type = str(data.get("type", "")).strip().lower()
            if message_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}, ensure_ascii=False))
                continue
            if message_type == "typing":
                try:
                    target_id = int(data.get("to"))
                except (TypeError, ValueError):
                    continue
                if target_id == int(uid) or not user_by_id(target_id):
                    continue
                await broadcast(
                    target_id,
                    {
                        "type": "typing",
                        "from": uid,
                        "value": bool(data.get("value", False)),
                    },
                )
                continue
            if message_type in {"message", "send_message"}:
                try:
                    receiver_id = int(data.get("receiver_id", data.get("to")))
                except (TypeError, ValueError):
                    continue
                text = str(data.get("text", "") or "").strip()
                if not text or len(text) > 5000:
                    continue
                if receiver_id == int(uid) or not user_by_id(receiver_id):
                    continue
                conn = db()
                cursor = conn.execute(
                    "INSERT INTO messages(sender_id, receiver_id, text, created_at) VALUES(?,?,?,?)",
                    (uid, receiver_id, text, now()),
                )
                conn.commit()
                row = conn.execute("SELECT * FROM messages WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
                conn.close()
                if row:
                    outgoing = {"type": "message", "message": dict(row)}
                    await broadcast(receiver_id, outgoing)
                    await websocket.send_text(json.dumps(outgoing, ensure_ascii=False))
                continue
            if message_type in {"online", "online_users"}:
                await websocket.send_text(
                    json.dumps(
                        {"type": "ready", "online": list(connections.keys())},
                        ensure_ascii=False,
                    )
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print("WebSocket error:", repr(exc))
    finally:
        sockets = connections.get(uid, set())
        sockets.discard(websocket)
        if not sockets:
            connections.pop(uid, None)
            for other_uid in list(connections.keys()):
                await broadcast(other_uid, {"type": "user_offline", "user_id": uid})
