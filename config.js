require('dotenv').config();

module.exports = {
    DEBOUNCE_TIME: 3000, 
    INTER_MESSAGE_DELAY: () => Math.random() * 500 + 200, // 0.2 - 0.7 sec (Fast queue movement)
    
    // 👇 Delay kam kar diya taake naya customer foran reply paye
    SMART_DELAY: () => Math.random() * 1000 + 1000, // 1-2 sec
    SHORT_TEXT_THRESHOLD: 50,
    LONG_TEXT_THRESHOLD: 100,
    SHORT_TYPING_TIME: () => Math.random() * 500 + 1000, // 1-1.5 sec
    LONG_TYPING_TIME: () => Math.random() * 1000 + 1500,  // 1.5-2.5 sec

    DEAD_END_KEYWORDS: ['ok', 'okay', 'okei', 'theek hai', 'thik hai', 'thanks', 'thank you', 'shukriya', 'nice service', '👍', '🙏', '😊', '❤️'],

    CHUNK_SIZE: 1000,
    CHUNK_GAP: 1500,
    NIGHT_START_HOUR: 0,
    NIGHT_END_HOUR: 8,
    NIGHT_REPLY_TEXT: "Maaf kijiye, hamari service abhi band hai. Subah 8 baje open hogi.",
    REPLY_COOLDOWN_MINUTES: 30, 
    AI_ENDPOINT: 'https://hkabhikizdlbavfkualt.supabase.co/functions/v1/chat-brain',
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};
