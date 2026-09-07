"use strict";

/* =========================================================
   GAPINO PRO - CHAT.JS
   هماهنگ با FastAPI API
   Login / Logout
   Users
   Messages
   WebSocket
   Typing
   Voice messages
   File upload
   Profile
   Voice Call
   ========================================================= */

(() => {
    const API = window.location.origin;

    /* =====================================================
       STATE
       ===================================================== */

    let currentUser = null;
    let currentChatUser = null;

    let users = [];
    let socket = null;

    let reconnectTimer = null;
    let usersRefreshTimer = null;
    let typingTimer = null;

    let manuallyClosedSocket = false;

    /* =====================================================
       DOM HELPERS
       ===================================================== */

    const $ = id => document.getElementById(id);

    const appShell = document.querySelector(".app-shell");
    const sidebar = $("sidebar");
    const chatArea = $("chatArea");

    const usersList = $("usersList");
    const userSearch = $("userSearch");

    const chatAvatar = $("chatAvatar");
    const chatUserName = $("chatUserName");
    const chatUserStatus = $("chatUserStatus");

    const messagesContainer = $("messagesContainer");
    const messagesList = $("messagesList");
    const emptyChat = $("emptyChat");

    const messageInput = $("messageInput");
    const sendButton = $("sendButton");

    const attachButton = $("attachButton");
    const fileInput = $("fileInput");
    const attachmentPreview = $("attachmentPreview");

    const voiceButton = $("voiceButton");

    const typingIndicator = $("typingIndicator");

    const callButton = $("callButton");

    const profileButton = $("profileButton");
    const logoutButton = $("logoutButton");

    const profileModal = $("profileModal");
    const closeProfileModal = $("closeProfileModal");

    const profileDisplayName = $("profileDisplayName");
    const profileBio = $("profileBio");
    const profileAvatarPreview = $("profileAvatarPreview");
    const saveProfileButton = $("saveProfileButton");

    const chatSearchButton = $("chatSearchButton");
    const chatMenuButton = $("chatMenuButton");

    const messageSearchModal = $("messageSearchModal");
    const closeMessageSearchModal = $("closeMessageSearchModal");
    const messageSearchInput = $("messageSearchInput");
    const messageSearchResults = $("messageSearchResults");

    const toastContainer = $("toastContainer");

    /* =====================================================
       UTILS
       ===================================================== */

    function safeText(value) {
        return String(value ?? "");
    }

    function getUserId(user) {
        return String(
            user?.id ??
            user?.user_id ??
            ""
        );
    }

    function getUserName(user) {
        return (
            user?.display_name ||
            user?.full_name ||
            user?.name ||
            user?.username ||
            "کاربر"
        );
    }

    function getAvatarUrl(user) {
        const avatar =
            user?.avatar ||
            user?.profile?.avatar ||
            "";

        if (!avatar) {
            return "";
        }

        const value = String(avatar);

        if (
            value.startsWith("http://") ||
            value.startsWith("https://") ||
            value.startsWith("/")
        ) {
            return value;
        }

        return "/" + value;
    }

    function getAvatarLetter(user) {
        return (
            getUserName(user)
                .trim()
                .charAt(0)
                .toUpperCase() ||
            "G"
        );
    }

    function renderAvatar(element, user) {
        if (!element) {
            return;
        }

        element.innerHTML = "";

        const avatar =
            getAvatarUrl(user);

        if (!avatar) {
            element.textContent =
                getAvatarLetter(user);
            return;
        }

        const img =
            document.createElement("img");

        img.src = avatar;
        img.alt = getUserName(user);
        img.loading = "lazy";

        img.onerror = () => {
            element.innerHTML = "";
            element.textContent =
                getAvatarLetter(user);
        };

        element.appendChild(img);
    }

    function escapeHtml(value) {
        return safeText(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    /* =====================================================
       TOAST
       ===================================================== */

    function showToast(
        text,
        timeout = 2500
    ) {
        if (!toastContainer) {
            console.log(
                "GAPINO:",
                text
            );
            return;
        }

        const toast =
            document.createElement("div");

        toast.className =
            "gapino-toast";

        toast.textContent =
            safeText(text);

        toastContainer.appendChild(
            toast
        );

        setTimeout(() => {
            toast.classList.add("hide");

            setTimeout(() => {
                toast.remove();
            }, 250);
        }, timeout);
    }

    /* =====================================================
       API
       ===================================================== */

    async function apiFetch(
        path,
        options = {}
    ) {
        const config = {
            credentials: "include",
            cache: "no-store",
            ...options
        };

        const response =
            await fetch(
                API + path,
                config
            );

        let data = null;

        try {
            data =
                await response.json();
        } catch (_) {
            data = null;
        }

        if (!response.ok) {
            throw new Error(
                data?.detail ||
                data?.message ||
                `HTTP ${response.status}`
            );
        }

        return data;
    }

    /* =====================================================
       CURRENT USER / SESSION
       ===================================================== */

    async function loadCurrentUser() {
        try {
            const data =
                await apiFetch(
                    "/api/me"
                );

            /*
             * main.py جدید:
             * public_user مستقیم برمی‌گرداند.
             *
             * برای سازگاری با نسخه‌هایی که
             * {authenticated,user} می‌فرستند
             * هر دو حالت را پشتیبانی می‌کنیم.
             */

            const authenticated =
                data?.authenticated !== false;

            const user =
                data?.user ||
                (
                    data?.id
                        ? data
                        : null
                );

            if (
                !authenticated ||
                !user?.id
            ) {
                throw new Error(
                    "Session not authenticated"
                );
            }

            currentUser =
                user;

            localStorage.setItem(
                "gapino_user",
                JSON.stringify(
                    currentUser
                )
            );

            renderCurrentUser();

            return currentUser;

        } catch (error) {
            console.warn(
                "GAPINO session error:",
                error
            );

            currentUser =
                null;

            localStorage.removeItem(
                "gapino_user"
            );

            window.location.replace(
                "/login.html"
            );

            return null;
        }
    }

    function renderCurrentUser() {
        /*
         * بعضی نسخه‌های قدیمی HTML
         * این عناصر را دارند.
         */

        const currentUserName =
            $("currentUserName") ||
            $("myUsername");

        const currentUserUsername =
            $("currentUserUsername");

        const currentUserAvatar =
            $("currentUserAvatar") ||
            $("myAvatar");

        if (
            currentUserName &&
            currentUser
        ) {
            currentUserName.textContent =
                getUserName(
                    currentUser
                );
        }

        if (
            currentUserUsername &&
            currentUser
        ) {
            currentUserUsername.textContent =
                currentUser.username
                    ? "@" +
                      currentUser.username
                    : "";
        }

        renderAvatar(
            currentUserAvatar,
            currentUser
        );
    }

    /* =====================================================
       USERS
       ===================================================== */

    async function loadUsers() {
        try {
            const data =
                await apiFetch(
                    "/api/users"
                );

            if (Array.isArray(data)) {
                users = data;
            } else if (
                Array.isArray(
                    data?.users
                )
            ) {
                users = data.users;
            } else {
                users = [];
            }

            renderUsers();

        } catch (error) {
            console.error(
                "GAPINO users error:",
                error
            );

            if (usersList) {
                usersList.innerHTML =
                    `
                    <div class="loading-users">
                        دریافت کاربران انجام نشد.
                    </div>
                    `;
            }
        }
    }

    function renderUsers() {
        if (!usersList) {
            return;
        }

        const query =
            safeText(
                userSearch?.value
            )
                .trim()
                .toLowerCase();

        usersList.innerHTML = "";

        const filtered =
            users.filter(
                user => {
                    const name =
                        getUserName(user)
                            .toLowerCase();

                    const username =
                        safeText(
                            user?.username
                        ).toLowerCase();

                    return (
                        !query ||
                        name.includes(query) ||
                        username.includes(query)
                    );
                }
            );

        if (filtered.length === 0) {
            usersList.innerHTML =
                `
                <div class="loading-users">
                    کاربری پیدا نشد.
                </div>
                `;
            return;
        }

        for (
            const user
            of filtered
        ) {
            const item =
                document.createElement(
                    "button"
                );

            item.type = "button";

            item.className =
                "user-item";

            if (
                currentChatUser &&
                getUserId(user) ===
                getUserId(currentChatUser)
            ) {
                item.classList.add(
                    "active"
                );
            }

            const avatar =
                document.createElement(
                    "div"
                );

            avatar.className =
                "user-item-avatar";

            renderAvatar(
                avatar,
                user
            );

            const info =
                document.createElement(
                    "div"
                );

            info.className =
                "user-item-info";

            const name =
                document.createElement(
                    "strong"
                );

            name.textContent =
                getUserName(user);

            const status =
                document.createElement(
                    "span"
                );

            status.textContent =
                user?.online === true
                    ? "آنلاین"
                    : (
                        user?.status ||
                        "آفلاین"
                    );

            info.appendChild(name);
            info.appendChild(status);

            item.appendChild(avatar);
            item.appendChild(info);

            item.addEventListener(
                "click",
                () => {
                    openChat(user);
                }
            );

            usersList.appendChild(
                item
            );
        }
    }

    function isOnline(user) {
        return (
            user?.online === true ||
            user?.is_online === true
        );
    }

    /* =====================================================
       CHAT HEADER
       ===================================================== */

    function updateChatHeader() {
        if (!currentChatUser) {
            if (chatUserName) {
                chatUserName.textContent =
                    "انتخاب گفتگو";
            }

            if (chatUserStatus) {
                chatUserStatus.textContent =
                    "یک کاربر را انتخاب کنید";
            }

            if (chatAvatar) {
                chatAvatar.textContent =
                    "G";
            }

            updateCallButton(false);

            return;
        }

        if (chatUserName) {
            chatUserName.textContent =
                getUserName(
                    currentChatUser
                );
        }

        if (chatUserStatus) {
            chatUserStatus.textContent =
                isOnline(currentChatUser)
                    ? "آنلاین"
                    : (
                        currentChatUser.status ||
                        "آفلاین"
                    );
        }

        renderAvatar(
            chatAvatar,
            currentChatUser
        );

        /*
         * مهم:
         * دکمه تماس نباید فقط به خاطر
         * وضعیت online مخفی/غیرفعال شود.
         *
         * WebSocket و signaling وضعیت
         * واقعی اتصال را مشخص می‌کنند.
         */

        updateCallButton(
            Boolean(
                currentChatUser
            )
        );
    }

    function updateCallButton(
        enabled
    ) {
        if (!callButton) {
            return;
        }

        callButton.style.display =
            "flex";

        callButton.style.visibility =
            "visible";

        callButton.style.opacity =
            "1";

        callButton.disabled =
            !Boolean(enabled);

        callButton.title =
            enabled
                ? "تماس صوتی"
                : "ابتدا یک کاربر را انتخاب کن";

        callButton.setAttribute(
            "aria-label",
            "تماس صوتی"
        );
    }

    /* =====================================================
       CHAT
       ===================================================== */

    async function openChat(user) {
        if (!user) {
            return;
        }

        currentChatUser =
            user;

        updateChatHeader();
        renderUsers();

        setChatInputEnabled(true);

        /*
         * Mobile:
         * در صورت وجود کلاس‌های رایج،
         * چت را نمایش بده.
         */

        document
            .querySelector(".app")
            ?.classList.add(
                "show-chat"
            );

        if (appShell) {
            appShell.classList.add(
                "chat-open"
            );
        }

        await loadConversation();
    }

    function setChatInputEnabled(
        enabled
    ) {
        const active =
            Boolean(
                enabled
            );

        if (messageInput) {
            messageInput.disabled =
                !active;

            messageInput.placeholder =
                active
                    ? "پیامت را بنویس..."
                    : "یک کاربر را انتخاب کنید...";
        }

        if (sendButton) {
            sendButton.disabled =
                !active;
        }

        if (attachButton) {
            attachButton.disabled =
                !active;
        }

        if (voiceButton) {
            voiceButton.disabled =
                !active;
        }

        /*
         * تماس جدا از وضعیت online:
         * فقط وقتی یک کاربر انتخاب شده
         * دکمه قابل استفاده است.
         */

        updateCallButton(
            Boolean(
                active &&
                currentChatUser
            )
        );
    }

    /* =====================================================
       MESSAGES
       ===================================================== */

    async function loadConversation() {
        if (
            !currentUser ||
            !currentChatUser
        ) {
            return;
        }

        const otherId =
            getUserId(
                currentChatUser
            );

        if (!otherId) {
            return;
        }

        try {
            const data =
                await apiFetch(
                    `/api/messages/${encodeURIComponent(
                        otherId
                    )}`
                );

            const messages =
                Array.isArray(data)
                    ? data
                    : (
                        Array.isArray(
                            data?.messages
                        )
                            ? data.messages
                            : []
                    );

            renderMessages(
                messages
            );

        } catch (error) {
            console.error(
                "GAPINO messages error:",
                error
            );

            showToast(
                "دریافت پیام‌ها انجام نشد."
            );
        }
    }

    function renderMessages(
        messages
    ) {
        if (!messagesList) {
            return;
        }

        messagesList.innerHTML =
            "";

        if (
            emptyChat
        ) {
            emptyChat.style.display =
                messages.length
                    ? "none"
                    : "flex";
        }

        for (
            const message
            of messages
        ) {
            appendMessage(
                message,
                false
            );
        }

        scrollMessagesToBottom();
    }

    function appendMessage(
        message,
        scroll = true
    ) {
        if (!messagesList) {
            return;
        }

        const senderId =
            getUserId(
                message?.sender_id
                    ? {
                        id:
                            message.sender_id
                    }
                    : null
            );

        const myId =
            getUserId(
                currentUser
            );

        const mine =
            String(
                message?.sender_id
            ) === String(myId);

        const row =
            document.createElement(
                "div"
            );

        row.className =
            "message-row";

        row.classList.add(
            mine
                ? "mine"
                : "theirs"
        );

        const bubble =
            document.createElement(
                "div"
            );

        bubble.className =
            "message-bubble";

        const text =
            safeText(
                message?.content ??
                message?.text ??
                ""
            );

        const messageType =
            safeText(
                message?.message_type ||
                message?.type ||
                "text"
            );

        if (
            messageType ===
            "file"
        ) {
            const url =
                safeText(
                    message?.file_url ||
                    message?.url ||
                    ""
                );

            const fileName =
                safeText(
                    message?.file_name ||
                    "فایل"
                );

            if (url) {
                bubble.innerHTML =
                    `
                    <a
                        href="${escapeHtml(url)}"
                        target="_blank"
                        rel="noopener"
                        class="message-file-link"
                    >
                        📎 ${escapeHtml(fileName)}
                    </a>
                    `;
            } else {
                bubble.textContent =
                    fileName;
            }

        } else if (
            messageType ===
            "voice"
        ) {
            const url =
                safeText(
                    message?.file_url ||
                    message?.audio_url ||
                    message?.url ||
                    ""
                );

            if (url) {
                const audio =
                    document.createElement(
                        "audio"
                    );

                audio.controls =
                    true;

                audio.src =
                    url;

                audio.preload =
                    "metadata";

                bubble.appendChild(
                    audio
                );
            } else {
                bubble.textContent =
                    "🎙️ پیام صوتی";
            }

        } else {
            bubble.textContent =
                text;
        }

        row.appendChild(
            bubble
        );

        messagesList.appendChild(
            row
        );

        if (scroll) {
            scrollMessagesToBottom();
        }
    }

    function scrollMessagesToBottom() {
        if (!messagesContainer) {
            return;
        }

        requestAnimationFrame(
            () => {
                messagesContainer.scrollTop =
                    messagesContainer.scrollHeight;
            }
        );
    }

    async function sendMessage() {
        if (
            !currentUser ||
            !currentChatUser ||
            !messageInput
        ) {
            return;
        }

        const content =
            messageInput.value.trim();

        if (!content) {
            return;
        }

        const receiverId =
            getUserId(
                currentChatUser
            );

        if (!receiverId) {
            return;
        }

        messageInput.value = "";
        autoResizeTextarea();

        try {
            const result =
                await apiFetch(
                    "/api/messages",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body:
                            JSON.stringify({
                                receiver_id:
                                    Number(
                                        receiverId
                                    ),
                                content:
                                    content
                            })
                    }
                );

            const message =
                result?.message ||
                result;

            appendMessage(
                message,
                true
            );

            sendTyping(false);

        } catch (error) {
            console.error(
                "GAPINO send message error:",
                error
            );

            /*
             * Fallback:
             * اگر backend نسخه دیگری داشته باشد،
             * WS را هم امتحان می‌کنیم.
             */

            const sent =
                sendSocketMessage({
                    type:
                        "message",
                    receiver_id:
                        Number(
                            receiverId
                        ),
                    content:
                        content
                });

            if (!sent) {
                showToast(
                    "ارسال پیام انجام نشد."
                );
            }
        }
    }

    /* =====================================================
       TYPING
       ===================================================== */

    function sendTyping(
        isTyping
    ) {
        if (
            !currentChatUser
        ) {
            return;
        }

        sendSocketMessage({
            type:
                "typing",
            receiver_id:
                Number(
                    getUserId(
                        currentChatUser
                    )
                ),
            is_typing:
                Boolean(
                    isTyping
                )
        });
    }

    function showTyping(
        isTyping
    ) {
        if (!typingIndicator) {
            return;
        }

        typingIndicator.hidden =
            !Boolean(
                isTyping
            );
    }

    /* =====================================================
       WEBSOCKET
       ===================================================== */

    function getWebSocketUrl() {
        const protocol =
            location.protocol ===
            "https:"
                ? "wss:"
                : "ws:";

        return (
            `${protocol}//` +
            location.host +
            `/ws`
        );
    }

    function connectWebSocket() {
        if (
            manuallyClosedSocket
        ) {
            return;
        }

        if (
            socket &&
            (
                socket.readyState ===
                WebSocket.OPEN ||
                socket.readyState ===
                WebSocket.CONNECTING
            )
        ) {
            return;
        }

        const url =
            getWebSocketUrl();

        console.log(
            "GAPINO WebSocket:",
            url
        );

        try {
            socket =
                new WebSocket(
                    url
                );
        } catch (error) {
            console.error(
                "GAPINO WebSocket create error:",
                error
            );

            scheduleReconnect();
            return;
        }

        socket.addEventListener(
            "open",
            () => {
                console.log(
                    "GAPINO WebSocket connected"
                );

                clearTimeout(
                    reconnectTimer
                );

                sendSocketMessage({
                    type:
                        "online",
                    status:
                        "آنلاین"
                });
            }
        );

        socket.addEventListener(
            "message",
            event => {
                handleSocketMessage(
                    event.data
                );
            }
        );

        socket.addEventListener(
            "close",
            () => {
                console.warn(
                    "GAPINO WebSocket closed"
                );

                if (
                    !manuallyClosedSocket
                ) {
                    scheduleReconnect();
                }
            }
        );

        socket.addEventListener(
            "error",
            error => {
                console.error(
                    "GAPINO WebSocket error:",
                    error
                );
            }
        );
    }

    function scheduleReconnect() {
        if (
            manuallyClosedSocket
        ) {
            return;
        }

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer =
            setTimeout(
                () => {
                    connectWebSocket();
                },
                2500
            );
    }

    function sendSocketMessage(
        data
    ) {
        if (
            !socket ||
            socket.readyState !==
            WebSocket.OPEN
        ) {
            return false;
        }

        try {
            socket.send(
                JSON.stringify(
                    data
                )
            );

            return true;

        } catch (error) {
            console.error(
                "GAPINO socket send error:",
                error
            );

            return false;
        }
    }

    function handleSocketMessage(
        raw
    ) {
        let data;

        try {
            data =
                typeof raw ===
                "string"
                    ? JSON.parse(raw)
                    : raw;
        } catch (error) {
            console.warn(
                "Invalid WebSocket JSON:",
                error
            );
            return;
        }

        if (!data?.type) {
            return;
        }

        /*
         * ==============================
         * READY
         * ==============================
         */

        if (
            data.type ===
            "ready"
        ) {
            console.log(
                "GAPINO WebSocket ready:",
                data
            );

            return;
        }

        /*
         * ==============================
         * ONLINE
         * ==============================
         */

        if (
            data.type ===
            "online"
        ) {
            const userId =
                String(
                    data.user_id ??
                    data.sender_id ??
                    ""
                );

            updateUserOnlineState(
                userId,
                true,
                data.status
            );

            return;
        }

        /*
         * ==============================
         * OFFLINE
         * ==============================
         */

        if (
            data.type ===
            "offline"
        ) {
            const userId =
                String(
                    data.user_id ??
                    data.sender_id ??
                    ""
                );

            updateUserOnlineState(
                userId,
                false,
                "آفلاین"
            );

            return;
        }

        /*
         * ==============================
         * TYPING
         * ==============================
         */

        if (
            data.type ===
            "typing"
        ) {
            const senderId =
                String(
                    data.sender_id ??
                    data.from ??
                    ""
                );

            const selectedId =
                getUserId(
                    currentChatUser
                );

            if (
                senderId ===
                String(selectedId)
            ) {
                showTyping(
                    Boolean(
                        data.is_typing ??
                        data.value
                    )
                );
            }

            return;
        }

        /*
         * ==============================
         * MESSAGE
         * ==============================
         */

        if (
            data.type ===
            "message"
        ) {
            handleIncomingMessage(
                data
            );

            return;
        }

        /*
         * ==============================
         * CALL SIGNALING
         * ==============================
         *
         * call.js این Event را
         * دریافت می‌کند.
         */

        if (
            data.type ===
                "call_offer" ||
            data.type ===
                "call_answer" ||
            data.type ===
                "call_ice" ||
            data.type ===
                "call_reject" ||
            data.type ===
                "call_busy" ||
            data.type ===
                "call_end"
        ) {
            window.dispatchEvent(
                new CustomEvent(
                    "gapino:call",
                    {
                        detail:
                            data
                    }
                )
            );

            return;
        }
    }

    function handleIncomingMessage(
        data
    ) {
        const message =
            data.message ||
            data;

        const senderId =
            String(
                message?.sender_id ??
                data?.sender_id ??
                ""
            );

        if (
            currentChatUser &&
            senderId ===
                String(
                    getUserId(
                        currentChatUser
                    )
                )
        ) {
            appendMessage(
                message,
                true
            );
        }

        /*
         * پیام جدید:
         * فهرست کاربران را رفرش می‌کنیم.
         */

        loadUsers().catch(
            () => {}
        );
    }

    function updateUserOnlineState(
        userId,
        online,
        status
    ) {
        const user =
            users.find(
                item =>
                    String(
                        getUserId(
                            item
                        )
                    ) ===
                    String(
                        userId
                    )
            );

        if (!user) {
            return;
        }

        user.online =
            Boolean(
                online
            );

        if (status) {
            user.status =
                status;
        }

        if (
            currentChatUser &&
            String(
                getUserId(
                    currentChatUser
                )
            ) ===
            String(userId)
        ) {
            currentChatUser =
                user;

            updateChatHeader();
        }

        renderUsers();
    }

    /* =====================================================
       FILE UPLOAD
       ===================================================== */

    async function uploadFile(
        file
    ) {
        if (
            !file ||
            !currentChatUser
        ) {
            return;
        }

        const receiverId =
            getUserId(
                currentChatUser
            );

        if (!receiverId) {
            return;
        }

        try {
            const form =
                new FormData();

            form.append(
                "receiver_id",
                String(
                    receiverId
                )
            );

            form.append(
                "file",
                file
            );

            const result =
                await apiFetch(
                    "/api/upload",
                    {
                        method:
                            "POST",
                        body:
                            form
                    }
                );

            const message =
                result?.message ||
                result;

            appendMessage(
                message,
                true
            );

            showToast(
                "فایل ارسال شد."
            );

        } catch (error) {
            console.error(
                "GAPINO upload error:",
                error
            );

            showToast(
                error.message ||
                "ارسال فایل انجام نشد."
            );
        }
    }

    /* =====================================================
       VOICE MESSAGE
       ===================================================== */

    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingStream = null;

    async function toggleVoiceRecording() {
        if (
            mediaRecorder &&
            mediaRecorder.state ===
                "recording"
        ) {
            stopVoiceRecording();
            return;
        }

        try {
            if (
                !navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia
            ) {
                throw new Error(
                    "مرورگر از ضبط صدا پشتیبانی نمی‌کند."
                );
            }

            recordingStream =
                await navigator.mediaDevices.getUserMedia(
                    {
                        audio: {
                            echoCancellation:
                                true,
                            noiseSuppression:
                                true,
                            autoGainControl:
                                true
                        }
                    }
                );

            recordedChunks =
                [];

            let mimeType =
                "";

            if (
                MediaRecorder.isTypeSupported(
                    "audio/webm;codecs=opus"
                )
            ) {
                mimeType =
                    "audio/webm;codecs=opus";
            } else if (
                MediaRecorder.isTypeSupported(
                    "audio/webm"
                )
            ) {
                mimeType =
                    "audio/webm";
            }

            mediaRecorder =
                mimeType
                    ? new MediaRecorder(
                        recordingStream,
                        {
                            mimeType
                        }
                    )
                    : new MediaRecorder(
                        recordingStream
                    );

            mediaRecorder.addEventListener(
                "dataavailable",
                event => {
                    if (
                        event.data &&
                        event.data.size > 0
                    ) {
                        recordedChunks.push(
                            event.data
                        );
                    }
                }
            );

            mediaRecorder.addEventListener(
                "stop",
                async () => {
                    const blob =
                        new Blob(
                            recordedChunks,
                            {
                                type:
                                    mimeType ||
                                    "audio/webm"
                            }
                        );

                    recordingStream
                        ?.getTracks()
                        .forEach(
                            track =>
                                track.stop()
                        );

                    recordingStream =
                        null;

                    mediaRecorder =
                        null;

                    if (
                        blob.size > 0
                    ) {
                        const file =
                            new File(
                                [
                                    blob
                                ],
                                `voice-${Date.now()}.webm`,
                                {
                                    type:
                                        blob.type ||
                                        "audio/webm"
                                }
                            );

                        await uploadFile(
                            file
                        );
                    }

                    updateVoiceButton(
                        false
                    );
                }
            );

            mediaRecorder.start();

            updateVoiceButton(
                true
            );

            showToast(
                "در حال ضبط صدا..."
            );

        } catch (error) {
            console.error(
                "Voice recording error:",
                error
            );

            recordingStream
                ?.getTracks()
                .forEach(
                    track =>
                        track.stop()
                );

            recordingStream =
                null;

            mediaRecorder =
                null;

            showToast(
                error.message ||
                "ضبط صدا انجام نشد."
            );
        }
    }

    function stopVoiceRecording() {
        if (
            mediaRecorder &&
            mediaRecorder.state ===
                "recording"
        ) {
            mediaRecorder.stop();
        }
    }

    function updateVoiceButton(
        recording
    ) {
        if (!voiceButton) {
            return;
        }

        voiceButton.textContent =
            recording
                ? "⏹️"
                : "🎙️";

        voiceButton.title =
            recording
                ? "توقف ضبط"
                : "ضبط صدا";
    }

    /* =====================================================
       PROFILE
       ===================================================== */

    function openProfile() {
        if (!profileModal) {
            return;
        }

        if (profileDisplayName) {
            profileDisplayName.value =
                currentUser?.display_name ||
                currentUser?.name ||
                "";
        }

        if (profileBio) {
            profileBio.value =
                currentUser?.bio ||
                "";
        }

        renderAvatar(
            profileAvatarPreview,
            currentUser
        );

        profileModal.hidden =
            false;
    }

    function closeProfile() {
        if (profileModal) {
            profileModal.hidden =
                true;
        }
    }

    async function saveProfile() {
        if (!currentUser) {
            return;
        }

        const displayName =
            String(
                profileDisplayName?.value ||
                ""
            ).trim();

        const bio =
            String(
                profileBio?.value ||
                ""
            ).trim();

        if (!displayName) {
            showToast(
                "نام نمایشی را وارد کن."
            );
            return;
        }

        try {
            const data =
                await apiFetch(
                    "/api/profile",
                    {
                        method:
                            "PUT",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body:
                            JSON.stringify({
                                display_name:
                                    displayName,
                                bio:
                                    bio,
                                status:
                                    currentUser?.status ||
                                    ""
                            })
                    }
                );

            currentUser =
                data?.user ||
                currentUser;

            localStorage.setItem(
                "gapino_user",
                JSON.stringify(
                    currentUser
                )
            );

            renderCurrentUser();

            if (
                currentChatUser &&
                getUserId(
                    currentChatUser
                ) ===
                getUserId(
                    currentUser
                )
            ) {
                currentChatUser =
                    currentUser;

                updateChatHeader();
            }

            closeProfile();

            showToast(
                "پروفایل ذخیره شد."
            );

            loadUsers().catch(
                () => {}
            );

        } catch (error) {
            console.error(
                "Profile error:",
                error
            );

            showToast(
                error.message ||
                "ذخیره پروفایل انجام نشد."
            );
        }
    }

    /* =====================================================
       LOGOUT - FIXED
       ===================================================== */

    async function logout() {
        /*
         * ابتدا وضعیت را محلی پاک می‌کنیم تا
         * حتی اگر شبکه مشکل داشت، حساب قبلی
         * روی صفحه باقی نماند.
         */

        manuallyClosedSocket =
            true;

        clearTimeout(
            reconnectTimer
        );

        clearInterval(
            usersRefreshTimer
        );

        clearTimeout(
            typingTimer
        );

        try {
            sendSocketMessage({
                type:
                    "offline",
                status:
                    "آفلاین"
            });
        } catch (_) {}

        if (socket) {
            try {
                socket.close();
            } catch (_) {}

            socket = null;
        }

        /*
         * پایان تماس جاری
         */

        try {
            if (
                window.GAPINO_CALL &&
                typeof
                    window.GAPINO_CALL.end ===
                    "function"
            ) {
                window.GAPINO_CALL.end();
            }
        } catch (_) {}

        /*
         * درخواست واقعی Logout
         */

        try {
            await fetch(
                API +
                    "/api/logout",
                {
                    method:
                        "POST",
                    credentials:
                        "include",
                    cache:
                        "no-store",
                    headers: {
                        "Content-Type":
                            "application/json"
                    }
                }
            );
        } catch (error) {
            console.warn(
                "GAPINO logout request error:",
                error
            );
        }

        /*
         * پاک کردن اطلاعات محلی
         */

        currentUser = null;
        currentChatUser = null;

        localStorage.removeItem(
            "gapino_user"
        );

        /*
         * پاک کردن کلیدهای قدیمی
         * در صورت وجود.
         */

        try {
            localStorage.removeItem(
                "user"
            );

            localStorage.removeItem(
                "currentUser"
            );

            sessionStorage.clear();
        } catch (_) {}

        /*
         * رفتن به Login
         */

        window.location.replace(
            "/login.html?logout=1"
        );
    }

    /* =====================================================
       MESSAGE SEARCH
       ===================================================== */

    function openMessageSearch() {
        if (!messageSearchModal) {
            return;
        }

        messageSearchModal.hidden =
            false;

        setTimeout(() => {
            messageSearchInput?.focus();
        }, 50);
    }

    function closeMessageSearch() {
        if (messageSearchModal) {
            messageSearchModal.hidden =
                true;
        }
    }

    async function searchMessages() {
        if (
            !messageSearchResults ||
            !currentChatUser
        ) {
            return;
        }

        const query =
            String(
                messageSearchInput?.value ||
                ""
            ).trim().toLowerCase();

        if (!query) {
            messageSearchResults.innerHTML =
                "";
            return;
        }

        try {
            const otherId =
                getUserId(
                    currentChatUser
                );

            const data =
                await apiFetch(
                    `/api/messages/${encodeURIComponent(
                        otherId
                    )}`
                );

            const messages =
                Array.isArray(data)
                    ? data
                    : (
                        Array.isArray(
                            data?.messages
                        )
                            ? data.messages
                            : []
                    );

            const matches =
                messages.filter(
                    message =>
                        safeText(
                            message?.content
                        )
                            .toLowerCase()
                            .includes(query)
                );

            messageSearchResults.innerHTML =
                "";

            if (
                matches.length === 0
            ) {
                messageSearchResults.innerHTML =
                    `
                    <div class="loading-users">
                        پیامی پیدا نشد.
                    </div>
                    `;
                return;
            }

            for (
                const message
                of matches
            ) {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    "message-search-item";

                item.textContent =
                    safeText(
                        message?.content
                    );

                messageSearchResults.appendChild(
                    item
                );
            }

        } catch (error) {
            console.error(
                "Message search error:",
                error
            );

            showToast(
                "جستجوی پیام انجام نشد."
            );
        }
    }

    /* =====================================================
       UI EVENTS
       ===================================================== */

    function autoResizeTextarea() {
        if (!messageInput) {
            return;
        }

        messageInput.style.height =
            "auto";

        messageInput.style.height =
            Math.min(
                messageInput.scrollHeight,
                160
            ) + "px";
    }

    function setupEvents() {
        userSearch?.addEventListener(
            "input",
            renderUsers
        );

        sendButton?.addEventListener(
            "click",
            sendMessage
        );

        messageInput?.addEventListener(
            "input",
            () => {
                autoResizeTextarea();

                sendTyping(true);

                clearTimeout(
                    typingTimer
                );

                typingTimer =
                    setTimeout(
                        () => {
                            sendTyping(
                                false
                            );
                        },
                        900
                    );
            }
        );

        messageInput?.addEventListener(
            "keydown",
            event => {
                if (
                    event.key ===
                    "Enter" &&
                    !event.shiftKey
                ) {
                    event.preventDefault();
                    sendMessage();
                }
            }
        );

        attachButton?.addEventListener(
            "click",
            () => {
                fileInput?.click();
            }
        );

        fileInput?.addEventListener(
            "change",
            async () => {
                const file =
                    fileInput?.files?.[0];

                if (file) {
                    await uploadFile(
                        file
                    );
                }

                if (fileInput) {
                    fileInput.value =
                        "";
                }
            }
        );

        voiceButton?.addEventListener(
            "click",
            toggleVoiceRecording
        );

        profileButton?.addEventListener(
            "click",
            openProfile
        );

        closeProfileModal?.addEventListener(
            "click",
            closeProfile
        );

        saveProfileButton?.addEventListener(
            "click",
            saveProfile
        );

        chatSearchButton?.addEventListener(
            "click",
            openMessageSearch
        );

        closeMessageSearchModal?.addEventListener(
            "click",
            closeMessageSearch
        );

        messageSearchInput?.addEventListener(
            "input",
            searchMessages
        );

        /*
         * منوی بالا:
         * فعلاً یک Toast ساده.
         */

        chatMenuButton?.addEventListener(
            "click",
            () => {
                showToast(
                    "منوی گفتگو"
                );
            }
        );

        /*
         * خروج - مهم
         */

        logoutButton?.addEventListener(
            "click",
            async event => {
                event.preventDefault();
                await logout();
            }
        );

        /*
         * تماس صوتی
         */

        callButton?.addEventListener(
            "click",
            event => {
                event.preventDefault();

                console.log(
                    "GAPINO call button clicked"
                );

                if (
                    !currentChatUser
                ) {
                    showToast(
                        "ابتدا یک کاربر را انتخاب کن."
                    );
                    return;
                }

                if (
                    !window.GAPINO_CALL ||
                    typeof
                        window.GAPINO_CALL.start !==
                        "function"
                ) {
                    showToast(
                        "سیستم تماس هنوز آماده نیست."
                    );
                    return;
                }

                try {
                    window.GAPINO_CALL.start();
                } catch (error) {
                    console.error(
                        "GAPINO call start error:",
                        error
                    );

                    showToast(
                        "شروع تماس انجام نشد."
                    );
                }
            }
        );

        /*
         * بستن مودال با کلیک بیرون
         */

        profileModal?.addEventListener(
            "click",
            event => {
                if (
                    event.target ===
                    profileModal
                ) {
                    closeProfile();
                }
            }
        );

        messageSearchModal?.addEventListener(
            "click",
            event => {
                if (
                    event.target ===
                    messageSearchModal
                ) {
                    closeMessageSearch();
                }
            }
        );
    }

    /* =====================================================
       REFRESH USERS
       ===================================================== */

    function startUsersRefresh() {
        clearInterval(
            usersRefreshTimer
        );

        usersRefreshTimer =
            setInterval(
                () => {
                    loadUsers().catch(
                        () => {}
                    );
                },
                10000
            );
    }

    /* =====================================================
       EXPOSE GAPINO
       ===================================================== */

    function exposeGlobal() {
        window.GAPINO = {
            get currentUser() {
                return currentUser;
            },

            get currentChatUser() {
                return currentChatUser;
            },

            get users() {
                return users;
            },

            get socket() {
                return socket;
            },

            showToast,

            sendTyping,

            openChat,

            loadUsers,

            loadConversation,

            logout
        };
    }

    /* =====================================================
       BOOT
       ===================================================== */

    async function init() {
        exposeGlobal();
        setupEvents();

        setChatInputEnabled(false);

        const user =
            await loadCurrentUser();

        if (!user) {
            return;
        }

        /*
         * بعد از ورود، اتصال WebSocket
         * ایجاد می‌شود.
         */

        manuallyClosedSocket =
            false;

        connectWebSocket();

        await loadUsers();

        startUsersRefresh();

        /*
         * دکمه تماس در شروع خاموش است
         * تا کاربر یک گفتگو را انتخاب کند.
         */

        updateCallButton(
            Boolean(
                currentChatUser
            )
        );

        console.log(
            "GAPINO chat initialized"
        );
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once: true
            }
        );
    } else {
        init();
    }
})();
