"use strict";

(() => {

    /* =====================================================
       GAPINO VOICE CALL
       WebRTC + Notifications + Sound
       ===================================================== */


    const ICE_CONFIG = {
        iceServers: [
            {
                urls: [
                    "stun:stun.l.google.com:19302",
                    "stun:stun1.l.google.com:19302"
                ]
            }
        ]
    };


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


    /* =====================================================
       HELPERS
       ===================================================== */

    function getUserId(user) {

        return String(
            user?.id ||
            user?.user_id ||
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
            null
        );

    }


    function showToast(text) {

        try {

            if (
                window.GAPINO &&
                typeof window.GAPINO.showToast ===
                    "function"
            ) {

                window.GAPINO.showToast(
                    text
                );

                return;

            }

        } catch (_) {}


        console.log(
            "GAPINO:",
            text
        );

    }


    /* =====================================================
       BROWSER NOTIFICATION
       ===================================================== */

    async function requestNotificationPermission() {

        if (
            !("Notification" in window)
        ) {

            return "unsupported";

        }


        if (
            Notification.permission ===
            "granted"
        ) {

            return "granted";

        }


        if (
            Notification.permission ===
            "denied"
        ) {

            return "denied";

        }


        try {

            return await Notification.requestPermission();

        } catch (error) {

            console.warn(
                "Notification permission error:",
                error
            );

            return "denied";

        }

    }


    function browserNotify(
        title,
        body
    ) {

        if (
            !("Notification" in window)
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

            const notification =
                new Notification(
                    title,
                    {
                        body:
                            body,

                        icon:
                            "/favicon.png",

                        badge:
                            "/favicon.png",

                        tag:
                            "gapino-call",

                        renotify:
                            true
                    }
                );


            setTimeout(
                () => {

                    try {
                        notification.close();
                    } catch (_) {}

                },
                6000
            );

        } catch (error) {

            console.warn(
                "Browser notification error:",
                error
            );

        }

    }


    /* =====================================================
       SOUND
       ===================================================== */

    function getAudioContext() {

        if (
            !window.AudioContext &&
            !window.webkitAudioContext
        ) {

            return null;

        }


        if (
            !notificationAudioContext
        ) {

            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            notificationAudioContext =
                new AudioContextClass();

        }


        return notificationAudioContext;

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
        duration = 140,
        volume = 0.06
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


            gain.gain.setValueAtTime(
                0.0001,
                ctx.currentTime
            );


            gain.gain.exponentialRampToValueAtTime(
                volume,
                ctx.currentTime +
                0.02
            );


            gain.gain.exponentialRampToValueAtTime(
                0.0001,
                ctx.currentTime +
                duration / 1000
            );


            oscillator.connect(
                gain
            );


            gain.connect(
                ctx.destination
            );


            oscillator.start();


            oscillator.stop(
                ctx.currentTime +
                duration / 1000 +
                0.03
            );

        } catch (error) {

            console.warn(
                "Call sound error:",
                error
            );

        }

    }


    function startRing() {

        stopRing();


        beep(
            820,
            180,
            0.08
        );


        ringInterval =
            setInterval(
                () => {

                    beep(
                        820,
                        180,
                        0.08
                    );

                },
                1300
            );

    }


    function stopRing() {

        if (
            ringInterval
        ) {

            clearInterval(
                ringInterval
            );

            ringInterval =
                null;

        }

    }


    function notify(
        title,
        body,
        sound = true,
        browser = true
    ) {

        if (sound) {

            beep(
                720,
                150,
                0.07
            );

        }


        showToast(
            `${title}${body ? ` • ${body}` : ""}`
        );


        if (
            browser
        ) {

            browserNotify(
                title,
                body
            );

        }

    }


    /* =====================================================
       SEND
       ===================================================== */

    function send(data) {

        const socket =
            getSocket();


        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {

            notify(
                "اتصال گپینو",
                "اتصال گپینو برقرار نیست.",
                true,
                false
            );

            return false;

        }


        try {

            socket.send(
                JSON.stringify(
                    data
                )
            );


            return true;

        } catch (error) {

            console.error(
                "Call send error:",
                error
            );


            notify(
                "خطای تماس",
                "ارسال اطلاعات تماس انجام نشد.",
                true,
                false
            );


            return false;

        }

    }


    /* =====================================================
       UI
       ===================================================== */

    function createCallUI() {

        if (
            document.getElementById(
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


        overlay.classList.add(
            "show"
        );


        if (avatar) {

            avatar.innerHTML =
                "";


            const url =
                user?.avatar ||
                user?.profile?.avatar ||
                "";


            if (url) {

                const img =
                    document.createElement(
                        "img"
                    );


                img.src =
                    url;


                img.alt =
                    getUserName(
                        user
                    );


                avatar.appendChild(
                    img
                );

            } else {

                avatar.textContent =
                    getUserName(
                        user
                    )
                        .charAt(0)
                        .toUpperCase() ||
                    "G";

            }

        }


        if (name) {

            name.textContent =
                getUserName(
                    user
                );

        }


        if (statusEl) {

            statusEl.textContent =
                status;

        }


        const incoming =
            status.includes(
                "ورودی"
            );


        const connected =
            status.includes(
                "مکالمه"
            );


        const connecting =
            status.includes(
                "اتصال"
            );


        if (accept) {

            accept.style.display =
                incoming
                    ? "flex"
                    : "none";

        }


        if (reject) {

            reject.style.display =
                incoming ||
                !connected
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


        if (
            connected
        ) {

            stopRing();

        }

    }


    function hideCallUI() {

        const overlay =
            document.getElementById(
                "gapinoCallOverlay"
            );


        overlay?.classList.remove(
            "show"
        );


        stopRing();

        stopTimer();

    }


    /* =====================================================
       TIMER
       ===================================================== */

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
                seconds /
                60
            );


        const remaining =
            seconds %
            60;


        timer.textContent =
            `${String(
                minutes
            ).padStart(
                2,
                "0"
            )}:${String(
                remaining
            ).padStart(
                2,
                "0"
            )}`;

    }


    function stopTimer() {

        if (
            callTimer
        ) {

            clearInterval(
                callTimer
            );


            callTimer =
                null;

        }


        callStartedAt =
            0;

    }


    /* =====================================================
       MICROPHONE
       ===================================================== */

    async function getMicrophone() {

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            throw new Error(
                "microphone_not_supported"
            );

        }


        notify(
            "🎙️ میکروفن",
            "درخواست دسترسی به میکروفن...",
            false,
            false
        );


        try {

            const stream =
                await navigator
                    .mediaDevices
                    .getUserMedia({
                        audio: {
                            echoCancellation:
                                true,

                            noiseSuppression:
                                true,

                            autoGainControl:
                                true
                        },

                        video:
                            false
                    });


            notify(
                "🎙️ میکروفن فعال شد",
                "دسترسی به میکروفن برقرار است.",
                true,
                false
            );


            return stream;

        } catch (error) {

            notify(
                "❌ میکروفن",
                "دسترسی به میکروفن داده نشد.",
                true,
                false
            );


            throw error;

        }

    }


    /* =====================================================
       REMOTE AUDIO
       ===================================================== */

    function ensureRemoteAudio() {

        if (
            remoteAudio
        ) {

            return remoteAudio;

        }


        remoteAudio =
            document.createElement(
                "audio"
            );


        remoteAudio.id =
            "gapinoRemoteAudio";


        remoteAudio.autoplay =
            true;


        remoteAudio.playsInline =
            true;


        remoteAudio.style.display =
            "none";


        document.body.appendChild(
            remoteAudio
        );


        return remoteAudio;

    }


    /* =====================================================
       PEER CONNECTION
       ===================================================== */

    function createPeerConnection(
        receiverId
    ) {

        if (
            peerConnection
        ) {

            try {

                peerConnection.close();

            } catch (_) {}

        }


        peerConnection =
            new RTCPeerConnection(
                ICE_CONFIG
            );


        peerConnection.onicecandidate =
            event => {

                if (
                    !event.candidate ||
                    !callTarget
                ) {

                    return;

                }


                send({

                    type:
                        "call_ice",

                    receiver_id:
                        receiverId,

                    call_id:
                        currentCallId,

                    candidate:
                        event.candidate

                });

            };


        peerConnection.ontrack =
            event => {

                const audio =
                    ensureRemoteAudio();


                if (
                    event.streams &&
                    event.streams[0]
                ) {

                    audio.srcObject =
                        event.streams[0];


                    audio.play().catch(
                        () => {}
                    );


                    notify(
                        "🟢 تماس وصل شد",
                        `در حال مکالمه با ${getUserName(callTarget)}`,
                        false,
                        false
                    );

                }

            };


        peerConnection.onconnectionstatechange =
            () => {

                if (
                    !peerConnection
                ) {

                    return;

                }


                const state =
                    peerConnection
                        .connectionState;


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


                    startTimer();


                    notify(
                        "🟢 تماس برقرار شد",
                        `مکالمه با ${getUserName(callTarget)} شروع شد.`,
                        true,
                        false
                    );

                }


                if (
                    state ===
                        "disconnected"
                ) {

                    notify(
                        "📡 اتصال تماس",
                        "ارتباط تماس ناپایدار یا قطع شده است.",
                        true,
                        false
                    );

                }


                if (
                    state ===
                        "failed" ||
                    state ===
                        "closed"
                ) {

                    notify(
                        "❌ تماس",
                        "ارتباط تماس قطع شد.",
                        true,
                        false
                    );


                    endCall(
                        true,
                        false
                    );

                }

            };


        return peerConnection;

    }


    async function addLocalTracks() {

        if (
            !localStream
        ) {

            localStream =
                await getMicrophone();

        }


        if (
            !peerConnection
        ) {

            return;

        }


        for (
            const track
            of localStream.getTracks()
        ) {

            peerConnection.addTrack(
                track,
                localStream
            );

        }

    }


    /* =====================================================
       OUTGOING CALL
       ===================================================== */

    async function startCall() {

        await unlockAudio();

        await requestNotificationPermission();


        if (
            activeCall
        ) {

            notify(
                "📞 تماس",
                "یک تماس در حال اجراست.",
                true,
                false
            );

            return;

        }


        const target =
            getCurrentChatUser();


        const targetId =
            getUserId(
                target
            );


        const me =
            getCurrentUser();


        const myId =
            getUserId(
                me
            );


        if (
            !target ||
            !targetId ||
            !myId
        ) {

            notify(
                "📞 تماس",
                "ابتدا یک کاربر را انتخاب کن.",
                true,
                false
            );

            return;

        }


        if (
            !target.online &&
            target.status !==
                "آنلاین"
        ) {

            notify(
                "📵 تماس",
                "کاربر آفلاین است.",
                true,
                false
            );

            return;

        }


        currentCallId =
            window.crypto?.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`;


        callTarget =
            target;


        outgoingCall =
            true;


        activeCall =
            false;


        try {

            showCallUI(
                target,
                "📤 در حال تماس..."
            );


            notify(
                "📞 تماس خروجی",
                `در حال تماس با ${getUserName(target)}`,
                true,
                false
            );


            localStream =
                await getMicrophone();


            createPeerConnection(
                targetId
            );


            await addLocalTracks();


            const offer =
                await peerConnection
                    .createOffer();


            await peerConnection
                .setLocalDescription(
                    offer
                );


            const sent =
                send({

                    type:
                        "call_offer",

                    receiver_id:
                        targetId,

                    call_id:
                        currentCallId,

                    offer:
                        peerConnection
                            .localDescription

                });


            if (
                !sent
            ) {

                cleanup();

                return;

            }

        } catch (error) {

            console.error(
                "Start call error:",
                error
            );


            cleanup();


            notify(
                "❌ تماس",
                "برقراری تماس انجام نشد.",
                true,
                false
            );

        }

    }


    /* =====================================================
       INCOMING CALL
       ===================================================== */

    async function handleOffer(
        data
    ) {

        await unlockAudio();

        await requestNotificationPermission();


        if (
            activeCall
        ) {

            send({

                type:
                    "call_busy",

                receiver_id:
                    data.sender_id,

                call_id:
                    data.call_id

            });


            notify(
                "📵 تماس ورودی",
                "شما در حال مکالمه هستید.",
                true,
                false
            );


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
                    getUserId(
                        user
                    ) ===
                    String(
                        data.sender_id
                    )
            ) ||
            {
                id:
                    String(
                        data.sender_id
                    ),

                name:
                    "کاربر گپینو"
            };


        callTarget =
            caller;


        currentCallId =
            String(
                data.call_id ||
                ""
            );


        outgoingCall =
            false;


        activeCall =
            false;


        pendingOffer =
            data.offer;


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


    /* =====================================================
       ACCEPT CALL
       ===================================================== */

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

            notify(
                "✅ تماس",
                "در حال پاسخ به تماس...",
                true,
                false
            );


            localStream =
                await getMicrophone();


            createPeerConnection(
                getUserId(
                    callTarget
                )
            );


            await addLocalTracks();


            await peerConnection
                .setRemoteDescription(
                    new RTCSessionDescription(
                        pendingOffer
                    )
                );


            await flushIce();


            const answer =
                await peerConnection
                    .createAnswer();


            await peerConnection
                .setLocalDescription(
                    answer
                );


            send({

                type:
                    "call_answer",

                receiver_id:
                    getUserId(
                        callTarget
                    ),

                call_id:
                    currentCallId,

                answer:
                    peerConnection
                        .localDescription

            });


            pendingOffer =
                null;


            showCallUI(
                callTarget,
                "🔄 در حال اتصال..."
            );


            notify(
                "🔄 تماس",
                "در حال اتصال...",
                false,
                false
            );

        } catch (error) {

            console.error(
                "Accept call error:",
                error
            );


            notify(
                "❌ تماس",
                "پاسخ به تماس انجام نشد.",
                true,
                false
            );


            endCall(
                true,
                false
            );

        }

    }


    /* =====================================================
       ANSWER
       ===================================================== */

    async function handleAnswer(
        data
    ) {

        if (
            !peerConnection ||
            !outgoingCall
        ) {

            return;

        }


        if (
            String(
                data.call_id
            ) !==
            String(
                currentCallId
            )
        ) {

            return;

        }


        try {

            await peerConnection
                .setRemoteDescription(
                    new RTCSessionDescription(
                        data.answer
                    )
                );


            await flushIce();


            showCallUI(
                callTarget,
                "🔄 در حال اتصال..."
            );


            notify(
                "✅ پاسخ تماس",
                `${getUserName(callTarget)} تماس را پذیرفت.`,
                true,
                false
            );

        } catch (error) {

            console.error(
                "Answer error:",
                error
            );


            notify(
                "❌ تماس",
                "پاسخ تماس نامعتبر بود.",
                true,
                false
            );


            endCall(
                true,
                false
            );

        }

    }


    /* =====================================================
       ICE
       ===================================================== */

    async function handleIce(
        data
    ) {

        if (
            !data.candidate
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

            await peerConnection
                .addIceCandidate(
                    new RTCIceCandidate(
                        data.candidate
                    )
                );

        } catch (error) {

            console.warn(
                "ICE error:",
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
            pendingIce.splice(
                0
            );


        for (
            const candidate
            of list
        ) {

            try {

                await peerConnection
                    .addIceCandidate(
                        new RTCIceCandidate(
                            candidate
                        )
                    );

            } catch (_) {}

        }

    }


    /* =====================================================
       REJECT
       ===================================================== */

    function rejectCall() {

        stopRing();


        if (
            callTarget
        ) {

            send({

                type:
                    "call_reject",

                receiver_id:
                    getUserId(
                        callTarget
                    ),

                call_id:
                    currentCallId

            });

        }


        notify(
            "❌ تماس",
            "تماس رد شد.",
            true,
            false
        );


        cleanup();

    }


    function handleReject() {

        stopRing();


        notify(
            "❌ تماس",
            "تماس شما رد شد.",
            true,
            true
        );


        cleanup();

    }


    /* =====================================================
       BUSY
       ===================================================== */

    function handleBusy() {

        stopRing();


        notify(
            "📵 تماس",
            "کاربر در حال مکالمه است.",
            true,
            true
        );


        cleanup();

    }


    /* =====================================================
       REMOTE END
       ===================================================== */

    function handleRemoteEnd() {

        stopRing();


        notify(
            "☎️ تماس پایان یافت",
            `تماس با ${getUserName(callTarget)}`,
            true,
            true
        );


        cleanup();

    }


    /* =====================================================
       END CALL
       ===================================================== */

    function endCall(
        notifyRemote = true,
        showMessage = true
    ) {

        stopRing();


        const targetName =
            callTarget
                ? getUserName(
                    callTarget
                )
                : "کاربر";


        if (
            notifyRemote &&
            callTarget
        ) {

            send({

                type:
                    "call_end",

                receiver_id:
                    getUserId(
                        callTarget
                    ),

                call_id:
                    currentCallId

            });

        }


        if (
            showMessage
        ) {

            notify(
                "☎️ تماس",
                "تماس قطع شد.",
                true,
                false
            );

        }


        cleanup();

    }


    /* =====================================================
       CLEANUP
       ===================================================== */

    function cleanup() {

        stopRing();


        if (
            peerConnection
        ) {

            try {

                peerConnection.close();

            } catch (_) {}

        }


        peerConnection =
            null;


        if (
            localStream
        ) {

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


        localStream =
            null;


        if (
            remoteAudio
        ) {

            remoteAudio.srcObject =
                null;


            try {

                remoteAudio.remove();

            } catch (_) {}


            remoteAudio =
                null;

        }


        pendingIce =
            [];


        pendingOffer =
            null;


        activeCall =
            false;


        outgoingCall =
            false;


        callTarget =
            null;


        currentCallId =
            null;


        hideCallUI();

    }


    /* =====================================================
       EVENTS
       ===================================================== */

    window.addEventListener(
        "gapino:call",
        async event => {

            const data =
                event.detail;


            if (
                !data
            ) {

                return;

            }


            if (
                data.type ===
                "call_offer"
            ) {

                await handleOffer(
                    data
                );

                return;

            }


            if (
                data.type ===
                "call_answer"
            ) {

                await handleAnswer(
                    data
                );

                return;

            }


            if (
                data.type ===
                "call_ice"
            ) {

                await handleIce(
                    data
                );

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


    /* =====================================================
       INITIALIZATION
       ===================================================== */

    function init() {

        createCallUI();


        window.GAPINO_CALL = {

            start:
                startCall,

            end:
                () => endCall(
                    true,
                    true
                ),

            accept:
                acceptCall,

            reject:
                rejectCall

        };

    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once:
                    true
            }
        );

    } else {

        init();

    }

})();
