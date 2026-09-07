"use strict";

/* =========================================================
   GAPINO PRO - CHAT.JS
   هماهنگ با:
   - chat.html نهایی
   - main.py فعلی
   - FastAPI Session
   - WebSocket /ws
   - Private Chat
   - Users
   - Typing
   - File Upload
   - Voice Messages
   - Profile
   - Message Search
   - Voice Call signaling
   - Active Live refresh
   ========================================================= */

(() => {
    /* =====================================================
       CONFIG
       ===================================================== */

    const API =
        window.GAPINO_API_BASE ||
        window.location.origin;

    const WS_PROTOCOL =
        window.location.protocol === "https:"
            ? "wss:"
            : "ws:";

    const WS_URL =
        `${WS_PROTOCOL}//${window.location.host}/ws`;

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
    let pingTimer = null;

    let manuallyClosedSocket = false;
    let socketConnecting = false;

    let mediaRecorder = null;
    let recordingStream = null;
    let recordedChunks = [];

    /* =====================================================
       DOM
       ===================================================== */

    const $ = id =>
        document.getElementById(id);

    const appShell =
        $("appShell");

    const sidebar =
        $("sidebar");

    const chatArea =
        $("chatArea");

    const usersList =
        $("usersList");

    const userSearch =
        $("userSearch");

    const chatAvatar =
        $("chatAvatar");

    const chatUserName =
        $("chatUserName");

    const chatUserStatus =
        $("chatUserStatus");

    const messagesContainer =
        $("messagesContainer");

    const messagesList =
        $("messagesList");

    const emptyChat =
        $("emptyChat");

    const typingIndicator =
        $("typingIndicator");

    const messageInput =
        $("messageInput");

    const sendButton =
        $("sendButton");

    const attachButton =
        $("attachButton");

    const fileInput =
        $("fileInput");

    const attachmentPreview =
        $("attachmentPreview");

    const voiceButton =
        $("voiceButton");

    const callButton =
        $("callButton");

    const profileButton =
        $("profileButton");

    const logoutButton =
        $("logoutButton");

    const profileModal =
        $("profileModal");

    const closeProfileModal =
        $("closeProfileModal");

    const profileDisplayName =
        $("profileDisplayName");

    const profileBio =
        $("profileBio");

    const profileAvatarPreview =
        $("profileAvatarPreview");

    const saveProfileButton =
        $("saveProfileButton");

    const chatSearchButton =
        $("chatSearchButton");

    const chatMenuButton =
        $("chatMenuButton");

    const messageSearchModal =
        $("messageSearchModal");

    const closeMessageSearchModal =
        $("closeMessageSearchModal");

    const messageSearchInput =
        $("messageSearchInput");

    const messageSearchResults =
        $("messageSearchResults");

    const toastContainer =
        $("toastContainer");

    /* =====================================================
       UTILITIES
       ===================================================== */

    function safeText(value) {
        return String(
            value ?? ""
        );
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

        const value =
            String(
                avatar
            ).trim();

        if (
            value.startsWith(
                "http://"
            ) ||
            value.startsWith(
                "https://"
            )
        ) {
            return value;
        }

        if (
            value.startsWith("/")
        ) {
            return value;
        }

        return "/" + value;
    }

    function getAvatarLetter(user) {

        const name =
            getUserName(
                user
            ).trim();

        return (
            name.charAt(0)
                .toUpperCase() ||
            "G"
        );
    }

    function escapeHtml(value) {

        return safeText(
            value
        )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
    }

    function renderAvatar(
        element,
        user
    ) {

        if (!element) {
            return;
        }

        element.innerHTML = "";

        const url =
            getAvatarUrl(
                user
            );

        if (!url) {

            element.textContent =
                getAvatarLetter(
                    user
                );

            return;
        }

        const image =
            document.createElement(
                "img"
            );

        image.src =
            url;

        image.alt =
            getUserName(
                user
            );

        image.loading =
            "lazy";

        image.decoding =
            "async";

        image.onerror =
            () => {

                element.innerHTML =
                    "";

                element.textContent =
                    getAvatarLetter(
                        user
                    );
            };

        element.appendChild(
            image
        );
    }

    function isOnline(
        user
    ) {

        return (
            user?.online === true ||
            user?.is_online === true ||
            user?.status ===
                "آنلاین" ||
            user?.status ===
                "online"
        );
    }

    /* =====================================================
       TOAST
       ===================================================== */

    function showToast(
        message,
        timeout = 2500
    ) {

        const text =
            safeText(
                message
            );

        if (!toastContainer) {
            console.log(
                "GAPINO:",
                text
            );
            return;
        }

        const toast =
            document.createElement(
                "div"
            );

        toast.className =
            "gapino-toast";

        toast.textContent =
            text;

        toastContainer.appendChild(
            toast
        );

        window.setTimeout(
            () => {

                toast.style.opacity =
                    "0";

                toast.style.transform =
                    "translateY(8px)";

                toast.style.transition =
                    "opacity .2s ease, transform .2s ease";

                window.setTimeout(
                    () => {
                        toast.remove();
                    },
                    220
                );

            },
            timeout
        );
    }

    /* =====================================================
       API
       ===================================================== */

    async function apiFetch(
        path,
        options = {}
    ) {

        const config = {
            credentials:
                "include",

            cache:
                "no-store",

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
       SESSION
       ===================================================== */

    async function loadCurrentUser() {

        try {

            const data =
                await apiFetch(
                    "/api/me"
                );

            /*
             * main.py:
             * public_user مستقیم
             */

            const user =
                data?.user ||
                (
                    data?.id
                        ? data
                        : null
                );

            if (
                !user ||
                !user.id
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

            try {
                localStorage.removeItem(
                    "gapino_user"
                );
            } catch (_) {}

            window.location.replace(
                "/login.html"
            );

            return null;
        }
    }

    function renderCurrentUser() {

        if (!currentUser) {
            return;
        }

        const currentUserName =
            $("currentUserName") ||
            $("myUsername");

        const currentUserUsername =
            $("currentUserUsername");

        const currentUserAvatar =
            $("currentUserAvatar") ||
            $("myAvatar");

        if (currentUserName) {

            currentUserName.textContent =
                getUserName(
                    currentUser
                );
        }

        if (currentUserUsername) {

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

            if (
                Array.isArray(
                    data
                )
            ) {
                users =
                    data;
            } else if (
                Array.isArray(
                    data?.users
                )
            ) {
                users =
                    data.users;
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
                    <div class="loading-users"
                         style="
                            padding:20px;
                            text-align:center;
                            opacity:.65;
                         ">
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

        usersList.innerHTML =
            "";

        const filtered =
            users.filter(
                user => {

                    const name =
                        getUserName(
                            user
                        )
                        .toLowerCase();

                    const username =
                        safeText(
                            user?.username
                        )
                        .toLowerCase();

                    return (
                        !query ||
                        name.includes(
                            query
                        ) ||
                        username.includes(
                            query
                        )
                    );
                }
            );

        if (
            filtered.length === 0
        ) {

            usersList.innerHTML =
                `
                <div
                    class="loading-users"
                    style="
                        padding:20px;
                        text-align:center;
                        opacity:.65;
                    "
                >
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

            item.type =
                "button";

            item.className =
                "user-item";

            if (
                currentChatUser &&
                getUserId(user) ===
                getUserId(
                    currentChatUser
                )
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
                getUserName(
                    user
                );

            const status =
                document.createElement(
                    "span"
                );

            status.textContent =
                isOnline(user)
                    ? "آنلاین"
                    : (
                        user?.status ||
                        "آفلاین"
                    );

            info.appendChild(
                name
            );

            info.appendChild(
                status
            );

            item.appendChild(
                avatar
            );

            item.appendChild(
                info
            );

            item.addEventListener(
                "click",
                () => {
                    openChat(
                        user
                    );
                }
            );

            usersList.appendChild(
                item
            );
        }
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
                        getUserId(item)
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
            String(
                userId
            )
        ) {

            currentChatUser =
                user;

            updateChatHeader();
        }

        renderUsers();
    }

    /* =====================================================
       CHAT HEADER
       ===================================================== */

    function updateChatHeader() {

        if (
            !currentChatUser
        ) {

            if (chatUserName) {
                chatUserName.textContent =
                    "انتخاب گفتگو";
            }

            if (chatUserStatus) {
                chatUserStatus.textContent =
                    "یک کاربر را انتخاب کنید";
            }

            if (chatAvatar) {
                chatAvatar.innerHTML =
                    "G";
            }

            updateCallButton(
                false
            );

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
                isOnline(
                    currentChatUser
                )
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

        updateCallButton(
            true
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
            !Boolean(
                enabled
            );

        callButton.title =
            enabled
                ? "تماس صوتی"
                : "ابتدا یک کاربر را انتخاب کنید";
    }

    /* =====================================================
       OPEN CHAT
       ===================================================== */

    async function openChat(
        user
    ) {

        if (!user) {
            return;
        }

        currentChatUser =
            user;

        updateChatHeader();

        renderUsers();

        setChatInputEnabled(
            true
        );

        if (appShell) {

            appShell.classList.add(
                "chat-open"
            );
        }

        /*
         * سازگاری با نسخه‌های قدیمی
         */

        const legacyApp =
            document.querySelector(
                ".app"
            );

        if (legacyApp) {

            legacyApp.classList.add(
                "show-chat"
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

        updateCallButton(
            active &&
            Boolean(
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

        if (emptyChat) {

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

        const myId =
            getUserId(
                currentUser
            );

        const mine =
            String(
                message?.sender_id ??
                ""
            ) ===
            String(
                myId
            );

        const row =
            document.createElement(
                "div"
            );

        row.className =
            "message-row " +
            (
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

        const deleted =
            Number(
                message?.deleted ||
                0
            ) === 1;

        if (deleted) {

            bubble.textContent =
                "پیام حذف شده";

            bubble.style.opacity =
                "0.65";

        } else {

            const fileUrl =
                safeText(
                    message?.file_url
                );

            const fileName =
                safeText(
                    message?.file_name
                );

            const mime =
                safeText(
                    message?.mime_type
                )
                .toLowerCase();

            if (
                fileUrl
            ) {

                /*
                 * تصویر
                 */

                if (
                    mime.startsWith(
                        "image/"
                    )
                ) {

                    const image =
                        document.createElement(
                            "img"
                        );

                    image.src =
                        fileUrl;

                    image.alt =
                        fileName ||
                        "تصویر";

                    image.loading =
                        "lazy";

                    image.style.maxWidth =
                        "min(280px, 75vw)";

                    image.style.maxHeight =
                        "360px";

                    image.style.borderRadius =
                        "14px";

                    image.style.display =
                        "block";

                    bubble.appendChild(
                        image
                    );

                    if (fileName) {

                        const name =
                            document.createElement(
                                "div"
                            );

                        name.textContent =
                            fileName;

                        name.style.fontSize =
                            "11px";

                        name.style.marginTop =
                            "6px";

                        name.style.opacity =
                            "0.72";

                        bubble.appendChild(
                            name
                        );
                    }
                }

                /*
                 * صوت
                 */

                else if (
                    mime.startsWith(
                        "audio/"
                    )
                ) {

                    const audio =
                        document.createElement(
                            "audio"
                        );

                    audio.controls =
                        true;

                    audio.preload =
                        "metadata";

                    audio.src =
                        fileUrl;

                    bubble.appendChild(
                        audio
                    );
                }

                /*
                 * ویدئو
                 */

                else if (
                    mime.startsWith(
                        "video/"
                    )
                ) {

                    const video =
                        document.createElement(
                            "video"
                        );

                    video.controls =
                        true;

                    video.preload =
                        "metadata";

                    video.src =
                        fileUrl;

                    video.style.maxWidth =
                        "min(320px, 75vw)";

                    video.style.maxHeight =
                        "360px";

                    video.style.borderRadius =
                        "14px";

                    bubble.appendChild(
                        video
                    );
                }

                /*
                 * فایل عادی
                 */

                else {

                    const link =
                        document.createElement(
                            "a"
                        );

                    link.href =
                        fileUrl;

                    link.target =
                        "_blank";

                    link.rel =
                        "noopener noreferrer";

                    link.className =
                        "message-file-link";

                    link.textContent =
                        "📎 " +
                        (
                            fileName ||
                            "فایل"
                        );

                    bubble.appendChild(
                        link
                    );
                }

            } else {

                const text =
                    safeText(
                        message?.text
                    );

                bubble.textContent =
                    text ||
                    "پیام";
            }

            if (
                Number(
                    message?.edited ||
                    0
                ) === 1
            ) {

                const edited =
                    document.createElement(
                        "span"
                    );

                edited.textContent =
                    " ویرایش‌شده";

                edited.style.fontSize =
                    "10px";

                edited.style.opacity =
                    "0.6";

                edited.style.marginInlineStart =
                    "4px";

                bubble.appendChild(
                    edited
                );
            }
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

    /* =====================================================
       SEND MESSAGE
       ===================================================== */

    async function sendMessage() {

        if (
            !currentUser ||
            !currentChatUser ||
            !messageInput
        ) {
            return;
        }

        const text =
            String(
                messageInput.value ||
                ""
            ).trim();

        if (!text) {
            return;
        }

        if (text.length > 5000) {

            showToast(
                "پیام نمی‌تواند بیشتر از ۵۰۰۰ کاراکتر باشد."
            );

            return;
        }

        const receiverId =
            getUserId(
                currentChatUser
            );

        if (!receiverId) {
            return;
        }

        /*
         * پاک کردن سریع ورودی
         */

        messageInput.value =
            "";

        autoResizeTextarea();

        sendTyping(
            false
        );

        try {

            /*
             * main.py:
             * {receiver_id, text}
             */

            const result =
                await apiFetch(
                    "/api/messages",
                    {
                        method:
                            "POST",

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

                                text:
                                    text
                            })
                    }
                );

            const message =
                result?.message ||
                result;

            if (
                message &&
                message.id
            ) {

                appendMessage(
                    message,
                    true
                );
            }

        } catch (error) {

            console.error(
                "GAPINO send message error:",
                error
            );

            /*
             * fallback به WebSocket
             */

            const sent =
                sendSocketMessage({
                    type:
                        "message",

                    receiver_id:
                        Number(
                            receiverId
                        ),

                    text:
                        text
                });

            if (!sent) {

                showToast(
                    error.message ||
                    "ارسال پیام انجام نشد."
                );

                /*
                 * در صورت خطا، متن را
                 * دوباره داخل ورودی برگردان.
                 */

                messageInput.value =
                    text;

                autoResizeTextarea();
            }
        }
    }

    /* =====================================================
       TYPING
       ===================================================== */

    function sendTyping(
        value
    ) {

        if (!currentChatUser) {
            return;
        }

        const receiverId =
            getUserId(
                currentChatUser
            );

        if (!receiverId) {
            return;
        }

        sendSocketMessage({
            type:
                "typing",

            receiver_id:
                Number(
                    receiverId
                ),

            value:
                Boolean(
                    value
                )
        });
    }

    function showTyping(
        value
    ) {

        if (!typingIndicator) {
            return;
        }

        typingIndicator.hidden =
            !Boolean(
                value
            );
    }

    /* =====================================================
       WEBSOCKET
       ===================================================== */

    function connectWebSocket() {

        if (
            manuallyClosedSocket ||
            socketConnecting
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

        socketConnecting =
            true;

        clearTimeout(
            reconnectTimer
        );

        console.log(
            "GAPINO WebSocket connecting:",
            WS_URL
        );

        try {

            socket =
                new WebSocket(
                    WS_URL
                );

        } catch (error) {

            socketConnecting =
                false;

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

                socketConnecting =
                    false;

                console.log(
                    "GAPINO WebSocket connected"
                );

                clearTimeout(
                    reconnectTimer
                );

                clearInterval(
                    pingTimer
                );

                pingTimer =
                    setInterval(
                        () => {

                            sendSocketMessage({
                                type:
                                    "ping"
                            });

                        },
                        25000
                    );

                /*
                 * وضعیت آنلاین
                 */

                sendSocketMessage({
                    type:
                        "online"
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
            event => {

                socketConnecting =
                    false;

                console.warn(
                    "GAPINO WebSocket closed:",
                    event.code,
                    event.reason || ""
                );

                clearInterval(
                    pingTimer
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

                socketConnecting =
                    false;

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
                "GAPINO WebSocket send error:",
                error
            );

            return false;
        }
    }

    /* =====================================================
       SOCKET MESSAGE HANDLER
       ===================================================== */

    function handleSocketMessage(
        raw
    ) {

        let data = null;

        try {

            data =
                typeof raw ===
                "string"
                    ? JSON.parse(raw)
                    : raw;

        } catch (error) {

            console.warn(
                "Invalid GAPINO WebSocket JSON:",
                error
            );

            return;
        }

        if (
            !data ||
            !data.type
        ) {
            return;
        }

        const type =
            String(
                data.type
            )
            .trim()
            .toLowerCase();

        /*
         * READY
         */

        if (
            type === "ready"
        ) {

            console.log(
                "GAPINO WebSocket ready"
            );

            return;
        }

        /*
         * PONG
         */

        if (
            type === "pong"
        ) {
            return;
        }

        /*
         * USER ONLINE
         *
         * main.py:
         * user_online
         */

        if (
            type ===
            "user_online"
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
                "آنلاین"
            );

            return;
        }

        /*
         * USER OFFLINE
         */

        if (
            type ===
            "user_offline"
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
         * TYPING
         */

        if (
            type ===
            "typing"
        ) {

            const senderId =
                String(
                    data.sender_id ??
                    data.from ??
                    ""
                );

            const selectedId =
                String(
                    getUserId(
                        currentChatUser
                    )
                );

            if (
                senderId ===
                selectedId
            ) {

                showTyping(
                    Boolean(
                        data.value
                    )
                );
            }

            return;
        }

        /*
         * MESSAGE
         */

        if (
            type ===
            "message"
        ) {

            handleIncomingMessage(
                data
            );

            return;
        }

        /*
         * CALL SIGNALING
         */

        if (
            type ===
                "call_offer" ||
            type ===
                "call_answer" ||
            type ===
                "call_ice" ||
            type ===
                "call_reject" ||
            type ===
                "call_busy" ||
            type ===
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

        /*
         * LIVE EVENTS:
         *
         * live.js هم از همین WebSocket
         * استفاده می‌کند.
         *
         * اینجا فقط لاگ می‌کنیم
         * و دخالتی در signaling آن نداریم.
         */

        if (
            type.startsWith(
                "live_"
            )
        ) {

            return;
        }
    }

    function handleIncomingMessage(
        data
    ) {

        const message =
            data?.message ||
            data;

        if (!message) {
            return;
        }

        const senderId =
            String(
                message?.sender_id ??
                data?.sender_id ??
                ""
            );

        const selectedId =
            String(
                getUserId(
                    currentChatUser
                )
            );

        /*
         * فقط اگر پیام از کاربر انتخاب‌شده باشد
         * به گفتگو اضافه می‌شود.
         */

        if (
            currentChatUser &&
            senderId ===
                selectedId
        ) {

            appendMessage(
                message,
                true
            );

            showTyping(
                false
            );

        } else {

            showToast(
                "پیام جدید دریافت شد."
            );
        }

        loadUsers().catch(
            () => {}
        );
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

        if (
            file.size >
            10 * 1024 * 1024
        ) {

            showToast(
                "حداکثر حجم فایل ۱۰ مگابایت است."
            );

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

            if (
                message &&
                message.id
            ) {

                appendMessage(
                    message,
                    true
                );
            }

            showToast(
                "فایل ارسال شد."
            );

            if (
                attachmentPreview
            ) {

                attachmentPreview.hidden =
                    true;

                attachmentPreview.innerHTML =
                    "";
            }

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
       VOICE RECORDING
       ===================================================== */

    async function toggleVoiceRecording() {

        if (
            mediaRecorder &&
            mediaRecorder.state ===
                "recording"
        ) {

            stopVoiceRecording();

            return;
        }

        if (
            !currentChatUser
        ) {

            showToast(
                "ابتدا یک کاربر را انتخاب کن."
            );

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
                typeof MediaRecorder !==
                "undefined"
            ) {

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
                            track => {
                                try {
                                    track.stop();
                                } catch (_) {}
                            }
                        );

                    recordingStream =
                        null;

                    mediaRecorder =
                        null;

                    updateVoiceButton(
                        false
                    );

                    if (
                        blob.size <= 0
                    ) {
                        return;
                    }

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
                "GAPINO voice error:",
                error
            );

            recordingStream
                ?.getTracks()
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch (_) {}
                    }
                );

            recordingStream =
                null;

            mediaRecorder =
                null;

            updateVoiceButton(
                false
            );

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
                currentUser?.username ||
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
                                    currentUser.status ||
                                    "در دسترس"
                            })
                    }
                );

            if (data?.user) {

                currentUser =
                    data.user;

                localStorage.setItem(
                    "gapino_user",
                    JSON.stringify(
                        currentUser
                    )
                );

                renderCurrentUser();
            }

            closeProfile();

            showToast(
                "پروفایل ذخیره شد."
            );

            await loadUsers();

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

        } catch (error) {

            console.error(
                "GAPINO profile error:",
                error
            );

            showToast(
                error.message ||
                "ذخیره پروفایل انجام نشد."
            );
        }
    }

    /* =====================================================
       LOGOUT
       ===================================================== */

    async function logout() {

        manuallyClosedSocket =
            true;

        clearTimeout(
            reconnectTimer
        );

        clearInterval(
            usersRefreshTimer
        );

        clearInterval(
            pingTimer
        );

        clearTimeout(
            typingTimer
        );

        try {

            if (
                window.GAPINO_CALL &&
                typeof
                    window.GAPINO_CALL.end ===
                    "function"
            ) {

                await Promise.resolve(
                    window.GAPINO_CALL.end()
                );

            }

        } catch (_) {}

        try {

            if (
                mediaRecorder &&
                mediaRecorder.state ===
                    "recording"
            ) {

                mediaRecorder.stop();
            }

        } catch (_) {}

        try {

            recordingStream
                ?.getTracks()
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch (_) {}
                    }
                );

        } catch (_) {}

        recordingStream =
            null;

        try {

            sendSocketMessage({
                type:
                    "offline"
            });

        } catch (_) {}

        if (socket) {

            try {
                socket.close();
            } catch (_) {}

            socket =
                null;
        }

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
                        "no-store"
                }
            );

        } catch (error) {

            console.warn(
                "GAPINO logout request error:",
                error
            );
        }

        currentUser =
            null;

        currentChatUser =
            null;

        users = [];

        try {

            localStorage.removeItem(
                "gapino_user"
            );

            localStorage.removeItem(
                "user"
            );

            localStorage.removeItem(
                "currentUser"
            );

            sessionStorage.clear();

        } catch (_) {}

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

        if (
            !currentChatUser
        ) {

            showToast(
                "ابتدا یک گفتگو را انتخاب کن."
            );

            return;
        }

        messageSearchModal.hidden =
            false;

        if (messageSearchInput) {

            messageSearchInput.value =
                "";

            window.setTimeout(
                () => {
                    messageSearchInput.focus();
                },
                60
            );
        }

        if (messageSearchResults) {

            messageSearchResults.innerHTML =
                "";
        }
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
            )
            .trim()
            .toLowerCase();

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
                            message?.text
                        )
                        .toLowerCase()
                        .includes(
                            query
                        )
                );

            messageSearchResults.innerHTML =
                "";

            if (
                matches.length === 0
            ) {

                messageSearchResults.innerHTML =
                    `
                    <div
                        class="message-search-item"
                        style="
                            opacity:.65;
                            text-align:center;
                        "
                    >
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
                        "button"
                    );

                item.type =
                    "button";

                item.className =
                    "message-search-item";

                item.style.width =
                    "100%";

                item.style.border =
                    "0";

                item.style.cursor =
                    "pointer";

                item.style.textAlign =
                    "right";

                item.textContent =
                    safeText(
                        message?.text ||
                        "پیام"
                    );

                item.addEventListener(
                    "click",
                    () => {

                        closeMessageSearch();

                        scrollToMessage(
                            message
                        );
                    }
                );

                messageSearchResults.appendChild(
                    item
                );
            }

        } catch (error) {

            console.error(
                "GAPINO message search error:",
                error
            );

            showToast(
                "جستجوی پیام انجام نشد."
            );
        }
    }

    function scrollToMessage(
        message
    ) {

        if (!messagesList) {
            return;
        }

        const messageText =
            safeText(
                message?.text
            );

        const bubbles =
            messagesList.querySelectorAll(
                ".message-bubble"
            );

        for (
            const bubble
            of bubbles
        ) {

            if (
                bubble.textContent ===
                messageText
            ) {

                bubble.scrollIntoView({
                    behavior:
                        "smooth",

                    block:
                        "center"
                });

                bubble.style.boxShadow =
                    "0 0 0 3px rgba(34,158,217,.35)";

                window.setTimeout(
                    () => {

                        bubble.style.boxShadow =
                            "";

                    },
                    1200
                );

                break;
            }
        }
    }

    /* =====================================================
       ACTIVE LIVE ROOMS
       ===================================================== */

    async function refreshActiveLives() {

        const section =
            $("activeLivesSection");

        const list =
            $("activeLivesList");

        if (
            !section ||
            !list
        ) {
            return;
        }

        try {

            const response =
                await fetch(
                    API +
                    "/api/live/active",
                    {
                        method:
                            "GET",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );

            if (
                !response.ok
            ) {

                section.hidden =
                    true;

                list.innerHTML =
                    "";

                return;
            }

            const data =
                await response.json();

            const rooms =
                Array.isArray(
                    data?.live_rooms
                )
                    ? data.live_rooms
                    : [];

            list.innerHTML =
                "";

            if (
                rooms.length === 0
            ) {

                section.hidden =
                    true;

                return;
            }

            section.hidden =
                false;

            for (
                const room
                of rooms
            ) {

                const roomId =
                    String(
                        room?.room_id ||
                        ""
                    ).trim();

                if (!roomId) {
                    continue;
                }

                const host =
                    room?.host ||
                    {};

                const name =
                    getUserName(
                        host
                    );

                const viewerCount =
                    Math.max(
                        0,
                        Number(
                            room?.viewer_count
                        ) || 0
                    );

                const item =
                    document.createElement(
                        "button"
                    );

                item.type =
                    "button";

                item.className =
                    "active-live-item";

                item.dataset.room =
                    roomId;

                item.title =
                    "ورود به لایو " +
                    name;

                const avatar =
                    document.createElement(
                        "div"
                    );

                avatar.className =
                    "active-live-avatar";

                renderAvatar(
                    avatar,
                    host
                );

                const info =
                    document.createElement(
                        "div"
                    );

                info.className =
                    "active-live-info";

                const nameElement =
                    document.createElement(
                        "div"
                    );

                nameElement.className =
                    "active-live-name";

                nameElement.textContent =
                    name;

                const meta =
                    document.createElement(
                        "div"
                    );

                meta.className =
                    "active-live-meta";

                meta.textContent =
                    "👁️ " +
                    viewerCount +
                    " بیننده";

                info.appendChild(
                    nameElement
                );

                info.appendChild(
                    meta
                );

                const badge =
                    document.createElement(
                        "span"
                    );

                badge.className =
                    "active-live-badge";

                badge.textContent =
                    "LIVE";

                item.appendChild(
                    avatar
                );

                item.appendChild(
                    info
                );

                item.appendChild(
                    badge
                );

                item.addEventListener(
                    "click",
                    () => {

                        window.location.href =
                            "/live.html?room=" +
                            encodeURIComponent(
                                roomId
                            ) +
                            "&join=1";
                    }
                );

                list.appendChild(
                    item
                );
            }

            if (
                !list.children.length
            ) {

                section.hidden =
                    true;
            }

        } catch (error) {

            console.error(
                "GAPINO active lives error:",
                error
            );

            section.hidden =
                true;
        }
    }

    /* =====================================================
       TEXTAREA
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
                150
            ) + "px";
    }

    /* =====================================================
       EVENTS
       ===================================================== */

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

                sendTyping(
                    true
                );

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

                if (!currentChatUser) {

                    showToast(
                        "ابتدا یک کاربر را انتخاب کن."
                    );

                    return;
                }

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

        chatMenuButton?.addEventListener(
            "click",
            () => {

                showToast(
                    "منوی گفتگو"
                );
            }
        );

        logoutButton?.addEventListener(
            "click",
            async event => {

                event.preventDefault();

                await logout();
            }
        );

        callButton?.addEventListener(
            "click",
            event => {

                event.preventDefault();

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

        const refreshLivesButton =
            $("refreshLivesButton");

        refreshLivesButton?.addEventListener(
            "click",
            () => {

                refreshActiveLives();
            }
        );
    }

    /* =====================================================
       REFRESH
       ===================================================== */

    function startRefreshTimers() {

        clearInterval(
            usersRefreshTimer
        );

        usersRefreshTimer =
            setInterval(
                () => {

                    loadUsers().catch(
                        () => {}
                    );

                    refreshActiveLives();

                },
                10000
            );
    }

    /* =====================================================
       MOBILE BACK
       ===================================================== */

    function setupMobileBack() {

        /*
         * اگر کاربر با موبایل گفتگو را باز کرده،
         * با دکمه Back مرورگر برگردد به لیست.
         */

        let previousOpenState =
            false;

        const sync =
            () => {

                const isOpen =
                    Boolean(
                        appShell?.classList.contains(
                            "chat-open"
                        )
                    );

                if (
                    isOpen &&
                    !previousOpenState
                ) {

                    try {

                        history.pushState(
                            {
                                gapinoChat:
                                    true
                            },
                            "",
                            "#chat"
                        );

                    } catch (_) {}
                }

                previousOpenState =
                    isOpen;
            };

        window.addEventListener(
            "popstate",
            () => {

                if (
                    appShell
                ) {

                    appShell.classList.remove(
                        "chat-open"
                    );
                }

                const legacyApp =
                    document.querySelector(
                        ".app"
                    );

                legacyApp?.classList.remove(
                    "show-chat"
                );

                currentChatUser =
                    null;

                updateChatHeader();

                renderUsers();
            }
        );

        /*
         * جلوگیری از گیر کردن کاربر روی
         * صفحه گفتگو در موبایل.
         */

        window.setInterval(
            sync,
            700
        );
    }

    /* =====================================================
       GLOBAL API
       ===================================================== */

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

        openChat,

        loadUsers,

        loadConversation,

        refreshActiveLives,

        sendTyping,

        logout
    };

    /* =====================================================
       BOOT
       ===================================================== */

    async function init() {

        console.log(
            "GAPINO chat.js starting..."
        );

        setupEvents();

        setupMobileBack();

        setChatInputEnabled(
            false
        );

        const user =
            await loadCurrentUser();

        if (!user) {
            return;
        }

        manuallyClosedSocket =
            false;

        await loadUsers();

        await refreshActiveLives();

        connectWebSocket();

        startRefreshTimers();

        updateChatHeader();

        console.log(
            "GAPINO chat initialized successfully"
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
                once:
                    true
            }
        );

    } else {

        init();
    }

})();
