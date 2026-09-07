"use strict";

(() => {
    /*
     * =========================================================
     * GAPINO PRO - VOICE CALL
     * WebRTC + WebSocket Signaling
     * سازگار با chat.js فعلی
     * =========================================================
     */

    /* =========================================================
       ICE
       ========================================================= */

    const DEFAULT_ICE_SERVERS = [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        }
    ];

    function getIceServers() {
        const servers = [
            ...DEFAULT_ICE_SERVERS
        ];

        try {
            if (
                Array.isArray(
                    window.GAPINO_TURN_SERVERS
                ) &&
                window.GAPINO_TURN_SERVERS.length
            ) {
                servers.push(
                    ...window.GAPINO_TURN_SERVERS
                );
            }
        } catch (_) {}

        return servers;
    }

    function buildPeerConfig() {
        return {
            iceServers:
                getIceServers(),
            iceCandidatePoolSize: 10,
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require"
        };
    }

    /* =========================================================
       STATE
       ========================================================= */

    let peerConnection = null;
    let localStream = null;
    let remoteStream = null;
    let remoteAudio = null;

    let callTarget = null;
    let currentCallId = null;

    let outgoingCall = false;
    let activeCall = false;

    let pendingOffer = null;
    let pendingIce = [];

    let ringTimer = null;
    let callTimer = null;
    let callStartedAt = 0;

    let audioContext = null;
    let initialized = false;

    /* =========================================================
       HELPERS
       ========================================================= */

    function getElement(id) {
        return document.getElementById(id);
    }

    function getUserId(user) {
        if (!user) {
            return "";
        }

        const value =
            user.id ??
            user.user_id ??
            user.uid ??
            "";

        return String(value);
    }

    function getUserName(user) {
        if (!user) {
            return "کاربر";
        }

        return (
            user.display_name ||
            user.full_name ||
            user.name ||
            user.username ||
            "کاربر"
        );
    }

    function getCurrentUser() {
        return (
            window.GAPINO?.currentUser ||
            null
        );
    }

    function getCurrentChatUser() {
        return (
            window.GAPINO?.currentChatUser ||
            null
        );
    }

    function getSocket() {
        return (
            window.GAPINO?.socket ||
            window.GAPINO_SOCKET ||
            null
        );
    }

    function showToast(text) {
        const container =
            getElement("toastContainer");

        if (container) {
            const toast =
                document.createElement("div");

            toast.className = "toast";
            toast.textContent =
                String(text);

            container.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, 3500);

            return;
        }

        console.log(
            "GAPINO:",
            text
        );
    }

    function makeCallId() {
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

    function sendSignal(data) {
        const socket =
            getSocket();

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
            console.warn(
                "GAPINO call: WebSocket unavailable"
            );

            showToast(
                "اتصال تماس آماده نیست."
            );

            return false;
        }

        try {
            socket.send(
                JSON.stringify(data)
            );

            console.log(
                "GAPINO call signal sent:",
                data.type
            );

            return true;
        } catch (error) {
            console.error(
                "GAPINO call signal error:",
                error
            );

            return false;
        }
    }

    /* =========================================================
       AUDIO
       ========================================================= */

    function getAudioContext() {
        if (
            !window.AudioContext &&
            !window.webkitAudioContext
        ) {
            return null;
        }

        if (!audioContext) {
            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            audioContext =
                new AudioContextClass();
        }

        return audioContext;
    }

    async function unlockAudio() {
        const ctx =
            getAudioContext();

        if (!ctx) {
            return;
        }

        try {
            if (
                ctx.state ===
                "suspended"
            ) {
                await ctx.resume();
            }
        } catch (_) {}
    }

    function beep(
        frequency = 760,
        duration = 130,
        volume = 0.05
    ) {
        const ctx =
            getAudioContext();

        if (!ctx) {
            return;
        }

        try {
            if (
                ctx.state ===
                "suspended"
            ) {
                ctx.resume().catch(
                    () => {}
                );
            }

            const oscillator =
                ctx.createOscillator();

            const gain =
                ctx.createGain();

            oscillator.type =
                "sine";

            oscillator.frequency.value =
                frequency;

            const start =
                ctx.currentTime;

            const end =
                start +
                Math.max(
                    duration / 1000,
                    0.05
                );

            gain.gain.setValueAtTime(
                0.0001,
                start
            );

            gain.gain.exponentialRampToValueAtTime(
                Math.max(
                    volume,
                    0.0001
                ),
                start + 0.02
            );

            gain.gain.exponentialRampToValueAtTime(
                0.0001,
                end
            );

            oscillator.connect(gain);
            gain.connect(
                ctx.destination
            );

            oscillator.start(start);
            oscillator.stop(
                end + 0.03
            );

        } catch (_) {}
    }

    function startRing() {
        stopRing();

        beep(
            820,
            180,
            0.08
        );

        ringTimer =
            setInterval(() => {
                beep(
                    820,
                    180,
                    0.08
                );
            }, 1300);
    }

    function stopRing() {
        if (ringTimer) {
            clearInterval(
                ringTimer
            );

            ringTimer = null;
        }
    }

    /* =========================================================
       REMOTE AUDIO
       ========================================================= */

    function ensureRemoteAudio() {

        if (
            remoteAudio &&
            document.body.contains(
                remoteAudio
            )
        ) {
            return remoteAudio;
        }

        remoteAudio =
            document.createElement(
                "audio"
            );

        remoteAudio.id =
            "gapinoRemoteAudio";

        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.muted = false;
        remoteAudio.controls = false;
        remoteAudio.volume = 1;

        /*
         * مخفی است ولی واقعی؛
         * srcObject روی audio باقی می‌ماند.
         */
        remoteAudio.style.position =
            "fixed";

        remoteAudio.style.left =
            "-10000px";

        remoteAudio.style.top =
            "0";

        remoteAudio.style.width =
            "1px";

        remoteAudio.style.height =
            "1px";

        remoteAudio.style.opacity =
            "0";

        remoteAudio.style.pointerEvents =
            "none";

        document.body.appendChild(
            remoteAudio
        );

        return remoteAudio;
    }

    async function playRemoteAudio() {

        if (!remoteAudio) {
            return;
        }

        try {
            await unlockAudio();

            remoteAudio.muted = false;
            remoteAudio.volume = 1;

            const result =
                remoteAudio.play();

            if (
                result &&
                typeof result.catch ===
                    "function"
            ) {
                await result;
            }

        } catch (error) {

            console.warn(
                "GAPINO remote audio play:",
                error
            );

            showToast(
                "برای شنیدن صدا یک بار روی صفحه ضربه بزن."
            );
        }
    }

    /* =========================================================
       CALL UI
       ========================================================= */

    function ensureCallStyles() {

        if (
            getElement(
                "gapinoCallStyles"
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            "gapinoCallStyles";

        style.textContent = `
            .gapino-call-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(0,0,0,.78);
            }

            .gapino-call-overlay.show {
                display: flex;
            }

            .gapino-call-card {
                width: min(390px, 100%);
                padding: 28px 20px 20px;
                border-radius: 24px;
                background: #111827;
                box-shadow: 0 25px 80px rgba(0,0,0,.55);
                text-align: center;
            }

            .gapino-call-avatar {
                width: 86px;
                height: 86px;
                margin: 0 auto 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border-radius: 50%;
                background: #2563eb;
                color: #fff;
                font-size: 32px;
                font-weight: 900;
            }

            .gapino-call-avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .gapino-call-name {
                color: #fff;
                font-size: 19px;
                font-weight: 900;
            }

            .gapino-call-status {
                margin-top: 8px;
                color: #94a3b8;
                font-size: 13px;
            }

            .gapino-call-timer {
                margin-top: 7px;
                color: #cbd5e1;
                font-size: 12px;
                direction: ltr;
            }

            .gapino-call-actions {
                margin-top: 22px;
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 8px;
            }

            .gapino-call-button {
                min-width: 120px;
                min-height: 45px;
                padding: 9px 13px;
                border-radius: 12px;
                color: #fff;
                font-size: 13px;
                font-weight: 900;
            }

            .gapino-call-button.accept {
                background: #16a34a;
            }

            .gapino-call-button.reject {
                background: #dc2626;
            }

            @media (max-width: 430px) {
                .gapino-call-card {
                    padding: 24px 15px 16px;
                }

                .gapino-call-button {
                    width: 100%;
                }
            }
        `;

        document.head.appendChild(
            style
        );
    }

    function createCallUI() {

        ensureCallStyles();

        if (
            getElement(
                "gapinoCallOverlay"
            )
        ) {
            return;
        }

        const overlay =
            document.createElement(
                "div"
            );

        overlay.id =
            "gapinoCallOverlay";

        overlay.className =
            "gapino-call-overlay";

        overlay.innerHTML = `
            <div class="gapino-call-card">

                <div
                    id="gapinoCallAvatar"
                    class="gapino-call-avatar"
                >
                    G
                </div>

                <div
                    id="gapinoCallName"
                    class="gapino-call-name"
                >
                    کاربر
                </div>

                <div
                    id="gapinoCallStatus"
                    class="gapino-call-status"
                >
                    تماس صوتی
                </div>

                <div
                    id="gapinoCallTimer"
                    class="gapino-call-timer"
                >
                    00:00
                </div>

                <div
                    class="gapino-call-actions"
                >

                    <button
                        id="gapinoAcceptCall"
                        class="gapino-call-button accept"
                        type="button"
                    >
                        📞 پاسخ
                    </button>

                    <button
                        id="gapinoRejectCall"
                        class="gapino-call-button reject"
                        type="button"
                    >
                        ❌ رد تماس
                    </button>

                    <button
                        id="gapinoEndCall"
                        class="gapino-call-button reject"
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
            getElement(
                "gapinoAcceptCall"
            );

        const reject =
            getElement(
                "gapinoRejectCall"
            );

        const end =
            getElement(
                "gapinoEndCall"
            );

        if (accept) {
            accept.addEventListener(
                "click",
                acceptCall
            );
        }

        if (reject) {
            reject.addEventListener(
                "click",
                rejectCall
            );
        }

        if (end) {
            end.addEventListener(
                "click",
                () => {
                    endCall(
                        true,
                        true
                    );
                }
            );
        }
    }

    function showCallUI(
        user,
        status
    ) {
        createCallUI();

        const overlay =
            getElement(
                "gapinoCallOverlay"
            );

        const avatar =
            getElement(
                "gapinoCallAvatar"
            );

        const name =
            getElement(
                "gapinoCallName"
            );

        const statusEl =
            getElement(
                "gapinoCallStatus"
            );

        const accept =
            getElement(
                "gapinoAcceptCall"
            );

        const reject =
            getElement(
                "gapinoRejectCall"
            );

        const end =
            getElement(
                "gapinoEndCall"
            );

        if (!overlay) {
            return;
        }

        overlay.classList.add(
            "show"
        );

        const username =
            getUserName(user);

        if (avatar) {

            avatar.innerHTML =
                "";

            const url =
                user?.avatar ||
                user?.avatar_url ||
                "";

            if (url) {

                const img =
                    document.createElement(
                        "img"
                    );

                img.src = url;
                img.alt = username;

                img.onerror =
                    () => {
                        avatar.innerHTML =
                            "";

                        avatar.textContent =
                            username
                                .charAt(0)
                                .toUpperCase() ||
                            "G";
                    };

                avatar.appendChild(
                    img
                );

            } else {

                avatar.textContent =
                    username
                        .charAt(0)
                        .toUpperCase() ||
                    "G";
            }
        }

        if (name) {
            name.textContent =
                username;
        }

        if (statusEl) {
            statusEl.textContent =
                status;
        }

        const isIncoming =
            status.includes(
                "ورودی"
            );

        const isConnected =
            status.includes(
                "مکالمه"
            );

        if (accept) {
            accept.style.display =
                isIncoming
                    ? "block"
                    : "none";
        }

        if (reject) {
            reject.style.display =
                isConnected
                    ? "none"
                    : "block";
        }

        if (end) {
            end.style.display =
                isConnected
                    ? "block"
                    : "none";
        }

        if (isIncoming) {
            startRing();
        } else {
            stopRing();
        }

        if (isConnected) {
            stopRing();
        }
    }

    function hideCallUI() {

        const overlay =
            getElement(
                "gapinoCallOverlay"
            );

        if (overlay) {
            overlay.classList.remove(
                "show"
            );
        }

        stopRing();
        stopCallTimer();
    }

    /* =========================================================
       TIMER
       ========================================================= */

    function startCallTimer() {

        stopCallTimer();

        callStartedAt =
            Date.now();

        updateCallTimer();

        callTimer =
            setInterval(
                updateCallTimer,
                1000
            );
    }

    function updateCallTimer() {

        const timer =
            getElement(
                "gapinoCallTimer"
            );

        if (
            !timer ||
            !callStartedAt
        ) {
            return;
        }

        const seconds =
            Math.floor(
                (
                    Date.now() -
                    callStartedAt
                ) / 1000
            );

        const minutes =
            Math.floor(
                seconds / 60
            );

        const rest =
            seconds % 60;

        timer.textContent =
            `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    }

    function stopCallTimer() {

        if (callTimer) {
            clearInterval(
                callTimer
            );

            callTimer = null;
        }

        callStartedAt = 0;
    }

    /* =========================================================
       MICROPHONE
       ========================================================= */

    async function getMicrophone() {

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {
            throw new Error(
                "مرورگر از میکروفون پشتیبانی نمی‌کند."
            );
        }

        try {

            const stream =
                await navigator.mediaDevices
                    .getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            channelCount: 1
                        },
                        video: false
                    });

            const tracks =
                stream.getAudioTracks();

            if (!tracks.length) {

                stream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );

                throw new Error(
                    "میکروفون پیدا نشد."
                );
            }

            return stream;

        } catch (error) {

            console.error(
                "GAPINO microphone:",
                error
            );

            throw error;
        }
    }

    /* =========================================================
       PEER
       ========================================================= */

    function createPeerConnection(
        targetId
    ) {

        if (peerConnection) {
            try {
                peerConnection.close();
            } catch (_) {}
        }

        if (
            !window.RTCPeerConnection
        ) {
            throw new Error(
                "WebRTC در این مرورگر در دسترس نیست."
            );
        }

        const pc =
            new RTCPeerConnection(
                buildPeerConfig()
            );

        peerConnection =
            pc;

        pc.onicecandidate =
            event => {

                if (
                    !event.candidate ||
                    !targetId
                ) {
                    return;
                }

                sendSignal({
                    type: "call_ice",
                    receiver_id:
                        Number(targetId),
                    call_id:
                        currentCallId,
                    candidate:
                        event.candidate
                });
            };

        pc.ontrack =
            event => {

                console.log(
                    "GAPINO remote track received"
                );

                const stream =
                    event.streams &&
                    event.streams[0];

                if (!stream) {
                    return;
                }

                remoteStream =
                    stream;

                const audio =
                    ensureRemoteAudio();

                audio.srcObject =
                    stream;

                audio.muted = false;
                audio.volume = 1;

                playRemoteAudio();
            };

        pc.onconnectionstatechange =
            () => {

                const state =
                    pc.connectionState;

                console.log(
                    "GAPINO connection:",
                    state
                );

                if (
                    state ===
                    "connecting"
                ) {
                    showCallUI(
                        callTarget,
                        "🔄 در حال اتصال..."
                    );
                }

                if (
                    state ===
                    "connected"
                ) {

                    activeCall =
                        true;

                    showCallUI(
                        callTarget,
                        "🟢 در حال مکالمه"
                    );

                    startCallTimer();
                    stopRing();

                    playRemoteAudio();

                    beep(
                        980,
                        90,
                        0.04
                    );
                }

                if (
                    state ===
                    "disconnected"
                ) {

                    showCallUI(
                        callTarget,
                        "📡 ارتباط ناپایدار..."
                    );
                }

                if (
                    state ===
                    "failed"
                ) {

                    showCallUI(
                        callTarget,
                        "❌ اتصال تماس ناموفق بود"
                    );

                    setTimeout(
                        () => {
                            if (
                                peerConnection === pc
                            ) {
                                endCall(
                                    true,
                                    true
                                );
                            }
                        },
                        1200
                    );
                }
            };

        pc.oniceconnectionstatechange =
            () => {

                console.log(
                    "GAPINO ICE:",
                    pc.iceConnectionState
                );
            };

        pc.onicegatheringstatechange =
            () => {

                console.log(
                    "GAPINO ICE gathering:",
                    pc.iceGatheringState
                );
            };

        return pc;
    }

    async function addLocalTracks() {

        if (!peerConnection) {
            throw new Error(
                "PeerConnection وجود ندارد."
            );
        }

        if (!localStream) {
            localStream =
                await getMicrophone();
        }

        const senders =
            peerConnection.getSenders();

        localStream
            .getTracks()
            .forEach(
                track => {

                    const exists =
                        senders.some(
                            sender =>
                                sender.track ===
                                track
                        );

                    if (!exists) {

                        peerConnection.addTrack(
                            track,
                            localStream
                        );
                    }
                }
            );
    }

    /* =========================================================
       START OUTGOING
       ========================================================= */

    async function startCall(
        explicitUser = null
    ) {

        await unlockAudio();

        if (
            activeCall ||
            peerConnection
        ) {
            showToast(
                "یک تماس در حال اجراست."
            );

            return;
        }

        const target =
            explicitUser ||
            getCurrentChatUser();

        const targetId =
            getUserId(target);

        const me =
            getCurrentUser();

        const myId =
            getUserId(me);

        if (
            !target ||
            !targetId ||
            !myId
        ) {
            showToast(
                "ابتدا یک کاربر را انتخاب کن."
            );

            return;
        }

        if (
            targetId ===
            myId
        ) {
            showToast(
                "نمی‌توانی با خودت تماس بگیری."
            );

            return;
        }

        const socket =
            getSocket();

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
            showToast(
                "اتصال تماس آماده نیست."
            );

            return;
        }

        currentCallId =
            makeCallId();

        callTarget =
            target;

        outgoingCall =
            true;

        activeCall =
            false;

        pendingOffer = null;
        pendingIce = [];

        try {

            showCallUI(
                target,
                "📤 در حال تماس..."
            );

            localStream =
                await getMicrophone();

            createPeerConnection(
                targetId
            );

            await addLocalTracks();

            const offer =
                await peerConnection.createOffer({
                    offerToReceiveAudio: true
                });

            await peerConnection.setLocalDescription(
                offer
            );

            const sent =
                sendSignal({
                    type:
                        "call_offer",

                    receiver_id:
                        Number(targetId),

                    call_id:
                        currentCallId,

                    offer:
                        peerConnection.localDescription
                });

            if (!sent) {
                throw new Error(
                    "ارسال تماس ناموفق بود."
                );
            }

            showCallUI(
                target,
                "📤 در انتظار پاسخ..."
            );

        } catch (error) {

            console.error(
                "GAPINO outgoing call:",
                error
            );

            endCall(
                false,
                false
            );

            showToast(
                "❌ برقراری تماس انجام نشد."
            );
        }
    }

    /* =========================================================
       INCOMING OFFER
       ========================================================= */

    async function handleOffer(data) {

        await unlockAudio();

        if (
            activeCall ||
            peerConnection
        ) {

            sendSignal({
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
                ""
            );

        if (!senderId) {
            console.warn(
                "GAPINO incoming call: sender missing"
            );

            return;
        }

        let caller = null;

        const availableUsers =
            Array.isArray(
                window.GAPINO?.users
            )
                ? window.GAPINO.users
                : [];

        caller =
            availableUsers.find(
                user =>
                    getUserId(user) ===
                    senderId
            ) || {
                id: senderId,
                username: "کاربر",
                display_name:
                    "کاربر گپینو"
            };

        callTarget =
            caller;

        currentCallId =
            String(
                data.call_id || ""
            );

        outgoingCall =
            false;

        activeCall =
            false;

        pendingOffer =
            data.offer || null;

        pendingIce = [];

        if (!pendingOffer) {
            console.warn(
                "GAPINO incoming call: offer missing"
            );

            return;
        }

        showCallUI(
            caller,
            "📞 تماس ورودی"
        );

        startRing();
    }

    /* =========================================================
       ACCEPT
       ========================================================= */

    async function acceptCall() {

        await unlockAudio();

        stopRing();

        if (
            !pendingOffer ||
            !callTarget
        ) {
            return;
        }

        try {

            showCallUI(
                callTarget,
                "🔄 در حال پاسخ..."
            );

            localStream =
                await getMicrophone();

            createPeerConnection(
                getUserId(
                    callTarget
                )
            );

            await addLocalTracks();

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                    pendingOffer
                )
            );

            await flushPendingIce();

            const answer =
                await peerConnection.createAnswer({
                    offerToReceiveAudio: true
                });

            await peerConnection.setLocalDescription(
                answer
            );

            const sent =
                sendSignal({
                    type:
                        "call_answer",

                    receiver_id:
                        Number(
                            getUserId(
                                callTarget
                            )
                        ),

                    call_id:
                        currentCallId,

                    answer:
                        peerConnection.localDescription
                });

            if (!sent) {
                throw new Error(
                    "ارسال پاسخ تماس ناموفق بود."
                );
            }

            pendingOffer = null;

            showCallUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "GAPINO accept call:",
                error
            );

            rejectCall();

            showToast(
                "❌ پاسخ به تماس انجام نشد."
            );
        }
    }

    /* =========================================================
       ANSWER
       ========================================================= */

    async function handleAnswer(data) {

        if (
            !peerConnection ||
            !outgoingCall
        ) {
            return;
        }

        if (
            data.call_id &&
            String(
                data.call_id
            ) !==
            String(
                currentCallId
            )
        ) {
            return;
        }

        if (!data.answer) {
            return;
        }

        try {

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                    data.answer
                )
            );

            await flushPendingIce();

            showCallUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "GAPINO handle answer:",
                error
            );

            endCall(
                true,
                true
            );
        }
    }

    /* =========================================================
       ICE
       ========================================================= */

    async function handleIce(data) {

        if (!data.candidate) {
            return;
        }

        if (
            data.call_id &&
            currentCallId &&
            String(
                data.call_id
            ) !==
            String(
                currentCallId
            )
        ) {
            return;
        }

        if (
            !peerConnection ||
            !peerConnection.remoteDescription
        ) {
            pendingIce.push(
                data.candidate
            );

            return;
        }

        try {

            await peerConnection.addIceCandidate(
                new RTCIceCandidate(
                    data.candidate
                )
            );

        } catch (error) {

            console.warn(
                "GAPINO ICE candidate:",
                error
            );
        }
    }

    async function flushPendingIce() {

        if (
            !peerConnection ||
            !peerConnection.remoteDescription
        ) {
            return;
        }

        const candidates =
            pendingIce.splice(
                0
            );

        for (
            const candidate
            of candidates
        ) {

            try {

                await peerConnection.addIceCandidate(
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
       CALL CONTROL
       ========================================================= */

    function rejectCall() {

        const targetId =
            callTarget
                ? getUserId(
                    callTarget
                )
                : "";

        if (targetId) {

            sendSignal({
                type:
                    "call_reject",

                receiver_id:
                    Number(targetId),

                call_id:
                    currentCallId
            });
        }

        cleanup();

        showToast(
            "❌ تماس رد شد."
        );
    }

    function handleReject() {

        cleanup();

        showToast(
            "❌ تماس رد شد."
        );
    }

    function handleBusy() {

        cleanup();

        showToast(
            "📵 کاربر در حال مکالمه است."
        );
    }

    function handleRemoteEnd() {

        cleanup();

        showToast(
            "☎️ تماس پایان یافت."
        );
    }

    function endCall(
        notifyRemote = true,
        showMessage = true
    ) {

        const targetId =
            callTarget
                ? getUserId(
                    callTarget
                )
                : "";

        if (
            notifyRemote &&
            targetId
        ) {

            sendSignal({
                type:
                    "call_end",

                receiver_id:
                    Number(targetId),

                call_id:
                    currentCallId
            });
        }

        cleanup();

        if (showMessage) {
            showToast(
                "☎️ تماس قطع شد."
            );
        }
    }

    /* =========================================================
       CLEANUP
       ========================================================= */

    function cleanup() {

        stopRing();
        stopCallTimer();

        if (peerConnection) {

            try {
                peerConnection.onicecandidate = null;
                peerConnection.ontrack = null;
                peerConnection.onconnectionstatechange = null;
                peerConnection.oniceconnectionstatechange = null;
                peerConnection.onicegatheringstatechange = null;

                peerConnection.close();

            } catch (_) {}
        }

        peerConnection = null;

        if (localStream) {

            localStream
                .getTracks()
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch (_) {}
                    }
                );
        }

        localStream = null;
        remoteStream = null;

        if (remoteAudio) {

            try {
                remoteAudio.pause();
            } catch (_) {}

            remoteAudio.srcObject =
                null;
        }

        pendingOffer = null;
        pendingIce = [];

        outgoingCall = false;
        activeCall = false;

        callTarget = null;
        currentCallId = null;

        hideCallUI();
    }

    /* =========================================================
       EVENT BRIDGE
       ========================================================= */

    function handleCallEvent(data) {

        if (
            !data ||
            typeof data.type !==
                "string"
        ) {
            return;
        }

        console.log(
            "GAPINO call event:",
            data
        );

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
                break;
        }
    }

    /*
     * chat.js فعلی:
     * document.dispatchEvent(
     *   new CustomEvent("gapino-call-event", ...)
     * )
     */
    document.addEventListener(
        "gapino-call-event",
        event => {
            handleCallEvent(
                event.detail
            );
        }
    );

    /*
     * سازگاری با نسخه‌های قبلی
     */
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

    function setupCallButton() {

        const button =
            getElement(
                "callButton"
            );

        if (!button) {
            return;
        }

        /*
         * جلوگیری از ثبت چندباره
         */
        if (
            button.dataset.gapinoCallReady ===
            "1"
        ) {
            return;
        }

        button.dataset.gapinoCallReady =
            "1";

        button.addEventListener(
            "click",
            async () => {

                await startCall();

            }
        );
    }

    /* =========================================================
       PUBLIC API
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

        createCallUI();
        setupCallButton();

        /*
         * فعال کردن صدای مرورگر با اولین لمس/کلیک
         */
        const unlock = () => {
            unlockAudio().catch(
                () => {}
            );
        };

        document.addEventListener(
            "click",
            unlock,
            {
                once: true,
                passive: true
            }
        );

        document.addEventListener(
            "touchstart",
            unlock,
            {
                once: true,
                passive: true
            }
        );

        console.log(
            "GAPINO voice call initialized"
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
