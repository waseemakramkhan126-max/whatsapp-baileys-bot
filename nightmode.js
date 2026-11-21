// Sirf track karne ke liye ke kis customer ko night reply mil chuka hai
const nightReplied = new Map();

function hasNightReplyBeenSent(jid) {
    return nightReplied.has(jid);
}

function markNightReplyAsSent(jid) {
    nightReplied.set(jid, true);
}

/** Subah hote hi sab users ki night tracking reset */
function resetNightMode() {
    nightReplied.clear();
}

module.exports = { hasNightReplyBeenSent, markNightReplyAsSent, resetNightMode };
