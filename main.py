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
    Response,
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
# GAPINO PRO
# =========================================================

APP_NAME = "GAPINO Pro"
APP_VERSION = "1.0.0"

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "gapino.db"

FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_SIZE = 10 * 1024 * 1024
MAX_AVATAR_SIZE = 5 * 1024 * 1024

PBKDF2_ITERATIONS = 210_000

SESSION_SECRET = os.getenv(
    "GAPINO_SESSION_SECRET",
    "CHANGE_THIS_SECRET_IN_PRODUCTION",
)

COOKIE_SECURE = (
    os.getenv(
        "GAPINO_COOKIE_SECURE",
        "true",
    ).lower()
    == "true"
)

SESSION_MAX_AGE = 60 * 60 * 24 * 365


# =========================================================
# APP
# =========================================================

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
)

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="gapino_session",
    max_age=SESSION_MAX_AGE,
    same_site="lax",
    https_only=COOKIE_SECURE,
)


# =========================================================
# STATIC
# =========================================================

app.mount(
    "/static",
    StaticFiles(
        directory=str(FRONTEND_DIR),
    ),
    name="static",
)

app.mount(
    "/uploads",
    StaticFiles(
        directory=str(UPLOADS_DIR),
    ),
    name="uploads",
)


# =========================================================
# RUNTIME
# =========================================================

active_connections: dict[int, set[WebSocket]] = {}
websocket_tickets: dict[str, int] = {}
live_rooms: dict[str, dict] = {}


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
            PRIMARY KEY (
                group_id,
                user_id
            )
        );

        CREATE TABLE IF NOT EXISTS reactions (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY (
                message_id,
                user_id,
                emoji
            )
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
    return datetime.now(
        timezone.utc
    ).isoformat()


# =========================================================
# PASSWORD
# =========================================================

def hash_password(
    password: str,
) -> str:

    salt = secrets.token_bytes(
        16
    )

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )

    return (
        "$pbkdf2$"
        + salt.hex()
        + "$"
        + digest.hex()
    )


def verify_pbkdf2_password(
    password: str,
    stored_password: str,
) -> bool:

    try:

        parts = stored_password.split("$")

        if len(parts) != 4:
            return False

        if parts[1].lower() != "pbkdf2":
            return False

        salt = bytes.fromhex(
            parts[2]
        )

        calculated = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            PBKDF2_ITERATIONS,
        )

        return hmac.compare_digest(
            calculated.hex().lower(),
            parts[3].strip().lower(),
        )

    except Exception:

        return False


def verify_pbkdf2_legacy_password(
    password: str,
    stored_password: str,
) -> bool:

    try:

        value = stored_password.strip()

        if value.startswith(
            "$pbkdf2$"
        ):

            return verify_pbkdf2_password(
                password,
                value,
            )

        if value.startswith(
            "pbkdf2$"
        ):

            parts = value.split("$")

            if len(parts) != 3:
                return False

            salt = bytes.fromhex(
                parts[1]
            )

            calculated = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt,
                PBKDF2_ITERATIONS,
            )

            return hmac.compare_digest(
                calculated.hex().lower(),
                parts[2].strip().lower(),
            )

    except Exception:

        return False

    return False


def verify_argon2_password(
    password: str,
    stored_password: str,
) -> bool:

    try:

        from pwdlib import PasswordHash

        password_hash = PasswordHash()

        return bool(
            password_hash.verify(
                password,
                stored_password,
            )
        )

    except Exception:

        pass

    try:

        from argon2 import PasswordHasher

        password_hasher = PasswordHasher()

        password_hasher.verify(
            stored_password,
            password,
        )

        return True

    except Exception:

        return False


def verify_bcrypt_password(
    password: str,
    stored_password: str,
) -> bool:

    try:

        import bcrypt

        return bool(
            bcrypt.checkpw(
                password.encode("utf-8"),
                stored_password.encode("utf-8"),
            )
        )

    except Exception:

        return False


def verify_sha256_password(
    password: str,
    stored_password: str,
) -> bool:

    value = stored_password.strip()
    digest = None

    if value.lower().startswith(
        "sha256:"
    ):

        digest = value.split(
            ":",
            1,
        )[1].strip().lower()

    elif value.lower().startswith(
        "sha256$"
    ):

        digest = value.split(
            "$",
            1,
        )[1].strip().lower()

    elif (
        len(value) == 64
        and all(
            c in "0123456789abcdefABCDEF"
            for c in value
        )
    ):

        digest = value.lower()

    if not digest:
        return False

    if len(digest) != 64:
        return False

    try:

        calculated = hashlib.sha256(
            password.encode("utf-8")
        ).hexdigest().lower()

        return hmac.compare_digest(
            calculated,
            digest,
        )

    except Exception:

        return False


def looks_like_hash(
    value: str,
) -> bool:

    value = value.strip().lower()

    prefixes = (
        "$pbkdf2$",
        "pbkdf2$",
        "$argon2",
        "$2a$",
        "$2b$",
        "$2y$",
        "$2$",
        "sha256:",
        "sha256$",
    )

    if value.startswith(
        prefixes
    ):
        return True

    if len(value) in (
        32,
        40,
        64,
    ):

        try:

            int(value, 16)
            return True

        except Exception:

            pass

    return False


def verify_password(
    password: str,
    stored_password: str,
) -> bool:

    if stored_password is None:
        return False

    stored_password = str(
        stored_password
    )

    if not stored_password:
        return False

    if stored_password.startswith(
        "$pbkdf2$"
    ):

        return verify_pbkdf2_password(
            password,
            stored_password,
        )

    if stored_password.startswith(
        "pbkdf2$"
    ):

        return verify_pbkdf2_legacy_password(
            password,
            stored_password,
        )

    if stored_password.startswith(
        "$argon2"
    ):

        return verify_argon2_password(
            password,
            stored_password,
        )

    if stored_password.startswith(
        (
            "$2a$",
            "$2b$",
            "$2y$",
            "$2$",
        )
    ):

        return verify_bcrypt_password(
            password,
            stored_password,
        )

    if verify_sha256_password(
        password,
        stored_password,
    ):

        return True

    if not looks_like_hash(
        stored_password
    ):

        return hmac.compare_digest(
            password,
            stored_password,
        )

    return False


def password_needs_upgrade(
    stored_password: str,
) -> bool:

    if not stored_password:
        return False

    return not stored_password.startswith(
        "$pbkdf2$"
    )


# =========================================================
# REQUEST DATA
# =========================================================

async def read_request_data(
    request: Request,
) -> dict:

    content_type = (
        request.headers.get(
            "content-type",
            "",
        )
        .lower()
    )

    if "application/json" in content_type:

        try:

            data = await request.json()

        except Exception:

            raise HTTPException(
                status_code=400,
                detail="داده ارسالی نامعتبر است.",
            )

        if not isinstance(
            data,
            dict,
        ):

            raise HTTPException(
                status_code=400,
                detail="داده ارسالی نامعتبر است.",
            )

        return data

    try:

        form = await request.form()

        return dict(form)

    except Exception:

        raise HTTPException(
            status_code=400,
            detail="فرم ارسالی نامعتبر است.",
        )


def clean_username(
    value: object,
) -> str:

    return str(
        value or ""
    ).strip().lower()


def clean_password(
    value: object,
) -> str:

    return str(
        value or ""
    )


# =========================================================
# USER HELPERS
# =========================================================

PUBLIC_FIELDS = (
    "id",
    "username",
    "display_name",
    "bio",
    "avatar",
    "status",
)


def public_user(
    user: dict,
) -> dict:

    return {
        key: user.get(key)
        for key in PUBLIC_FIELDS
    }


def get_current_user(
    request: Request,
) -> Optional[dict]:

    raw_id = request.session.get(
        "uid"
    )

    if raw_id is None:
        return None

    try:

        user_id = int(
            raw_id
        )

    except (
        TypeError,
        ValueError,
    ):

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
        (
            user_id,
        ),
    ).fetchone()

    connection.close()

    if row is None:
        return None

    return dict(row)


def require_user(
    request: Request,
) -> dict:

    user = get_current_user(
        request
    )

    if not user:

        raise HTTPException(
            status_code=401,
            detail="نیاز به ورود دارید.",
        )

    return user


# =========================================================
# WEBSOCKET TICKETS
# =========================================================

def create_ws_ticket(
    user_id: int,
) -> str:

    ticket = secrets.token_urlsafe(
        32
    )

    websocket_tickets[
        ticket
    ] = int(user_id)

    return ticket


def get_user_from_ticket(
    ticket: str,
) -> Optional[int]:

    if not ticket:
        return None

    value = websocket_tickets.get(
        ticket
    )

    if value is None:
        return None

    try:

        return int(value)

    except (
        TypeError,
        ValueError,
    ):

        return None


def remove_user_tickets(
    user_id: int,
) -> None:

    for ticket, owner_id in list(
        websocket_tickets.items()
    ):

        try:

            if int(owner_id) == int(
                user_id
            ):

                websocket_tickets.pop(
                    ticket,
                    None,
                )

        except (
            TypeError,
            ValueError,
        ):

            websocket_tickets.pop(
                ticket,
                None,
            )


def cleanup_tickets() -> None:

    if len(
        websocket_tickets
    ) > 10000:

        websocket_tickets.clear()


# =========================================================
# FILE HELPERS
# =========================================================

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
}

AUDIO_EXTENSIONS = {
    ".webm",
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
}

FILE_EXTENSIONS = {
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


def safe_filename(
    filename: str,
) -> str:

    cleaned = Path(
        filename
    ).name

    return cleaned or "file"


def allowed_upload(
    filename: str,
) -> bool:

    extension = Path(
        filename
    ).suffix.lower()

    return (
        extension in IMAGE_EXTENSIONS
        or extension in AUDIO_EXTENSIONS
        or extension in FILE_EXTENSIONS
    )


# =========================================================
# LIVE HELPERS
# =========================================================

def live_public_list() -> list[dict]:

    result = []

    for room_id, room in live_rooms.items():

        viewers = room.get(
            "viewers",
            set(),
        )

        result.append(
            {
                "room_id": room_id,
                "title": room.get(
                    "title",
                    "پخش زنده GAPINO",
                ),
                "host_id": int(
                    room.get(
                        "host_id",
                        0,
                    )
                ),
                "viewer_count": len(
                    viewers
                ),
            }
        )

    return result


async def send_to_user(
    user_id: int,
    payload: dict,
) -> None:

    sockets = active_connections.get(
        int(user_id),
        set(),
    )

    if not sockets:
        return

    message = json.dumps(
        payload,
        ensure_ascii=False,
    )

    dead = []

    for websocket in list(
        sockets
    ):

        try:

            await websocket.send_text(
                message
            )

        except Exception:

            dead.append(
                websocket
            )

    for websocket in dead:

        sockets.discard(
            websocket
        )


async def broadcast_live_list() -> None:

    payload = {
        "type": "live_list",
        "streams": live_public_list(),
    }

    for user_id in list(
        active_connections.keys()
    ):

        await send_to_user(
            int(user_id),
            payload,
        )


async def end_live_room(
    room_id: str,
) -> None:

    room = live_rooms.pop(
        room_id,
        None,
    )

    if not room:
        return

    recipients = set(
        room.get(
            "viewers",
            set(),
        )
    )

    recipients.add(
        int(
            room.get(
                "host_id",
                0,
            )
        )
    )

    payload = {
        "type": "live_stopped",
        "room_id": room_id,
    }

    for user_id in recipients:

        await send_to_user(
            int(user_id),
            payload,
        )

    await broadcast_live_list()


# =========================================================
# PROFILE BROADCAST
# =========================================================

async def broadcast_profile_update(
    user_id: int,
) -> None:

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
        (
            int(user_id),
        ),
    ).fetchone()

    connection.close()

    if row is None:
        return

    payload = {
        "type": "profile_updated",
        "user": dict(row),
    }

    for target_id in list(
        active_connections.keys()
    ):

        await send_to_user(
            int(target_id),
            payload,
        )


# =========================================================
# HTML PAGES
# =========================================================

@app.get(
    "/",
    response_class=HTMLResponse,
)
def root(
    request: Request,
):

    user = get_current_user(
        request
    )

    if user:

        chat = (
            FRONTEND_DIR /
            "chat.html"
        )

        if chat.exists():

            return FileResponse(
                chat,
                media_type="text/html",
            )

    index = (
        FRONTEND_DIR /
        "index.html"
    )

    if index.exists():

        return FileResponse(
            index,
            media_type="text/html",
        )

    login = (
        FRONTEND_DIR /
        "login.html"
    )

    if login.exists():

        return FileResponse(
            login,
            media_type="text/html",
        )

    return HTMLResponse(
        """
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
        <head>
            <meta charset="utf-8">
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
            >
            <title>گپینو | GAPINO</title>
        </head>
        <body>
            <h1>GAPINO Pro</h1>
        </body>
        </html>
        """
    )


@app.get(
    "/index.html",
    response_class=HTMLResponse,
)
def index_page():

    path = (
        FRONTEND_DIR /
        "index.html"
    )

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

    path = (
        FRONTEND_DIR /
        "login.html"
    )

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
def chat_page(
    request: Request,
):

    require_user(
        request
    )

    path = (
        FRONTEND_DIR /
        "chat.html"
    )

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
def profile_page(
    request: Request,
):

    require_user(
        request
    )

    path = (
        FRONTEND_DIR /
        "profile.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail="profile.html پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/html",
    )


@app.get(
    "/live.html",
    response_class=HTMLResponse,
)
def live_page(
    request: Request,
):

    require_user(
        request
    )

    path = (
        FRONTEND_DIR /
        "live.html"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail="live.html پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/html",
    )


# =========================================================
# SEO
# =========================================================

@app.get(
    "/robots.txt"
)
def robots_txt():

    path = (
        FRONTEND_DIR /
        "robots.txt"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail="robots.txt پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="text/plain",
    )


@app.get(
    "/sitemap.xml"
)
def sitemap_xml():

    path = (
        FRONTEND_DIR /
        "sitemap.xml"
    )

    if not path.exists():

        raise HTTPException(
            status_code=404,
            detail="sitemap.xml پیدا نشد.",
        )

    return FileResponse(
        path,
        media_type="application/xml",
    )


# =========================================================
# FAVICON
# =========================================================

@app.get(
    "/favicon.ico"
)
def favicon():

    ico = (
        FRONTEND_DIR /
        "favicon.ico"
    )

    png = (
        FRONTEND_DIR /
        "favicon.png"
    )

    if ico.exists():

        return FileResponse(
            ico,
            media_type="image/x-icon",
        )

    if png.exists():

        return FileResponse(
            png,
            media_type="image/png",
        )

    return Response(
        status_code=204
    )


# =========================================================
# HEALTH
# =========================================================

@app.get(
    "/health"
)
def health():

    return {
        "ok": True,
        "app": APP_NAME,
        "version": APP_VERSION,
        "time": now_iso(),
        "users_online": len(
            active_connections
        ),
        "live_streams": len(
            live_rooms
        ),
        "session_max_age":
            SESSION_MAX_AGE,
    }


# =========================================================
# REGISTER
# =========================================================

@app.post(
    "/api/register"
)
@app.post(
    "/register"
)
async def register(
    request: Request,
):

    data = await read_request_data(
        request
    )

    username = clean_username(
        data.get(
            "username",
            data.get(
                "user",
                "",
            ),
        )
    )

    password = clean_password(
        data.get(
            "password",
            data.get(
                "pass",
                "",
            ),
        )
    )

    display_name = str(
        data.get(
            "display_name",
            data.get(
                "name",
                "",
            ),
        )
        or ""
    ).strip()

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

    if len(password) > 200:

        raise HTTPException(
            status_code=400,
            detail="رمز عبور بیش از حد طولانی است.",
        )

    display_name = (
        display_name or username
    )

    if len(display_name) > 60:

        raise HTTPException(
            status_code=400,
            detail="نام نمایشی بیش از حد طولانی است.",
        )

    connection = get_db()

    existing = connection.execute(
        """
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
        """,
        (
            username,
        ),
    ).fetchone()

    if existing is not None:

        connection.close()

        raise HTTPException(
            status_code=409,
            detail="این نام کاربری قبلاً ثبت شده است.",
        )

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
                hash_password(
                    password
                ),
                display_name,
                now_iso(),
            ),
        )

        connection.commit()

        user_id = int(
            cursor.lastrowid
        )

    except sqlite3.IntegrityError:

        connection.rollback()
        connection.close()

        raise HTTPException(
            status_code=409,
            detail="این نام کاربری قبلاً ثبت شده است.",
        )

    finally:

        try:
            connection.close()
        except Exception:
            pass

    request.session.clear()
    request.session["uid"] = user_id

    remove_user_tickets(
        user_id
    )

    ticket = create_ws_ticket(
        user_id
    )

    user = {
        "id":
            user_id,
        "username":
            username,
        "display_name":
            display_name,
        "bio":
            "",
        "avatar":
            "",
        "status":
            "در دسترس",
    }

    response = JSONResponse(
        {
            "ok":
                True,
            "user":
                public_user(user),
        }
    )

    response.set_cookie(
        key="gapino_ws_ticket",
        value=ticket,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
        path="/",
    )

    return response


# =========================================================
# LOGIN
# =========================================================

@app.post(
    "/api/login"
)
@app.post(
    "/login"
)
async def login(
    request: Request,
):

    data = await read_request_data(
        request
    )

    username = clean_username(
        data.get(
            "username",
            data.get(
                "user",
                "",
            ),
        )
    )

    password = clean_password(
        data.get(
            "password",
            data.get(
                "pass",
                "",
            ),
        )
    )

    if not username:

        raise HTTPException(
            status_code=400,
            detail="نام کاربری را وارد کنید.",
        )

    if not password:

        raise HTTPException(
            status_code=400,
            detail="رمز عبور را وارد کنید.",
        )

    connection = get_db()

    row = connection.execute(
        """
        SELECT *
        FROM users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
        """,
        (
            username,
        ),
    ).fetchone()

    if row is None:

        connection.close()

        raise HTTPException(
            status_code=401,
            detail="نام کاربری یا رمز عبور نادرست است.",
        )

    user = dict(row)

    stored_password = str(
        user.get(
            "password",
            "",
        )
    )

    valid_password = verify_password(
        password,
        stored_password,
    )

    if not valid_password:

        connection.close()

        raise HTTPException(
            status_code=401,
            detail="نام کاربری یا رمز عبور نادرست است.",
        )

    # -----------------------------------------------------
    # ارتقای خودکار رمز قدیمی
    # -----------------------------------------------------

    if password_needs_upgrade(
        stored_password
    ):

        new_password = hash_password(
            password
        )

        connection.execute(
            """
            UPDATE users
            SET password = ?
            WHERE id = ?
            """,
            (
                new_password,
                int(user["id"]),
            ),
        )

        connection.commit()

        # این خط عمداً در یک خط است
        user["password"] = new_password

    connection.close()

    user_id = int(
        user["id"]
    )

    request.session.clear()

    request.session["uid"] = user_id

    remove_user_tickets(
        user_id
    )

    ticket = create_ws_ticket(
        user_id
    )

    response = JSONResponse(
        {
            "ok":
                True,
            "user":
                public_user(user),
        }
    )

    response.set_cookie(
        key="gapino_ws_ticket",
        value=ticket,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
        path="/",
    )

    return response


# =========================================================
# LOGOUT
# =========================================================

@app.post(
    "/api/logout"
)
@app.post(
    "/logout"
)
async def logout(
    request: Request,
):

    raw_user_id = request.session.get(
        "uid"
    )

    try:

        user_id = (
            int(raw_user_id)
            if raw_user_id is not None
            else None
        )

    except (
        TypeError,
        ValueError,
    ):

        user_id = None

    request.session.clear()

    if user_id is not None:

        remove_user_tickets(
            user_id
        )

        for room_id, room in list(
            live_rooms.items()
        ):

            if int(
                room.get(
                    "host_id",
                    0,
                )
            ) == user_id:

                await end_live_room(
                    room_id
                )

        sockets = active_connections.pop(
            user_id,
            set(),
        )

        for websocket in list(
            sockets
        ):

            try:

                await websocket.close()

            except Exception:
                pass

        for other_id in list(
            active_connections.keys()
        ):

            await send_to_user(
                int(other_id),
                {
                    "type":
                        "user_offline",
                    "user_id":
                        user_id,
                },
            )

    response = JSONResponse(
        {
            "ok": True
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
# CURRENT USER
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

    cleanup_tickets()

    current_ticket = request.cookies.get(
        "gapino_ws_ticket"
    )

    current_ticket_user = (
        get_user_from_ticket(
            current_ticket or ""
        )
    )

    if current_ticket_user == int(
        user["id"]
    ):

        ticket = current_ticket

    else:

        remove_user_tickets(
            int(user["id"])
        )

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
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
        path="/",
    )

    return response


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
            detail="داده پروفایل نامعتبر است.",
        )

    if not isinstance(
        data,
        dict,
    ):

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

    if len(status) > 100:

        raise HTTPException(
            status_code=400,
            detail="وضعیت بیش از حد طولانی است.",
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
        (
            int(user["id"]),
        ),
    ).fetchone()

    connection.close()

    if row is None:

        raise HTTPException(
            status_code=404,
            detail="کاربر پیدا نشد.",
        )

    await broadcast_profile_update(
        int(user["id"])
    )

    return {
        "ok": True,
        "user": dict(row),
    }


# =========================================================
# AVATAR
# =========================================================

@app.post(
    "/api/profile/avatar"
)
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
):

    user = require_user(
        request
    )

    filename = safe_filename(
        file.filename or "avatar"
    )

    extension = Path(
        filename
    ).suffix.lower()

    if extension not in IMAGE_EXTENSIONS:

        raise HTTPException(
            status_code=400,
            detail="فرمت تصویر مجاز نیست.",
        )

    content = await file.read()

    if len(content) > MAX_AVATAR_SIZE:

        raise HTTPException(
            status_code=413,
            detail="حداکثر اندازه تصویر ۵ مگابایت است.",
        )

    stored_name = (
        f"{user['id']}_"
        f"{secrets.token_hex(8)}"
        f"{extension}"
    )

    path = (
        UPLOADS_DIR /
        stored_name
    )

    path.write_bytes(
        content
    )

    avatar_url = (
        f"/uploads/{stored_name}"
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

    await broadcast_profile_update(
        int(user["id"])
    )

    return {
        "ok":
            True,
        "avatar":
            avatar_url,
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

    current = require_user(
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
                    OR
                    LOWER(display_name) LIKE ?
                  )
            ORDER BY
                display_name COLLATE NOCASE
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
            ORDER BY
                display_name COLLATE NOCASE
            """,
            (
                int(current["id"]),
            ),
        ).fetchall()

    connection.close()

    online_ids = set(
        active_connections.keys()
    )

    return [
        {
            **dict(row),
            "online":
                int(row["id"])
                in online_ids,
        }
        for row in rows
    ]


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

    current = require_user(
        request
    )

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


@app.post(
    "/api/messages"
)
async def send_message(
    request: Request,
):

    current = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail="داده پیام نامعتبر است.",
        )

    if not isinstance(
        data,
        dict,
    ):

        raise HTTPException(
            status_code=400,
            detail="داده پیام نامعتبر است.",
        )

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
        (
            receiver_id,
        ),
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
        (
            int(cursor.lastrowid),
        ),
    ).fetchone()

    connection.close()

    if row is None:

        raise HTTPException(
            status_code=500,
            detail="پیام ذخیره نشد.",
        )

    payload = dict(row)

    await send_to_user(
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
# EDIT MESSAGE
# =========================================================

@app.post(
    "/api/messages/{message_id}/edit"
)
async def edit_message(
    request: Request,
    message_id: int,
):

    current = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail="داده ویرایش نامعتبر است.",
        )

    if not isinstance(
        data,
        dict,
    ):

        raise HTTPException(
            status_code=400,
            detail="داده ویرایش نامعتبر است.",
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
        (
            message_id,
        ),
    ).fetchone()

    if row is None:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="پیام پیدا نشد.",
        )

    if int(
        row["sender_id"]
    ) != int(
        current["id"]
    ):

        connection.close()

        raise HTTPException(
            status_code=403,
            detail="اجازه ویرایش این پیام را ندارید.",
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
        (
            message_id,
        ),
    ).fetchone()

    connection.close()

    if updated is None:

        raise HTTPException(
            status_code=500,
            detail="پیام ویرایش نشد.",
        )

    payload = dict(
        updated
    )

    receiver_id = row[
        "receiver_id"
    ]

    if receiver_id:

        await send_to_user(
            int(receiver_id),
            {
                "type":
                    "message:update",
                "message":
                    payload,
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

    current = require_user(
        request
    )

    connection = get_db()

    row = connection.execute(
        """
        SELECT *
        FROM messages
        WHERE id = ?
        """,
        (
            message_id,
        ),
    ).fetchone()

    if row is None:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="پیام پیدا نشد.",
        )

    if int(
        row["sender_id"]
    ) != int(
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
        (
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
        (
            message_id,
        ),
    ).fetchone()

    connection.close()

    if updated is None:

        raise HTTPException(
            status_code=500,
            detail="حذف پیام انجام نشد.",
        )

    payload = dict(
        updated
    )

    receiver_id = row[
        "receiver_id"
    ]

    if receiver_id:

        await send_to_user(
            int(receiver_id),
            {
                "type":
                    "message:update",
                "message":
                    payload,
            },
        )

    return payload


# =========================================================
# FILE UPLOAD
# =========================================================

@app.post(
    "/api/upload"
)
async def upload_file(
    request: Request,
    receiver_id: int = Form(...),
    file: UploadFile = File(...),
):

    current = require_user(
        request
    )

    filename = safe_filename(
        file.filename or "file"
    )

    if not allowed_upload(
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
        (
            receiver_id,
        ),
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
        or mimetypes.guess_type(
            filename
        )[0]
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
        (
            int(cursor.lastrowid),
        ),
    ).fetchone()

    connection.close()

    if row is None:

        raise HTTPException(
            status_code=500,
            detail="فایل ذخیره نشد.",
        )

    payload = dict(row)

    await send_to_user(
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
# GROUPS
# =========================================================

@app.post(
    "/api/groups"
)
async def create_group(
    request: Request,
):

    current = require_user(
        request
    )

    try:

        data = await request.json()

    except Exception:

        raise HTTPException(
            status_code=400,
            detail="داده گروه نامعتبر است.",
        )

    if not isinstance(
        data,
        dict,
    ):

        raise HTTPException(
            status_code=400,
            detail="داده گروه نامعتبر است.",
        )

    name = str(
        data.get(
            "name",
            "",
        )
    ).strip()

    members = data.get(
        "members",
        [],
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

    if not isinstance(
        members,
        list,
    ):

        members = []

    db = get_db()

    cursor = db.execute(
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

    member_ids = {
        int(current["id"])
    }

    for item in members:

        try:

            member_ids.add(
                int(item)
            )

        except (
            TypeError,
            ValueError,
        ):

            pass

    for member_id in member_ids:

        exists = db.execute(
            """
            SELECT id
            FROM users
            WHERE id = ?
            """,
            (
                member_id,
            ),
        ).fetchone()

        if exists is None:
            continue

        db.execute(
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

    db.commit()
    db.close()

    return {
        "ok":
            True,
        "id":
            group_id,
        "name":
            name,
        "owner_id":
            int(current["id"]),
    }


@app.get(
    "/api/groups"
)
def get_groups(
    request: Request,
):

    current = require_user(
        request
    )

    db = get_db()

    rows = db.execute(
        """
        SELECT
            g.id,
            g.name,
            g.owner_id,
            g.created_at
        FROM groups g
        INNER JOIN group_members gm
            ON gm.group_id = g.id
        WHERE gm.user_id = ?
        ORDER BY g.id DESC
        """,
        (
            int(current["id"]),
        ),
    ).fetchall()

    db.close()

    return [
        dict(row)
        for row in rows
    ]


# =========================================================
# LIVE API
# =========================================================

@app.get(
    "/api/live"
)
def live_api(
    request: Request,
):

    require_user(
        request
    )

    return live_public_list()


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

    user_id = get_user_from_ticket(
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
        (
            user_id,
        ),
    ).fetchone()

    connection.close()

    if row is None:

        await websocket.close(
            code=4401
        )

        return

    user_id = int(
        user_id
    )

    active_connections.setdefault(
        user_id,
        set(),
    ).add(
        websocket
    )

    first_connection = (
        len(
            active_connections[
                user_id
            ]
        )
        == 1
    )

    try:

        if first_connection:

            for other_id in list(
                active_connections.keys()
            ):

                if int(
                    other_id
                ) == user_id:
                    continue

                await send_to_user(
                    int(other_id),
                    {
                        "type":
                            "user_online",
                        "user_id":
                            user_id,
                    },
                )

        await websocket.send_text(
            json.dumps(
                {
                    "type":
                        "ready",
                    "online": [
                        int(item)
                        for item in
                        active_connections.keys()
                    ],
                    "live_streams":
                        live_public_list(),
                },
                ensure_ascii=False,
            )
        )

        while True:

            raw_data = (
                await websocket.receive_text()
            )

            try:

                data = json.loads(
                    raw_data
                )

            except Exception:

                data = {}

            if not isinstance(
                data,
                dict,
            ):

                data = {}

            event_type = data.get(
                "type"
            )


            # =================================================
            # PING
            # =================================================

            if event_type == "ping":

                await websocket.send_text(
                    json.dumps(
                        {
                            "type":
                                "pong"
                        },
                        ensure_ascii=False,
                    )
                )


            # =================================================
            # TYPING
            # =================================================

            elif event_type == "typing":

                try:

                    target_id = int(
                        data.get("to")
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                await send_to_user(
                    target_id,
                    {
                        "type":
                            "typing",
                        "from":
                            user_id,
                        "value":
                            bool(
                                data.get(
                                    "value",
                                    False,
                                )
                            ),
                    },
                )


            # =================================================
            # LIVE CREATE
            # =================================================

            elif event_type == "live_create":

                title = str(
                    data.get(
                        "title",
                        "پخش زنده GAPINO",
                    )
                ).strip()

                if not title:

                    title = (
                        "پخش زنده GAPINO"
                    )

                if len(title) > 100:

                    title = title[:100]

                for old_room_id, old_room in list(
                    live_rooms.items()
                ):

                    if int(
                        old_room.get(
                            "host_id",
                            0,
                        )
                    ) == user_id:

                        await end_live_room(
                            old_room_id
                        )

                room_id = secrets.token_urlsafe(
                    12
                )

                live_rooms[
                    room_id
                ] = {
                    "room_id":
                        room_id,
                    "title":
                        title,
                    "host_id":
                        user_id,
                    "viewers":
                        set(),
                }

                await websocket.send_text(
                    json.dumps(
                        {
                            "type":
                                "live_created",
                            "room_id":
                                room_id,
                            "title":
                                title,
                        },
                        ensure_ascii=False,
                    )
                )

                await broadcast_live_list()


            # =================================================
            # LIVE JOIN
            # =================================================

            elif event_type == "live_join":

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:

                    await websocket.send_text(
                        json.dumps(
                            {
                                "type":
                                    "live_error",
                                "message":
                                    "این پخش زنده دیگر فعال نیست.",
                            },
                            ensure_ascii=False,
                        )
                    )

                    continue

                host_id = int(
                    room["host_id"]
                )

                if host_id == user_id:
                    continue

                room["viewers"].add(
                    user_id
                )

                await websocket.send_text(
                    json.dumps(
                        {
                            "type":
                                "live_joined",
                            "room_id":
                                room_id,
                            "host_id":
                                host_id,
                            "title":
                                room["title"],
                        },
                        ensure_ascii=False,
                    )
                )

                await send_to_user(
                    host_id,
                    {
                        "type":
                            "live_viewer_join",
                        "room_id":
                            room_id,
                        "viewer_id":
                            user_id,
                    },
                )

                recipients = set(
                    room["viewers"]
                )

                recipients.add(
                    host_id
                )

                for member_id in recipients:

                    await send_to_user(
                        int(member_id),
                        {
                            "type":
                                "live_viewer_count",
                            "room_id":
                                room_id,
                            "count":
                                len(
                                    room[
                                        "viewers"
                                    ]
                                ),
                        },
                    )

                await broadcast_live_list()


            # =================================================
            # LIVE LEAVE
            # =================================================

            elif event_type == "live_leave":

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:
                    continue

                room[
                    "viewers"
                ].discard(
                    user_id
                )

                host_id = int(
                    room["host_id"]
                )

                recipients = set(
                    room["viewers"]
                )

                recipients.add(
                    host_id
                )

                for member_id in recipients:

                    await send_to_user(
                        int(member_id),
                        {
                            "type":
                                "live_viewer_count",
                            "room_id":
                                room_id,
                            "count":
                                len(
                                    room[
                                        "viewers"
                                    ]
                                ),
                        },
                    )

                await broadcast_live_list()


            # =================================================
            # LIVE END
            # =================================================

            elif event_type == "live_end":

                room_id = str(
                    data.get(
                        "room_id",
                        "",
                    )
                ).strip()

                room = live_rooms.get(
                    room_id
                )

                if not room:
                    continue

                if int(
                    room.get(
                        "host_id",
                        0,
                    )
                ) != user_id:

                    continue

                await end_live_room(
                    room_id
                )


            # =================================================
            # LIVE OFFER
            # =================================================

            elif event_type in (
                "live_offer",
                "live_host_offer",
            ):

                try:

                    target_id = int(
                        data.get(
                            "target_id"
                        )
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                outgoing = dict(
                    data
                )

                outgoing[
                    "from"
                ] = user_id

                await send_to_user(
                    target_id,
                    outgoing,
                )


            # =================================================
            # LIVE ANSWER
            # =================================================

            elif event_type == "live_answer":

                try:

                    target_id = int(
                        data.get(
                            "target_id"
                        )
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                outgoing = dict(
                    data
                )

                outgoing[
                    "from"
                ] = user_id

                await send_to_user(
                    target_id,
                    outgoing,
                )


            # =================================================
            # LIVE ICE
            # =================================================

            elif event_type == "live_ice":

                try:

                    target_id = int(
                        data.get(
                            "target_id"
                        )
                    )

                except (
                    TypeError,
                    ValueError,
                ):

                    continue

                outgoing = dict(
                    data
                )

                outgoing[
                    "from"
                ] = user_id

                await send_to_user(
                    target_id,
                    outgoing,
                )


            # =================================================
            # MESSAGE THROUGH WEBSOCKET
            # =================================================

            elif event_type == "message":

                try:

                    target_id = int(
                        data.get(
                            "to"
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
                ).strip()

                if not text:
                    continue

                if len(text) > 5000:
                    continue

                if target_id == user_id:
                    continue

                connection = get_db()

                receiver = connection.execute(
                    """
                    SELECT id
                    FROM users
                    WHERE id = ?
                    """,
                    (
                        target_id,
                    ),
                ).fetchone()

                if receiver is None:

                    connection.close()

                    continue

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
                        user_id,
                        target_id,
                        text,
                        now_iso(),
                    ),
                )

                connection.commit()

                message_row = connection.execute(
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

                connection.close()

                if message_row is not None:

                    message_payload = dict(
                        message_row
                    )

                    await send_to_user(
                        target_id,
                        {
                            "type":
                                "message",
                            "message":
                                message_payload,
                        },
                    )

                    await websocket.send_text(
                        json.dumps(
                            {
                                "type":
                                    "message_sent",
                                "message":
                                    message_payload,
                            },
                            ensure_ascii=False,
                        )
                    )

    except WebSocketDisconnect:

        pass

    except Exception as error:

        print(
            "WebSocket error:",
            error,
        )

    finally:

        sockets = active_connections.get(
            user_id,
            set(),
        )

        sockets.discard(
            websocket
        )

        if not sockets:

            active_connections.pop(
                user_id,
                None,
            )

            for room_id, room in list(
                live_rooms.items()
            ):

                host_id = int(
                    room.get(
                        "host_id",
                        0,
                    )
                )

                if host_id == user_id:

                    await end_live_room(
                        room_id
                    )

                elif user_id in room.get(
                    "viewers",
                    set(),
                ):

                    room[
                        "viewers"
                    ].discard(
                        user_id
                    )

                    recipients = set(
                        room[
                            "viewers"
                        ]
                    )

                    recipients.add(
                        host_id
                    )

                    for member_id in recipients:

                        await send_to_user(
                            int(member_id),
                            {
                                "type":
                                    "live_viewer_count",
                                "room_id":
                                    room_id,
                                "count":
                                    len(
                                        room[
                                            "viewers"
                                        ]
                                    ),
                            },
                        )

            for other_id in list(
                active_connections.keys()
            ):

                await send_to_user(
                    int(other_id),
                    {
                        "type":
                            "user_offline",
                        "user_id":
                            user_id,
                    },
                )

            await broadcast_live_list()
