const { makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { toDataURL } = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { AntiBan, classifyDisconnect } = require('baileys-antiban');
const { handleIncomingMessage } = require('./debounce');
const { sendHumanLikeReply, sendButtonReply, sendHumanLikeImage } = require('./sender');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
let appStarted = false;
let reconnectAttempts = 0;
let isBotRunning = true;

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function getCustomerState(jid) {
    try {
        const { data, error } = await supabase
            .from('baileys_bot_states')
            .select('*')
            .eq('jid', jid)
            .maybeSingle();
        if (error) throw error;
        return data || { last_reply_time: 0, paused_until: 0 };
    } catch (err) {
        console.error("Error fetching state:", err.message);
        return { last_reply_time: 0, paused_until: 0 };
    }
}

async function updateCustomerState(jid, lastReplyTime, pausedUntil = null) {
    try {
        let updateData = { jid: jid, last_reply_time: lastReplyTime };
        if (pausedUntil !== null) updateData.paused_until = pausedUntil;
        await supabase.from('baileys_bot_states').upsert(updateData);
    } catch (err) {
        console.error("Error updating state:", err.message);
    }
}

const chatHistories = new Map();
const sentNotifications = new Set();

function appendToHistory(jid, role, content) {
    if (!chatHistories.has(jid)) chatHistories.set(jid, []);
    const history = chatHistories.get(jid);
    history.push({ role: role, content: content });
    if (history.length > 12) history.shift(); 
}

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'status', running: isBotRunning }));
    ws.send(JSON.stringify({ type: 'log', message: '🔌 Dashboard connected to bot server' }));
    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.action === 'pause') {
            isBotRunning = false;
            broadcastStatus();
            broadcastLog('⏸ Bot paused by dashboard');
        } else if (msg.action === 'resume') {
            isBotRunning = true;
            broadcastStatus();
            broadcastLog('▶️ Bot resumed by dashboard');
        } else if (msg.action === 'updateConfig') {
            if (msg.config.SMART_DELAY) config.SMART_DELAY = msg.config.SMART_DELAY;
            if (msg.config.DEBOUNCE_TIME) config.DEBOUNCE_TIME = msg.config.DEBOUNCE_TIME;
            broadcastLog('🔧 Config updated from dashboard');
        }
    });
});

function broadcastStatus() {
    wss.clients.forEach(client => client.send(JSON.stringify({ type: 'status', running: isBotRunning })));
}

function broadcastLog(message) {
    console.log(message);
    wss.clients.forEach(client => client.send(JSON.stringify({ type: 'log', message })));
}

let latestQR = null;
let latestPairingCode = null;
let waConnected = false;

app.get('/qr', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let body;
    if (waConnected) body = '<h2>✅ WhatsApp connected</h2>';
    else if (latestQR) {
        const img = await toDataURL(latestQR, { width: 320 });
        body = `<h2>Scan with WhatsApp &gt; Linked Devices</h2><img src="${img}">` +
            (latestPairingCode ? `<p>Ya phone number se link karein, code: <b>${latestPairingCode}</b></p>` : '');
    } else body = '<h2>QR generate ho raha hai... page refresh hota rahega</h2>';
    res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><body style="font-family:sans-serif;text-align:center;padding:2em">${body}</body>`);
});

app.use(express.static('dashboard'));
app.get('/dashboard', (req, res) => res.sendFile(__dirname + '/dashboard/index.html'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Dashboard & QR server started on port ${PORT} (QR at /qr)`);
    appStarted = true;
    broadcastLog('🚀 Bot server started and ready');
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // 👇 1. WhatsApp ka latest version fetch karein (QR Error Fix) 👇
    const { version, isLatest } = await fetchLatestWaWebVersion();
    console.log(`📱 WhatsApp Web Version: ${version.join('.')} | Latest: ${isLatest}`);

    const antiban = new AntiBan({
        maxPerMinute: 30,   
        maxPerHour: 500,    
        maxPerDay: 2000,    
        warmupDays: 0,    
        day1Limit: 500,
        growthFactor: 1.8,
        logging: true
    });

    const sock = makeWASocket({
    auth: state,
    version: version,
    browser: ['Chrome', 'Windows', '10.0'], // 👈 Yeh line add karein
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async (key) => {
        return { conversation: 'Retrying...' };
    }
});
     
    sock.antiban = antiban;
    let pairingRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr && !sock.authState.creds.registered) {
            latestQR = qr;
            console.log('📷 QR ready — open /qr on the service URL to scan');
            // Pairing code sirf ek baar (har QR refresh par naya code banne se purana invalid ho jata tha)
            if (!pairingRequested && process.env.PAIRING_PHONE) {
                pairingRequested = true;
                try {
                    latestPairingCode = await sock.requestPairingCode(process.env.PAIRING_PHONE);
                    console.log(`🔑 YOUR PAIRING CODE: ${latestPairingCode}`);
                } catch (e) { console.log('Pairing code error:', e.message); }
            }
        }

        if (connection === 'open') {
            reconnectAttempts = 0;
            waConnected = true;
            latestQR = null;
            console.log('✅ Bot connected to WhatsApp');
            setupOrderRealtimeListener(sock);
        } else if (connection === 'close') {
    waConnected = false;
    const statusCode = (lastDisconnect?.error)?.output?.statusCode;
    const classification = classifyDisconnect(statusCode);

    if (classification.shouldReconnect) {
        console.log(`⏳ Reconnecting (Reason: ${classification.message}) in ${classification.backoffMs}ms...`);
        setTimeout(() => startBot(), classification.backoffMs);
    } else {
        console.log('❌ Session logged out. Clearing auth_info and generating new QR...');
        // auth_info volume mount hai, folder delete nahi ho sakta — sirf andar ki files hatao
        for (const f of fs.existsSync('auth_info') ? fs.readdirSync('auth_info') : []) fs.rmSync(`auth_info/${f}`, { recursive: true, force: true });
        startBot();
    }
}
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (msg.key.fromMe && m.type === 'notify') {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) {
                const pauseUntil = Date.now() + (120 * 60 * 1000); 
                await updateCustomerState(jid, Date.now(), pauseUntil);
                console.log(`✋ Owner replied manually. Bot paused for ${jid} for 2 hours.`);
            }
            return; 
        }

        if (!msg.key.fromMe && m.type === 'notify') {
            const jid = msg.key.remoteJid;
            console.log('\n--- NEW MESSAGE RECEIVED ---');
            console.log('1. JID:', jid);

            if (jid.endsWith('@g.us') || jid.includes('@broadcast') || jid.endsWith('@newsletter')) {
                console.log('❌ IGNORING group/status/broadcast chat:', jid);
                return;
            }

            let text = '';
            if (msg.message?.conversation) {
                text = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            }

            if (!text) return;

            handleIncomingMessage(jid, text, msg.key, async (combinedText, keys) => {
                if (!isBotRunning) {
                    broadcastLog(`⏸ Bot is paused, ignoring message from ${jid}`);
                    return;
                }
                console.log('✅ Debounce finished! Combined Text:', combinedText);
                
                                // ===== 1. AREA AUR ORDER STATUS CHECK =====
                const { data: latestOrder } = await supabase
                    .from('orders')
                    .select('status, area')
                    .eq('chat_jid', jid)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                let storeOpenHour = 8;  // Default (Subah 8 baje)
                let storeCloseHour = 23; // Default (Raat 11 baje)

                // Agar customer ka area mil jaye, to us area ki timing le lein
                if (latestOrder && latestOrder.area) {
                    const { data: areaData } = await supabase
                        .from('delivery_areas')
                        .select('open_hour, close_hour')
                        .ilike('area_name', latestOrder.area) // area_name se match kiya
                        .maybeSingle();

                    if (areaData) {
                        // '08:00' jaisi string ko 8 mein convert karne ke liye split kar rahe hain
                        if (areaData.open_hour) storeOpenHour = parseInt(areaData.open_hour.split(':')[0], 10);
                        if (areaData.close_hour) storeCloseHour = parseInt(areaData.close_hour.split(':')[0], 10);
                    }
                }

                // ===== 2. PAKISTAN TIME CHECK =====
                const pkTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
                const currentHour = pkTime.getHours();
                
                let isStoreOpen = false;
                if (storeOpenHour < storeCloseHour) {
                    // Agar timing normal hai (jaise 8 AM se 11 PM)
                    isStoreOpen = currentHour >= storeOpenHour && currentHour < storeCloseHour;
                } else {
                    // Agar timing raat cross karti hai (jaise 6 PM se 2 AM)
                    isStoreOpen = currentHour >= storeOpenHour || currentHour < storeCloseHour;
                }

                // ===== 3. AGAR STORE BAND HAI =====
                if (!isStoreOpen) {
                    const todayDate = new Date().toDateString();
                    // Memory mein check karein ke aaj raat ka message bheja ja chuka hai ya nahi
                    if (!global.nightRepliedMap) global.nightRepliedMap = new Map();

                    if (global.nightRepliedMap.get(jid) !== todayDate) {
                        await sendHumanLikeReply(sock, jid, config.NIGHT_REPLY_TEXT, keys, true);
                        global.nightRepliedMap.set(jid, todayDate); // Save kar lein ke aaj reply bhej diya
                        console.log(`🌙 Store closed for ${latestOrder?.area || 'Default'}. Night reply sent.`);
                    } else {
                        await sock.readMessages(keys);
                        console.log(`🌙 Store closed. Night reply already sent today. Ignoring.`);
                    }
                    return; // Yahan se aage na barhein
                }

                // ===== 4. AGAR STORE OPEN HAI (Order Status Logic) =====
                let isOrderActive = false;
                let isOrderCompleted = false;

                if (latestOrder) {
                    if (latestOrder.status === 'completed' || latestOrder.status === 'delivered') {
                        isOrderCompleted = true;
                    } else {
                        isOrderActive = true;
                    }
                }

                const lowerText = combinedText.toLowerCase().trim();
                const isDeadEnd = config.DEAD_END_KEYWORDS.some(kw => lowerText.includes(kw));

                // 4a. Completed order + Dead-end (Ignore)
                if (isOrderCompleted && isDeadEnd) {
                    console.log(`⏳ Completed order & Dead-end. Ignoring.`);
                    await sock.readMessages(keys);
                    return;
                }

                // 4b. Active Order (Owner reply karega)
                if (isOrderActive && !isDeadEnd) {
                    console.log(`ℹ️ Active Order detected. Bot staying silent for owner.`);
                    await sock.readMessages(keys); 
                    return; 
                }
                // =====================================

                // ===== TIMER (COOLDOWN) CHECK WITH DATABASE =====
                const cooldownMs = config.REPLY_COOLDOWN_MINUTES * 60 * 1000;
                const now = Date.now();
                
                const state = await getCustomerState(jid);
                const lastTime = state.last_reply_time || 0;
                const pausedUntil = state.paused_until || 0;

                if (pausedUntil > now) {
                    console.log(`✋ Owner is chatting. Bot paused for ${jid}.`);
                    await sock.readMessages(keys); 
                    return;
                }

                if (now - lastTime < cooldownMs) {
                    await sock.readMessages(keys);
                    await sock.sendPresenceUpdate('composing', jid);
                    await new Promise(r => setTimeout(r, 3000));
                    await sock.sendPresenceUpdate('paused', jid);
                    console.log(`⏳ Cooldown active for ${jid}. Ignored.`);
                    return;
                }

                await updateCustomerState(jid, now);
                const shouldRead = true;

                                // 👇 1. Asli Phone Number (PN) nikalne ka logic 👇
                const rawJid = msg.key.remoteJid;
                let realPhone = rawJid.split('@')[0]; 
                
                // Agar JID ke andar LID aya hai, to senderPn se asli number nikalain
                if (msg.key.senderPn) {
                    realPhone = msg.key.senderPn.split('@')[0]; 
                } else if (msg.key.remoteJidAlt) {
                    realPhone = msg.key.remoteJidAlt.split('@')[0];
                }
                
                console.log("✅ Asli Phone Number for Link:", realPhone);

                const buttonData = {
                    title: 'Aapka Swagat Hai!',
                    text: 'Humse raabta karne ke liye neeche diye gaye button par click karein.',
                    footer: 'Faster Support',
                    buttons: [
                        {
                            name: 'cta_url',
                            buttonParamsJson: JSON.stringify({
                                display_text: '🌐 Web App Kholain',
                                url: `https://waseemakramkhan126-max.github.io/faster-v2/new-order.html?jid=${realPhone}` // 👈 Yahan realPhone laga diya
                            })
                        }
                    ]
                };

                if (shouldRead && keys) await sock.readMessages(keys); 

                console.log('4. Sending button reply to WhatsApp...');
                await sendButtonReply(sock, jid, buttonData, keys, shouldRead); 
                broadcastLog(`📤 Button reply sent to ${jid}`);
            });
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

function setupOrderRealtimeListener(sock) {
    console.log('📡 Listening for Realtime updates on "orders" table...');
    const channelName = `realtime-orders-${Date.now()}`;

    supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders' }, // 👈 '*' lagaya hai taake INSERT aur UPDATE dono sune
            async (payload) => {
                const newRow = payload.new || {};
                const oldRow = payload.old || {};
                const jid = formatToJid(newRow.customer_phone);
                if (!jid) return;

                // ==========================================
                // 🟢 1. NAYA ORDER PLACED (INSERT EVENT)
                // ==========================================
                if (payload.eventType === 'INSERT') {
                    const uniqueKey = `new_order_${newRow.id}`;
                    if (sentNotifications.has(uniqueKey)) return; // Duplicate check
                    sentNotifications.add(uniqueKey);

                    const buttonData = {
                        title: '🎉 Order Confirmed!',
                        text: `Thank you for your order!\n\n📦 *Order ID:* #${newRow.id}\n\nAap apne order ka status dekhne aur rider se chat karne ke liye neeche diye gaye button par click karein.\u200B`,
                        footer: 'Faster Support',
                        buttons: [
                            {
                                name: 'cta_url',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📦 Track Order / Chat',
                                    url: `https://waseemakramkhan126-max.github.io/faster-v2/active-orders.html?id=${newRow.id}` // 👈 Yahan apna sahi link dalein
                                })
                            }
                        ]
                    };

                    await sendButtonReply(sock, jid, buttonData, null, false);
                    console.log(`✅ New Order Confirmation sent to ${jid} for Order #${newRow.id}`);
                    return; // Insert ka kaam khatam
                }

                // ==========================================
                // 🔵 2. RIDER STATUS UPDATE (UPDATE EVENT)
                // ==========================================
                if (payload.eventType === 'UPDATE') {
                    const currentStatus = String(newRow.rider_status || '').toLowerCase().trim();
                    const oldStatus = String(oldRow.rider_status || '').toLowerCase().trim();
                    const statusChanged = currentStatus !== oldStatus;

                    const isBillUploaded = newRow.bill_image && (newRow.bill_image !== oldRow.bill_image || newRow.bill_amount !== oldRow.bill_amount);
                    const isRiderOnWay = (currentStatus === 'on_the_way' || currentStatus === 'ontheway' || currentStatus === 'on the way') && statusChanged;

                    const uniqueKey = `${newRow.id}_${currentStatus}_${newRow.bill_image || ''}`;
                    if (sentNotifications.has(uniqueKey)) {
                        console.log(`⚠️ Duplicate notification blocked for Order ${newRow.id}`);
                        return; 
                    }
                    sentNotifications.add(uniqueKey);

                    if (isBillUploaded || isRiderOnWay) {
                        const billAmt = (Number(newRow.item_price) || 0) + (Number(newRow.dc_amount) || 0);
                        const rawWalletBalance = await getWalletBalance(newRow.customer_phone);
                        const walletBalance = Number(rawWalletBalance) || 0;

                        let captionText = `📄 *Order Bill Details*\n\n`;
                        captionText += `Bill Amount: Rs. ${billAmt}\n`;

                        let totalPayable = billAmt;

                        if (walletBalance > 0) {
                            captionText += `Previous Due: Rs. ${walletBalance}\n`;
                            totalPayable = billAmt + walletBalance;
                        } else if (walletBalance < 0) {
                            captionText += `Your Remaining Amount: Rs. ${Math.abs(walletBalance)}\n`;
                            totalPayable = billAmt + walletBalance; 
                        }

                        captionText += `----------------------\n`;
                        captionText += `*Total Payable: Rs. ${totalPayable}/-*\n\n`;
                        captionText += `*Rider is on the way 🏍️*\u200B`; 

                        let sentBill = false;
                        if (newRow.bill_image) {
                            sentBill = await sendHumanLikeImage(sock, jid, newRow.bill_image, captionText, null, false, true);
                        } else {
                            sentBill = await sendHumanLikeReply(sock, jid, captionText, null, false, true);
                        }
                        
                        if (sentBill !== false) console.log(`✅ Bill & On-The-Way details sent to ${jid}`);
                    }

                    if (currentStatus === 'arrived' && statusChanged) {
                        const arrivedMsg = `*Your order has arrived 🏠*\nPlease receive your order.\u200B`;
                        const sentArrived = await sendHumanLikeReply(sock, jid, arrivedMsg, null, false, true);
                        if (sentArrived !== false) console.log(`✅ Arrived message sent to ${jid}`);
                    }

                    if ((currentStatus === 'delivered' || currentStatus === 'completed') && statusChanged) {
                        const billAmount = Number(newRow.bill_amount) || 0;
                        const balanceAmt = Number(newRow.balance_amount) || 0;
                        const paidToRider = billAmount - balanceAmt;

                        let deliveredMsg = "";

                        if (balanceAmt > 0) {
                            deliveredMsg = 
                                `🧾 *Order Payment Summary*\n\n` +
                                `Total Bill: Rs. ${billAmount}/- \n` +
                                `Paid to Rider: Rs. ${paidToRider}/-\n\n` +
                                `⚠️ *Your Pending Amount: Rs. ${balanceAmt}/-*\n\n` +
                                `Please clear this amount on your next order.\n\n` +
                                `✅ *Order Completed*\n\n` +
                                `Thank you for choosing Faster! We truly appreciate your trust in our services.\u200B`;
                        } else if (balanceAmt < 0) {
                            deliveredMsg = 
                                `🧾 *Order Payment Summary*\n\n` +
                                `Total Bill: Rs. ${billAmount}/- \n` +
                                `Paid to Rider: Rs. ${paidToRider}/-\n\n` +
                                `💵 *Your Remaining Amount: Rs. ${Math.abs(balanceAmt)}/-*\n\n` +
                                `Your credit balance will be automatically adjusted in your next order.\n\n` +
                                `✅ *Order Completed*\n\n` +
                                `Thank you for choosing Faster! We truly appreciate your trust in our services.\u200B`;
                        } else {
                            deliveredMsg = 
                                `🧾 *Order Payment Summary*\n\n` +
                                `Total Bill: Rs. ${billAmount}/- \n` +
                                `Paid to Rider: Rs. ${paidToRider}/-\n\n` +
                                `✅ *Order Completed*\n\n` +
                                `Thank you for choosing Faster! We truly appreciate your trust in our services.\u200B`;
                        }

                        const sentDelivered = await sendHumanLikeReply(sock, jid, deliveredMsg, null, false, true);
                        if (sentDelivered !== false) console.log(`✅ Delivered message sent to ${jid}`);
                    }
                }
            }
        )
        .subscribe();
}

function formatToJid(phone) {
    if (!phone) return null;
    let clean = phone.replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) clean = '92' + clean.slice(1);
    else if (clean.length === 10 && clean.startsWith('3')) clean = '92' + clean;
    return clean.endsWith('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`;
}

async function getWalletBalance(phone) {
    if (!phone) return 0;
    
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    let core10 = cleanPhone;
    if (core10.startsWith('92') && core10.length > 10) core10 = core10.slice(2); 
    if (core10.startsWith('0')) core10 = core10.slice(1); 

    try {
        const { data, error } = await supabase
            .from("wallets")
            .select("current_balance, customer_phone")
            .like('customer_phone', `%${core10}%`)
            .maybeSingle();

        console.log(`🔍 Wallet Check -> Searching for core digits: %${core10}%`);
        
        if (error) {
            console.error(`❌ Wallet DB Error:`, error.message);
            return 0;
        }

        if (data) {
            console.log(`✅ Wallet Found! Saved as: [${data.customer_phone}], Balance: Rs. ${data.current_balance}`);
            return Number(data.current_balance) || 0;
        } else {
            console.log(`⚠️ No wallet record found for core digits: ${core10}`);
            return 0;
        }
    } catch (e) {
        console.error("❌ Wallet Exception:", e);
        return 0;
    }
}

startBot();
