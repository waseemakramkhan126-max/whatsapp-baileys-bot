const { sendButtons } = require('malvin-btns');
const config = require('./config');
const { addToQueue } = require('./queue');

async function sendHumanLikeReply(sock, jid, text, msgKeys, shouldRead) {
    return await addToQueue(async () => {
        try {
            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);

            if (shouldRead && msgKeys) {
                await sock.readMessages(msgKeys); 
            }

            await sock.sendPresenceUpdate('composing', jid);

            const chars = text.length;
            let typingTime;
            if (chars < config.SHORT_TEXT_THRESHOLD) {
                typingTime = config.SHORT_TYPING_TIME();
            } else if (chars < config.LONG_TEXT_THRESHOLD) {
                typingTime = config.LONG_TYPING_TIME();
            } else {
                typingTime = config.LONG_TYPING_TIME();
            }

            await delay(typingTime);

            if (chars >= config.LONG_TEXT_THRESHOLD && Math.random() < 0.2) {
                await sock.sendPresenceUpdate('paused', jid);
                await delay(1000);
                await sock.sendPresenceUpdate('composing', jid);
                await delay(1000);
            }

            if (sock.antiban) {
                const decision = await sock.antiban.beforeSend(jid, "text");
                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked text to ${jid}. Reason: ${decision.reason}`);
                    return false; // 👈 Block hone par false return
                }
                await delay(decision.delayMs || 0);
            }

            if (chars > config.CHUNK_SIZE) {
                const chunks = splitIntoChunks(text, config.CHUNK_SIZE);
                for (let i = 0; i < chunks.length; i++) {
                    await sock.sendMessage(jid, { text: chunks[i] });
                    if (i < chunks.length - 1) {
                        await delay(config.CHUNK_GAP);
                    }
                }
            } else {
                await sock.sendMessage(jid, { text });
            }

            if (sock.antiban) {
                sock.antiban.afterSend(jid, "text");
            }
            
            return true; // 👈 Send hone par true return

        } catch (err) {
            console.error('Send error:', err);
            return false;
        }
    });
}

async function sendButtonReply(sock, jid, buttonData, msgKeys, shouldRead) {
    return await addToQueue(async () => {
        try {
            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);

            if (shouldRead && msgKeys) {
                await sock.readMessages(msgKeys);
            }

            await sock.sendPresenceUpdate('composing', jid);

            const chars = buttonData.text ? buttonData.text.length : 20;
            let typingTime = chars < config.SHORT_TEXT_THRESHOLD 
                ? config.SHORT_TYPING_TIME() 
                : config.LONG_TYPING_TIME();
            
            await delay(typingTime);

            if (sock.antiban) {
                const decision = await sock.antiban.beforeSend(jid, "button");
                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked button to ${jid}. Reason: ${decision.reason}`);
                    return false; // 👈 Block hone par false return
                }
                await delay(decision.delayMs || 0);
            }

            await sendButtons(sock, jid, buttonData);

            if (sock.antiban) {
                sock.antiban.afterSend(jid, "button");
            }
            
            return true; // 👈 Send hone par true return

        } catch (err) {
            console.error('Button send error:', err);
            return false;
        }
    });
}

async function sendHumanLikeImage(sock, jid, imageUrl, caption, msgKeys, shouldRead) {
    return await addToQueue(async () => {
        try {
            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);

            if (shouldRead && msgKeys) {
                await sock.readMessages(msgKeys); 
            }

            await sock.sendPresenceUpdate('composing', jid);

            const chars = caption ? caption.length : 20;
            let typingTime = chars < config.SHORT_TEXT_THRESHOLD 
                ? config.SHORT_TYPING_TIME() 
                : config.LONG_TYPING_TIME();
            
            await delay(typingTime);

            if (sock.antiban) {
                const decision = await sock.antiban.beforeSend(jid, "image");
                if (!decision.allowed) {
                    console.log(`🛑 AntiBan blocked image to ${jid}. Reason: ${decision.reason}`);
                    return false; // 👈 Block hone par false return
                }
                await delay(decision.delayMs || 0);
            }

            await sock.sendMessage(jid, { 
                image: { url: imageUrl }, 
                caption: caption 
            });

            if (sock.antiban) {
                sock.antiban.afterSend(jid, "image");
            }
            
            return true; // 👈 Send hone par true return

        } catch (err) {
            console.error('Image send error:', err);
            return false;
        }
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function splitIntoChunks(str, size) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
        chunks.push(str.slice(i, i + size));
    }
    return chunks;
}

module.exports = { sendHumanLikeReply, sendButtonReply, sendHumanLikeImage };