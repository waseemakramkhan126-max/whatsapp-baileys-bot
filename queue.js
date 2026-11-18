const config = require('./config');

const highPriorityQueue = []; // Order Notifications ke liye
const normalQueue = [];       // Customer Replies ke liye
let isProcessing = false;

async function addToQueue(taskFn, isPriority = false) {
    return new Promise((resolve, reject) => {
        if (isPriority) {
            highPriorityQueue.push({ taskFn, resolve, reject });
        } else {
            normalQueue.push({ taskFn, resolve, reject });
        }
        processQueue();
    });
}

async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;

    // 👇 Pehle VIP (Notification) check karein
    let task = highPriorityQueue.shift();
    
    // Agar VIP khali hai, to Normal (Customer) uthayein
    if (!task) {
        task = normalQueue.shift();
    }

    if (!task) {
        isProcessing = false;
        return;
    }

    try {
        const result = await task.taskFn();
        task.resolve(result);
    } catch (err) {
        task.reject(err);
    }

    const delay = config.INTER_MESSAGE_DELAY();
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, delay);
}

module.exports = { addToQueue };