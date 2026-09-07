"use strict";

(() => {
    let pc = null;
    let localStream = null;
    let remoteStream = null;
    let remoteAudio = null;

    let callTarget = null;
    let callId = null;

    let outgoing = false;
    let inCall = false;

    let pendingOffer = null;
    let pendingIce = [];

    let initialized = false;
    let buttonBound = false;

    const STUN_SERVERS = [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        }
    ];

    function $(id) {
        return document.getElementById(id);
    }

    function getUser() {
        return window.GAPINO?.currentUser || null;
    }

    function getChatUser() {
        return window.GAPINO?.currentChatUser || null;
    }

    function getSocket() {
        return window.GAPINO?.socket ||
            window.GAPINO_SOCKET ||
            null;
    }

    function uid(user) {
        return String(
            user?.id ??
            user?.user_id ??
            user?.uid ??
            ""
        );
    }

    function uname(user) {
        return (
            user?.display_name ||
            user?.full_name ||
            user?.name ||
            user?.username ||
            "کاربر"
        );
    }

    function showToast(text) {
        const container = $("toastContainer");

        if (!container) {
            console.log("GAPINO:", text);
            return;
        }

        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = text;

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 6000);
    }

    function showError(title, error) {
        const name = error?.name || "Error";
        const message =
            error?.message ||
            String(error || "خطای نامشخص");

        console.error(
            "GAPINO CALL ERROR:",
            title,
            {
                name,
                message,
                error
            }
        );

        showToast(
            `${title}: ${name} - ${message}`
        );
    }

    function getSocketState() {
        const ws = getSocket();

        if (!ws) {
            return "missing";
        }

        switch (ws.readyState) {
            case WebSocket.CONNECTING:
                return "connecting";
            case WebSocket.OPEN:
                return "open";
            case WebSocket.CLOSING:
                return "closing";
            case WebSocket.CLOSED:
                return "closed";
            default:
                return "unknown";
        }
    }

    function send(data) {
        const ws = getSocket();

        console.log(
            "GAPINO CALL SEND:",
            data
        );

        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN
        ) {
            showToast(
                `اتصال تماس برقرار نیست (${getSocketState()})`
            );
            return false;
        }

        try {
            ws.send(
                JSON.stringify(data)
            );

            return true;

        } catch (error) {

            showError(
                "ارسال سیگنال تماس ناموفق بود",
                error
            );

            return false;
        }
    }

    function createCallId() {
        try {
            if (
                window.crypto &&
                typeof window.crypto.randomUUID ===
                    "function"
            ) {
                return window.crypto.randomUUID();
            }
        } catch (_) {}

        return (
            Date.now().toString(36) +
            "-" +
            Math.random()
                .toString(36)
                .slice(2)
        );
    }

    /* =========================================================
       UI
       ========================================================= */

    function installStyle() {
        if ($("gapinoCallStyles")) {
            return;
        }

        const style = document.createElement("style");

        style.id = "gapinoCallStyles";

        style.textContent = `
            #gapinoCallOverlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: rgba(0,0,0,.80);
            }

            #gapinoCallOverlay.show {
                display: flex;
            }

            .gapino-call-card {
                width: min(390px,100%);
                padding: 25px 18px 18px;
                border-radius: 24px;
                background: #111827;
                color: #fff;
                text-align: center;
                box-shadow: 0 25px 80px rgba(0,0,0,.55);
            }

            .gapino-call-avatar {
                width: 88px;
                height: 88px;
                margin: 0 auto 14px;
                border-radius: 50%;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #2563eb;
                font-size: 32px;
                font-weight: 900;
            }

            .gapino-call-avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .gapino-call-name {
                font-size: 19px;
                font-weight: 900;
            }

            .gapino-call-status {
                margin-top: 8px;
                color: #94a3b8;
                font-size: 13px;
            }

            .gapino-call-actions {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 8px;
                margin-top: 20px;
            }

            .gapino-call-btn {
                min-width: 120px;
                min-height: 45px;
                padding: 9px 14px;
                border: 0;
                border-radius: 12px;
                color: #fff;
                font-weight: 900;
                cursor: pointer;
            }

            .gapino-call-btn.accept {
                background: #16a34a;
            }

            .gapino-call-btn.reject {
                background: #dc2626;
            }

            @media (max-width:430px) {
                .gapino-call-btn {
                    width: 100%;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function createUI() {
        installStyle();

        if ($("gapinoCallOverlay")) {
            return;
        }

        const overlay =
            document.createElement("div");

        overlay.id =
            "gapinoCallOverlay";

        overlay.innerHTML = `
            <div class="gapino-call-card">

                <div
                    id="gapinoCallAvatar"
                    class="gapino-call-avatar"
                >G</div>

                <div
                    id="gapinoCallName"
                    class="gapino-call-name"
                >کاربر</div>

                <div
                    id="gapinoCallStatus"
                    class="gapino-call-status"
                >تماس صوتی</div>

                <div class="gapino-call-actions">

                    <button
                        id="gapinoAcceptCall"
                        class="gapino-call-btn accept"
                        type="button"
                    >
                        📞 پاسخ
                    </button>

                    <button
                        id="gapinoRejectCall"
                        class="gapino-call-btn reject"
                        type="button"
                    >
                        ❌ رد
                    </button>

                    <button
                        id="gapinoEndCall"
                        class="gapino-call-btn reject"
                        type="button"
                    >
                        ☎️ قطع تماس
                    </button>

                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        $("gapinoAcceptCall")?.addEventListener(
            "click",
            acceptCall
        );

        $("gapinoRejectCall")?.addEventListener(
            "click",
            rejectCall
        );

        $("gapinoEndCall")?.addEventListener(
            "click",
            () => endCall(true, true)
        );
    }

    function showUI(user, status) {
        createUI();

        const overlay = $("gapinoCallOverlay");
        const avatar = $("gapinoCallAvatar");
        const name = $("gapinoCallName");
        const statusEl = $("gapinoCallStatus");

        if (!overlay) {
            return;
        }

        overlay.classList.add("show");

        const displayName = uname(user);

        if (name) {
            name.textContent = displayName;
        }

        if (statusEl) {
            statusEl.textContent = status;
        }

        if (avatar) {
            avatar.innerHTML = "";

            const url =
                user?.avatar ||
                user?.avatar_url ||
                "";

            if (url) {
                const img =
                    document.createElement("img");

                img.src = url;
                img.alt = displayName;

                img.onerror = () => {
                    avatar.innerHTML = "";
                    avatar.textContent =
                        displayName.charAt(0) || "G";
                };

                avatar.appendChild(img);

            } else {
                avatar.textContent =
                    displayName.charAt(0) || "G";
            }
        }

        const incoming =
            status.includes("ورودی");

        const connected =
            status.includes("مکالمه");

        const accept =
            $("gapinoAcceptCall");

        const reject =
            $("gapinoRejectCall");

        const end =
            $("gapinoEndCall");

        if (accept) {
            accept.style.display =
                incoming ? "block" : "none";
        }

        if (reject) {
            reject.style.display =
                connected ? "none" : "block";
        }

        if (end) {
            end.style.display =
                connected ? "block" : "none";
        }
    }

    function hideUI() {
        const overlay =
            $("gapinoCallOverlay");

        if (overlay) {
            overlay.classList.remove("show");
        }
    }

    /* =========================================================
       MICROPHONE
       ========================================================= */

    async function testMicrophone() {
        console.log(
            "GAPINO microphone test started"
        );

        console.log(
            "secure:",
            window.isSecureContext
        );

        console.log(
            "mediaDevices:",
            !!navigator.mediaDevices
        );

        if (!window.isSecureContext) {
            throw new Error(
                "صفحه امن نیست. تماس باید از HTTPS اجرا شود."
            );
        }

        if (!navigator.mediaDevices) {
            throw new Error(
                "navigator.mediaDevices در این WebView وجود ندارد."
            );
        }

        if (!navigator.mediaDevices.getUserMedia) {
            throw new Error(
                "getUserMedia در این WebView در دسترس نیست."
            );
        }

        try {

            const stream =
                await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    },
                    video: false
                });

            const tracks =
                stream.getAudioTracks();

            console.log(
                "GAPINO microphone tracks:",
                tracks
            );

            if (!tracks.length) {

                stream.getTracks().forEach(
                    track => track.stop()
                );

                throw new Error(
                    "میکروفون Track صوتی ایجاد نکرد."
                );
            }

            return stream;

        } catch (error) {

            console.error(
                "GAPINO getUserMedia ERROR:",
                {
                    name: error?.name,
                    message: error?.message,
                    constraint: error?.constraint,
                    error
                }
            );

            throw error;
        }
    }

    /* =========================================================
       PEER
       ========================================================= */

    function createPeer(targetId) {

        if (!window.RTCPeerConnection) {
            throw new Error(
                "RTCPeerConnection در WebView موجود نیست."
            );
        }

        if (pc) {
            try {
                pc.close();
            } catch (_) {}
        }

        const turn =
            Array.isArray(
                window.GAPINO_TURN_SERVERS
            )
                ? window.GAPINO_TURN_SERVERS
                : [];

        pc =
            new RTCPeerConnection({
                iceServers: [
                    ...STUN_SERVERS,
                    ...turn
                ],
                iceCandidatePoolSize: 10
            });

        pc.onicecandidate =
            event => {

                if (
                    !event.candidate ||
                    !targetId
                ) {
                    return;
                }

                send({
                    type: "call_ice",
                    receiver_id: Number(targetId),
                    call_id: callId,
                    candidate: event.candidate
                });
            };

        pc.ontrack =
            event => {

                console.log(
                    "GAPINO remote track"
                );

                remoteStream =
                    event.streams?.[0] || null;

                if (!remoteStream) {
                    console.warn(
                        "GAPINO remote stream not found"
                    );
                    return;
                }

                if (!remoteAudio) {

                    remoteAudio =
                        document.createElement("audio");

                    remoteAudio.autoplay = true;
                    remoteAudio.playsInline = true;
                    remoteAudio.controls = false;
                    remoteAudio.muted = false;
                    remoteAudio.volume = 1;

                    remoteAudio.style.position =
                        "fixed";

                    remoteAudio.style.left =
                        "-9999px";

                    document.body.appendChild(
                        remoteAudio
                    );
                }

                remoteAudio.srcObject =
                    remoteStream;

                try {
                    const playResult =
                        remoteAudio.play();

                    if (
                        playResult &&
                        typeof playResult.catch ===
                            "function"
                    ) {
                        playResult.catch(
                            error => {
                                console.warn(
                                    "GAPINO remote audio play:",
                                    error
                                );
                            }
                        );
                    }
                } catch (error) {
                    console.warn(
                        "GAPINO audio play error:",
                        error
                    );
                }
            };

        pc.onconnectionstatechange =
            () => {

                if (!pc) {
                    return;
                }

                const state =
                    pc.connectionState;

                console.log(
                    "GAPINO WebRTC state:",
                    state
                );

                if (state === "new") {
                    showUI(
                        callTarget,
                        "🔄 آماده اتصال..."
                    );
                }

                if (state === "connecting") {
                    showUI(
                        callTarget,
                        "🔄 در حال اتصال..."
                    );
                }

                if (state === "connected") {

                    inCall = true;

                    showUI(
                        callTarget,
                        "🟢 در حال مکالمه"
                    );
                }

                if (state === "disconnected") {

                    showUI(
                        callTarget,
                        "⚠️ ارتباط ناپایدار"
                    );
                }

                if (state === "failed") {

                    showUI(
                        callTarget,
                        "❌ اتصال تماس برقرار نشد"
                    );

                    showToast(
                        "اتصال WebRTC برقرار نشد."
                    );
                }

                if (state === "closed") {
                    console.log(
                        "GAPINO WebRTC closed"
                    );
                }
            };

        pc.oniceconnectionstatechange =
            () => {

                if (!pc) {
                    return;
                }

                console.log(
                    "GAPINO ICE state:",
                    pc.iceConnectionState
                );

                if (
                    pc.iceConnectionState ===
                    "checking"
                ) {
                    showUI(
                        callTarget,
                        "🌐 بررسی اتصال شبکه..."
                    );
                }

                if (
                    pc.iceConnectionState ===
                    "connected"
                ) {
                    showUI(
                        callTarget,
                        "🟢 در حال مکالمه"
                    );
                }

                if (
                    pc.iceConnectionState ===
                    "failed"
                ) {
                    showUI(
                        callTarget,
                        "❌ اتصال شبکه تماس برقرار نشد"
                    );

                    showToast(
                        "ICE نتوانست مسیر صوتی پیدا کند."
                    );
                }
            };

        pc.onsignalingstatechange =
            () => {
                if (!pc) {
                    return;
                }

                console.log(
                    "GAPINO signaling state:",
                    pc.signalingState
                );
            };

        return pc;
    }

    async function addLocalStream() {

        if (!pc) {
            throw new Error(
                "PeerConnection ساخته نشده."
            );
        }

        if (!localStream) {
            localStream =
                await testMicrophone();
        }

        localStream
            .getTracks()
            .forEach(track => {

                const exists =
                    pc.getSenders()
                        .some(
                            sender =>
                                sender.track === track
                        );

                if (!exists) {
                    pc.addTrack(
                        track,
                        localStream
                    );
                }
            });
    }

    /* =========================================================
       OUTGOING
       ========================================================= */

    async function startCall() {

        const target =
            getChatUser();

        if (!target) {
            showToast(
                "ابتدا یک کاربر را انتخاب کن."
            );
            return;
        }

        if (pc || inCall) {
            showToast(
                "یک تماس در حال اجراست."
            );
            return;
        }

        const ws =
            getSocket();

        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN
        ) {
            showToast(
                "WebSocket هنوز متصل نشده."
            );
            return;
        }

        try {

            callTarget = target;

            callId = createCallId();

            outgoing = true;
            inCall = false;

            pendingIce = [];

            showUI(
                target,
                "📤 در حال دسترسی به میکروفون..."
            );

            localStream =
                await testMicrophone();

            showUI(
                target,
                "📤 در حال ایجاد تماس..."
            );

            createPeer(
                uid(target)
            );

            await addLocalStream();

            const offer =
                await pc.createOffer({
                    offerToReceiveAudio: true
                });

            await pc.setLocalDescription(
                offer
            );

            const sent =
                send({
                    type: "call_offer",
                    receiver_id:
                        Number(uid(target)),
                    call_id:
                        callId,
                    offer:
                        pc.localDescription
                });

            if (!sent) {
                throw new Error(
                    "call_offer ارسال نشد."
                );
            }

            showUI(
                target,
                "📤 در انتظار پاسخ..."
            );

        } catch (error) {

            showError(
                "ایجاد تماس ناموفق بود",
                error
            );

            cleanup();
        }
    }

    /* =========================================================
       INCOMING
       ========================================================= */

    async function handleOffer(data) {

        console.log(
            "GAPINO CALL OFFER RECEIVED:",
            data
        );

        if (pc || inCall) {

            send({
                type: "call_busy",
                receiver_id:
                    Number(data.sender_id),
                call_id:
                    data.call_id || ""
            });

            return;
        }

        const senderId =
            String(
                data.sender_id ??
                data.user_id ??
                data.from_id ??
                ""
            );

        if (!senderId) {
            console.error(
                "GAPINO call_offer sender id missing",
                data
            );
            return;
        }

        if (!data.offer) {
            console.error(
                "GAPINO call_offer offer missing",
                data
            );
            return;
        }

        const users =
            Array.isArray(
                window.GAPINO?.users
            )
                ? window.GAPINO.users
                : [];

        callTarget =
            users.find(
                user =>
                    uid(user) === senderId
            ) || {
                id: senderId,
                display_name:
                    "کاربر گپینو"
            };

        callId =
            String(
                data.call_id || createCallId()
            );

        outgoing = false;
        inCall = false;

        pendingOffer = data.offer;
        pendingIce = [];

        showUI(
            callTarget,
            "📞 تماس ورودی"
        );
    }

    /* =========================================================
       ACCEPT
       ========================================================= */

    async function acceptCall() {

        console.log(
            "GAPINO ACCEPT CLICK",
            {
                pendingOffer,
                callTarget,
                callId,
                socketState:
                    getSocketState()
            }
        );

        if (!pendingOffer) {
            showToast(
                "اطلاعات تماس ورودی پیدا نشد."
            );
            return;
        }

        if (!callTarget) {
            showToast(
                "اطلاعات تماس‌گیرنده پیدا نشد."
            );
            return;
        }

        const ws =
            getSocket();

        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN
        ) {
            showToast(
                `اتصال تماس برقرار نیست (${getSocketState()})`
            );
            return;
        }

        try {

            showUI(
                callTarget,
                "🔄 در حال دسترسی به میکروفون..."
            );

            localStream =
                await testMicrophone();

            console.log(
                "GAPINO ACCEPT microphone OK"
            );

            showUI(
                callTarget,
                "🔄 در حال آماده‌سازی تماس..."
            );

            createPeer(
                uid(callTarget)
            );

            await addLocalStream();

            console.log(
                "GAPINO ACCEPT setting remote offer",
                pendingOffer
            );

            const offerDescription =
                pendingOffer.type &&
                pendingOffer.sdp
                    ? pendingOffer
                    : {
                        type: "offer",
                        sdp:
                            pendingOffer.sdp ||
                            pendingOffer
                    };

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    offerDescription
                )
            );

            console.log(
                "GAPINO ACCEPT remote description set"
            );

            await flushIce();

            const answer =
                await pc.createAnswer({
                    offerToReceiveAudio: true
                });

            console.log(
                "GAPINO ACCEPT answer created",
                answer
            );

            await pc.setLocalDescription(
                answer
            );

            console.log(
                "GAPINO ACCEPT local description set",
                pc.localDescription
            );

            const answerPayload = {
                type: "call_answer",
                receiver_id:
                    Number(uid(callTarget)),
                call_id:
                    callId,
                answer:
                    pc.localDescription
            };

            console.log(
                "GAPINO ACCEPT sending answer",
                answerPayload
            );

            const sent =
                send(answerPayload);

            if (!sent) {
                throw new Error(
                    "call_answer ارسال نشد."
                );
            }

            pendingOffer = null;

            showUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "GAPINO ACCEPT ERROR FULL:",
                error
            );

            showError(
                "پاسخ تماس ناموفق بود",
                error
            );

            cleanup();
        }
    }

    /* =========================================================
       ANSWER
       ========================================================= */

    async function handleAnswer(data) {

        console.log(
            "GAPINO CALL ANSWER RECEIVED:",
            data
        );

        if (!pc) {
            console.warn(
                "GAPINO answer received without peer"
            );
            return;
        }

        if (
            data.call_id &&
            String(data.call_id) !==
                String(callId)
        ) {
            console.warn(
                "GAPINO answer call_id mismatch",
                {
                    local: callId,
                    remote: data.call_id
                }
            );
            return;
        }

        if (!data.answer) {
            console.warn(
                "GAPINO answer missing"
            );
            return;
        }

        try {

            const answerDescription =
                data.answer.type &&
                data.answer.sdp
                    ? data.answer
                    : {
                        type: "answer",
                        sdp:
                            data.answer.sdp ||
                            data.answer
                    };

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    answerDescription
                )
            );

            await flushIce();

            showUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {

            showError(
                "ثبت پاسخ تماس ناموفق بود",
                error
            );
        }
    }

    /* =========================================================
       ICE
       ========================================================= */

    async function handleIce(data) {

        console.log(
            "GAPINO CALL ICE RECEIVED:",
            data
        );

        if (!data.candidate) {
            return;
        }

        if (
            data.call_id &&
            callId &&
            String(data.call_id) !==
                String(callId)
        ) {
            return;
        }

        if (
            !pc ||
            !pc.remoteDescription
        ) {

            pendingIce.push(
                data.candidate
            );

            return;
        }

        try {

            await pc.addIceCandidate(
                new RTCIceCandidate(
                    data.candidate
                )
            );

        } catch (error) {

            console.warn(
                "GAPINO ICE error:",
                error
            );
        }
    }

    async function flushIce() {

        if (
            !pc ||
            !pc.remoteDescription
        ) {
            return;
        }

        const list =
            pendingIce.splice(0);

        for (
            const candidate
            of list
        ) {

            try {

                await pc.addIceCandidate(
                    new RTCIceCandidate(
                        candidate
                    )
                );

            } catch (error) {

                console.warn(
                    "GAPINO ICE flush:",
                    error
                );
            }
        }
    }

    /* =========================================================
       CONTROL
       ========================================================= */

    function rejectCall() {

        if (callTarget) {

            send({
                type: "call_reject",
                receiver_id:
                    Number(uid(callTarget)),
                call_id:
                    callId
            });
        }

        cleanup();

        showToast(
            "تماس رد شد."
        );
    }

    function handleReject() {

        cleanup();

        showToast(
            "تماس رد شد."
        );
    }

    function handleBusy() {

        cleanup();

        showToast(
            "کاربر در حال تماس است."
        );
    }

    function handleRemoteEnd() {

        cleanup();

        showToast(
            "طرف مقابل تماس را پایان داد."
        );
    }

    function endCall(
        notifyRemote = true,
        showMessage = true
    ) {

        if (
            notifyRemote &&
            callTarget
        ) {

            send({
                type: "call_end",
                receiver_id:
                    Number(uid(callTarget)),
                call_id:
                    callId
            });
        }

        cleanup();

        if (showMessage) {
            showToast(
                "تماس پایان یافت."
            );
        }
    }

    /* =========================================================
       CLEANUP
       ========================================================= */

    function cleanup() {

        console.log(
            "GAPINO CALL CLEANUP"
        );

        if (pc) {

            try {
                pc.onicecandidate = null;
                pc.ontrack = null;
                pc.onconnectionstatechange = null;
                pc.oniceconnectionstatechange = null;
                pc.onsignalingstatechange = null;

                pc.close();
            } catch (_) {}

            pc = null;
        }

        if (localStream) {

            localStream
                .getTracks()
                .forEach(track => {
                    try {
                        track.stop();
                    } catch (_) {}
                });
        }

        localStream = null;

        if (remoteAudio) {

            try {
                remoteAudio.pause();
            } catch (_) {}

            remoteAudio.srcObject = null;
        }

        remoteStream = null;

        pendingOffer = null;
        pendingIce = [];

        callTarget = null;
        callId = null;

        outgoing = false;
        inCall = false;

        hideUI();
    }

    /* =========================================================
       EVENT BRIDGE
       ========================================================= */

    function handleCallEvent(data) {

        console.log(
            "GAPINO CALL EVENT:",
            data
        );

        if (
            !data ||
            !data.type
        ) {
            return;
        }

        switch (data.type) {

            case "call_offer":
                handleOffer(data);
                break;

            case "call_answer":
                handleAnswer(data);
                break;

            case "call_ice":
                handleIce(data);
                break;

            case "call_reject":
                handleReject();
                break;

            case "call_busy":
                handleBusy();
                break;

            case "call_end":
                handleRemoteEnd();
                break;

            default:
                console.log(
                    "GAPINO unknown call event:",
                    data.type
                );
                break;
        }
    }

    document.addEventListener(
        "gapino-call-event",
        event => {
            handleCallEvent(
                event.detail
            );
        }
    );

    window.addEventListener(
        "gapino:call",
        event => {
            handleCallEvent(
                event.detail
            );
        }
    );

    /* =========================================================
       BUTTON
       ========================================================= */

    function bindCallButton() {

        const button =
            $("callButton");

        if (
            !button ||
            buttonBound
        ) {
            return;
        }

        buttonBound = true;

        button.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();

                startCall();
            }
        );
    }

    /* =========================================================
       PUBLIC
       ========================================================= */

    window.GAPINO_CALL_START =
        startCall;

    window.GAPINO_CALL_END =
        () =>
            endCall(
                true,
                true
            );

    window.GAPINO_CALL_HANDLE_EVENT =
        handleCallEvent;

    window.GAPINO_CALL = {

        start:
            startCall,

        end:
            () =>
                endCall(
                    true,
                    true
                ),

        accept:
            acceptCall,

        reject:
            rejectCall
    };

    /* =========================================================
       INIT
       ========================================================= */

    function init() {

        if (initialized) {
            return;
        }

        initialized = true;

        createUI();
        bindCallButton();

        console.log(
            "GAPINO voice call fixed diagnostic version loaded"
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
                once: true
            }
        );

    } else {

        init();
    }

})();