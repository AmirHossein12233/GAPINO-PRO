"use strict";

/* =========================================================
   GAPINO PRO
   frontend/chat.js

   سازگار با:
   - chat.html فعلی
   - style.css جدید
   - main.py / FastAPI
   - WebSocket /ws/{user_id}
   - /users
   - /messages/{my_id}/{other_id}
   - /upload
   - /unread/read
   - /me
   - /logout
   - پروفایل
   - ویس
   ========================================================= */


/* =========================================================
   CONFIG
   ========================================================= */

const API_BASE = window.location.origin;


/* =========================================================
   STATE
   ========================================================= */

let currentUser = null;
let currentChatUser = null;

let socket = null;

let reconnectTimer = null;
let pingTimer = null;
let usersRefreshTimer = null;
let typingTimer = null;

let reconnectAttempts = 0;

let allUsers = [];

let isRecording = false;
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];

let isSavingProfile = false;

let sidebarOpen = false;


/* =========================================================
   DOM HELPER
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}


/* =========================================================
   DOM ELEMENTS
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
   SAFE TEXT
   ========================================================= */

function safeText(value) {
    return String(value ?? "");
}


/* =========================================================
   USER HELPERS
   ========================================================= */

function getUserId(user) {
    return String(
        user?.id ||
        user?.user_id ||
        ""
    );
}


function getCurrentUserId() {
    return getUserId(currentUser);
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


function getUsername(user) {
    return user?.username
        ? `@${user.username}`
        : "@user";
}


function isOnline(user) {
    return Boolean(
        user?.online === true ||
        user?.status === "online" ||
        user?.status === "آنلاین"
    );
}


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message, duration = 2600) {

    if (!toast) {
        console.log("GAPINO:", message);
        return;
    }


    toast.textContent =
        safeText(message);


    toast.classList.add(
        "show"
    );


    clearTimeout(
        showToast.timer
    );


    showToast.timer =
        setTimeout(
            () => {

                toast.classList.remove(
                    "show"
                );

            },
            duration
        );
}


/* =========================================================
   API
   ========================================================= */

async function apiFetch(
    path,
    options = {}
) {

    const response =
        await fetch(
            API_BASE + path,
            {
                ...options,

                credentials:
                    "include",

                cache:
                    "no-store"
            }
        );


    const type =
        response.headers.get(
            "content-type"
        ) || "";


    let data = null;


    try {

        if (
            type.includes(
                "application/json"
            )
        ) {

            data =
                await response.json();

        } else {

            const text =
                await response.text();

            data =
                text
                    ? {
                        detail: text
                    }
                    : null;
        }

    } catch (_) {

        data = null;
    }


    if (!response.ok) {

        throw new Error(
            data?.message ||
            data?.detail ||
            `HTTP ${response.status}`
        );
    }


    return data;
}


/* =========================================================
   AVATAR
   ========================================================= */

function getAvatarLetter(user) {

    const name =
        getUserName(
            user
        ).trim();


    return (
        name.charAt(0) ||
        "👤"
    );
}


function renderAvatar(
    element,
    user
) {

    if (!element) {
        return;
    }


    element.innerHTML =
        "";


    const avatar =
        safeText(
            user?.avatar
        ).trim();


    if (!avatar) {

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
        normalizeUrl(
            avatar
        );


    image.alt =
        "آواتار";


    image.loading =
        "lazy";


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


/* =========================================================
   URL
   ========================================================= */

function normalizeUrl(
    url
) {

    const value =
        safeText(
            url
        );


    if (!value) {
        return "";
    }


    if (
        /^https?:\/\//i.test(
            value
        )
    ) {

        return value;
    }


    if (
        value.startsWith(
            "blob:"
        ) ||
        value.startsWith(
            "data:"
        )
    ) {

        return value;
    }


    if (
        value.startsWith("/")
    ) {

        return API_BASE + value;
    }


    return API_BASE + "/" + value;
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
            getUserName(
                currentUser
            );
    }


    if (currentUsername) {

        currentUsername.textContent =
            getUsername(
                currentUser
            );
    }


    renderAvatar(
        currentAvatar,
        currentUser
    );
}


/* =========================================================
   CHAT HEADER
   ========================================================= */

function updateChatHeader(
    user
) {

    if (!user) {
        return;
    }


    if (chatName) {

        chatName.textContent =
            getUserName(
                user
            );
    }


    if (chatStatus) {

        const online =
            isOnline(
                user
            );


        chatStatus.textContent =
            online
                ? "آنلاین"
                : "آفلاین";


        chatStatus.classList.toggle(
            "online",
            online
        );
    }


    renderAvatar(
        chatAvatar,
        user
    );
}


/* =========================================================
   ENABLE INPUT
   ========================================================= */

function setChatInputEnabled(
    enabled
) {

    const active =
        Boolean(enabled);


    if (messageInput) {

        messageInput.disabled =
            !active;


        messageInput.placeholder =
            active
                ? "پیامت را بنویس..."
                : "ابتدا یک کاربر را انتخاب کن...";
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
}


/* =========================================================
   SESSION
   ========================================================= */

async function loadCurrentUser() {

    try {

        const data =
            await apiFetch(
                "/me"
            );


        if (
            data?.authenticated &&
            data?.user
        ) {

            currentUser =
                data.user;


            localStorage.setItem(
                "gapino_user",
                JSON.stringify(
                    currentUser
                )
            );


            updateCurrentUserUI();

            updateProfileUI();


            return true;
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


    return false;
}


/* =========================================================
   LOAD USERS
   ========================================================= */

async function loadUsers() {

    try {

        const data =
            await apiFetch(
                "/users"
            );


        if (
            Array.isArray(
                data
            )
        ) {

            allUsers =
                data;

        } else if (
            Array.isArray(
                data?.users
            )
        ) {

            allUsers =
                data.users;

        } else {

            allUsers =
                [];
        }


        renderUsers();

    } catch (error) {

        console.error(
            "Users error:",
            error
        );


        if (userList) {

            userList.innerHTML = `
                <div class="empty-users">
                    <div class="empty-icon">⚠️</div>
                    <strong>دریافت کاربران انجام نشد</strong>
                    <span>اتصال سرور را بررسی کن.</span>
                </div>
            `;
        }
    }
}


/* =========================================================
   RENDER USERS
   ========================================================= */

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
        allUsers.filter(
            user => {

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
                    getUserName(
                        user
                    ).toLowerCase();


                const username =
                    safeText(
                        user.username
                    ).toLowerCase();


                return (
                    name.includes(
                        query
                    ) ||
                    username.includes(
                        query
                    )
                );
            }
        );


    if (userCount) {

        userCount.textContent =
            filtered.length.toLocaleString(
                "fa-IR"
            );
    }


    userList.innerHTML =
        "";


    if (!filtered.length) {

        userList.innerHTML = `
            <div class="empty-users">
                <div class="empty-icon">💬</div>
                <strong>${
                    query
                        ? "کاربری پیدا نشد"
                        : "هنوز کاربر دیگری وجود ندارد"
                }</strong>
                <span>${
                    query
                        ? "عبارت جستجو را تغییر بده."
                        : "برای شروع گفتگو، کاربر دیگری ثبت‌نام کند."
                }</span>
            </div>
        `;


        return;
    }


    filtered.forEach(
        user => {

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
                getUserId(
                    currentChatUser
                ) ===
                    getUserId(
                        user
                    )
            ) {

                item.classList.add(
                    "active"
                );
            }


            if (
                isOnline(user)
            ) {

                item.classList.add(
                    "online"
                );
            }


            const avatar =
                document.createElement(
                    "div"
                );


            avatar.className =
                "avatar";


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
                    "div"
                );


            name.className =
                "user-item-name";


            name.textContent =
                getUserName(
                    user
                );


            const username =
                document.createElement(
                    "div"
                );


            username.className =
                "user-item-username";


            username.textContent =
                user.username
                    ? `@${user.username}`
                    : "";


            const status =
                document.createElement(
                    "div"
                );


            status.className =
                "user-item-status";


            status.textContent =
                isOnline(user)
                    ? "آنلاین"
                    : "آفلاین";


            info.appendChild(
                name
            );


            if (
                user.username
            ) {

                info.appendChild(
                    username
                );
            }


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


            userList.appendChild(
                item
            );
        }
    );
}


/* =========================================================
   OPEN CHAT
   ========================================================= */

async function openChat(
    user
) {

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


    if (chatContact) {

        chatContact.hidden =
            false;
    }


    if (chatHeaderEmpty) {

        chatHeaderEmpty.hidden =
            true;
    }


    closeSidebar();


    clearMessages();


    await loadConversation(
        getUserId(
            user
        )
    );


    await markConversationRead(
        getUserId(
            user
        )
    );


    messageInput?.focus();
}


/* =========================================================
   LOAD CONVERSATION
   ========================================================= */

async function loadConversation(
    otherUserId
) {

    if (
        !getCurrentUserId() ||
        !otherUserId
    ) {

        return;
    }


    try {

        const data =
            await apiFetch(
                `/messages/${encodeURIComponent(
                    getCurrentUserId()
                )}/${encodeURIComponent(
                    otherUserId
                )}`
            );


        const messages =
            Array.isArray(
                data
            )
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
            "Messages error:",
            error
        );


        showToast(
            "دریافت پیام‌ها انجام نشد."
        );
    }
}


/* =========================================================
   RENDER MESSAGES
   ========================================================= */

function renderMessages(
    messages
) {

    if (!messagesBox) {
        return;
    }


    messagesBox.innerHTML =
        "";


    if (
        !Array.isArray(
            messages
        ) ||
        !messages.length
    ) {

        clearMessages();

        return;
    }


    messages.forEach(
        message => {

            appendMessage(
                message,
                false
            );
        }
    );


    scrollToBottom();
}


/* =========================================================
   EMPTY CHAT
   ========================================================= */

function clearMessages() {

    if (!messagesBox) {
        return;
    }


    const name =
        currentChatUser
            ? getUserName(
                currentChatUser
            )
            : "کاربر";


    messagesBox.innerHTML = `
        <div class="empty-chat">
            <div class="empty-chat-icon">💬</div>
            <h2>گفتگو</h2>
            <p>
                اولین پیامت را برای
                ${escapeHtml(name)}
                بفرست.
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


/* =========================================================
   APPEND MESSAGE
   ========================================================= */

function appendMessage(
    message,
    scroll = true
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
            message.sender_id ||
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
        mine
            ? "message mine"
            : "message theirs";


    renderMessageContent(
        bubble,
        message
    );


    const meta =
        document.createElement(
            "div"
        );


    meta.className =
        "message-meta";


    const time =
        document.createElement(
            "span"
        );


    time.textContent =
        formatTime(
            message.created_at ||
            message.time
        );


    meta.appendChild(
        time
    );


    if (mine) {

        const ticks =
            document.createElement(
                "span"
            );


        ticks.className =
            "message-ticks";


        ticks.textContent =
            "✓✓";


        meta.appendChild(
            ticks
        );
    }


    bubble.appendChild(
        meta
    );


    row.appendChild(
        bubble
    );


    messagesBox.appendChild(
        row
    );


    if (scroll) {

        scrollToBottom();
    }
}


/* =========================================================
   MESSAGE CONTENT
   ========================================================= */

function renderMessageContent(
    container,
    message
) {

    if (
        message.deleted ||
        message.is_deleted
    ) {

        const deleted =
            document.createElement(
                "div"
            );


        deleted.className =
            "deleted-message";


        deleted.textContent =
            "پیام حذف شده است";


        container.appendChild(
            deleted
        );


        return;
    }


    if (
        message.file
    ) {

        renderFile(
            container,
            message.file
        );


        return;
    }


    if (
        message.file_url ||
        message.file_name
    ) {

        renderFile(
            container,
            {
                url:
                    message.file_url,

                name:
                    message.file_name,

                size:
                    message.file_size,

                type:
                    message.file_type
            }
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


    container.appendChild(
        text
    );
}


/* =========================================================
   RENDER FILE
   ========================================================= */

function renderFile(
    container,
    file
) {

    const url =
        normalizeUrl(
            file?.url ||
            file?.file_url
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
            file?.file_type ||
            ""
        ).toLowerCase();


    const audio =
        Boolean(
            file?.is_audio ||
            type.startsWith(
                "audio/"
            ) ||
            /\.(webm|ogg|mp3|wav|m4a|aac|opus)(\?|$)/i.test(
                url
            )
        );


    const image =
        Boolean(
            file?.is_image ||
            type.startsWith(
                "image/"
            ) ||
            /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(
                url
            )
        );


    if (!url) {

        const text =
            document.createElement(
                "div"
            );


        text.className =
            "message-text";


        text.textContent =
            name;


        container.appendChild(
            text
        );


        return;
    }


    /* AUDIO */

    if (audio) {

        const wrapper =
            document.createElement(
                "div"
            );


        wrapper.className =
            "message-audio";


        const audioElement =
            document.createElement(
                "audio"
            );


        audioElement.controls =
            true;


        audioElement.preload =
            "metadata";


        audioElement.src =
            url;


        wrapper.appendChild(
            audioElement
        );


        const label =
            document.createElement(
                "div"
            );


        label.className =
            "voice-name";


        label.textContent =
            "🎙️ پیام صوتی";


        wrapper.appendChild(
            label
        );


        container.appendChild(
            wrapper
        );


        return;
    }


    /* IMAGE */

    if (image) {

        const img =
            document.createElement(
                "img"
            );


        img.className =
            "message-image";


        img.src =
            url;


        img.alt =
            name;


        img.loading =
            "lazy";


        img.addEventListener(
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
            img
        );


        return;
    }


    /* FILE */

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


    const icon =
        document.createElement(
            "span"
        );


    icon.className =
        "message-file-icon";


    icon.textContent =
        "📎";


    const info =
        document.createElement(
            "div"
        );


    info.className =
        "message-file-info";


    const filename =
        document.createElement(
            "div"
        );


    filename.className =
        "message-file-name";


    filename.textContent =
        name;


    const sizeElement =
        document.createElement(
            "div"
        );


    sizeElement.className =
        "message-file-link";


    sizeElement.textContent =
        size > 0
            ? formatFileSize(
                size
            )
            : "باز کردن فایل";


    info.appendChild(
        filename
    );


    info.appendChild(
        sizeElement
    );


    link.appendChild(
        icon
    );


    link.appendChild(
        info
    );


    container.appendChild(
        link
    );
}


/* =========================================================
   FORMAT FILE SIZE
   ========================================================= */

function formatFileSize(
    bytes
) {

    const size =
        Number(
            bytes || 0
        );


    if (
        size < 1024
    ) {

        return `${size} بایت`;
    }


    if (
        size <
        1024 * 1024
    ) {

        return `${(
            size / 1024
        ).toFixed(1)} KB`;
    }


    return `${(
        size /
        1024 /
        1024
    ).toFixed(1)} MB`;
}


/* =========================================================
   FORMAT TIME
   ========================================================= */

function formatTime(
    value
) {

    if (!value) {
        return "";
    }


    const text =
        safeText(
            value
        );


    if (
        /^\d{1,2}:\d{2}$/.test(
            text
        )
    ) {

        return text;
    }


    const date =
        new Date(
            value
        );


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
            hour:
                "2-digit",

            minute:
                "2-digit"
        }
    );
}


/* =========================================================
   SCROLL
   ========================================================= */

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
        )
        .trim();


    if (!text) {
        return;
    }


    if (
        text.length >
        5000
    ) {

        showToast(
            "پیام نباید بیشتر از ۵۰۰۰ کاراکتر باشد."
        );


        return;
    }


    const success =
        sendSocket(
            {
                type:
                    "message",

                receiver_id:
                    getUserId(
                        currentChatUser
                    ),

                text:
                    text
            }
        );


    if (!success) {

        showToast(
            "اتصال چت برقرار نیست."
        );


        return;
    }


    messageInput.value =
        "";


    resizeMessageInput();

    stopTyping();
}


/* =========================================================
   TYPING
   ========================================================= */

function sendTyping() {

    if (!currentChatUser) {
        return;
    }


    sendSocket(
        {
            type:
                "typing",

            receiver_id:
                getUserId(
                    currentChatUser
                )
        }
    );


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


    sendSocket(
        {
            type:
                "stop_typing",

            receiver_id:
                getUserId(
                    currentChatUser
                )
        }
    );
}


/* =========================================================
   SHOW / HIDE TYPING
   ========================================================= */

function showTyping() {

    if (!typingArea) {
        return;
    }


    typingArea.hidden =
        false;


    typingArea.style.display =
        "flex";
}


function hideTyping() {

    if (!typingArea) {
        return;
    }


    typingArea.hidden =
        true;


    typingArea.style.display =
        "none";
}


/* =========================================================
   RESIZE INPUT
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
            132
        )}px`;
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


    sendSocket(
        {
            type:
                "read",

            other_user_id:
                String(
                    otherUserId
                )
        }
    );


    try {

        await apiFetch(
            "/unread/read",
            {
                method:
                    "POST",

                headers:
                    {
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    },

                body:
                    new URLSearchParams(
                        {
                            other_user_id:
                                String(
                                    otherUserId
                                )
                        }
                    )
            }
        );

    } catch (_) {}
}


/* =========================================================
   UPLOAD FILE
   ========================================================= */

async function uploadFile(
    file
) {

    if (!file) {
        return null;
    }


    const maxSize =
        10 *
        1024 *
        1024;


    if (
        file.size >
        maxSize
    ) {

        showToast(
            "حجم فایل نباید بیشتر از ۱۰ مگابایت باشد."
        );


        return null;
    }


    const form =
        new FormData();


    form.append(
        "file",
        file
    );


    try {

        showToast(
            file.type?.startsWith(
                "audio/"
            )
                ? "🎙️ در حال ارسال ویس..."
                : "📤 در حال آپلود..."
        );


        const data =
            await apiFetch(
                "/upload",
                {
                    method:
                        "POST",

                    body:
                        form
                }
            );


        if (
            data?.success === false
        ) {

            throw new Error(
                data.message ||
                "آپلود انجام نشد."
            );
        }


        return (
            data?.file ||
            {
                url:
                    data?.url ||
                    data?.file_url,

                name:
                    data?.name ||
                    file.name,

                size:
                    data?.size ||
                    file.size,

                type:
                    data?.type ||
                    file.type
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


/* =========================================================
   SEND FILE
   ========================================================= */

async function sendFile(
    file
) {

    if (
        !file ||
        !currentChatUser
    ) {

        return;
    }


    const uploaded =
        await uploadFile(
            file
        );


    if (!uploaded) {
        return;
    }


    const success =
        sendSocket(
            {
                type:
                    "file",

                receiver_id:
                    getUserId(
                        currentChatUser
                    ),

                file:
                    uploaded
            }
        );


    if (!success) {

        showToast(
            "اتصال چت برقرار نیست."
        );


        return;
    }


    if (
        file.type?.startsWith(
            "audio/"
        )
    ) {

        showToast(
            "🎙️ ویس ارسال شد."
        );

    } else if (
        file.type?.startsWith(
            "image/"
        )
    ) {

        showToast(
            "🖼️ تصویر ارسال شد."
        );

    } else {

        showToast(
            "📎 فایل ارسال شد."
        );
    }
}


/* =========================================================
   VOICE
   ========================================================= */

function getSupportedAudioType() {

    if (
        !window.MediaRecorder
    ) {

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


/* =========================================================
   VOICE UI
   ========================================================= */

function updateVoiceUI() {

    if (!voiceButton) {
        return;
    }


    if (isRecording) {

        voiceButton.textContent =
            "⏹️";


        voiceButton.title =
            "توقف ضبط";


        voiceButton.setAttribute(
            "aria-label",
            "توقف ضبط"
        );


        voiceButton.classList.add(
            "recording"
        );

    } else {

        voiceButton.textContent =
            "🎙️";


        voiceButton.title =
            "ضبط پیام صوتی";


        voiceButton.setAttribute(
            "aria-label",
            "ضبط پیام صوتی"
        );


        voiceButton.classList.remove(
            "recording"
        );
    }
}


/* =========================================================
   TOGGLE VOICE
   ========================================================= */

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
            "دستگاه یا مرورگر از ضبط صدا پشتیبانی نمی‌کند."
        );


        return;
    }


    try {

        mediaStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio:
                        {
                            echoCancellation:
                                true,

                            noiseSuppression:
                                true,

                            autoGainControl:
                                true
                        }
                }
            );


        audioChunks =
            [];


        const mimeType =
            getSupportedAudioType();


        mediaRecorder =
            mimeType
                ? new MediaRecorder(
                    mediaStream,
                    {
                        mimeType:
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
                    event.data.size >
                        0
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


                    if (
                        !blob.size
                    ) {

                        cleanupVoice();


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


                    cleanupVoice();


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
                        "ارسال ویس انجام نشد."
                    );
                }
            };


        mediaRecorder.onerror =
            error => {

                console.error(
                    "Recorder error:",
                    error
                );


                cleanupVoice();


                showToast(
                    "خطا در ضبط صدا."
                );
            };


        mediaRecorder.start(
            250
        );


        isRecording =
            true;


        updateVoiceUI();


        showToast(
            "🎙️ در حال ضبط ویس..."
        );

    } catch (error) {

        console.error(
            "Microphone:",
            error
        );


        cleanupVoice();


        if (
            error?.name ===
            "NotAllowedError"
        ) {

            showToast(
                "اجازه استفاده از میکروفن داده نشد."
            );

        } else {

            showToast(
                "امکان شروع ضبط صدا وجود ندارد."
            );
        }
    }
}


/* =========================================================
   STOP VOICE
   ========================================================= */

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


/* =========================================================
   CLEAN VOICE
   ========================================================= */

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


/* =========================================================
   WEBSOCKET URL
   ========================================================= */

function getWebSocketUrl() {

    const protocol =
        location.protocol ===
        "https:"
            ? "wss:"
            : "ws:";


    return (
        `${protocol}//${location.host}` +
        `/ws/${encodeURIComponent(
            getCurrentUserId()
        )}`
    );
}


/* =========================================================
   CONNECT WEBSOCKET
   ========================================================= */

function connectWebSocket() {

    if (
        !getCurrentUserId()
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


    clearTimeout(
        reconnectTimer
    );


    try {

        socket =
            new WebSocket(
                getWebSocketUrl()
            );

    } catch (error) {

        console.error(
            "WebSocket create:",
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


            console.log(
                "✅ GAPINO WebSocket connected"
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
                "WebSocket closed:",
                event.code
            );


            stopPing();


            scheduleReconnect();
        };
}


/* =========================================================
   SEND SOCKET
   ========================================================= */

function sendSocket(
    data
) {

    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {

        connectWebSocket();


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
            "Socket send:",
            error
        );


        return false;
    }
}


/* =========================================================
   RECONNECT
   ========================================================= */

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


/* =========================================================
   PING
   ========================================================= */

function startPing() {

    stopPing();


    pingTimer =
        setInterval(
            () => {

                sendSocket(
                    {
                        type:
                            "ping"
                    }
                );

            },
            25000
        );
}


function stopPing() {

    if (pingTimer) {

        clearInterval(
            pingTimer
        );


        pingTimer =
            null;
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
            JSON.parse(
                raw
            );

    } catch (error) {

        console.error(
            "Invalid socket data:",
            raw
        );


        return;
    }


    if (!data) {
        return;
    }


    if (
        data.type ===
            "connected" ||

        data.type ===
            "pong"
    ) {

        return;
    }


    if (
        data.type ===
        "online_users"
    ) {

        updatePresence(
            data
        );


        return;
    }


    if (
        data.type ===
        "typing"
    ) {

        if (
            currentChatUser &&
            String(
                data.sender_id
            ) ===
                getUserId(
                    currentChatUser
                )
        ) {

            showTyping();
        }


        return;
    }


    if (
        data.type ===
        "stop_typing"
    ) {

        hideTyping();


        return;
    }


    if (
        data.type ===
            "message" ||

        data.type ===
            "file"
    ) {

        receiveMessage(
            data.message
        );


        return;
    }


    if (
        data.type ===
        "profile_updated"
    ) {

        handleProfileUpdated(
            data.user
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
            message.sender_id ||
            ""
        );


    const receiver =
        String(
            message.receiver_id ||
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


        if (
            selected
        ) {

            markConversationRead(
                selected
            );
        }


        return;
    }


    if (
        sender !== me
    ) {

        showToast(
            "💬 پیام جدید داری."
        );
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


                return {
                    ...user,

                    online:
                        onlineIds.includes(
                            id
                        )
                };
            }
        );


    renderUsers();


    if (
        currentChatUser
    ) {

        const updated =
            allUsers.find(
                user =>
                    getUserId(
                        user
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


/* =========================================================
   PROFILE
   ========================================================= */

function updateProfileUI() {

    if (!currentUser) {
        return;
    }


    if (profileName) {

        profileName.textContent =
            getUserName(
                currentUser
            );
    }


    if (profileUsername) {

        profileUsername.textContent =
            getUsername(
                currentUser
            );
    }


    if (profileAvatar) {

        renderAvatar(
            profileAvatar,
            currentUser
        );
    }


    if (editDisplayName) {

        editDisplayName.value =
            safeText(
                currentUser.display_name ||
                currentUser.username
            );
    }


    if (editBio) {

        editBio.value =
            safeText(
                currentUser.bio
            );
    }


    if (editStatus) {

        const status =
            safeText(
                currentUser.status
            );


        if (
            [
                "در دسترس",
                "مشغول",
                "غیرفعال",
                "نامرئی"
            ].includes(
                status
            )
        ) {

            editStatus.value =
                status;
        }
    }
}


/* =========================================================
   OPEN PROFILE
   ========================================================= */

function openProfilePanel() {

    updateProfileUI();


    if (!profilePanel) {
        return;
    }


    profilePanel.hidden =
        false;


    profilePanel.classList.add(
        "open"
    );


    if (
        window.innerWidth <=
        820
    ) {

        openOverlay();
    }
}


/* =========================================================
   CLOSE PROFILE
   ========================================================= */

function closeProfilePanel() {

    if (!profilePanel) {
        return;
    }


    profilePanel.classList.remove(
        "open"
    );


    profilePanel.hidden =
        true;


    closeOverlay();
}


/* =========================================================
   SAVE PROFILE
   ========================================================= */

async function saveProfileData() {

    if (
        isSavingProfile ||
        !currentUser
    ) {

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

        const payload = {
            display_name:
                safeText(
                    editDisplayName?.value
                ).trim(),

            bio:
                safeText(
                    editBio?.value
                ).trim(),

            status:
                safeText(
                    editStatus?.value
                ).trim()
        };


        const data =
            await apiFetch(
                "/profile",
                {
                    method:
                        "POST",

                    headers:
                        {
                            "Content-Type":
                                "application/json"
                        },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );


        const user =
            data?.user ||
            data;


        if (
            user &&
            (
                user.id ||
                user.user_id
            )
        ) {

            currentUser =
                {
                    ...currentUser,
                    ...user
                };

        } else {

            currentUser =
                {
                    ...currentUser,
                    ...payload
                };
        }


        localStorage.setItem(
            "gapino_user",
            JSON.stringify(
                currentUser
            )
        );


        updateCurrentUserUI();

        updateProfileUI();

        renderUsers();


        showToast(
            "✅ پروفایل ذخیره شد."
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
   PROFILE UPDATED
   ========================================================= */

function handleProfileUpdated(
    user
) {

    if (!user) {
        return;
    }


    const id =
        getUserId(
            user
        );


    allUsers =
        allUsers.map(
            item =>
                getUserId(item) === id
                    ? {
                        ...item,
                        ...user
                    }
                    : item
        );


    if (
        id ===
        getCurrentUserId()
    ) {

        currentUser =
            {
                ...currentUser,
                ...user
            };


        localStorage.setItem(
            "gapino_user",
            JSON.stringify(
                currentUser
            )
        );


        updateCurrentUserUI();

        updateProfileUI();
    }


    if (
        currentChatUser &&
        getUserId(
            currentChatUser
        ) === id
    ) {

        currentChatUser =
            {
                ...currentChatUser,
                ...user
            };


        updateChatHeader(
            currentChatUser
        );
    }


    renderUsers();
}


/* =========================================================
   SIDEBAR
   ========================================================= */

function openOverlay() {

    if (!appOverlay) {
        return;
    }


    appOverlay.hidden =
        false;


    appOverlay.style.display =
        "block";
}


function closeOverlay() {

    if (!appOverlay) {
        return;
    }


    appOverlay.hidden =
        true;


    appOverlay.style.display =
        "none";
}


function openSidebar() {

    if (
        window.innerWidth >
        820
    ) {

        return;
    }


    sidebarOpen =
        true;


    appShell?.classList.add(
        "sidebar-open"
    );


    openOverlay();
}


function closeSidebar() {

    sidebarOpen =
        false;


    appShell?.classList.remove(
        "sidebar-open"
    );


    closeOverlay();
}


/* =========================================================
   SEARCH
   ========================================================= */

function clearUserSearch() {

    if (!userSearch) {
        return;
    }


    userSearch.value =
        "";


    if (clearSearch) {

        clearSearch.hidden =
            true;
    }


    renderUsers();


    userSearch.focus();
}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

    cleanupVoice();

    stopPing();

    clearTimeout(
        reconnectTimer
    );


    if (socket) {

        try {
            socket.close();
        } catch (_) {}
    }


    try {

        await apiFetch(
            "/logout",
            {
                method:
                    "POST"
            }
        );

    } catch (_) {}


    localStorage.removeItem(
        "gapino_user"
    );


    window.location.replace(
        "/login.html"
    );
}


/* =========================================================
   REFRESH
   ========================================================= */

async function refreshPageData() {

    try {

        await loadCurrentUser();

        await loadUsers();


        if (
            currentChatUser
        ) {

            await loadConversation(
                getUserId(
                    currentChatUser
                )
            );
        }


        showToast(
            "🔄 اطلاعات به‌روزرسانی شد."
        );

    } catch (error) {

        console.error(
            "Refresh:",
            error
        );
    }
}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(
    value
) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        safeText(
            value
        );


    return div.innerHTML;
}


/* =========================================================
   EVENT LISTENERS
   ========================================================= */


/* SEND */

sendButton?.addEventListener(
    "click",
    sendTextMessage
);


/* ENTER */

messageInput?.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
                "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            sendTextMessage();
        }
    }
);


/* INPUT */

messageInput?.addEventListener(
    "input",
    () => {

        resizeMessageInput();

        sendTyping();
    }
);


/* ATTACH */

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


/* FILE */

fileInput?.addEventListener(
    "change",
    async event => {

        const file =
            event.target.files?.[0];


        if (!file) {
            return;
        }


        await sendFile(
            file
        );


        fileInput.value =
            "";
    }
);


/* VOICE */

voiceButton?.addEventListener(
    "click",
    toggleVoiceRecording
);


/* MOBILE MENU */

mobileMenuButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openSidebar();
    }
);


/* MENU BUTTON */

menuButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();


        if (
            window.innerWidth <=
            820
        ) {

            closeSidebar();
        }
    }
);


/* OVERLAY */

appOverlay?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        closeSidebar();

        closeProfilePanel();
    }
);


/* PROFILE */

profileButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openProfilePanel();
    }
);


profileHeaderButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openProfilePanel();
    }
);


closeProfile?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        closeProfilePanel();
    }
);


/* SAVE PROFILE */

saveProfile?.addEventListener(
    "click",
    saveProfileData
);


/* FULL PROFILE */

profilePageButton?.addEventListener(
    "click",
    () => {

        window.location.href =
            "/profile.html";
    }
);


/* SEARCH */

userSearch?.addEventListener(
    "input",
    () => {

        if (clearSearch) {

            clearSearch.hidden =
                !userSearch.value;
        }


        renderUsers();
    }
);


/* CLEAR SEARCH */

clearSearch?.addEventListener(
    "click",
    clearUserSearch
);


/* REFRESH */

refreshButton?.addEventListener(
    "click",
    refreshPageData
);


/* LOGOUT */

logoutButton?.addEventListener(
    "click",
    logout
);


/* ESCAPE */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Escape"
        ) {

            closeSidebar();

            closeProfilePanel();
        }
    }
);


/* RESIZE */

window.addEventListener(
    "resize",
    () => {

        if (
            window.innerWidth >
            820
        ) {

            closeSidebar();
            closeOverlay();
        }
    }
);


/* CLEANUP */

window.addEventListener(
    "beforeunload",
    () => {

        cleanupVoice();

        stopPing();
    }
);


/* =========================================================
   INITIAL UI
   ========================================================= */

function prepareInitialUI() {

    setChatInputEnabled(
        false
    );


    hideTyping();


    if (chatContact) {

        chatContact.hidden =
            true;
    }


    if (chatHeaderEmpty) {

        chatHeaderEmpty.hidden =
            false;
    }


    if (welcomeScreen) {

        welcomeScreen.hidden =
            false;
    }


    if (chatView) {

        chatView.hidden =
            true;
    }


    if (profilePanel) {

        profilePanel.hidden =
            true;

        profilePanel.classList.remove(
            "open"
        );
    }


    updateVoiceUI();
}


/* =========================================================
   START
   ========================================================= */

async function startGapino() {

    prepareInitialUI();


    const loggedIn =
        await loadCurrentUser();


    if (!loggedIn) {
        return;
    }


    await loadUsers();


    connectWebSocket();


    clearInterval(
        usersRefreshTimer
    );


    usersRefreshTimer =
        setInterval(
            loadUsers,
            30000
        );


    console.log(
        "✅ GAPINO chat.js loaded"
    );
}


/* =========================================================
   START AFTER DOM
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        startGapino
    );

} else {

    startGapino();
}
