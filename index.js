const UpbitWebScraper = require('./parser');

// Запуск веб-сервера
require('./server');

console.log('🚀 Система запущена!');
console.log('📱 Веб-интерфейс: http://localhost:3000');
console.log('🔧 Используйте веб-интерфейс для управления парсером');

// Обработка выхода
process.on('SIGINT', () => {
    console.log('\n🛑 Остановка системы...');
    process.exit(0);
});