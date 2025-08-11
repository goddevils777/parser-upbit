require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const UpbitWebScraper = require('./parser');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Telegram настройки из переменных окружения
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Статические файлы
app.use(express.static('public'));
app.use(express.json());

// Переменные для хранения данных
let logs = [];
let posts = [];
let scrapers = [];
let globalLastPostId = null;
let lastGlobalRequestTime = null;

// WebSocket для live логов
wss.on('connection', (ws) => {
    // Отправить существующие логи при подключении
    ws.send(JSON.stringify({ type: 'logs', data: logs }));
    ws.send(JSON.stringify({ type: 'posts', data: posts }));
});


async function sendToTelegram(postData) {
    const sendStartTime = Date.now();
    
    try {
        const kievDate = new Date(postData.date).toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + `.${new Date(postData.date).getMilliseconds().toString().padStart(3, '0')}`;
        
        const detectedDate = new Date(postData.detectedAt).toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + `.${new Date(postData.detectedAt).getMilliseconds().toString().padStart(3, '0')}`;
        
        const now = new Date();
        const receivedTime = now.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + `.${now.getMilliseconds().toString().padStart(3, '0')}`;
        
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: `🚨 НОВЫЙ ПОСТ UPBIT!

📝 ID: ${postData.id}
🎯 ${postData.title}
📅 Создан: ${kievDate} (Киев)
⚡ Обнаружен: ${detectedDate} (Киев)
📨 Получено: ${receivedTime} (Киев)
🔗 https://upbit.com/service_center/notice`
        });
        
        const sendEndTime = Date.now();
        const deliveryTime = sendEndTime - sendStartTime;
        
        console.log(`📤 Отправлено в Telegram: ID ${postData.id} | Доставка: ${deliveryTime}ms`);
    } catch (error) {
        const sendEndTime = Date.now();
        const deliveryTime = sendEndTime - sendStartTime;
        console.log(`❌ Ошибка отправки в Telegram: ${error.message} | Попытка заняла: ${deliveryTime}ms`);
    }
}


// Функция для отправки логов всем клиентам
function broadcastLog(message) {
    logs.push({ timestamp: new Date().toISOString(), message });
    if (logs.length > 100) logs.shift(); // Ограничение логов
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'log', data: { timestamp: logs[logs.length-1].timestamp, message } }));
        }
    });
}

// Функция для отправки новых постов
function broadcastNewPost(postData) {
    posts.unshift(postData); // Добавляем в начало массива
    if (posts.length > 50) posts.pop(); // Ограничиваем до 50 постов
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'newPost', data: postData }));
        }
    });
}


app.post('/api/start', (req, res) => {
    if (scrapers.length > 0) {
        return res.json({ success: false, message: 'Парсеры уже запущены' });
    }
    
    const proxyString = 'geo.iproyal.com:12321:qUajpQiN9232Dgco:Dhakfnsjfbsnfb_country-us';
    
    // Создаем 15 потоков
    for (let i = 1; i <= 15; i++) {
        const scraper = new UpbitWebScraper(proxyString, i);
        
        // Переопределяем метод для синхронизации lastPostId
        // Переопределяем метод для синхронизации lastPostId
        const originalCheck = scraper.checkForNewPost.bind(scraper);
        scraper.checkForNewPost = (postData) => {
            // Используем глобальный lastPostId вместо локального
            const originalLastPostId = scraper.lastPostId;
            scraper.lastPostId = globalLastPostId;
            
            const result = originalCheck(postData);
            
            // Обновляем глобальный ID если найден новый пост
            if (result && postData.id !== globalLastPostId) {
                globalLastPostId = postData.id;
                // Обновляем всем потокам
                scrapers.forEach(s => s.lastPostId = globalLastPostId);
                
                // Отправляем в веб-интерфейс
                broadcastNewPost(result);
                
                // Отправляем в Telegram
                sendToTelegram(result);
            }
            
            return result;
        };
        
        scrapers.push(scraper);
        
        // Запускаем с задержкой каждые 333ms (5сек / 15 = 333ms)
        setTimeout(() => {
            scraper.startParsing();
            console.log(`🧵${i} Поток ${i} запущен`);
        }, (i - 1) * 333);
    }
    
    // Перехватываем console.log
    const originalLog = console.log;
    console.log = (...args) => {
        const message = args.join(' ');
        originalLog(...args);
        broadcastLog(message);
    };
    
    res.json({ success: true, message: '15 потоков запущено!' });
});

// Роут для остановки парсеров
app.post('/api/stop', (req, res) => {
    if (scrapers.length === 0) {
        return res.json({ success: false, message: 'Парсеры не запущены' });
    }
    
    // Очищаем массив парсеров (они остановятся автоматически)
    scrapers.length = 0;
    globalLastPostId = null;
    
    console.log('🛑 Все потоки остановлены');
    res.json({ success: true, message: 'Все потоки остановлены' });
});

// Роут для получения статуса
app.get('/api/status', (req, res) => {
    res.json({ 
        running: scrapers.length > 0,
        threadsCount: scrapers.length,
        lastPostId: globalLastPostId
    });
});

// Замени на:
const PORT = process.env.PORT || 3001;
console.log(`🔧 Запуск на порту: ${PORT}`);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Веб-интерфейс запущен на порт ${PORT}`);
});