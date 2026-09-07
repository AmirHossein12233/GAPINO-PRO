"use strict";

/* =========================================================
   GAPINO PRO
   APP.JS
   عمومی و هماهنگ با chat.html + chat.js

   امکانات:
   - Session helper
   - Theme
   - Mobile sidebar
   - Overlay
   - Toast
   - Global keyboard shortcuts
   - API helper
   - Browser notification
   - Online status helpers
   ========================================================= */


/* =========================================================
   CONFIG
   ========================================================= */

const GAPINO_API =
    window.location.origin;

const GAPINO_STORAGE_USER =
    "gapino_user";

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
        gapinoSafeText(
            message
        );


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
   API
   ========================================================= */

async function gapinoFetch(
    path,
    options = {}
) {

    const response =
        await fetch(
            GAPINO_API + path,
            {
                ...options,

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
                "/me"
            );


        if (
            data?.authenticated &&
            data?.user
        ) {

            try {

                localStorage.setItem(
                    GAPINO_STORAGE_USER,
                    JSON.stringify(
                        data.user
                    )
                );

            } catch (_) {}


            return data.user;
        }

    } catch (error) {

        console.warn(
            "GAPINO session:",
            error
        );
    }


    return null;
}


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
   LOGOUT
   ========================================================= */

async function gapinoLogout() {

    try {

        await gapinoFetch(
            "/logout",
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


    try {

        localStorage.removeItem(
            GAPINO_STORAGE_USER
        );

    } catch (_) {}


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
   WINDOW RESPONSIVE
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
   BROWSER NOTIFICATION
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
   ONLINE STATUS
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
   LOCAL USER HELPERS
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


function clearGapinoUser() {

    try {

        localStorage.removeItem(
            GAPINO_STORAGE_USER
        );

    } catch (_) {}
}


/* =========================================================
   DOCUMENT VISIBILITY
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.visibilityState ===
            "visible"
        ) {

            /*
             * chat.js مسئول WebSocket است.
             * اینجا فقط UI عمومی را به‌روز می‌کنیم.
             */

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


        /*
         * Ctrl + Shift + T
         * تغییر تم
         */

        if (
            event.ctrlKey &&
            event.shiftKey &&
            event.key.toLowerCase() ===
                "t"
        ) {

            event.preventDefault();

            toggleGapinoTheme();
        }


        /*
         * Ctrl + K
         * تمرکز روی جستجوی کاربران
         */

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


/*
 * تم
 *
 * توجه:
 * chat.html خودش هم Theme System دارد.
 * بنابراین اگر listener قبلی وجود داشته باشد،
 * از ثبت دوباره جلوگیری می‌کنیم.
 */

if (themeButton) {

    themeButton.addEventListener(
        "click",
        event => {

            event.preventDefault();

            toggleGapinoTheme();
        }
    );
}


/*
 * منوی موبایل
 */

mobileMenuButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        openGapinoSidebar();
    }
);


/*
 * دکمه منو
 */

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


/*
 * Overlay
 */

appOverlay?.addEventListener(
    "click",
    event => {

        event.preventDefault();

        closeGapinoSidebar();

        closeGapinoProfile();
    }
);


/*
 * پروفایل
 */

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


/*
 * خروج
 */

logoutButton?.addEventListener(
    "click",
    async event => {

        event.preventDefault();

        await gapinoLogout();
    }
);


/* =========================================================
   BEFORE UNLOAD
   ========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        /*
         * WebSocket و میکروفن
         * توسط chat.js مدیریت می‌شوند.
         */

    }
);


/* =========================================================
   INIT
   ========================================================= */

function initGapinoApp() {

    /*
     * تم اولیه
     */

    applyGapinoTheme(
        getSavedTheme()
    );


    /*
     * overlay اولیه
     */

    if (appOverlay) {

        appOverlay.hidden =
            true;

        appOverlay.style.display =
            "none";
    }


    /*
     * در شروع،
     * پروفایل بسته باشد.
     */

    if (profilePanel) {

        profilePanel.hidden =
            true;

        profilePanel.classList.remove(
            "open"
        );
    }


    /*
     * شروع درخواست Notification
     * اختیاری و بدون توقف صفحه
     */

    setTimeout(
        () => {

            requestGapinoNotifications();

        },
        1200
    );


    /*
     * ذخیره کاربر موجود
     */

    const storedUser =
        getStoredGapinoUser();


    if (storedUser) {

        window.GAPINO_CURRENT_USER =
            storedUser;
    }


    console.log(
        "✅ GAPINO app.js loaded"
    );
}


/* =========================================================
   GLOBAL API
   ========================================================= */

window.GAPINO = {

    api:
        GAPINO_API,

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
        getStoredGapinoUser
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
