require('dotenv').config();

module.exports = {
    // Phase 1: Debounce
    DEBOUNCE_TIME: 3000,

    // Phase 2: Queue & Rate Limiting
    INTER_MESSAGE_DELAY: () => Math.random() * 1700 + 800,
    DAILY_MSG_CAP: 150,

    // Phase 3: Human-like Reply
    SMART_DELAY: () => Math.random() * 3000 + 1000,
    SHORT_TEXT_THRESHOLD: 50,
    LONG_TEXT_THRESHOLD: 100,
    SHORT_TYPING_TIME: () => Math.random() * 1000 + 2000,
    LONG_TYPING_TIME: () => Math.random() * 2000 + 3000,

    // Phase 4: Dead-end keywords
    DEAD_END_KEYWORDS: ['ok', 'thanks', 'thank you', '👍', '🙏', 'shukriya', 'thik hai'],

    // Phase 5: Chunking
    CHUNK_SIZE: 200,
    CHUNK_GAP: 1500,

    // Phase 6: Night Mode
    NIGHT_START_HOUR: 0,
    NIGHT_END_HOUR: 8,
    NIGHT_REPLY_TEXT: "Maaf kijiye, hamari service abhi band hai. Subah 8 baje open hogi.",
    
    // Auto-reply timer (minutes mein)
    REPLY_COOLDOWN_MINUTES: 30, 

    // AI Endpoint
    AI_ENDPOINT: 'https://hkabhikizdlbavfkualt.supabase.co/functions/v1/chat-brain',
    
    // Supabase Credentials (loaded from .env)
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};