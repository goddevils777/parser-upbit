const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const cheerio = require('cheerio');

// Глобальные переменные для отслеживания времени
let globalLastTime = null;
let globalLastRequestTime = null; // Время последнего запроса ЛЮБОГО потока

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
            15: { userAgent: 'Chrome/127.0.0.0', language: 'ko;q=0.6,ko-KR;q=0.7' },
            16: { userAgent: 'Chrome/128.0.0.0', language: 'ko-KR,ko;q=0.5,en;q=0.2' },
            17: { userAgent: 'Chrome/112.0.0.0', language: 'ko;q=0.5,ko-KR;q=0.6' },
            18: { userAgent: 'Chrome/129.0.0.0', language: 'ko-KR;q=0.6,ko;q=0.5' },
            19: { userAgent: 'Chrome/111.0.0.0', language: 'ko;q=0.4,ko-KR;q=0.5,en;q=0.1' },
            20: { userAgent: 'Chrome/130.0.0.0', language: 'ko-KR,ko;q=0.4' },
            21: { userAgent: 'Chrome/110.0.0.0', language: 'ko;q=0.3,ko-KR;q=0.4' },
            22: { userAgent: 'Chrome/131.0.0.0', language: 'ko-KR;q=0.5,ko;q=0.3' },
            23: { userAgent: 'Chrome/109.0.0.0', language: 'ko;q=0.6,ko-KR;q=0.4' },
            24: { userAgent: 'Chrome/132.0.0.0', language: 'ko-KR,ko;q=0.2,en;q=0.1' },
            25: { userAgent: 'Chrome/108.0.0.0', language: 'ko;q=0.2,ko-KR;q=0.3' }
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
            timeout: 4000,
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
        const startTime = Date.now();
        
        // Показываем когда начинаем запрос
        const startTimeStr = new Date(startTime).toLocaleTimeString('uk-UA', {
            timeZone: 'Europe/Kiev',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + `.${startTime % 1000}`;
        
        // Рассчитываем gap с последним запросом ЛЮБОГО потока
        let globalGapText = '';
        if (globalLastRequestTime) {
            const globalGapMs = startTime - globalLastRequestTime;
            globalGapText = ` | 🌐${globalGapMs}ms`;
        } else {
            globalGapText = ' | 🌐First';
        }
        
        // Рассчитываем gap с последним запросом ЭТОГО потока
        let threadGapText = '';
        if (this.lastRequestTime) {
            const threadGapMs = startTime - this.lastRequestTime;
            threadGapText = ` | ⚡${threadGapMs}ms`;
        } else {
            threadGapText = ' | ⚡First';
        }
        
        // Обновляем глобальное время
        globalLastRequestTime = startTime;
        
        try {
            const response = await client.get(this.apiUrl);
            const endTime = Date.now();
            const requestDuration = endTime - startTime;
            
            // Обновляем время этого потока
            this.lastRequestTime = endTime;
            
            const notices = response.data?.data?.notices || [];
            console.log(`✅ ${this.threadId} [${startTimeStr}] Ответ за ${requestDuration}ms | Новостей: ${notices.length}${globalGapText}${threadGapText}`);
            
            // Сохраняем время начала запроса для точного времени обнаружения
            this.lastFetchStartTime = startTime;
            
            return notices;
        } catch (error) {
            const endTime = Date.now();
            const requestDuration = endTime - startTime;
            
            // Обновляем время даже при ошибке
            this.lastRequestTime = endTime;
            
            if (error.response?.status === 429) {
                console.log(`❌ ${this.threadId} [${startTimeStr}] 429 Rate limit за ${requestDuration}ms${globalGapText}`);
            } else if (error.response?.status === 403) {
                console.log(`❌ ${this.threadId} [${startTimeStr}] 403 CloudFlare блок за ${requestDuration}ms${globalGapText}`);
            } else {
                console.log(`❌ ${this.threadId} [${startTimeStr}] Ошибка за ${requestDuration}ms: ${error.message}${globalGapText}`);
            }
            return null;
        }
    }

    parseLatestNews(notices) {
        const parseStartTime = Date.now();
        console.log(`⏰ ${this.threadId} parseLatestNews внутри функции: ${parseStartTime}`);
        
        if (!notices || !Array.isArray(notices) || notices.length === 0) {
            console.log(`⚠️ ${this.threadId} Нет новостей в API`);
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
        
        // Простой лог для отслеживания
        const shortTitle = postData.title.substring(0, 40) + '...';
        console.log(`📍 ${this.threadId} ID ${postData.id} | ${shortTitle}`);
        
        const parseEndTime = Date.now();
        console.log(`⏰ ${this.threadId} parseLatestNews объект создан: ${parseEndTime} (${parseEndTime - parseStartTime}ms)`);
        
        return postData;
    }

    checkForNewPost(postData) {
        // Этот метод ПОЛНОСТЬЮ переопределяется в server.js
        // Здесь только базовая логика для работы без server.js
        if (!postData) {
            return false;
        }
        
        // Используем сохраненное время начала запроса или текущее время
        const detectionTime = this.lastFetchStartTime || Date.now();
        
        const postForWeb = {
            timestamp: new Date().toISOString(),
            id: postData.id,
            title: postData.title,
            date: postData.date,
            detectedAt: new Date(detectionTime).toISOString(),
            threadId: this.threadId
        };
        
        // Простая проверка без логирования
        if (this.lastPostId === null) {
            this.lastPostId = postData.id;
            return postForWeb;
        }
        
        if (postData.id !== this.lastPostId) {
            this.lastPostId = postData.id;
            return postForWeb;
        }
        
        return false;
    }

    async startParsing() {
        console.log(`🧵${this.threadId} Поток ${this.threadId} запущен`);
        
        // Фиксированный интервал для каждого потока
        const fixedInterval = 1000 + (this.threadId - 1) * 100; // 1.0с, 1.1с, 1.2с... 2.4с
        console.log(`🧵${this.threadId} Интервал запросов: ${fixedInterval}ms`);
        
        const parseLoop = async () => {
            const loopStartTime = Date.now();
            console.log(`⏰ ${this.threadId} parseLoop начался: ${loopStartTime}`);
            
            const apiData = await this.fetchPage();
            const fetchEndTime = Date.now();
            console.log(`⏰ ${this.threadId} fetchPage завершен: ${fetchEndTime} (${fetchEndTime - loopStartTime}ms)`);
            
            if (apiData) {
                const parseStartTime = Date.now();
                console.log(`⏰ ${this.threadId} parseLatestNews начинается: ${parseStartTime}`);
                
                const postData = this.parseLatestNews(apiData);
                const parseEndTime = Date.now();
                console.log(`⏰ ${this.threadId} parseLatestNews завершен: ${parseEndTime} (${parseEndTime - parseStartTime}ms)`);
                
                if (postData) {
                    const checkStartTime = Date.now();
                    console.log(`⏰ ${this.threadId} checkForNewPost начинается: ${checkStartTime}`);
                    
                    this.checkForNewPost(postData);
                    
                    const checkEndTime = Date.now();
                    console.log(`⏰ ${this.threadId} checkForNewPost завершен: ${checkEndTime} (${checkEndTime - checkStartTime}ms)`);
                }
            }
            
            const totalTime = Date.now() - loopStartTime;
            console.log(`⏰ ${this.threadId} parseLoop полный цикл: ${totalTime}ms`);
            
            // Фиксированный интервал без рандома
            setTimeout(parseLoop, fixedInterval);
        };
        
        parseLoop();
    }
}

module.exports = UpbitWebScraper;