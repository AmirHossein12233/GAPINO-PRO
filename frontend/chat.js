"use strict";

/* =========================================================
   GAPINO CHAT.JS
   Web + Capacitor APK
   API: https://mygapino.shop
   WS : wss://mygapino.shop/ws
   ========================================================= */

const API_BASE = "https://mygapino.shop";

let gapinoSocket = null;
let gapinoReconnectTimer = null;
let gapinoReconnectAttempt = 0;
let gapinoUsers = [];
let gapinoMe = null;


/* =========================================================
   API
   ========================================================= */

function apiUrl(path) {

    if (!path.startsWith("/")) {
        path = "/" + path;
    }

    return API_BASE + path;
}


function getAuthToken() {

    try {

        return (
            localStorage.getItem(
                "gapino_token"
            ) ||
            localStorage.getItem(
                "token"
            ) ||
            sessionStorage.getItem(
                "gapino_token"
            ) ||
            sessionStorage.getItem(
                "token"
            ) ||
            ""
        );

    } catch (_) {

        return "";
    }
}


function saveAuthToken(token) {

    if (!token) {
        return;
    }

    try {

        localStorage.setItem(
            "gapino_token",
            token
        );

    } catch (_) {}
}


function authHeaders(extra = {}) {

    const token =
        getAuthToken();

    return {
        ...extra,

        ...(token
            ? {
                Authorization:
                    `Bearer ${token}`
            }
            : {})
    };
}


async function apiFetch(
    path,
    options = {}
) {

    const headers =
        authHeaders(
            options.headers || {}
        );

    const response =
        await fetch(
            apiUrl(path),
            {
                ...options,

                headers,

                credentials:
                    "include",

                cache:
                    "no-store"
            }
        );

    let data = null;

    const contentType =
        response.headers.get(
            "content-type"
        ) || "";

    try {

        if (
            contentType.includes(
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
            data?.detail ||
            data?.message ||
            `HTTP ${response.status}`
        );
    }

    return data;
}


/* =========================================================
   URL
   ========================================================= */

function absoluteUrl(url) {

    if (!url) {
        return "";
    }

    if (
        url.startsWith(
            "http://"
        ) ||
        url.startsWith(
            "https://"
        )
    ) {
        return url;
    }

    if (!url.startsWith("/")) {
        url = "/" + url;
    }

    return API_BASE + url;
}


/* =========================================================
   USER
   ========================================================= */

function getUserId(user) {

    return String(
        user?.id ??
        user?.user_id ??
        user?.uid ??
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


function getInitial(text) {

    const value =
        String(
            text || "؟"
        ).trim();

    return value
        ? value.charAt(0)
        : "؟";
}


/* =========================================================
   CONTAINER
   ========================================================= */

function getUsersContainer() {

    return (
        document.getElementById(
            "usersList"
        ) ||

        document.getElementById(
            "users-list"
        ) ||

        document.getElementById(
            "userList"
        ) ||

        document.getElementById(
            "user-list"
        ) ||

        document.querySelector(
            ".users-list"
        ) ||

        document.querySelector(
            ".user-list"
        )
    );
}


/* =========================================================
   LOAD USERS
   ========================================================= */

async function loadUsers(
    search = ""
) {

    try {

        const query =
            String(search || "").trim();

        const url =
            query
                ? `/api/users?q=${encodeURIComponent(query)}`
                : "/api/users";

        const response =
            await fetch(
                apiUrl(url),
                {
                    method: "GET",

                    credentials:
                        "include",

                    cache:
                        "no-store",

                    headers:
                        authHeaders()
                }
            );

        const contentType =
            response.headers.get(
                "content-type"
            ) || "";

        let data;

        if (
            contentType.includes(
                "application/json"
            )
        ) {

            data =
                await response.json();

        } else {

            const text =
                await response.text();

            throw new Error(
                text ||
                `HTTP ${response.status}`
            );
        }

        if (!response.ok) {

            throw new Error(
                data?.detail ||
                `HTTP ${response.status}`
            );
        }

        if (
            !Array.isArray(data)
        ) {

            throw new Error(
                "پاسخ کاربران نامعتبر است"
            );
        }

        gapinoUsers =
            data;

        window.GAPINO_USERS =
            data;

        if (window.GAPINO) {
            window.GAPINO.users =
                data;
        }

        renderUsers(data);

        return data;

    } catch (error) {

        console.error(
            "GAPINO loadUsers:",
            error
        );

        showUsersError(
            "دریافت کاربران انجام نشد"
        );

        return [];
    }
}


/* =========================================================
   RENDER USERS
   ========================================================= */

function renderUsers(users) {

    const container =
        getUsersContainer();

    if (!container) {

        console.warn(
            "GAPINO users container not found"
        );

        return;
    }

    container.innerHTML = "";

    if (
        !Array.isArray(users) ||
        users.length === 0
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "empty-users";

        empty.textContent =
            "هنوز کاربر دیگری ثبت‌نام نکرده است";

        container.appendChild(
            empty
        );

        return;
    }

    for (
        const user of users
    ) {

        const item =
            document.createElement(
                "button"
            );

        item.type = "button";

        item.className =
            "user-item";

        item.dataset.userId =
            String(user.id);


        const avatar =
            document.createElement(
                "div"
            );

        avatar.className =
            "user-avatar";


        if (user.avatar) {

            const image =
                document.createElement(
                    "img"
                );

            image.src =
                absoluteUrl(
                    user.avatar
                );

            image.alt =
                getUserName(user);

            image.loading =
                "lazy";

            image.onerror = () => {

                avatar.innerHTML =
                    "";

                avatar.textContent =
                    getInitial(
                        getUserName(user)
                    );
            };

            avatar.appendChild(
                image
            );

        } else {

            avatar.textContent =
                getInitial(
                    getUserName(user)
                );
        }


        const body =
            document.createElement(
                "div"
            );

        body.className =
            "user-item-body";


        const name =
            document.createElement(
                "div"
            );

        name.className =
            "user-item-name";

        name.textContent =
            getUserName(user);


        const username =
            document.createElement(
                "div"
            );

        username.className =
            "user-item-username";

        username.textContent =
            "@" +
            String(
                user.username ||
                ""
            );


        const status =
            document.createElement(
                "div"
            );

        status.className =
            "user-item-status";

        status.textContent =
            user.status ||
            "در دسترس";


        body.appendChild(
            name
        );

        body.appendChild(
            username
        );

        body.appendChild(
            status
        );


        const online =
            document.createElement(
                "span"
            );

        online.className =
            "user-online-dot";

        if (!user.online) {

            online.classList.add(
                "offline"
            );
        }


        item.appendChild(
            avatar
        );

        item.appendChild(
            body
        );

        item.appendChild(
            online
        );


        item.addEventListener(
            "click",
            () => {
                openUserChat(user);
            }
        );


        container.appendChild(
            item
        );
    }
}


/* =========================================================
   USER CHAT
   ========================================================= */

function openUserChat(user) {

    window.gapinoSelectedUser =
        user;

    window.GAPINO_CURRENT_CHAT_USER =
        user;

    if (window.GAPINO) {

        window.GAPINO.currentChatUser =
            user;
    }


    if (
        typeof window.openChat ===
        "function"
    ) {

        window.openChat(user);

        return;
    }


    if (
        typeof window.selectUser ===
        "function"
    ) {

        window.selectUser(user);

        return;
    }


    if (
        typeof window.startChat ===
        "function"
    ) {

        window.startChat(user);

        return;
    }

    console.log(
        "GAPINO selected user:",
        user
    );
}


/* =========================================================
   ERROR
   ========================================================= */

function showUsersError(
    message
) {

    const container =
        getUsersContainer();

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const error =
        document.createElement(
            "div"
        );

    error.className =
        "users-error";

    error.textContent =
        message;

    container.appendChild(
        error
    );
}


/* =========================================================
   ME
   ========================================================= */

async function loadMe() {

    try {

        const data =
            await apiFetch(
                "/api/me"
            );


        if (data?.token) {

            saveAuthToken(
                data.token
            );
        }


        gapinoMe =
            data?.user ||
            data;


        window.gapinoMe =
            gapinoMe;

        window.GAPINO_CURRENT_USER =
            gapinoMe;


        if (window.GAPINO) {

            window.GAPINO.currentUser =
                gapinoMe;
        }


        if (
            gapinoMe &&
            typeof gapinoMe ===
                "object"
        ) {

            try {

                localStorage.setItem(
                    "gapino_user",
                    JSON.stringify(
                        gapinoMe
                    )
                );

            } catch (_) {}
        }


        return gapinoMe;

    } catch (error) {

        console.error(
            "GAPINO loadMe:",
            error
        );

        return null;
    }
}


/* =========================================================
   MESSAGES
   ========================================================= */

async function loadMessages(
    otherId
) {

    try {

        const messages =
            await apiFetch(
                `/api/messages/${Number(
                    otherId
                )}`
            );


        if (
            typeof window.renderMessages ===
            "function"
        ) {

            window.renderMessages(
                messages
            );
        }


        return messages;

    } catch (error) {

        console.error(
            "GAPINO loadMessages:",
            error
        );

        return [];
    }
}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage(
    receiverId,
    text
) {

    const message =
        String(
            text || ""
        ).trim();

    if (!message) {
        return null;
    }

    try {

        return await apiFetch(
            "/api/messages",
            {
                method: "POST",

                headers:
                    authHeaders({
                        "Content-Type":
                            "application/json"
                    }),

                body:
                    JSON.stringify({
                        receiver_id:
                            Number(
                                receiverId
                            ),
                        text:
                            message
                    })
            }
        );

    } catch (error) {

        console.error(
            "GAPINO sendMessage:",
            error
        );

        return null;
    }
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

function getWebSocketUrl() {

    /*
     * عمداً از window.location.protocol استفاده نمی‌کنیم.
     * چون داخل APK پروتکل localhost می‌تواند متفاوت باشد.
     */

    return "wss://mygapino.shop/ws";
}


function exposeSocket() {

    window.GAPINO_SOCKET =
        gapinoSocket;

    window.GAPINO_WS =
        gapinoSocket;

    if (!window.GAPINO) {

        window.GAPINO = {};
    }

    window.GAPINO.socket =
        gapinoSocket;
}


function connectGapinoWebSocket() {

    if (
        gapinoSocket &&
        (
            gapinoSocket.readyState ===
                WebSocket.OPEN ||

            gapinoSocket.readyState ===
                WebSocket.CONNECTING
        )
    ) {

        return;
    }


    const url =
        getWebSocketUrl();


    console.log(
        "GAPINO WS:",
        url
    );


    try {

        gapinoSocket =
            new WebSocket(
                url
            );

        exposeSocket();

    } catch (error) {

        console.error(
            "GAPINO WebSocket create:",
            error
        );

        scheduleReconnect();

        return;
    }


    gapinoSocket.addEventListener(
        "open",
        () => {

            console.log(
                "✅ GAPINO WebSocket connected"
            );

            gapinoReconnectAttempt =
                0;

            exposeSocket();

            sendSocketPing();
        }
    );


    gapinoSocket.addEventListener(
        "message",
        event => {

            handleSocketMessage(
                event.data
            );
        }
    );


    gapinoSocket.addEventListener(
        "close",
        event => {

            console.warn(
                "GAPINO WS closed:",
                event.code,
                event.reason
            );

            gapinoSocket =
                null;

            exposeSocket();

            scheduleReconnect();
        }
    );


    gapinoSocket.addEventListener(
        "error",
        error => {

            console.error(
                "GAPINO WS error:",
                error
            );
        }
    );
}


/* =========================================================
   RECONNECT
   ========================================================= */

function scheduleReconnect() {

    if (
        gapinoReconnectTimer
    ) {
        return;
    }


    const delay =
        Math.min(
            30000,
            1000 *
                Math.pow(
                    2,
                    gapinoReconnectAttempt
                )
        );


    gapinoReconnectAttempt++;


    gapinoReconnectTimer =
        setTimeout(
            () => {

                gapinoReconnectTimer =
                    null;

                connectGapinoWebSocket();

            },
            delay
        );
}


/* =========================================================
   PING
   ========================================================= */

function sendSocketPing() {

    if (
        !gapinoSocket ||
        gapinoSocket.readyState !==
            WebSocket.OPEN
    ) {
        return;
    }


    try {

        gapinoSocket.send(
            JSON.stringify({
                type:
                    "ping"
            })
        );

    } catch (error) {

        console.warn(
            "GAPINO ping:",
            error
        );
    }
}


/* =========================================================
   SOCKET SEND
   ========================================================= */

function sendSocketMessage(
    data
) {

    if (
        !gapinoSocket ||
        gapinoSocket.readyState !==
            WebSocket.OPEN
    ) {

        return false;
    }


    try {

        gapinoSocket.send(
            JSON.stringify(
                data
            )
        );

        return true;

    } catch (error) {

        console.error(
            "GAPINO socket send:",
            error
        );

        return false;
    }
}


/* =========================================================
   SOCKET EVENTS
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
            "GAPINO invalid WS JSON:",
            error
        );

        return;
    }


    if (!data) {
        return;
    }


    switch (
        String(
            data.type || ""
        ).toLowerCase()
    ) {

        case "ready":

            handleOnlineUsers(
                data.online
            );

            break;


        case "pong":

            break;


        case "user_online":

            updateUserOnline(
                data.user_id,
                true
            );

            break;


        case "user_offline":

            updateUserOnline(
                data.user_id,
                false
            );

            break;


        case "message":

            handleIncomingMessage(
                data.message
            );

            break;


        case "message:update":

            handleUpdatedMessage(
                data.message
            );

            break;


        case "typing":

            handleTypingEvent(
                data
            );

            break;


        case "call_offer":
        case "call_answer":
        case "call_ice":
        case "call_reject":
        case "call_busy":
        case "call_end":

            handleCallEvent(
                data
            );

            break;


        default:

            console.log(
                "GAPINO unknown socket event:",
                data
            );
    }
}


/* =========================================================
   ONLINE USERS
   ========================================================= */

function handleOnlineUsers(
    onlineIds
) {

    if (
        !Array.isArray(
            onlineIds
        )
    ) {

        return;
    }


    for (
        const id of onlineIds
    ) {

        updateUserOnline(
            id,
            true
        );
    }
}


function updateUserOnline(
    userId,
    isOnline
) {

    const value =
        String(
            userId
        );


    const elements =
        document.querySelectorAll(
            "[data-user-id]"
        );


    for (
        const element of elements
    ) {

        if (
            String(
                element.dataset.userId
            ) !== value
        ) {
            continue;
        }


        const dot =
            element.querySelector(
                ".user-online-dot"
            );


        if (dot) {

            dot.classList.toggle(
                "offline",
                !isOnline
            );
        }
    }


    /*
     * لیست را هم به‌روز می‌کنیم.
     */

    loadUsers(
        getSearchValue()
    );
}


/* =========================================================
   SEARCH
   ========================================================= */

function getSearchValue() {

    const input =
        document.getElementById(
            "userSearch"
        ) ||

        document.getElementById(
            "searchUsers"
        ) ||

        document.getElementById(
            "searchInput"
        );


    return input
        ? input.value
        : "";
}


function setupUserSearch() {

    const input =
        document.getElementById(
            "userSearch"
        ) ||

        document.getElementById(
            "searchUsers"
        ) ||

        document.getElementById(
            "searchInput"
        );


    if (!input) {
        return;
    }


    let timeout = null;


    input.addEventListener(
        "input",
        () => {

            clearTimeout(
                timeout
            );


            timeout =
                setTimeout(
                    () => {

                        loadUsers(
                            input.value
                        );

                    },
                    250
                );
        }
    );
}


/* =========================================================
   INCOMING MESSAGE
   ========================================================= */

function handleIncomingMessage(
    message
) {

    if (!message) {
        return;
    }


    if (
        typeof window.onGapinoMessage ===
        "function"
    ) {

        window.onGapinoMessage(
            message
        );

        return;
    }


    if (
        typeof window.addMessageToChat ===
        "function"
    ) {

        window.addMessageToChat(
            message
        );

        return;
    }


    if (
        typeof window.renderMessage ===
        "function"
    ) {

        window.renderMessage(
            message
        );

        return;
    }


    console.log(
        "GAPINO incoming:",
        message
    );
}


function handleUpdatedMessage(
    message
) {

    if (!message) {
        return;
    }


    if (
        typeof window.onGapinoMessageUpdated ===
        "function"
    ) {

        window.onGapinoMessageUpdated(
            message
        );

        return;
    }


    if (
        typeof window.updateChatMessage ===
        "function"
    ) {

        window.updateChatMessage(
            message
        );

        return;
    }


    console.log(
        "GAPINO updated:",
        message
    );
}


function handleTypingEvent(
    data
) {

    if (
        typeof window.onGapinoTyping ===
        "function"
    ) {

        window.onGapinoTyping(
            data
        );
    }
}


/* =========================================================
   CALL EVENTS
   ========================================================= */

function handleCallEvent(
    data
) {

    if (
        typeof window.GAPINO_CALL_HANDLE_EVENT ===
        "function"
    ) {

        window.GAPINO_CALL_HANDLE_EVENT(
            data
        );

        return;
    }


    if (
        typeof window.onGapinoCallEvent ===
        "function"
    ) {

        window.onGapinoCallEvent(
            data
        );

        return;
    }


    document.dispatchEvent(
        new CustomEvent(
            "gapino-call-event",
            {
                detail: data
            }
        )
    );
}


/* =========================================================
   STARTUP
   ========================================================= */

async function initGapino() {

    console.log(
        "🚀 GAPINO chat.js starting"
    );

    console.log(
        "🌐 API:",
        API_BASE
    );

    console.log(
        "🔌 WS:",
        getWebSocketUrl()
    );


    /*
     * اول Session
     */

    const me =
        await loadMe();


    /*
     * سپس کاربران
     */

    if (me) {

        await loadUsers();

    } else {

        console.warn(
            "GAPINO: user session unavailable"
        );
    }


    setupUserSearch();


    /*
     * WebSocket
     */

    if (me) {

        /*
         * /api/me در main.py برای
         * همان کاربر ticket می‌سازد.
         */

        connectGapinoWebSocket();
    }


    /*
     * به‌روزرسانی کاربران
     */

    setInterval(
        () => {

            if (
                gapinoMe
            ) {

                loadUsers(
                    getSearchValue()
                );
            }

        },
        15000
    );
}


/* =========================================================
   GLOBAL
   ========================================================= */

window.GAPINO_API =
    API_BASE;

window.gapinoApiFetch =
    apiFetch;

window.gapinoLoadUsers =
    loadUsers;

window.gapinoLoadMe =
    loadMe;

window.gapinoLoadMessages =
    loadMessages;

window.gapinoSendMessage =
    sendMessage;

window.gapinoSocket =
    () => gapinoSocket;

window.gapinoSendSocketMessage =
    sendSocketMessage;

window.gapinoAbsoluteUrl =
    absoluteUrl;

window.GAPINO_USERS =
    gapinoUsers;


/*
 * شیء GAPINO
 */

window.GAPINO =
    window.GAPINO || {};

window.GAPINO.api =
    API_BASE;

window.GAPINO.users =
    gapinoUsers;

window.GAPINO.socket =
    gapinoSocket;

window.GAPINO.currentUser =
    gapinoMe;

window.GAPINO.currentChatUser =
    null;


/* =========================================================
   DOM READY
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initGapino,
        {
            once: true
        }
    );

} else {

    initGapino();
}