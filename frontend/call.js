"use strict";

(() => {
    "use strict";

    let pc = null;
    let localStream = null;
    let remoteStream = null;
    let remoteAudio = null;

    let callTarget = null;
    let callId = null;

    let outgoing = false;
    let inCall = false;

    let pendingOffer = null;
    let pendingCandidates = [];

    let callTimer = null;
    let callStartedAt = 0;

    let ringTimer = null;

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

    function $id(id) {
        return document.getElementById(id);
    }

    function currentUser() {
        return window.GAPINO?.currentUser || null;
    }

    function currentChatUser() {
        return window.GAPINO?.currentChatUser || null;
    }

    function socket() {
        return (
            window.GAPINO?.socket ||
            window.GAPINO_SOCKET ||
            null
        );
    }

    function userId(user) {
        if (!user) {
            return "";
        }

        return String(
            user.id ??
            user.user_id ??
            user.uid ??
            ""
        );
    }

    function userName(user) {
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

    function toast(text) {
        const container =
            $id("toastContainer");

        if (!container) {
            console.log(
                "GAPINO:",
                text
            );
            return;
        }

        const item =
            document.createElement("div");

        item.className = "toast";
        item.textContent = text;

        container.appendChild(item);

        setTimeout(() => {
            if (item.parentNode) {
                item.remove();
            }
        }, 3500);
    }

    function send(data) {
        const ws = socket();

        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN
        ) {
            toast(
                "اتصال سرور تماس آماده نیست."
            );

            console.error(
                "GAPINO call: websocket unavailable"
            );

            return false;
        }

        try {
            ws.send(
                JSON.stringify(data)
            );

            console.log(
                "GAPINO call send:",
                data.type
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

    function newCallId() {
        try {
            if (
                crypto &&
                typeof crypto.randomUUID ===
                    "function"
            ) {
                return crypto.randomUUID();
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

    function installStyles() {

        if (
            $id(
                "gapinoVoiceCallStyles"
            )
        ) {
            return;
        }

        const style =
            document.createElement("style");

        style.id =
            "gapinoVoiceCallStyles";

        style.textContent = `
            #gapinoCallOverlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: rgba(0,0,0,.78);
            }

            #gapinoCallOverlay.show {
                display: flex;
            }

            .gapino-call-card {
                width: min(390px, 100%);
                padding: 24px 18px 18px;
                border-radius: 24px;
                background: #111827;
                text-align: center;
                box-shadow: 0 25px 80px rgba(0,0,0,.55);
            }

            .gapino-call-avatar {
                width: 88px;
                height: 88px;
                margin: 0 auto 13px;
                border-radius: 50%;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
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
                margin-top: 7px;
                color: #94a3b8;
                font-size: 13px;
            }

            .gapino-call-timer {
                margin-top: 6px;
                color: #cbd5e1;
                font-size: 12px;
                direction: ltr;
            }

            .gapino-call-actions {
                margin-top: 20px;
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 8px;
            }

            .gapino-call-btn {
                min-width: 120px;
                min-height: 45px;
                padding: 9px 14px;
                border-radius: 12px;
                color: #fff;
                font-size: 13px;
                font-weight: 900;
            }

            .gapino-call-btn.accept {
                background: #16a34a;
            }

            .gapino-call-btn.reject {
                background: #dc2626;
            }

            @media (max-width: 430px) {
                .gapino-call-btn {
                    width: 100%;
                }
            }
        `;

        document.head.appendChild(
            style
        );
    }

    function createUI() {

        installStyles();

        if (
            $id(
                "gapinoCallOverlay"
            )
        ) {
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

        document.body.appendChild(
            overlay
        );

        $id(
            "gapinoAcceptCall"
        )?.addEventListener(
            "click",
            acceptCall
        );

        $id(
            "gapinoRejectCall"
        )?.addEventListener(
            "click",
            rejectCall
        );

        $id(
            "gapinoEndCall"
        )?.addEventListener(
            "click",
            () => {
                endCall(
                    true,
                    true
                );
            }
        );
    }

    function showUI(
        user,
        status
    ) {

        createUI();

        const overlay =
            $id(
                "gapinoCallOverlay"
            );

        const avatar =
            $id(
                "gapinoCallAvatar"
            );

        const name =
            $id(
                "gapinoCallName"
            );

        const state =
            $id(
                "gapinoCallStatus"
            );

        const accept =
            $id(
                "gapinoAcceptCall"
            );

        const reject =
            $id(
                "gapinoRejectCall"
            );

        const end =
            $id(
                "gapinoEndCall"
            );

        overlay?.classList.add(
            "show"
        );

        const displayName =
            userName(user);

        if (name) {
            name.textContent =
                displayName;
        }

        if (state) {
            state.textContent =
                status;
        }

        if (avatar) {

            avatar.innerHTML = "";

            const imageUrl =
                user?.avatar ||
                user?.avatar_url ||
                "";

            if (imageUrl) {

                const image =
                    document.createElement(
                        "img"
                    );

                image.src =
                    imageUrl;

                image.alt =
                    displayName;

                image.onerror =
                    () => {
                        avatar.innerHTML =
                            "";

                        avatar.textContent =
                            displayName
                                .charAt(0)
                                .toUpperCase() ||
                            "G";
                    };

                avatar.appendChild(
                    image
                );

            } else {

                avatar.textContent =
                    displayName
                        .charAt(0)
                        .toUpperCase() ||
                    "G";
            }
        }

        const incoming =
            status.includes(
                "ورودی"
            );

        const connected =
            status.includes(
                "مکالمه"
            );

        if (accept) {
            accept.style.display =
                incoming
                    ? "block"
                    : "none";
        }

        if (reject) {
            reject.style.display =
                connected
                    ? "none"
                    : "block";
        }

        if (end) {
            end.style.display =
                connected
                    ? "block"
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

    function hideUI() {

        const overlay =
            $id(
                "gapinoCallOverlay"
            );

        if (overlay) {
            overlay.classList.remove(
                "show"
            );
        }

        stopRing();
        stopTimer();
    }

    /* =========================================================
       SOUND
       ========================================================= */

    let audioContext = null;

    function audioCtx() {

        if (
            !window.AudioContext &&
            !window.webkitAudioContext
        ) {
            return null;
        }

        if (!audioContext) {

            const Ctx =
                window.AudioContext ||
                window.webkitAudioContext;

            audioContext =
                new Ctx();
        }

        return audioContext;
    }

    async function unlockAudio() {

        const ctx =
            audioCtx();

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

    function beep() {

        const ctx =
            audioCtx();

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
                820;

            const start =
                ctx.currentTime;

            const end =
                start + 0.18;

            gain.gain.setValueAtTime(
                0.0001,
                start
            );

            gain.gain.exponentialRampToValueAtTime(
                0.08,
                start + 0.02
            );

            gain.gain.exponentialRampToValueAtTime(
                0.0001,
                end
            );

            oscillator.connect(
                gain
            );

            gain.connect(
                ctx.destination
            );

            oscillator.start(
                start
            );

            oscillator.stop(
                end + 0.03
            );

        } catch (_) {}
    }

    function startRing() {

        stopRing();

        beep();

        ringTimer =
            setInterval(
                beep,
                1300
            );
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
            $id(
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
            `${String(minutes).padStart(2,"0")}:${String(rest).padStart(2,"0")}`;
    }

    function stopTimer() {

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
                "میکروفون در این مرورگر در دسترس نیست."
            );
        }

        return navigator.mediaDevices.getUserMedia(
            {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            }
        );
    }

    /* =========================================================
       REMOTE AUDIO
       ========================================================= */

    function getRemoteAudio() {

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
        remoteAudio.controls = false;
        remoteAudio.muted = false;
        remoteAudio.volume = 1;

        remoteAudio.style.position =
            "fixed";

        remoteAudio.style.width =
            "1px";

        remoteAudio.style.height =
            "1px";

        remoteAudio.style.left =
            "-10000px";

        remoteAudio.style.top =
            "0";

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

            remoteAudio.muted =
                false;

            remoteAudio.volume =
                1;

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
                "GAPINO audio autoplay:",
                error
            );

            toast(
                "برای شنیدن صدا یک بار روی صفحه ضربه بزن."
            );
        }
    }

    /* =========================================================
       PEER CONNECTION
       ========================================================= */

    function createPeer(targetId) {

        if (pc) {

            try {
                pc.close();
            } catch (_) {}

            pc = null;
        }

        pc =
            new RTCPeerConnection(
                {
                    iceServers: [
                        ...STUN_SERVERS,
                        ...(
                            Array.isArray(
                                window.GAPINO_TURN_SERVERS
                            )
                                ? window.GAPINO_TURN_SERVERS
                                : []
                        )
                    ],
                    iceCandidatePoolSize: 10
                }
            );

        pc.onicecandidate =
            event => {

                if (
                    !event.candidate ||
                    !targetId
                ) {
                    return;
                }

                send({
                    type:
                        "call_ice",

                    receiver_id:
                        Number(
                            targetId
                        ),

                    call_id:
                        callId,

                    candidate:
                        event.candidate
                });
            };

        pc.ontrack =
            event => {

                console.log(
                    "GAPINO remote audio received"
                );

                const stream =
                    event.streams?.[0];

                if (!stream) {
                    return;
                }

                remoteStream =
                    stream;

                const audio =
                    getRemoteAudio();

                audio.srcObject =
                    stream;

                playRemoteAudio();
            };

        pc.onconnectionstatechange =
            () => {

                const state =
                    pc.connectionState;

                console.log(
                    "GAPINO connectionState:",
                    state
                );

                if (
                    state ===
                    "connecting"
                ) {

                    showUI(
                        callTarget,
                        "🔄 در حال اتصال..."
                    );
                }

                if (
                    state ===
                    "connected"
                ) {

                    inCall = true;

                    stopRing();

                    showUI(
                        callTarget,
                        "🟢 در حال مکالمه"
                    );

                    startTimer();

                    playRemoteAudio();
                }

                if (
                    state ===
                    "disconnected"
                ) {

                    showUI(
                        callTarget,
                        "⚠️ ارتباط ناپایدار..."
                    );
                }

                /*
                 * مهم:
                 * دیگر بلافاصله endCall نمی‌کنیم.
                 * ابتدا وضعیت واقعی را به کاربر نشان می‌دهیم.
                 */

                if (
                    state ===
                    "failed"
                ) {

                    console.error(
                        "GAPINO WebRTC failed"
                    );

                    showUI(
                        callTarget,
                        "❌ اتصال تماس برقرار نشد"
                    );

                    toast(
                        "اتصال تماس برقرار نشد. شبکه یا WebRTC را بررسی کن."
                    );
                }

                if (
                    state ===
                    "closed"
                ) {
                    cleanup();
                }
            };

        pc.oniceconnectionstatechange =
            () => {

                console.log(
                    "GAPINO ICE:",
                    pc.iceConnectionState
                );
            };

        return pc;
    }

    async function addLocalAudio() {

        if (!localStream) {
            localStream =
                await getMicrophone();
        }

        const senders =
            pc.getSenders();

        for (
            const track
            of localStream.getTracks()
        ) {

            const exists =
                senders.some(
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
       OUTGOING
       ========================================================= */

    async function startCall(
        explicitUser = null
    ) {

        await unlockAudio();

        if (
            pc ||
            inCall
        ) {

            toast(
                "یک تماس در حال اجراست."
            );

            return;
        }

        const target =
            explicitUser ||
            currentChatUser();

        const targetId =
            userId(target);

        const me =
            currentUser();

        const myId =
            userId(me);

        if (
            !target ||
            !targetId ||
            !myId
        ) {

            toast(
                "ابتدا یک کاربر را انتخاب کن."
            );

            return;
        }

        if (
            targetId ===
            myId
        ) {

            toast(
                "نمی‌توانی با خودت تماس بگیری."
            );

            return;
        }

        const ws =
            socket();

        if (
            !ws ||
            ws.readyState !==
                WebSocket.OPEN
        ) {

            toast(
                "اتصال سرور تماس آماده نیست."
            );

            return;
        }

        callTarget =
            target;

        callId =
            newCallId();

        outgoing =
            true;

        inCall =
            false;

        pendingOffer = null;
        pendingCandidates = [];

        try {

            showUI(
                target,
                "📤 در حال تماس..."
            );

            localStream =
                await getMicrophone();

            createPeer(
                targetId
            );

            await addLocalAudio();

            const offer =
                await pc.createOffer({
                    offerToReceiveAudio: true
                });

            await pc.setLocalDescription(
                offer
            );

            const ok =
                send({
                    type:
                        "call_offer",

                    receiver_id:
                        Number(
                            targetId
                        ),

                    call_id:
                        callId,

                    offer:
                        pc.localDescription
                });

            if (!ok) {
                throw new Error(
                    "offer send failed"
                );
            }

            showUI(
                target,
                "📤 در انتظار پاسخ..."
            );

        } catch (error) {

            console.error(
                "GAPINO outgoing call:",
                error
            );

            cleanup();

            toast(
                "❌ دسترسی به میکروفون یا ایجاد تماس ناموفق بود."
            );
        }
    }

    /* =========================================================
       INCOMING
       ========================================================= */

    async function handleOffer(data) {

        await unlockAudio();

        if (
            pc ||
            inCall
        ) {

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
                ""
            );

        if (!senderId) {
            return;
        }

        const list =
            Array.isArray(
                window.GAPINO?.users
            )
                ? window.GAPINO.users
                : [];

        const caller =
            list.find(
                user =>
                    userId(user) ===
                    senderId
            ) ||
            {
                id: senderId,
                username: "کاربر",
                display_name:
                    "کاربر گپینو"
            };

        if (!data.offer) {
            return;
        }

        callTarget =
            caller;

        callId =
            String(
                data.call_id || ""
            );

        outgoing =
            false;

        inCall =
            false;

        pendingOffer =
            data.offer;

        pendingCandidates = [];

        showUI(
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

        if (
            !pendingOffer ||
            !callTarget
        ) {
            return;
        }

        stopRing();

        try {

            showUI(
                callTarget,
                "🔄 در حال پاسخ..."
            );

            localStream =
                await getMicrophone();

            createPeer(
                userId(
                    callTarget
                )
            );

            await addLocalAudio();

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    pendingOffer
                )
            );

            await flushCandidates();

            const answer =
                await pc.createAnswer({
                    offerToReceiveAudio: true
                });

            await pc.setLocalDescription(
                answer
            );

            const ok =
                send({
                    type:
                        "call_answer",

                    receiver_id:
                        Number(
                            userId(
                                callTarget
                            )
                        ),

                    call_id:
                        callId,

                    answer:
                        pc.localDescription
                });

            if (!ok) {
                throw new Error(
                    "answer send failed"
                );
            }

            pendingOffer =
                null;

            showUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "GAPINO accept:",
                error
            );

            if (callTarget) {

                send({
                    type:
                        "call_reject",

                    receiver_id:
                        Number(
                            userId(
                                callTarget
                            )
                        ),

                    call_id:
                        callId
                });
            }

            cleanup();

            toast(
                "❌ پاسخ تماس انجام نشد."
            );
        }
    }

    /* =========================================================
       ANSWER
       ========================================================= */

    async function handleAnswer(data) {

        if (!pc) {
            return;
        }

        if (
            data.call_id &&
            String(data.call_id) !==
                String(callId)
        ) {
            return;
        }

        if (!data.answer) {
            return;
        }

        try {

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    data.answer
                )
            );

            await flushCandidates();

            showUI(
                callTarget,
                "🔄 در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "GAPINO answer error:",
                error
            );

            showUI(
                callTarget,
                "❌ پاسخ تماس نامعتبر بود"
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
            callId &&
            String(
                data.call_id
            ) !==
            String(
                callId
            )
        ) {
            return;
        }

        if (
            !pc ||
            !pc.remoteDescription
        ) {

            pendingCandidates.push(
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
                "GAPINO add ICE:",
                error
            );
        }
    }

    async function flushCandidates() {

        if (
            !pc ||
            !pc.remoteDescription
        ) {
            return;
        }

        const list =
            pendingCandidates.splice(
                0
            );

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
                    "GAPINO flush ICE:",
                    error
                );
            }
        }
    }

    /* =========================================================
       REJECT / BUSY / END
       ========================================================= */

    function rejectCall() {

        if (callTarget) {

            send({
                type:
                    "call_reject",

                receiver_id:
                    Number(
                        userId(
                            callTarget
                        )
                    ),

                call_id:
                    callId
            });
        }

        cleanup();

        toast(
            "❌ تماس رد شد."
        );
    }

    function handleReject() {

        cleanup();

        toast(
            "❌ تماس رد شد."
        );
    }

    function handleBusy() {

        cleanup();

        toast(
            "📵 کاربر در حال مکالمه است."
        );
    }

    function handleRemoteEnd() {

        cleanup();

        toast(
            "☎️ تماس توسط طرف مقابل پایان یافت."
        );
    }

    function endCall(
        remote = true,
        message = true
    ) {

        if (
            remote &&
            callTarget
        ) {

            send({
                type:
                    "call_end",

                receiver_id:
                    Number(
                        userId(
                            callTarget
                        )
                    ),

                call_id:
                    callId
            });
        }

        cleanup();

        if (message) {

            toast(
                "☎️ تماس پایان یافت."
            );
        }
    }

    /* =========================================================
       CLEANUP
       ========================================================= */

    function cleanup() {

        stopRing();
        stopTimer();

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
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch (_) {}
                    }
                );
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
        pendingCandidates = [];

        outgoing = false;
        inCall = false;

        callTarget = null;
        callId = null;

        hideUI();
    }

    /* =========================================================
       CALL EVENT BRIDGE
       ========================================================= */

    function handleCallEvent(data) {

        if (
            !data ||
            !data.type
        ) {
            return;
        }

        console.log(
            "GAPINO call event:",
            data.type
        );

        switch (
            data.type
        ) {

            case "call_offer":
                handleOffer(
                    data
                );
                break;

            case "call_answer":
                handleAnswer(
                    data
                );
                break;

            case "call_ice":
                handleIce(
                    data
                );
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
     * هماهنگ با chat.js فعلی
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
     * سازگاری نسخه قبلی
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

    function bindCallButton() {

        const button =
            $id("callButton");

        if (
            !button ||
            buttonBound
        ) {
            return;
        }

        buttonBound = true;

        /*
         * این listener تنها listener این فایل است.
         */
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

        createUI();
        bindCallButton();

        const unlock =
            () => {
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
            "GAPINO voice call ready"
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
