"use strict";

const API = window.location.origin;

let currentUser = null;
let currentChatUser = null;
let socket = null;

let reconnectTimer = null;
let pingTimer = null;
let usersRefreshTimer = null;
let typingTimer = null;

let reconnectAttempts = 0;

let allUsers = [];

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let isRecording = false;

let selectedAvatarUrl = "";
let isSavingProfile = false;


/* =========================================================
   HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}

function safeText(value) {
    return String(value ?? "");
}

function getCurrentUserId() {
    return String(
        currentUser?.id ??
        currentUser?.user_id ??
        ""
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

function isOnline(user) {
    return Boolean(
        user?.online === true ||
        user?.status === "online" ||
        user?.status === "آنلاین"
    );
}


/* =========================================================
   DOM
   ========================================================= */

const appShell = $("appShell");
const sidebar = $("sidebar");
const menuButton = $("menuButton");
const mobileMenuButton = $("mobileMenuButton");
const appOverlay = $("appOverlay");

const profileButton = $("profileButton");
const profileHeaderButton = $("profileHeaderButton");
const closeProfile = $("closeProfile");

const currentAvatar = $("currentAvatar");
const currentDisplayName = $("currentDisplayName");
const currentUsername = $("currentUsername");

const userSearch = $("userSearch");
const clearSearch = $("clearSearch");
const userList = $("userList");
const userCount = $("userCount");

const chatContact = $("chatContact");
const chatHeaderEmpty = $("chatHeaderEmpty");
const chatAvatar = $("chatAvatar");
const chatName = $("chatName");
const chatStatus = $("chatStatus");

const callButton = $("callButton");
const refreshButton = $("refreshButton");

const welcomeScreen = $("welcomeScreen");
const chatView = $("chatView");
const messagesBox = $("messages");
const typingArea = $("typingArea");

const fileInput = $("fileInput");
const attachButton = $("attachButton");
const voiceButton = $("voiceButton");
const messageInput = $("messageInput");
const sendButton = $("sendButton");

const profilePanel = $("profilePanel");
const profileAvatar = $("profileAvatar");
const profileName = $("profileName");
const profileUsername = $("profileUsername");
const editDisplayName = $("editDisplayName");
const editBio = $("editBio");
const editStatus = $("editStatus");
const saveProfile = $("saveProfile");
const profilePageButton = $("profilePageButton");

const themeButton = $("themeButton");
const logoutButton = $("logoutButton");

const toast = $("toast");


/* =========================================================
   TOAST
   ========================================================= */

function showToast(text, timeout = 2600) {
    if (!toast) {
        console.log("GAPINO:", text);
        return;
    }

    toast.textContent = safeText(text);
    toast.style.display = "block";
    toast.classList.add("show");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
        toast.classList.remove("show");
        toast.style.display = "none";
    }, timeout);
}


/* =========================================================
   API
   ========================================================= */

async function apiFetch(path, options = {}) {
    const response = await fetch(
        API + path,
        {
            ...options,
            credentials: "include",
            cache: "no-store"
        }
    );

    let data = null;

    try {
        data = await response.json();
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


/* =========================================================
   AVATAR
   ========================================================= */

function getAvatarLetter(user) {
    return (
        getUserName(user)
            .trim()
            .charAt(0)
        || "G"
    );
}

function getAbsoluteUrl(url) {
    const value = safeText(url).trim();

    if (!value) {
        return "";
    }

    if (
        value.startsWith("http://") ||
        value.startsWith("https://")
    ) {
        return value;
    }

    if (value.startsWith("/")) {
        return value;
    }

    return "/" + value;
}

function renderAvatar(element, user) {
    if (!element) {
        return;
    }

    element.innerHTML = "";

    const avatar = getAbsoluteUrl(
        user?.avatar ||
        user?.profile?.avatar ||
        ""
    );

    if (!avatar) {
        element.textContent =
            getAvatarLetter(user);
        return;
    }

    const img = document.createElement("img");

    img.src = avatar;
    img.alt = "آواتار";
    img.loading = "lazy";

    img.onerror = () => {
        element.innerHTML = "";
        element.textContent =
            getAvatarLetter(user);
    };

    element.appendChild(img);
}


/* =========================================================
   CURRENT USER UI
   ========================================================= */

function updateCurrentUserUI() {
    if (!currentUser) {
        return;
    }

    if (currentDisplayName) {
        currentDisplayName.textContent =
            getUserName(currentUser);
    }

    if (currentUsername) {
        const username =
            safeText(currentUser.username);

        currentUsername.textContent =
            username
                ? `@${username}`
                : "کاربر";
    }

    renderAvatar(
        currentAvatar,
        currentUser
    );
}


/* =========================================================
   CHAT HEADER
   ========================================================= */

function updateChatHeader(user) {
    if (!user) {
        return;
    }

    if (chatName) {
        chatName.textContent =
            getUserName(user);
    }

    if (chatStatus) {
        chatStatus.textContent =
            isOnline(user)
                ? "آنلاین"
                : "آفلاین";
    }

    renderAvatar(
        chatAvatar,
        user
    );

    if (chatContact) {
        chatContact.hidden = false;
    }

    if (chatHeaderEmpty) {
        chatHeaderEmpty.hidden = true;
    }

    /*
     * مهم:
     * دکمه تماس فقط بر اساس انتخاب کاربر فعال/غیرفعال می‌شود،
     * نه بر اساس online که ممکن است Presence هنوز به‌روز نشده باشد.
     */
    if (callButton) {
        callButton.disabled = false;
        callButton.title = "تماس صوتی";
    }
}


/* =========================================================
   INPUT STATE
   ========================================================= */

function setChatInputEnabled(enabled) {
    const state = Boolean(enabled);

    if (messageInput) {
        messageInput.disabled = !state;

        messageInput.placeholder =
            state
                ? "پیامت را بنوی..."
                : "یک کاربر را انتخاب کنید...";
    }

    if (sendButton) {
        sendButton.disabled = !state;
    }

    if (attachButton) {
        attachButton.disabled = !state;
    }

    if (voiceButton) {
        voiceButton.disabled = !state;
    }

    /*
     * تماس:
     * وقتی گفتگو انتخاب شده، فعال باشد.
     */
    if (callButton) {
        callButton.disabled =
            !state ||
            !currentChatUser;
    }
}


/* =========================================================
   LOAD CURRENT USER
   ========================================================= */

async function loadCurrentUser() {
    try {
        const data =
            await apiFetch("/api/me");

        if (data?.id) {
            currentUser = data;

            localStorage.setItem(
                "gapino_user",
                JSON.stringify(currentUser)
            );

            updateCurrentUserUI();

            return currentUser;
        }

        if (
            data?.authenticated &&
            data?.user
        ) {
            currentUser =
                data.user;

            localStorage.setItem(
                "gapino_user",
                JSON.stringify(currentUser)
            );

            updateCurrentUserUI();

            return currentUser;
        }

    } catch (error) {
        console.warn(
            "Session error:",
            error
        );
    }

    localStorage.removeItem(
        "gapino_user"
    );

    window.location.replace(
        "/login.html"
    );

    return null;
}


/* =========================================================
   USERS
   ========================================================= */

async function loadUsers() {
    try {
        const data =
            await apiFetch("/api/users");

        if (Array.isArray(data)) {
            allUsers = data;
        } else if (
            Array.isArray(data?.users)
        ) {
            allUsers = data.users;
        } else {
            allUsers = [];
        }

        renderUsers();

        window.GAPINO_USERS =
            allUsers;

    } catch (error) {
        console.error(
            "Users error:",
            error
        );

        if (userList) {
            userList.innerHTML = `
                <div class="empty-users">
                    <div class="empty-icon">
                        ⚠️
                    </div>

                    <strong>
                        دریافت کاربران انجام نشد
                    </strong>

                    <span>
                        اتصال سرور را بررسی کن.
                    </span>
                </div>
            `;
        }
    }
}


function renderUsers() {
    if (!userList) {
        return;
    }

    const query =
        safeText(
            userSearch?.value
        )
        .trim()
        .toLowerCase();

    const filtered =
        allUsers.filter(user => {
            if (!user) {
                return false;
            }

            if (
                getUserId(user) ===
                getCurrentUserId()
            ) {
                return false;
            }

            if (!query) {
                return true;
            }

            const name =
                getUserName(user)
                    .toLowerCase();

            const username =
                safeText(user.username)
                    .toLowerCase();

            return (
                name.includes(query) ||
                username.includes(query)
            );
        });

    userList.innerHTML = "";

    if (userCount) {
        userCount.textContent =
            filtered.length.toLocaleString(
                "fa-IR"
            );
    }

    if (!filtered.length) {
        userList.innerHTML = `
            <div class="empty-users">
                <div class="empty-icon">
                    🔎
                </div>

                <strong>
                    کاربری پیدا نشد
                </strong>

                <span>
                    جستجوی دیگری انجام بده.
                </span>
            </div>
        `;

        return;
    }

    filtered.forEach(user => {
        const item =
            document.createElement("button");

        item.type = "button";
        item.className =
            "user-item";

        if (
            currentChatUser &&
            getUserId(currentChatUser) ===
            getUserId(user)
        ) {
            item.classList.add(
                "active"
            );
        }

        const avatar =
            document.createElement("div");

        avatar.className =
            "avatar";

        renderAvatar(
            avatar,
            user
        );

        const info =
            document.createElement("div");

        info.className =
            "user-info";

        const row =
            document.createElement("div");

        row.className =
            "username-row";

        const name =
            document.createElement(
                "strong"
            );

        name.className =
            "username";

        name.textContent =
            getUserName(user);

        const dot =
            document.createElement(
                "span"
            );

        dot.className =
            isOnline(user)
                ? "online-dot"
                : "offline-dot";

        row.appendChild(name);
        row.appendChild(dot);

        const status =
            document.createElement(
                "span"
            );

        status.className =
            "status-text";

        status.textContent =
            user.username
                ? `@${user.username} • ${
                    isOnline(user)
                        ? "آنلاین"
                        : "آفلاین"
                }`
                : (
                    isOnline(user)
                        ? "آنلاین"
                        : "آفلاین"
                );

        info.appendChild(row);
        info.appendChild(status);

        item.appendChild(avatar);
        item.appendChild(info);

        item.addEventListener(
            "click",
            () => openChat(user)
        );

        userList.appendChild(item);
    });
}


/* =========================================================
   OPEN CHAT
   ========================================================= */

async function openChat(user) {
    if (!user) {
        return;
    }

    currentChatUser =
        user;

    updateChatHeader(
        user
    );

    renderUsers();

    setChatInputEnabled(
        true
    );

    if (welcomeScreen) {
        welcomeScreen.hidden =
            true;
    }

    if (chatView) {
        chatView.hidden =
            false;
    }

    closeSidebar();

    clearMessages();

    await loadConversation(
        getUserId(user)
    );

    await markConversationRead(
        getUserId(user)
    );

    if (messageInput) {
        setTimeout(
            () => messageInput.focus(),
            80
        );
    }
}


/* =========================================================
   LOAD CONVERSATION
   ========================================================= */

async function loadConversation(
    otherUserId
) {
    if (
        !otherUserId
    ) {
        return;
    }

    try {
        const data =
            await apiFetch(
                `/api/messages/${encodeURIComponent(
                    otherUserId
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
            "Conversation error:",
            error
        );

        showToast(
            "دریافت پیام‌ها انجام نشد."
        );
    }
}


function clearMessages() {
    if (!messagesBox) {
        return;
    }

    messagesBox.innerHTML = `
        <div class="empty-chat">
            <div class="empty-chat-icon">
                💬
            </div>

            <h2>
                گفتگو
            </h2>

            <p>
                پیام‌ها اینجا نمایش داده می‌شوند.
            </p>
        </div>
    `;
}


function removeEmptyMessage() {
    messagesBox
        ?.querySelector(
            ".empty-chat"
        )
        ?.remove();
}


function renderMessages(
    messages
) {
    if (!messagesBox) {
        return;
    }

    messagesBox.innerHTML = "";

    if (
        !Array.isArray(messages) ||
        !messages.length
    ) {
        clearMessages();
        return;
    }

    messages.forEach(
        message =>
            appendMessage(
                message,
                false
            )
    );

    scrollToBottom();
}


function appendMessage(
    message,
    shouldScroll = true
) {
    if (
        !messagesBox ||
        !message
    ) {
        return;
    }

    removeEmptyMessage();

    const senderId =
        String(
            message.sender_id ??
            message.sender ??
            ""
        );

    const mine =
        senderId ===
        getCurrentUserId();

    const row =
        document.createElement(
            "div"
        );

    row.className =
        mine
            ? "message-row mine"
            : "message-row theirs";

    const bubble =
        document.createElement(
            "div"
        );

    bubble.className =
        "message-bubble";

    renderMessageContent(
        bubble,
        message
    );

    const time =
        document.createElement(
            "span"
        );

    time.className =
        "message-time";

    time.textContent =
        formatTime(
            message.created_at ||
            message.time
        );

    bubble.appendChild(time);

    row.appendChild(bubble);

    messagesBox.appendChild(row);

    if (shouldScroll) {
        scrollToBottom();
    }
}


function renderMessageContent(
    container,
    message
) {
    if (message.file) {
        renderFileObject(
            container,
            message.file
        );

        return;
    }

    if (
        message.file_url ||
        message.file_name
    ) {
        renderFileObject(
            container,
            message
        );

        return;
    }

    const text =
        document.createElement(
            "div"
        );

    text.className =
        "message-text";

    text.textContent =
        safeText(
            message.text
        );

    container.appendChild(text);
}


/* =========================================================
   FILE RENDER
   ========================================================= */

function renderFileObject(
    container,
    file
) {
    const url =
        getAbsoluteUrl(
            file?.url ||
            file?.file_url ||
            ""
        );

    const name =
        safeText(
            file?.name ||
            file?.file_name ||
            "فایل"
        );

    const size =
        Number(
            file?.size ||
            file?.file_size ||
            0
        );

    const type =
        safeText(
            file?.type ||
            file?.mime_type ||
            file?.file_type ||
            ""
        );

    const isAudio =
        type.startsWith("audio/") ||
        /\.(webm|ogg|mp3|wav|m4a)$/i.test(
            url
        );

    const isImage =
        type.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp)$/i.test(
            url
        );

    if (!url) {
        container.textContent =
            name;

        return;
    }

    if (isAudio) {
        const wrapper =
            document.createElement(
                "div"
            );

        wrapper.className =
            "message-audio";

        const audio =
            document.createElement(
                "audio"
            );

        audio.controls =
            true;

        audio.preload =
            "metadata";

        audio.src =
            url;

        const label =
            document.createElement(
                "div"
            );

        label.className =
            "voice-name";

        label.textContent =
            `🎙️ ${name}`;

        wrapper.appendChild(
            audio
        );

        wrapper.appendChild(
            label
        );

        container.appendChild(
            wrapper
        );

        return;
    }

    if (isImage) {
        const image =
            document.createElement(
                "img"
            );

        image.className =
            "message-image";

        image.src =
            url;

        image.alt =
            name;

        image.loading =
            "lazy";

        image.addEventListener(
            "click",
            () => {
                window.open(
                    url,
                    "_blank",
                    "noopener,noreferrer"
                );
            }
        );

        container.appendChild(
            image
        );

        return;
    }

    const link =
        document.createElement(
            "a"
        );

    link.className =
        "message-file";

    link.href =
        url;

    link.target =
        "_blank";

    link.rel =
        "noopener noreferrer";

    link.innerHTML =
        "📎 ";

    const strong =
        document.createElement(
            "strong"
        );

    strong.textContent =
        name;

    link.appendChild(
        strong
    );

    if (size > 0) {
        const small =
            document.createElement(
                "small"
            );

        small.textContent =
            ` • ${formatFileSize(size)}`;

        link.appendChild(
            small
        );
    }

    container.appendChild(
        link
    );
}


function formatFileSize(bytes) {
    const size =
        Number(bytes || 0);

    if (
        !Number.isFinite(size) ||
        size <= 0
    ) {
        return "";
    }

    if (size < 1024) {
        return (
            `${size.toLocaleString(
                "fa-IR"
            )} بایت`
        );
    }

    if (
        size <
        1024 * 1024
    ) {
        return (
            `${(
                size / 1024
            ).toFixed(1)} KB`
        );
    }

    return (
        `${(
            size /
            1024 /
            1024
        ).toFixed(1)} MB`
    );
}


/* =========================================================
   TIME
   ========================================================= */

function formatTime(value) {
    if (!value) {
        return "";
    }

    const text =
        safeText(value);

    if (
        /^\d{2}:\d{2}$/.test(text)
    ) {
        return text;
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return text.length >= 16
            ? text.substring(
                11,
                16
            )
            : text;
    }

    return date.toLocaleTimeString(
        "fa-IR",
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}


function scrollToBottom() {
    requestAnimationFrame(
        () => {
            if (messagesBox) {
                messagesBox.scrollTop =
                    messagesBox.scrollHeight;
            }
        }
    );
}


/* =========================================================
   SEND TEXT
   ========================================================= */

function sendTextMessage() {
    if (!currentChatUser) {
        showToast(
            "ابتدا یک کاربر را انتخاب کن."
        );

        return;
    }

    const text =
        safeText(
            messageInput?.value
        ).trim();

    if (!text) {
        return;
    }

    if (text.length > 5000) {
        showToast(
            "پیام نباید بیشتر از ۵۰۰۰ کاراکتر باشد."
        );

        return;
    }

    const sent =
        sendSocket({
            type:
                "message",

            receiver_id:
                Number(
                    getUserId(
                        currentChatUser
                    )
                ),

            text
        });

    if (!sent) {
        showToast(
            "اتصال گپینو برقرار نیست."
        );

        return;
    }

    if (messageInput) {
        messageInput.value =
            "";

        resizeMessageInput();
    }

    stopTyping();
}


/* =========================================================
   TYPING
   ========================================================= */

function sendTyping() {
    if (!currentChatUser) {
        return;
    }

    sendSocket({
        type:
            "typing",

        receiver_id:
            Number(
                getUserId(
                    currentChatUser
                )
            ),

        value:
            true
    });

    clearTimeout(
        typingTimer
    );

    typingTimer =
        setTimeout(
            stopTyping,
            1200
        );
}


function stopTyping() {
    clearTimeout(
        typingTimer
    );

    if (!currentChatUser) {
        return;
    }

    sendSocket({
        type:
            "typing",

        receiver_id:
            Number(
                getUserId(
                    currentChatUser
                )
            ),

        value:
            false
    });
}


function showTyping() {
    if (typingArea) {
        typingArea.hidden =
            false;
    }
}


function hideTyping() {
    if (typingArea) {
        typingArea.hidden =
            true;
    }
}


/* =========================================================
   READ
   ========================================================= */

async function markConversationRead(
    otherUserId
) {
    if (!otherUserId) {
        return;
    }

    sendSocket({
        type:
            "read",

        other_user_id:
            String(otherUserId)
    });
}


/* =========================================================
   UPLOAD
   ========================================================= */

async function uploadFile(
    file
) {
    if (!file) {
        return null;
    }

    if (!currentChatUser) {
        showToast(
            "ابتدا یک کاربر را انتخاب کن."
        );

        return null;
    }

    const limit =
        10 * 1024 * 1024;

    if (file.size > limit) {
        showToast(
            "حجم فایل نباید بیشتر از ۱۰ مگابایت باشد."
        );

        return null;
    }

    const form =
        new FormData();

    form.append(
        "receiver_id",
        getUserId(
            currentChatUser
        )
    );

    form.append(
        "file",
        file
    );

    try {
        return await apiFetch(
            "/api/upload",
            {
                method:
                    "POST",

                body:
                    form
            }
        );

    } catch (error) {
        console.error(
            "Upload error:",
            error
        );

        showToast(
            error.message ||
            "آپلود انجام نشد."
        );

        return null;
    }
}


async function sendFile(file) {
    if (
        !file ||
        !currentChatUser
    ) {
        return;
    }

    const uploaded =
        await uploadFile(file);

    if (!uploaded) {
        return;
    }

    if (
        file.type.startsWith(
            "audio/"
        )
    ) {
        showToast(
            "🎙️ پیام صوتی ارسال شد."
        );

    } else if (
        file.type.startsWith(
            "image/"
        )
    ) {
        showToast(
            "🖼️ عکس ارسال شد."
        );

    } else {
        showToast(
            "📎 فایل ارسال شد."
        );
    }

    /*
     * /api/upload پیام را داخل دیتابیس ساخته است.
     * برای فرستنده آن را در صفحه نمایش می‌دهیم.
     */
    receiveMessage(
        uploaded
    );
}


/* =========================================================
   VOICE MESSAGE
   ========================================================= */

function getSupportedAudioType() {
    if (!window.MediaRecorder) {
        return "";
    }

    const types = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg"
    ];

    for (
        const type of types
    ) {
        try {
            if (
                MediaRecorder.isTypeSupported(
                    type
                )
            ) {
                return type;
            }
        } catch (_) {}
    }

    return "";
}


async function toggleVoiceRecording() {
    if (isRecording) {
        stopVoiceRecording();
        return;
    }

    if (!currentChatUser) {
        showToast(
            "ابتدا یک کاربر را انتخاب کن."
        );

        return;
    }

    if (
        !navigator.mediaDevices?.getUserMedia ||
        !window.MediaRecorder
    ) {
        showToast(
            "مرورگر از ضبط صدا پشتیبانی نمی‌کند."
        );

        return;
    }

    try {
        mediaStream =
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

        audioChunks = [];

        const mimeType =
            getSupportedAudioType();

        mediaRecorder =
            mimeType
                ? new MediaRecorder(
                    mediaStream,
                    {
                        mimeType
                    }
                )
                : new MediaRecorder(
                    mediaStream
                );

        mediaRecorder.ondataavailable =
            event => {
                if (
                    event.data &&
                    event.data.size > 0
                ) {
                    audioChunks.push(
                        event.data
                    );
                }
            };

        mediaRecorder.onstop =
            async () => {
                try {
                    const recorderMime =
                        mediaRecorder?.mimeType ||
                        mimeType ||
                        "audio/webm";

                    const blob =
                        new Blob(
                            audioChunks,
                            {
                                type:
                                    recorderMime
                            }
                        );

                    cleanupVoice();

                    if (!blob.size) {
                        showToast(
                            "صدای ضبط‌شده خالی است."
                        );

                        return;
                    }

                    const extension =
                        recorderMime.includes(
                            "ogg"
                        )
                            ? "ogg"
                            : "webm";

                    const file =
                        new File(
                            [blob],
                            `voice-${Date.now()}.${extension}`,
                            {
                                type:
                                    recorderMime
                            }
                        );

                    await sendFile(
                        file
                    );

                } catch (error) {
                    console.error(
                        "Voice error:",
                        error
                    );

                    cleanupVoice();

                    showToast(
                        "ارسال پیام صوتی انجام نشد."
                    );
                }
            };

        mediaRecorder.start();

        isRecording =
            true;

        updateVoiceUI();

        showToast(
            "🎙️ در حال ضبط..."
        );

    } catch (error) {
        console.error(
            "Microphone error:",
            error
        );

        cleanupVoice();

        showToast(
            "دسترسی به میکروفن داده نشد."
        );
    }
}


function stopVoiceRecording() {
    if (
        mediaRecorder &&
        mediaRecorder.state !==
            "inactive"
    ) {
        mediaRecorder.stop();
    } else {
        cleanupVoice();
    }
}


function cleanupVoice() {
    if (mediaStream) {
        mediaStream
            .getTracks()
            .forEach(
                track => {
                    try {
                        track.stop();
                    } catch (_) {}
                }
            );
    }

    mediaStream =
        null;

    mediaRecorder =
        null;

    audioChunks =
        [];

    isRecording =
        false;

    updateVoiceUI();
}


function updateVoiceUI() {
    if (!voiceButton) {
        return;
    }

    voiceButton.textContent =
        isRecording
            ? "⏹️"
            : "🎙️";

    voiceButton.classList.toggle(
        "recording",
        isRecording
    );

    voiceButton.title =
        isRecording
            ? "توقف ضبط"
            : "ضبط پیام صوتی";
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

function getWebSocketUrl() {
    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return (
        `${protocol}//${location.host}/ws`
    );
}


function connectWebSocket() {
    if (!getCurrentUserId()) {
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

    clearTimeout(
        reconnectTimer
    );

    const url =
        getWebSocketUrl();

    console.log(
        "GAPINO WebSocket:",
        url
    );

    try {
        socket =
            new WebSocket(url);

    } catch (error) {
        console.error(
            "WebSocket create error:",
            error
        );

        scheduleReconnect();

        return;
    }

    socket.onopen =
        () => {
            reconnectAttempts =
                0;

            startPing();

            if (
                currentChatUser
            ) {
                setChatInputEnabled(
                    true
                );
            }

            console.log(
                "GAPINO WebSocket connected"
            );
        };

    socket.onmessage =
        event => {
            handleSocketMessage(
                event.data
            );
        };

    socket.onerror =
        error => {
            console.error(
                "WebSocket error:",
                error
            );
        };

    socket.onclose =
        event => {
            console.warn(
                "GAPINO WebSocket closed:",
                event.code,
                event.reason
            );

            stopPing();

            scheduleReconnect();
        };
}


function sendSocket(data) {
    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {
        return false;
    }

    try {
        socket.send(
            JSON.stringify(data)
        );

        return true;

    } catch (error) {
        console.error(
            "Socket send error:",
            error
        );

        return false;
    }
}


function scheduleReconnect() {
    clearTimeout(
        reconnectTimer
    );

    reconnectAttempts =
        Math.min(
            reconnectAttempts + 1,
            10
        );

    const delay =
        Math.min(
            1000 *
            Math.pow(
                1.5,
                reconnectAttempts - 1
            ),
            10000
        );

    reconnectTimer =
        setTimeout(
            connectWebSocket,
            delay
        );
}


function startPing() {
    stopPing();

    pingTimer =
        setInterval(
            () => {
                sendSocket({
                    type:
                        "ping"
                });
            },
            25000
        );
}


function stopPing() {
    if (pingTimer) {
        clearInterval(
            pingTimer
        );

        pingTimer = null;
    }
}


/* =========================================================
   SOCKET MESSAGE
   ========================================================= */

function handleSocketMessage(
    raw
) {
    let data;

    try {
        data =
            typeof raw === "string"
                ? JSON.parse(raw)
                : raw;

    } catch (error) {
        console.error(
            "Invalid socket JSON:",
            raw
        );

        return;
    }

    if (!data) {
        return;
    }


    /* CALL SIGNALING */

    if (
        typeof data.type ===
            "string" &&
        data.type.startsWith(
            "call_"
        )
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


    /* READY */

    if (
        data.type ===
        "ready"
    ) {
        if (
            Array.isArray(
                data.online
            )
        ) {
            updatePresence({
                users:
                    data.online
            });
        }

        return;
    }


    /* PONG */

    if (
        data.type === "connected" ||
        data.type === "pong"
    ) {
        return;
    }


    /* ONLINE */

    if (
        data.type === "user_online" ||
        data.type === "online"
    ) {
        updateSingleUserPresence(
            data.user_id,
            true
        );

        return;
    }


    /* OFFLINE */

    if (
        data.type ===
            "user_offline" ||
        data.type ===
            "offline"
    ) {
        updateSingleUserPresence(
            data.user_id,
            false
        );

        return;
    }


    /* TYPING */

    if (
        data.type ===
        "typing"
    ) {
        const senderId =
            String(
                data.from ??
                data.sender_id ??
                ""
            );

        if (
            currentChatUser &&
            getUserId(
                currentChatUser
            ) === senderId
        ) {
            if (
                data.value ===
                false
            ) {
                hideTyping();
            } else {
                showTyping();
            }
        }

        return;
    }


    /* MESSAGE UPDATE */

    if (
        data.type ===
        "message:update"
    ) {
        if (
            currentChatUser
        ) {
            loadConversation(
                getUserId(
                    currentChatUser
                )
            );
        }

        return;
    }


    /* MESSAGE */

    if (
        data.type ===
        "message"
    ) {
        receiveMessage(
            data.message
        );

        return;
    }


    /* ERROR */

    if (
        data.type ===
        "error"
    ) {
        showToast(
            data.message ||
            "خطایی رخ داد."
        );
    }
}


/* =========================================================
   RECEIVE MESSAGE
   ========================================================= */

function receiveMessage(
    message
) {
    if (!message) {
        return;
    }

    const sender =
        String(
            message.sender_id ??
            message.sender ??
            ""
        );

    const receiver =
        String(
            message.receiver_id ??
            message.receiver ??
            ""
        );

    const me =
        getCurrentUserId();

    const selected =
        currentChatUser
            ? getUserId(
                currentChatUser
            )
            : "";

    const belongs =
        (
            sender === me &&
            receiver === selected
        ) ||
        (
            receiver === me &&
            sender === selected
        );

    if (belongs) {
        appendMessage(
            message,
            true
        );

        return;
    }

    if (
        sender !== me
    ) {
        showToast(
            "💬 پیام جدید"
        );

        if (
            currentChatUser &&
            sender ===
                getUserId(
                    currentChatUser
                )
        ) {
            loadConversation(
                sender
            );
        }
    }
}


/* =========================================================
   PRESENCE
   ========================================================= */

function updatePresence(
    data
) {
    const onlineIds =
        Array.isArray(
            data?.users
        )
            ? data.users.map(
                String
            )
            : [];

    allUsers =
        allUsers.map(
            user => {
                const id =
                    getUserId(
                        user
                    );

                const online =
                    onlineIds.includes(
                        id
                    );

                return {
                    ...user,
                    online,
                    status:
                        online
                            ? "آنلاین"
                            : "آفلاین"
                };
            }
        );

    window.GAPINO_USERS =
        allUsers;

    renderUsers();

    if (currentChatUser) {
        const updated =
            allUsers.find(
                item =>
                    getUserId(
                        item
                    ) ===
                    getUserId(
                        currentChatUser
                    )
            );

        if (updated) {
            currentChatUser =
                updated;

            updateChatHeader(
                updated
            );
        }
    }
}


function updateSingleUserPresence(
    userId,
    online
) {
    const target =
        String(
            userId || ""
        );

    if (!target) {
        return;
    }

    allUsers =
        allUsers.map(
            user => {
                if (
                    getUserId(
                        user
                    ) !== target
                ) {
                    return user;
                }

                return {
                    ...user,
                    online:
                        Boolean(
                            online
                        ),
                    status:
                        online
                            ? "آنلاین"
                            : "آفلاین"
                };
            }
        );

    window.GAPINO_USERS =
        allUsers;

    renderUsers();

    if (
        currentChatUser &&
        getUserId(
            currentChatUser
        ) === target
    ) {
        currentChatUser = {
            ...currentChatUser,
            online:
                Boolean(
                    online
                ),
            status:
                online
                    ? "آنلاین"
                    : "آفلاین"
        };

        updateChatHeader(
            currentChatUser
        );
    }
}


/* =========================================================
   PROFILE
   ========================================================= */

function openMyProfile() {
    if (!profilePanel) {
        return;
    }

    if (profileName) {
        profileName.textContent =
            getUserName(
                currentUser
            );
    }

    if (profileUsername) {
        const username =
            safeText(
                currentUser?.username
            );

        profileUsername.textContent =
            username
                ? `@${username}`
                : "کاربر";
    }

    renderAvatar(
        profileAvatar,
        currentUser
    );

    if (editDisplayName) {
        editDisplayName.value =
            currentUser?.display_name ||
            currentUser?.username ||
            "";
    }

    if (editBio) {
        editBio.value =
            currentUser?.bio ||
            "";
    }

    if (editStatus) {
        editStatus.value =
            currentUser?.status ||
            "در دسترس";
    }

    selectedAvatarUrl =
        currentUser?.avatar ||
        "";

    profilePanel.hidden =
        false;

    profilePanel.classList.add(
        "open"
    );
}


function closeMyProfile() {
    if (!profilePanel) {
        return;
    }

    profilePanel.hidden =
        true;

    profilePanel.classList.remove(
        "open"
    );
}


async function saveMyProfile() {
    if (isSavingProfile) {
        return;
    }

    const displayName =
        safeText(
            editDisplayName?.value
        ).trim();

    const bio =
        safeText(
            editBio?.value
        ).trim();

    const status =
        safeText(
            editStatus?.value
        ).trim();

    if (!displayName) {
        showToast(
            "نام نمایشی را وارد کن."
        );

        return;
    }

    isSavingProfile =
        true;

    if (saveProfile) {
        saveProfile.disabled =
            true;

        saveProfile.textContent =
            "در حال ذخیره...";
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
                                status
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

            updateCurrentUserUI();

            await loadUsers();

            showToast(
                "✅ پروفایل ذخیره شد."
            );

            closeMyProfile();

        } else {
            throw new Error(
                data?.message ||
                "ذخیره پروفایل انجام نشد."
            );
        }

    } catch (error) {
        console.error(
            "Profile error:",
            error
        );

        showToast(
            error.message ||
            "ذخیره پروفایل انجام نشد."
        );

    } finally {
        isSavingProfile =
            false;

        if (saveProfile) {
            saveProfile.disabled =
                false;

            saveProfile.textContent =
                "ذخیره تغییرات";
        }
    }
}


/* =========================================================
   THEME
   ========================================================= */

function loadTheme() {
    const theme =
        localStorage.getItem(
            "gapino_theme"
        ) || "dark";

    document.documentElement
        .setAttribute(
            "data-theme",
            theme
        );

    updateThemeButton(
        theme
    );
}


function updateThemeButton(
    theme
) {
    if (!themeButton) {
        return;
    }

    themeButton.textContent =
        theme === "dark"
            ? "☀️ حالت روشن"
            : "🌙 حالت تیره";
}


function toggleTheme() {
    const current =
        document.documentElement
            .getAttribute(
                "data-theme"
            ) || "dark";

    const next =
        current === "dark"
            ? "light"
            : "dark";

    document.documentElement
        .setAttribute(
            "data-theme",
            next
        );

    localStorage.setItem(
        "gapino_theme",
        next
    );

    updateThemeButton(
        next
    );
}


/* =========================================================
   MOBILE
   ========================================================= */

function openSidebar() {
    appShell?.classList.add(
        "sidebar-open"
    );

    if (appOverlay) {
        appOverlay.hidden =
            false;
    }
}


function closeSidebar() {
    appShell?.classList.remove(
        "sidebar-open"
    );

    if (appOverlay) {
        appOverlay.hidden =
            true;
    }
}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {
    try {
        await apiFetch(
            "/api/logout",
            {
                method:
                    "POST"
            }
        );
    } catch (_) {}

    cleanupVoice();

    stopPing();

    clearTimeout(
        reconnectTimer
    );

    clearInterval(
        usersRefreshTimer
    );

    if (socket) {
        try {
            socket.close();
        } catch (_) {}
    }

    localStorage.removeItem(
        "gapino_user"
    );

    window.location.replace(
        "/login.html"
    );
}


/* =========================================================
   EVENTS
   ========================================================= */

profileButton?.addEventListener(
    "click",
    openMyProfile
);

profileHeaderButton?.addEventListener(
    "click",
    openMyProfile
);

closeProfile?.addEventListener(
    "click",
    closeMyProfile
);

saveProfile?.addEventListener(
    "click",
    saveMyProfile
);

themeButton?.addEventListener(
    "click",
    toggleTheme
);

logoutButton?.addEventListener(
    "click",
    logout
);

mobileMenuButton?.addEventListener(
    "click",
    openSidebar
);

menuButton?.addEventListener(
    "click",
    closeSidebar
);

appOverlay?.addEventListener(
    "click",
    closeSidebar
);

refreshButton?.addEventListener(
    "click",
    async () => {
        await loadUsers();

        if (currentChatUser) {
            await loadConversation(
                getUserId(
                    currentChatUser
                )
            );
        }

        showToast(
            "🔄 بروزرسانی شد."
        );
    }
);

userSearch?.addEventListener(
    "input",
    () => {
        renderUsers();

        if (clearSearch) {
            clearSearch.hidden =
                !userSearch.value.trim();
        }
    }
);

clearSearch?.addEventListener(
    "click",
    () => {
        if (userSearch) {
            userSearch.value = "";
        }

        if (clearSearch) {
            clearSearch.hidden =
                true;
        }

        renderUsers();
    }
);

messageInput?.addEventListener(
    "input",
    () => {
        resizeMessageInput();
        sendTyping();
    }
);

messageInput?.addEventListener(
    "keydown",
    event => {
        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {
            event.preventDefault();
            sendTextMessage();
        }
    }
);

sendButton?.addEventListener(
    "click",
    sendTextMessage
);

attachButton?.addEventListener(
    "click",
    () => fileInput?.click()
);

fileInput?.addEventListener(
    "change",
    async () => {
        const file =
            fileInput.files?.[0];

        if (!file) {
            return;
        }

        await sendFile(
            file
        );

        fileInput.value = "";
    }
);

voiceButton?.addEventListener(
    "click",
    toggleVoiceRecording
);


/* =========================================================
   CALL BUTTON
   ========================================================= */

callButton?.addEventListener(
    "click",
    () => {

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
            window.GAPINO_CALL &&
            typeof
                window.GAPINO_CALL.start ===
                "function"
        ) {

            window.GAPINO_CALL.start();

        } else {

            showToast(
                "سیستم تماس هنوز آماده نشده است."
            );

            console.error(
                "GAPINO_CALL.start is not available"
            );
        }

    }
);


document.addEventListener(
    "keydown",
    event => {
        if (
            event.key ===
            "Escape"
        ) {
            closeMyProfile();
            closeSidebar();
        }
    }
);

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.visibilityState !==
                "visible" ||
            !currentUser
        ) {
            return;
        }

        loadUsers();

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
            connectWebSocket();

        } else {
            sendSocket({
                type:
                    "ping"
            });
        }
    }
);

window.addEventListener(
    "beforeunload",
    () => {

        clearTimeout(
            reconnectTimer
        );

        clearInterval(
            usersRefreshTimer
        );

        clearTimeout(
            typingTimer
        );

        stopPing();

        cleanupVoice();
    }
);


/* =========================================================
   RESIZE
   ========================================================= */

function resizeMessageInput() {
    if (!messageInput) {
        return;
    }

    messageInput.style.height =
        "auto";

    messageInput.style.height =
        `${Math.min(
            messageInput.scrollHeight,
            140
        )}px`;
}


/* =========================================================
   INIT
   ========================================================= */

async function initGapino() {

    loadTheme();

    setChatInputEnabled(
        false
    );

    currentUser =
        await loadCurrentUser();

    if (!currentUser) {
        return;
    }

    updateCurrentUserUI();

    await loadUsers();

    connectWebSocket();

    clearInterval(
        usersRefreshTimer
    );

    usersRefreshTimer =
        setInterval(
            () => {
                if (currentUser) {
                    loadUsers();
                }
            },
            15000
        );
}


if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initGapino,
        {
            once:
                true
        }
    );
} else {
    initGapino();
}


/* =========================================================
   PUBLIC API
   ========================================================= */

window.GAPINO = {

    get currentUser() {
        return currentUser;
    },

    get currentChatUser() {
        return currentChatUser;
    },

    get socket() {
        return socket;
    },

    get users() {
        return allUsers;
    },

    connectWebSocket,

    loadUsers,

    openChat,

    sendTextMessage,

    toggleVoiceRecording,

    sendFile,

    showToast,

    markConversationRead
};

window.GAPINO_USERS =
    allUsers;
