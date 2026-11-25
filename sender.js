const { sendButtons } = require('malvin-btns');
const config = require('./config');
const { addToQueue } = require('./queue');

// 👇 Notification Throttling ke liye global variable
let lastNotificationTime = 0; 

async function sendHumanLikeReply(sock, jid, text, msgKeys, shouldRead, isNotification = false) {
    return await addToQueue(async () => {
        try {
            // 👇 Notification 1-Second Delay Logic (Agar sab ek sath aa rahe hain) 👇
            if (isNotification) {
                const now = Date.now();
                const timeSinceLast = now - lastNotificationTime;
                if (timeSinceLast < 1000) {
                    const waitTime = 1000 - timeSinceLast;
                    console.log(`⏳ Sequential Notification Delay: waiting ${waitTime}ms...`);
                    await delay(waitTime);
                }
                lastNotificationTime = Date.now();
            }
            // 👆 ------------------------------------------------------------------ 👆

            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);

            if (shouldRead && msgKeys) await sock.readMessages(msgKeys); 
            await sock.sendPresenceUpdate('composing', jid);

            const chars = text.length;
            let typingTime = chars < config.SHORT_TEXT_THRESHOLD ? config.SHORT_TYPING_TIME() : config.LONG_TYPING_TIME();
            await delay(typingTime);

            if (sock.antiban) {
                let decision = await sock.antiban.beforeSend(jid, "text");
                let retries = 0;
                
                // 👇 Notification ke liye Infinite Retry (Kabhi drop nahi hoga) 👇
                while (!decision.allowed && isNotification) {
                    retries++;
                    console.log(`⏳ AntiBan hit. Waiting 15s... (Attempt ${retries})`);
                    await delay(15000); 
                    decision = await sock.antiban.beforeSend(jid, "text");
                }
                // 👆 ------------------------------------------------------- 👆

                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked text to ${jid}. Dropped.`);
                    return false; 
                }
                await delay(decision.delayMs || 0);
            }

            let success = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    if (chars > config.CHUNK_SIZE) {
                        const chunks = splitIntoChunks(text, config.CHUNK_SIZE);
                        for (let i = 0; i < chunks.length; i++) {
                            await sock.sendMessage(jid, { text: chunks[i] });
                            if (i < chunks.length - 1) await delay(config.CHUNK_GAP);
                        }
                    } else {
                        await sock.sendMessage(jid, { text });
                    }
                    success = true;
                    break;
                } catch (err) {
                    console.log(`⚠️ Send attempt ${attempt} failed: ${err.message}`);
                    if (attempt < 3) await delay(2000);
                }
            }

            if (!success) {
                console.log(`❌ All 3 attempts failed for ${jid}. Message dropped.`);
                return false;
            }

            if (sock.antiban) sock.antiban.afterSend(jid, "text");
            return true; 
        } catch (err) {
            console.error('Send error:', err);
            return false;
        }
    }, isNotification); 
}

async function sendHumanLikeImage(sock, jid, imageUrl, caption, msgKeys, shouldRead, isNotification = false) {
    return await addToQueue(async () => {
        try {
            // 👇 Notification 1-Second Delay Logic 👇
            if (isNotification) {
                const now = Date.now();
                const timeSinceLast = now - lastNotificationTime;
                if (timeSinceLast < 1000) {
                    const waitTime = 1000 - timeSinceLast;
                    console.log(`⏳ Sequential Notification Delay: waiting ${waitTime}ms...`);
                    await delay(waitTime);
                }
                lastNotificationTime = Date.now();
            }
            // 👆 --------------------------------- 👆

            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);

            if (shouldRead && msgKeys) await sock.readMessages(msgKeys); 
            await sock.sendPresenceUpdate('composing', jid);

            const chars = caption ? caption.length : 20;
            let typingTime = chars < config.SHORT_TEXT_THRESHOLD ? config.SHORT_TYPING_TIME() : config.LONG_TYPING_TIME();
            await delay(typingTime);

            if (sock.antiban) {
                let decision = await sock.antiban.beforeSend(jid, "image");
                let retries = 0;

                // 👇 Notification Infinite Retry 👇
                while (!decision.allowed && isNotification) {
                    retries++;
                    console.log(`⏳ AntiBan hit. Waiting 15s... (Attempt ${retries})`);
                    await delay(15000); 
                    decision = await sock.antiban.beforeSend(jid, "image");
                }
                // 👆 --------------------------- 👆

                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked image to ${jid}. Dropped.`);
                    return false; 
                }
                await delay(decision.delayMs || 0);
            }

            let success = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await sock.sendMessage(jid, { image: { url: imageUrl }, caption: caption });
                    success = true;
                    break; 
                } catch (err) {
                    console.log(`⚠️ Image send attempt ${attempt} failed: ${err.message}`);
                    if (attempt < 3) await delay(2000); 
                }
            }

            if (!success) {
                console.log(`❌ All 3 attempts failed for image to ${jid}. Message dropped.`);
                return false;
            }

            if (sock.antiban) sock.antiban.afterSend(jid, "image");
            return true; 
        } catch (err) {
            console.error('Image send error:', err);
            return false;
        }
    }, isNotification);
}

async function sendButtonReply(sock, jid, buttonData, msgKeys, shouldRead) {
    return await addToQueue(async () => {
        try {
            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);
            if (shouldRead && msgKeys) await sock.readMessages(msgKeys);
            await sock.sendPresenceUpdate('composing', jid);

            const chars = buttonData.text ? buttonData.text.length : 20;
            let typingTime = chars < config.SHORT_TEXT_THRESHOLD ? config.SHORT_TYPING_TIME() : config.LONG_TYPING_TIME();
            await delay(typingTime);

            // 👇 Button ke liye AntiBan check hata diya taake kabhi block na ho 👇
            // Button hamesha send hoga
            // 👆 ------------------------------------------------------------- 👆

            let success = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await sendButtons(sock, jid, buttonData);
                    success = true;
                    break;
                } catch (err) {
                    console.log(`⚠️ Button send attempt ${attempt} failed: ${err.message}`);
                    if (attempt < 3) await delay(2000);
                }
            }

            if (!success) {
                console.log(`❌ All 3 attempts failed for button to ${jid}. Message dropped.`);
                return false;
            }

            if (sock.antiban) sock.antiban.afterSend(jid, "button");
            return true; 
        } catch (err) {
            console.error('Button send error:', err);
            return false;
        }
    }, false); 
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function splitIntoChunks(str, size) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
    return chunks;
}

module.exports = { sendHumanLikeReply, sendButtonReply, sendHumanLikeImage };
