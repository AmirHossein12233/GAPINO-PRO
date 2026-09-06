"use strict";

/* =========================================================
   GAPINO PRO
   app.js
   ========================================================= */

const API_BASE =
    window.GAPINO_API_BASE ||
    window.location.origin;

const WS_BASE =
    window.GAPINO_WS_BASE ||
    (
        window.location.protocol === "https:"
            ? `wss://${window.location.host}`
            : `ws://${window.location.host}`
    );


/* =========================================================
   STATE
   ========================================================= */

let currentUser = null;
let selectedUser = null;

let users = [];
let messages = [];

let socket = null;
let socketReconnectTimer = null;
let socketReconnectAttempts = 0;

let usersRefreshTimer = null;
let typingTimer = null;
let lastTypingState = false;

let mediaRecorder = null;
let audioChunks = [];

let profileLoaded = false;
let toastTimer = null;


/* =========================================================
   DOM
   ========================================================= */

const appShell =
    document.getElementById("appShell");

const sidebar =
    document.getElementById("sidebar");

const userSearch =
    document.getElementById("userSearch");

const clearSearch =
    document.getElementById("clearSearch");

const userList =
    document.getElementById("userList");

const userCount =
    document.getElementById("userCount");

const currentAvatar =
    document.getElementById("currentAvatar");

const currentDisplayName =
    document.getElementById("currentDisplayName");

const currentUsername =
    document.getElementById("currentUsername");

const profileButton =
    document.getElementById("profileButton");

const profileHeaderButton =
    document.getElementById("profileHeaderButton");

const menuButton =
    document.getElementById("menuButton");

const mobileMenuButton =
    document.getElementById("mobileMenuButton");

const welcomeScreen =
    document.getElementById("welcomeScreen");

const chatView =
    document.getElementById("chatView");

const chatContact =
    document.getElementById("chatContact");

const chatHeaderEmpty =
    document.getElementById("chatHeaderEmpty");

const chatAvatar =
    document.getElementById("chatAvatar");

const chatName =
    document.getElementById("chatName");

const chatStatus =
    document.getElementById("chatStatus");

const refreshButton =
    document.getElementById("refreshButton");

const messagesElement =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendButton =
    document.getElementById("sendButton");

const attachButton =
    document.getElementById("attachButton");

const fileInput =
    document.getElementById("fileInput");

const voiceButton =
    document.getElementById("voiceButton");

const typingArea =
    document.getElementById("typingArea");

const profilePanel =
    document.getElementById("profilePanel");

const closeProfile =
    document.getElementById("closeProfile");

const profileAvatar =
    document.getElementById("profileAvatar");

const profileName =
    document.getElementById("profileName");

const profileUsername =
    document.getElementById("profileUsername");

const editDisplayName =
    document.getElementById("editDisplayName");

const editBio =
    document.getElementById("editBio");

const editStatus =
    document.getElementById("editStatus");

const saveProfile =
    document.getElementById("saveProfile");

const profilePageButton =
    document.getElementById("profilePageButton");

const appOverlay =
    document.getElementById("appOverlay");

const logoutButton =
    document.getElementById("logoutButton");

const toast =
    document.getElementById("toast");


/* =========================================================
   HELPERS
   ========================================================= */

function apiUrl(path) {
    return `${API_BASE}${path}`;
}


function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
}


function formatTime(value) {
    if (!value) {
        return "";
    }

    try {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return date.toLocaleTimeString(
            "fa-IR",
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );
    } catch {
        return "";
    }
}


function avatarLetter(user) {
    const name =
        user?.display_name ||
        user?.username ||
        "G";

    return String(name)
        .trim()
        .charAt(0)
        .toUpperCase() || "G";
}


function avatarHtml(user, extraClass = "") {
    const avatar =
        user?.avatar || "";

    if (avatar) {
        const src =
            avatar.startsWith("http")
                ? avatar
                : apiUrl(avatar);

        return `
            <div class="avatar ${extraClass}">
                <img
                    src="${escapeHtml(src)}"
                    alt=""
                    class="avatar-image"
                    loading="lazy"
                >
            </div>
        `;
    }

    return `
        <div class="avatar ${extraClass}">
            ${escapeHtml(avatarLetter(user))}
        </div>
    `;
}


function showToast(
    text,
    type = ""
) {
    if (!toast) {
        return;
    }

    toast.textContent =
        text || "";

    toast.className =
        `toast ${type}`.trim();

    if (text) {
        toast.classList.add("show");
    }

    window.clearTimeout(
        toastTimer
    );

    if (text) {
        toastTimer =
            window.setTimeout(
                () => {
                    toast.classList.remove("show");
                },
                3000
            );
    }
}


async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}


/* =========================================================
   AUTH / CURRENT USER
   ========================================================= */

async function getCurrentUser() {
    const response =
        await fetch(
            apiUrl("/api/me"),
            {
                method: "GET",
                credentials: "include",
                cache: "no-store"
            }
        );

    if (!response.ok) {
        throw new Error(
            "نشست ورود شما معتبر نیست."
        );
    }

    return await response.json();
}


async function loadCurrentUser() {
    try {
        currentUser =
            await getCurrentUser();

        localStorage.setItem(
            "gapino_user",
            JSON.stringify(currentUser)
        );

        renderCurrentUser();

    } catch (error) {

        console.error(error);

        localStorage.removeItem(
            "gapino_user"
        );

        window.location.href =
            "/login.html";
    }
}


function renderCurrentUser() {
    if (!currentUser) {
        return;
    }

    if (currentDisplayName) {
        currentDisplayName.textContent =
            currentUser.display_name ||
            currentUser.username ||
            "گپینو";
    }

    if (currentUsername) {
        currentUsername.textContent =
            currentUser.username
                ? `@${currentUser.username}`
                : "@user";
    }

    if (currentAvatar) {
        if (currentUser.avatar) {

            const src =
                currentUser.avatar.startsWith("http")
                    ? currentUser.avatar
                    : apiUrl(currentUser.avatar);

            currentAvatar.innerHTML = `
                <img
                    src="${escapeHtml(src)}"
                    alt=""
                    class="avatar-image"
                >
            `;

        } else {
            currentAvatar.textContent =
                avatarLetter(currentUser);
        }
    }
}


/* =========================================================
   USERS
   ========================================================= */

async function loadUsers() {
    try {

        const query =
            userSearch?.value.trim() || "";

        const endpoint =
            query
                ? `/api/users?q=${encodeURIComponent(query)}`
                : "/api/users";

        const response =
            await fetch(
                apiUrl(endpoint),
                {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store"
                }
            );

        const data =
            await readJson(response);

        if (!response.ok) {
            throw new Error(
                data?.detail ||
                "دریافت کاربران انجام نشد."
            );
        }

        users =
            Array.isArray(data)
                ? data
                : [];

        renderUsers();

    } catch (error) {

        console.error(error);

        if (userList) {
            userList.innerHTML = `
                <div class="empty-users">
                    <div class="empty-icon">⚠️</div>
                    <strong>
                        دریافت کاربران ناموفق بود
                    </strong>
                    <span>
                        اتصال سرور را بررسی کنید.
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

    if (userCount) {
        userCount.textContent =
            String(users.length);
    }

    if (!users.length) {

        userList.innerHTML = `
            <div class="empty-users">
                <div class="empty-icon">
                    ${userSearch?.value.trim() ? "🔎" : "💬"}
                </div>

                <strong>
                    ${
                        userSearch?.value.trim()
                            ? "کاربری پیدا نشد"
                            : "هنوز کاربری وجود ندارد"
                    }
                </strong>

                <span>
                    ${
                        userSearch?.value.trim()
                            ? "عبارت جستجو را تغییر بده."
                            : "با ثبت‌نام کاربران، آنها اینجا نمایش داده می‌شوند."
                    }
                </span>
            </div>
        `;

        return;
    }


    userList.innerHTML =
        users
            .map(
                user => {

                    const active =
                        selectedUser &&
                        Number(selectedUser.id) ===
                        Number(user.id);

                    const online =
                        Boolean(user.online);

                    return `
                        <button
                            type="button"
                            class="
                                user-item
                                ${active ? "active" : ""}
                                ${online ? "online" : ""}
                            "
                            data-user-id="${Number(user.id)}"
                        >

                            ${
                                avatarHtml(
                                    user,
                                    ""
                                )
                            }

                            <div class="user-item-info">

                                <span class="user-item-name">
                                    ${escapeHtml(
                                        user.display_name ||
                                        user.username ||
                                        "کاربر"
                                    )}
                                </span>

                                <span class="user-item-username">
                                    @${escapeHtml(
                                        user.username ||
                                        ""
                                    )}
                                </span>

                                <span class="user-item-status">
                                    ${
                                        online
                                            ? "آنلاین"
                                            : "آفلاین"
                                    }
                                </span>

                            </div>

                        </button>
                    `;
                }
            )
            .join("");


    userList
        .querySelectorAll(".user-item")
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const id =
                            Number(
                                button.dataset.userId
                            );

                        const user =
                            users.find(
                                item =>
                                    Number(item.id) === id
                            );

                        if (user) {
                            selectUser(user);
                        }

                    }
                );

            }
        );
}


/* =========================================================
   SELECT USER
   ========================================================= */

async function selectUser(user) {

    if (!user) {
        return;
    }

    selectedUser =
        user;

    renderUsers();

    renderChatHeader();

    showChat();

    closeSidebarMobile();

    await loadMessages();

    connectSocket();

    scrollMessagesToBottom();

    if (messageInput) {
        messageInput.focus();
    }
}


function renderChatHeader() {

    if (!selectedUser) {
        return;
    }

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

    if (chatName) {
        chatName.textContent =
            selectedUser.display_name ||
            selectedUser.username ||
            "کاربر";
    }

    if (chatStatus) {

        const online =
            Boolean(selectedUser.online);

        chatStatus.textContent =
            online
                ? "آنلاین"
                : (
                    selectedUser.status ||
                    "آفلاین"
                );

        chatStatus.classList.toggle(
            "online",
            online
        );
    }

    if (chatAvatar) {

        if (selectedUser.avatar) {

            const src =
                selectedUser.avatar.startsWith("http")
                    ? selectedUser.avatar
                    : apiUrl(selectedUser.avatar);

            chatAvatar.innerHTML = `
                <img
                    src="${escapeHtml(src)}"
                    alt=""
                    class="avatar-image"
                >
            `;

        } else {

            chatAvatar.textContent =
                avatarLetter(selectedUser);

        }
    }
}


function showChat() {

    if (welcomeScreen) {
        welcomeScreen.hidden =
            true;
    }

    if (chatView) {
        chatView.hidden =
            false;
    }
}


function showWelcome() {

    if (welcomeScreen) {
        welcomeScreen.hidden =
            false;
    }

    if (chatView) {
        chatView.hidden =
            true;
    }

    if (chatContact) {
        chatContact.hidden =
            true;
    }

    if (chatHeaderEmpty) {
        chatHeaderEmpty.hidden =
            false;
    }
}


/* =========================================================
   MESSAGES
   ========================================================= */

async function loadMessages() {

    if (!selectedUser || !currentUser) {
        return;
    }

    try {

        const response =
            await fetch(
                apiUrl(
                    `/api/messages/${Number(selectedUser.id)}`
                ),
                {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store"
                }
            );

        const data =
            await readJson(response);

        if (!response.ok) {
            throw new Error(
                data?.detail ||
                "دریافت پیام‌ها ناموفق بود."
            );
        }

        messages =
            Array.isArray(data)
                ? data
                : [];

        renderMessages();

        scrollMessagesToBottom();

    } catch (error) {

        console.error(error);

        showToast(
            error.message ||
            "دریافت پیام‌ها انجام نشد.",
            "error"
        );
    }
}


function isMyMessage(message) {

    return (
        Number(message?.sender_id) ===
        Number(currentUser?.id)
    );
}


function renderMessages() {

    if (!messagesElement) {
        return;
    }

    if (!messages.length) {

        messagesElement.innerHTML = `
            <div
                style="
                    margin:auto;
                    text-align:center;
                    color:var(--muted);
                    font-size:8px;
                    padding:30px;
                "
            >
                <div style="font-size:28px;margin-bottom:10px;">
                    💬
                </div>

                <div style="margin-bottom:6px;">
                    هنوز پیامی وجود ندارد
                </div>

                <div>
                    اولین پیام را بفرست!
                </div>
            </div>
        `;

        return;
    }

    messagesElement.innerHTML =
        messages
            .map(renderSingleMessage)
            .join("");

    attachMessageMenus();
}


function renderSingleMessage(message) {

    const mine =
        isMyMessage(message);

    const deleted =
        Boolean(message.deleted);

    const edited =
        Boolean(message.edited);

    const text =
        message.text || "";

    let content = "";


    if (deleted) {

        content = `
            <div class="deleted-message">
                <span>🚫</span>
                <span>
                    این پیام حذف شده است
                </span>
            </div>
        `;

    } else {

        if (text) {

            content += `
                <div class="message-text">
                    ${escapeHtml(text)}
                </div>
            `;

        }


        if (message.file_url) {

            const url =
                message.file_url.startsWith("http")
                    ? message.file_url
                    : apiUrl(message.file_url);

            const mime =
                String(message.mime_type || "")
                    .toLowerCase();

            const fileName =
                message.file_name ||
                "فایل";

            if (mime.startsWith("image/")) {

                content += `
                    <div style="margin-top:${text ? "8px" : "0"};">
                        <img
                            src="${escapeHtml(url)}"
                            class="message-image"
                            alt="${escapeHtml(fileName)}"
                            loading="lazy"
                            data-image-url="${escapeHtml(url)}"
                        >
                    </div>
                `;

            } else if (mime.startsWith("audio/")) {

                content += `
                    <div class="message-audio">
                        <audio
                            controls
                            preload="metadata"
                            src="${escapeHtml(url)}"
                        ></audio>
                    </div>
                `;

            } else {

                content += `
                    <div
                        class="message-file"
                        style="margin-top:${text ? "8px" : "0"};"
                    >

                        <div class="message-file-icon">
                            📄
                        </div>

                        <div class="message-file-info">

                            <div class="message-file-name">
                                ${escapeHtml(fileName)}
                            </div>

                            <a
                                class="message-file-link"
                                href="${escapeHtml(url)}"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                مشاهده / دانلود
                            </a>

                        </div>

                    </div>
                `;
            }
        }
    }


    const editedText =
        edited && !deleted
            ? `<span class="message-edited">ویرایش‌شده</span>`
            : "";


    const ticks =
        mine && !deleted
            ? `
                <span class="message-ticks">
                    ✓✓
                </span>
            `
            : "";


    return `
        <div
            class="
                message-row
                ${mine ? "mine" : "theirs"}
            "
            data-message-id="${Number(message.id)}"
        >

            <div
                class="
                    message
                    ${mine ? "mine" : "theirs"}
                    ${deleted ? "deleted" : ""}
                "
                data-message-id="${Number(message.id)}"
                ${!deleted ? 'data-message-menu="true"' : ""}
            >

                ${content}

                <div class="message-meta">

                    <span>
                        ${escapeHtml(
                            formatTime(message.created_at)
                        )}
                    </span>

                    ${editedText}

                    ${ticks}

                </div>

            </div>

        </div>
    `;
}


/* =========================================================
   MESSAGE MENU
   ========================================================= */

function attachMessageMenus() {

    if (!messagesElement) {
        return;
    }

    messagesElement
        .querySelectorAll(
            '[data-message-menu="true"]'
        )
        .forEach(
            element => {

                element.addEventListener(
                    "contextmenu",
                    event => {

                        event.preventDefault();

                        const id =
                            Number(
                                element.dataset.messageId
                            );

                        openMessageMenu(
                            event,
                            id
                        );
                    }
                );

            }
        );


    messagesElement
        .querySelectorAll(".message-image")
        .forEach(
            image => {

                image.addEventListener(
                    "click",
                    () => {

                        const url =
                            image.dataset.imageUrl ||
                            image.src;

                        window.open(
                            url,
                            "_blank",
                            "noopener,noreferrer"
                        );

                    }
                );

            }
        );
}


function openMessageMenu(
    event,
    messageId
) {

    closeMessageMenu();


    const message =
        messages.find(
            item =>
                Number(item.id) ===
                Number(messageId)
        );


    if (!message) {
        return;
    }


    const menu =
        document.createElement("div");

    menu.className =
        "message-menu";

    menu.id =
        "dynamicMessageMenu";


    const mine =
        isMyMessage(message);


    menu.innerHTML = `
        <button
            type="button"
            data-action="copy"
        >
            📋
            کپی
        </button>

        ${
            mine
                ? `
                    <button
                        type="button"
                        data-action="edit"
                    >
                        ✏️
                        ویرایش
                    </button>

                    <button
                        type="button"
                        class="danger"
                        data-action="delete"
                    >
                        🗑️
                        حذف
                    </button>
                `
                : ""
        }
    `;


    menu.style.position =
        "fixed";

    menu.style.left =
        `${Math.min(
            event.clientX,
            window.innerWidth - 140
        )}px`;

    menu.style.top =
        `${Math.min(
            event.clientY,
            window.innerHeight - 130
        )}px`;


    document.body.appendChild(
        menu
    );


    menu.querySelectorAll(
        "button"
    ).forEach(
        button => {

            button.addEventListener(
                "click",
                async () => {

                    const action =
                        button.dataset.action;

                    closeMessageMenu();

                    if (action === "copy") {
                        await copyMessage(message);
                    }

                    if (action === "edit") {
                        await editMessage(message);
                    }

                    if (action === "delete") {
                        await deleteMessage(message);
                    }
                }
            );

        }
    );


    window.setTimeout(
        () => {

            document.addEventListener(
                "click",
                closeMessageMenuOnce,
                {
                    once: true
                }
            );

        },
        0
    );
}


function closeMessageMenuOnce() {
    closeMessageMenu();
}


function closeMessageMenu() {

    const menu =
        document.getElementById(
            "dynamicMessageMenu"
        );

    if (menu) {
        menu.remove();
    }
}


async function copyMessage(message) {

    const text =
        message.text ||
        message.file_name ||
        "";

    if (!text) {

        showToast(
            "چیزی برای کپی وجود ندارد."
        );

        return;
    }


    try {

        await navigator.clipboard.writeText(
            text
        );

        showToast(
            "پیام کپی شد. ✅",
            "success"
        );

    } catch {

        showToast(
            "کپی پیام انجام نشد.",
            "error"
        );
    }
}


async function editMessage(message) {

    const currentText =
        message.text || "";

    const nextText =
        window.prompt(
            "متن جدید پیام:",
            currentText
        );


    if (nextText === null) {
        return;
    }


    const text =
        nextText.trim();


    if (!text) {

        showToast(
            "پیام نمی‌تواند خالی باشد.",
            "error"
        );

        return;
    }


    try {

        const response =
            await fetch(
                apiUrl(
                    `/api/messages/${Number(message.id)}/edit`
                ),
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify({
                            text
                        })
                }
            );


        const data =
            await readJson(response);


        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "ویرایش پیام انجام نشد."
            );
        }


        replaceMessage(data);

        showToast(
            "پیام ویرایش شد. ✅",
            "success"
        );

    } catch (error) {

        showToast(
            error.message ||
            "ویرایش پیام ناموفق بود.",
            "error"
        );
    }
}


async function deleteMessage(message) {

    const confirmed =
        window.confirm(
            "این پیام حذف شود؟"
        );


    if (!confirmed) {
        return;
    }


    try {

        const response =
            await fetch(
                apiUrl(
                    `/api/messages/${Number(message.id)}`
                ),
                {
                    method:
                        "DELETE",
                    credentials:
                        "include"
                }
            );


        const data =
            await readJson(response);


        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "حذف پیام انجام نشد."
            );
        }


        replaceMessage(data);

        showToast(
            "پیام حذف شد.",
            "success"
        );

    } catch (error) {

        showToast(
            error.message ||
            "حذف پیام ناموفق بود.",
            "error"
        );
    }
}


function replaceMessage(updatedMessage) {

    const index =
        messages.findIndex(
            item =>
                Number(item.id) ===
                Number(updatedMessage.id)
        );


    if (index >= 0) {
        messages[index] =
            updatedMessage;
    } else {
        messages.push(
            updatedMessage
        );
    }


    messages.sort(
        (a, b) =>
            Number(a.id) -
            Number(b.id)
    );


    renderMessages();

    scrollMessagesToBottom();
}


/* =========================================================
   SEND TEXT MESSAGE
   ========================================================= */

async function sendMessage() {

    if (!currentUser) {
        return;
    }

    if (!selectedUser) {

        showToast(
            "ابتدا یک کاربر را انتخاب کن."
        );

        return;
    }


    const text =
        messageInput?.value.trim() || "";


    if (!text) {
        return;
    }


    setTyping(false);


    try {

        sendButton.disabled =
            true;


        const response =
            await fetch(
                apiUrl("/api/messages"),
                {
                    method:
                        "POST",

                    credentials:
                        "include",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            receiver_id:
                                Number(selectedUser.id),

                            text
                        })
                }
            );


        const data =
            await readJson(response);


        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "ارسال پیام انجام نشد."
            );
        }


        if (messageInput) {
            messageInput.value =
                "";
        }


        resizeMessageInput();


        addOrReplaceMessage(
            data
        );


        scrollMessagesToBottom();


    } catch (error) {

        console.error(error);

        showToast(
            error.message ||
            "ارسال پیام ناموفق بود.",
            "error"
        );

    } finally {

        sendButton.disabled =
            false;

        if (messageInput) {
            messageInput.focus();
        }
    }
}


function addOrReplaceMessage(message) {

    const existing =
        messages.findIndex(
            item =>
                Number(item.id) ===
                Number(message.id)
        );


    if (existing >= 0) {
        messages[existing] =
            message;
    } else {
        messages.push(
            message
        );
    }


    messages.sort(
        (a, b) =>
            Number(a.id) -
            Number(b.id)
    );


    renderMessages();
}


/* =========================================================
   FILE UPLOAD
   ========================================================= */

async function uploadFile(file) {

    if (!selectedUser) {

        showToast(
            "ابتدا یک کاربر را انتخاب کن."
        );

        return;
    }


    if (!file) {
        return;
    }


    if (file.size > 10 * 1024 * 1024) {

        showToast(
            "حداکثر اندازه فایل ۱۰ مگابایت است.",
            "error"
        );

        return;
    }


    try {

        showToast(
            "در حال ارسال فایل..."
        );


        const formData =
            new FormData();


        formData.append(
            "receiver_id",
            String(selectedUser.id)
        );


        formData.append(
            "file",
            file,
            file.name
        );


        const response =
            await fetch(
                apiUrl("/api/upload"),
                {
                    method:
                        "POST",

                    credentials:
                        "include",

                    body:
                        formData
                }
            );


        const data =
            await readJson(response);


        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "ارسال فایل انجام نشد."
            );
        }


        addOrReplaceMessage(
            data
        );


        scrollMessagesToBottom();


        showToast(
            "فایل ارسال شد. ✅",
            "success"
        );

    } catch (error) {

        console.error(error);

        showToast(
            error.message ||
            "ارسال فایل ناموفق بود.",
            "error"
        );
    }
}


/* =========================================================
   VOICE
   ========================================================= */

async function toggleVoiceRecording() {

    if (mediaRecorder) {

        stopVoiceRecording();

        return;
    }


    if (!navigator.mediaDevices?.getUserMedia) {

        showToast(
            "مرورگر شما ضبط صدا را پشتیبانی نمی‌کند.",
            "error"
        );

        return;
    }


    try {

        const stream =
            await navigator.mediaDevices.getUserMedia({
                audio: true
            });


        audioChunks =
            [];


        mediaRecorder =
            new MediaRecorder(
                stream
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

                const blob =
                    new Blob(
                        audioChunks,
                        {
                            type:
                                mediaRecorder.mimeType ||
                                "audio/webm"
                        }
                    );


                stream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );


                mediaRecorder =
                    null;


                audioChunks =
                    [];


                if (blob.size > 0) {

                    const extension =
                        "webm";

                    const file =
                        new File(
                            [blob],
                            `voice-${Date.now()}.${extension}`,
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


                updateVoiceButton();
            };


        mediaRecorder.start();

        updateVoiceButton();


        showToast(
            "ضبط صدا شروع شد 🎙️"
        );

    } catch (error) {

        console.error(error);

        showToast(
            "اجازه دسترسی به میکروفون داده نشد.",
            "error"
        );
    }
}


function stopVoiceRecording() {

    if (!mediaRecorder) {
        return;
    }


    try {
        mediaRecorder.stop();

        showToast(
            "در حال آماده‌سازی پیام صوتی..."
        );

    } catch {
        mediaRecorder =
            null;

        updateVoiceButton();
    }
}


function updateVoiceButton() {

    if (!voiceButton) {
        return;
    }


    if (mediaRecorder) {

        voiceButton.textContent =
            "⏹️";

        voiceButton.title =
            "توقف ضبط";

        voiceButton.style.background =
            "rgba(239,68,68,.10)";

    } else {

        voiceButton.textContent =
            "🎙️";

        voiceButton.title =
            "ضبط پیام صوتی";

        voiceButton.style.background =
            "";
    }
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

function connectSocket() {

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }


    disconnectSocket(
        false
    );


    try {

        socket =
            new WebSocket(
                `${WS_BASE}/ws`
            );


        socket.addEventListener(
            "open",
            () => {

                socketReconnectAttempts =
                    0;

                console.log(
                    "GAPINO WebSocket connected"
                );

                showToast(
                    "اتصال زنده برقرار شد. ✅",
                    "success"
                );


                /*
                 * The current backend authenticates the
                 * WebSocket from the session/ticket cookie.
                 * No client-side user ID is sent.
                 */

                try {

                    socket.send(
                        JSON.stringify({
                            type: "ping"
                        })
                    );

                } catch {}

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

                socket =
                    null;

                scheduleSocketReconnect();

            }
        );


        socket.addEventListener(
            "error",
            error => {

                console.error(
                    "WebSocket error:",
                    error
                );
            }
        );


    } catch (error) {

        console.error(error);

        scheduleSocketReconnect();
    }
}


function scheduleSocketReconnect() {

    if (socketReconnectTimer) {
        return;
    }


    socketReconnectAttempts =
        Math.min(
            socketReconnectAttempts + 1,
            8
        );


    const delay =
        Math.min(
            1000 *
            Math.pow(
                2,
                socketReconnectAttempts - 1
            ),
            15000
        );


    socketReconnectTimer =
        window.setTimeout(
            () => {

                socketReconnectTimer =
                    null;

                connectSocket();

            },
            delay
        );
}


function disconnectSocket(
    clearReconnect = true
) {

    if (clearReconnect) {

        window.clearTimeout(
            socketReconnectTimer
        );

        socketReconnectTimer =
            null;
    }


    if (socket) {

        try {
            socket.close();
        } catch {}

        socket =
            null;
    }
}


function handleSocketMessage(rawData) {

    let data;

    try {

        data =
            JSON.parse(
                rawData
            );

    } catch {

        return;
    }


    if (!data) {
        return;
    }


    switch (data.type) {

        case "ready":

            handleSocketReady(
                data
            );

            break;


        case "pong":

            break;


        case "message":

            if (data.message) {

                const message =
                    data.message;


                const relevant =
                    isRelevantMessage(
                        message
                    );


                addOrReplaceMessage(
                    message
                );


                if (relevant) {

                    if (
                        Number(message.sender_id) !==
                        Number(currentUser?.id)
                    ) {

                        if (
                            Number(message.sender_id) !==
                            Number(selectedUser?.id)
                        ) {

                            showToast(
                                "پیام جدید دریافت شد 💬"
                            );

                        } else {

                            scrollMessagesToBottom();
                        }
                    }
                }


                refreshUsersSilently();
            }

            break;


        case "message:update":

            if (data.message) {

                replaceMessage(
                    data.message
                );

            }

            break;


        case "typing":

            if (
                selectedUser &&
                Number(data.from) ===
                Number(selectedUser.id)
            ) {

                showTyping(
                    Boolean(data.value)
                );

            }

            break;


        case "user_online":

            updateUserOnlineState(
                data.user_id,
                true
            );

            break;


        case "user_offline":

            updateUserOnlineState(
                data.user_id,
                false
            );

            break;


        default:

            console.log(
                "Unknown WebSocket event:",
                data
            );

            break;
    }
}


function handleSocketReady(data) {

    if (
        data &&
        Array.isArray(data.online)
    ) {

        const onlineSet =
            new Set(
                data.online.map(
                    Number
                )
            );


        users =
            users.map(
                user => ({
                    ...user,
                    online:
                        onlineSet.has(
                            Number(user.id)
                        )
                })
            );


        if (selectedUser) {

            const refreshedSelected =
                users.find(
                    user =>
                        Number(user.id) ===
                        Number(selectedUser.id)
                );


            if (refreshedSelected) {

                selectedUser =
                    {
                        ...selectedUser,
                        ...refreshedSelected
                    };

                renderChatHeader();
            }
        }


        renderUsers();
    }
}


function isRelevantMessage(message) {

    if (!selectedUser || !currentUser) {
        return false;
    }


    const sender =
        Number(message.sender_id);

    const receiver =
        Number(message.receiver_id);


    const a =
        Number(currentUser.id);

    const b =
        Number(selectedUser.id);


    return (
        (
            sender === a &&
            receiver === b
        ) ||
        (
            sender === b &&
            receiver === a
        )
    );
}


function updateUserOnlineState(
    userId,
    online
) {

    const id =
        Number(userId);


    users =
        users.map(
            user => {

                if (
                    Number(user.id) ===
                    id
                ) {

                    return {
                        ...user,
                        online
                    };
                }

                return user;
            }
        );


    if (
        selectedUser &&
        Number(selectedUser.id) ===
        id
    ) {

        selectedUser =
            {
                ...selectedUser,
                online
            };

        renderChatHeader();
    }


    renderUsers();
}


function sendSocketTyping(
    value
) {

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !selectedUser
    ) {
        return;
    }


    try {

        socket.send(
            JSON.stringify({
                type: "typing",
                to: Number(selectedUser.id),
                value: Boolean(value)
            })
        );

    } catch {}
}


function setTyping(value) {

    const state =
        Boolean(value);


    if (
        lastTypingState ===
        state
    ) {
        return;
    }


    lastTypingState =
        state;


    sendSocketTyping(
        state
    );


    window.clearTimeout(
        typingTimer
    );


    if (state) {

        typingTimer =
            window.setTimeout(
                () => {

                    lastTypingState =
                        false;

                    sendSocketTyping(
                        false
                    );

                },
                1800
            );
    }
}


function showTyping(value) {

    if (!typingArea) {
        return;
    }


    typingArea.hidden =
        !value;
}


function refreshUsersSilently() {

    loadUsers()
        .catch(
            error =>
                console.error(
                    error
                )
        );
}


/* =========================================================
   PROFILE
   ========================================================= */

function openProfile() {

    if (!profilePanel) {
        return;
    }


    profilePanel.hidden =
        false;


    profilePanel.classList.add(
        "open"
    );


    if (appOverlay) {
        appOverlay.hidden =
            false;
    }


    loadProfileIntoPanel();
}


function closeProfilePanel() {

    if (!profilePanel) {
        return;
    }


    profilePanel.classList.remove(
        "open"
    );


    window.setTimeout(
        () => {

            if (
                !profilePanel.classList.contains(
                    "open"
                )
            ) {
                profilePanel.hidden =
                    true;
            }

        },
        250
    );


    if (appOverlay) {
        appOverlay.hidden =
            true;
    }
}


async function loadProfileIntoPanel() {

    if (!currentUser) {
        return;
    }


    try {

        const fresh =
            await getCurrentUser();


        currentUser =
            fresh;


        localStorage.setItem(
            "gapino_user",
            JSON.stringify(
                currentUser
            )
        );


        renderCurrentUser();


        if (profileName) {
            profileName.textContent =
                currentUser.display_name ||
                currentUser.username ||
                "گپینو";
        }


        if (profileUsername) {
            profileUsername.textContent =
                currentUser.username
                    ? `@${currentUser.username}`
                    : "@user";
        }


        if (profileAvatar) {

            if (currentUser.avatar) {

                const src =
                    currentUser.avatar.startsWith("http")
                        ? currentUser.avatar
                        : apiUrl(currentUser.avatar);


                profileAvatar.innerHTML = `
                    <img
                        src="${escapeHtml(src)}"
                        alt=""
                    >
                `;

            } else {

                profileAvatar.textContent =
                    avatarLetter(
                        currentUser
                    );
            }
        }


        if (editDisplayName) {
            editDisplayName.value =
                currentUser.display_name || "";
        }


        if (editBio) {
            editBio.value =
                currentUser.bio || "";
        }


        if (editStatus) {

            const allowed =
                Array.from(
                    editStatus.options
                )
                .map(
                    option =>
                        option.value
                );


            editStatus.value =
                allowed.includes(
                    currentUser.status
                )
                    ? currentUser.status
                    : allowed[0] || "";
        }


        profileLoaded =
            true;


    } catch (error) {

        console.error(error);

        showToast(
            "دریافت اطلاعات پروفایل ناموفق بود.",
            "error"
        );
    }
}


async function saveCurrentProfile() {

    if (!currentUser) {
        return;
    }


    const display =
        editDisplayName?.value.trim() || "";


    const bio =
        editBio?.value.trim() || "";


    const status =
        editStatus?.value.trim() ||
        currentUser.status ||
        "در دسترس";


    if (!display) {

        showToast(
            "نام نمایشی نمی‌تواند خالی باشد.",
            "error"
        );

        return;
    }


    try {

        if (saveProfile) {
            saveProfile.disabled =
                true;
        }


        const response =
            await fetch(
                apiUrl("/api/profile"),
                {
                    method:
                        "PUT",

                    credentials:
                        "include",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            display_name:
                                display,

                            bio,

                            status
                        })
                }
            );


        const data =
            await readJson(response);


        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "ذخیره پروفایل انجام نشد."
            );
        }


        await loadCurrentUser();


        showToast(
            "پروفایل ذخیره شد. ✅",
            "success"
        );


    } catch (error) {

        console.error(error);

        showToast(
            error.message ||
            "ذخیره پروفایل ناموفق بود.",
            "error"
        );

    } finally {

        if (saveProfile) {
            saveProfile.disabled =
                false;
        }
    }
}


/* =========================================================
   SIDEBAR / MOBILE
   ========================================================= */

function openSidebarMobile() {

    if (!appShell) {
        return;
    }


    appShell.classList.add(
        "sidebar-open"
    );


    if (appOverlay) {
        appOverlay.hidden =
            false;
    }
}


function closeSidebarMobile() {

    if (!appShell) {
        return;
    }


    appShell.classList.remove(
        "sidebar-open"
    );


    if (
        profilePanel &&
        !profilePanel.classList.contains("open") &&
        appOverlay
    ) {
        appOverlay.hidden =
            true;
    }
}


function toggleSidebar() {

    if (!appShell) {
        return;
    }


    const open =
        appShell.classList.contains(
            "sidebar-open"
        );


    if (open) {
        closeSidebarMobile();
    } else {
        openSidebarMobile();
    }
}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

    const confirmed =
        window.confirm(
            "می‌خواهی از حساب گپینو خارج شوی؟"
        );


    if (!confirmed) {
        return;
    }


    try {

        await fetch(
            apiUrl("/api/logout"),
            {
                method:
                    "POST",

                credentials:
                    "include"
            }
        );

    } catch (error) {

        console.error(error);

    } finally {

        disconnectSocket();

        localStorage.removeItem(
            "gapino_user"
        );

        window.location.href =
            "/login.html";
    }
}


/* =========================================================
   MESSAGE INPUT
   ========================================================= */

function resizeMessageInput() {

    if (!messageInput) {
        return;
    }


    messageInput.style.height =
        "auto";


    const height =
        Math.min(
            messageInput.scrollHeight,
            126
        );


    messageInput.style.height =
        `${Math.max(height, 24)}px`;
}


/* =========================================================
   SCROLL
   ========================================================= */

function scrollMessagesToBottom() {

    if (!messagesElement) {
        return;
    }


    window.requestAnimationFrame(
        () => {

            messagesElement.scrollTop =
                messagesElement.scrollHeight;
        }
    );
}


/* =========================================================
   THEME
   ========================================================= */

function initializeTheme() {

    const saved =
        localStorage.getItem(
            "gapino_theme"
        );


    const theme =
        saved === "light"
            ? "light"
            : "dark";


    document.documentElement.setAttribute(
        "data-theme",
        theme
    );


    updateThemeButton(
        theme
    );
}


function updateThemeButton(theme) {

    const button =
        document.getElementById(
            "themeButton"
        );


    if (!button) {
        return;
    }


    if (theme === "light") {

        button.innerHTML =
            "🌙 <span>حالت تیره</span>";

        button.title =
            "فعال کردن حالت تیره";

    } else {

        button.innerHTML =
            "☀️ <span>حالت روشن</span>";

        button.title =
            "فعال کردن حالت روشن";
    }
}


function toggleTheme() {

    const current =
        document.documentElement.getAttribute(
            "data-theme"
        ) || "dark";


    const next =
        current === "dark"
            ? "light"
            : "dark";


    document.documentElement.setAttribute(
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
   EVENT LISTENERS
   ========================================================= */

if (userSearch) {

    userSearch.addEventListener(
        "input",
        () => {

            const hasText =
                userSearch.value.trim().length > 0;


            if (clearSearch) {
                clearSearch.hidden =
                    !hasText;
            }


            window.clearTimeout(
                userSearch._timer
            );


            userSearch._timer =
                window.setTimeout(
                    () => {

                        loadUsers();

                    },
                    250
                );
        }
    );
}


if (clearSearch) {

    clearSearch.addEventListener(
        "click",
        () => {

            if (userSearch) {
                userSearch.value =
                    "";
                userSearch.focus();
            }

            clearSearch.hidden =
                true;

            loadUsers();
        }
    );
}


if (sendButton) {

    sendButton.addEventListener(
        "click",
        () => {

            sendMessage();

        }
    );
}


if (messageInput) {

    messageInput.addEventListener(
        "input",
        () => {

            resizeMessageInput();

            setTyping(
                messageInput.value.trim().length > 0
            );

        }
    );


    messageInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();

            }
        }
    );
}


if (attachButton) {

    attachButton.addEventListener(
        "click",
        () => {

            if (fileInput) {
                fileInput.click();
            }

        }
    );
}


if (fileInput) {

    fileInput.addEventListener(
        "change",
        async () => {

            const file =
                fileInput.files?.[0];


            if (file) {
                await uploadFile(file);
            }


            fileInput.value =
                "";
        }
    );
}


if (voiceButton) {

    voiceButton.addEventListener(
        "click",
        () => {

            toggleVoiceRecording();

        }
    );
}


if (profileButton) {

    profileButton.addEventListener(
        "click",
        () => {

            openProfile();

        }
    );
}


if (profileHeaderButton) {

    profileHeaderButton.addEventListener(
        "click",
        () => {

            openProfile();

        }
    );
}


if (closeProfile) {

    closeProfile.addEventListener(
        "click",
        () => {

            closeProfilePanel();

        }
    );
}


if (saveProfile) {

    saveProfile.addEventListener(
        "click",
        () => {

            saveCurrentProfile();

        }
    );
}


if (profilePageButton) {

    profilePageButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "/profile.html";
        }
    );
}


if (menuButton) {

    menuButton.addEventListener(
        "click",
        () => {

            toggleSidebar();

        }
    );
}


if (mobileMenuButton) {

    mobileMenuButton.addEventListener(
        "click",
        () => {

            toggleSidebar();

        }
    );
}


if (appOverlay) {

    appOverlay.addEventListener(
        "click",
        () => {

            closeSidebarMobile();

            closeProfilePanel();

        }
    );
}


if (refreshButton) {

    refreshButton.addEventListener(
        "click",
        async () => {

            refreshButton.disabled =
                true;

            try {

                await loadUsers();

                if (selectedUser) {
                    await loadMessages();
                }

                showToast(
                    "اطلاعات به‌روزرسانی شد. ✅",
                    "success"
                );

            } finally {

                refreshButton.disabled =
                    false;
            }
        }
    );
}


if (logoutButton) {

    logoutButton.addEventListener(
        "click",
        () => {

            logout();

        }
    );
}


const themeButton =
    document.getElementById(
        "themeButton"
    );


if (themeButton) {

    themeButton.addEventListener(
        "click",
        () => {

            toggleTheme();

        }
    );
}


/* =========================================================
   PAGE VISIBILITY
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.visibilityState ===
            "visible"
        ) {

            refreshUsersSilently();

            if (
                selectedUser
            ) {
                loadMessages()
                    .catch(
                        error =>
                            console.error(
                                error
                            )
                    );
            }

            if (
                !socket ||
                socket.readyState !==
                WebSocket.OPEN
            ) {
                connectSocket();
            }
        }
    }
);


/* =========================================================
   WINDOW RESIZE
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        if (
            window.innerWidth > 820
        ) {

            closeSidebarMobile();

        }
    }
);


/* =========================================================
   STARTUP
   ========================================================= */

async function startApp() {

    initializeTheme();

    resizeMessageInput();


    try {

        currentUser =
            await getCurrentUser();


    } catch (error) {

        console.error(error);

        window.location.href =
            "/login.html";

        return;
    }


    localStorage.setItem(
        "gapino_user",
        JSON.stringify(currentUser)
    );


    renderCurrentUser();


    await loadUsers();


    /*
     * Connect after the authenticated session exists.
     */
    connectSocket();


    /*
     * Refresh users periodically so online/offline
     * states and newly registered users appear.
     */
    usersRefreshTimer =
        window.setInterval(
            () => {

                loadUsers()
                    .catch(
                        error =>
                            console.error(
                                error
                            )
                    );

            },
            15000
        );


    showWelcome();
}


/* =========================================================
   CLEANUP
   ========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        window.clearInterval(
            usersRefreshTimer
        );

        window.clearTimeout(
            socketReconnectTimer
        );

        window.clearTimeout(
            typingTimer
        );

        disconnectSocket();

    }
);


/* =========================================================
   RUN
   ========================================================= */

startApp();