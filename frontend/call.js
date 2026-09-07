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

    function getChatUser() {
        return window.GAPINO?.currentChatUser || null;
    }

    function getSocket() {
        return (
            window.GAPINO?.socket ||
            window.GAPINO_SOCKET ||
            null
        );
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
        }, 5000);
    }

    function showError(title, error) {
        console.error(
            "GAPINO CALL ERROR:",
            title,
            error
        );

        const name =
            error?.name ||
            "Error";

        const message =
            error?.message ||
            String(error || "خطای نامشخص");

        showToast(
            `${title}: ${name} - ${message}`
        );
    }

    function socketIsOpen() {
        const ws = getSocket();

        return !!(
            ws &&
            ws.readyState === WebSocket.OPEN
        );
    }

    function send(data) {
        const ws = getSocket();

        console.log(
            "GAPINO CALL SEND:",
            data
        );

        if (!ws) {
            showToast(
                "WebSocket تماس پیدا نشد."
            );
            return false;
        }

        if (
            ws.readyState !==
            WebSocket.OPEN
        ) {
            showToast(
                "اتصال WebSocket تماس برقرار نیست."
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

        const style =
            document.createElement("style");

        style.id =
            "gapinoCallStyles";

        style.textContent = `
            #gapinoCallOverlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: rgba(0,0,0,.82);
            }

            #gapinoCallOverlay.show {
                display: flex;
            }

            .gapino-call-card {
                width: min(390px, 100%);
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

            .gapino-call-btn.reject,
            .gapino-call-btn.end {
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
                        class="gapino-call-btn end"
                        type="button"
                    >
                        ☎️ قطع تماس
                    </button>

                </div>
            </div>
        `;

        document.body.appendChild(
            overlay
        );

        const accept =
            $("gapinoAcceptCall");

        const reject =
            $("gapinoRejectCall");

        const end =
            $("gapinoEndCall");

        accept?.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();
                acceptCall();
            }
        );

        reject?.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();
                rejectCall();
            }
        );

        end?.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();
                endCall(true, true);
            }
        );
    }

    function showUI(user, status) {
        createUI();

        const overlay =
            $("gapinoCallOverlay");

        const avatar =
            $("gapinoCallAvatar");

        const name =
            $("gapinoCallName");

        const statusEl =
            $("gapinoCallStatus");

        if (!overlay) {
            return;
        }

        overlay.classList.add("show");

        const displayName =
            uname(user);

        if (name) {
            name.textContent =
                displayName;
        }

        if (statusEl) {
            statusEl.textContent =
                status;
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
                        displayName.charAt(0) ||
                        "G";
                };

                avatar.appendChild(img);

            } else {
                avatar.textContent =
                    displayName.charAt(0) ||
                    "G";
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

    async function getMicrophone() {
        console.log(
            "GAPINO microphone request"
        );

        if (!window.isSecureContext) {
            throw new Error(
                "صفحه امن نیست. HTTPS مورد نیاز است."
            );
        }

        if (!navigator.mediaDevices) {
            throw new Error(
                "mediaDevices در این WebView وجود ندارد."
            );
        }

        if (
            !navigator.mediaDevices.getUserMedia
        ) {
            throw new Error(
                "getUserMedia در این WebView وجود ندارد."
            );
        }

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

        if (!tracks.length) {
            stream.getTracks().forEach(
                track => track.stop()
            );

            throw new Error(
                "Track صوتی از میکروفون دریافت نشد."
            );
        }

        console.log(
            "GAPINO microphone OK",
            tracks
        );

        return stream;
    }

    /* =========================================================
       PEER CONNECTION
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

        const turnServers =
            Array.isArray(
                window.GAPINO_TURN_SERVERS
            )
                ? window.GAPINO_TURN_SERVERS
                : [];

        pc =
            new RTCPeerConnection({
                iceServers: [
                    ...STUN_SERVERS,
                    ...turnServers
                ],
                iceCandidatePoolSize: 10
            });

        pc.onicecandidate =
            event => {

                if (!event.candidate) {
                    return;
                }

                send({
                    type:
                        "call_ice",

                    receiver_id:
                        Number(targetId),

                    call_id:
                        callId,

                    candidate:
                        event.candidate
                });
            };

        pc.ontrack =
            event => {

                console.log(
                    "GAPINO remote track",
                    event
                );

                remoteStream =
                    event.streams?.[0] ||
                    null;

                if (!remoteStream) {
                    return;
                }

                if (!remoteAudio) {

                    remoteAudio =
                        document.createElement(
                            "audio"
                        );

                    remoteAudio.autoplay =
                        true;

                    remoteAudio.playsInline =
                        true;

                    remoteAudio.muted =
                        false;

                    remoteAudio.volume =
                        1;

                    remoteAudio.style.position =
                        "fixed";

                    remoteAudio.style.width =
                        "1px";

                    remoteAudio.style.height =
                        "1px";

                    remoteAudio.style.left =
                        "-9999px";

                    document.body.appendChild(
                        remoteAudio
                    );
                }

                remoteAudio.srcObject =
                    remoteStream;

                try {
                    const result =
                        remoteAudio.play();

                    result?.catch?.(
                        error => {
                            console.warn(
                                "GAPINO remote audio play:",
                                error
                            );
                        }
                    );
                } catch (error) {
                    console.warn(
                        "GAPINO remote audio error:",
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
                    "GAPINO connection state:",
                    state
                );

                if (
                    state === "connecting"
                ) {
                    showUI(
                        callTarget,
                        "🔄 در حال اتصال..."
                    );
                }

                if (
                    state === "connected"
                ) {
                    inCall = true;

                    showUI(
                        callTarget,
                        "🟢 در حال مکالمه"
                    );
                }

                if (
                    state === "disconnected"
                ) {
                    showUI(
                        callTarget,
                        "⚠️ ارتباط ناپایدار"
                    );
                }

                if (
                    state === "failed"
                ) {
                    showUI(
                        callTarget,
                        "❌ اتصال تماس برقرار نشد"
                    );

                    showToast(
                        "WebRTC نتوانست تماس را وصل کند."
                    );
                }
            };

        pc.oniceconnectionstatechange =
            () => {

                if (!pc) {
                    return;
                }

                console.log(
                    "GAPINO ICE:",
                    pc.iceConnectionState
                );
            };

        return pc;
    }

    function addLocalTracks() {

        if (!pc) {
            throw new Error(
                "PeerConnection موجود نیست."
            );
        }

        if (!localStream) {
            throw new Error(
                "localStream موجود نیست."
            );
        }

        for (
            const track
            of localStream.getTracks()
        ) {
            const exists =
                pc.getSenders()
                    .some(
                        sender =>
                            sender.track ===
                            track
                    );

            if (!exists) {
                pc.addTrack(
                    track,
                    localStream
                );
            }
        }
    }

    /* =========================================================
       START CALL
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

        if (!socketIsOpen()) {
            showToast(
                "WebSocket هنوز متصل نشده."
            );
            return;
        }

        try {

            callTarget =
                target;

            callId =
                createCallId();

            outgoing = true;
            inCall = false;
            pendingOffer = null;
            pendingIce = [];

            showUI(
                callTarget,
                "📤 در حال دسترسی به میکروفون..."
            );

            localStream =
                await getMicrophone();

            createPeer(
                uid(callTarget)
            );

            addLocalTracks();

            showUI(
                callTarget,
                "📤 در حال ساخت تماس..."
            );

            const offer =
                await pc.createOffer({
                    offerToReceiveAudio: true
                });

            await pc.setLocalDescription(
                offer
            );

            const payload = {
                type:
                    "call_offer",

                receiver_id:
                    Number(
                        uid(callTarget)
                    ),

                call_id:
                    callId,

                offer: {
                    type:
                        pc.localDescription.type,

                    sdp:
                        pc.localDescription.sdp
                }
            };

            console.log(
                "GAPINO CALL OFFER:",
                payload
            );

            if (!send(payload)) {
                throw new Error(
                    "call_offer ارسال نشد."
                );
            }

            showUI(
                callTarget,
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
       INCOMING OFFER
       ========================================================= */

    async function handleOffer(data) {

        console.log(
            "GAPINO INCOMING OFFER:",
            data
        );

        if (pc || inCall) {

            send({
                type:
                    "call_busy",

                receiver_id:
                    Number(
                        data.sender_id
                    ),

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
                "GAPINO offer sender missing",
                data
            );
            return;
        }

        if (!data.offer) {
            console.error(
                "GAPINO offer missing",
                data
            );
            return;
        }

        let normalizedOffer = null;

        if (
            typeof data.offer ===
            "string"
        ) {
            normalizedOffer = {
                type:
                    "offer",
                sdp:
                    data.offer
            };

        } else if (
            data.offer &&
            typeof data.offer ===
                "object"
        ) {

            normalizedOffer = {
                type:
                    data.offer.type ||
                    "offer",

                sdp:
                    data.offer.sdp ||
                    ""
            };
        }

        if (
            !normalizedOffer ||
            !normalizedOffer.sdp
        ) {
            console.error(
                "GAPINO invalid offer:",
                data.offer
            );

            showToast(
                "اطلاعات تماس ورودی نامعتبر است."
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
                    uid(user) ===
                    senderId
            ) || {
                id:
                    senderId,

                display_name:
                    "کاربر گپینو"
            };

        callId =
            String(
                data.call_id ||
                createCallId()
            );

        outgoing = false;
        inCall = false;

        pendingOffer =
            normalizedOffer;

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
            "GAPINO ACCEPT START",
            {
                callId,
                callTarget,
                pendingOffer
            }
        );

        if (!pendingOffer) {
            showToast(
                "اطلاعات تماس ورودی موجود نیست."
            );
            return;
        }

        if (!callTarget) {
            showToast(
                "تماس‌گیرنده پیدا نشد."
            );
            return;
        }

        if (!socketIsOpen()) {
            showToast(
                "اتصال WebSocket قطع است."
            );
            return;
        }

        try {

            showUI(
                callTarget,
                "🔄 در حال دسترسی به میکروفون..."
            );

            localStream =
                await getMicrophone();

            console.log(
                "GAPINO ACCEPT STEP 1 OK"
            );

            createPeer(
                uid(callTarget)
            );

            addLocalTracks();

            console.log(
                "GAPINO ACCEPT STEP 2 OK"
            );

            const remoteOffer = {
                type:
                    pendingOffer.type ||
                    "offer",

                sdp:
                    pendingOffer.sdp
            };

            console.log(
                "GAPINO ACCEPT REMOTE OFFER:",
                remoteOffer
            );

            if (
                !remoteOffer.sdp
            ) {
                throw new Error(
                    "SDP تماس ورودی خالی است."
                );
            }

            showUI(
                callTarget,
                "🔄 در حال ثبت تماس..."
            );

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    remoteOffer
                )
            );

            console.log(
                "GAPINO ACCEPT STEP 3 REMOTE DESCRIPTION OK"
            );

            await flushIce();

            const answer =
                await pc.createAnswer();

            console.log(
                "GAPINO ACCEPT ANSWER CREATED:",
                answer
            );

            await pc.setLocalDescription(
                answer
            );

            console.log(
                "GAPINO ACCEPT STEP 4 LOCAL DESCRIPTION OK"
            );

            const answerPayload = {
                type:
                    "call_answer",

                receiver_id:
                    Number(
                        uid(callTarget)
                    ),

                call_id:
                    callId,

                answer: {
                    type:
                        pc.localDescription.type,

                    sdp:
                        pc.localDescription.sdp
                }
            };

            console.log(
                "GAPINO ACCEPT ANSWER PAYLOAD:",
                answerPayload
            );

            const sent =
                send(answerPayload);

            if (!sent) {
                throw new Error(
                    "call_answer ارسال نشد."
                );
            }

            pendingOffer =
                null;

            showUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

            console.log(
                "GAPINO ACCEPT SUCCESS"
            );

        } catch (error) {

            console.error(
                "GAPINO ACCEPT FAILED:",
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
       ANSWER RECEIVED
       ========================================================= */

    async function handleAnswer(data) {

        console.log(
            "GAPINO ANSWER RECEIVED:",
            data
        );

        if (!pc) {
            console.warn(
                "GAPINO answer without peer"
            );
            return;
        }

        if (
            data.call_id &&
            callId &&
            String(data.call_id) !==
                String(callId)
        ) {
            console.warn(
                "GAPINO answer call id mismatch",
                {
                    local: callId,
                    remote:
                        data.call_id
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

            const normalizedAnswer = {
                type:
                    data.answer.type ||
                    "answer",

                sdp:
                    data.answer.sdp ||
                    data.answer
            };

            if (
                !normalizedAnswer.sdp
            ) {
                throw new Error(
                    "SDP پاسخ تماس خالی است."
                );
            }

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    normalizedAnswer
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

        if (!data?.candidate) {
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
                "GAPINO ICE ERROR:",
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

        const candidates =
            pendingIce.splice(0);

        for (
            const candidate
            of candidates
        ) {
            try {

                await pc.addIceCandidate(
                    new RTCIceCandidate(
                        candidate
                    )
                );

            } catch (error) {

                console.warn(
                    "GAPINO ICE FLUSH ERROR:",
                    error
                );
            }
        }
    }

    /* =========================================================
       REJECT / END
       ========================================================= */

    function rejectCall() {

        if (callTarget) {

            send({
                type:
                    "call_reject",

                receiver_id:
                    Number(
                        uid(callTarget)
                    ),

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
                type:
                    "call_end",

                receiver_id:
                    Number(
                        uid(callTarget)
                    ),

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

            remoteAudio.srcObject =
                null;
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
       EVENTS
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
       CALL BUTTON
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
            "GAPINO call.js v501 loaded"
        );
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init,
            { once: true }
        );
    } else {
        init();
    }

})();