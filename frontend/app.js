"use strict";

/* =========================================================
   GAPINO PRO
   APP.JS
   نسخه سازگار با:
   - Web
   - Capacitor APK
   - mygapino.shop
   - FastAPI /api/*
   ========================================================= */


/* =========================================================
   CONFIG
   ========================================================= */

/*
 * بسیار مهم:
 * در APK نباید از window.location.origin استفاده کنیم.
 *
 * وب:
 * https://mygapino.shop
 *
 * APK:
 * capacitor://localhost
 * یا http://localhost
 *
 * بنابراین API اصلی را ثابت قرار می‌دهیم.
 */

const GAPINO_API =
    "https://mygapino.shop";


const GAPINO_STORAGE_USER =
    "gapino_user";


const GAPINO_STORAGE_TOKEN =
    "gapino_token";


const GAPINO_STORAGE_THEME =
    "gapino_theme";


/* =========================================================
   HELPERS
   ========================================================= */

function gapino$(id) {
    return document.getElementById(id);
}


function gapinoSafeText(value) {
    return String(value ?? "");
}


function gapinoApiUrl(path) {

    if (!path) {
        return GAPINO_API;
    }

    if (
        path.startsWith("http://") ||
        path.startsWith("https://")
    ) {
        return path;
    }

    if (!path.startsWith("/")) {
        path = "/" + path;
    }

    return GAPINO_API + path;
}


/* =========================================================
   ELEMENTS
   ========================================================= */

const appShell =
    gapino$("appShell");

const sidebar =
    gapino$("sidebar");

const menuButton =
    gapino$("menuButton");

const mobileMenuButton =
    gapino$("mobileMenuButton");

const appOverlay =
    gapino$("appOverlay");

const themeButton =
    gapino$("themeButton");

const logoutButton =
    gapino$("logoutButton");

const toastElement =
    gapino$("toast");

const profilePanel =
    gapino$("profilePanel");

const closeProfile =
    gapino$("closeProfile");

const profileButton =
    gapino$("profileButton");

const profileHeaderButton =
    gapino$("profileHeaderButton");


/* =========================================================
   TOAST
   ========================================================= */

function showGapinoToast(
    message,
    duration = 2500
) {

    const text =
        gapinoSafeText(message);


    if (!toastElement) {

        console.log(
            "GAPINO:",
            text
        );

        return;
    }


    toastElement.textContent =
        text;


    toastElement.classList.add(
        "show"
    );


    clearTimeout(
        showGapinoToast.timer
    );


    showGapinoToast.timer =
        setTimeout(
            () => {

                toastElement.classList.remove(
                    "show"
                );

            },
            duration
        );
}


/* =========================================================
   TOKEN
   ========================================================= */

function getGapinoToken() {

    try {

        return (
            localStorage.getItem(
                GAPINO_STORAGE_TOKEN
            ) ||
            sessionStorage.getItem(
                GAPINO_STORAGE_TOKEN
            ) ||
            localStorage.getItem(
                "token"
            ) ||
            sessionStorage.getItem(
                "token"
            ) ||
            ""
        );

    } catch (error) {

        console.warn(
            "Token read error:",
            error
        );

        return "";
    }
}


function saveGapinoToken(token) {

    if (!token) {
        return;
    }

    try {

        localStorage.setItem(
            GAPINO_STORAGE_TOKEN,
            token
        );

    } catch (error) {

        console.warn(
            "Token save error:",
            error
        );
    }
}


function clearGapinoToken() {

    try {

        localStorage.removeItem(
            GAPINO_STORAGE_TOKEN
        );

        sessionStorage.removeItem(
            GAPINO_STORAGE_TOKEN
        );

        localStorage.removeItem(
            "token"
        );

        sessionStorage.removeItem(
            "token"
        );

    } catch (_) {}
}


/* =========================================================
   API
   ========================================================= */

async function gapinoFetch(
    path,
    options = {}
) {

    const headers = {
        ...(options.headers || {})
    };


    const token =
        getGapinoToken();


    if (token) {

        headers.Authorization =
            `Bearer ${token}`;
    }


    const response =
        await fetch(
            gapinoApiUrl(path),
            {
                ...options,

                headers,

                credentials:
                    "include",

                cache:
                    "no-store"
            }
        );


    const contentType =
        response.headers.get(
            "content-type"
        ) || "";


    let data = null;


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
            data?.message ||
            data?.detail ||
            `HTTP ${response.status}`
        );
    }


    return data;
}


/* =========================================================
   SESSION
   ========================================================= */

async function getGapinoSession() {

    try {

        const data =
            await gapinoFetch(
                "/api/me"
            );


        /*
         * main.py فعلی:
         *
         * {
         *   ...user,
         *   token: "..."
         * }
         *
         * بنابراین authenticated و user
         * الزاماً وجود ندارند.
         */

        if (data?.token) {

            saveGapinoToken(
                data.token
            );
        }


        let user =
            data?.user ||
            data;


        if (
            user &&
            (
                user.id ||
                user.user_id
            )
        ) {

            saveGapinoUser(
                user
            );

            window.GAPINO_CURRENT_USER =
                user;

            return user;
        }

    } catch (error) {

        console.warn(
            "GAPINO session:",
            error
        );
    }


    return null;
}


/* =========================================================
   STORED USER
   ========================================================= */

function getStoredGapinoUser() {

    try {

        const raw =
            localStorage.getItem(
                GAPINO_STORAGE_USER
            );


        if (!raw) {
            return null;
        }


        const user =
            JSON.parse(
                raw
            );


        if (
            user &&
            (
                user.id ||
                user.user_id
            )
        ) {

            return user;
        }

    } catch (error) {

        console.warn(
            "Stored user error:",
            error
        );
    }


    return null;
}


/* =========================================================
   SAVE USER
   ========================================================= */

function saveGapinoUser(
    user
) {

    if (!user) {
        return;
    }


    try {

        localStorage.setItem(
            GAPINO_STORAGE_USER,
            JSON.stringify(
                user
            )
        );

    } catch (error) {

        console.warn(
            "Save user error:",
            error
        );
    }
}


/* =========================================================
   CLEAR USER
   ========================================================= */

function clearGapinoUser() {

    try {

        localStorage.removeItem(
            GAPINO_STORAGE_USER
        );

    } catch (_) {}
}


/* =========================================================
   LOGOUT
   ========================================================= */

async function gapinoLogout() {

    try {

        await gapinoFetch(
            "/api/logout",
            {
                method:
                    "POST"
            }
        );

    } catch (error) {

        console.warn(
            "Logout:",
            error
        );
    }


    clearGapinoUser();

    clearGapinoToken();


    window.location.replace(
        "/login.html"
    );
}


/* =========================================================
   THEME
   ========================================================= */

function getSavedTheme() {

    try {

        const saved =
            localStorage.getItem(
                GAPINO_STORAGE_THEME
            );


        return saved === "light"
            ? "light"
            : "dark";

    } catch (_) {

        return "dark";
    }
}


function updateThemeButton() {

    if (!themeButton) {
        return;
    }


    const theme =
        document.documentElement.getAttribute(
            "data-theme"
        ) || "dark";


    if (
        theme === "light"
    ) {

        themeButton.innerHTML =
            "🌙 <span>حالت تیره</span>";

        themeButton.title =
            "فعال کردن حالت تیره";

    } else {

        themeButton.innerHTML =
            "☀️ <span>حالت روشن</span>";

        themeButton.title =
            "فعال کردن حالت روشن";
    }
}


function applyGapinoTheme(
    theme
) {

    const value =
        theme === "light"
            ? "light"
            : "dark";


    document.documentElement.setAttribute(
        "data-theme",
        value
    );


    try {

        localStorage.setItem(
            GAPINO_STORAGE_THEME,
            value
        );

    } catch (_) {}


    updateThemeButton();
}


function toggleGapinoTheme() {

    const current =
        document.documentElement.getAttribute(
            "data-theme"
        ) || "dark";


    applyGapinoTheme(
        current === "dark"
            ? "light"
            : "dark"
    );
}


/* =========================================================
   SIDEBAR
   ========================================================= */

function openGapinoOverlay() {

    if (!appOverlay) {
        return;
    }


    appOverlay.hidden =
        false;


    appOverlay.style.display =
        "block";
}


function closeGapinoOverlay() {

    if (!appOverlay) {
        return;
    }


    appOverlay.hidden =
        true;


    appOverlay.style.display =
        "none";
}


function openGapinoSidebar() {

    if (!appShell) {
        return;
    }


    if (
        window.innerWidth >
        820
    ) {

        return;
    }


    appShell.classList.add(
        "sidebar-open"
    );


    openGapinoOverlay();
}


function closeGapinoSidebar() {

    appShell?.classList.remove(
        "sidebar-open"
    );


    closeGapinoOverlay();
}


function toggleGapinoSidebar() {

    const opened =
        appShell?.classList.contains(
            "sidebar-open"
        );


    if (opened) {

        closeGapinoSidebar();

    } else {

        openGapinoSidebar();
    }
}


/* =========================================================
   PROFILE
   ========================================================= */

function openGapinoProfile() {

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

        openGapinoOverlay();
    }
}


function closeGapinoProfile() {

    if (!profilePanel) {
        return;
    }


    profilePanel.classList.remove(
        "open"
    );


    profilePanel.hidden =
        true;


    closeGapinoOverlay();
}


/* =========================================================
   RESPONSIVE
   ========================================================= */

function handleGapinoResize() {

    if (
        window.innerWidth >
        820
    ) {

        appShell?.classList.remove(
            "sidebar-open"
        );


        closeGapinoOverlay();
    }
}


/* =========================================================
   NOTIFICATION
   ========================================================= */

function isNotificationSupported() {

    return (
        "Notification" in
        window
    );
}


async function requestGapinoNotifications() {

    if (
        !isNotificationSupported()
    ) {

        return;
    }


    if (
        Notification.permission ===
        "default"
    ) {

        try {

            await Notification.requestPermission();

        } catch (_) {}
    }
}


function showGapinoNotification(
    title,
    body
) {

    if (
        !isNotificationSupported()
    ) {

        return;
    }


    if (
        Notification.permission !==
        "granted"
    ) {

        return;
    }


    try {

        new Notification(
            gapinoSafeText(
                title ||
                "گپینو"
            ),
            {
                body:
                    gapinoSafeText(
                        body
                    ),

                icon:
                    "/favicon.ico"
            }
        );

    } catch (error) {

        console.warn(
            "Notification error:",
            error
        );
    }
}


/* =========================================================
   ONLINE
   ========================================================= */

function gapinoIsOnline(
    user
) {

    return Boolean(
        user?.online === true ||
        user?.status === "online" ||
        user?.status === "آنلاین"
    );
}


function gapinoGetUserId(
    user
) {

    return String(
        user?.id ||
        user?.user_id ||
        ""
    );
}


/* =========================================================
   VISIBILITY
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.visibilityState ===
            "visible"
        ) {

            updateThemeButton();
        }
    }
);


/* =========================================================
   KEYBOARD
   ========================================================= */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Escape"
        ) {

            closeGapinoSidebar();

            closeGapinoProfile();

            document.querySelector(
                ".message-menu"
            )?.remove();
        }


        if (
            event.ctrlKey &&
            event.shiftKey &&
            event.key.toLowerCase() ===
                "t"
        ) {

            event.preventDefault();

            toggleGapinoTheme();
        }


        if (
            event.ctrlKey &&
            event.key.toLowerCase() ===
                "k"
        ) {

            const search =
                document.getElementById(
                    "userSearch"
                );


            if (search) {

                event.preventDefault();

                search.focus();

                search.select();
            }
        }
    }
);


/* =========================================================
   GLOBAL CLICK
   ========================================================= */

document.addEventListener(
    "click",
    event => {

        const messageMenu =
            document.querySelector(
                ".message-menu"
            );


        if (
            messageMenu &&
            !messageMenu.contains(
                event.target
            )
        ) {

            messageMenu.remove();
        }
    }
);


/* =========================================================
   EVENTS
   ========================================================= */

if (themeButton) {

    themeButton.addEventListener(
        "click",
        event => {

            event.preventDefault();

            toggleGapinoTheme();
        }
    );
}


mobileMenuButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openGapinoSidebar();
    }
);


menuButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        if (
            window.innerWidth <=
            820
        ) {

            toggleGapinoSidebar();
        }
    }
);


appOverlay?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        closeGapinoSidebar();

        closeGapinoProfile();
    }
);


profileButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openGapinoProfile();
    }
);


profileHeaderButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openGapinoProfile();
    }
);


closeProfile?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        closeGapinoProfile();
    }
);


logoutButton?.addEventListener(
    "click",
    async event => {

        event.preventDefault();

        await gapinoLogout();
    }
);


/* =========================================================
   INIT
   ========================================================= */

function initGapinoApp() {

    applyGapinoTheme(
        getSavedTheme()
    );


    if (appOverlay) {

        appOverlay.hidden =
            true;

        appOverlay.style.display =
            "none";
    }


    if (profilePanel) {

        profilePanel.hidden =
            true;

        profilePanel.classList.remove(
            "open"
        );
    }


    const storedUser =
        getStoredGapinoUser();


    if (storedUser) {

        window.GAPINO_CURRENT_USER =
            storedUser;
    }


    /*
     * Session را در پس‌زمینه بررسی کن.
     * این قسمت برای APK بسیار مهم است.
     */

    getGapinoSession()
        .then(
            user => {

                if (user) {

                    window.GAPINO_CURRENT_USER =
                        user;

                    console.log(
                        "✅ GAPINO user:",
                        user.username
                    );
                }

            }
        )
        .catch(
            error => {

                console.warn(
                    "GAPINO session init:",
                    error
                );
            }
        );


    setTimeout(
        () => {

            requestGapinoNotifications();

        },
        1200
    );


    console.log(
        "✅ GAPINO app.js loaded"
    );

    console.log(
        "🌐 GAPINO API:",
        GAPINO_API
    );
}


/* =========================================================
   GLOBAL API
   ========================================================= */

window.GAPINO = {

    api:
        GAPINO_API,

    apiUrl:
        gapinoApiUrl,

    fetch:
        gapinoFetch,

    toast:
        showGapinoToast,

    logout:
        gapinoLogout,

    openSidebar:
        openGapinoSidebar,

    closeSidebar:
        closeGapinoSidebar,

    openProfile:
        openGapinoProfile,

    closeProfile:
        closeGapinoProfile,

    theme:
        toggleGapinoTheme,

    notification:
        showGapinoNotification,

    getSession:
        getGapinoSession,

    getStoredUser:
        getStoredGapinoUser,

    getToken:
        getGapinoToken
};


/* =========================================================
   START
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initGapinoApp
    );

} else {

    initGapinoApp();
}


/* =========================================================
   RESIZE
   ========================================================= */

window.addEventListener(
    "resize",
    handleGapinoResize
);
