```html
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#111827">
    <title>گپینو</title>

    <style>
        * {
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        }

        html,
        body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
            background: #0b1020;
            color: #fff;
            font-family: Tahoma, Arial, sans-serif;
        }

        body {
            min-height: 100dvh;
        }

        button,
        input,
        textarea {
            font-family: inherit;
        }

        button {
            border: 0;
            cursor: pointer;
        }

        .app-shell {
            position: relative;
            width: 100%;
            height: 100dvh;
            display: flex;
            background: #0b1020;
        }

        /* SIDEBAR */

        .sidebar {
            width: 340px;
            min-width: 340px;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #111827;
            border-left: 1px solid rgba(255,255,255,.08);
        }

        .brand {
            padding: 18px 16px 12px;
        }

        .brand-title {
            font-size: 25px;
            font-weight: 900;
        }

        .brand-subtitle {
            margin-top: 4px;
            font-size: 12px;
            color: #94a3b8;
        }

        .search-box {
            padding: 0 14px 12px;
        }

        #userSearch {
            width: 100%;
            height: 46px;
            padding: 0 14px;
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 13px;
            outline: none;
            background: #1f2937;
            color: #fff;
            font-size: 14px;
        }

        #userSearch::placeholder {
            color: #94a3b8;
        }

        /* LIVE */

        .live-section {
            padding: 0 12px 8px;
        }

        .live-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 5px 4px 8px;
        }

        .live-title {
            color: #fca5a5;
            font-size: 13px;
            font-weight: 900;
        }

        #refreshLivesButton {
            width: 34px;
            height: 34px;
            border-radius: 10px;
            background: #1f2937;
            color: #fff;
            font-size: 18px;
        }

        #activeLivesList {
            display: flex;
            flex-direction: column;
            gap: 7px;
            max-height: 145px;
            overflow-y: auto;
        }

        .live-card {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 9px;
            border-radius: 13px;
            background: #1a1f2c;
            border: 1px solid rgba(239,68,68,.18);
            cursor: pointer;
        }

        .live-card:active {
            transform: scale(.99);
        }

        .live-avatar {
            width: 40px;
            height: 40px;
            flex: 0 0 40px;
            border-radius: 50%;
            object-fit: cover;
            background: #374151;
        }

        .live-info {
            flex: 1;
            min-width: 0;
        }

        .live-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px;
            font-weight: 900;
        }

        .live-viewers {
            margin-top: 3px;
            color: #94a3b8;
            font-size: 10px;
        }

        .live-badge {
            padding: 5px 7px;
            border-radius: 7px;
            background: #ef4444;
            color: #fff;
            font-size: 9px;
            font-weight: 900;
        }

        /* USERS */

        .users-title {
            padding: 5px 18px 8px;
            color: #94a3b8;
            font-size: 12px;
            font-weight: 900;
        }

        #usersList {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 0 8px 8px;
        }

        .user-item {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 4px;
            padding: 10px;
            border-radius: 13px;
            background: transparent;
            color: #fff;
            text-align: right;
        }

        .user-item:hover,
        .user-item.active {
            background: #1f2937;
        }

        .user-avatar-wrap {
            position: relative;
            flex: 0 0 auto;
        }

        .user-avatar {
            width: 47px;
            height: 47px;
            border-radius: 50%;
            object-fit: cover;
            background: #374151;
        }

        .online-dot {
            position: absolute;
            left: 1px;
            bottom: 1px;
            width: 10px;
            height: 10px;
            border: 2px solid #111827;
            border-radius: 50%;
            background: #64748b;
        }

        .online-dot.online {
            background: #22c55e;
        }

        .user-info {
            min-width: 0;
            flex: 1;
        }

        .user-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 14px;
            font-weight: 900;
        }

        .user-status {
            margin-top: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #94a3b8;
            font-size: 11px;
        }

        /* FOOTER */

        .sidebar-footer {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
            padding: 9px;
            border-top: 1px solid rgba(255,255,255,.08);
        }

        .footer-button {
            min-height: 48px;
            border-radius: 12px;
            background: #1f2937;
            color: #fff;
            font-size: 13px;
            font-weight: 900;
        }

        .footer-button.live {
            background: #991b1b;
        }

        .footer-button.logout {
            grid-column: 1 / -1;
            background: #3f1d1d;
        }

        /* CHAT */

        .chat-area {
            flex: 1;
            min-width: 0;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #0f172a;
        }

        .chat-header {
            min-height: 72px;
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 9px 12px;
            background: #111827;
            border-bottom: 1px solid rgba(255,255,255,.08);
        }

        #mobileBackButton {
            display: none;
            width: 40px;
            height: 40px;
            border-radius: 10px;
            background: #1f2937;
            color: #fff;
            font-size: 22px;
        }

        #chatAvatar {
            width: 45px;
            height: 45px;
            border-radius: 50%;
            object-fit: cover;
            background: #374151;
        }

        .chat-header-info {
            flex: 1;
            min-width: 0;
        }

        #chatUserName {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 15px;
            font-weight: 900;
        }

        #chatUserStatus {
            margin-top: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #94a3b8;
            font-size: 11px;
        }

        .header-actions {
            display: flex;
            gap: 5px;
        }

        .header-button {
            width: 40px;
            height: 40px;
            border-radius: 10px;
            background: #1f2937;
            color: #fff;
            font-size: 17px;
        }

        /* MESSAGES */

        #messagesContainer {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 12px;
        }

        #emptyChat {
            width: min(420px, 92%);
            margin: auto;
            padding: 25px 20px;
            border-radius: 20px;
            background: #111827;
            text-align: center;
        }

        .empty-icon {
            font-size: 43px;
        }

        .empty-title {
            margin-top: 9px;
            font-size: 18px;
            font-weight: 900;
        }

        .empty-text {
            margin-top: 7px;
            color: #94a3b8;
            font-size: 12px;
            line-height: 1.8;
        }

        #messagesList {
            display: flex;
            flex-direction: column;
            gap: 7px;
        }

        .message-row {
            display: flex;
            width: 100%;
        }

        .message-row.mine {
            justify-content: flex-start;
        }

        .message-row.other {
            justify-content: flex-end;
        }

        .message-bubble {
            max-width: 78%;
            padding: 9px 12px;
            border-radius: 15px;
            word-break: break-word;
            line-height: 1.7;
            font-size: 14px;
        }

        .message-row.mine .message-bubble {
            background: #2563eb;
            border-bottom-right-radius: 5px;
        }

        .message-row.other .message-bubble {
            background: #1f2937;
            border-bottom-left-radius: 5px;
        }

        .message-time {
            margin-top: 2px;
            opacity: .65;
            font-size: 9px;
        }

        #typingIndicator {
            min-height: 22px;
            padding: 0 13px;
            color: #94a3b8;
            font-size: 10px;
        }

        /* COMPOSER */

        #attachmentPreview {
            display: none;
            padding: 7px 10px;
            background: #111827;
        }

        #attachmentPreview.show {
            display: block;
        }

        .attachment-inner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 10px;
            border-radius: 11px;
            background: #1f2937;
        }

        .composer {
            padding: 8px;
            padding-bottom: max(8px, env(safe-area-inset-bottom));
            background: #111827;
            border-top: 1px solid rgba(255,255,255,.08);
        }

        .composer-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .composer-button {
            width: 43px;
            min-width: 43px;
            height: 43px;
            border-radius: 11px;
            background: #1f2937;
            color: #fff;
            font-size: 18px;
        }

        #messageInput {
            flex: 1;
            min-width: 0;
            height: 43px;
            padding: 0 12px;
            border: 0;
            border-radius: 11px;
            outline: none;
            background: #1f2937;
            color: #fff;
            font-size: 14px;
        }

        #messageInput:disabled {
            opacity: .55;
        }

        #sendButton {
            background: #2563eb;
        }

        /* MODAL */

        .modal {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 5000;
            align-items: center;
            justify-content: center;
            padding: 15px;
            background: rgba(0,0,0,.72);
        }

        .modal.show {
            display: flex;
        }

        .modal-box {
            width: min(520px, 100%);
            max-height: 90dvh;
            overflow-y: auto;
            padding: 18px;
            border-radius: 20px;
            background: #111827;
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .modal-title {
            font-size: 17px;
            font-weight: 900;
        }

        .modal-close {
            width: 38px;
            height: 38px;
            border-radius: 10px;
            background: #1f2937;
            color: #fff;
            font-size: 18px;
        }

        #profileAvatarPreview {
            display: block;
            width: 88px;
            height: 88px;
            margin: 18px auto;
            border-radius: 50%;
            object-fit: cover;
            background: #374151;
        }

        .form-label {
            display: block;
            margin: 12px 0 6px;
            color: #cbd5e1;
            font-size: 12px;
        }

        .form-input,
        .form-textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 11px;
            outline: none;
            background: #1f2937;
            color: #fff;
        }

        .form-textarea {
            min-height: 90px;
            resize: vertical;
        }

        .modal-action {
            width: 100%;
            height: 44px;
            margin-top: 14px;
            border-radius: 11px;
            background: #2563eb;
            color: #fff;
            font-weight: 900;
        }

        /* TOAST */

        #toastContainer {
            position: fixed;
            top: 12px;
            left: 12px;
            right: 12px;
            z-index: 9999;
            pointer-events: none;
        }

        .toast {
            width: fit-content;
            max-width: 90%;
            margin-bottom: 7px;
            padding: 11px 14px;
            border-radius: 11px;
            background: #1f2937;
            color: #fff;
            font-size: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,.3);
        }

        /* MOBILE */

        @media (max-width: 800px) {

            .app-shell {
                display: block;
                position: relative;
            }

            .sidebar {
                width: 100%;
                min-width: 100%;
                height: 100dvh;
                border: 0;
            }

            .chat-area {
                position: absolute;
                inset: 0;
                z-index: 100;
                display: none;
                width: 100%;
                height: 100dvh;
            }

            .app-shell.chat-open .sidebar {
                display: none;
            }

            .app-shell.chat-open .chat-area {
                display: flex;
            }

            #mobileBackButton {
                display: block;
            }

            .header-button {
                width: 37px;
                height: 37px;
                font-size: 15px;
            }

            .chat-header {
                padding: 8px;
            }

            #messagesContainer {
                padding: 9px;
            }

            .message-bubble {
                max-width: 84%;
            }

            .brand {
                padding-top: max(15px, env(safe-area-inset-top));
            }

            .sidebar-footer {
                padding-bottom: max(9px, env(safe-area-inset-bottom));
            }
        }

        @media (max-width: 430px) {

            .brand-title {
                font-size: 22px;
            }

            .header-actions {
                gap: 3px;
            }

            #mobileBackButton {
                width: 38px;
                height: 38px;
            }

            #chatAvatar {
                width: 41px;
                height: 41px;
            }

            .header-button {
                width: 35px;
                height: 35px;
                font-size: 14px;
            }

            .composer-button {
                width: 41px;
                min-width: 41px;
                height: 41px;
            }

            #messageInput {
                height: 41px;
            }
        }
    </style>
</head>

<body>

<div id="appShell" class="app-shell">

    <aside id="sidebar" class="sidebar">

        <div class="brand">
            <div class="brand-title">گپینو 💬</div>
            <div class="brand-subtitle">پیام‌رسان شما</div>
        </div>

        <div class="search-box">
            <input
                id="userSearch"
                type="search"
                autocomplete="off"
                placeholder="🔎 جستجوی کاربران..."
            >
        </div>

        <section id="activeLivesSection" class="live-section">

            <div class="live-header">

                <div class="live-title">
                    🔴 لایوهای فعال
                </div>

                <button
                    id="refreshLivesButton"
                    type="button"
                    aria-label="تازه کردن لایوها"
                >
                    ↻
                </button>

            </div>

            <div id="activeLivesList">
                <div style="padding:8px;color:#64748b;font-size:11px;">
                    در حال بارگذاری...
                </div>
            </div>

        </section>

        <div class="users-title">
            👥 کاربران
        </div>

        <div id="usersList">
            <div style="padding:25px;text-align:center;color:#64748b;font-size:12px;">
                در حال بارگذاری کاربران...
            </div>
        </div>

        <div class="sidebar-footer">

            <button
                id="liveButton"
                class="footer-button live"
                type="button"
            >
                🔴 پخش زنده
            </button>

            <button
                id="profileButton"
                class="footer-button"
                type="button"
            >
                👤 پروفایل
            </button>

            <button
                id="logoutButton"
                class="footer-button logout"
                type="button"
            >
                🚪 خروج
            </button>

        </div>

    </aside>

    <main id="chatArea" class="chat-area">

        <header class="chat-header">

            <button
                id="mobileBackButton"
                type="button"
                aria-label="بازگشت"
            >
                →
            </button>

            <img
                id="chatAvatar"
                src=""
                alt=""
            >

            <div class="chat-header-info">

                <div id="chatUserName">
                    گفتگو
                </div>

                <div id="chatUserStatus">
                    یک کاربر را انتخاب کنید
                </div>

            </div>

            <div class="header-actions">

                <button
                    id="headerLiveButton"
                    class="header-button"
                    type="button"
                    aria-label="لایو"
                >
                    🔴
                </button>

                <button
                    id="callButton"
                    class="header-button"
                    type="button"
                    aria-label="تماس"
                >
                    📞
                </button>

                <button
                    id="chatSearchButton"
                    class="header-button"
                    type="button"
                    aria-label="جستجو"
                >
                    🔎
                </button>

                <button
                    id="chatMenuButton"
                    class="header-button"
                    type="button"
                    aria-label="منو"
                >
                    ⋮
                </button>

            </div>

        </header>

        <section id="messagesContainer">

            <div id="emptyChat">

                <div class="empty-icon">
                    💬
                </div>

                <div class="empty-title">
                    به گپینو خوش آمدید
                </div>

                <div class="empty-text">
                    یک کاربر را انتخاب کنید تا گفتگو شروع شود.
                </div>

            </div>

            <div id="messagesList"></div>

        </section>

        <div id="typingIndicator"></div>

        <div id="attachmentPreview">

            <div class="attachment-inner">

                <span id="attachmentName">
                    فایل انتخاب شد
                </span>

                <button
                    id="removeAttachmentButton"
                    type="button"
                    style="background:none;color:#fff;font-size:17px;"
                >
                    ✕
                </button>

            </div>

        </div>

        <div class="composer">

            <div class="composer-row">

                <button
                    id="attachButton"
                    class="composer-button"
                    type="button"
                    aria-label="فایل"
                >
                    📎
                </button>

                <input
                    id="fileInput"
                    type="file"
                    hidden
                    accept="image/*,video/*,audio/*,.pdf,.txt,.zip,.rar"
                >

                <input
                    id="messageInput"
                    type="text"
                    maxlength="1000"
                    autocomplete="off"
                    placeholder="پیام خود را بنویسید..."
                    disabled
                >

                <button
                    id="voiceButton"
                    class="composer-button"
                    type="button"
                    aria-label="ضبط صدا"
                >
                    🎤
                </button>

                <button
                    id="sendButton"
                    class="composer-button"
                    type="button"
                    aria-label="ارسال پیام"
                >
                    ➤
                </button>

            </div>

        </div>

    </main>

</div>

<!-- PROFILE -->

<div id="profileModal" class="modal">

    <div class="modal-box">

        <div class="modal-header">

            <div class="modal-title">
                👤 پروفایل
            </div>

            <button
                id="closeProfileModal"
                class="modal-close"
                type="button"
            >
                ✕
            </button>

        </div>

        <img
            id="profileAvatarPreview"
            src=""
            alt=""
        >

        <label
            class="form-label"
            for="profileDisplayName"
        >
            نام نمایشی
        </label>

        <input
            id="profileDisplayName"
            class="form-input"
            type="text"
            maxlength="50"
        >

        <label
            class="form-label"
            for="profileBio"
        >
            درباره من
        </label>

        <textarea
            id="profileBio"
            class="form-textarea"
            maxlength="250"
        ></textarea>

        <button
            id="saveProfileButton"
            class="modal-action"
            type="button"
        >
            💾 ذخیره
        </button>

    </div>

</div>

<!-- MESSAGE SEARCH -->

<div id="messageSearchModal" class="modal">

    <div class="modal-box">

        <div class="modal-header">

            <div class="modal-title">
                🔎 جستجوی پیام
            </div>

            <button
                id="closeMessageSearchModal"
                class="modal-close"
                type="button"
            >
                ✕
            </button>

        </div>

        <input
            id="messageSearchInput"
            class="form-input"
            type="search"
            autocomplete="off"
            placeholder="متن پیام..."
        >

        <div
            id="messageSearchResults"
            style="margin-top:12px;"
        ></div>

    </div>

</div>

<div id="toastContainer"></div>

<script>
    window.GAPINO_API_BASE = window.location.origin;
    window.GAPINO_TURN_SERVERS = [];

    function openLivePage() {
        window.location.href = "/live.html";
    }

    function openChatOnMobile() {
        var shell = document.getElementById("appShell");

        if (shell) {
            shell.classList.add("chat-open");
        }
    }

    function closeChatOnMobile() {
        var shell = document.getElementById("appShell");

        if (shell) {
            shell.classList.remove("chat-open");
        }
    }

    document.addEventListener("DOMContentLoaded", function () {

        var backButton =
            document.getElementById("mobileBackButton");

        var liveButton =
            document.getElementById("liveButton");

        var headerLiveButton =
            document.getElementById("headerLiveButton");

        var refreshButton =
            document.getElementById("refreshLivesButton");

        if (backButton) {
            backButton.addEventListener(
                "click",
                closeChatOnMobile
            );
        }

        if (liveButton) {
            liveButton.addEventListener(
                "click",
                openLivePage
            );
        }

        if (headerLiveButton) {
            headerLiveButton.addEventListener(
                "click",
                openLivePage
            );
        }

        if (refreshButton) {
            refreshButton.addEventListener(
                "click",
                loadActiveLives
            );
        }
    });

    async function loadActiveLives() {

        var list =
            document.getElementById("activeLivesList");

        if (!list) {
            return;
        }

        try {

            var response =
                await fetch(
                    "/api/live/active",
                    {
                        method: "GET",
                        credentials: "include",
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error("Live API error");
            }

            var data =
                await response.json();

            var rooms = [];

            if (Array.isArray(data)) {
                rooms = data;
            } else if (
                data &&
                Array.isArray(data.live_rooms)
            ) {
                rooms = data.live_rooms;
            }

            list.innerHTML = "";

            if (rooms.length === 0) {

                list.innerHTML =
                    '<div style="padding:8px;color:#64748b;font-size:11px;">' +
                    'لایو فعالی وجود ندارد.' +
                    '</div>';

                return;
            }

            rooms.forEach(function (room) {

                var host =
                    room.host || {};

                var roomId =
                    room.room_id ||
                    room.id ||
                    "";

                var name =
                    host.display_name ||
                    host.username ||
                    "کاربر گپینو";

                var avatar =
                    host.avatar ||
                    host.avatar_url ||
                    "";

                var viewers =
                    Number(room.viewer_count || 0);

                var card =
                    document.createElement("div");

                card.className =
                    "live-card";

                var image =
                    document.createElement("img");

                image.className =
                    "live-avatar";

                image.src = avatar;
                image.alt = "";

                image.addEventListener(
                    "error",
                    function () {
                        image.style.visibility =
                            "hidden";
                    }
                );

                var info =
                    document.createElement("div");

                info.className =
                    "live-info";

                var nameElement =
                    document.createElement("div");

                nameElement.className =
                    "live-name";

                nameElement.textContent =
                    name;

                var viewersElement =
                    document.createElement("div");

                viewersElement.className =
                    "live-viewers";

                viewersElement.textContent =
                    "👁 " +
                    viewers +
                    " بیننده";

                info.appendChild(
                    nameElement
                );

                info.appendChild(
                    viewersElement
                );

                var badge =
                    document.createElement("div");

                badge.className =
                    "live-badge";

                badge.textContent =
                    "LIVE";

                card.appendChild(image);
                card.appendChild(info);
                card.appendChild(badge);

                if (roomId) {

                    card.addEventListener(
                        "click",
                        function () {

                            window.location.href =
                                "/live.html?room=" +
                                encodeURIComponent(roomId) +
                                "&join=1";
                        }
                    );
                }

                list.appendChild(card);
            });

        } catch (error) {

            list.innerHTML =
                '<div style="padding:8px;color:#64748b;font-size:11px;">' +
                'لایوها فعلاً در دسترس نیستند.' +
                '</div>';
        }
    }

    window.GAPINO_REFRESH_LIVES =
        loadActiveLives;

    loadActiveLives();

    setInterval(
        loadActiveLives,
        10000
    );
</script>

<script src="/frontend/chat.js?v=313"></script>
<script src="/frontend/call.js?v=9"></script>

</body>
</html>
```
