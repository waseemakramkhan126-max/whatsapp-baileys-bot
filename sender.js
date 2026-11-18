const { sendButtons } = require('malvin-btns');
const config = require('./config');
const { addToQueue } = require('./queue');

async function sendHumanLikeReply(sock, jid, text, msgKeys, shouldRead, isNotification = false) {
    // 👇 addToQueue mein isNotification pass kiya taake Priority milay
    return await addToQueue(async () => {
        try {
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
                const maxRetries = isNotification ? 2 : 0; // Notifications ke liye 2 dafa try

                while (!decision.allowed && isNotification && retries < maxRetries) {
                    console.log(`⏳ AntiBan hit. Waiting 15s... (${retries+1}/${maxRetries})`);
                    await delay(15000); 
                    decision = await sock.antiban.beforeSend(jid, "text");
                    retries++;
                }

                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked text to ${jid}. Dropped.`);
                    return false; 
                }
                await delay(decision.delayMs || 0);
            }

            if (chars > config.CHUNK_SIZE) {
                const chunks = splitIntoChunks(text, config.CHUNK_SIZE);
                for (let i = 0; i < chunks.length; i++) {
                    await sock.sendMessage(jid, { text: chunks[i] });
                    if (i < chunks.length - 1) await delay(config.CHUNK_GAP);
                }
            } else {
                await sock.sendMessage(jid, { text });
            }

            if (sock.antiban) sock.antiban.afterSend(jid, "text");
            return true; 
        } catch (err) {
            console.error('Send error:', err);
            return false;
        }
    }, isNotification); // 👈 Yahan flag pass hua
}

async function sendHumanLikeImage(sock, jid, imageUrl, caption, msgKeys, shouldRead, isNotification = false) {
    return await addToQueue(async () => {
        try {
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
                const maxRetries = isNotification ? 2 : 0;

                while (!decision.allowed && isNotification && retries < maxRetries) {
                    console.log(`⏳ AntiBan hit. Waiting 15s... (${retries+1}/${maxRetries})`);
                    await delay(15000); 
                    decision = await sock.antiban.beforeSend(jid, "image");
                    retries++;
                }

                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked image to ${jid}. Dropped.`);
                    return false; 
                }
                await delay(decision.delayMs || 0);
            }

            await sock.sendMessage(jid, { image: { url: imageUrl }, caption: caption });
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

            if (sock.antiban) {
                const decision = await sock.antiban.beforeSend(jid, "button");
                if (!decision.allowed) return false;
                await delay(decision.delayMs || 0);
            }

            await sendButtons(sock, jid, buttonData);
            if (sock.antiban) sock.antiban.afterSend(jid, "button");
            return true; 
        } catch (err) {
            console.error('Button send error:', err);
            return false;
        }
    }, false); // Button normal queue mein jayega
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function splitIntoChunks(str, size) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
    return chunks;
}

module.exports = { sendHumanLikeReply, sendButtonReply, sendHumanLikeImage };