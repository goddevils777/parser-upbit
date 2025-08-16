class Dashboard {
    constructor() {
        this.ws = null;
        this.connectWebSocket();
        this.setupEventListeners();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket подключен');
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'log') {
                this.addLog(data.data);
            } else if (data.type === 'logs') {
                this.loadLogs(data.data);
            } else if (data.type === 'newPost') {
                this.addNewPost(data.data);
            } else if (data.type === 'posts') {
                this.loadPosts(data.data);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket отключен, переподключение через 5 сек...');
            setTimeout(() => this.connectWebSocket(), 5000);
        };
    }

    setupEventListeners() {
        document.getElementById('startBtn').addEventListener('click', () => this.startParser());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopParser());
        document.getElementById('testProxyBtn').addEventListener('click', () => this.testProxy());
    }

    async startParser() {
        const confirmed = await this.showConfirm(
            'Запуск парсера',
            'Запустить 15 потоков парсинга? Gap ~300ms между потоками!'
        );
        
        if (!confirmed) return;
        
        const response = await fetch('/api/start', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            this.showNotification(result.message, 'success');
        } else {
            this.showNotification(result.message, 'error');
        }
    }

    async stopParser() {
        const confirmed = await this.showConfirm(
            'Остановка парсера', 
            'Остановить все потоки парсинга?'
        );
        
        if (!confirmed) return;
        
        const response = await fetch('/api/stop', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            this.showNotification(result.message, 'success');
        } else {
            this.showNotification(result.message, 'error');
        }
    }

    async testProxy() {
        const btn = document.getElementById('testProxyBtn');
        btn.textContent = 'Тестирование...';
        btn.disabled = true;
        
        this.showNotification('Проверка прокси...', 'info');
        
        try {
            const response = await fetch('/api/test-direct', { method: 'GET' });
            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`✅ Тест успешен за ${result.duration}ms`, 'success');
            } else {
                this.showNotification(`❌ ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка при тестировании', 'error');
        } finally {
            btn.textContent = 'Тест прокси';
            btn.disabled = false;
        }
    }

    addLog(logData) {
        const logsContainer = document.getElementById('logs');
        const logElement = document.createElement('div');
        logElement.className = 'log-item';
        
        // Определяем тип лога по содержимому
        if (logData.message.includes('✅')) {
            logElement.classList.add('log-success');
        } else if (logData.message.includes('⚠️')) {
            logElement.classList.add('log-warning');
        } else if (logData.message.includes('❌')) {
            logElement.classList.add('log-error');
        } else if (logData.message.includes('🚨') || logData.message.includes('**ID:**')) {
            logElement.classList.add('log-info');
        }
        
        const time = new Date(logData.timestamp).toLocaleTimeString();
        logElement.textContent = `[${time}] ${logData.message}`;
        
        logsContainer.appendChild(logElement);
        logsContainer.scrollTop = logsContainer.scrollHeight;
        
        // Ограничиваем количество логов в DOM
        if (logsContainer.children.length > 50) {
            logsContainer.removeChild(logsContainer.firstChild);
        }
    }

    loadLogs(logs) {
        const logsContainer = document.getElementById('logs');
        logsContainer.innerHTML = '';
        logs.forEach(log => this.addLog(log));
    }

    loadPosts(posts) {
        const postsContainer = document.getElementById('posts');
        postsContainer.innerHTML = '';
        
        posts.forEach(post => {
            this.addPostToDOM(post);
        });
    }

    addNewPost(postData) {
        this.addPostToDOM(postData);
    }

    addPostToDOM(postData) {
        const postsContainer = document.getElementById('posts');
        
        // Проверяем есть ли уже пост с таким ID
        const existingPosts = Array.from(postsContainer.children);
        const postExists = existingPosts.some(post => {
            const idElement = post.querySelector('div:first-child');
            return idElement && idElement.textContent.includes(postData.id);
        });
        
        // Если пост уже есть - не добавляем
        if (postExists) {
            return;
        }
        
        // Время создания с миллисекундами
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
        
        // Время обнаружения с миллисекундами
        const detectedDate = new Date(postData.detectedAt);
        const detectedKiev = detectedDate.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + `.${detectedDate.getMilliseconds().toString().padStart(3, '0')}`;
        
        // Рассчитываем gap обнаружения
        const detectionGap = detectedDate.getTime() - postDate.getTime();
        const gapMinutes = Math.floor(detectionGap / 60000);
        const gapSeconds = Math.floor((detectionGap % 60000) / 1000);
        const gapMs = detectionGap % 1000;
        const gapText = `${gapMinutes}м ${gapSeconds}с ${gapMs}мс`;
        
        // Определяем статус поста
        let statusText = '';
        if (postData.threadId === 'info') {
            statusText = '<div><strong>Статус:</strong> 📋 Текущий пост (информация)</div>';
        } else {
            statusText = `<div><strong>⏱️ Время обнаружения:</strong> ${gapText}</div>`;
        }
        
        const postElement = document.createElement('div');
        postElement.className = 'post-item';
        postElement.innerHTML = `
            <div><strong>ID:</strong> ${postData.id}</div>
            <div><strong>Заголовок:</strong> ${postData.title}</div>
            <div><strong>Создан (Киев):</strong> ${createdKiev}</div>
            <div><strong>Обнаружен (Киев):</strong> ${detectedKiev}</div>
            ${statusText}
        `;
        
        // Добавляем в начало списка
        postsContainer.insertBefore(postElement, postsContainer.firstChild);
        
        // Ограничиваем количество постов в DOM
        if (postsContainer.children.length > 20) {
            postsContainer.removeChild(postsContainer.lastChild);
        }
    }

    // Показать уведомление
    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        // Показать с анимацией
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Скрыть через 4 секунды
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => container.removeChild(notification), 300);
        }, 4000);
    }

    // Показать модальное окно подтверждения
    showConfirm(title, message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            const modalTitle = document.getElementById('modalTitle');
            const modalMessage = document.getElementById('modalMessage');
            const confirmBtn = document.getElementById('modalConfirm');
            const cancelBtn = document.getElementById('modalCancel');
            
            modalTitle.textContent = title;
            modalMessage.textContent = message;
            modal.style.display = 'block';
            
            const handleConfirm = () => {
                modal.style.display = 'none';
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                resolve(true);
            };
            
            const handleCancel = () => {
                modal.style.display = 'none';
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                resolve(false);
            };
            
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            
            // Закрытие по клику вне модального окна
            modal.addEventListener('click', (e) => {
                if (e.target === modal) handleCancel();
            });
        });
    }
}

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});