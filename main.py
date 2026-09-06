from fastapi import (
    FastAPI,
    Request,
    Form,
    File,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
)
from fastapi.responses import (
    HTMLResponse,
    FileResponse,
    JSONResponse,
)
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3


# =========================================================
# CONFIG
# =========================================================

APP_NAME = "GAPINO Pro"
APP_VERSION = "1.0.0"

BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
FRONTEND_DIR = BASE_DIR / "frontend"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "gapino.db"

MAX_UPLOAD_SIZE = 10 * 1024 * 1024

SESSION_SECRET = os.getenv(
    "GAPINO_SESSION_SECRET",
    "GAPINO-change-this-secret-before-production",
)


# =========================================================
# FASTAPI
# =========================================================

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
)

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="gapino_session",
    same_site="lax",
    https_only=False,
)


# =========================================================
# STATIC
# =========================================================

app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static",
)

app.mount(
    "/uploads",
    StaticFiles(directory=UPLOADS_DIR),
    name="uploads",
)


# =========================================================
# RUNTIME STATE
# =========================================================

connections: dict[int, set[WebSocket]] = {}

ws_tickets: dict[str, int] = {}


# =========================================================
# DATABASE
# =========================================================

def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(
        DB_PATH,
        check_same_thread=False,
    )

    connection.row_factory = sqlite3.Row

    return connection


def init_database() -> None:
    connection = get_db()

    connection.executescript(
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
            deleted INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (group_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS reactions (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id, emoji)
        );
        """
    )

    connection.commit()
    connection.close()


init_database()


# =========================================================
# TIME
# =========================================================

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# =========================================================
# PASSWORD
# =========================================================

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        210_000,
    )

    return (
        "$pbkdf2$"
        + salt.hex()
        + "$"
        + digest.hex()
    )


def verify_password(
    password: str,
    stored_password: str,
) -> bool:

    if not stored_password:
        return False

    if not stored_password.startswith("$pbkdf2$"):
        return False

    try:
        parts = stored_password.split("$")

        if len(parts) != 4:
            return False

        salt_hex = parts[2]
        digest_hex = parts[3]

        salt = bytes.fromhex(salt_hex)

        calculated = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            210_000,
        )

        return hmac.compare_digest(
            calculated.hex(),
            digest_hex,
        )

    except Exception:
        return False


# =========================================================
# USERS
# =========================================================

PUBLIC_FIELDS = (
    "id",
    "username",
    "display_name",
    "bio",
    "avatar",
    "status",
)


def public_user(user: dict) -> dict:
    return {
        key: user.get(key)
        for key in PUBLIC_FIELDS
    }


def get_session_user(request: Request) -> Optional[dict]:

    raw_user_id = request.session.get("uid")

    if raw_user_id is None:
        return None

    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        return None

    connection = get_db()

    row = connection.execute(
        """
        SELECT
            id,
            username,
            display_name,
            bio,
            avatar,
            status,
            created_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()

    connection.close()

    if row is None:
        return None

    return dict(row)


def require_user(request: Request) -> dict:
    user = get_session_user(request)

    if not user:
        raise HTTPException(
            status_code=401,
            detail="نیاز به ورود دارید.",
        )

    return user


# =========================================================
# WEBSOCKET TICKET
# =========================================================

def create_ws_ticket(user_id: int) -> str:
    ticket = secrets.token_urlsafe(32)
    ws_tickets[ticket] = int(user_id)
    return ticket


def cleanup_ws_tickets() -> None:
    if len(ws_tickets) > 5000:
        ws_tickets.clear()


def get_user_id_from_ticket(ticket: str) -> Optional[int]:
    if not ticket:
        return None

    value = ws_tickets.get(ticket)

    if value is None:
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# =========================================================
# FILE HELPERS
# =========================================================

ALLOWED_IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
}

ALLOWED_AUDIO_EXTENSIONS = {
    ".webm",
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
}

ALLOWED_FILE_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".zip",
    ".rar",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
}


def safe_filename(filename: str) -> str:
    return Path(filename).name or "file"


def is_allowed_upload(filename: str) -> bool:
    extension = Path(filename).suffix.lower()

    return (
        extension in ALLOWED_IMAGE_EXTENSIONS
        or extension in ALLOWED_AUDIO_EXTENSIONS
        or extension in ALLOWED_FILE_EXTENSIONS
    )


# =========================================================
# WEB PAGES
# =========================================================

@app.get(
    "/",
    response_class=HTMLResponse,
)
def root(request: Request):

    user = get_session_user(request)

    if user:

        chat_path = FRONTEND_DIR / "chat.html"

        if chat_path.exists():
            return FileResponse(
                chat_path,
                media_type="text/html",
            )

    index_path = FRONTEND_DIR / "index.html"

    if index_path.exists():
        return FileResponse(
            index_path,
            media_type="text/html",
        )

    login_path = FRONTEND_DIR / "login.html"

    if login_path.exists():
        return FileResponse(
            login_path,
            media_type="text/html",
        )

    return HTMLResponse(
        "<h1>GAPINO Pro</h1>",
        status_code=200,
    )


@app.get(
    "/index.html",
    response_class=HTMLResponse,
)
def index_page():

    path = FRONTEND_DIR / "index.html"

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="index.html پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/html",
    )


@app.get(
    "/login.html",
    response_class=HTMLResponse,
)
def login_page():

    path = FRONTEND_DIR / "login.html"

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="login.html پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/html",
    )


@app.get(
    "/chat.html",
    response_class=HTMLResponse,
)
def chat_page(request: Request):

    require_user(request)

    path = FRONTEND_DIR / "chat.html"

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="chat.html پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/html",
    )


@app.get(
    "/profile.html",
    response_class=HTMLResponse,
)
def profile_page(request: Request):

    require_user(request)

    path = FRONTEND_DIR / "profile.html"

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="profile.html پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/html",
    )


# =========================================================
# ROBOTS
# =========================================================

@app.get(
    "/robots.txt",
    response_class=HTMLResponse,
)
def robots_txt():

    content = (
        "User-agent: *\n"
        "Allow: /\n"
        "\n"
        "Sitemap: https://mygapino.shop/sitemap.xml\n"
    )

    return HTMLResponse(
        content=content,
        media_type="text/plain",
    )


# =========================================================
# SITEMAP
# =========================================================

@app.get(
    "/sitemap.xml",
    response_class=HTMLResponse,
)
def sitemap_xml():

    content = """<?xml version="1.0" encoding="UTF-8"?>
<urlset
    xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
>
    <url>
        <loc>https://mygapino.shop/</loc>
    </url>

    <url>
        <loc>https://mygapino.shop/login.html</loc>
    </url>
</urlset>
"""

    return HTMLResponse(
        content=content,
        media_type="application/xml",
    )


# =========================================================
# HEALTH
# =========================================================

@app.get("/health")
def health():

    return {
        "ok": True,
        "app": APP_NAME,
        "version": APP_VERSION,
        "time": now_iso(),
    }


# =========================================================
# REGISTER
# =========================================================

@app.post("/api/register")
def register(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    display_name: str = Form(...),
):

    username = username.strip().lower()
    password = password.strip()
    display_name = display_name.strip()

    if len(username) < 3:
        raise HTTPException(
            status_code=400,
            detail="نام کاربری باید حداقل ۳ کاراکتر باشد.",
        )

    if len(username) > 32:
        raise HTTPException(
            status_code=400,
            detail="نام کاربری بیش از حد طولانی است.",
        )

    if len(password) < 6:
        raise HTTPException(
            status_code=400,
            detail="رمز عبور باید حداقل ۶ کاراکتر باشد.",
        )

    if not display_name:
        display_name = username

    if len(display_name) > 60:
        raise HTTPException(
            status_code=400,
            detail="نام نمایشی بیش از حد طولانی است.",
        )

    connection = get_db()

    try:

        cursor = connection.execute(
            """
            INSERT INTO users (
                username,
                password,
                display_name,
                created_at
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                username,
                hash_password(password),
                display_name,
                now_iso(),
            ),
        )

        connection.commit()

        user_id = int(
            cursor.lastrowid
        )

    except sqlite3.IntegrityError:

        connection.close()

        raise HTTPException(
            status_code=409,
            detail="این نام کاربری قبلاً ثبت شده است.",
        )

    connection.close()

    request.session["uid"] = user_id

    cleanup_ws_tickets()

    ticket = create_ws_ticket(
        user_id
    )

    connection = get_db()

    row = connection.execute(
        """
        SELECT
            id,
            username,
            display_name,
            bio,
            avatar,
            status
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()

    connection.close()

    response = JSONResponse(
        {
            "ok": True,
            "user": public_user(dict(row)),
        }
    )

    response.set_cookie(
        key="gapino_ws_ticket",
        value=ticket,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        path="/",
    )

    return response


# =========================================================
# LOGIN
# =========================================================

@app.post("/api/login")
def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):

    username = username.strip().lower()

    connection = get_db()

    row = connection.execute(
        """
        SELECT *
        FROM users
        WHERE username = ?
        """,
        (username,),
    ).fetchone()

    connection.close()

    if row is None:
        raise HTTPException(
            status_code=401,
            detail="نام کاربری یا رمز عبور نادرست است.",
        )

    user = dict(row)

    if not verify_password(
        password,
        user.get("password", ""),
    ):
        raise HTTPException(
            status_code=401,
            detail="نام کاربری یا رمز عبور نادرست است.",
        )

    user_id = int(
        user["id"]
    )

    request.session["uid"] = user_id

    cleanup_ws_tickets()

    ticket = create_ws_ticket(
        user_id
    )

    response = JSONResponse(
        {
            "ok": True,
            "user": public_user(user),
        }
    )

    response.set_cookie(
        key="gapino_ws_ticket",
        value=ticket,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        path="/",
    )

    return response


# =========================================================
# LOGOUT
# =========================================================

@app.post("/api/logout")
async def logout(request: Request):

    user_id = request.session.get("uid")

    if user_id is not None:

        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            user_id = None

    request.session.clear()

    if user_id is not None:

        for ticket, ticket_user_id in list(
            ws_tickets.items()
        ):

            if int(ticket_user_id) == user_id:
                ws_tickets.pop(
                    ticket,
                    None,
                )

        sockets = connections.get(
            user_id,
            set(),
        )

        for websocket in list(sockets):

            try:
                await websocket.close()
            except Exception:
                pass

        connections.pop(
            user_id,
            None,
        )

    response = JSONResponse(
        {
            "ok": True,
        }
    )

    response.delete_cookie(
        "gapino_ws_ticket",
        path="/",
    )

    response.delete_cookie(
        "gapino_session",
        path="/",
    )

    return response


# =========================================================
# CURRENT USER
# =========================================================

@app.get("/api/me")
def me(request: Request):

    user = require_user(request)

    cleanup_ws_tickets()

    old_ticket = request.cookies.get(
        "gapino_ws_ticket"
    )

    valid_old_ticket = False

    if old_ticket:

        old_user_id = get_user_id_from_ticket(
            old_ticket
        )

        if old_user_id == int(user["id"]):
            valid_old_ticket = True

    if valid_old_ticket:
        ticket = old_ticket
    else:
        ticket = create_ws_ticket(
            int(user["id"])
        )

    response = JSONResponse(
        public_user(user)
    )

    response.set_cookie(
        key="gapino_ws_ticket",
        value=ticket,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        path="/",
    )

    return response


# =========================================================
# PROFILE
# =========================================================

@app.put("/api/profile")
async def update_profile(
    request: Request,
):

    user = require_user(request)

    try:
        data = await request.json()
    except Exception:

        raise HTTPException(
            status_code=400,
            detail="داده پروفایل نامعتبر است.",
        )

    display_name = str(
        data.get(
            "display_name",
            user["display_name"],
        )
    ).strip()

    bio = str(
        data.get(
            "bio",
            user["bio"],
        )
    ).strip()

    status = str(
        data.get(
            "status",
            user["status"],
        )
    ).strip()

    if not display_name:
        raise HTTPException(
            status_code=400,
            detail="نام نمایشی نمی‌تواند خالی باشد.",
        )

    if len(display_name) > 60:
        raise HTTPException(
            status_code=400,
            detail="نام نمایشی بیش از حد طولانی است.",
        )

    if len(bio) > 300:
        raise HTTPException(
            status_code=400,
            detail="متن درباره من بیش از حد طولانی است.",
        )

    connection = get_db()

    connection.execute(
        """
        UPDATE users
        SET
            display_name = ?,
            bio = ?,
            status = ?
        WHERE id = ?
        """,
        (
            display_name,
            bio,
            status,
            int(user["id"]),
        ),
    )

    connection.commit()

    row = connection.execute(
        """
        SELECT
            id,
            username,
            display_name,
            bio,
            avatar,
            status
        FROM users
        WHERE id = ?
        """,
        (int(user["id"]),),
    ).fetchone()

    connection.close()

    return {
        "ok": True,
        "user": dict(row),
    }


# =========================================================
# PROFILE AVATAR
# =========================================================

@app.post("/api/profile/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
):

    user = require_user(request)

    filename = safe_filename(
        file.filename or "avatar"
    )

    extension = (
        Path(filename)
        .suffix
        .lower()
    )

    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="فرمت تصویر مجاز نیست.",
        )

    content = await file.read()

    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="حداکثر اندازه تصویر ۵ مگابایت است.",
        )

    file_name = (
        f"{user['id']}_"
        f"{secrets.token_hex(8)}"
        f"{extension}"
    )

    path = (
        UPLOADS_DIR /
        file_name
    )

    path.write_bytes(
        content
    )

    avatar_url = (
        f"/uploads/{file_name}"
    )

    connection = get_db()

    connection.execute(
        """
        UPDATE users
        SET avatar = ?
        WHERE id = ?
        """,
        (
            avatar_url,
            int(user["id"]),
        ),
    )

    connection.commit()
    connection.close()

    return {
        "ok": True,
        "avatar": avatar_url,
    }


# =========================================================
# USERS
# =========================================================

@app.get("/api/users")
def get_users(
    request: Request,
):

    current = require_user(request)

    query = (
        request.query_params
        .get("q", "")
        .strip()
        .lower()
    )

    connection = get_db()

    if query:

        rows = connection.execute(
            """
            SELECT
                id,
                username,
                display_name,
                bio,
                avatar,
                status
            FROM users
            WHERE id != ?
              AND (
                    LOWER(username) LIKE ?
                    OR LOWER(display_name) LIKE ?
              )
            ORDER BY display_name COLLATE NOCASE
            """,
            (
                int(current["id"]),
                f"%{query}%",
                f"%{query}%",
            ),
        ).fetchall()

    else:

        rows = connection.execute(
            """
            SELECT
                id,
                username,
                display_name,
                bio,
                avatar,
                status
            FROM users
            WHERE id != ?
            ORDER BY display_name COLLATE NOCASE
            """,
            (
                int(current["id"]),
            ),
        ).fetchall()

    connection.close()

    online_ids = set(
        connections.keys()
    )

    result = []

    for row in rows:

        item = dict(row)

        item["online"] = (
            int(item["id"])
            in online_ids
        )

        result.append(
            item
        )

    return result


# =========================================================
# DIRECT MESSAGES
# =========================================================

@app.get("/api/messages/{other_id}")
def get_messages(
    request: Request,
    other_id: int,
):

    current = require_user(request)

    if other_id == int(
        current["id"]
    ):
        return []

    connection = get_db()

    rows = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE deleted = 0
          AND (
                (
                    sender_id = ?
                    AND receiver_id = ?
                )
                OR
                (
                    sender_id = ?
                    AND receiver_id = ?
                )
              )
        ORDER BY id ASC
        """,
        (
            int(current["id"]),
            other_id,
            other_id,
            int(current["id"]),
        ),
    ).fetchall()

    connection.close()

    return [
        dict(row)
        for row in rows
    ]


# =========================================================
# SEND MESSAGE
# =========================================================

@app.post("/api/messages")
async def send_message(
    request: Request,
):

    current = require_user(request)

    try:
        data = await request.json()
    except Exception:

        raise HTTPException(
            status_code=400,
            detail="داده پیام نامعتبر است.",
        )

    try:
        receiver_id = int(
            data.get("receiver_id")
        )
    except (TypeError, ValueError):

        raise HTTPException(
            status_code=400,
            detail="گیرنده پیام نامعتبر است.",
        )

    text = str(
        data.get(
            "text",
            "",
        )
    ).strip()

    if receiver_id == int(
        current["id"]
    ):

        raise HTTPException(
            status_code=400,
            detail="نمی‌توانی به خودت پیام بفرستی.",
        )

    if not text:

        raise HTTPException(
            status_code=400,
            detail="پیام خالی است.",
        )

    if len(text) > 5000:

        raise HTTPException(
            status_code=400,
            detail="پیام بیش از حد طولانی است.",
        )

    connection = get_db()

    receiver = connection.execute(
        """
        SELECT id
        FROM users
        WHERE id = ?
        """,
        (receiver_id,),
    ).fetchone()

    if receiver is None:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="کاربر پیدا نشد.",
        )

    cursor = connection.execute(
        """
        INSERT INTO messages (
            sender_id,
            receiver_id,
            text,
            created_at
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            int(current["id"]),
            receiver_id,
            text,
            now_iso(),
        ),
    )

    connection.commit()

    row = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (cursor.lastrowid,),
    ).fetchone()

    connection.close()

    payload = dict(row)

    await broadcast(
        receiver_id,
        {
            "type": "message",
            "message": payload,
        },
    )

    return payload


# =========================================================
# EDIT MESSAGE
# =========================================================

@app.post(
    "/api/messages/{message_id}/edit"
)
async def edit_message(
    request: Request,
    message_id: int,
):

    current = require_user(request)

    try:
        data = await request.json()
    except Exception:

        raise HTTPException(
            status_code=400,
            detail="داده نامعتبر است.",
        )

    text = str(
        data.get(
            "text",
            "",
        )
    ).strip()

    if not text:

        raise HTTPException(
            status_code=400,
            detail="پیام نمی‌تواند خالی باشد.",
        )

    if len(text) > 5000:

        raise HTTPException(
            status_code=400,
            detail="پیام بیش از حد طولانی است.",
        )

    connection = get_db()

    row = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (message_id,),
    ).fetchone()

    if row is None:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="پیام پیدا نشد.",
        )

    if int(row["sender_id"]) != int(
        current["id"]
    ):

        connection.close()

        raise HTTPException(
            status_code=403,
            detail="اجازه ویرایش این پیام را ندارید.",
        )

    if int(row["deleted"]) == 1:

        connection.close()

        raise HTTPException(
            status_code=400,
            detail="پیام حذف شده است.",
        )

    connection.execute(
        """
        UPDATE messages
        SET
            text = ?,
            edited = 1
        WHERE id = ?
        """,
        (
            text,
            message_id,
        ),
    )

    connection.commit()

    updated = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (message_id,),
    ).fetchone()

    connection.close()

    payload = dict(updated)

    if row["receiver_id"]:

        await broadcast(
            int(row["receiver_id"]),
            {
                "type": "message:update",
                "message": payload,
            },
        )

    return payload


# =========================================================
# DELETE MESSAGE
# =========================================================

@app.delete(
    "/api/messages/{message_id}"
)
async def delete_message(
    request: Request,
    message_id: int,
):

    current = require_user(request)

    connection = get_db()

    row = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (message_id,),
    ).fetchone()

    if row is None:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="پیام پیدا نشد.",
        )

    if int(row["sender_id"]) != int(
        current["id"]
    ):

        connection.close()

        raise HTTPException(
            status_code=403,
            detail="اجازه حذف این پیام را ندارید.",
        )

    connection.execute(
        """
        UPDATE messages
        SET
            deleted = 1,
            text = '',
            file_name = '',
            file_url = '',
            mime_type = ''
        WHERE id = ?
        """,
        (message_id,),
    )

    connection.commit()

    updated = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (message_id,),
    ).fetchone()

    connection.close()

    payload = dict(updated)

    if row["receiver_id"]:

        await broadcast(
            int(row["receiver_id"]),
            {
                "type": "message:update",
                "message": payload,
            },
        )

    return payload


# =========================================================
# FILE UPLOAD
# =========================================================

@app.post("/api/upload")
async def upload_file(
    request: Request,
    receiver_id: int = Form(...),
    file: UploadFile = File(...),
):

    current = require_user(request)

    if receiver_id == int(
        current["id"]
    ):

        raise HTTPException(
            status_code=400,
            detail="گیرنده فایل نامعتبر است.",
        )

    filename = safe_filename(
        file.filename or "file"
    )

    if not is_allowed_upload(
        filename
    ):

        raise HTTPException(
            status_code=400,
            detail="فرمت فایل مجاز نیست.",
        )

    content = await file.read()

    if len(content) > MAX_UPLOAD_SIZE:

        raise HTTPException(
            status_code=413,
            detail="حداکثر اندازه فایل ۱۰ مگابایت است.",
        )

    connection = get_db()

    receiver = connection.execute(
        """
        SELECT id
        FROM users
        WHERE id = ?
        """,
        (receiver_id,),
    ).fetchone()

    if receiver is None:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="کاربر پیدا نشد.",
        )

    stored_name = (
        f"{secrets.token_hex(8)}_"
        f"{filename}"
    )

    path = (
        UPLOADS_DIR /
        stored_name
    )

    path.write_bytes(
        content
    )

    file_url = (
        f"/uploads/{stored_name}"
    )

    mime_type = (
        file.content_type
        or mimetypes.guess_type(filename)[0]
        or "application/octet-stream"
    )

    cursor = connection.execute(
        """
        INSERT INTO messages (
            sender_id,
            receiver_id,
            text,
            file_name,
            file_url,
            mime_type,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(current["id"]),
            receiver_id,
            "",
            filename,
            file_url,
            mime_type,
            now_iso(),
        ),
    )

    connection.commit()

    row = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (cursor.lastrowid,),
    ).fetchone()

    connection.close()

    payload = dict(row)

    await broadcast(
        receiver_id,
        {
            "type": "message",
            "message": payload,
        },
    )

    return payload


# =========================================================
# GROUPS
# =========================================================

@app.post("/api/groups")
async def create_group(
    request: Request,
):

    current = require_user(request)

    try:
        data = await request.json()
    except Exception:
        data = {}

    name = str(
        data.get(
            "name",
            "",
        )
    ).strip()

    raw_members = data.get(
        "members",
        [],
    )

    if not isinstance(
        raw_members,
        list,
    ):
        raw_members = []

    members: list[int] = []

    for item in raw_members:

        try:
            member_id = int(item)
        except (TypeError, ValueError):
            continue

        if member_id not in members:
            members.append(
                member_id
            )

    if not name:

        raise HTTPException(
            status_code=400,
            detail="نام گروه الزامی است.",
        )

    if len(name) > 100:

        raise HTTPException(
            status_code=400,
            detail="نام گروه بیش از حد طولانی است.",
        )

    connection = get_db()

    cursor = connection.execute(
        """
        INSERT INTO groups (
            name,
            owner_id,
            created_at
        )
        VALUES (?, ?, ?)
        """,
        (
            name,
            int(current["id"]),
            now_iso(),
        ),
    )

    group_id = int(
        cursor.lastrowid
    )

    connection.execute(
        """
        INSERT OR IGNORE INTO group_members (
            group_id,
            user_id
        )
        VALUES (?, ?)
        """,
        (
            group_id,
            int(current["id"]),
        ),
    )

    for member_id in members:

        connection.execute(
            """
            INSERT OR IGNORE INTO group_members (
                group_id,
                user_id
            )
            VALUES (?, ?)
            """,
            (
                group_id,
                member_id,
            ),
        )

    connection.commit()
    connection.close()

    return {
        "ok": True,
        "id": group_id,
        "name": name,
        "owner_id": int(current["id"]),
    }


# =========================================================
# BROADCAST
# =========================================================

async def broadcast(
    user_id: int,
    payload: dict,
) -> None:

    sockets = connections.get(
        int(user_id),
        set(),
    )

    if not sockets:
        return

    text = json.dumps(
        payload,
        ensure_ascii=False,
    )

    dead_sockets = []

    for websocket in list(sockets):

        try:

            await websocket.send_text(
                text
            )

        except Exception:

            dead_sockets.append(
                websocket
            )

    for websocket in dead_sockets:

        sockets.discard(
            websocket
        )


# =========================================================
# WEBSOCKET
# =========================================================

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
):

    await websocket.accept()

    ticket = websocket.cookies.get(
        "gapino_ws_ticket"
    )

    user_id = get_user_id_from_ticket(
        ticket or ""
    )

    if user_id is None:

        await websocket.close(
            code=4401
        )

        return

    connection = get_db()

    row = connection.execute(
        """
        SELECT id
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()

    connection.close()

    if row is None:

        await websocket.close(
            code=4401
        )

        return

    connections.setdefault(
        int(user_id),
        set(),
    ).add(
        websocket
    )

    try:

        for other_id in list(
            connections.keys()
        ):

            if int(other_id) == int(
                user_id
            ):
                continue

            await broadcast(
                int(other_id),
                {
                    "type": "user_online",
                    "user_id": int(user_id),
                },
            )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "ready",
                    "online": [
                        int(item)
                        for item in connections.keys()
                    ],
                },
                ensure_ascii=False,
            )
        )

        while True:

            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
            except Exception:
                data = {}

            event_type = data.get(
                "type"
            )

            if event_type == "ping":

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "pong"
                        },
                        ensure_ascii=False,
                    )
                )

            elif event_type == "typing":

                try:
                    target_id = int(
                        data.get("to")
                    )
                except (TypeError, ValueError):
                    continue

                await broadcast(
                    target_id,
                    {
                        "type": "typing",
                        "from": int(user_id),
                        "value": bool(
                            data.get(
                                "value",
                                False,
                            )
                        ),
                    },
                )

    except WebSocketDisconnect:

        pass

    except Exception as error:

        print(
            f"WebSocket error: {error}"
        )

    finally:

        sockets = connections.get(
            int(user_id),
            set(),
        )

        sockets.discard(
            websocket
        )

        if not sockets:

            connections.pop(
                int(user_id),
                None,
            )

            for other_id in list(
                connections.keys()
            ):

                await broadcast(
                    int(other_id),
                    {
                        "type": "user_offline",
                        "user_id": int(user_id),
                    },
                )


# =========================================================
# FAVICON
# =========================================================

@app.get("/favicon.ico")
def favicon():

    ico = FRONTEND_DIR / "favicon.ico"

    if ico.exists():

        return FileResponse(
            ico,
            media_type="image/x-icon",
        )

    return Response204()


# =========================================================
# EMPTY RESPONSE
# =========================================================

def Response204():

    return JSONResponse(
        content=None,
        status_code=204,
    )