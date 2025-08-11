const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const cheerio = require('cheerio');

// Глобальная переменная для отслеживания времени
let globalLastTime = null;

class UpbitWebScraper {
    constructor(proxyString, threadId = 1) {
        this.proxyString = proxyString;
        this.threadId = threadId;
        this.apiUrl = 'https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=1&category=all';
        this.lastPostId = null;
        this.lastRequestTime = null;
        
        // Конфигурации для разных потоков
        this.threadConfigs = {
            1: { userAgent: 'Chrome/120.0.0.0', language: 'ko-KR,ko;q=0.9,en;q=0.1' },
            2: { userAgent: 'Chrome/119.0.0.0', language: 'ko-KR,ko;q=0.8,en-US;q=0.2' },
            3: { userAgent: 'Chrome/121.0.0.0', language: 'ko;q=0.9,ko-KR;q=0.8' },
            4: { userAgent: 'Chrome/118.0.0.0', language: 'ko-KR;q=0.9,ko;q=0.7' },
            5: { userAgent: 'Chrome/122.0.0.0', language: 'ko-KR,ko;q=0.8' },
            6: { userAgent: 'Chrome/117.0.0.0', language: 'ko;q=0.8,ko-KR;q=0.7' },
            7: { userAgent: 'Chrome/123.0.0.0', language: 'ko-KR,ko;q=0.9' },
            8: { userAgent: 'Chrome/116.0.0.0', language: 'ko;q=0.9,en;q=0.1' },
            9: { userAgent: 'Chrome/124.0.0.0', language: 'ko-KR;q=0.8,ko;q=0.7' },
            10: { userAgent: 'Chrome/115.0.0.0', language: 'ko-KR,ko;q=0.7,en;q=0.2' },
            11: { userAgent: 'Chrome/125.0.0.0', language: 'ko;q=0.8,ko-KR;q=0.9' },
            12: { userAgent: 'Chrome/114.0.0.0', language: 'ko-KR;q=0.7,ko;q=0.8' },
            13: { userAgent: 'Chrome/126.0.0.0', language: 'ko;q=0.7,ko-KR;q=0.8' },
            14: { userAgent: 'Chrome/113.0.0.0', language: 'ko-KR,ko;q=0.6,en;q=0.1' },
            15: { userAgent: 'Chrome/127.0.0.0', language: 'ko;q=0.6,ko-KR;q=0.7' }
        };
        
        this.config = this.threadConfigs[threadId] || this.threadConfigs[1];
    }

    parseProxy() {
        const [host, port, username, password] = this.proxyString.split(':');
        return { host, port, username, password };
    }

createHttpClient() {
    const { host, port, username, password } = this.parseProxy();
    const proxyUrl = `http://${username}:${password}@${host}:${port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    
    return axios.create({
        httpsAgent: agent,
        timeout: 10000,
        headers: {
            'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${this.config.userAgent} Safari/537.36`,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': this.config.language,
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
    });
}
async fetchPage() {
    const client = this.createHttpClient();
    const timestamp = new Date().toISOString();
    
    try {
        const response = await client.get(this.apiUrl);
        const notices = response.data?.data?.notices || [];
        // Убираем старый лог - gap будет показан в checkForNewPost
        return notices;
    } catch (error) {
        if (error.response?.status === 429) {
            console.log(`[${timestamp}] 🧵${this.threadId} ⚠️  429 - Rate limit`);
        } else if (error.response?.status === 403) {
            console.log(`[${timestamp}] 🧵${this.threadId} ⚠️  403 - CloudFlare блок`);
        } else {
            console.log(`[${timestamp}] 🧵${this.threadId} ❌ Ошибка: ${error.message}`);
        }
        return null;
    }
}

parseLatestNews(notices) {
    if (!notices || !Array.isArray(notices) || notices.length === 0) {
        console.log('⚠️  Нет новостей в API');
        return null;
    }
    
    // Берем первую новость (самая свежая)
    const latestPost = notices[0];
    
    const postData = {
        id: latestPost.id,
        title: latestPost.title,
        date: latestPost.listed_at || latestPost.first_listed_at,
        pinned: latestPost.pinned || false
    };
    
    // Убираем отдельный лог поста - он будет в checkForNewPost
    return postData;
}

checkForNewPost(postData) {
    if (!postData) {
        return false;
    }
    
    const timestamp = new Date().toISOString();
    const now = Date.now();
    
    // Рассчитываем глобальный gap
    let gapText = '';
    if (globalLastTime) {
        const gapMs = now - globalLastTime;
        gapText = ` | ⚡${gapMs}ms`;
    } else {
        gapText = ' | ⚡First';
    }
    globalLastTime = now;
    
    const shortTitle = postData.title.substring(0, 50) + '...';
    const threadInfo = `🧵${this.threadId}`;
    
    const postForWeb = {
        timestamp, 
        id: postData.id,
        title: postData.title,
        date: postData.date,
        detectedAt: timestamp,
        threadId: this.threadId
    };
    
    if (this.lastPostId === null) {
        this.lastPostId = postData.id;
        console.log(`[${timestamp}] ${threadInfo} 🔥 Инициализация: ID ${postData.id} | ${shortTitle}${gapText}`);
        this.lastRequestTime = now;
        return postForWeb;
    }
    
    if (postData.id !== this.lastPostId) {
        console.log(`[${timestamp}] ${threadInfo} 🚨 НОВЫЙ ПОСТ! ID: ${postData.id} | ${shortTitle}${gapText}`);
        this.lastPostId = postData.id;
        this.lastRequestTime = now;
        return postForWeb;
    } else {
        console.log(`[${timestamp}] ${threadInfo} 📍 ID ${postData.id} | ${shortTitle}${gapText}`);
        this.lastRequestTime = now;
    }
    
    return false;
}

async startParsing() {
    console.log('🚀 Запуск парсера Upbit API...');
    console.log(`📡 Целевой API: ${this.apiUrl}\n`);
    
    const parseLoop = async () => {
        const apiData = await this.fetchPage();
        
        if (apiData) {
            const postData = this.parseLatestNews(apiData);
            if (postData) {
                this.checkForNewPost(postData);
            }
        }
        
        // Увеличиваем интервал с 2-5 сек до 3-7 сек
        const delay = Math.floor(Math.random() * 4000) + 3000;
        setTimeout(parseLoop, delay);
    };
    
    parseLoop();
}
}

module.exports = UpbitWebScraper;