id="v1a8kc"
"use strict";

(() => {

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

        return window.GAPINO?.currentUser ||
            null;

    }


    function getCurrentChatUser() {

        return window.GAPINO?.currentChatUser ||
            null;

    }


    function getSocket() {

        return window.GAPINO?.socket ||
            null;

    }


    function send(data) {

        const socket =
            getSocket();

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {

            window.GAPINO?.showToast?.(
                "اتصال گپینو برقرار نیست."
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

            return false;
        }
    }


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
                () => endCall(true)
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
                    getUserName(user);

                avatar.appendChild(
                    img
                );

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
    }


    function hideCallUI() {

        const overlay =
            document.getElementById(
                "gapinoCallOverlay"
            );

        overlay?.classList.remove(
            "show"
        );

        stopTimer();
    }


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
            `${String(
                minutes
            ).padStart(2,"0")}:${String(
                remaining
            ).padStart(2,"0")}`;
    }


    function stopTimer() {

        if (callTimer) {

            clearInterval(
                callTimer
            );

            callTimer =
                null;
        }

        callStartedAt =
            0;
    }


    async function getMicrophone() {

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            throw new Error(
                "microphone_not_supported"
            );
        }

        return navigator
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
    }


    function ensureRemoteAudio() {

        if (remoteAudio) {
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


    function createPeerConnection(
        receiverId
    ) {

        if (peerConnection) {

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
                }
            };


        peerConnection.onconnectionstatechange =
            () => {

                if (!peerConnection) {
                    return;
                }

                const state =
                    peerConnection.connectionState;


                if (
                    state ===
                    "connected"
                ) {

                    activeCall =
                        true;

                    showCallUI(
                        callTarget,
                        "در حال مکالمه"
                    );

                    startTimer();
                }


                if (
                    state ===
                        "failed" ||
                    state ===
                        "closed"
                ) {

                    window.GAPINO?.showToast?.(
                        "ارتباط تماس قطع شد."
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

        if (!localStream) {

            localStream =
                await getMicrophone();

        }


        if (!peerConnection) {
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
       OUTGOING
       ===================================================== */

    async function startCall() {

        if (activeCall) {

            window.GAPINO?.showToast?.(
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

            window.GAPINO?.showToast?.(
                "ابتدا یک کاربر را انتخاب کن."
            );

            return;
        }


        if (
            !target.online &&
            !(
                target.status ===
                "آنلاین"
            )
        ) {

            window.GAPINO?.showToast?.(
                "کاربر آفلاین است."
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
                "در حال تماس..."
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


            if (!sent) {

                cleanup();

                return;
            }

        } catch (error) {

            console.error(
                "Start call error:",
                error
            );

            cleanup();

            window.GAPINO?.showToast?.(
                "دسترسی به میکروفن ممکن نشد."
            );
        }
    }


    /* =====================================================
       INCOMING
       ===================================================== */

    async function handleOffer(
        data
    ) {

        if (activeCall) {

            send({

                type:
                    "call_busy",

                receiver_id:
                    data.sender_id,

                call_id:
                    data.call_id
            });

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
    }


    async function acceptCall() {

        if (
            !pendingOffer ||
            !callTarget
        ) {

            return;
        }


        try {

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
                "در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "Accept call error:",
                error
            );

            window.GAPINO?.showToast?.(
                "برقراری تماس انجام نشد."
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
                "در حال اتصال..."
            );

        } catch (error) {

            console.error(
                "Answer error:",
                error
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

        if (!data.candidate) {
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
            pendingIce.splice(0);


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
       REJECT / BUSY
       ===================================================== */

    function rejectCall() {

        if (callTarget) {

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


        cleanup();
    }


    function handleReject() {

        window.GAPINO?.showToast?.(
            "تماس رد شد."
        );

        cleanup();
    }


    function handleBusy() {

        window.GAPINO?.showToast?.(
            "کاربر در حال مکالمه است."
        );

        cleanup();
    }


    function handleRemoteEnd() {

        window.GAPINO?.showToast?.(
            "تماس پایان یافت."
        );

        cleanup();
    }


    /* =====================================================
       END
       ===================================================== */

    function endCall(
        notify = true,
        showMessage = true
    ) {

        if (
            notify &&
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
            showMessage &&
            activeCall
        ) {

            window.GAPINO?.showToast?.(
                "تماس قطع شد."
            );
        }


        cleanup();
    }


    function cleanup() {

        if (peerConnection) {

            try {
                peerConnection.close();
            } catch (_) {}

        }


        peerConnection =
            null;


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


        localStream =
            null;


        if (remoteAudio) {

            remoteAudio.srcObject =
                null;

            remoteAudio.remove();

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


            if (!data) {
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
       INIT
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
            { once: true }
        );

    } else {

        init();

    }

})();
