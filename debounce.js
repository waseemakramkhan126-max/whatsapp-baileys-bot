const config = require('./config');

// Har user ke liye ek buffer
const buffers = new Map();

/**
 * @param {string} jid - sender ka ID
 * @param {string} text - incoming message text
 * @param {object} msgKey - message ki ID (blue tick ke liye)
 * @param {function} callback - jab grouping complete ho, combined text aur keys ke saath call
 */
function handleIncomingMessage(jid, text, msgKey, callback) {
    if (!buffers.has(jid)) {
        buffers.set(jid, { messages: [], keys: [], timer: null });
    }
    const buf = buffers.get(jid);
    buf.messages.push(text);
    buf.keys.push(msgKey); // 👈 Message ki key save karein
    
    clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
        const combined = buf.messages.join('\n');
        const keys = [...buf.keys]; // 👈 Saari keys copy karein
        buf.messages = [];
        buf.keys = [];
        callback(combined, keys); // 👈 Callback ko text aur keys dono dein
    }, config.DEBOUNCE_TIME);
}

module.exports = { handleIncomingMessage };