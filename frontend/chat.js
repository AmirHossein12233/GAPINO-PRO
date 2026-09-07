(() => {
    "use strict";

    const API =
        window.GAPINO_API_BASE ||
        window.location.origin;

    const WS_PROTOCOL =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    const WS_URL =
        `${WS_PROTOCOL}//${location.host}/ws`;

    let currentUser = null;
    let currentChatUser = null;
    let users = [];
    let socket = null;

    let reconnectTimer = null;
    let reconnectDelay = 1500;

    let typingTimer = null;
    let lastTypingState = false;

    let selectedFile = null;
    let mediaRecorder = null;
    let recordingChunks = [];
    let isRecording = false;

    let messagesCache = [];

    const $ = (id) => document.getElementById(id);

    function showToast(message) {
        const container = $("toastContainer");

        if (!container) {
            return;
        }

        const toast =
            document.createElement("div");

        toast.className = "toast";
        toast.textContent = String(message);

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    function getDisplayName(user) {
        if (!user) {
            return "کاربر";
        }

        return (
            user.display_name ||
            user.name ||
            user.username ||
            "کاربر"
        );
    }

    function getAvatar(user) {
        if (!user) {
            return "";
        }

        return (
            user.avatar ||
            user.avatar_url ||
            ""
        );
    }

    function getUserId(user) {
        if (!user) {
            return null;
        }

        const value =
            user.id ??
            user.user_id ??
            user.uid;

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        return Number(value);
    }

    function isOnline(user) {
        if (!user) {
            return false;
        }

        return (
            user.online === true ||
            user.is_online === true
        );
    }

    function escapeHTML(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatTime(value) {
        if (!value) {
            return "";
        }

        try {
            const date =
                new Date(value);

            if (
                Number.isNaN(
                    date.getTime()
                )
            ) {
                return String(value);
            }

            return date.toLocaleTimeString(
                "fa-IR",
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );
        } catch {
            return String(value);
        }
    }

    async function api(path, options = {}) {
        const headers = {
            ...(options.headers || {})
        };

        if (
            options.body &&
            typeof options.body === "object" &&
            !(options.body instanceof FormData)
        ) {
            headers["Content-Type"] =
                "application/json";

            options.body =
                JSON.stringify(options.body);
        }

        const response =
            await fetch(
                API + path,
                {
                    credentials: "include",
                    cache: "no-store",
                    ...options,
                    headers
                }
            );

        let data = null;

        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {

            const message =
                data?.detail ||
                data?.message ||
                `HTTP ${response.status}`;

            throw new Error(message);
        }

        return data;
    }

    async function loadCurrentUser() {

        const data =
            await api("/api/me");

        if (
            data &&
            data.user
        ) {
            currentUser =
                data.user;
        } else {
            currentUser =
                data;
        }

        if (
            !currentUser ||
            getUserId(currentUser) === null
        ) {
            throw new Error(
                "جلسه ورود پیدا نشد"
            );
        }

        window.GAPINO_CURRENT_USER =
            currentUser;

        return currentUser;
    }

    function renderCurrentUser() {

        if (!currentUser) {
            return;
        }

        const name =
            getDisplayName(currentUser);

        const avatar =
            getAvatar(currentUser);

        const profileName =
            $("profileDisplayName");

        const profileBio =
            $("profileBio");

        const profileAvatar =
            $("profileAvatarPreview");

        if (profileName) {
            profileName.value =
                currentUser.display_name ||
                currentUser.username ||
                "";
        }

        if (profileBio) {
            profileBio.value =
                currentUser.bio ||
                currentUser.status ||
                "";
        }

        if (
            profileAvatar &&
            avatar
        ) {
            profileAvatar.src =
                avatar;
        }

        const chatName =
            $("chatUserName");

        if (
            chatName &&
            !currentChatUser
        ) {
            chatName.textContent =
                "گفتگو";
        }

        console.debug(
            "GAPINO user:",
            name
        );
    }

    async function loadUsers() {

        const list =
            $("usersList");

        if (!list) {
            return;
        }

        list.innerHTML =
            `
            <div style="
                padding:25px;
                text-align:center;
                color:#94a3b8;
                font-size:12px;
            ">
                در حال بارگذاری کاربران...
            </div>
            `;

        try {

            const data =
                await api("/api/users");

            if (Array.isArray(data)) {
                users = data;
            } else if (
                Array.isArray(data?.users)
            ) {
                users = data.users;
            } else if (
                Array.isArray(data?.data)
            ) {
                users = data.data;
            } else {
                users = [];
            }

            const myId =
                getUserId(currentUser);

            users =
                users.filter(
                    user =>
                        getUserId(user) !== myId
                );

            renderUsers(users);

            window.GAPINO_USERS =
                users;

        } catch (error) {

            console.error(
                "loadUsers error:",
                error
            );

            list.innerHTML =
                `
                <div style="
                    padding:25px;
                    text-align:center;
                    color:#fca5a5;
                    font-size:12px;
                ">
                    دریافت کاربران ناموفق بود.
                    <br>
                    <small>${escapeHTML(error.message)}</small>
                </div>
                `;

            showToast(
                "دریافت کاربران ناموفق بود"
            );
        }
    }

    function renderUsers(items) {

        const list =
            $("usersList");

        if (!list) {
            return;
        }

        list.innerHTML = "";

        if (!items.length) {

            list.innerHTML =
                `
                <div style="
                    padding:25px;
                    text-align:center;
                    color:#94a3b8;
                    font-size:12px;
                ">
                    کاربر دیگری پیدا نشد.
                </div>
                `;

            return;
        }

        items.forEach(
            user => {

                const id =
                    getUserId(user);

                if (id === null) {
                    return;
                }

                const item =
                    document.createElement("button");

                item.type = "button";
                item.className =
                    "user-item";

                if (
                    currentChatUser &&
                    getUserId(currentChatUser) === id
                ) {
                    item.classList.add("active");
                }

                const wrap =
                    document.createElement("div");

                wrap.className =
                    "user-avatar-wrap";

                const avatar =
                    document.createElement("img");

                avatar.className =
                    "user-avatar";

                avatar.alt =
                    getDisplayName(user);

                const avatarUrl =
                    getAvatar(user);

                if (avatarUrl) {
                    avatar.src =
                        avatarUrl;
                }

                avatar.addEventListener(
                    "error",
                    () => {
                        avatar.removeAttribute("src");
                    }
                );

                const dot =
                    document.createElement("span");

                dot.className =
                    "online-dot";

                if (isOnline(user)) {
                    dot.classList.add(
                        "online"
                    );
                }

                wrap.appendChild(
                    avatar
                );

                wrap.appendChild(
                    dot
                );

                const info =
                    document.createElement("div");

                info.className =
                    "user-info";

                const name =
                    document.createElement("div");

                name.className =
                    "user-name";

                name.textContent =
                    getDisplayName(user);

                const status =
                    document.createElement("div");

                status.className =
                    "user-status";

                status.textContent =
                    user.status ||
                    (
                        isOnline(user)
                            ? "آنلاین"
                            : "آفلاین"
                    );

                info.appendChild(name);
                info.appendChild(status);

                item.appendChild(wrap);
                item.appendChild(info);

                item.addEventListener(
                    "click",
                    () => {
                        openChat(user);
                    }
                );

                list.appendChild(item);
            }
        );
    }

    function setupUserSearch() {

        const input =
            $("userSearch");

        if (!input) {
            return;
        }

        input.addEventListener(
            "input",
            () => {

                const text =
                    input.value
                        .trim()
                        .toLowerCase();

                if (!text) {
                    renderUsers(users);
                    return;
                }

                const filtered =
                    users.filter(
                        user => {

                            const name =
                                getDisplayName(
                                    user
                                ).toLowerCase();

                            const username =
                                String(
                                    user.username || ""
                                ).toLowerCase();

                            return (
                                name.includes(text) ||
                                username.includes(text)
                            );
                        }
                    );

                renderUsers(filtered);
            }
        );
    }

    async function openChat(user) {

        if (!user) {
            return;
        }

        currentChatUser =
            user;

        window.GAPINO_CURRENT_CHAT =
            user;

        const shell =
            $("appShell");

        if (shell) {
            shell.classList.add(
                "chat-open"
            );
        }

        updateChatHeader();

        enableComposer();

        renderUsers(
            users
        );

        await loadMessages(
            getUserId(user)
        );
    }

    function updateChatHeader() {

        if (!currentChatUser) {
            return;
        }

        const name =
            $("chatUserName");

        const status =
            $("chatUserStatus");

        const avatar =
            $("chatAvatar");

        if (name) {
            name.textContent =
                getDisplayName(
                    currentChatUser
                );
        }

        if (status) {
            status.textContent =
                currentChatUser.status ||
                (
                    isOnline(currentChatUser)
                        ? "آنلاین"
                        : "آفلاین"
                );
        }

        if (avatar) {

            const url =
                getAvatar(
                    currentChatUser
                );

            if (url) {
                avatar.src = url;
                avatar.style.visibility =
                    "visible";
            } else {
                avatar.removeAttribute(
                    "src"
                );
            }
        }
    }

    function enableComposer() {

        const input =
            $("messageInput");

        if (input) {
            input.disabled = false;
            input.focus();
        }
    }

    async function loadMessages(otherId) {

        if (!otherId) {
            return;
        }

        const container =
            $("messagesList");

        const empty =
            $("emptyChat");

        if (container) {
            container.innerHTML = "";
        }

        if (empty) {
            empty.style.display =
                "none";
        }

        try {

            const data =
                await api(
                    `/api/messages/${encodeURIComponent(otherId)}`
                );

            let messages = [];

            if (Array.isArray(data)) {
                messages = data;
            } else if (
                Array.isArray(data?.messages)
            ) {
                messages =
                    data.messages;
            } else if (
                Array.isArray(data?.data)
            ) {
                messages =
                    data.data;
            }

            messagesCache =
                messages;

            renderMessages(
                messages
            );

        } catch (error) {

            console.error(
                "loadMessages error:",
                error
            );

            if (container) {
                container.innerHTML =
                    `
                    <div style="
                        text-align:center;
                        color:#94a3b8;
                        padding:30px;
                        font-size:12px;
                    ">
                        پیام‌ها بارگذاری نشدند.
                    </div>
                    `;
            }
        }
    }

    function renderMessages(messages) {

        const container =
            $("messagesList");

        const empty =
            $("emptyChat");

        if (!container) {
            return;
        }

        container.innerHTML = "";

        if (
            !messages ||
            messages.length === 0
        ) {

            if (empty) {
                empty.style.display =
                    "block";
            }

            return;
        }

        if (empty) {
            empty.style.display =
                "none";
        }

        messages.forEach(
            message => {

                const senderId =
                    Number(
                        message.sender_id ??
                        message.from_id ??
                        message.sender ??
                        0
                    );

                const myId =
                    getUserId(
                        currentUser
                    );

                const mine =
                    senderId === myId;

                const row =
                    document.createElement("div");

                row.className =
                    "message-row " +
                    (
                        mine
                            ? "mine"
                            : "other"
                    );

                const bubble =
                    document.createElement("div");

                bubble.className =
                    "message-bubble";

                const text =
                    message.text ??
                    message.content ??
                    "";

                const type =
                    message.message_type ||
                    message.type ||
                    "text";

                if (
                    type === "image" &&
                    message.file_url
                ) {

                    const image =
                        document.createElement("img");

                    image.src =
                        message.file_url;

                    image.style.maxWidth =
                        "240px";

                    image.style.borderRadius =
                        "12px";

                    bubble.appendChild(
                        image
                    );

                } else if (
                    type === "audio" &&
                    message.file_url
                ) {

                    const audio =
                        document.createElement("audio");

                    audio.controls = true;
                    audio.src =
                        message.file_url;

                    bubble.appendChild(
                        audio
                    );

                } else if (
                    type === "video" &&
                    message.file_url
                ) {

                    const video =
                        document.createElement("video");

                    video.controls = true;
                    video.playsInline = true;
                    video.src =
                        message.file_url;

                    video.style.maxWidth =
                        "240px";

                    video.style.borderRadius =
                        "12px";

                    bubble.appendChild(
                        video
                    );

                } else if (
                    message.file_url
                ) {

                    const link =
                        document.createElement("a");

                    link.href =
                        message.file_url;

                    link.target =
                        "_blank";

                    link.rel =
                        "noopener noreferrer";

                    link.textContent =
                        message.file_name ||
                        "باز کردن فایل";

                    link.style.color =
                        "#fff";

                    bubble.appendChild(
                        link
                    );

                    if (text) {
                        const caption =
                            document.createElement("div");

                        caption.textContent =
                            text;

                        bubble.appendChild(
                            caption
                        );
                    }

                } else {

                    bubble.textContent =
                        text;
                }

                const time =
                    document.createElement("div");

                time.className =
                    "message-time";

                time.textContent =
                    formatTime(
                        message.created_at ||
                        message.timestamp ||
                        message.time
                    );

                bubble.appendChild(
                    time
                );

                row.appendChild(
                    bubble
                );

                container.appendChild(
                    row
                );
            }
        );

        const messagesContainer =
            $("messagesContainer");

        if (messagesContainer) {
            setTimeout(() => {
                messagesContainer.scrollTop =
                    messagesContainer.scrollHeight;
            }, 0);
        }
    }

    async function sendMessage() {

        if (!currentChatUser) {
            showToast(
                "ابتدا یک کاربر را انتخاب کنید"
            );
            return;
        }

        const input =
            $("messageInput");

        if (!input) {
            return;
        }

        const text =
            input.value.trim();

        if (!text) {
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

            const data =
                await api(
                    "/api/messages",
                    {
                        method: "POST",
                        body: {
                            receiver_id:
                                Number(
                                    receiverId
                                ),
                            text:
                                text
                        }
                    }
                );

            input.value = "";

            sendTyping(
                false
            );

            if (data) {

                const newMessage =
                    data.message ||
                    data;

                if (
                    newMessage &&
                    (
                        newMessage.id ||
                        newMessage.message_id ||
                        newMessage.text
                    )
                ) {

                    messagesCache.push(
                        newMessage
                    );

                    renderMessages(
                        messagesCache
                    );

                } else {

                    await loadMessages(
                        receiverId
                    );
                }

            } else {

                await loadMessages(
                    receiverId
                );
            }

        } catch (error) {

            console.error(
                "sendMessage error:",
                error
            );

            showToast(
                "ارسال پیام انجام نشد"
            );
        }
    }

    function sendTyping(value) {

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN ||
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
            lastTypingState === value
        ) {
            return;
        }

        lastTypingState =
            value;

        try {

            socket.send(
                JSON.stringify({
                    type: "typing",
                    receiver_id:
                        Number(receiverId),
                    value:
                        Boolean(value)
                })
            );

        } catch (error) {

            console.error(
                "typing error:",
                error
            );
        }
    }

    function setupMessageInput() {

        const input =
            $("messageInput");

        const send =
            $("sendButton");

        if (send) {
            send.addEventListener(
                "click",
                sendMessage
            );
        }

        if (!input) {
            return;
        }

        input.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter"
                ) {

                    event.preventDefault();

                    sendMessage();

                    return;
                }
            }
        );

        input.addEventListener(
            "input",
            () => {

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
    }

    function connectWebSocket() {

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

        try {

            socket =
                new WebSocket(
                    WS_URL
                );

        } catch (error) {

            console.error(
                "WebSocket create error:",
                error
            );

            scheduleReconnect();

            return;
        }

        window.GAPINO_SOCKET =
            socket;

        socket.addEventListener(
            "open",
            () => {

                console.log(
                    "GAPINO WebSocket connected"
                );

                reconnectDelay =
                    1500;

                try {

                    socket.send(
                        JSON.stringify({
                            type: "ping"
                        })
                    );

                } catch {
                    // ignore
                }
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
                    "GAPINO WebSocket disconnected"
                );

                scheduleReconnect();
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

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer =
            setTimeout(
                () => {

                    connectWebSocket();

                },
                reconnectDelay
            );

        reconnectDelay =
            Math.min(
                reconnectDelay * 2,
                15000
            );
    }

    function handleSocketMessage(raw) {

        let data = null;

        try {
            data =
                JSON.parse(raw);
        } catch {
            return;
        }

        if (!data) {
            return;
        }

        const type =
            data.type;

        switch (type) {

            case "ready":
                break;

            case "pong":
                break;

            case "user_online":
                updateOnlineUser(
                    data.user_id,
                    true
                );
                break;

            case "user_offline":
                updateOnlineUser(
                    data.user_id,
                    false
                );
                break;

            case "typing":
                handleTypingEvent(
                    data
                );
                break;

            case "message":
                handleIncomingMessage(
                    data
                );
                break;

            case "call_offer":
            case "call_answer":
            case "call_ice":
            case "call_reject":
            case "call_busy":
            case "call_end":

                document.dispatchEvent(
                    new CustomEvent(
                        "gapino-call-event",
                        {
                            detail: data
                        }
                    )
                );

                break;

            default:
                break;
        }
    }

    function updateOnlineUser(
        userId,
        online
    ) {

        const id =
            Number(userId);

        if (!id) {
            return;
        }

        users =
            users.map(
                user => {

                    if (
                        getUserId(user) === id
                    ) {
                        return {
                            ...user,
                            online:
                                Boolean(online)
                        };
                    }

                    return user;
                }
            );

        renderUsers(
            users
        );

        if (
            currentChatUser &&
            getUserId(
                currentChatUser
            ) === id
        ) {

            currentChatUser = {
                ...currentChatUser,
                online:
                    Boolean(online)
            };

            updateChatHeader();
        }
    }

    function handleTypingEvent(data) {

        const senderId =
            Number(
                data.sender_id ??
                data.user_id ??
                data.from_id ??
                0
            );

        const myId =
            getUserId(
                currentUser
            );

        if (
            !senderId ||
            senderId === myId
        ) {
            return;
        }

        if (
            !currentChatUser ||
            getUserId(
                currentChatUser
            ) !== senderId
        ) {
            return;
        }

        const indicator =
            $("typingIndicator");

        if (!indicator) {
            return;
        }

        const active =
            Boolean(
                data.value ??
                data.is_typing
            );

        indicator.textContent =
            active
                ? "در حال نوشتن..."
                : "";
    }

    function handleIncomingMessage(data) {

        const message =
            data.message ||
            data;

        if (!message) {
            return;
        }

        const senderId =
            Number(
                message.sender_id ??
                data.sender_id ??
                message.from_id ??
                data.user_id ??
                0
            );

        const receiverId =
            Number(
                message.receiver_id ??
                data.receiver_id ??
                0
            );

        const myId =
            getUserId(
                currentUser
            );

        if (!myId) {
            return;
        }

        const belongsToCurrentChat =
            currentChatUser &&
            (
                senderId ===
                    getUserId(
                        currentChatUser
                    ) ||
                (
                    receiverId ===
                        getUserId(
                            currentChatUser
                        ) &&
                    senderId === myId
                )
            );

        if (!belongsToCurrentChat) {
            showToast(
                "پیام جدید دریافت شد"
            );
            return;
        }

        messagesCache.push(
            message
        );

        renderMessages(
            messagesCache
        );
    }

    /* FILE UPLOAD */

    function setupAttachment() {

        const attach =
            $("attachButton");

        const input =
            $("fileInput");

        if (attach && input) {

            attach.addEventListener(
                "click",
                () => {
                    input.click();
                }
            );

            input.addEventListener(
                "change",
                () => {

                    selectedFile =
                        input.files?.[0] ||
                        null;

                    updateAttachmentPreview();
                }
            );
        }

        const remove =
            $("removeAttachmentButton");

        if (remove) {

            remove.addEventListener(
                "click",
                () => {

                    selectedFile = null;

                    if (input) {
                        input.value = "";
                    }

                    updateAttachmentPreview();
                }
            );
        }
    }

    function updateAttachmentPreview() {

        const preview =
            $("attachmentPreview");

        const name =
            $("attachmentName");

        if (!preview) {
            return;
        }

        if (!selectedFile) {

            preview.classList.remove(
                "show"
            );

            return;
        }

        preview.classList.add(
            "show"
        );

        if (name) {
            name.textContent =
                selectedFile.name;
        }
    }

    async function uploadSelectedFile() {

        if (!selectedFile) {
            return null;
        }

        const formData =
            new FormData();

        formData.append(
            "file",
            selectedFile
        );

        const response =
            await fetch(
                API + "/api/upload",
                {
                    method: "POST",
                    credentials: "include",
                    body: formData
                }
            );

        let data = null;

        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "آپلود فایل ناموفق بود"
            );
        }

        selectedFile = null;

        const input =
            $("fileInput");

        if (input) {
            input.value = "";
        }

        updateAttachmentPreview();

        return data;
    }

    /* VOICE */

    function setupVoice() {

        const button =
            $("voiceButton");

        if (!button) {
            return;
        }

        button.addEventListener(
            "click",
            async () => {

                if (isRecording) {

                    stopRecording();

                    return;
                }

                await startRecording();
            }
        );
    }

    async function startRecording() {

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            showToast(
                "ضبط صدا روی این مرورگر در دسترس نیست"
            );

            return;
        }

        try {

            const stream =
                await navigator.mediaDevices
                    .getUserMedia({
                        audio: true
                    });

            recordingChunks = [];

            mediaRecorder =
                new MediaRecorder(
                    stream
                );

            isRecording = true;

            const button =
                $("voiceButton");

            if (button) {
                button.textContent =
                    "⏹";
            }

            mediaRecorder.addEventListener(
                "dataavailable",
                event => {

                    if (
                        event.data &&
                        event.data.size > 0
                    ) {
                        recordingChunks.push(
                            event.data
                        );
                    }
                }
            );

            mediaRecorder.addEventListener(
                "stop",
                async () => {

                    stream
                        .getTracks()
                        .forEach(
                            track =>
                                track.stop()
                        );

                    isRecording =
                        false;

                    const button =
                        $("voiceButton");

                    if (button) {
                        button.textContent =
                            "🎤";
                    }

                    if (
                        recordingChunks.length === 0
                    ) {
                        return;
                    }

                    try {

                        const blob =
                            new Blob(
                                recordingChunks,
                                {
                                    type:
                                        "audio/webm"
                                }
                            );

                        await sendAudioBlob(
                            blob
                        );

                    } catch (error) {

                        console.error(
                            "voice send error:",
                            error
                        );

                        showToast(
                            "ارسال صدا انجام نشد"
                        );
                    }
                }
            );

            mediaRecorder.start();

        } catch (error) {

            console.error(
                "recording error:",
                error
            );

            showToast(
                "دسترسی به میکروفون داده نشد"
            );
        }
    }

    function stopRecording() {

        if (
            mediaRecorder &&
            mediaRecorder.state !==
                "inactive"
        ) {
            mediaRecorder.stop();
        }
    }

    async function sendAudioBlob(
        blob
    ) {

        if (!currentChatUser) {
            return;
        }

        const file =
            new File(
                [blob],
                `voice-${Date.now()}.webm`,
                {
                    type:
                        "audio/webm"
                }
            );

        const formData =
            new FormData();

        formData.append(
            "file",
            file
        );

        const uploadResponse =
            await fetch(
                API + "/api/upload",
                {
                    method: "POST",
                    credentials: "include",
                    body: formData
                }
            );

        const uploadData =
            await uploadResponse.json();

        if (!uploadResponse.ok) {
            throw new Error(
                uploadData?.detail ||
                "آپلود صدا ناموفق بود"
            );
        }

        const fileUrl =
            uploadData.url ||
            uploadData.file_url ||
            uploadData.path;

        if (!fileUrl) {
            throw new Error(
                "آدرس فایل دریافت نشد"
            );
        }

        const receiverId =
            getUserId(
                currentChatUser
            );

        await api(
            "/api/messages",
            {
                method: "POST",
                body: {
                    receiver_id:
                        Number(receiverId),
                    text:
                        "",
                    file_url:
                        fileUrl,
                    message_type:
                        "audio"
                }
            }
        );

        await loadMessages(
            receiverId
        );
    }

    /* PROFILE */

    function setupProfile() {

        const button =
            $("profileButton");

        const modal =
            $("profileModal");

        const close =
            $("closeProfileModal");

        const save =
            $("saveProfileButton");

        if (
            button &&
            modal
        ) {

            button.addEventListener(
                "click",
                () => {

                    renderCurrentUser();

                    modal.classList.add(
                        "show"
                    );
                }
            );
        }

        if (close && modal) {

            close.addEventListener(
                "click",
                () => {
                    modal.classList.remove(
                        "show"
                    );
                }
            );
        }

        if (
            save &&
            modal
        ) {

            save.addEventListener(
                "click",
                saveProfile
            );
        }
    }

    async function saveProfile() {

        const name =
            $("profileDisplayName");

        const bio =
            $("profileBio");

        try {

            const data =
                await api(
                    "/api/profile",
                    {
                        method: "PUT",
                        body: {
                            display_name:
                                name?.value.trim() ||
                                "",
                            bio:
                                bio?.value.trim() ||
                                ""
                        }
                    }
                );

            currentUser =
                data?.user ||
                data ||
                currentUser;

            renderCurrentUser();

            const modal =
                $("profileModal");

            if (modal) {
                modal.classList.remove(
                    "show"
                );
            }

            await loadUsers();

            showToast(
                "پروفایل ذخیره شد"
            );

        } catch (error) {

            console.error(
                "saveProfile error:",
                error
            );

            showToast(
                "ذخیره پروفایل انجام نشد"
            );
        }
    }

    /* SEARCH MESSAGES */

    function setupMessageSearch() {

        const button =
            $("chatSearchButton");

        const modal =
            $("messageSearchModal");

        const close =
            $("closeMessageSearchModal");

        const input =
            $("messageSearchInput");

        const results =
            $("messageSearchResults");

        if (
            button &&
            modal
        ) {

            button.addEventListener(
                "click",
                () => {

                    modal.classList.add(
                        "show"
                    );

                    if (input) {
                        input.focus();
                    }
                }
            );
        }

        if (
            close &&
            modal
        ) {

            close.addEventListener(
                "click",
                () => {
                    modal.classList.remove(
                        "show"
                    );
                }
            );
        }

        if (
            input &&
            results
        ) {

            input.addEventListener(
                "input",
                () => {

                    const text =
                        input.value
                            .trim()
                            .toLowerCase();

                    results.innerHTML =
                        "";

                    if (!text) {
                        return;
                    }

                    const found =
                        messagesCache.filter(
                            message =>
                                String(
                                    message.text ??
                                    message.content ??
                                    ""
                                )
                                .toLowerCase()
                                .includes(text)
                        );

                    if (!found.length) {

                        results.innerHTML =
                            `
                            <div style="
                                padding:15px;
                                color:#94a3b8;
                                text-align:center;
                            ">
                                پیامی پیدا نشد.
                            </div>
                            `;

                        return;
                    }

                    found.forEach(
                        message => {

                            const row =
                                document.createElement(
                                    "div"
                                );

                            row.style.padding =
                                "10px";

                            row.style.marginBottom =
                                "6px";

                            row.style.borderRadius =
                                "10px";

                            row.style.background =
                                "#1f2937";

                            row.textContent =
                                message.text ??
                                message.content ??
                                "";

                            results.appendChild(
                                row
                            );
                        }
                    );
                }
            );
        }
    }

    /* LOGOUT */

    function setupLogout() {

        const button =
            $("logoutButton");

        if (!button) {
            return;
        }

        button.addEventListener(
            "click",
            async () => {

                try {

                    await api(
                        "/api/logout",
                        {
                            method: "POST"
                        }
                    );

                } catch (error) {

                    console.warn(
                        "logout API error:",
                        error
                    );
                }

                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch {
                    // ignore
                }

                if (socket) {

                    try {
                        socket.close();
                    } catch {
                        // ignore
                    }
                }

                window.location.href =
                    "/login.html";
            }
        );
    }

    /* MOBILE BACK */

    function setupMobileBack() {

        const button =
            $("mobileBackButton");

        const shell =
            $("appShell");

        if (
            !button ||
            !shell
        ) {
            return;
        }

        button.addEventListener(
            "click",
            () => {

                shell.classList.remove(
                    "chat-open"
                );

                currentChatUser =
                    null;

                const input =
                    $("messageInput");

                if (input) {
                    input.disabled =
                        true;
                    input.value = "";
                }

                const name =
                    $("chatUserName");

                const status =
                    $("chatUserStatus");

                if (name) {
                    name.textContent =
                        "گفتگو";
                }

                if (status) {
                    status.textContent =
                        "یک کاربر را انتخاب کنید";
                }
            }
        );
    }

    /* MENU */

    function setupMenu() {

        const button =
            $("chatMenuButton");

        if (!button) {
            return;
        }

        button.addEventListener(
            "click",
            () => {

                showToast(
                    "منوی گپینو"
                );
            }
        );
    }

    /* LIVE */

    function setupLiveButtons() {

        const liveButton =
            $("liveButton");

        const headerLive =
            $("headerLiveButton");

        if (liveButton) {

            liveButton.addEventListener(
                "click",
                () => {
                    location.href =
                        "/live.html";
                }
            );
        }

        if (headerLive) {

            headerLive.addEventListener(
                "click",
                () => {
                    location.href =
                        "/live.html";
                }
            );
        }
    }

    /* REFRESH */

    function setupRefreshLives() {

        const button =
            $("refreshLivesButton");

        if (
            button &&
            typeof window.GAPINO_REFRESH_LIVES ===
                "function"
        ) {

            button.addEventListener(
                "click",
                () => {
                    window.GAPINO_REFRESH_LIVES();
                }
            );
        }
    }

    /* CALL SUPPORT */

    function setupCallBridge() {

        document.addEventListener(
            "gapino-call-event",
            event => {

                if (
                    typeof window.GAPINO_CALL_HANDLE_EVENT ===
                        "function"
                ) {

                    try {
                        window.GAPINO_CALL_HANDLE_EVENT(
                            event.detail
                        );
                    } catch (error) {

                        console.error(
                            "Call bridge error:",
                            error
                        );
                    }
                }
            }
        );

        const button =
            $("callButton");

        if (
            button &&
            typeof window.GAPINO_CALL_START ===
                "function"
        ) {

            button.addEventListener(
                "click",
                () => {

                    if (!currentChatUser) {

                        showToast(
                            "ابتدا یک کاربر را انتخاب کنید"
                        );

                        return;
                    }

                    try {

                        window.GAPINO_CALL_START(
                            getUserId(
                                currentChatUser
                            )
                        );

                    } catch (error) {

                        console.error(
                            "Call start error:",
                            error
                        );
                    }
                }
            );
        }
    }

    /* TIMERS */

    function startRefreshTimers() {

        setInterval(
            async () => {

                if (
                    document.hidden
                ) {
                    return;
                }

                try {
                    await loadUsers();
                } catch {
                    // ignore
                }

            },
            10000
        );

        setInterval(
            async () => {

                if (
                    typeof window.GAPINO_REFRESH_LIVES ===
                        "function"
                ) {

                    try {
                        await window.GAPINO_REFRESH_LIVES();
                    } catch {
                        // ignore
                    }
                }

            },
            10000
        );
    }

    async function boot() {

        try {

            await loadCurrentUser();

            renderCurrentUser();

            setupUserSearch();
            setupMessageInput();
            setupAttachment();
            setupVoice();
            setupProfile();
            setupMessageSearch();
            setupLogout();
            setupMobileBack();
            setupMenu();
            setupLiveButtons();
            setupRefreshLives();
            setupCallBridge();

            await loadUsers();

            connectWebSocket();

            startRefreshTimers();

            const input =
                $("messageInput");

            if (input) {
                input.disabled = true;
            }

            console.log(
                "GAPINO chat loaded successfully"
            );

        } catch (error) {

            console.error(
                "GAPINO boot error:",
                error
            );

            showToast(
                "خطا در بارگذاری گپینو"
            );

            /*
             * فقط در صورتی که واقعاً وارد نشده باشیم
             * به صفحه ورود برگرد.
             */
            if (
                String(
                    error.message || ""
                ).includes(
                    "جلسه ورود پیدا نشد"
                )
            ) {

                setTimeout(
                    () => {
                        location.href =
                            "/login.html";
                    },
                    1200
                );
            }
        }
    }

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

        openChat,
        loadUsers,
        loadMessages,
        sendMessage,
        connectWebSocket,
        sendTyping
    };

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            boot
        );

    } else {

        boot();
    }

})();