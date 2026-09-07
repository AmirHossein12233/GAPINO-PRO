"use strict";

/*
 * =========================================================
 * GAPINO LIVE
 * WebRTC Live Streaming
 * Camera + Microphone
 * Viewer Counter
 * Live Chat
 * Screen Sharing
 *
 * نکته:
 * این فایل سمت فرانت‌اند کامل است.
 * برای عبور پیام‌های live بین چند کاربر باید
 * بخش live signaling نیز در main.py اضافه شود.
 * =========================================================
 */

(() => {

    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = {
        API:
            window.GAPINO_LIVE_CONFIG?.apiBase ||
            window.location.origin,

        WS_PATH:
            window.GAPINO_LIVE_CONFIG?.websocketPath ||
            "/ws",

        ROOM_ID:
            window.GAPINO_LIVE_CONFIG?.roomId ||
            "",

        AUTO_JOIN:
            Boolean(
                window.GAPINO_LIVE_CONFIG?.autoJoin
            )
    };


    /* =====================================================
       ICE
       ===================================================== */

    const ICE_SERVERS = [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        },

        ...(Array.isArray(
            window.GAPINO_TURN_SERVERS
        )
            ? window.GAPINO_TURN_SERVERS
            : [])
    ];


    /* =====================================================
       STATE
       ===================================================== */

    let currentUser = null;

    let socket = null;

    let localStream = null;

    let screenStream = null;

    let liveRoomId =
        CONFIG.ROOM_ID;

    let isHost = false;

    let isLive = false;

    let micEnabled = true;

    let cameraEnabled = true;

    let sharingScreen = false;

    let liveStartedAt = 0;

    let liveTimer = null;

    let manuallyClosed = false;

    let reconnectTimer = null;

    let viewerCount = 0;

    const peers = new Map();


    /* =====================================================
       DOM
       ===================================================== */

    const liveVideo =
        document.getElementById(
            "liveVideo"
        );

    const livePlaceholder =
        document.getElementById(
            "livePlaceholder"
        );

    const liveBadge =
        document.getElementById(
            "liveBadge"
        );

    const viewerCountElement =
        document.getElementById(
            "viewerCount"
        );

    const chatViewerCount =
        document.getElementById(
            "chatViewerCount"
        );

    const liveStatusText =
        document.getElementById(
            "liveStatusText"
        );

    const liveDuration =
        document.getElementById(
            "liveDuration"
        );

    const liveHostAvatar =
        document.getElementById(
            "liveHostAvatar"
        );

    const liveHostName =
        document.getElementById(
            "liveHostName"
        );

    const liveHostStatus =
        document.getElementById(
            "liveHostStatus"
        );

    const liveMicButton =
        document.getElementById(
            "liveMicButton"
        );

    const liveCameraButton =
        document.getElementById(
            "liveCameraButton"
        );

    const liveScreenButton =
        document.getElementById(
            "liveScreenButton"
        );

    const startLiveButton =
        document.getElementById(
            "startLiveButton"
        );

    const stopLiveButton =
        document.getElementById(
            "stopLiveButton"
        );

    const liveBackButton =
        document.getElementById(
            "liveBackButton"
        );

    const liveCloseButton =
        document.getElementById(
            "liveCloseButton"
        );

    const shareLiveButton =
        document.getElementById(
            "shareLiveButton"
        );

    const startLivePanel =
        document.getElementById(
            "startLivePanel"
        );

    const confirmStartLive =
        document.getElementById(
            "confirmStartLive"
        );

    const cancelStartLive =
        document.getElementById(
            "cancelStartLive"
        );

    const liveChatMessages =
        document.getElementById(
            "liveChatMessages"
        );

    const liveChatEmpty =
        document.getElementById(
            "liveChatEmpty"
        );

    const liveChatForm =
        document.getElementById(
            "liveChatForm"
        );

    const liveChatInput =
        document.getElementById(
            "liveChatInput"
        );

    const liveChatSend =
        document.getElementById(
            "liveChatSend"
        );


    /* =====================================================
       HELPERS
       ===================================================== */

    function safeText(value) {
        return String(
            value ?? ""
        );
    }


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
            "کاربر گپینو"
        );
    }


    function getAvatar(user) {
        const avatar =
            user?.avatar ||
            user?.profile?.avatar ||
            "";

        if (!avatar) {
            return "";
        }

        const value =
            String(avatar);

        if (
            value.startsWith(
                "http://"
            ) ||
            value.startsWith(
                "https://"
            ) ||
            value.startsWith("/")
        ) {
            return value;
        }

        return "/" + value;
    }


    function getAvatarLetter(user) {
        return (
            getUserName(user)
                .trim()
                .charAt(0)
                .toUpperCase() ||
            "G"
        );
    }


    function setAvatar(
        element,
        user
    ) {
        if (!element) {
            return;
        }

        element.innerHTML = "";

        const url =
            getAvatar(user);

        if (!url) {
            element.textContent =
                getAvatarLetter(
                    user
                );

            return;
        }

        const img =
            document.createElement(
                "img"
            );

        img.src = url;

        img.alt =
            getUserName(user);

        img.onerror = () => {
            element.innerHTML =
                "";

            element.textContent =
                getAvatarLetter(
                    user
                );
        };

        element.appendChild(
            img
        );
    }


    function makeRoomId() {
        return (
            "live-" +
            Date.now().toString(
                36
            ) +
            "-" +
            Math.random()
                .toString(36)
                .slice(2, 10)
        );
    }


    function makePeerId() {
        try {
            if (
                window.crypto &&
                typeof
                    window.crypto.randomUUID ===
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


    const peerId =
        makePeerId();


    /* =====================================================
       TOAST
       ===================================================== */

    function toast(message) {
        console.log(
            "GAPINO LIVE:",
            message
        );

        if (
            window.GAPINO &&
            typeof
                window.GAPINO.showToast ===
                "function"
        ) {
            try {
                window.GAPINO.showToast(
                    message
                );

                return;
            } catch (_) {}
        }
    }


    /* =====================================================
       API
       ===================================================== */

    async function apiFetch(
        path,
        options = {}
    ) {
        const response =
            await fetch(
                CONFIG.API +
                    path,
                {
                    credentials:
                        "include",

                    cache:
                        "no-store",

                    ...options
                }
            );

        let data = null;

        try {
            data =
                await response.json();
        } catch (_) {}

        if (!response.ok) {
            throw new Error(
                data?.detail ||
                data?.message ||
                `HTTP ${response.status}`
            );
        }

        return data;
    }


    /* =====================================================
       CURRENT USER
       ===================================================== */

    async function loadCurrentUser() {

        try {

            const data =
                await apiFetch(
                    "/api/me"
                );

            currentUser =
                data?.user ||
                (
                    data?.id
                        ? data
                        : null
                );

            if (
                !currentUser
            ) {
                throw new Error(
                    "Session not found"
                );
            }

            return currentUser;

        } catch (error) {

            console.warn(
                "GAPINO LIVE session:",
                error
            );

            /*
             * fallback برای localStorage
             */

            try {
                const saved =
                    localStorage.getItem(
                        "gapino_user"
                    );

                if (saved) {
                    currentUser =
                        JSON.parse(
                            saved
                        );
                }
            } catch (_) {}

            if (
                !currentUser
            ) {
                window.location.replace(
                    "/login.html"
                );

                return null;
            }

            return currentUser;
        }
    }


    /* =====================================================
       WEBSOCKET URL
       ===================================================== */

    function websocketUrl() {

        const protocol =
            location.protocol ===
            "https:"
                ? "wss:"
                : "ws:";

        return (
            `${protocol}//` +
            location.host +
            CONFIG.WS_PATH
        );
    }


    /* =====================================================
       SOCKET
       ===================================================== */

    function connectSocket() {

        if (
            manuallyClosed
        ) {
            return;
        }

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

        const url =
            websocketUrl();

        console.log(
            "GAPINO LIVE WebSocket:",
            url
        );

        try {

            socket =
                new WebSocket(
                    url
                );

        } catch (error) {

            console.error(
                "LIVE socket create:",
                error
            );

            scheduleReconnect();

            return;
        }


        socket.addEventListener(
            "open",
            () => {

                console.log(
                    "GAPINO LIVE WebSocket connected"
                );

                clearTimeout(
                    reconnectTimer
                );

                sendSocket({
                    type:
                        "live_join",

                    room_id:
                        liveRoomId,

                    peer_id:
                        peerId,

                    user_id:
                        getUserId(
                            currentUser
                        ),

                    host:
                        isHost
                });
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
                    "GAPINO LIVE socket closed"
                );

                /*
                 * اگر در لایو هستیم، سعی می‌کنیم
                 * دوباره وصل شویم.
                 */

                if (
                    !manuallyClosed
                ) {
                    scheduleReconnect();
                }
            }
        );


        socket.addEventListener(
            "error",
            error => {

                console.error(
                    "GAPINO LIVE socket error:",
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
                    connectSocket();
                },
                2500
            );
    }


    function sendSocket(
        data
    ) {

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
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
                "LIVE socket send:",
                error
            );

            return false;
        }
    }


    /* =====================================================
       SOCKET MESSAGE
       ===================================================== */

    async function handleSocketMessage(
        raw
    ) {

        let data;

        try {

            data =
                typeof raw ===
                "string"
                    ? JSON.parse(raw)
                    : raw;

        } catch (error) {

            console.warn(
                "LIVE invalid JSON:",
                error
            );

            return;
        }


        if (
            !data ||
            !data.type
        ) {
            return;
        }


        console.log(
            "GAPINO LIVE event:",
            data
        );


        /* =========================
           LIVE PEER JOIN
           ========================= */

        if (
            data.type ===
            "live_peer_join"
        ) {

            if (
                !isHost
            ) {
                return;
            }

            const remotePeerId =
                safeText(
                    data.peer_id
                );

            if (
                !remotePeerId ||
                remotePeerId ===
                    peerId
            ) {
                return;
            }

            await createPeerOffer(
                remotePeerId
            );

            return;
        }


        /* =========================
           OFFER
           ========================= */

        if (
            data.type ===
            "live_offer"
        ) {

            await handleOffer(
                data
            );

            return;
        }


        /* =========================
           ANSWER
           ========================= */

        if (
            data.type ===
            "live_answer"
        ) {

            await handleAnswer(
                data
            );

            return;
        }


        /* =========================
           ICE
           ========================= */

        if (
            data.type ===
            "live_ice"
        ) {

            await handleIce(
                data
            );

            return;
        }


        /* =========================
           PEER LEFT
           ========================= */

        if (
            data.type ===
            "live_peer_left"
        ) {

            const remotePeerId =
                safeText(
                    data.peer_id
                );

            removePeer(
                remotePeerId
            );

            return;
        }


        /* =========================
           VIEWERS
           ========================= */

        if (
            data.type ===
            "live_viewers"
        ) {

            updateViewerCount(
                Number(
                    data.count || 0
                )
            );

            return;
        }


        /* =========================
           LIVE START
           ========================= */

        if (
            data.type ===
            "live_started"
        ) {

            isLive =
                true;

            updateLiveUI();

            if (
                data.host
            ) {
                liveHostStatus.textContent =
                    "در حال پخش زنده";
            }

            return;
        }


        /* =========================
           LIVE STOP
           ========================= */

        if (
            data.type ===
            "live_stopped"
        ) {

            isLive =
                false;

            isHost =
                false;

            updateLiveUI();

            toast(
                "پخش زنده پایان یافت."
            );

            return;
        }


        /* =========================
           LIVE CHAT
           ========================= */

        if (
            data.type ===
            "live_chat"
        ) {

            appendLiveChatMessage(
                data
            );

            return;
        }
    }


    /* =====================================================
       MEDIA
       ===================================================== */

    async function requestMedia() {

        if (
            localStream
        ) {
            return localStream;
        }

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {
            throw new Error(
                "مرورگر از دوربین و میکروفن پشتیبانی نمی‌کند."
            );
        }

        localStream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: {
                        echoCancellation:
                            true,

                        noiseSuppression:
                            true,

                        autoGainControl:
                            true,

                        channelCount:
                            1
                    },

                    video: {
                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        },

                        frameRate: {
                            ideal: 30,
                            max: 30
                        },

                        facingMode:
                            "user"
                    }
                });

        const audioTrack =
            localStream
                .getAudioTracks()[0];

        if (audioTrack) {

            try {

                const capabilities =
                    audioTrack.getCapabilities
                        ? audioTrack
                            .getCapabilities()
                        : {};

                const constraints = {};

                if (
                    "echoCancellation" in
                    capabilities
                ) {
                    constraints
                        .echoCancellation =
                        true;
                }

                if (
                    "noiseSuppression" in
                    capabilities
                ) {
                    constraints
                        .noiseSuppression =
                        true;
                }

                if (
                    "autoGainControl" in
                    capabilities
                ) {
                    constraints
                        .autoGainControl =
                        true;
                }

                if (
                    Object.keys(
                        constraints
                    ).length
                ) {
                    await audioTrack
                        .applyConstraints(
                            constraints
                        );
                }

            } catch (error) {

                console.warn(
                    "LIVE audio constraints:",
                    error
                );
            }
        }

        if (
            liveVideo
        ) {

            liveVideo.srcObject =
                localStream;

            liveVideo.muted =
                true;

            liveVideo.autoplay =
                true;

            liveVideo.playsInline =
                true;

            try {
                await liveVideo.play();
            } catch (_) {}
        }

        cameraEnabled =
            true;

        micEnabled =
            true;

        return localStream;
    }


    /* =====================================================
       PEER CONNECTION
       ===================================================== */

    function createPeerConnection(
        remotePeerId
    ) {

        if (
            peers.has(
                remotePeerId
            )
        ) {
            return peers.get(
                remotePeerId
            ).pc;
        }


        const pc =
            new RTCPeerConnection({
                iceServers:
                    ICE_SERVERS,

                iceCandidatePoolSize:
                    10,

                bundlePolicy:
                    "max-bundle",

                rtcpMuxPolicy:
                    "require"
            });


        const state = {
            pc,
            remotePeerId,
            pendingIce: []
        };


        peers.set(
            remotePeerId,
            state
        );


        /*
         * ارسال Media
         */

        if (
            isHost &&
            localStream
        ) {

            for (
                const track
                of localStream.getTracks()
            ) {

                pc.addTrack(
                    track,
                    localStream
                );
            }
        }


        /*
         * ICE
         */

        pc.onicecandidate =
            event => {

                if (
                    !event.candidate
                ) {
                    return;
                }

                sendSocket({
                    type:
                        "live_ice",

                    room_id:
                        liveRoomId,

                    peer_id:
                        peerId,

                    target_peer_id:
                        remotePeerId,

                    candidate:
                        event.candidate
                });
            };


        /*
         * Remote media
         */

        pc.ontrack =
            event => {

                console.log(
                    "GAPINO LIVE remote track:",
                    event
                );

                let stream =
                    event.streams?.[0];

                if (
                    !stream
                ) {
                    stream =
                        new MediaStream();

                    stream.addTrack(
                        event.track
                    );
                }

                attachRemoteStream(
                    stream
                );
            };


        /*
         * Connection
         */

        pc.onconnectionstatechange =
            () => {

                const connectionState =
                    pc.connectionState;

                console.log(
                    "GAPINO LIVE connection:",
                    remotePeerId,
                    connectionState
                );

                if (
                    connectionState ===
                        "connected"
                ) {
                    updateViewerConnection();
                }

                if (
                    connectionState ===
                        "failed" ||
                    connectionState ===
                        "closed"
                ) {
                    removePeer(
                        remotePeerId
                    );
                }
            };


        /*
         * ICE state
         */

        pc.oniceconnectionstatechange =
            () => {

                console.log(
                    "GAPINO LIVE ICE:",
                    remotePeerId,
                    pc.iceConnectionState
                );
            };


        return pc;
    }


    /* =====================================================
       PEER OFFER
       ===================================================== */

    async function createPeerOffer(
        remotePeerId
    ) {

        if (
            !isHost ||
            !localStream
        ) {
            return;
        }

        try {

            const pc =
                createPeerConnection(
                    remotePeerId
                );

            const offer =
                await pc.createOffer({
                    offerToReceiveAudio:
                        true,

                    offerToReceiveVideo:
                        true
                });

            await pc.setLocalDescription(
                offer
            );

            sendSocket({
                type:
                    "live_offer",

                room_id:
                    liveRoomId,

                peer_id:
                    peerId,

                target_peer_id:
                    remotePeerId,

                offer:
                    pc.localDescription
            });

        } catch (error) {

            console.error(
                "LIVE create offer:",
                error
            );

            toast(
                "اتصال بیننده برقرار نشد."
            );
        }
    }


    /* =====================================================
       HANDLE OFFER
       ===================================================== */

    async function handleOffer(
        data
    ) {

        const remotePeerId =
            safeText(
                data.peer_id
            );

        if (
            !remotePeerId
        ) {
            return;
        }

        try {

            if (
                !localStream &&
                !isHost
            ) {
                /*
                 * بیننده نیازی به getUserMedia ندارد.
                 */
            }

            const pc =
                createPeerConnection(
                    remotePeerId
                );

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    data.offer
                )
            );

            const state =
                peers.get(
                    remotePeerId
                );

            if (
                state &&
                state.pendingIce.length
            ) {

                for (
                    const candidate
                    of state.pendingIce
                ) {

                    try {

                        await pc.addIceCandidate(
                            new RTCIceCandidate(
                                candidate
                            )
                        );

                    } catch (_) {}
                }

                state.pendingIce =
                    [];
            }

            const answer =
                await pc.createAnswer({
                    offerToReceiveAudio:
                        true,

                    offerToReceiveVideo:
                        true
                });

            await pc.setLocalDescription(
                answer
            );

            sendSocket({
                type:
                    "live_answer",

                room_id:
                    liveRoomId,

                peer_id:
                    peerId,

                target_peer_id:
                    remotePeerId,

                answer:
                    pc.localDescription
            });

        } catch (error) {

            console.error(
                "LIVE handle offer:",
                error
            );
        }
    }


    /* =====================================================
       HANDLE ANSWER
       ===================================================== */

    async function handleAnswer(
        data
    ) {

        const remotePeerId =
            safeText(
                data.peer_id
            );

        const state =
            peers.get(
                remotePeerId
            );

        if (
            !state
        ) {
            return;
        }

        const pc =
            state.pc;

        try {

            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    data.answer
                )
            );

            for (
                const candidate
                of state.pendingIce
            ) {

                try {

                    await pc.addIceCandidate(
                        new RTCIceCandidate(
                            candidate
                        )
                    );

                } catch (_) {}
            }

            state.pendingIce =
                [];

        } catch (error) {

            console.error(
                "LIVE handle answer:",
                error
            );
        }
    }


    /* =====================================================
       HANDLE ICE
       ===================================================== */

    async function handleIce(
        data
    ) {

        const remotePeerId =
            safeText(
                data.peer_id
            );

        const state =
            peers.get(
                remotePeerId
            );

        if (
            !state
        ) {
            /*
             * Peer هنوز ساخته نشده.
             */

            const pc =
                createPeerConnection(
                    remotePeerId
                );

            const newState =
                peers.get(
                    remotePeerId
                );

            if (
                !pc.remoteDescription
            ) {

                newState.pendingIce.push(
                    data.candidate
                );

                return;
            }
        }

        const peer =
            peers.get(
                remotePeerId
            );

        if (
            !peer
        ) {
            return;
        }

        try {

            if (
                peer.pc.remoteDescription
            ) {

                await peer.pc
                    .addIceCandidate(
                        new RTCIceCandidate(
                            data.candidate
                        )
                    );

            } else {

                peer.pendingIce.push(
                    data.candidate
                );
            }

        } catch (error) {

            console.warn(
                "LIVE ICE error:",
                error
            );
        }
    }


    /* =====================================================
       REMOTE VIDEO
       ===================================================== */

    function attachRemoteStream(
        stream
    ) {

        /*
         * برای معماری یک Host:
         * stream را مستقیماً روی liveVideo
         * قرار می‌دهیم.
         *
         * اگر Host باشیم، ویدیوی خودمان
         * نمایش داده می‌شود.
         */

        if (
            isHost
        ) {
            return;
        }

        if (
            !liveVideo
        ) {
            return;
        }

        liveVideo.srcObject =
            stream;

        liveVideo.muted =
            false;

        liveVideo.controls =
            false;

        liveVideo.autoplay =
            true;

        liveVideo.playsInline =
            true;

        if (
            livePlaceholder
        ) {
            livePlaceholder.style.display =
                "none";
        }

        const promise =
            liveVideo.play();

        if (
            promise &&
            typeof promise.catch ===
                "function"
        ) {

            promise.catch(
                error => {

                    console.warn(
                        "LIVE autoplay:",
                        error
                    );

                    toast(
                        "برای شنیدن صدای لایو یک بار روی صفحه بزن."
                    );
                }
            );
        }
    }


    /* =====================================================
       REMOVE PEER
       ===================================================== */

    function removePeer(
        remotePeerId
    ) {

        const state =
            peers.get(
                remotePeerId
            );

        if (
            !state
        ) {
            return;
        }

        try {
            state.pc.close();
        } catch (_) {}

        peers.delete(
            remotePeerId
        );

        updateViewerConnection();
    }


    function closeAllPeers() {

        for (
            const [
                remotePeerId,
                state
            ]
            of peers
        ) {

            try {
                state.pc.close();
            } catch (_) {}

            peers.delete(
                remotePeerId
            );
        }
    }


    function updateViewerConnection() {

        let connected =
            0;

        for (
            const state
            of peers.values()
        ) {

            if (
                state.pc.connectionState ===
                    "connected"
            ) {
                connected++;
            }
        }

        /*
         * شمارنده واقعی سمت سرور
         * در صورت دریافت live_viewers
         * جایگزین می‌شود.
         */

        if (
            !isHost
        ) {
            return;
        }

        updateViewerCount(
            connected
        );
    }


    /* =====================================================
       VIEWERS
       ===================================================== */

    function updateViewerCount(
        count
    ) {

        viewerCount =
            Math.max(
                0,
                Number(count) || 0
            );

        if (
            viewerCountElement
        ) {
            viewerCountElement.textContent =
                String(
                    viewerCount
                );
        }

        if (
            chatViewerCount
        ) {
            chatViewerCount.textContent =
                String(
                    viewerCount
                );
        }
    }


    /* =====================================================
       START LIVE
       ===================================================== */

    async function startLive() {

        if (
            isLive
        ) {
            return;
        }

        try {

            await requestMedia();

            if (
                !liveRoomId
            ) {
                liveRoomId =
                    makeRoomId();
            }

            isHost =
                true;

            isLive =
                true;

            liveStartedAt =
                Date.now();

            updateHostUI();

            connectSocket();

            /*
             * به سرور اطلاع
             */

            setTimeout(
                () => {

                    sendSocket({
                        type:
                            "live_start",

                        room_id:
                            liveRoomId,

                        peer_id:
                            peerId,

                        user_id:
                            getUserId(
                                currentUser
                            ),

                        username:
                            getUserName(
                                currentUser
                            ),

                        host:
                            true
                    });

                },
                100
            );

            startLiveTimer();

            updateLiveUI();

            toast(
                "🔴 پخش زنده شروع شد."
            );

        } catch (error) {

            console.error(
                "LIVE start error:",
                error
            );

            toast(
                error.message ||
                "شروع پخش زنده انجام نشد."
            );
        }
    }


    /* =====================================================
       STOP LIVE
       ===================================================== */

    function stopLive(
        notifyServer = true
    ) {

        if (
            notifyServer &&
            socket
        ) {

            sendSocket({
                type:
                    "live_stop",

                room_id:
                    liveRoomId,

                peer_id:
                    peerId,

                user_id:
                    getUserId(
                        currentUser
                    )
            });
        }

        stopLiveTimer();

        closeAllPeers();

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

            localStream =
                null;
        }

        if (
            screenStream
        ) {

            screenStream
                .getTracks()
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch (_) {}
                    }
                );

            screenStream =
                null;
        }

        if (
            liveVideo
        ) {

            liveVideo.pause();

            liveVideo.srcObject =
                null;
        }

        isLive =
            false;

        isHost =
            false;

        sharingScreen =
            false;

        micEnabled =
            true;

        cameraEnabled =
            true;

        updateLiveUI();

        updateControls();

        updateViewerCount(
            0
        );
    }


    /* =====================================================
       START LIVE TIMER
       ===================================================== */

    function startLiveTimer() {

        stopLiveTimer();

        updateDuration();

        liveTimer =
            setInterval(
                updateDuration,
                1000
            );
    }


    function updateDuration() {

        if (
            !liveStartedAt ||
            !liveDuration
        ) {
            return;
        }

        const totalSeconds =
            Math.floor(
                (
                    Date.now() -
                    liveStartedAt
                ) /
                    1000
            );

        const minutes =
            Math.floor(
                totalSeconds / 60
            );

        const seconds =
            totalSeconds % 60;

        liveDuration.textContent =
            `${String(minutes).padStart(
                2,
                "0"
            )}:${String(seconds).padStart(
                2,
                "0"
            )}`;
    }


    function stopLiveTimer() {

        if (
            liveTimer
        ) {

            clearInterval(
                liveTimer
            );

            liveTimer =
                null;
        }

        liveStartedAt =
            0;

        if (
            liveDuration
        ) {
            liveDuration.textContent =
                "00:00";
        }
    }


    /* =====================================================
       MIC
       ===================================================== */

    function toggleMic() {

        if (
            !localStream
        ) {
            return;
        }

        const tracks =
            localStream
                .getAudioTracks();

        if (
            !tracks.length
        ) {
            return;
        }

        micEnabled =
            !micEnabled;

        tracks.forEach(
            track => {
                track.enabled =
                    micEnabled;
            }
        );

        updateControls();

        sendSocket({
            type:
                "live_media_state",

            room_id:
                liveRoomId,

            peer_id:
                peerId,

            media:
                "audio",

            enabled:
                micEnabled
        });
    }


    /* =====================================================
       CAMERA
       ===================================================== */

    function toggleCamera() {

        if (
            !localStream
        ) {
            return;
        }

        const tracks =
            localStream
                .getVideoTracks();

        if (
            !tracks.length
        ) {
            return;
        }

        cameraEnabled =
            !cameraEnabled;

        tracks.forEach(
            track => {
                track.enabled =
                    cameraEnabled;
            }
        );

        updateControls();

        sendSocket({
            type:
                "live_media_state",

            room_id:
                liveRoomId,

            peer_id:
                peerId,

            media:
                "video",

            enabled:
                cameraEnabled
        });
    }


    /* =====================================================
       SCREEN SHARE
       ===================================================== */

    async function toggleScreenShare() {

        if (
            !isHost
        ) {
            toast(
                "فقط برگزارکننده می‌تواند صفحه را به اشتراک بگذارد."
            );

            return;
        }

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices
                .getDisplayMedia
        ) {
            toast(
                "اشتراک صفحه در این مرورگر پشتیبانی نمی‌شود."
            );

            return;
        }


        if (
            sharingScreen
        ) {

            stopScreenShare();

            return;
        }


        try {

            screenStream =
                await navigator.mediaDevices
                    .getDisplayMedia({
                        video: true,
                        audio: false
                    });

            const screenTrack =
                screenStream
                    .getVideoTracks()[0];

            if (
                !screenTrack
            ) {
                throw new Error(
                    "تصویر صفحه پیدا نشد."
                );
            }

            sharingScreen =
                true;

            if (
                liveVideo
            ) {

                liveVideo.srcObject =
                    screenStream;

                liveVideo.muted =
                    true;

                try {
                    await liveVideo.play();
                } catch (_) {}
            }

            /*
             * تغییر track برای Peerها
             */

            for (
                const state
                of peers.values()
            ) {

                const sender =
                    state.pc
                        .getSenders()
                        .find(
                            item =>
                                item
                                    .track
                                    ?.kind ===
                                "video"
                        );

                if (
                    sender
                ) {

                    try {

                        await sender.replaceTrack(
                            screenTrack
                        );

                    } catch (
                        error
                    ) {

                        console.warn(
                            "Screen replaceTrack:",
                            error
                        );
                    }
                }
            }

            screenTrack.onended =
                () => {
                    stopScreenShare();
                };

            updateControls();

            toast(
                "🖥️ اشتراک صفحه فعال شد."
            );

        } catch (error) {

            console.error(
                "Screen share error:",
                error
            );

            sharingScreen =
                false;

            toast(
                "اشتراک صفحه لغو شد."
            );
        }
    }


    function stopScreenShare() {

        if (
            screenStream
        ) {

            screenStream
                .getTracks()
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch (_) {}
                    }
                );

            screenStream =
                null;
        }

        sharingScreen =
            false;


        /*
         * برگشت به دوربین
         */

        if (
            localStream
        ) {

            const cameraTrack =
                localStream
                    .getVideoTracks()[0];

            if (
                cameraTrack
            ) {

                for (
                    const state
                    of peers.values()
                ) {

                    const sender =
                        state.pc
                            .getSenders()
                            .find(
                                item =>
                                    item
                                        .track
                                        ?.kind ===
                                    "video"
                            );

                    if (
                        sender
                    ) {

                        sender
                            .replaceTrack(
                                cameraTrack
                            )
                            .catch(
                                () => {}
                            );
                    }
                }

                if (
                    liveVideo
                ) {

                    liveVideo.srcObject =
                        localStream;

                    liveVideo.muted =
                        true;

                    liveVideo.play()
                        .catch(
                            () => {}
                        );
                }
            }
        }

        updateControls();
    }


    /* =====================================================
       UI
       ===================================================== */

    function updateHostUI() {

        if (
            liveHostName
        ) {

            liveHostName.textContent =
                getUserName(
                    currentUser
                );
        }

        if (
            liveHostStatus
        ) {

            liveHostStatus.textContent =
                isHost
                    ? "برگزارکننده"
                    : "بیننده";
        }

        setAvatar(
            liveHostAvatar,
            currentUser
        );
    }


    function updateLiveUI() {

        if (
            isLive
        ) {

            if (
                livePlaceholder
            ) {
                livePlaceholder.style.display =
                    "none";
            }

            if (
                liveBadge
            ) {
                liveBadge.hidden =
                    false;
            }

            if (
                liveStatusText
            ) {
                liveStatusText.textContent =
                    isHost
                        ? "🔴 پخش زنده شما"
                        : "🔴 در حال مشاهده لایو";
            }

            if (
                startLiveButton
            ) {
                startLiveButton.hidden =
                    true;
            }

            if (
                stopLiveButton
            ) {
                stopLiveButton.hidden =
                    !isHost;
            }

            if (
                liveHostStatus
            ) {
                liveHostStatus.textContent =
                    isHost
                        ? "در حال پخش زنده"
                        : "در حال پخش";
            }

        } else {

            if (
                liveBadge
            ) {
                liveBadge.hidden =
                    true;
            }

            if (
                livePlaceholder
            ) {
                livePlaceholder.style.display =
                    "";
            }

            if (
                liveStatusText
            ) {
                liveStatusText.textContent =
                    "آماده شروع";
            }

            if (
                startLiveButton
            ) {
                startLiveButton.hidden =
                    false;
            }

            if (
                stopLiveButton
            ) {
                stopLiveButton.hidden =
                    true;
            }
        }

        updateControls();
    }


    function updateControls() {

        if (
            liveMicButton
        ) {

            liveMicButton.classList.toggle(
                "active",
                micEnabled
            );

            liveMicButton.title =
                micEnabled
                    ? "خاموش کردن میکروفن"
                    : "روشن کردن میکروفن";

            liveMicButton.firstChild
                .textContent =
                micEnabled
                    ? "🎙️"
                    : "🔇";
        }


        if (
            liveCameraButton
        ) {

            liveCameraButton.classList.toggle(
                "active",
                cameraEnabled
            );

            liveCameraButton.title =
                cameraEnabled
                    ? "خاموش کردن دوربین"
                    : "روشن کردن دوربین";

            liveCameraButton.firstChild
                .textContent =
                cameraEnabled
                    ? "📹"
                    : "🚫";
        }


        if (
            liveScreenButton
        ) {

            liveScreenButton.classList.toggle(
                "active",
                sharingScreen
            );

            liveScreenButton.title =
                sharingScreen
                    ? "پایان اشتراک صفحه"
                    : "اشتراک صفحه";
        }
    }


    /* =====================================================
       LIVE CHAT
       ===================================================== */

    function sendLiveChat() {

        if (
            !liveChatInput
        ) {
            return;
        }

        const text =
            liveChatInput.value
                .trim();

        if (
            !text
        ) {
            return;
        }

        if (
            !liveRoomId
        ) {
            toast(
                "اتاق Live آماده نیست."
            );

            return;
        }

        const sent =
            sendSocket({
                type:
                    "live_chat",

                room_id:
                    liveRoomId,

                peer_id:
                    peerId,

                user_id:
                    getUserId(
                        currentUser
                    ),

                username:
                    getUserName(
                        currentUser
                    ),

                avatar:
                    getAvatar(
                        currentUser
                    ),

                message:
                    text
            });

        if (
            !sent
        ) {
            toast(
                "ارسال پیام انجام نشد."
            );

            return;
        }

        /*
         * فعلاً خودمان هم پیام را نشان می‌دهیم.
         */

        appendLiveChatMessage({
            type:
                "live_chat",

            username:
                getUserName(
                    currentUser
                ),

            avatar:
                getAvatar(
                    currentUser
                ),

            message:
                text
        });

        liveChatInput.value =
            "";

        autoResizeChatInput();
    }


    function appendLiveChatMessage(
        data
    ) {

        if (
            !liveChatMessages
        ) {
            return;
        }

        liveChatEmpty?.remove();

        const row =
            document.createElement(
                "div"
            );

        row.className =
            "live-chat-message";


        const avatar =
            document.createElement(
                "div"
            );

        avatar.className =
            "live-chat-message-avatar";


        const avatarUrl =
            safeText(
                data.avatar
            );

        if (
            avatarUrl
        ) {

            const img =
                document.createElement(
                    "img"
                );

            img.src =
                avatarUrl;

            img.alt =
                safeText(
                    data.username
                );

            img.onerror =
                () => {
                    avatar.innerHTML =
                        "";

                    avatar.textContent =
                        safeText(
                            data.username
                        )
                            .charAt(0)
                            .toUpperCase() ||
                        "G";
                };

            avatar.appendChild(
                img
            );

        } else {

            avatar.textContent =
                safeText(
                    data.username
                )
                    .charAt(0)
                    .toUpperCase() ||
                "G";
        }


        const body =
            document.createElement(
                "div"
            );

        body.className =
            "live-chat-message-body";


        const name =
            document.createElement(
                "span"
            );

        name.className =
            "live-chat-message-name";

        name.textContent =
            safeText(
                data.username ||
                "کاربر"
            );


        const message =
            document.createElement(
                "div"
            );

        message.className =
            "live-chat-message-text";

        message.textContent =
            safeText(
                data.message
            );


        body.appendChild(
            name
        );

        body.appendChild(
            message
        );

        row.appendChild(
            avatar
        );

        row.appendChild(
            body
        );

        liveChatMessages.appendChild(
            row
        );


        liveChatMessages.scrollTop =
            liveChatMessages.scrollHeight;
    }


    /* =====================================================
       CHAT INPUT
       ===================================================== */

    function autoResizeChatInput() {

        if (
            !liveChatInput
        ) {
            return;
        }

        liveChatInput.style.height =
            "auto";

        liveChatInput.style.height =
            Math.min(
                liveChatInput.scrollHeight,
                120
            ) + "px";
    }


    /* =====================================================
       SHARE
       ===================================================== */

    async function shareLive() {

        const url =
            new URL(
                window.location.href
            );

        if (
            liveRoomId
        ) {
            url.searchParams.set(
                "room",
                liveRoomId
            );

            url.searchParams.set(
                "join",
                "1"
            );
        }

        const shareData = {
            title:
                "گپینو لایو",

            text:
                `پخش زنده ${getUserName(
                    currentUser
                )}`,

            url:
                url.toString()
        };

        try {

            if (
                navigator.share
            ) {

                await navigator.share(
                    shareData
                );

                return;
            }

            await navigator.clipboard.writeText(
                url.toString()
            );

            toast(
                "لینک لایو کپی شد."
            );

        } catch (error) {

            console.warn(
                "Share error:",
                error
            );

            toast(
                "اشتراک‌گذاری انجام نشد."
            );
        }
    }


    /* =====================================================
       JOIN EXISTING LIVE
       ===================================================== */

    async function joinLive() {

        if (
            !liveRoomId
        ) {

            toast(
                "اتاق لایو مشخص نیست."
            );

            return;
        }

        isHost =
            false;

        isLive =
            true;

        updateHostUI();

        updateLiveUI();

        connectSocket();

        setTimeout(
            () => {

                sendSocket({
                    type:
                        "live_join",

                    room_id:
                        liveRoomId,

                    peer_id:
                        peerId,

                    user_id:
                        getUserId(
                            currentUser
                        ),

                    username:
                        getUserName(
                            currentUser
                        ),

                    host:
                        false
                });

            },
            150
        );

        toast(
            "وارد پخش زنده شدی."
        );
    }


    /* =====================================================
       NAVIGATION
       ===================================================== */

    function leavePage() {

        manuallyClosed =
            true;

        clearTimeout(
            reconnectTimer
        );

        stopLive(
            true
        );

        if (
            socket
        ) {

            try {
                socket.close();
            } catch (_) {}

            socket =
                null;
        }

        window.location.href =
            "/chat.html";
    }


    /* =====================================================
       EVENTS
       ===================================================== */

    function setupEvents() {

        liveMicButton?.addEventListener(
            "click",
            toggleMic
        );

        liveCameraButton?.addEventListener(
            "click",
            toggleCamera
        );

        liveScreenButton?.addEventListener(
            "click",
            toggleScreenShare
        );

        startLiveButton?.addEventListener(
            "click",
            () => {

                if (
                    startLivePanel
                ) {
                    startLivePanel.hidden =
                        false;
                } else {
                    startLive();
                }
            }
        );

        confirmStartLive?.addEventListener(
            "click",
            async () => {

                if (
                    startLivePanel
                ) {
                    startLivePanel.hidden =
                        true;
                }

                await startLive();
            }
        );

        cancelStartLive?.addEventListener(
            "click",
            () => {

                if (
                    startLivePanel
                ) {
                    startLivePanel.hidden =
                        true;
                }
            }
        );

        stopLiveButton?.addEventListener(
            "click",
            () => {

                stopLive(
                    true
                );

                toast(
                    "پخش زنده پایان یافت."
                );
            }
        );

        liveChatForm?.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                sendLiveChat();
            }
        );

        liveChatInput?.addEventListener(
            "input",
            autoResizeChatInput
        );

        liveChatInput?.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                        "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    sendLiveChat();
                }
            }
        );

        liveBackButton?.addEventListener(
            "click",
            leavePage
        );

        liveCloseButton?.addEventListener(
            "click",
            leavePage
        );

        shareLiveButton?.addEventListener(
            "click",
            shareLive
        );


        /*
         * قبل از خروج صفحه
         */

        window.addEventListener(
            "beforeunload",
            () => {

                manuallyClosed =
                    true;

                try {

                    sendSocket({
                        type:
                            "live_leave",

                        room_id:
                            liveRoomId,

                        peer_id:
                            peerId
                    });

                } catch (_) {}

                stopLive(
                    false
                );
            }
        );
    }


    /* =====================================================
       BOOT
       ===================================================== */

    async function init() {

        try {

            const user =
                await loadCurrentUser();

            if (
                !user
            ) {
                return;
            }

            updateHostUI();

            setupEvents();

            updateControls();

            updateLiveUI();

            /*
             * اگر URL اتاق داشته باشد:
             * بیننده وارد شود.
             */

            if (
                CONFIG.AUTO_JOIN &&
                liveRoomId
            ) {

                await joinLive();

            } else {

                /*
                 * اتصال WebSocket را در حالت
                 * معمولی هم برقرار می‌کنیم.
                 */

                connectSocket();
            }

            console.log(
                "GAPINO LIVE initialized",
                {
                    room:
                        liveRoomId,

                    peer:
                        peerId,

                    user:
                        getUserName(
                            currentUser
                        )
                }
            );

        } catch (error) {

            console.error(
                "GAPINO LIVE init error:",
                error
            );

            toast(
                "راه‌اندازی پخش زنده انجام نشد."
            );
        }
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


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.GAPINO_LIVE = {

        start:
            startLive,

        stop:
            stopLive,

        join:
            joinLive,

        share:
            shareLive,

        toggleMic:
            toggleMic,

        toggleCamera:
            toggleCamera,

        toggleScreen:
            toggleScreenShare,

        get roomId() {
            return liveRoomId;
        },

        get isLive() {
            return isLive;
        },

        get isHost() {
            return isHost;
        }
    };

})();
