"use strict";

/*
 * =========================================================
 * GAPINO API CONFIG
 * =========================================================
 *
 * روی لپ‌تاپ هم:
 * https://mygapino.shop
 *
 * روی APK هم:
 * https://mygapino.shop
 *
 * هرگز برای APK از localhost استفاده نکن.
 * =========================================================
 */

const API_BASE = "https://mygapino.shop";

function apiUrl(path) {
    if (!path.startsWith("/")) {
        path = "/" + path;
    }

    return API_BASE + path;
}

async function apiFetch(path, options = {}) {
    const config = {
        credentials: "include",
        ...options,
        headers: {
            ...(options.headers || {})
        }
    };

    return fetch(apiUrl(path), config);
}

/*
 * اگر توکن در localStorage ذخیره شده باشد،
 * آن را نیز برای API ارسال می‌کنیم.
 */
function getAuthToken() {
    return (
        localStorage.getItem("gapino_token") ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("gapino_token") ||
        sessionStorage.getItem("token") ||
        ""
    );
}

function authHeaders(extra = {}) {
    const token = getAuthToken();

    return {
        ...extra,
        ...(token
            ? {
                  Authorization: `Bearer ${token}`
              }
            : {})
    };
}


/*
 * =========================================================
 * USERS
 * =========================================================
 */

async function loadUsers(search = "") {
    try {
        const query = search.trim();

        const url = query
            ? `/api/users?q=${encodeURIComponent(query)}`
            : "/api/users";

        const response = await apiFetch(url, {
            method: "GET",
            headers: authHeaders()
        });

        if (!response.ok) {
            const text = await response.text();

            throw new Error(
                `Users API ${response.status}: ${text}`
            );
        }

        const users = await response.json();

        renderUsers(users);

        return users;
    } catch (error) {
        console.error(
            "GAPINO loadUsers error:",
            error
        );

        showUsersError(
            "دریافت کاربران انجام نشد"
        );

        return [];
    }
}


/*
 * =========================================================
 * RENDER USERS
 * =========================================================
 *
 * این تابع چند ID رایج را پشتیبانی می‌کند.
 * اگر در chat.html یکی از این containerها وجود داشته باشد،
 * کاربران داخل همان نمایش داده می‌شوند.
 * =========================================================
 */

function getUsersContainer() {
    return (
        document.getElementById("usersList") ||
        document.getElementById("users-list") ||
        document.getElementById("userList") ||
        document.getElementById("user-list") ||
        document.querySelector(
            ".users-list"
        ) ||
        document.querySelector(
            ".user-list"
        )
    );
}

function renderUsers(users) {
    const container = getUsersContainer();

    if (!container) {
        console.warn(
            "GAPINO: users container پیدا نشد"
        );
        return;
    }

    container.innerHTML = "";

    if (
        !Array.isArray(users) ||
        users.length === 0
    ) {
        const empty = document.createElement(
            "div"
        );

        empty.className = "empty-users";

        empty.textContent =
            "هنوز کاربر دیگری ثبت‌نام نکرده است";

        container.appendChild(empty);

        return;
    }

    for (const user of users) {
        const item = document.createElement(
            "button"
        );

        item.type = "button";
        item.className = "user-item";

        item.dataset.userId = user.id;

        const avatar = document.createElement(
            "div"
        );

        avatar.className = "user-avatar";

        if (user.avatar) {
            const image =
                document.createElement(
                    "img"
                );

            image.src = absoluteUrl(
                user.avatar
            );

            image.alt =
                user.display_name ||
                user.username ||
                "کاربر";

            image.loading = "lazy";

            avatar.appendChild(image);
        } else {
            avatar.textContent =
                getInitial(
                    user.display_name ||
                    user.username
                );
        }

        const body = document.createElement(
            "div"
        );

        body.className =
            "user-item-body";

        const name = document.createElement(
            "div"
        );

        name.className =
            "user-item-name";

        name.textContent =
            user.display_name ||
            user.username;

        const username =
            document.createElement(
                "div"
            );

        username.className =
            "user-item-username";

        username.textContent =
            "@" + user.username;

        const status =
            document.createElement(
                "div"
            );

        status.className =
            "user-item-status";

        status.textContent =
            user.status ||
            "در دسترس";

        body.appendChild(name);
        body.appendChild(username);
        body.appendChild(status);

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

        item.appendChild(avatar);
        item.appendChild(body);
        item.appendChild(online);

        item.addEventListener(
            "click",
            () => {
                openUserChat(user);
            }
        );

        container.appendChild(item);
    }
}


function showUsersError(message) {
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

    error.textContent = message;

    container.appendChild(error);
}


/*
 * =========================================================
 * USER CHAT
 * =========================================================
 *
 * اگر سیستم قبلی خودت تابع openChat دارد،
 * از همان استفاده می‌کنیم.
 * =========================================================
 */

function openUserChat(user) {
    window.gapinoSelectedUser =
        user;

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


/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

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


function getInitial(text) {
    const value = String(
        text || "؟"
    ).trim();

    return value
        ? value.charAt(0)
        : "؟";
}


/*
 * =========================================================
 * LOAD MY PROFILE
 * =========================================================
 */

async function loadMe() {
    try {
        const response =
            await apiFetch(
                "/api/me",
                {
                    method: "GET",
                    headers:
                        authHeaders()
                }
            );

        if (!response.ok) {
            throw new Error(
                `ME ${response.status}`
            );
        }

        const data =
            await response.json();

        if (data.token) {
            localStorage.setItem(
                "gapino_token",
                data.token
            );
        }

        window.gapinoMe = data;

        return data;
    } catch (error) {
        console.error(
            "GAPINO loadMe error:",
            error
        );

        return null;
    }
}


/*
 * =========================================================
 * MESSAGES
 * =========================================================
 */

async function loadMessages(otherId) {
    try {
        const response =
            await apiFetch(
                `/api/messages/${Number(
                    otherId
                )}`,
                {
                    method: "GET",
                    headers:
                        authHeaders()
                }
            );

        if (!response.ok) {
            throw new Error(
                `Messages API ${response.status}`
            );
        }

        const messages =
            await response.json();

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
            "GAPINO loadMessages error:",
            error
        );

        return [];
    }
}


/*
 * =========================================================
 * SEND MESSAGE
 * =========================================================
 */

async function sendMessage(
    receiverId,
    text
) {
    try {
        const message =
            String(text || "").trim();

        if (!message) {
            return null;
        }

        const response =
            await apiFetch(
                "/api/messages",
                {
                    method: "POST",

                    headers:
                        authHeaders({
                            "Content-Type":
                                "application/json"
                        }),

                    body: JSON.stringify({
                        receiver_id:
                            Number(
                                receiverId
                            ),
                        text: message
                    })
                }
            );

        if (!response.ok) {
            const errorText =
                await response.text();

            throw new Error(
                `${response.status}: ${errorText}`
            );
        }

        return await response.json();
    } catch (error) {
        console.error(
            "GAPINO sendMessage error:",
            error
        );

        return null;
    }
}


/*
 * =========================================================
 * WEBSOCKET
 * =========================================================
 *
 * HTTPS => WSS
 * HTTP  => WS
 * =========================================================
 */

let gapinoSocket = null;
let gapinoReconnectTimer = null;
let gapinoReconnectAttempt = 0;

function getWebSocketUrl() {
    const pageProtocol =
        window.location.protocol;

    if (
        pageProtocol === "https:"
    ) {
        return "wss://mygapino.shop/ws";
    }

    return "ws://mygapino.shop/ws";
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
        "GAPINO WebSocket:",
        url
    );

    try {
        gapinoSocket =
            new WebSocket(url);
    } catch (error) {
        console.error(
            "WebSocket create error:",
            error
        );

        scheduleReconnect();

        return;
    }

    gapinoSocket.addEventListener(
        "open",
        () => {
            console.log(
                "GAPINO WebSocket connected"
            );

            gapinoReconnectAttempt = 0;

            sendSocketPing();
        }
    );

    gapinoSocket.addEventListener(
        "message",
        (event) => {
            handleSocketMessage(
                event.data
            );
        }
    );

    gapinoSocket.addEventListener(
        "close",
        (event) => {
            console.warn(
                "GAPINO WebSocket closed:",
                event.code,
                event.reason
            );

            scheduleReconnect();
        }
    );

    gapinoSocket.addEventListener(
        "error",
        (error) => {
            console.error(
                "GAPINO WebSocket error:",
                error
            );
        }
    );
}


function scheduleReconnect() {
    if (gapinoReconnectTimer) {
        return;
    }

    const delay = Math.min(
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


function sendSocketPing() {
    if (
        !gapinoSocket ||
        gapinoSocket.readyState !==
            WebSocket.OPEN
    ) {
        return;
    }

    gapinoSocket.send(
        JSON.stringify({
            type: "ping"
        })
    );
}


function sendSocketMessage(data) {
    if (
        !gapinoSocket ||
        gapinoSocket.readyState !==
            WebSocket.OPEN
    ) {
        return false;
    }

    try {
        gapinoSocket.send(
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


/*
 * =========================================================
 * SOCKET MESSAGE HANDLER
 * =========================================================
 */

function handleSocketMessage(raw) {
    let data;

    try {
        data =
            typeof raw === "string"
                ? JSON.parse(raw)
                : raw;
    } catch (error) {
        console.error(
            "Invalid WebSocket JSON:",
            error
        );

        return;
    }

    if (!data) {
        return;
    }

    switch (data.type) {
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
                "Unknown GAPINO socket event:",
                data
            );
    }
}


function handleOnlineUsers(
    onlineIds
) {
    if (
        !Array.isArray(onlineIds)
    ) {
        return;
    }

    for (
        const userId of onlineIds
    ) {
        updateUserOnline(
            userId,
            true
        );
    }
}


function updateUserOnline(
    userId,
    isOnline
) {
    const elements =
        document.querySelectorAll(
            `[data-user-id="${CSS.escape(
                String(userId)
            )}"]`
        );

    for (
        const element of elements
    ) {
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
     * بعد از تغییر وضعیت آنلاین،
     * لیست کاربران را مجدداً می‌خوانیم.
     */
    loadUsers(
        getSearchValue()
    );
}


/*
 * =========================================================
 * INCOMING MESSAGE
 * =========================================================
 */

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

    console.log(
        "GAPINO incoming message:",
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
        "GAPINO updated message:",
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


function handleCallEvent(
    data
) {
    if (
        typeof window.onGapinoCallEvent ===
        "function"
    ) {
        window.onGapinoCallEvent(
            data
        );
    }
}


/*
 * =========================================================
 * SEARCH
 * =========================================================
 */

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

            timeout = setTimeout(
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


/*
 * =========================================================
 * STARTUP
 * =========================================================
 */

async function initGapino() {
    console.log(
        "GAPINO starting..."
    );

    console.log(
        "API:",
        API_BASE
    );

    await loadMe();

    await loadUsers();

    setupUserSearch();

    connectGapinoWebSocket();

    /*
     * هر 15 ثانیه لیست کاربران
     * به‌روز شود.
     */
    setInterval(
        () => {
            loadUsers(
                getSearchValue()
            );
        },
        15000
    );
}


/*
 * =========================================================
 * GLOBAL API
 * =========================================================
 */

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


/*
 * =========================================================
 * DOM READY
 * =========================================================
 */

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initGapino
    );
} else {
    initGapino();
}