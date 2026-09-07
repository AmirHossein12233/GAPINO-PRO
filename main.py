from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
)
from fastapi.staticfiles import StaticFiles
from passlib.context import CryptContext
from starlette.middleware.sessions import SessionMiddleware


# =========================================================
# PATHS
# =========================================================

BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "gapino.db"

DATA_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

FRONTEND_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

UPLOADS_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# =========================================================
# CONFIG
# =========================================================

SESSION_SECRET = os.getenv(
    "GAPINO_SESSION_SECRET",
    "change-this-gapino-secret-before-production",
)

MAX_UPLOAD_SIZE = 10 * 1024 * 1024
MAX_AVATAR_SIZE = 5 * 1024 * 1024
MAX_LIVE_CHAT_LENGTH = 1000
WS_TICKET_TTL = 10 * 60


# =========================================================
# APP
# =========================================================

app = FastAPI(
    title="GAPINO Pro",
    version="1.1.0",
    description="GAPINO Messenger + Live",
)


# =========================================================
# SESSION
# =========================================================

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="gapino_session",
    max_age=60 * 60 * 24 * 30,
    same_site="lax",
    https_only=True,
)


# =========================================================
# STATIC FILES
# =========================================================

app.mount(
    "/frontend",
    StaticFiles(
        directory=FRONTEND_DIR
    ),
    name="frontend",
)

app.mount(
    "/static",
    StaticFiles(
        directory=FRONTEND_DIR
    ),
    name="static",
)

app.mount(
    "/uploads",
    StaticFiles(
        directory=UPLOADS_DIR
    ),
    name="uploads",
)


# =========================================================
# PASSWORD
# =========================================================

pwd = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
)


# =========================================================
# NORMAL WEBSOCKET CONNECTIONS
# =========================================================

connections: dict[
    int,
    set[WebSocket]
] = {}


# =========================================================
# WEBSOCKET TICKETS
# =========================================================

ws_tickets: dict[
    str,
    dict[str, Any]
] = {}


# =========================================================
# LIVE ROOMS
# =========================================================

# room_id -> {
#     room_id,
#     host_uid,
#     host_peer_id,
#     active,
#     created_at,
#     peers: {
#         peer_id: uid
#     }
# }

live_rooms: dict[
    str,
    dict[str, Any]
] = {}


# websocket ->
# {(room_id, peer_id), ...}

live_socket_peers: dict[
    WebSocket,
    set[tuple[str, str]]
] = {}


# =========================================================
# TIME
# =========================================================

def now() -> str:
    return datetime.now(
        timezone.utc
    ).isoformat()


# =========================================================
# DATABASE
# =========================================================

def db() -> sqlite3.Connection:
    conn = sqlite3.connect(
        DB_PATH,
        timeout=20,
    )

    conn.row_factory = sqlite3.Row

    conn.execute(
        "PRAGMA foreign_keys = ON"
    )

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
            FOREIGN KEY(sender_id)
                REFERENCES users(id)
                ON DELETE CASCADE,
            FOREIGN KEY(receiver_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(owner_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY(group_id, user_id),
            FOREIGN KEY(group_id)
                REFERENCES groups(id)
                ON DELETE CASCADE,
            FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reactions (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY(
                message_id,
                user_id,
                emoji
            ),
            FOREIGN KEY(message_id)
                REFERENCES messages(id)
                ON DELETE CASCADE,
            FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        );
        """
    )

    conn.commit()
    conn.close()


init_db()


# =========================================================
# RECOVERY COLUMN
# =========================================================

def ensure_recovery_column() -> None:

    conn = db()

    columns = {
        row[1]
        for row in conn.execute(
            "PRAGMA table_info(users)"
        ).fetchall()
    }

    if "recovery_code" not in columns:

        conn.execute(
            """
            ALTER TABLE users
            ADD COLUMN recovery_code TEXT DEFAULT ''
            """
        )

        conn.commit()

    conn.close()


ensure_recovery_column()


# =========================================================
# PASSWORD HELPERS
# =========================================================

def hash_password(
    password: str,
) -> str:
    return pwd.hash(
        password
    )


def verify_password(
    password: str,
    stored_hash: str,
) -> bool:

    if (
        not password
        or not stored_hash
    ):
        return False

    stored_hash = str(
        stored_hash
    ).strip()

    # Old custom PBKDF2 format
    if (
        stored_hash.startswith(
            "$pbkdf2$"
        )
        and not stored_hash.startswith(
            "$pbkdf2-sha256$"
        )
    ):

        parts = stored_hash.split(
            "$"
        )

        if len(parts) != 4:
            return False

        try:

            digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode(
                    "utf-8"
                ),
                parts[2].encode(
                    "utf-8"
                ),
                120_000,
            ).hex()

            return hmac.compare_digest(
                digest,
                parts[3],
            )

        except Exception:

            return False

    try:

        return bool(
            pwd.verify(
                password,
                stored_hash,
            )
        )

    except Exception:

        pass

    # Compatibility with old hashes
    for scheme_name, prefixes in (
        (
            "argon2",
            ("$argon2"),
        ),
        (
            "bcrypt",
            (
                "$2a$",
                "$2b$",
                "$2y$",
            ),
        ),
    ):

        try:

            matches = (
                stored_hash.startswith(
                    prefixes
                )
                if isinstance(
                    prefixes,
                    tuple,
                )
                else stored_hash.startswith(
                    prefixes
                )
            )

            if not matches:
                continue

            scheme = getattr(
                __import__(
                    "passlib.hash",
                    fromlist=[
                        scheme_name
                    ],
                ),
                scheme_name,
            )

            return bool(
                scheme.verify(
                    password,
                    stored_hash,
                )
            )

        except Exception:

            return False

    return False


def needs_password_upgrade(
    stored_hash: str,
) -> bool:

    value = str(
        stored_hash or ""
    ).strip()

    return (
        (
            value.startswith(
                "$pbkdf2$"
            )
            and not value.startswith(
                "$pbkdf2-sha256$"
            )
        )
        or value.startswith(
            "$argon2"
        )
        or value.startswith(
            (
                "$2a$",
                "$2b$",
                "$2y$",
            )
        )
    )


# =========================================================
# USER HELPERS
# =========================================================

def user_by_id(
    user_id: int,
) -> dict[str, Any] | None:

    conn = db()

    row = conn.execute(
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
        (
            user_id,
        ),
    ).fetchone()

    conn.close()

    return (
        dict(row)
        if row
        else None
    )


def user_by_username(
    username: str,
) -> dict[str, Any] | None:

    conn = db()

    row = conn.execute(
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
        WHERE LOWER(username)
            = LOWER(?)
        """,
        (
            str(
                username or ""
            )
            .strip()
            .lower(),
        ),
    ).fetchone()

    conn.close()

    return (
        dict(row)
        if row
        else None
    )


def public_user(
    user: dict[str, Any],
) -> dict[str, Any]:

    return {
        "id":
            user["id"],

        "username":
            user["username"],

        "display_name":
            user["display_name"],

        "bio":
            user.get(
                "bio",
                "",
            ),

        "avatar":
            user.get(
                "avatar",
                "",
            ),

        "status":
            user.get(
                "status",
                "در دسترس",
            ),

        "created_at":
            user.get(
                "created_at",
                "",
            ),
    }


# =========================================================
# AUTH HELPERS
# =========================================================

def current_user(
    request: Request,
) -> dict[str, Any] | None:

    uid = request.session.get(
        "uid"
    )

    if uid is None:
        return None

    try:

        return user_by_id(
            int(uid)
        )

    except (
        TypeError,
        ValueError,
    ):

        return None


def require_user(
    request: Request,
) -> dict[str, Any]:

    user = current_user(
        request
    )

    if not user:

        raise HTTPException(
            status_code=401,
            detail="نیاز به ورود دارید",
        )

    return user


# =========================================================
# WS TICKET
# =========================================================

def cleanup_tickets() -> None:

    current = time.time()

    for ticket in list(
        ws_tickets
    ):

        info = ws_tickets.get(
            ticket
        )

        if not info:
            continue

        if float(
            info.get(
                "expires",
                0,
            )
        ) <= current:

            ws_tickets.pop(
                ticket,
                None,
            )


def make_ws_ticket(
    user_id: int,
) -> str:

    cleanup_tickets()

    ticket = secrets.token_urlsafe(
        32
    )

    ws_tickets[
        ticket
    ] = {
        "uid":
            int(user_id),
        "expires":
            time.time()
            + WS_TICKET_TTL,
    }

    return ticket


def consume_ws_ticket(
    ticket: str,
) -> int | None:

    cleanup_tickets()

    info = ws_tickets.pop(
        ticket,
        None,
    )

    if not info:
        return None

    if float(
        info.get(
            "expires",
            0,
        )
    ) <= time.time():

        return None

    try:

        return int(
            info["uid"]
        )

    except (
        KeyError,
        TypeError,
        ValueError,
    ):

        return None


def set_ws_cookie(
    user_id: int,
    response: JSONResponse,
) -> None:

    response.set_cookie(
        "gapino_ws_ticket",
        make_ws_ticket(
            user_id
        ),
        max_age=WS_TICKET_TTL,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )


# =========================================================
# GENERAL WS BROADCAST
# =========================================================

async def send_ws(
    websocket: WebSocket,
    payload: dict[str, Any],
) -> None:

    try:

        await websocket.send_text(
            json.dumps(
                payload,
                ensure_ascii=False,
            )
        )

    except Exception:

        pass


async def broadcast(
    user_id: int,
    payload: dict[str, Any],
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

    dead = []

    for websocket in list(
        sockets
    ):

        try:

            await websocket.send_text(
                text
            )

        except Exception:

            dead.append(
                websocket
            )

    for websocket in dead:

        sockets.discard(
            websocket
        )

    if not sockets:

        connections.pop(
            int(user_id),
            None,
        )


# =========================================================
# LIVE HELPERS
# =========================================================

def get_live_room(
    room_id: str,
) -> dict[str, Any] | None:

    room_id = str(
        room_id or ""
    ).strip()

    if not room_id:
        return None

    return live_rooms.get(
        room_id
    )


def live_peer_uid(
    room: dict[str, Any],
    peer_id: str,
) -> int | None:

    try:

        return int(
            room["peers"].get(
                peer_id
            )
        )

    except (
        TypeError,
        ValueError,
    ):

        return None


def live_peer_count(
    room: dict[str, Any],
) -> int:

    return max(
        0,
        len(
            room.get(
                "peers",
                {},
            )
        ),
    )


def live_host_user(
    room: dict[str, Any],
) -> dict[str, Any] | None:

    try:

        host_uid = int(
            room[
                "host_uid"
            ]
        )

    except (
        KeyError,
        TypeError,
        ValueError,
    ):

        return None

    return user_by_id(
        host_uid
    )


async def send_live_to_uid(
    uid: int,
    payload: dict[str, Any],
) -> None:

    await broadcast(
        int(uid),
        payload,
    )


async def broadcast_live_room(
    room: dict[str, Any],
    payload: dict[str, Any],
    exclude_peer_id: str | None = None,
) -> None:

    peers = room.get(
        "peers",
        {},
    )

    sent_users: set[int] = set()

    for (
        peer_id,
        uid,
    ) in list(
        peers.items()
    ):

        if (
            exclude_peer_id
            and peer_id
            == exclude_peer_id
        ):
            continue

        try:

            uid_int = int(
                uid
            )

        except (
            TypeError,
            ValueError,
        ):

            continue

        if uid_int in sent_users:
            continue

        sent_users.add(
            uid_int
        )

        await send_live_to_uid(
            uid_int,
            payload,
        )


async def send_live_viewer_count(
    room: dict[str, Any],
) -> None:

    await broadcast_live_room(
        room,
        {
            "type":
                "live_viewers",

            "room_id":
                room["room_id"],

            "count":
                live_peer_count(
                    room
                ),
        },
    )


async def remove_live_peer(
    room_id: str,
    peer_id: str,
    notify: bool = True,
) -> None:

    room = live_rooms.get(
        room_id
    )

    if not room:
        return

    peers = room.get(
        "peers",
        {},
    )

    uid = peers.pop(
        peer_id,
        None,
    )

    if uid is None:
        return

    # Host left
    if (
        int(uid)
        == int(
            room["host_uid"]
        )
    ):

        if notify:

            await broadcast_live_room(
                room,
                {
                    "type":
                        "live_stopped",

                    "room_id":
                        room_id,

                    "reason":
                        "host_left",
                },
                exclude_peer_id=peer_id,
            )

        live_rooms.pop(
            room_id,
            None,
        )

        return

    # Viewer left
    if notify:

        await broadcast_live_room(
            room,
            {
                "type":
                    "live_peer_left",

                "room_id":
                    room_id,

                "peer_id":
                    peer_id,
            },
        )

        await send_live_viewer_count(
            room
        )

    if not peers:

        live_rooms.pop(
            room_id,
            None,
        )


# =========================================================
# PAGES
# =========================================================

@app.get(
    "/",
    response_class=HTMLResponse,
)
def root(
    request: Request,
):

    filename = (
        "chat.html"
        if current_user(
            request
        )
        else "login.html"
    )

    path = (
        FRONTEND_DIR
        / filename
    )

    if not path.exists():

        raise HTTPException(
            status_code=500,
            detail=(
                f"{filename} پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


@app.get(
    "/login.html",
    response_class=HTMLResponse,
)
def login_page():

    path = (
        FRONTEND_DIR
        / "login.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "login.html پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


@app.get(
    "/register.html",
    response_class=HTMLResponse,
)
def register_page():

    path = (
        FRONTEND_DIR
        / "register.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "register.html پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


@app.get(
    "/chat.html",
    response_class=HTMLResponse,
)
def chat_page():

    path = (
        FRONTEND_DIR
        / "chat.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "chat.html پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


@app.get(
    "/live.html",
    response_class=HTMLResponse,
)
def live_page():

    path = (
        FRONTEND_DIR
        / "live.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "live.html پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


@app.get(
    "/profile.html",
    response_class=HTMLResponse,
)
def profile_page():

    path = (
        FRONTEND_DIR
        / "profile.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "profile.html پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


@app.get(
    "/recovery.html",
    response_class=HTMLResponse,
)
def recovery_page():

    path = (
        FRONTEND_DIR
        / "recovery.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "recovery.html پیدا نشد"
            ),
        )

    return FileResponse(
        path,
        media_type=(
            "text/html; "
            "charset=utf-8"
        ),
    )


# =========================================================
# HEALTH
# =========================================================

@app.get("/health")
def health():

    return {
        "ok":
            True,

        "status":
            "ok",

        "app":
            "GAPINO Pro",

        "version":
            "1.1.0",

        "time":
            now(),

        "database":
            DB_PATH.exists(),

        "frontend":
            FRONTEND_DIR.exists(),

        "online_users":
            len(
                connections
            ),

        "live_rooms":
            len(
                live_rooms
            ),
    }


# =========================================================
# REGISTER
# =========================================================

@app.post(
    "/api/register"
)
def register(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    display_name: str = Form(...),
):

    username = (
        username
        .strip()
        .lower()
    )

    display_name = (
        display_name
        .strip()
        or username
    )

    if (
        len(username) < 3
        or len(username) > 32
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "نام کاربری باید "
                "بین ۳ تا ۳۲ کاراکتر باشد"
            ),
        )

    if not re.fullmatch(
        r"[a-zA-Z0-9_.-]+",
        username,
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "نام کاربری فقط می‌تواند "
                "شامل حروف انگلیسی، عدد، "
                "نقطه، خط تیره و زیرخط باشد"
            ),
        )

    if len(password) < 6:

        raise HTTPException(
            status_code=400,
            detail=(
                "رمز عبور حداقل "
                "۶ کاراکتر باشد"
            ),
        )

    if len(display_name) > 60:

        raise HTTPException(
            status_code=400,
            detail=(
                "نام نمایشی خیلی طولانی است"
            ),
        )

    recovery_code = (
        secrets.token_hex(
            8
        ).upper()
    )

    conn = db()

    try:

        cursor = conn.execute(
            """
            INSERT INTO users(
                username,
                password,
                display_name,
                created_at,
                recovery_code
            )
            VALUES(
                ?,
                ?,
                ?,
                ?,
                ?
            )
            """,
            (
                username,
                hash_password(
                    password
                ),
                display_name,
                now(),
                recovery_code,
            ),
        )

        conn.commit()

        user_id = int(
            cursor.lastrowid
        )

    except sqlite3.IntegrityError:

        conn.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "این نام کاربری "
                "قبلاً ثبت شده است"
            ),
        )

    finally:

        conn.close()

    request.session.clear()

    request.session["uid"] = (
        user_id
    )

    user = user_by_id(
        user_id
    )

    response = JSONResponse(
        {
            "ok":
                True,

            "success":
                True,

            "user":
                public_user(
                    user
                ),

            "recovery_code":
                recovery_code,
        }
    )

    set_ws_cookie(
        user_id,
        response,
    )

    return response


# =========================================================
# LOGIN
# =========================================================

@app.post(
    "/api/login"
)
def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):

    username = (
        username
        .strip()
        .lower()
    )

    conn = db()

    row = conn.execute(
        """
        SELECT *
        FROM users
        WHERE LOWER(username)
            = LOWER(?)
        """,
        (
            username,
        ),
    ).fetchone()

    conn.close()

    if (
        not row
        or not verify_password(
            password,
            row["password"],
        )
    ):

        raise HTTPException(
            status_code=401,
            detail=(
                "نام کاربری یا "
                "رمز عبور نادرست است"
            ),
        )

    user_id = int(
        row["id"]
    )

    if needs_password_upgrade(
        row["password"]
    ):

        conn = db()

        conn.execute(
            """
            UPDATE users
            SET password = ?
            WHERE id = ?
            """,
            (
                hash_password(
                    password
                ),
                user_id,
            ),
        )

        conn.commit()
        conn.close()

    request.session.clear()

    request.session["uid"] = (
        user_id
    )

    user = user_by_id(
        user_id
    )

    response = JSONResponse(
        {
            "ok":
                True,

            "success":
                True,

            "user":
                public_user(
                    user
                ),
        }
    )

    set_ws_cookie(
        user_id,
        response,
    )

    return response


# =========================================================
# LOGOUT
# =========================================================

@app.post(
    "/api/logout"
)
def logout(
    request: Request,
):

    uid = request.session.get(
        "uid"
    )

    request.session.clear()

    if uid is not None:

        try:

            sockets = connections.pop(
                int(uid),
                set(),
            )

            for websocket in list(
                sockets
            ):

                try:
                    pass
                except Exception:
                    pass

        except (
            TypeError,
            ValueError,
        ):

            pass

    response = JSONResponse(
        {
            "ok":
                True,

            "success":
                True,
        }
    )

    response.delete_cookie(
        "gapino_session",
        path="/",
    )

    response.delete_cookie(
        "gapino_ws_ticket",
        path="/",
    )

    return response


# =========================================================
# ME
# =========================================================

@app.get(
    "/api/me"
)
def me(
    request: Request,
):

    user = require_user(
        request
    )

    response = JSONResponse(
        public_user(
            user
        )
    )

    set_ws_cookie(
        int(
            user["id"]
        ),
        response,
    )

    return response


# =========================================================
# RECOVERY
# =========================================================

def normalize_recovery_code(
    value: Any,
) -> str:

    return (
        str(
            value or ""
        )
        .strip()
        .replace("-", "")
        .replace(" ", "")
        .upper()
    )


@app.post(
    "/api/recover/username"
)
async def recover_username(
    request: Request,
):

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail=(
                "داده بازیابی نامعتبر است"
            ),
        )

    display_name = str(
        data.get(
            "display_name",
            "",
        )
        or ""
    ).strip()

    recovery_code = (
        normalize_recovery_code(
            data.get(
                "recovery_code"
            )
        )
    )

    if (
        not display_name
        or not recovery_code
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "نام نمایشی و "
                "کد بازیابی الزامی هستند"
            ),
        )

    conn = db()

    rows = conn.execute(
        """
        SELECT
            username,
            recovery_code
        FROM users
        WHERE LOWER(display_name)
            = LOWER(?)
        """,
        (
            display_name,
        ),
    ).fetchall()

    conn.close()

    for row in rows:

        if (
            normalize_recovery_code(
                row["recovery_code"]
            )
            == recovery_code
        ):

            return {
                "ok":
                    True,

                "success":
                    True,

                "username":
                    row["username"],
            }

    raise HTTPException(
        status_code=404,
        detail=(
            "اطلاعات بازیابی صحیح نیست"
        ),
    )


@app.post(
    "/api/recover/password"
)
async def recover_password(
    request: Request,
):

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail=(
                "داده بازیابی نامعتبر است"
            ),
        )

    username = (
        str(
            data.get(
                "username",
                "",
            )
            or ""
        )
        .strip()
        .lower()
    )

    recovery_code = (
        normalize_recovery_code(
            data.get(
                "recovery_code"
            )
        )
    )

    new_password = str(
        data.get(
            "new_password",
            "",
        )
        or ""
    )

    if (
        not username
        or not recovery_code
        or not new_password
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "همه فیلدها را وارد کنید"
            ),
        )

    if len(new_password) < 6:

        raise HTTPException(
            status_code=400,
            detail=(
                "رمز عبور جدید باید "
                "حداقل ۶ کاراکتر باشد"
            ),
        )

    conn = db()

    row = conn.execute(
        """
        SELECT
            id,
            recovery_code
        FROM users
        WHERE LOWER(username)
            = LOWER(?)
        """,
        (
            username,
        ),
    ).fetchone()

    if not row:

        conn.close()

        raise HTTPException(
            status_code=404,
            detail="کاربر پیدا نشد",
        )

    if (
        normalize_recovery_code(
            row["recovery_code"]
        )
        != recovery_code
    ):

        conn.close()

        raise HTTPException(
            status_code=403,
            detail=(
                "کد بازیابی نادرست است"
            ),
        )

    conn.execute(
        """
        UPDATE users
        SET password = ?
        WHERE id = ?
        """,
        (
            hash_password(
                new_password
            ),
            int(
                row["id"]
            ),
        ),
    )

    conn.commit()
    conn.close()

    return {
        "ok":
            True,

        "success":
            True,

        "message":
            "رمز عبور با موفقیت تغییر کرد.",
    }


@app.post(
    "/api/account/recovery-code"
)
def create_recovery_code(
    request: Request,
):

    user = require_user(
        request
    )

    code = secrets.token_hex(
        8
    ).upper()

    conn = db()

    conn.execute(
        """
        UPDATE users
        SET recovery_code = ?
        WHERE id = ?
        """,
        (
            code,
            int(
                user["id"]
            ),
        ),
    )

    conn.commit()
    conn.close()

    return {
        "ok":
            True,

        "success":
            True,

        "recovery_code":
            code,
    }


# =========================================================
# PROFILE
# =========================================================

@app.put(
    "/api/profile"
)
async def update_profile(
    request: Request,
):

    user = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail=(
                "داده پروفایل نامعتبر است"
            ),
        )

    display_name = str(
        data.get(
            "display_name",
            user["display_name"],
        )
        or ""
    ).strip()

    bio = str(
        data.get(
            "bio",
            user["bio"],
        )
        or ""
    ).strip()

    status = str(
        data.get(
            "status",
            user["status"],
        )
        or ""
    ).strip()

    if not display_name:

        raise HTTPException(
            status_code=400,
            detail=(
                "نام نمایشی نمی‌تواند "
                "خالی باشد"
            ),
        )

    if len(display_name) > 60:

        raise HTTPException(
            status_code=400,
            detail=(
                "نام نمایشی خیلی طولانی است"
            ),
        )

    if len(bio) > 250:

        raise HTTPException(
            status_code=400,
            detail=(
                "بیوگرافی حداکثر "
                "۲۵۰ کاراکتر است"
            ),
        )

    if len(status) > 40:

        raise HTTPException(
            status_code=400,
            detail=(
                "وضعیت خیلی طولانی است"
            ),
        )

    conn = db()

    conn.execute(
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
            int(
                user["id"]
            ),
        ),
    )

    conn.commit()
    conn.close()

    updated = user_by_id(
        int(
            user["id"]
        )
    )

    return {
        "ok":
            True,

        "user":
            public_user(
                updated
            ),
    }


@app.put(
    "/api/account/security"
)
async def update_account_security(
    request: Request,
):

    user = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail=(
                "داده امنیتی نامعتبر است"
            ),
        )

    requested_username = data.get(
        "username"
    )

    current_password = data.get(
        "current_password"
    )

    new_password = data.get(
        "new_password"
    )

    username_changed = (
        requested_username is not None
        and
        str(
            requested_username
        )
        .strip()
        .lower()
        !=
        str(
            user["username"]
        )
        .strip()
        .lower()
    )

    password_changed = (
        new_password is not None
        and
        str(
            new_password
        ) != ""
    )

    if (
        not username_changed
        and not password_changed
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "تغییری برای ذخیره وجود ندارد"
            ),
        )

    new_username = (
        str(
            user["username"]
        )
        .strip()
        .lower()
    )

    if username_changed:

        new_username = (
            str(
                requested_username
            )
            .strip()
            .lower()
        )

        if (
            len(new_username) < 3
            or len(new_username) > 32
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    "نام کاربری باید "
                    "بین ۳ تا ۳۲ کاراکتر باشد"
                ),
            )

        if not re.fullmatch(
            r"[a-zA-Z0-9_.-]+",
            new_username,
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    "نام کاربری فقط می‌تواند "
                    "شامل حروف انگلیسی، عدد، "
                    "نقطه، خط تیره و زیرخط باشد"
                ),
            )

        existing = user_by_username(
            new_username
        )

        if (
            existing
            and int(
                existing["id"]
            )
            != int(
                user["id"]
            )
        ):

            raise HTTPException(
                status_code=409,
                detail=(
                    "این نام کاربری "
                    "قبلاً استفاده شده است"
                ),
            )

    hashed_password = None

    if password_changed:

        old_password = str(
            current_password
            or ""
        )

        new_password_value = str(
            new_password
            or ""
        )

        if not old_password:

            raise HTTPException(
                status_code=400,
                detail=(
                    "رمز عبور فعلی "
                    "را وارد کنید"
                ),
            )

        if len(new_password_value) < 6:

            raise HTTPException(
                status_code=400,
                detail=(
                    "رمز عبور جدید باید "
                    "حداقل ۶ کاراکتر باشد"
                ),
            )

        conn = db()

        row = conn.execute(
            """
            SELECT password
            FROM users
            WHERE id = ?
            """,
            (
                int(
                    user["id"]
                ),
            ),
        ).fetchone()

        conn.close()

        if (
            not row
            or not verify_password(
                old_password,
                row["password"],
            )
        ):

            raise HTTPException(
                status_code=401,
                detail=(
                    "رمز عبور فعلی اشتباه است"
                ),
            )

        hashed_password = (
            hash_password(
                new_password_value
            )
        )

    conn = db()

    try:

        if password_changed:

            conn.execute(
                """
                UPDATE users
                SET
                    username = ?,
                    password = ?
                WHERE id = ?
                """,
                (
                    new_username,
                    hashed_password,
                    int(
                        user["id"]
                    ),
                ),
            )

        else:

            conn.execute(
                """
                UPDATE users
                SET username = ?
                WHERE id = ?
                """,
                (
                    new_username,
                    int(
                        user["id"]
                    ),
                ),
            )

        conn.commit()

    except sqlite3.IntegrityError:

        conn.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "این نام کاربری "
                "قبلاً استفاده شده است"
            ),
        )

    finally:

        conn.close()

    updated = user_by_id(
        int(
            user["id"]
        )
    )

    return {
        "ok":
            True,

        "success":
            True,

        "message":
            "اطلاعات امنیتی با موفقیت تغییر کرد.",

        "user":
            public_user(
                updated
            ),
    }


@app.post(
    "/api/profile/avatar"
)
async def update_avatar(
    request: Request,
    file: UploadFile = File(...),
):

    user = require_user(
        request
    )

    extension = (
        Path(
            file.filename or ""
        )
        .suffix
        .lower()
    )

    if extension not in {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
    }:

        raise HTTPException(
            status_code=400,
            detail=(
                "فقط PNG، JPG، JPEG "
                "و WEBP مجاز است"
            ),
        )

    content = await file.read()

    if len(content) > MAX_AVATAR_SIZE:

        raise HTTPException(
            status_code=413,
            detail=(
                "حجم عکس نباید "
                "بیشتر از ۵ مگابایت باشد"
            ),
        )

    filename = (
        f"{user['id']}_"
        f"{secrets.token_hex(8)}"
        f"{extension}"
    )

    (
        UPLOADS_DIR
        / filename
    ).write_bytes(
        content
    )

    avatar_url = (
        f"/uploads/{filename}"
    )

    conn = db()

    conn.execute(
        """
        UPDATE users
        SET avatar = ?
        WHERE id = ?
        """,
        (
            avatar_url,
            int(
                user["id"]
            ),
        ),
    )

    conn.commit()
    conn.close()

    updated = user_by_id(
        int(
            user["id"]
        )
    )

    return {
        "ok":
            True,

        "avatar":
            avatar_url,

        "user":
            public_user(
                updated
            ),
    }


# =========================================================
# USERS
# =========================================================

@app.get(
    "/api/users"
)
def users(
    request: Request,
):

    user = require_user(
        request
    )

    query = (
        request.query_params
        .get(
            "q",
            "",
        )
        .strip()
        .lower()
    )

    conn = db()

    if query:

        pattern = (
            f"%{query}%"
        )

        rows = conn.execute(
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
            WHERE
                id != ?
                AND (
                    LOWER(username)
                    LIKE ?
                    OR
                    LOWER(display_name)
                    LIKE ?
                )
            ORDER BY
                display_name
                COLLATE NOCASE
            """,
            (
                int(
                    user["id"]
                ),
                pattern,
                pattern,
            ),
        ).fetchall()

    else:

        rows = conn.execute(
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
            WHERE id != ?
            ORDER BY
                display_name
                COLLATE NOCASE
            """,
            (
                int(
                    user["id"]
                ),
            ),
        ).fetchall()

    conn.close()

    online_ids = set(
        connections.keys()
    )

    result = []

    for row in rows:

        item = dict(
            row
        )

        item[
            "online"
        ] = (
            int(
                row["id"]
            )
            in online_ids
        )

        result.append(
            item
        )

    return result


# =========================================================
# MESSAGES
# =========================================================

@app.get(
    "/api/messages/{other_id}"
)
def get_messages(
    request: Request,
    other_id: int,
):

    user = require_user(
        request
    )

    if (
        other_id
        == int(
            user["id"]
        )
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "گفتگو با خودتان "
                "مجاز نیست"
            ),
        )

    if not user_by_id(
        other_id
    ):

        raise HTTPException(
            status_code=404,
            detail="کاربر پیدا نشد",
        )

    conn = db()

    rows = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE
            (
                sender_id = ?
                AND receiver_id = ?
            )
            OR
            (
                sender_id = ?
                AND receiver_id = ?
            )
        ORDER BY id ASC
        """,
        (
            int(
                user["id"]
            ),
            other_id,
            other_id,
            int(
                user["id"]
            ),
        ),
    ).fetchall()

    conn.close()

    return [
        dict(row)
        for row in rows
    ]


@app.post(
    "/api/messages"
)
async def create_message(
    request: Request,
):

    user = require_user(
        request
    )

    try:

        data = await request.json()

        receiver_id = int(
            data.get(
                "receiver_id"
            )
        )

    except (
        TypeError,
        ValueError,
        AttributeError,
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "گیرنده پیام نامعتبر است"
            ),
        )

    text = str(
        data.get(
            "text",
            "",
        )
        or ""
    ).strip()

    if not text:

        raise HTTPException(
            status_code=400,
            detail="پیام خالی است",
        )

    if len(text) > 5000:

        raise HTTPException(
            status_code=400,
            detail=(
                "پیام نمی‌تواند بیشتر "
                "از ۵۰۰۰ کاراکتر باشد"
            ),
        )

    if (
        receiver_id
        == int(
            user["id"]
        )
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "ارسال پیام به خودتان "
                "مجاز نیست"
            ),
        )

    if not user_by_id(
        receiver_id
    ):

        raise HTTPException(
            status_code=404,
            detail=(
                "کاربر گیرنده پیدا نشد"
            ),
        )

    conn = db()

    cursor = conn.execute(
        """
        INSERT INTO messages(
            sender_id,
            receiver_id,
            text,
            created_at
        )
        VALUES(
            ?,
            ?,
            ?,
            ?
        )
        """,
        (
            int(
                user["id"]
            ),
            receiver_id,
            text,
            now(),
        ),
    )

    conn.commit()

    row = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            int(
                cursor.lastrowid
            ),
        ),
    ).fetchone()

    conn.close()

    payload = dict(
        row
    )

    await broadcast(
        receiver_id,
        {
            "type":
                "message",

            "message":
                payload,
        },
    )

    return payload


@app.post(
    "/api/messages/{message_id}/edit"
)
async def edit_message(
    request: Request,
    message_id: int,
):

    user = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail=(
                "داده ویرایش نامعتبر است"
            ),
        )

    text = str(
        data.get(
            "text",
            "",
        )
        or ""
    ).strip()

    if not text:

        raise HTTPException(
            status_code=400,
            detail=(
                "متن جدید نمی‌تواند "
                "خالی باشد"
            ),
        )

    if len(text) > 5000:

        raise HTTPException(
            status_code=400,
            detail="پیام خیلی طولانی است",
        )

    conn = db()

    row = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            message_id,
        ),
    ).fetchone()

    if not row:

        conn.close()

        raise HTTPException(
            status_code=404,
            detail="پیام پیدا نشد",
        )

    if (
        int(
            row["sender_id"]
        )
        != int(
            user["id"]
        )
    ):

        conn.close()

        raise HTTPException(
            status_code=403,
            detail=(
                "اجازه ویرایش "
                "این پیام را ندارید"
            ),
        )

    if int(
        row["deleted"]
        or 0
    ) == 1:

        conn.close()

        raise HTTPException(
            status_code=400,
            detail=(
                "پیام حذف شده "
                "قابل ویرایش نیست"
            ),
        )

    conn.execute(
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

    conn.commit()

    updated = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            message_id,
        ),
    ).fetchone()

    conn.close()

    payload = dict(
        updated
    )

    receiver_id = payload.get(
        "receiver_id"
    )

    if receiver_id is not None:

        await broadcast(
            int(
                receiver_id
            ),
            {
                "type":
                    "message:update",

                "message":
                    payload,
            },
        )

    return payload


@app.delete(
    "/api/messages/{message_id}"
)
async def delete_message(
    request: Request,
    message_id: int,
):

    user = require_user(
        request
    )

    conn = db()

    row = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            message_id,
        ),
    ).fetchone()

    if not row:

        conn.close()

        raise HTTPException(
            status_code=404,
            detail="پیام پیدا نشد",
        )

    if (
        int(
            row["sender_id"]
        )
        != int(
            user["id"]
        )
    ):

        conn.close()

        raise HTTPException(
            status_code=403,
            detail=(
                "اجازه حذف "
                "این پیام را ندارید"
            ),
        )

    conn.execute(
        """
        UPDATE messages
        SET
            deleted = 1,
            text = '',
            file_name = '',
            file_url = ''
        WHERE id = ?
        """,
        (
            message_id,
        ),
    )

    conn.commit()

    updated = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            message_id,
        ),
    ).fetchone()

    conn.close()

    payload = dict(
        updated
    )

    receiver_id = payload.get(
        "receiver_id"
    )

    if receiver_id is not None:

        await broadcast(
            int(
                receiver_id
            ),
            {
                "type":
                    "message:update",

                "message":
                    payload,
            },
        )

    return payload


# =========================================================
# UPLOAD
# =========================================================

@app.post(
    "/api/upload"
)
async def upload(
    request: Request,
    receiver_id: int = Form(...),
    file: UploadFile = File(...),
):

    user = require_user(
        request
    )

    if (
        receiver_id
        == int(
            user["id"]
        )
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "نمی‌توانید فایل را "
                "برای خودتان ارسال کنید"
            ),
        )

    if not user_by_id(
        receiver_id
    ):

        raise HTTPException(
            status_code=404,
            detail=(
                "کاربر گیرنده پیدا نشد"
            ),
        )

    content = await file.read()

    if len(content) > MAX_UPLOAD_SIZE:

        raise HTTPException(
            status_code=413,
            detail=(
                "حداکثر اندازه فایل "
                "۱۰ مگابایت است"
            ),
        )

    original_name = (
        Path(
            file.filename
            or "file"
        ).name
        or "file"
    )

    extension = (
        Path(
            original_name
        )
        .suffix
        .lower()
    )

    allowed = {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".pdf",
        ".txt",
        ".csv",
        ".zip",
        ".rar",
        ".mp3",
        ".wav",
        ".ogg",
        ".webm",
        ".mp4",
        ".mov",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
    }

    if (
        extension
        and extension not in allowed
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "فرمت این فایل مجاز نیست"
            ),
        )

    filename = (
        f"{secrets.token_hex(8)}_"
        f"{original_name}"
    )

    (
        UPLOADS_DIR
        / filename
    ).write_bytes(
        content
    )

    file_url = (
        f"/uploads/{filename}"
    )

    mime_type = (
        file.content_type
        or mimetypes.guess_type(
            original_name
        )[0]
        or "application/octet-stream"
    )

    conn = db()

    cursor = conn.execute(
        """
        INSERT INTO messages(
            sender_id,
            receiver_id,
            text,
            file_name,
            file_url,
            mime_type,
            created_at
        )
        VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
        """,
        (
            int(
                user["id"]
            ),
            receiver_id,
            "",
            original_name,
            file_url,
            mime_type,
            now(),
        ),
    )

    conn.commit()

    row = conn.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            int(
                cursor.lastrowid
            ),
        ),
    ).fetchone()

    conn.close()

    payload = dict(
        row
    )

    await broadcast(
        receiver_id,
        {
            "type":
                "message",

            "message":
                payload,
        },
    )

    return payload


# =========================================================
# GROUP
# =========================================================

@app.post(
    "/api/groups"
)
async def create_group(
    request: Request,
):

    user = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail=(
                "داده گروه نامعتبر است"
            ),
        )

    name = str(
        data.get(
            "name",
            "",
        )
        or ""
    ).strip()

    if not name:

        raise HTTPException(
            status_code=400,
            detail=(
                "نام گروه الزامی است"
            ),
        )

    if len(name) > 80:

        raise HTTPException(
            status_code=400,
            detail=(
                "نام گروه خیلی طولانی است"
            ),
        )

    raw_members = data.get(
        "members",
        [],
    )

    members: set[int] = set()

    if isinstance(
        raw_members,
        list,
    ):

        for value in raw_members:

            try:

                member_id = int(
                    value
                )

            except (
                TypeError,
                ValueError,
            ):

                continue

            if (
                member_id
                != int(
                    user["id"]
                )
            ):

                members.add(
                    member_id
                )

    conn = db()

    cursor = conn.execute(
        """
        INSERT INTO groups(
            name,
            owner_id,
            created_at
        )
        VALUES(
            ?,
            ?,
            ?
        )
        """,
        (
            name,
            int(
                user["id"]
            ),
            now(),
        ),
    )

    group_id = int(
        cursor.lastrowid
    )

    conn.execute(
        """
        INSERT OR IGNORE INTO
        group_members(
            group_id,
            user_id
        )
        VALUES(
            ?,
            ?
        )
        """,
        (
            group_id,
            int(
                user["id"]
            ),
        ),
    )

    for member_id in members:

        if conn.execute(
            """
            SELECT id
            FROM users
            WHERE id = ?
            """,
            (
                member_id,
            ),
        ).fetchone():

            conn.execute(
                """
                INSERT OR IGNORE INTO
                group_members(
                    group_id,
                    user_id
                )
                VALUES(
                    ?,
                    ?
                )
                """,
                (
                    group_id,
                    member_id,
                ),
            )

    conn.commit()
    conn.close()

    return {
        "ok":
            True,

        "id":
            group_id,

        "name":
            name,
    }


# =========================================================
# WEBSOCKET
# =========================================================

@app.websocket(
    "/ws"
)
async def websocket_endpoint(
    websocket: WebSocket,
):

    await websocket.accept()

    ticket = websocket.cookies.get(
        "gapino_ws_ticket"
    )

    if not ticket:

        await websocket.close(
            code=4401,
            reason=(
                "Authentication required"
            ),
        )

        return

    uid = consume_ws_ticket(
        ticket
    )

    if (
        uid is None
        or not user_by_id(
            uid
        )
    ):

        await websocket.close(
            code=4401,
            reason=(
                "Invalid authentication"
            ),
        )

        return

    connections.setdefault(
        uid,
        set(),
    ).add(
        websocket
    )

    live_socket_peers.setdefault(
        websocket,
        set(),
    )

    try:

        await send_ws(
            websocket,
            {
                "type":
                    "ready",

                "online":
                    list(
                        connections.keys()
                    ),
            },
        )

        # Notify others
        for other_uid in list(
            connections.keys()
        ):

            if (
                int(
                    other_uid
                )
                != int(uid)
            ):

                await broadcast(
                    other_uid,
                    {
                        "type":
                            "user_online",

                        "user_id":
                            uid,
                    },
                )


        # =====================================================
        # MESSAGE LOOP
        # =====================================================

        while True:

            raw = (
                await websocket.receive_text()
            )

            try:

                data = json.loads(
                    raw
                )

            except json.JSONDecodeError:

                continue

            if not isinstance(
                data,
                dict,
            ):

                continue

            message_type = (
                str(
                    data.get(
                        "type",
                        "",
                    )
                )
                .strip()
                .lower()
            )


            # =================================================
            # PING
            # =================================================

            if message_type == "ping":

                await send_ws(
                    websocket,
                    {
                        "type":
                            "pong",
                    },
                )

                continue


            # =================================================
            # LIVE JOIN
            # =================================================

            if (
                message_type
                == "live_join"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                is_host = bool(
                    data.get(
                        "host",
                        False,
                    )
                )

                if (
                    not room_id
                    or not peer_id
                ):

                    await send_ws(
                        websocket,
                        {
                            "type":
                                "error",

                            "message":
                                "اطلاعات اتاق Live ناقص است",
                        },
                    )

                    continue


                # -------------------------------------------------
                # HOST JOIN
                # -------------------------------------------------

                if is_host:

                    room = live_rooms.get(
                        room_id
                    )

                    if room is None:

                        room = {
                            "room_id":
                                room_id,

                            "host_uid":
                                int(uid),

                            "host_peer_id":
                                peer_id,

                            "active":
                                False,

                            "created_at":
                                time.time(),

                            "peers": {
                                peer_id:
                                    int(uid)
                            },
                        }

                        live_rooms[
                            room_id
                        ] = room

                    else:

                        if (
                            int(
                                room[
                                    "host_uid"
                                ]
                            )
                            != int(uid)
                        ):

                            await send_ws(
                                websocket,
                                {
                                    "type":
                                        "error",

                                    "message":
                                        "این اتاق متعلق به کاربر دیگری است",
                                },
                            )

                            continue

                        room[
                            "host_peer_id"
                        ] = peer_id

                        room[
                            "peers"
                        ][
                            peer_id
                        ] = int(uid)

                    live_socket_peers[
                        websocket
                    ].add(
                        (
                            room_id,
                            peer_id,
                        )
                    )

                    await send_ws(
                        websocket,
                        {
                            "type":
                                "live_room_ready",

                            "room_id":
                                room_id,

                            "peer_id":
                                peer_id,

                            "host":
                                True,

                            "count":
                                live_peer_count(
                                    room
                                ),
                        },
                    )

                    await send_live_viewer_count(
                        room
                    )

                    continue


                # -------------------------------------------------
                # VIEWER JOIN
                # -------------------------------------------------

                room = live_rooms.get(
                    room_id
                )

                if (
                    room is None
                    or not room.get(
                        "active",
                        False,
                    )
                ):

                    await send_ws(
                        websocket,
                        {
                            "type":
                                "error",

                            "message":
                                "این پخش زنده وجود ندارد یا پایان یافته است",
                        },
                    )

                    continue

                room[
                    "peers"
                ][
                    peer_id
                ] = int(uid)

                live_socket_peers[
                    websocket
                ].add(
                    (
                        room_id,
                        peer_id,
                    )
                )

                host_user = (
                    live_host_user(
                        room
                    )
                )

                await send_ws(
                    websocket,
                    {
                        "type":
                            "live_started",

                        "room_id":
                            room_id,

                        "host":
                            True,

                        "host_user":
                            (
                                public_user(
                                    host_user
                                )
                                if host_user
                                else None
                            ),

                        "count":
                            live_peer_count(
                                room
                            ),
                    },
                )

                # Notify host about new viewer
                await send_live_to_uid(
                    int(
                        room[
                            "host_uid"
                        ]
                    ),
                    {
                        "type":
                            "live_peer_join",

                        "room_id":
                            room_id,

                        "peer_id":
                            peer_id,

                        "user_id":
                            int(uid),
                    },
                )

                await send_live_viewer_count(
                    room
                )

                continue


            # =================================================
            # LIVE START
            # =================================================

            if (
                message_type
                == "live_start"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                if (
                    not room_id
                    or not peer_id
                ):
                    continue

                room = live_rooms.get(
                    room_id
                )

                if room is None:

                    room = {
                        "room_id":
                            room_id,

                        "host_uid":
                            int(uid),

                        "host_peer_id":
                            peer_id,

                        "active":
                            True,

                        "created_at":
                            time.time(),

                        "peers": {
                            peer_id:
                                int(uid)
                        },
                    }

                    live_rooms[
                        room_id
                    ] = room

                if (
                    int(
                        room[
                            "host_uid"
                        ]
                    )
                    != int(uid)
                ):

                    continue

                room[
                    "active"
                ] = True

                room[
                    "host_peer_id"
                ] = peer_id

                room[
                    "peers"
                ][
                    peer_id
                ] = int(uid)

                user = user_by_id(
                    int(uid)
                )

                await broadcast_live_room(
                    room,
                    {
                        "type":
                            "live_started",

                        "room_id":
                            room_id,

                        "host":
                            True,

                        "host_user":
                            (
                                public_user(
                                    user
                                )
                                if user
                                else None
                            ),

                        "count":
                            live_peer_count(
                                room
                            ),
                    },
                )

                await send_live_viewer_count(
                    room
                )

                continue


            # =================================================
            # LIVE STOP
            # =================================================

            if (
                message_type
                == "live_stop"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:
                    continue

                if (
                    int(
                        room[
                            "host_uid"
                        ]
                    )
                    != int(uid)
                ):

                    continue

                await broadcast_live_room(
                    room,
                    {
                        "type":
                            "live_stopped",

                        "room_id":
                            room_id,

                        "reason":
                            "host_stopped",
                    },
                )

                live_rooms.pop(
                    room_id,
                    None,
                )

                # Remove room references
                for (
                    ws,
                    peer_set,
                ) in list(
                    live_socket_peers.items()
                ):

                    filtered = {
                        item
                        for item
                        in peer_set
                        if item[0]
                        != room_id
                    }

                    if filtered:

                        live_socket_peers[
                            ws
                        ] = filtered

                    else:

                        live_socket_peers.pop(
                            ws,
                            None,
                        )

                continue


            # =================================================
            # LIVE LEAVE
            # =================================================

            if (
                message_type
                == "live_leave"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if room:

                    await remove_live_peer(
                        room_id,
                        peer_id,
                        notify=True,
                    )

                live_socket_peers[
                    websocket
                ].discard(
                    (
                        room_id,
                        peer_id,
                    )
                )

                continue


            # =================================================
            # LIVE OFFER / ANSWER
            # =================================================

            if message_type in {
                "live_offer",
                "live_answer",
            }:

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                target_peer_id = str(
                    data.get(
                        "target_peer_id",
                        "",
                    )
                    or ""
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:

                    continue

                if (
                    peer_id not in
                    room[
                        "peers"
                    ]
                ):

                    continue

                if (
                    target_peer_id
                    not in room[
                        "peers"
                    ]
                ):

                    continue

                sender_uid = live_peer_uid(
                    room,
                    peer_id,
                )

                if (
                    sender_uid
                    != int(uid)
                ):

                    continue

                receiver_uid = live_peer_uid(
                    room,
                    target_peer_id,
                )

                if receiver_uid is None:
                    continue

                payload = dict(
                    data
                )

                payload[
                    "sender_id"
                ] = int(uid)

                await send_live_to_uid(
                    receiver_uid,
                    payload,
                )

                continue


            # =================================================
            # LIVE ICE
            # =================================================

            if (
                message_type
                == "live_ice"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                target_peer_id = str(
                    data.get(
                        "target_peer_id",
                        "",
                    )
                    or ""
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:
                    continue

                if (
                    peer_id not in
                    room[
                        "peers"
                    ]
                ):

                    continue

                if (
                    target_peer_id
                    not in room[
                        "peers"
                    ]
                ):

                    continue

                sender_uid = live_peer_uid(
                    room,
                    peer_id,
                )

                if (
                    sender_uid
                    != int(uid)
                ):

                    continue

                receiver_uid = live_peer_uid(
                    room,
                    target_peer_id,
                )

                if receiver_uid is None:
                    continue

                payload = dict(
                    data
                )

                payload[
                    "sender_id"
                ] = int(uid)

                await send_live_to_uid(
                    receiver_uid,
                    payload,
                )

                continue


            # =================================================
            # LIVE CHAT
            # =================================================

            if (
                message_type
                == "live_chat"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                message = str(
                    data.get(
                        "message",
                        "",
                    )
                    or ""
                ).strip()

                if not message:
                    continue

                if len(message) > MAX_LIVE_CHAT_LENGTH:

                    message = message[
                        :MAX_LIVE_CHAT_LENGTH
                    ]

                room = live_rooms.get(
                    room_id
                )

                if not room:
                    continue

                if (
                    peer_id not in
                    room[
                        "peers"
                    ]
                ):

                    continue

                sender_uid = live_peer_uid(
                    room,
                    peer_id,
                )

                if (
                    sender_uid
                    != int(uid)
                ):

                    continue

                user = user_by_id(
                    int(uid)
                )

                await broadcast_live_room(
                    room,
                    {
                        "type":
                            "live_chat",

                        "room_id":
                            room_id,

                        "peer_id":
                            peer_id,

                        "user_id":
                            int(uid),

                        "username":
                            (
                                user[
                                    "display_name"
                                ]
                                if user
                                else "کاربر"
                            ),

                        "avatar":
                            (
                                user[
                                    "avatar"
                                ]
                                if user
                                else ""
                            ),

                        "message":
                            message,

                        "created_at":
                            now(),
                    },
                )

                continue


            # =================================================
            # LIVE MEDIA STATE
            # =================================================

            if (
                message_type
                == "live_media_state"
            ):

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                    or ""
                ).strip()

                peer_id = str(
                    data.get(
                        "peer_id",
                        "",
                    )
                    or ""
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:
                    continue

                if (
                    peer_id not in
                    room[
                        "peers"
                    ]
                ):

                    continue

                sender_uid = live_peer_uid(
                    room,
                    peer_id,
                )

                if (
                    sender_uid
                    != int(uid)
                ):

                    continue

                await broadcast_live_room(
                    room,
                    {
                        "type":
                            "live_media_state",

                        "room_id":
                            room_id,

                        "peer_id":
                            peer_id,

                        "media":
                            data.get(
                                "media"
                            ),

                        "enabled":
                            bool(
                                data.get(
                                    "enabled",
                                    False,
                                )
                            ),
                    },
                    exclude_peer_id=peer_id,
                )

                continue


            # =================================================
            # CALL SIGNALING
            # =================================================

            if message_type in {
                "call_offer",
                "call_answer",
                "call_ice",
                "call_reject",
                "call_busy",
                "call_end",
            }:

                try:

                    receiver_id = int(
                        data.get(
                            "receiver_id"
                        )
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                if (
                    receiver_id
                    == int(uid)
                    or not user_by_id(
                        receiver_id
                    )
                ):

                    continue

                payload = dict(
                    data
                )

                payload[
                    "sender_id"
                ] = int(uid)

                await broadcast(
                    receiver_id,
                    payload,
                )

                continue


            # =================================================
            # TYPING
            # =================================================

            if message_type == "typing":

                try:

                    target_id = int(
                        data.get(
                            "receiver_id",
                            data.get(
                                "to"
                            ),
                        )
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                if (
                    target_id
                    == int(uid)
                    or not user_by_id(
                        target_id
                    )
                ):

                    continue

                await broadcast(
                    target_id,
                    {
                        "type":
                            "typing",

                        "from":
                            uid,

                        "sender_id":
                            uid,

                        "value":
                            bool(
                                data.get(
                                    "value",
                                    False,
                                )
                            ),
                    },
                )

                continue


            # =================================================
            # NORMAL MESSAGE
            # =================================================

            if message_type in {
                "message",
                "send_message",
            }:

                try:

                    receiver_id = int(
                        data.get(
                            "receiver_id",
                            data.get(
                                "to"
                            ),
                        )
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                text = str(
                    data.get(
                        "text",
                        "",
                    )
                    or ""
                ).strip()

                if (
                    not text
                    or len(text) > 5000
                    or receiver_id
                    == int(uid)
                    or not user_by_id(
                        receiver_id
                    )
                ):

                    continue

                conn = db()

                cursor = conn.execute(
                    """
                    INSERT INTO messages(
                        sender_id,
                        receiver_id,
                        text,
                        created_at
                    )
                    VALUES(
                        ?,
                        ?,
                        ?,
                        ?
                    )
                    """,
                    (
                        uid,
                        receiver_id,
                        text,
                        now(),
                    ),
                )

                conn.commit()

                row = conn.execute(
                    """
                    SELECT *
                    FROM messages
                    WHERE id = ?
                    """,
                    (
                        int(
                            cursor.lastrowid
                        ),
                    ),
                ).fetchone()

                conn.close()

                if row:

                    outgoing = {
                        "type":
                            "message",

                        "message":
                            dict(
                                row
                            ),
                    }

                    await broadcast(
                        receiver_id,
                        outgoing,
                    )

                    await send_ws(
                        websocket,
                        outgoing,
                    )

                continue


            # =================================================
            # ONLINE
            # =================================================

            if message_type in {
                "online",
                "online_users",
            }:

                await send_ws(
                    websocket,
                    {
                        "type":
                            "ready",

                        "online":
                            list(
                                connections.keys()
                            ),
                    },
                )

                continue


    except WebSocketDisconnect:

        pass

    except Exception as exc:

        print(
            "WebSocket error:",
            repr(exc),
        )

    finally:

        # -------------------------------------------------
        # Normal WebSocket cleanup
        # -------------------------------------------------

        sockets = connections.get(
            uid,
            set(),
        )

        sockets.discard(
            websocket
        )

        if not sockets:

            connections.pop(
                uid,
                None,
            )


        # -------------------------------------------------
        # Live cleanup
        # -------------------------------------------------

        live_items = list(
            live_socket_peers.get(
                websocket,
                set(),
            )
        )

        for (
            room_id,
            peer_id,
        ) in live_items:

            try:

                await remove_live_peer(
                    room_id,
                    peer_id,
                    notify=True,
                )

            except Exception as exc:

                print(
                    "LIVE cleanup error:",
                    repr(exc),
                )

        live_socket_peers.pop(
            websocket,
            None,
        )


        # -------------------------------------------------
        # Offline notification
        # -------------------------------------------------

        if uid not in connections:

            for other_uid in list(
                connections.keys()
            ):

                try:

                    await broadcast(
                        other_uid,
                        {
                            "type":
                                "user_offline",

                            "user_id":
                                uid,
                        },
                    )

                except Exception:

                    pass
