const UpbitWebScraper = require('./parser');

// Запуск веб-сервера
require('./server');

console.log('🚀 Система запущена!');
console.log(`📱 Веб-интерфейс: порт ${process.env.PORT || 3001}`);
console.log('🔧 Используйте веб-интерфейс для управления парсером');

// Обработка выхода
process.on('SIGINT', () => {
    console.log('\n🛑 Остановка системы...');
    process.exit(0);
});