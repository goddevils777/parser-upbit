require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
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

// Файл для хранения последнего ID
const LAST_ID_FILE = path.join(__dirname, 'last_post_id.json');

// Статические файлы
app.use(express.static('public'));
app.use(express.json());

// Переменные для хранения данных
let logs = [];
let posts = [];
let scrapers = [];
let globalLastPostId = null;
let processedPostIds = new Set(); // Кэш обработанных ID
let lastProcessedTime = 0;

// WebSocket для live логов
wss.on('connection', (ws) => {
    // Отправить существующие логи при подключении
    ws.send(JSON.stringify({ type: 'logs', data: logs }));
    ws.send(JSON.stringify({ type: 'posts', data: posts }));
});

async function loadLastPostId() {
    try {
        const data = await fs.readFile(LAST_ID_FILE, 'utf8');
        const parsed = JSON.parse(data);
        console.log(`📂 Загружен последний ID из файла: ${parsed.lastPostId}`);
        return parsed.lastPostId;
    } catch (error) {
        console.log('📂 Файл с последним ID не найден, начинаем с нуля');
        return null;
    }
}

// Функция сохранения последнего ID
async function saveLastPostId(postId) {
    try {
        await fs.writeFile(LAST_ID_FILE, JSON.stringify({ 
            lastPostId: postId, 
            savedAt: new Date().toISOString() 
        }));
        console.log(`💾 Сохранен последний ID: ${postId}`);
    } catch (error) {
        console.error('❌ Ошибка сохранения ID:', error.message);
    }
}

async function sendToTelegram(postData) {
    const sendStartTime = Date.now();
    
    try {
        // Исправляем время создания - конвертируем корейское время в киевское
        const koreanDate = new Date(postData.date);
        const kievDate = koreanDate.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const detectedDate = new Date(postData.detectedAt).toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const now = new Date();
        const receivedTime = now.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
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
        
        console.log(`📤 ✅ Доставлено в Telegram за ${deliveryTime}ms`);
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

app.post('/api/start', async (req, res) => {
    if (scrapers.length > 0) {
        return res.json({ success: false, message: 'Парсеры уже запущены' });
    }
    
    // НЕ загружаем из файла - начинаем с нуля каждый раз
    globalLastPostId = null;
    console.log(`🔄 Запуск с нуля - файл игнорируется`);
    
    // Очищаем кэш при запуске
    processedPostIds.clear();
    
    const proxyString = 'geo.iproyal.com:12321:qUajpQiN9232Dgco:Dhakfnsjfbsnfb_country-us';
    
    // Флаг для первого поста
    let firstPostReceived = false;
    
    // Переменная для отслеживания первого обнаружения
    let firstDetectionTime = null;
    
    // Создаем 15 потоков (было 25, снижаем нагрузку)
    for (let i = 1; i <= 15; i++) {
        const scraper = new UpbitWebScraper(proxyString, i);
        
        // НЕ устанавливаем начальный ID - начинаем с null
        scraper.lastPostId = null;
        
        // Переопределяем метод для централизованной обработки
        const originalCheck = scraper.checkForNewPost.bind(scraper);
        scraper.checkForNewPost = async (postData) => {
            if (!postData) return false;
            
            // Записываем время СРАЗУ в начале функции (используем timestamp из логов)
            const exactDetectionTime = new Date();
            const timestampForLog = exactDetectionTime.getTime();
            
            console.log(`⏰ ${scraper.threadId} checkForNewPost время записано: ${timestampForLog}`);
            
            // ПЕРВЫЙ пост с любого потока - сразу показываем
            if (!firstPostReceived) {
                firstPostReceived = true;
                globalLastPostId = postData.id;
                
                console.log(`🚀 ПЕРВЫЙ ПОСТ ID ${postData.id} от потока ${scraper.threadId} - timestamp: ${timestampForLog}`);
                
                // МОМЕНТАЛЬНО обновляем ID всем потокам чтобы избежать дублей
                scrapers.forEach(s => {
                    s.lastPostId = postData.id;
                });
                
                // Используем ТОТЖЕ timestamp для отображения 
                const displayTime = new Date(timestampForLog);
                
                // Время обнаружения БЕЗ конверсии часового пояса
                const detectedKiev = displayTime.toLocaleString('uk-UA', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) + `.${displayTime.getMilliseconds().toString().padStart(3, '0')}`;
                
                console.log(`🕐 Проверка времени: timestamp=${timestampForLog}, отображение=${detectedKiev}`);
                
                // Время создания поста в Киеве
                const postDate = new Date(postData.date);
                const createdKiev = postDate.toLocaleString('uk-UA', {
                    timeZone: 'Europe/Kiev',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) + `.${postDate.getMilliseconds().toString().padStart(3, '0')}`;
                
                // Рассчитываем время обнаружения (gap)
                const detectionGap = displayTime.getTime() - postDate.getTime();
                const gapMinutes = Math.floor(detectionGap / 60000);
                const gapSeconds = Math.floor((detectionGap % 60000) / 1000);
                const gapMs = detectionGap % 1000;
                const gapText = `${gapMinutes}м ${gapSeconds}с ${gapMs}мс`;
                
                // Создаем объект для отправки
                const postForSending = {
                    timestamp: new Date().toISOString(),
                    id: postData.id,
                    title: postData.title,
                    date: postData.date,
                    detectedAt: displayTime.toISOString(), // Используем тотже timestamp
                    threadId: scraper.threadId
                };
                
                // Красивый лог в веб-интерфейс
                const detailedLog = `🚀 ПЕРВЫЙ ПОСТ ОБНАРУЖЕН потоком ${scraper.threadId}:
**ID:** ${postData.id}
**Заголовок:** ${postData.title}
**Создан (Киев):** ${createdKiev}
**Обнаружен (Киев):** ${detectedKiev}
⏱️ **Время обнаружения:** ${gapText}
📤 Моментально передается в интерфейс...`;
                
                console.log(detailedLog);
                
                // МОМЕНТАЛЬНО отправляем в веб-интерфейс (без ожидания записи в файл)
                broadcastNewPost(postForSending);
                
                console.log(`✅ Первый пост ID ${postData.id} моментально передан в интерфейс, все потоки обновлены`);
                
                // Сохраняем в файл АСИНХРОННО (не блокируя отображение)
                saveLastPostId(postData.id).catch(err => 
                    console.log(`❌ Ошибка записи в файл: ${err.message}`)
                );
                
                return postForSending;
            }
            
            // Проверяем только если это действительно больший ID
            if (postData.id > globalLastPostId && !processedPostIds.has(postData.id)) {
                console.log(`🆕 Новый пост обнаружен потоком ${scraper.threadId}: ID ${postData.id}`);
                
                // Добавляем в кэш
                processedPostIds.add(postData.id);
                
                // Чистим старые ID из кэша (оставляем последние 20)
                if (processedPostIds.size > 20) {
                    const sortedIds = Array.from(processedPostIds).sort((a, b) => b - a);
                    processedPostIds = new Set(sortedIds.slice(0, 20));
                }
                
                // Обновляем глобальный ID
                globalLastPostId = postData.id;
                
                // Время обнаружения в Киеве
                const detectedTime = new Date();
                const detectedKiev = detectedTime.toLocaleString('uk-UA', {
                    timeZone: 'Europe/Kiev',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) + `.${detectedTime.getMilliseconds().toString().padStart(3, '0')}`;
                
                // Время создания поста в Киеве
                const postDate = new Date(postData.date);
                const createdKiev = postDate.toLocaleString('uk-UA', {
                    timeZone: 'Europe/Kiev',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) + `.${postDate.getMilliseconds().toString().padStart(3, '0')}`;
                
                // Рассчитываем время обнаружения (gap)
                const detectionGap = detectedTime.getTime() - postDate.getTime();
                const gapMinutes = Math.floor(detectionGap / 60000);
                const gapSeconds = Math.floor((detectionGap % 60000) / 1000);
                const gapMs = detectionGap % 1000;
                const gapText = `${gapMinutes}м ${gapSeconds}с ${gapMs}мс`;
                
                // Создаем объект для отправки
                const postForSending = {
                    timestamp: new Date().toISOString(),
                    id: postData.id,
                    title: postData.title,
                    date: postData.date,
                    detectedAt: detectedTime.toISOString(),
                    threadId: scraper.threadId
                };
                
                // Красивый лог в веб-интерфейс
                const detailedLog = `**ID:** ${postData.id}
**Заголовок:** ${postData.title}
**Создан (Киев):** ${createdKiev}
**Обнаружен (Киев):** ${detectedKiev}
⏱️ **Время обнаружения:** ${gapText}
📤 Отправляется в Telegram...`;
                
                console.log(detailedLog);
                
                // МОМЕНТАЛЬНО отправляем в веб-интерфейс
                broadcastNewPost(postForSending);
                
                console.log(`✅ Пост ID ${postData.id} моментально передан в интерфейс`);
                
                // Сохраняем в файл и отправляем в Telegram АСИНХРОННО
                Promise.all([
                    saveLastPostId(postData.id),
                    sendToTelegram(postForSending)
                ]).then(() => {
                    console.log(`📤 ✅ Пост ID ${postData.id} отправлен в Telegram и сохранен в файл`);
                }).catch(err => {
                    console.log(`❌ Ошибка при сохранении/отправке: ${err.message}`);
                });
                
                return postForSending;
            }
            
            // Если не новый пост - возвращаем результат оригинальной проверки для логов
            return originalCheck(postData);
        };
                
        scrapers.push(scraper);
        
        // Запускаем с задержкой каждые 300ms (15 потоков * 300ms = 4.5 сек)
        setTimeout(() => {
            scraper.startParsing();
            console.log(`🧵${i} Поток ${i} запущен`);
        }, (i - 1) * 300);
    }
    
    // Перехватываем console.log для live логов
    const originalLog = console.log;
    console.log = (...args) => {
        const message = args.join(' ');
        originalLog(...args);
        broadcastLog(message);
    };
    
    res.json({ success: true, message: '15 потоков запущено! Первый пост будет показан моментально при обнаружении.' });
});

// Роут для остановки парсеров
app.post('/api/stop', (req, res) => {
    if (scrapers.length === 0) {
        return res.json({ success: false, message: 'Парсеры не запущены' });
    }
    
    // Очищаем массив парсеров (они остановятся автоматически)
    scrapers.length = 0;
    globalLastPostId = null;
    processedPostIds.clear(); // Очищаем кэш
    
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

// Тест прямого запроса
app.get('/api/test-direct', async (req, res) => {
    const startTime = Date.now();
    console.log(`🧪 Тест прямого запроса: ${startTime}`);
    
    try {
        const response = await axios.get('https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=1&category=all');
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        const latestPost = response.data?.data?.notices?.[0];
        
        console.log(`✅ Тест завершен: ${endTime} | Длительность: ${duration}ms`);
        
        res.json({
            success: true,
            duration: duration,
            latestPost: latestPost ? {
                id: latestPost.id,
                title: latestPost.title,
                created: latestPost.listed_at
            } : null
        });
    } catch (error) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        res.json({
            success: false,
            duration: duration,
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3001;
console.log(`🔧 Запуск на порту: ${PORT}`);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Веб-интерфейс запущен на порт ${PORT}`);
});