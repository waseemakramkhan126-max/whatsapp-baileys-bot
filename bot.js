const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { toDataURL } = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { AntiBan } = require('baileys-antiban');
const { handleIncomingMessage } = require('./debounce');
const { sendHumanLikeReply, sendButtonReply, sendHumanLikeImage } = require('./sender');
const { shouldNightReply } = require('./nightmode');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
let appStarted = false;
let reconnectAttempts = 0;
let isBotRunning = true;

// 🧠 Supabase Client Setup
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

// 👇 DATABASE HELPERS (Phase 2) 👇
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
// 👆 --------------------------------- 👆

const chatHistories = new Map();
const sentNotifications = new Set(); // Duplicate notifications rokne ke liye

function appendToHistory(jid, role, content) {
    if (!chatHistories.has(jid)) {
        chatHistories.set(jid, []);
    }
    const history = chatHistories.get(jid);
    history.push({ role: role, content: content });
    if (history.length > 12) history.shift(); 
}

// ---------- WebSocket Dashboard ----------
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

app.use(express.static('dashboard'));
app.get('/dashboard', (req, res) => res.sendFile(__dirname + '/dashboard/index.html'));

server.listen(3000, () => {
    console.log('✅ Dashboard & QR server started on port 3000');
    appStarted = true;
    broadcastLog('🚀 Bot server started and ready');
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const antiban = new AntiBan({
        maxPerMinute: 10,
        maxPerHour: 200,
        warmupDays: 7,
        day1Limit: 20,
        growthFactor: 1.8,
        logging: true
    });

    const sock = makeWASocket({
        auth: state,
        syncFullHistory: false
    });
     
    sock.antiban = antiban;

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            console.log('Scan QR at http://localhost:3000/qr');
            const qrImage = await toDataURL(qr);
            app.get('/qr', (req, res) => res.send(`<html><body><img src="${qrImage}" /></body></html>`));
        }

        if (connection === 'open') {
            reconnectAttempts = 0;
            console.log('✅ Bot connected to WhatsApp');
            setupOrderRealtimeListener(sock);
        } else if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== 401;

            if (shouldReconnect) {
                reconnectAttempts++;
                if (reconnectAttempts > 5) {
                    console.log('❌ Max reconnect attempts reached.');
                    process.exit(1);
                }
                const delay = Math.floor(Math.random() * 5000) + 5000;
                console.log(`⏳ Reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts})`);
                setTimeout(() => startBot(), delay);
            } else {
                console.log('❌ Session logged out, clearing auth_info...');
                fs.rmSync('auth_info', { recursive: true, force: true });
                startBot();
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // 👇 HUMAN TAKEOVER LOGIC (Owner Reply Pause) 👇
        if (msg.key.fromMe && m.type === 'notify') {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) {
                const pauseUntil = Date.now() + (120 * 60 * 1000); // 2 ghante
                await updateCustomerState(jid, Date.now(), pauseUntil);
                console.log(`✋ Owner replied manually. Bot paused for ${jid} for 2 hours.`);
            }
            return; 
        }
        // 👆 --------------------------------- 👆

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
                
                const nightAction = shouldNightReply(jid);
                if (nightAction === true) {
                    await sendHumanLikeReply(sock, jid, config.NIGHT_REPLY_TEXT, keys, true);
                    return;
                } else if (nightAction === false) {
                    await sock.readMessages(keys);
                    await sock.sendPresenceUpdate('composing', jid);
                    await new Promise(r => setTimeout(r, 3000));
                    await sock.sendPresenceUpdate('paused', jid);
                    return;
                }

                // ===== TIMER (COOLDOWN) CHECK WITH DATABASE =====
                const cooldownMs = config.REPLY_COOLDOWN_MINUTES * 60 * 1000;
                const now = Date.now();
                
                const state = await getCustomerState(jid);
                const lastTime = state.last_reply_time || 0;
                const pausedUntil = state.paused_until || 0;

                // Check Human Takeover
                if (pausedUntil > now) {
                    console.log(`✋ Owner is chatting. Bot paused for ${jid}.`);
                    await sock.readMessages(keys); 
                    return;
                }

                // Check Cooldown
                if (now - lastTime < cooldownMs) {
                    await sock.readMessages(keys);
                    await sock.sendPresenceUpdate('composing', jid);
                    await new Promise(r => setTimeout(r, 3000));
                    await sock.sendPresenceUpdate('paused', jid);
                    console.log(`⏳ Cooldown active for ${jid}. Ignored.`);
                    return;
                }

                // Update Database Timer
                await updateCustomerState(jid, now);
                const shouldRead = true;

                // ===== BUTTON REPLY LOGIC =====
                const buttonData = {
                    title: 'Aapka Swagat Hai!',
                    text: 'Humse raabta karne ke liye neeche diye gaye button par click karein.',
                    footer: 'Faster Support',
                    buttons: [
                        {
                            name: 'cta_url',
                            buttonParamsJson: JSON.stringify({
                                display_text: '🌐 Web App Kholain',
                                url: 'https://waseemakramkhan126-max.github.io/faster-v2/new-order.html'
                            })
                        }
                    ]
                };

                if (shouldRead && keys) {
                    await sock.readMessages(keys); 
                }

                console.log('4. Sending button reply to WhatsApp...');
                await sendButtonReply(sock, jid, buttonData, keys, shouldRead); 
                broadcastLog(`📤 Button reply sent to ${jid}`);
            });
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// (Order Notifications wala hissa waise hi rahega, hum ise Phase 3 mein update karenge)
function setupOrderRealtimeListener(sock) {
    console.log('📡 Listening for Realtime updates on "orders" table...');
    const channelName = `realtime-orders-${Date.now()}`;

    supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'orders' },
            async (payload) => {
                const oldRow = payload.old || {};
                const newRow = payload.new || {};
                const jid = formatToJid(newRow.customer_phone);
                if (!jid) return;

                const currentStatus = String(newRow.rider_status || '').toLowerCase().trim();
                const oldStatus = String(oldRow.rider_status || '').toLowerCase().trim();
                const statusChanged = currentStatus !== oldStatus;

                const isBillUploaded = newRow.bill_image && (newRow.bill_image !== oldRow.bill_image || newRow.bill_amount !== oldRow.bill_amount);
                const isRiderOnWay = (currentStatus === 'on_the_way' || currentStatus === 'ontheway' || currentStatus === 'on the way') && statusChanged;

                // 👇 DUPLICATE CHECK LOGIC 👇
                const uniqueKey = `${newRow.id}_${currentStatus}_${newRow.bill_image || ''}`;
                if (sentNotifications.has(uniqueKey)) {
                    console.log(`⚠️ Duplicate notification blocked for Order ${newRow.id}`);
                    return; 
                }
                sentNotifications.add(uniqueKey);
                // 👆 ------------------- 👆

                if (isBillUploaded || isRiderOnWay) {
                    const billAmt = (Number(newRow.item_price) || 0) + (Number(newRow.dc_amount) || 0);
                    let walletBalance = await getWalletBalance(newRow.customer_phone);

                    let captionText = `📄 *Order Bill Details*\n\n`;
                    captionText += `Bill Amount: Rs. ${billAmt}\n`;

                    let totalPayable = billAmt;
                    if (walletBalance > 0) {
                        captionText += `Previous Due: Rs. ${walletBalance}\n`;
                        totalPayable = billAmt + walletBalance;
                    } else if (walletBalance < 0) {
                        captionText += `Remaining Amount: Rs. ${Math.abs(walletBalance)}\n`;
                        totalPayable = billAmt + walletBalance;
                    }

                    captionText += `---------------------------\n`;
                    captionText += `*Total Payable: Rs. ${totalPayable}*\n\n`;
                    captionText += `*Rider is on the way 🏍️*`;

                    // 👇 FIXED: Ab check hoga ke message gaya ya AntiBan ne roka
                    let sent = false;
                    if (newRow.bill_image) {
                        sent = await sendHumanLikeImage(sock, jid, newRow.bill_image, captionText, null, false);
                    } else {
                        sent = await sendHumanLikeReply(sock, jid, captionText, null, false);
                    }
                    
                    if (sent !== false) {
                        console.log(`✅ Bill & On-The-Way details sent to ${jid}`);
                    }
                }

                if (currentStatus === 'arrived' && statusChanged) {
                    const arrivedMsg = `*Your order has arrived 🏠*\nPlease receive your order.`;
                    const sent = await sendHumanLikeReply(sock, jid, arrivedMsg, null, false);
                    
                    if (sent !== false) {
                        console.log(`✅ Arrived message sent to ${jid}`);
                    }
                }

                if ((currentStatus === 'delivered' || currentStatus === 'completed') && statusChanged) {
                    let deliveredMsg = `*✅Order Completed:*\nThank you for choosing Faster, We appreciate your trust in our services.`;
                    let walletBalance = await getWalletBalance(newRow.customer_phone);

                    if (walletBalance > 0) {
                        deliveredMsg += `\n\n*Pending Amount:* Rs. ${walletBalance}`;
                    } else if (walletBalance < 0) {
                        deliveredMsg += `\n\n*Remaining Amount :* Rs. ${Math.abs(walletBalance)}`;
                    }
                    const sent = await sendHumanLikeReply(sock, jid, deliveredMsg, null, false);
                    
                    if (sent !== false) {
                        console.log(`✅ Delivered message sent to ${jid}`);
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
    let phone92 = phone.trim();
    if (phone92.startsWith('0')) phone92 = '92' + phone92.slice(1);
    let phone03 = phone92.startsWith('92') && phone92.length >= 11 ? '0' + phone92.slice(2) : phone92;

    try {
        const { data, error } = await supabase
            .from("wallets")
            .select("current_balance, customer_phone")
            .or(`customer_phone.eq.${phone92},customer_phone.eq.${phone03}`)
            .maybeSingle();
        if (data) return Number(data.current_balance) || 0;
    } catch (e) { console.error(e); }
    return 0;
}

startBot();