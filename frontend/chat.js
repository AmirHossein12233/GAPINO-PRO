```html
<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    >

    <meta
        name="theme-color"
        content="#080d1a"
    >

    <title>گپینو | چت</title>


    <!-- =====================================================
         STYLE
         ===================================================== -->

    <link
        rel="stylesheet"
        href="/static/style.css?v=302"
    >


    <!-- =====================================================
         EXTRA CHAT FIXES
         ===================================================== -->

    <style>

        [hidden] {
            display: none !important;
        }


        /* =============================================
           OVERLAY
           ============================================= */

        .app-overlay {
            position: fixed !important;

            inset: 0 !important;

            z-index: 9000 !important;

            background:
                rgba(0, 0, 0, .48);

            backdrop-filter:
                blur(4px);

            -webkit-backdrop-filter:
                blur(4px);

            pointer-events: auto;

            touch-action: none;
        }


        /* =============================================
           SIDEBAR
           ============================================= */

        .sidebar {
            pointer-events: auto !important;
        }


        .user-list {
            pointer-events: auto !important;

            touch-action: pan-y;
        }


        .user-item {
            pointer-events: auto !important;

            cursor: pointer;

            touch-action: manipulation;
        }


        /* =============================================
           VOICE RECORDING
           ============================================= */

        #voiceButton.recording {
            background:
                rgba(239, 68, 68, .17) !important;

            border-color:
                rgba(239, 68, 68, .40) !important;

            color:
                #fca5a5 !important;

            animation:
                gapinoVoicePulse 1.2s
                infinite ease-in-out;
        }


        @keyframes gapinoVoicePulse {

            0% {
                box-shadow:
                    0 0 0 0
                    rgba(239, 68, 68, .15);
            }

            50% {
                box-shadow:
                    0 0 0 7px
                    rgba(239, 68, 68, 0);
            }

            100% {
                box-shadow:
                    0 0 0 0
                    rgba(239, 68, 68, 0);
            }
        }


        /* =============================================
           AUDIO
           ============================================= */

        .message-audio {
            min-width:
                min(280px, 100%);

            max-width:
                min(360px, 100%);
        }


        .message-audio audio {
            display: block;

            width: 100%;

            min-width: 240px;

            max-width: 100%;
        }


        .voice-name {
            margin-top: 6px;

            color:
                rgba(255,255,255,.70);

            font-size: 10px;

            line-height: 1.5;
        }


        .message.theirs .voice-name {
            color:
                var(--muted);
        }


        /* =============================================
           IMAGE
           ============================================= */

        .message-image {
            max-width:
                min(380px, 100%);

            max-height:
                450px;

            display:
                block;

            border-radius:
                14px;

            object-fit:
                cover;

            cursor:
                pointer;
        }


        /* =============================================
           PROFILE PANEL
           ============================================= */

        .profile-panel[hidden] {
            display:
                none !important;
        }


        /* =============================================
           DESKTOP
           ============================================= */

        @media (min-width: 821px) {

            .app-overlay {
                display:
                    none !important;

                pointer-events:
                    none !important;
            }

        }


        /* =============================================
           MOBILE
           ============================================= */

        @media (max-width: 820px) {

            .sidebar {
                position:
                    fixed !important;

                top:
                    0 !important;

                right:
                    0 !important;

                bottom:
                    0 !important;

                width:
                    min(88vw, 360px) !important;

                z-index:
                    10001 !important;
            }


            .app-shell.sidebar-open .sidebar {
                transform:
                    translateX(0) !important;
            }


            .app-overlay {
                z-index:
                    10000 !important;
            }


            .profile-panel {
                z-index:
                    10002 !important;
            }

        }


        /* =============================================
           SAFE BUTTON STATE
           ============================================= */

        button:disabled {
            opacity:
                .50;

            cursor:
                not-allowed;
        }


        /* =============================================
           TEXT SELECTION
           ============================================= */

        .message-text,
        .message-file-name {
            user-select:
                text;

            -webkit-user-select:
                text;
        }

    </style>

</head>


<body>


<div
    id="appShell"
    class="app-shell"
>


    <!-- =====================================================
         SIDEBAR
         ===================================================== -->

    <aside
        id="sidebar"
        class="sidebar"
    >


        <!-- ===============================================
             HEADER
             =============================================== -->

        <div class="sidebar-header">


            <div class="sidebar-brand">


                <div
                    class="sidebar-logo"
                    aria-hidden="true"
                >
                    G
                </div>


                <div>

                    <h1>
                        گپینو
                    </h1>

                    <span>
                        پیام‌رسان شما
                    </span>

                </div>


            </div>


            <button
                id="menuButton"
                class="icon-button"
                type="button"
                title="بستن منو"
                aria-label="بستن منو"
            >
                ☰
            </button>


        </div>


        <!-- =================================================
             CURRENT USER
             ================================================= -->

        <div class="current-user-card">


            <button
                id="profileButton"
                class="current-user-main"
                type="button"
                title="پروفایل من"
                aria-label="پروفایل من"
            >


                <div
                    id="currentAvatar"
                    class="avatar avatar-large"
                >
                    G
                </div>


                <div class="current-user-info">


                    <strong
                        id="currentDisplayName"
                    >
                        گپینو
                    </strong>


                    <span
                        id="currentUsername"
                    >
                        @user
                    </span>


                </div>


            </button>


            <span
                class="online-dot"
                title="آنلاین"
                aria-label="آنلاین"
            ></span>


        </div>


        <!-- =================================================
             SEARCH
             ================================================= -->

        <div class="search-box">


            <span
                class="search-icon"
                aria-hidden="true"
            >
                🔎
            </span>


            <input
                id="userSearch"
                type="search"
                placeholder="جستجوی کاربران..."
                autocomplete="off"
                spellcheck="false"
                aria-label="جستجوی کاربران"
            >


            <button
                id="clearSearch"
                class="search-clear"
                type="button"
                hidden
                title="پاک کردن"
                aria-label="پاک کردن جستجو"
            >
                ×
            </button>


        </div>


        <!-- =================================================
             USER LIST HEADER
             ================================================= -->

        <div class="list-header">


            <span>
                کاربران
            </span>


            <span id="userCount">
                0
            </span>


        </div>


        <!-- =================================================
             USER LIST
             ================================================= -->

        <div
            id="userList"
            class="user-list"
            aria-label="فهرست کاربران"
        >


            <div class="empty-users">


                <div
                    class="empty-icon"
                    aria-hidden="true"
                >
                    💬
                </div>


                <strong>
                    در حال دریافت کاربران...
                </strong>


                <span>
                    لطفاً کمی صبر کن.
                </span>


            </div>


        </div>


        <!-- =================================================
             SIDEBAR FOOTER
             ================================================= -->

        <div class="sidebar-footer">


            <!-- THEME -->

            <button
                id="themeButton"
                class="sidebar-action"
                type="button"
                title="تغییر حالت نمایش"
            >
                ☀️
                <span>
                    حالت روشن
                </span>
            </button>


            <!-- LOGOUT -->

            <button
                id="logoutButton"
                class="sidebar-action danger"
                type="button"
                title="خروج از حساب"
            >
                🚪

                <span>
                    خروج از حساب
                </span>

            </button>


        </div>


    </aside>


    <!-- =====================================================
         MAIN CHAT
         ===================================================== -->

    <main
        class="chat-main"
    >


        <!-- =================================================
             CHAT HEADER
             ================================================= -->

        <header
            id="chatHeader"
            class="chat-header"
        >


            <!-- MOBILE MENU -->

            <button
                id="mobileMenuButton"
                class="icon-button mobile-only"
                type="button"
                title="کاربران"
                aria-label="باز کردن فهرست کاربران"
            >
                ☰
            </button>


            <!-- CONTACT -->

            <div
                id="chatContact"
                class="chat-contact"
                hidden
            >


                <div
                    id="chatAvatar"
                    class="avatar"
                >
                    G
                </div>


                <div class="chat-contact-info">


                    <strong
                        id="chatName"
                    >
                        کاربر
                    </strong>


                    <span
                        id="chatStatus"
                    >
                        آفلاین
                    </span>


                </div>


            </div>


            <!-- EMPTY HEADER -->

            <div
                id="chatHeaderEmpty"
                class="chat-header-empty"
            >


                <strong>
                    گپینو
                </strong>


                <span>
                    گفتگوی خودت را انتخاب کن
                </span>


            </div>


            <!-- HEADER ACTIONS -->

            <div class="chat-header-actions">


                <button
                    id="refreshButton"
                    class="icon-button"
                    type="button"
                    title="به‌روزرسانی"
                    aria-label="به‌روزرسانی"
                >
                    ↻
                </button>


                <button
                    id="profileHeaderButton"
                    class="icon-button"
                    type="button"
                    title="پروفایل"
                    aria-label="پروفایل"
                >
                    👤
                </button>


            </div>


        </header>


        <!-- =================================================
             WELCOME SCREEN
             ================================================= -->

        <section
            id="welcomeScreen"
            class="welcome-screen"
        >


            <div class="welcome-card">


                <div
                    class="welcome-logo"
                    aria-hidden="true"
                >
                    G
                </div>


                <h2>
                    به گپینو خوش آمدی 👋
                </h2>


                <p>
                    یک کاربر را از فهرست انتخاب کن
                    تا گفتگوی خودت را شروع کنی.
                </p>


                <div class="welcome-features">


                    <div>

                        <span>
                            ⚡
                        </span>

                        <small>
                            گفتگوی سریع
                        </small>

                    </div>


                    <div>

                        <span>
                            🎙️
                        </span>

                        <small>
                            پیام صوتی
                        </small>

                    </div>


                    <div>

                        <span>
                            📎
                        </span>

                        <small>
                            ارسال فایل
                        </small>

                    </div>


                </div>


            </div>


        </section>


        <!-- =================================================
             CHAT VIEW
             ================================================= -->

        <section
            id="chatView"
            class="chat-view"
            hidden
        >


            <!-- =================================================
                 MESSAGES
                 ================================================= -->

            <div
                id="messages"
                class="messages"
                aria-live="polite"
            ></div>


            <!-- =================================================
                 TYPING
                 ================================================= -->

            <div
                id="typingArea"
                class="typing-area"
                hidden
                aria-live="polite"
            >


                <div class="typing-dots">

                    <span></span>
                    <span></span>
                    <span></span>

                </div>


                <span>
                    در حال نوشتن...
                </span>


            </div>


            <!-- =================================================
                 COMPOSER
                 ================================================= -->

            <div class="composer">


                <!-- FILE INPUT -->

                <input
                    id="fileInput"
                    type="file"
                    hidden
                >


                <!-- ATTACH -->

                <button
                    id="attachButton"
                    class="composer-button"
                    type="button"
                    title="ارسال فایل"
                    aria-label="ارسال فایل"
                >
                    📎
                </button>


                <!-- VOICE -->

                <button
                    id="voiceButton"
                    class="composer-button"
                    type="button"
                    title="ضبط پیام صوتی"
                    aria-label="ضبط پیام صوتی"
                >
                    🎙️
                </button>


                <!-- MESSAGE INPUT -->

                <div
                    class="message-input-wrapper"
                >


                    <textarea
                        id="messageInput"
                        rows="1"
                        maxlength="5000"
                        placeholder="پیامت را بنویس..."
                        autocomplete="off"
                        spellcheck="false"
                        aria-label="متن پیام"
                    ></textarea>


                </div>


                <!-- SEND -->

                <button
                    id="sendButton"
                    class="send-button"
                    type="button"
                    title="ارسال پیام"
                    aria-label="ارسال پیام"
                >
                    ➤
                </button>


            </div>


        </section>


    </main>


    <!-- =====================================================
         PROFILE PANEL
         ===================================================== -->

    <aside
        id="profilePanel"
        class="profile-panel"
        hidden
    >


        <!-- HEADER -->

        <div class="profile-panel-header">


            <strong>
                پروفایل من
            </strong>


            <button
                id="closeProfile"
                class="icon-button"
                type="button"
                title="بستن"
                aria-label="بستن پروفایل"
            >
                ×
            </button>


        </div>


        <!-- CONTENT -->

        <div class="profile-content">


            <!-- AVATAR -->

            <div
                id="profileAvatar"
                class="profile-avatar-large"
            >
                G
            </div>


            <!-- NAME -->

            <div
                id="profileName"
                class="profile-name"
            >
                گپینو
            </div>


            <!-- USERNAME -->

            <div
                id="profileUsername"
                class="profile-username"
            >
                @user
            </div>


            <!-- DISPLAY NAME -->

            <div class="profile-section">


                <label
                    for="editDisplayName"
                >
                    نام نمایشی
                </label>


                <input
                    id="editDisplayName"
                    type="text"
                    maxlength="60"
                    placeholder="نام نمایشی"
                    autocomplete="name"
                >


            </div>


            <!-- BIO -->

            <div class="profile-section">


                <label
                    for="editBio"
                >
                    درباره من
                </label>


                <textarea
                    id="editBio"
                    maxlength="300"
                    rows="4"
                    placeholder="چند کلمه درباره خودت..."
                ></textarea>


            </div>


            <!-- STATUS -->

            <div class="profile-section">


                <label
                    for="editStatus"
                >
                    وضعیت
                </label>


                <select
                    id="editStatus"
                >


                    <option
                        value="در دسترس"
                    >
                        🟢 در دسترس
                    </option>


                    <option
                        value="مشغول"
                    >
                        🔴 مشغول
                    </option>


                    <option
                        value="غیرفعال"
                    >
                        🟡 غیرفعال
                    </option>


                    <option
                        value="نامرئی"
                    >
                        ⚫ نامرئی
                    </option>


                </select>


            </div>


            <!-- SAVE -->

            <button
                id="saveProfile"
                class="primary-button"
                type="button"
            >
                ذخیره تغییرات
            </button>


            <!-- PROFILE PAGE -->

            <button
                id="profilePageButton"
                class="secondary-button"
                type="button"
            >
                صفحه کامل پروفایل
            </button>


        </div>


    </aside>


    <!-- =====================================================
         OVERLAY
         ===================================================== -->

    <div
        id="appOverlay"
        class="app-overlay"
        hidden
        aria-hidden="true"
    ></div>


    <!-- =====================================================
         TOAST
         ===================================================== -->

    <div
        id="toast"
        class="toast"
        aria-live="polite"
        role="status"
    ></div>


</div>


<!-- =========================================================
     CHAT.JS
     ========================================================= -->

<script
    src="/chat.js?v=302"
    defer
></script>


</body>
</html>
```
