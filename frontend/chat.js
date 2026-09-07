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

    let selectedProfileAvatarFile = null;
    let profileAvatarObjectUrl = null;

    const $ = (id) =>
        document.getElementById(id);

    /* =========================================================
       TOAST
       ========================================================= */

    function showToast(message) {
        const container =
            $("toastContainer");

        if (!container) {
            console.log(
                "GAPINO:",
                message
            );
            return;
        }

        const toast =
            document.createElement("div");

        toast.className = "toast";

        toast.textContent =
            String(message);

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3500);
    }

    /* =========================================================
       USER HELPERS
       ========================================================= */

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

    function getAvatarUrl(value) {
        if (!value) {
            return "";
        }

        const url =
            String(value);

        if (
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("data:") ||
            url.startsWith("blob:")
        ) {
            return url;
        }

        if (url.startsWith("/")) {
            return API + url;
        }

        return API + "/" + url;
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

        const id =
            Number(value);

        return Number.isFinite(id)
            ? id
            : null;
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

    /* =========================================================
       API
       ========================================================= */

    async function api(
        path,
        options = {}
    ) {
        const headers = {
            ...(options.headers || {})
        };

        const requestOptions = {
            ...options
        };

        if (
            requestOptions.body &&
            typeof requestOptions.body === "object" &&
            !(requestOptions.body instanceof FormData)
        ) {
            headers["Content-Type"] =
                "application/json";

            requestOptions.body =
                JSON.stringify(
                    requestOptions.body
                );
        }

        const response =
            await fetch(
                API + path,
                {
                    credentials: "include",
                    cache: "no-store",
                    ...requestOptions,
                    headers
                }
            );

        let data = null;

        try {
            data =
                await response.json();
        } catch {
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
       CURRENT USER
       ========================================================= */

    async function loadCurrentUser() {
        const data =
            await api("/api/me");

        currentUser =
            data?.user ||
            data;

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

        const nameInput =
            $("profileDisplayName");

        const bioInput =
            $("profileBio");

        const avatarPreview =
            $("profileAvatarPreview");

        if (nameInput) {
            nameInput.value =
                currentUser.display_name ||
                currentUser.username ||
                "";
        }

        if (bioInput) {
            bioInput.value =
                currentUser.bio ||
                currentUser.status ||
                "";
        }

        if (avatarPreview) {
            const avatar =
                getAvatarUrl(
                    getAvatar(
                        currentUser
                    )
                );

            if (avatar) {
                avatarPreview.src =
                    avatar;

                avatarPreview.style.visibility =
                    "visible";
            } else {
                avatarPreview.removeAttribute(
                    "src"
                );

                avatarPreview.style.visibility =
                    "hidden";
            }
        }
    }

    /* =========================================================
       PROFILE AVATAR
       ========================================================= */

    function setupProfileAvatar() {
        const button =
            $("changeProfileAvatarButton");

        const input =
            $("profileAvatarInput");

        if (
            !button ||
            !input
        ) {
            return;
        }

        button.addEventListener(
            "click",
            event => {
                event.preventDefault();
                input.click();
            }
        );

        input.addEventListener(
            "change",
            () => {
                const file =
                    input.files?.[0] ||
                    null;

                if (!file) {
                    return;
                }

                const allowedTypes = [
                    "image/png",
                    "image/jpeg",
                    "image/webp"
                ];

                if (
                    !allowedTypes.includes(
                        file.type
                    )
                ) {
                    showToast(
                        "فقط PNG، JPG و WEBP مجاز است."
                    );

                    input.value = "";

                    return;
                }

                if (
                    file.size >
                    5 * 1024 * 1024
                ) {
                    showToast(
                        "حجم عکس نباید بیشتر از ۵ مگابایت باشد."
                    );

                    input.value = "";

                    return;
                }

                selectedProfileAvatarFile =
                    file;

                if (
                    profileAvatarObjectUrl
                ) {
                    try {
                        URL.revokeObjectURL(
                            profileAvatarObjectUrl
                        );
                    } catch {}
                }

                profileAvatarObjectUrl =
                    URL.createObjectURL(
                        file
                    );

                const preview =
                    $("profileAvatarPreview");

                if (preview) {
                    preview.src =
                        profileAvatarObjectUrl;

                    preview.style.visibility =
                        "visible";
                }

                const status =
                    $("profileAvatarStatus");

                if (status) {
                    status.textContent =
                        "✅ عکس انتخاب شد؛ روی ذخیره بزن.";
                }
            }
        );
    }

    async function uploadProfileAvatar() {
        if (
            !selectedProfileAvatarFile
        ) {
            return null;
        }

        const status =
            $("profileAvatarStatus");

        if (status) {
            status.textContent =
                "⏳ در حال آپلود عکس...";
        }

        const formData =
            new FormData();

        formData.append(
            "file",
            selectedProfileAvatarFile
        );

        const response =
            await fetch(
                API +
                "/api/profile/avatar",
                {
                    method: "POST",
                    credentials: "include",
                    cache: "no-store",
                    body: formData
                }
            );

        let data = null;

        try {
            data =
                await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            throw new Error(
                data?.detail ||
                "آپلود عکس پروفایل ناموفق بود"
            );
        }

        const avatar =
            data?.avatar ||
            data?.avatar_url ||
            data?.url ||
            "";

        if (!avatar) {
            throw new Error(
                "آدرس عکس پروفایل دریافت نشد."
            );
        }

        selectedProfileAvatarFile =
            null;

        if (inputExists("profileAvatarInput")) {
            $("profileAvatarInput").value = "";
        }

        if (status) {
            status.textContent =
                "✅ عکس پروفایل ذخیره شد.";
        }

        return avatar;
    }

    function inputExists(id) {
        return !!$(id);
    }

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

                    selectedProfileAvatarFile =
                        null;

                    const input =
                        $("profileAvatarInput");

                    if (input) {
                        input.value = "";
                    }

                    const status =
                        $("profileAvatarStatus");

                    if (status) {
                        status.textContent = "";
                    }

                    modal.classList.add(
                        "show"
                    );
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
            save &&
            modal
        ) {
            save.addEventListener(
                "click",
                saveProfile
            );
        }

        setupProfileAvatar();
    }

    async function saveProfile() {
        const nameInput =
            $("profileDisplayName");

        const bioInput =
            $("profileBio");

        const saveButton =
            $("saveProfileButton");

        try {
            if (saveButton) {
                saveButton.disabled = true;
                saveButton.textContent =
                    "⏳ در حال ذخیره...";
            }

            let uploadedAvatar =
                null;

            if (
                selectedProfileAvatarFile
            ) {
                uploadedAvatar =
                    await uploadProfileAvatar();
            }

            const data =
                await api(
                    "/api/profile",
                    {
                        method: "PUT",

                        body: {
                            display_name:
                                nameInput?.value.trim() ||
                                "",

                            bio:
                                bioInput?.value.trim() ||
                                ""
                        }
                    }
                );

            currentUser =
                data?.user ||
                data ||
                currentUser;

            if (uploadedAvatar) {
                currentUser = {
                    ...currentUser,
                    avatar:
                        uploadedAvatar
                };
            }

            window.GAPINO_CURRENT_USER =
                currentUser;

            renderCurrentUser();

            await loadUsers();

            const modal =
                $("profileModal");

            if (modal) {
                modal.classList.remove(
                    "show"
                );
            }

            showToast(
                "پروفایل با موفقیت ذخیره شد ✅"
            );

        } catch (error) {
            console.error(
                "GAPINO saveProfile:",
                error
            );

            showToast(
                error?.message ||
                "ذخیره پروفایل انجام نشد"
            );

        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent =
                    "💾 ذخیره";
            }
        }
    }

    /* =========================================================
       USERS
       ========================================================= */

    async function loadUsers() {
        const list =
            $("usersList");

        if (!list) {
            return;
        }

        list.innerHTML = `
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
                await api(
                    "/api/users"
                );

            if (
                Array.isArray(data)
            ) {
                users =
                    data;
            } else if (
                Array.isArray(data?.users)
            ) {
                users =
                    data.users;
            } else if (
                Array.isArray(data?.data)
            ) {
                users =
                    data.data;
            } else {
                users = [];
            }

            const myId =
                getUserId(
                    currentUser
                );

            users =
                users.filter(
                    user =>
                        getUserId(user) !==
                        myId
                );

            window.GAPINO_USERS =
                users;

            renderUsers(
                users
            );

        } catch (error) {
            console.error(
                "GAPINO loadUsers:",
                error
            );

            list.innerHTML = `
                <div style="
                    padding:25px;
                    text-align:center;
                    color:#fca5a5;
                    font-size:12px;
                ">
                    دریافت کاربران ناموفق بود.
                    <br>
                    <small>
                        ${escapeHTML(
                            error.message
                        )}
                    </small>
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
            list.innerHTML = `
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
                    ) === id
                ) {
                    item.classList.add(
                        "active"
                    );
                }

                const wrap =
                    document.createElement(
                        "div"
                    );

                wrap.className =
                    "user-avatar-wrap";

                const avatar =
                    document.createElement(
                        "img"
                    );

                avatar.className =
                    "user-avatar";

                avatar.alt =
                    getDisplayName(
                        user
                    );

                const avatarUrl =
                    getAvatarUrl(
                        getAvatar(
                            user
                        )
                    );

                if (avatarUrl) {
                    avatar.src =
                        avatarUrl;

                    avatar.style.visibility =
                        "visible";
                } else {
                    avatar.style.visibility =
                        "hidden";
                }

                avatar.addEventListener(
                    "error",
                    () => {
                        avatar.style.visibility =
                            "hidden";
                    }
                );

                const dot =
                    document.createElement(
                        "span"
                    );

                dot.className =
                    "online-dot";

                if (
                    isOnline(user)
                ) {
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
                    document.createElement(
                        "div"
                    );

                info.className =
                    "user-info";

                const name =
                    document.createElement(
                        "div"
                    );

                name.className =
                    "user-name";

                name.textContent =
                    getDisplayName(
                        user
                    );

                const status =
                    document.createElement(
                        "div"
                    );

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
                    renderUsers(
                        users
                    );
                    return;
                }

                const filtered =
                    users.filter(
                        user => {

                            const name =
                                getDisplayName(
                                    user
                                )
                                    .toLowerCase();

                            const username =
                                String(
                                    user.username ||
                                    ""
                                )
                                    .toLowerCase();

                            return (
                                name.includes(
                                    text
                                ) ||
                                username.includes(
                                    text
                                )
                            );
                        }
                    );

                renderUsers(
                    filtered
                );
            }
        );
    }

    /* =========================================================
       CHAT
       ========================================================= */

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
                    isOnline(
                        currentChatUser
                    )
                        ? "آنلاین"
                        : "آفلاین"
                );
        }

        if (avatar) {

            const url =
                getAvatarUrl(
                    getAvatar(
                        currentChatUser
                    )
                );

            if (url) {

                avatar.src =
                    url;

                avatar.style.visibility =
                    "visible";

            } else {

                avatar.removeAttribute(
                    "src"
                );

                avatar.style.visibility =
                    "hidden";
            }
        }
    }

    function enableComposer() {
        const input =
            $("messageInput");

        if (input) {
            input.disabled = false;
        }
    }

    /* =========================================================
       MESSAGES
       ========================================================= */

    async function loadMessages(
        otherId
    ) {
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
                    `/api/messages/${encodeURIComponent(
                        otherId
                    )}`
                );

            if (
                Array.isArray(data)
            ) {
                messagesCache =
                    data;
            } else if (
                Array.isArray(
                    data?.messages
                )
            ) {
                messagesCache =
                    data.messages;
            } else if (
                Array.isArray(
                    data?.data
                )
            ) {
                messagesCache =
                    data.data;
            } else {
                messagesCache = [];
            }

            renderMessages(
                messagesCache
            );

        } catch (error) {

            console.error(
                "GAPINO loadMessages:",
                error
            );

            if (container) {
                container.innerHTML = `
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

    function renderMessages(
        messages
    ) {
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

        const myId =
            getUserId(
                currentUser
            );

        messages.forEach(
            message => {

                const senderId =
                    Number(
                        message.sender_id ??
                        message.from_id ??
                        message.sender ??
                        0
                    );

                const mine =
                    senderId === myId;

                const row =
                    document.createElement(
                        "div"
                    );

                row.className =
                    "message-row " +
                    (
                        mine
                            ? "mine"
                            : "other"
                    );

                const bubble =
                    document.createElement(
                        "div"
                    );

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
                        document.createElement(
                            "img"
                        );

                    image.src =
                        getAvatarUrl(
                            message.file_url
                        );

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
                        document.createElement(
                            "audio"
                        );

                    audio.controls =
                        true;

                    audio.src =
                        getAvatarUrl(
                            message.file_url
                        );

                    bubble.appendChild(
                        audio
                    );

                } else if (
                    type === "video" &&
                    message.file_url
                ) {

                    const video =
                        document.createElement(
                            "video"
                        );

                    video.controls =
                        true;

                    video.playsInline =
                        true;

                    video.src =
                        getAvatarUrl(
                            message.file_url
                        );

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
                        document.createElement(
                            "a"
                        );

                    link.href =
                        getAvatarUrl(
                            message.file_url
                        );

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
                            document.createElement(
                                "div"
                            );

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
                    document.createElement(
                        "div"
                    );

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

            setTimeout(
                () => {
                    messagesContainer.scrollTop =
                        messagesContainer.scrollHeight;
                },
                0
            );
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
                                receiverId,

                            text:
                                text
                        }
                    }
                );

            input.value =
                "";

            sendTyping(
                false
            );

            const message =
                data?.message ||
                data;

            if (
                message &&
                (
                    message.id ||
                    message.message_id ||
                    message.text
                )
            ) {

                messagesCache.push(
                    message
                );

                renderMessages(
                    messagesCache
                );

            } else {

                await loadMessages(
                    receiverId
                );
            }

        } catch (error) {

            console.error(
                "GAPINO sendMessage:",
                error
            );

            showToast(
                "ارسال پیام انجام نشد"
            );
        }
    }

    /* =========================================================
       TYPING
       ========================================================= */

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

        try {

            socket.send(
                JSON.stringify({
                    type:
                        "typing",

                    receiver_id:
                        receiverId,

                    value:
                        state
                })
            );

        } catch (error) {

            console.error(
                "GAPINO typing:",
                error
            );
        }
    }

    function handleTypingEvent(
        data
    ) {

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

    /* =========================================================
       WEBSOCKET
       ========================================================= */

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
                "GAPINO WebSocket create:",
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

                window.GAPINO_WS_CONNECTED =
                    true;

                reconnectDelay =
                    1500;

                try {

                    socket.send(
                        JSON.stringify({
                            type:
                                "ping"
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

                console.warn(
                    "GAPINO WebSocket disconnected"
                );

                window.GAPINO_WS_CONNECTED =
                    false;

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

    function handleSocketMessage(
        raw
    ) {

        let data = null;

        try {

            data =
                JSON.parse(raw);

        } catch {

            console.warn(
                "GAPINO invalid WS data:",
                raw
            );

            return;
        }

        if (!data) {
            return;
        }

        switch (data.type) {

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

            /*
             * فقط call.js این رویدادها را می‌گیرد.
             */

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
                            detail:
                                data
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
                        getUserId(user) ===
                        id
                    ) {

                        return {
                            ...user,

                            online:
                                Boolean(
                                    online
                                ),

                            is_online:
                                Boolean(
                                    online
                                )
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
                    Boolean(
                        online
                    ),

                is_online:
                    Boolean(
                        online
                    )
            };

            updateChatHeader();
        }
    }

    function handleIncomingMessage(
        data
    ) {

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

        const currentId =
            currentChatUser
                ? getUserId(
                    currentChatUser
                )
                : null;

        const belongs =
            currentId !== null &&
            (
                senderId === currentId ||

                (
                    receiverId ===
                        currentId &&
                    senderId === myId
                )
            );

        if (!belongs) {

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

    /* =========================================================
       MESSAGE INPUT
       ========================================================= */

    function setupMessageInput() {

        const input =
            $("messageInput");

        const button =
            $("sendButton");

        if (button) {

            button.addEventListener(
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
                    event.key ===
                    "Enter"
                ) {

                    event.preventDefault();

                    sendMessage();
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

    /* =========================================================
       FILE ATTACHMENT
       ========================================================= */

    function setupAttachment() {

        const attach =
            $("attachButton");

        const input =
            $("fileInput");

        const remove =
            $("removeAttachmentButton");

        if (
            attach &&
            input
        ) {

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

        if (remove) {

            remove.addEventListener(
                "click",
                () => {

                    selectedFile =
                        null;

                    if (input) {
                        input.value =
                            "";
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

    /* =========================================================
       VOICE MESSAGE
       ========================================================= */

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
                "ضبط صدا در این دستگاه در دسترس نیست"
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

            isRecording =
                true;

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
                            track => {
                                try {
                                    track.stop();
                                } catch {}
                            }
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
                        !recordingChunks.length
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
                            "GAPINO voice:",
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
                "GAPINO recording:",
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

        const response =
            await fetch(
                API +
                "/api/upload",
                {
                    method:
                        "POST",

                    credentials:
                        "include",

                    cache:
                        "no-store",

                    body:
                        formData
                }
            );

        let data = null;

        try {
            data =
                await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {

            throw new Error(
                data?.detail ||
                "آپلود صدا ناموفق بود"
            );
        }

        const fileUrl =
            data.url ||
            data.file_url ||
            data.path;

        if (!fileUrl) {

            throw new Error(
                "آدرس فایل دریافت نشد"
            );
        }

        await api(
            "/api/messages",
            {
                method:
                    "POST",

                body: {
                    receiver_id:
                        getUserId(
                            currentChatUser
                        ),

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
            getUserId(
                currentChatUser
            )
        );
    }

    /* =========================================================
       MESSAGE SEARCH
       ========================================================= */

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

                    input?.focus();
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
                                    .includes(
                                        text
                                    )
                        );

                    if (!found.length) {

                        results.innerHTML = `
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

    /* =========================================================
       LOGOUT
       ========================================================= */

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
                            method:
                                "POST"
                        }
                    );

                } catch (error) {

                    console.warn(
                        "GAPINO logout:",
                        error
                    );
                }

                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch {}

                if (socket) {

                    try {
                        socket.close();
                    } catch {}
                }

                window.location.href =
                    "/login.html";
            }
        );
    }

    /* =========================================================
       MOBILE BACK
       ========================================================= */

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

                window.GAPINO_CURRENT_CHAT =
                    null;

                const input =
                    $("messageInput");

                if (input) {
                    input.disabled =
                        true;

                    input.value =
                        "";
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

    /* =========================================================
       MENU / LIVE
       ========================================================= */

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

    function setupLiveButtons() {

        const liveButton =
            $("liveButton");

        const headerLiveButton =
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

        if (headerLiveButton) {

            headerLiveButton.addEventListener(
                "click",
                () => {
                    location.href =
                        "/live.html";
                }
            );
        }
    }

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

                    try {
                        window.GAPINO_REFRESH_LIVES();
                    } catch (error) {
                        console.error(
                            "GAPINO refresh lives:",
                            error
                        );
                    }
                }
            );
        }
    }

    /* =========================================================
       REFRESH
       ========================================================= */

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
                } catch {}

            },
            10000
        );

        setInterval(
            async () => {

                if (
                    typeof window.GAPINO_REFRESH_LIVES !==
                        "function"
                ) {
                    return;
                }

                try {
                    await window.GAPINO_REFRESH_LIVES();
                } catch {}

            },
            10000
        );
    }

    /* =========================================================
       BOOT
       ========================================================= */

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

            await loadUsers();

            connectWebSocket();

            startRefreshTimers();

            const input =
                $("messageInput");

            if (input) {
                input.disabled =
                    true;
            }

            console.log(
                "GAPINO chat loaded successfully"
            );

        } catch (error) {

            console.error(
                "GAPINO boot:",
                error
            );

            showToast(
                "خطا در بارگذاری گپینو"
            );

            if (
                String(
                    error?.message ||
                    ""
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

    window.GAPINO_CURRENT_USER =
        null;

    window.GAPINO_CURRENT_CHAT =
        null;

    window.GAPINO_USERS =
        [];

    window.GAPINO_WS_CONNECTED =
        false;

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            boot,
            {
                once: true
            }
        );

    } else {

        boot();
    }

})();
