"use strict";

(() => {
    /* =========================================================
       GAPINO PRO - REAL VOICE CALL
       WebRTC + WebSocket Signaling
       STUN + TURN ready
       Echo Cancellation
       Noise Suppression
       Auto Gain Control
       ========================================================= */

    /* =========================================================
       ICE CONFIG
       ========================================================= */

    const DEFAULT_ICE_SERVERS = [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        }
    ];

    function buildIceConfig() {
        let servers = [...DEFAULT_ICE_SERVERS];

        try {
            if (
                Array.isArray(window.GAPINO_TURN_SERVERS) &&
                window.GAPINO_TURN_SERVERS.length > 0
            ) {
                servers = [
                    ...servers,
                    ...window.GAPINO_TURN_SERVERS
                ];
            }
        } catch (_) {}

        return {
            iceServers: servers,
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
    let remoteAudio = null;

    let activeCall = false;
    let outgoingCall = false;

    let callTarget = null;
    let currentCallId = null;

    let pendingOffer = null;
    let pendingIce = [];

    let callTimer = null;
    let callStartedAt = 0;

    let notificationAudioContext = null;
    let ringInterval = null;

    let initialized = false;

    let localAudioTrack = null;
    let remoteStream = null;

    /* =========================================================
       HELPERS
       ========================================================= */

    function getUserId(user) {
        return String(
            user?.id ??
            user?.user_id ??
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

    function getCurrentUser() {
        return window.GAPINO?.currentUser || null;
    }

    function getCurrentChatUser() {
        return window.GAPINO?.currentChatUser || null;
    }

    function getSocket() {
        return window.GAPINO?.socket || null;
    }

    function showToast(text) {
        try {
            if (
                window.GAPINO &&
                typeof window.GAPINO.showToast === "function"
            ) {
                window.GAPINO.showToast(text);
                return;
            }
        } catch (_) {}

        console.log("GAPINO:", text);
    }

    function getAvatarUrl(user) {
        const value =
            user?.avatar ||
            user?.profile?.avatar ||
            "";

        if (!value) {
            return "";
        }

        if (
            value.startsWith("http://") ||
            value.startsWith("https://")
        ) {
            return value;
        }

        if (value.startsWith("/")) {
            return value;
        }

        return "/" + value;
    }

    function makeCallId() {
        try {
            if (
                window.crypto &&
                typeof window.crypto.randomUUID === "function"
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
       NOTIFICATIONS
       ========================================================= */

    async function requestNotificationPermission() {
        if (!("Notification" in window)) {
            return;
        }

        if (Notification.permission !== "default") {
            return;
        }

        try {
            await Notification.requestPermission();
        } catch (_) {}
    }

    function browserNotify(title, body) {
        if (!("Notification" in window)) {
            return;
        }

        if (Notification.permission !== "granted") {
            return;
        }

        try {
            const notification = new Notification(
                title,
                {
                    body,
                    icon: "/favicon.png",
                    tag: "gapino-call"
                }
            );

            setTimeout(() => {
                try {
                    notification.close();
                } catch (_) {}
            }, 5000);

        } catch (_) {}
    }

    /* =========================================================
       AUDIO CONTEXT
       ========================================================= */

    function getAudioContext() {
        if (
            !window.AudioContext &&
            !window.webkitAudioContext
        ) {
            return null;
        }

        if (!notificationAudioContext) {
            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            notificationAudioContext =
                new AudioContextClass();
        }

        return notificationAudioContext;
    }

    async function unlockAudio() {
        const ctx = getAudioContext();

        if (!ctx) {
            return;
        }

        try {
            if (ctx.state === "suspended") {
                await ctx.resume();
            }
        } catch (_) {}
    }

    function beep(
        frequency = 760,
        duration = 140,
        volume = 0.06
    ) {
        const ctx = getAudioContext();

        if (!ctx) {
            return;
        }

        try {
            if (ctx.state === "suspended") {
                ctx.resume().catch(() => {});
            }

            const oscillator =
                ctx.createOscillator();

            const gain =
                ctx.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = frequency;

            const start = ctx.currentTime;
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
                Math.max(volume, 0.0001),
                start + 0.02
            );

            gain.gain.exponentialRampToValueAtTime(
                0.0001,
                end
            );

            oscillator.connect(gain);
            gain.connect(ctx.destination);

            oscillator.start(start);
            oscillator.stop(end + 0.03);

        } catch (_) {}
    }

    function startRing() {
        stopRing();

        beep(820, 180, 0.08);

        ringInterval = setInterval(() => {
            beep(820, 180, 0.08);
        }, 1300);
    }

    function stopRing() {
        if (ringInterval) {
            clearInterval(ringInterval);
            ringInterval = null;
        }
    }

    function notify(
        title,
        body,
        sound = true,
        browser = false
    ) {
        if (sound) {
            beep(720, 150, 0.07);
        }

        showToast(
            `${title}${body ? ` • ${body}` : ""}`
        );

        if (browser) {
            browserNotify(title, body);
        }
    }

    /* =========================================================
       SIGNALING
       ========================================================= */

    function send(data) {
        const socket = getSocket();

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {
            console.warn(
                "GAPINO call: WebSocket not ready"
            );

            return false;
        }

        try {
            socket.send(
                JSON.stringify(data)
            );

            return true;

        } catch (error) {
            console.error(
                "GAPINO call send error:",
                error
            );

            return false;
        }
    }

    /* =========================================================
       CALL UI
       ========================================================= */

    function createCallUI() {
        if (
            document.getElementById(
                "gapinoCallOverlay"
            )
        ) {
            return;
        }

        const overlay =
            document.createElement("div");

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

        document.body.appendChild(overlay);

        document
            .getElementById(
                "gapinoAcceptCall"
            )
            ?.addEventListener(
                "click",
                acceptCall
            );

        document
            .getElementById(
                "gapinoRejectCall"
            )
            ?.addEventListener(
                "click",
                rejectCall
            );

        document
            .getElementById(
                "gapinoEndCall"
            )
            ?.addEventListener(
                "click",
                () => {
                    endCall(
                        true,
                        true
                    );
                }
            );
    }

    function showCallUI(
        user,
        status
    ) {
        createCallUI();

        const overlay =
            document.getElementById(
                "gapinoCallOverlay"
            );

        const avatar =
            document.getElementById(
                "gapinoCallAvatar"
            );

        const name =
            document.getElementById(
                "gapinoCallName"
            );

        const statusEl =
            document.getElementById(
                "gapinoCallStatus"
            );

        const accept =
            document.getElementById(
                "gapinoAcceptCall"
            );

        const reject =
            document.getElementById(
                "gapinoRejectCall"
            );

        const end =
            document.getElementById(
                "gapinoEndCall"
            );

        if (!overlay) {
            return;
        }

        overlay.classList.add("show");

        if (avatar) {
            avatar.innerHTML = "";

            const url =
                getAvatarUrl(user);

            if (url) {
                const img =
                    document.createElement("img");

                img.src = url;

                img.alt =
                    getUserName(user);

                img.onerror = () => {
                    avatar.innerHTML = "";

                    avatar.textContent =
                        getUserName(user)
                            .charAt(0)
                            .toUpperCase() ||
                        "G";
                };

                avatar.appendChild(img);
            } else {
                avatar.textContent =
                    getUserName(user)
                        .charAt(0)
                        .toUpperCase() ||
                    "G";
            }
        }

        if (name) {
            name.textContent =
                getUserName(user);
        }

        if (statusEl) {
            statusEl.textContent =
                status;
        }

        const incoming =
            status.includes("ورودی");

        const connected =
            status.includes("مکالمه");

        if (accept) {
            accept.style.display =
                incoming
                    ? "flex"
                    : "none";
        }

        if (reject) {
            reject.style.display =
                incoming || !connected
                    ? "flex"
                    : "none";
        }

        if (end) {
            end.style.display =
                connected
                    ? "flex"
                    : "none";
        }

        if (incoming) {
            startRing();
        } else {
            stopRing();
        }

        if (connected) {
            stopRing();
        }
    }

    function hideCallUI() {
        const overlay =
            document.getElementById(
                "gapinoCallOverlay"
            );

        if (overlay) {
            overlay.classList.remove("show");
        }

        stopRing();
        stopTimer();
    }

    /* =========================================================
       TIMER
       ========================================================= */

    function startTimer() {
        stopTimer();

        callStartedAt =
            Date.now();

        updateTimer();

        callTimer =
            setInterval(
                updateTimer,
                1000
            );
    }

    function updateTimer() {
        const timer =
            document.getElementById(
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

        const remaining =
            seconds % 60;

        timer.textContent =
            `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
    }

    function stopTimer() {
        if (callTimer) {
            clearInterval(callTimer);
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
                "مرورگر از میکروفن پشتیبانی نمی‌کند."
            );
        }

        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            },
            video: false
        };

        try {
            const stream =
                await navigator.mediaDevices.getUserMedia(
                    constraints
                );

            const tracks =
                stream.getAudioTracks();

            const track =
                tracks[0];

            if (!track) {
                throw new Error(
                    "میکروفن صوتی پیدا نشد."
                );
            }

            localAudioTrack =
                track;

            try {
                const capabilities =
                    typeof track.getCapabilities ===
                    "function"
                        ? track.getCapabilities()
                        : {};

                const apply = {};

                if (
                    "echoCancellation" in
                    capabilities
                ) {
                    apply.echoCancellation =
                        true;
                }

                if (
                    "noiseSuppression" in
                    capabilities
                ) {
                    apply.noiseSuppression =
                        true;
                }

                if (
                    "autoGainControl" in
                    capabilities
                ) {
                    apply.autoGainControl =
                        true;
                }

                if (
                    "channelCount" in
                    capabilities
                ) {
                    apply.channelCount =
                        1;
                }

                if (
                    Object.keys(apply).length > 0 &&
                    typeof track.applyConstraints ===
                    "function"
                ) {
                    await track.applyConstraints(
                        apply
                    );
                }

            } catch (error) {
                console.warn(
                    "GAPINO microphone constraints:",
                    error
                );
            }

            console.log(
                "GAPINO microphone ready:",
                track.getSettings
                    ? track.getSettings()
                    : {}
            );

            return stream;

        } catch (error) {
            console.error(
                "GAPINO Microphone error:",
                error
            );

            throw error;
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
            document.createElement("audio");

        remoteAudio.id =
            "gapinoRemoteAudio";

        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.muted = false;
        remoteAudio.controls = false;

        try {
            remoteAudio.volume = 1;
        } catch (_) {}

        remoteAudio.style.position =
            "fixed";

        remoteAudio.style.left =
            "-9999px";

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

        remoteAudio.setAttribute(
            "aria-hidden",
            "true"
        );

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
            remoteAudio.muted = false;
            remoteAudio.volume = 1;

            await unlockAudio();

            const promise =
                remoteAudio.play();

            if (
                promise &&
                typeof promise.catch ===
                "function"
            ) {
                await promise;
            }

            console.log(
                "GAPINO remote audio playing"
            );

        } catch (error) {
            console.warn(
                "GAPINO remote audio play failed:",
                error
            );

            showToast(
                "صدای تماس آماده است؛ یک بار روی صفحه ضربه بزن."
            );
        }
    }

    /* =========================================================
       PEER CONNECTION
       ========================================================= */

    function createPeerConnection(
        receiverId
    ) {
        if (peerConnection) {
            try {
                peerConnection.close();
            } catch (_) {}
        }

        if (!window.RTCPeerConnection) {
            throw new Error(
                "مرورگر از WebRTC پشتیبانی نمی‌کند."
            );
        }

        const config =
            buildIceConfig();

        console.log(
            "GAPINO ICE config:",
            config
        );

        peerConnection =
            new RTCPeerConnection(
                config
            );

        peerConnection.onicecandidate =
            event => {
                if (
                    !event.candidate ||
                    !callTarget
                ) {
                    return;
                }

                console.log(
                    "GAPINO sending ICE candidate:",
                    event.candidate.candidate
                );

                send({
                    type:
                        "call_ice",

                    receiver_id:
                        Number(receiverId),

                    call_id:
                        currentCallId,

                    candidate:
                        event.candidate
                });
            };

        peerConnection.ontrack =
            event => {
                console.log(
                    "GAPINO remote audio track received",
                    event
                );

                const stream =
                    event.streams?.[0];

                if (!stream) {
                    console.warn(
                        "GAPINO ontrack without stream"
                    );
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

        peerConnection.onconnectionstatechange =
            () => {
                if (!peerConnection) {
                    return;
                }

                const state =
                    peerConnection.connectionState;

                console.log(
                    "GAPINO WebRTC connectionState:",
                    state
                );

                if (state === "new") {
                    showCallUI(
                        callTarget,
                        outgoingCall
                            ? "📤 در حال تماس..."
                            : "📞 تماس ورودی"
                    );
                }

                if (state === "connecting") {
                    showCallUI(
                        callTarget,
                        "🔄 در حال اتصال..."
                    );
                }

                if (state === "connected") {
                    activeCall = true;

                    showCallUI(
                        callTarget,
                        "🟢 در حال مکالمه"
                    );

                    startTimer();
                    stopRing();

                    playRemoteAudio();

                    notify(
                        "🟢 تماس برقرار شد",
                        `مکالمه با ${getUserName(callTarget)} برقرار شد.`,
                        false,
                        false
                    );
                }

                if (state === "disconnected") {
                    showCallUI(
                        callTarget,
                        "📡 ارتباط ناپایدار..."
                    );
                }

                if (state === "failed") {
                    console.error(
                        "GAPINO WebRTC failed."
                    );

                    notify(
                        "❌ تماس",
                        "ارتباط WebRTC برقرار نشد.",
                        true,
                        false
                    );

                    endCall(
                        true,
                        false
                    );
                }

                if (state === "closed") {
                    cleanup();
                }
            };

        peerConnection.oniceconnectionstatechange =
            () => {
                if (!peerConnection) {
                    return;
                }

                const state =
                    peerConnection.iceConnectionState;

                console.log(
                    "GAPINO ICE:",
                    state
                );
            };

        peerConnection.onicegatheringstatechange =
            () => {
                if (!peerConnection) {
                    return;
                }

                console.log(
                    "GAPINO ICE gathering:",
                    peerConnection.iceGatheringState
                );
            };

        peerConnection.onsignalingstatechange =
            () => {
                if (!peerConnection) {
                    return;
                }

                console.log(
                    "GAPINO signaling:",
                    peerConnection.signalingState
                );
            };

        peerConnection.onnegotiationneeded =
            () => {
                console.log(
                    "GAPINO negotiationneeded"
                );
            };

        return peerConnection;
    }

    async function addLocalTracks() {
        if (!localStream) {
            localStream =
                await getMicrophone();
        }

        if (!peerConnection) {
            throw new Error(
                "اتصال WebRTC ایجاد نشده است."
            );
        }

        const senders =
            peerConnection.getSenders();

        for (
            const track
            of localStream.getTracks()
        ) {
            const exists =
                senders.some(
                    sender =>
                        sender.track === track
                );

            if (!exists) {
                peerConnection.addTrack(
                    track,
                    localStream
                );
            }
        }

        console.log(
            "GAPINO local audio tracks:",
            localStream.getAudioTracks()
        );
    }

    /* =========================================================
       OUTGOING CALL
       ========================================================= */

    async function startCall() {
        await unlockAudio();

        await requestNotificationPermission();

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

        if (targetId === myId) {
            showToast(
                "نمی‌توانی با خودت تماس بگیری."
            );
            return;
        }

        const socket =
            getSocket();

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {
            showToast(
                "اتصال تماس آماده نیست؛ چند لحظه صبر کن."
            );

            console.warn(
                "GAPINO call: socket unavailable"
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

        pendingIce = [];
        pendingOffer = null;

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
                    offerToReceiveAudio: true,
                    voiceActivityDetection: true
                });

            await peerConnection.setLocalDescription(
                offer
            );

            const sent =
                send({
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
                    "ارسال تماس انجام نشد."
                );
            }

            showCallUI(
                target,
                "📤 در انتظار پاسخ..."
            );

        } catch (error) {
            console.error(
                "GAPINO Start call error:",
                error
            );

            cleanup();

            showToast(
                "❌ برقراری تماس انجام نشد."
            );
        }
    }

    /* =========================================================
       INCOMING CALL
       ========================================================= */

    async function handleOffer(data) {
        await unlockAudio();

        await requestNotificationPermission();

        if (
            activeCall ||
            peerConnection
        ) {
            send({
                type:
                    "call_busy",

                receiver_id:
                    Number(data.sender_id),

                call_id:
                    data.call_id || ""
            });

            return;
        }

        const senderId =
            String(
                data.sender_id || ""
            );

        if (!senderId) {
            return;
        }

        const users =
            Array.isArray(
                window.GAPINO?.users
            )
                ? window.GAPINO.users
                : [];

        const caller =
            users.find(
                user =>
                    getUserId(user) ===
                    senderId
            ) ||
            {
                id: senderId,
                username: "کاربر",
                display_name:
                    "کاربر گپینو",
                online: true
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
            return;
        }

        showCallUI(
            caller,
            "📞 تماس ورودی"
        );

        notify(
            "📞 تماس ورودی",
            `${getUserName(caller)} با شما تماس می‌گیرد.`,
            true,
            true
        );

        startRing();
    }

    /* =========================================================
       ACCEPT
       ========================================================= */

    async function acceptCall() {
        await unlockAudio();

        await requestNotificationPermission();

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
                getUserId(callTarget)
            );

            await addLocalTracks();

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                    pendingOffer
                )
            );

            await flushIce();

            const answer =
                await peerConnection.createAnswer({
                    offerToReceiveAudio: true,
                    voiceActivityDetection: true
                });

            await peerConnection.setLocalDescription(
                answer
            );

            const sent =
                send({
                    type:
                        "call_answer",

                    receiver_id:
                        Number(
                            getUserId(callTarget)
                        ),

                    call_id:
                        currentCallId,

                    answer:
                        peerConnection.localDescription
                });

            if (!sent) {
                throw new Error(
                    "ارسال پاسخ تماس انجام نشد."
                );
            }

            pendingOffer = null;

            showCallUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {
            console.error(
                "GAPINO Accept call error:",
                error
            );

            if (callTarget) {
                send({
                    type:
                        "call_reject",

                    receiver_id:
                        Number(
                            getUserId(callTarget)
                        ),

                    call_id:
                        currentCallId
                });
            }

            cleanup();

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
            String(data.call_id || "") !==
            String(currentCallId || "")
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

            await flushIce();

            showCallUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {
            console.error(
                "GAPINO Answer error:",
                error
            );

            endCall(
                true,
                false
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
            String(data.call_id) !==
            String(currentCallId)
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
                "GAPINO ICE error:",
                error
            );
        }
    }

    async function flushIce() {
        if (
            !peerConnection ||
            !peerConnection.remoteDescription
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
                await peerConnection.addIceCandidate(
                    new RTCIceCandidate(
                        candidate
                    )
                );
            } catch (error) {
                console.warn(
                    "GAPINO ICE flush error:",
                    error
                );
            }
        }
    }

    /* =========================================================
       REJECT / BUSY
       ========================================================= */

    function rejectCall() {
        stopRing();

        if (callTarget) {
            send({
                type:
                    "call_reject",

                receiver_id:
                    Number(
                        getUserId(callTarget)
                    ),

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
            "❌ تماس شما رد شد."
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

    /* =========================================================
       END CALL
       ========================================================= */

    function endCall(
        notifyRemote = true,
        showMessage = true
    ) {
        const targetId =
            callTarget
                ? getUserId(callTarget)
                : "";

        if (
            notifyRemote &&
            targetId
        ) {
            send({
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
        stopTimer();

        if (peerConnection) {
            try {
                peerConnection.ontrack = null;
                peerConnection.onicecandidate = null;
                peerConnection.onconnectionstatechange = null;
                peerConnection.oniceconnectionstatechange = null;
                peerConnection.onicegatheringstatechange = null;
                peerConnection.onsignalingstatechange = null;
                peerConnection.onnegotiationneeded = null;

                peerConnection.close();
            } catch (_) {}
        }

        peerConnection = null;

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
        localAudioTrack = null;

        if (remoteAudio) {
            try {
                remoteAudio.pause();
            } catch (_) {}

            remoteAudio.srcObject = null;
        }

        remoteStream = null;

        pendingIce = [];
        pendingOffer = null;

        activeCall = false;
        outgoingCall = false;

        callTarget = null;
        currentCallId = null;

        hideCallUI();
    }

    /* =========================================================
       EVENTS
       ========================================================= */

    window.addEventListener(
        "gapino:call",
        async event => {
            const data =
                event.detail;

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

            if (
                data.type ===
                "call_offer"
            ) {
                await handleOffer(data);
                return;
            }

            if (
                data.type ===
                "call_answer"
            ) {
                await handleAnswer(data);
                return;
            }

            if (
                data.type ===
                "call_ice"
            ) {
                await handleIce(data);
                return;
            }

            if (
                data.type ===
                "call_reject"
            ) {
                handleReject();
                return;
            }

            if (
                data.type ===
                "call_busy"
            ) {
                handleBusy();
                return;
            }

            if (
                data.type ===
                "call_end"
            ) {
                handleRemoteEnd();
            }
        }
    );

    /* =========================================================
       INIT
       ========================================================= */

    function init() {
        if (initialized) {
            return;
        }

        initialized = true;

        createCallUI();

        document.addEventListener(
            "click",
            () => {
                unlockAudio().catch(
                    () => {}
                );
            },
            {
                once: true,
                passive: true
            }
        );

        document.addEventListener(
            "touchstart",
            () => {
                unlockAudio().catch(
                    () => {}
                );
            },
            {
                once: true,
                passive: true
            }
        );

        window.GAPINO_CALL = {
            start: startCall,

            end: () =>
                endCall(
                    true,
                    true
                ),

            accept: acceptCall,

            reject: rejectCall
        };

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