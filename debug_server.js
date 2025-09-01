const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Mumbai Rain Monitor...');
console.log('📍 Port:', PORT);
console.log('📂 Static files from:', path.join(__dirname, 'public'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Sample data
const MUMBAI_ZONES = [
    { name: 'Colaba', lat: 18.9067, lon: 72.8147 },
    { name: 'CST', lat: 18.9398, lon: 72.8355 },
    { name: 'Fort', lat: 18.9338, lon: 72.8356 },
    { name: 'Marine Lines', lat: 18.9467, lon: 72.8258 },
    { name: 'Grant Road', lat: 18.9658, lon: 72.8147 },
    { name: 'Lamington Road', lat: 18.9735, lon: 72.8162 },
    { name: 'Mazgaon', lat: 18.9697, lon: 72.8434 },
    { name: 'Byculla', lat: 18.9793, lon: 72.8311 },
    { name: 'Lalbaug', lat: 18.9896, lon: 72.8313 },
    { name: 'Parel', lat: 19.0074, lon: 72.8337 },
    { name: 'Dadar', lat: 19.0183, lon: 72.8420 },
    { name: 'Sion', lat: 19.0434, lon: 72.8606 },
    { name: 'Kurla', lat: 19.0728, lon: 72.8826 },
    { name: 'Ghatkopar', lat: 19.0952, lon: 72.9081 },
    { name: 'Vikhroli', lat: 19.1055, lon: 72.9264 },
    { name: 'Thane', lat: 19.1972, lon: 72.9722 },
    { name: 'Powai', lat: 19.1197, lon: 72.9106 },
    { name: 'Vashi', lat: 19.0771, lon: 73.0134 }
];

let isMonitoringActive = false;
let weatherData = {};
let alertHistory = [];

// Generate sample weather data
function generateSampleWeatherData() {
    const data = {};
    MUMBAI_ZONES.forEach((zone, index) => {
        const rainfall = Math.random() * 12; // 0-12mm
        data[zone.name] = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: rainfall >= 7 ? 'Heavy' : rainfall >= 3 ? 'Medium' : 'Light',
            temperature: Math.round(26 + Math.random() * 8),
            humidity: Math.round(70 + Math.random() * 25),
            description: rainfall > 5 ? 'Heavy rain' : rainfall > 1 ? 'Light rain' : 'Partly cloudy',
            timestamp: new Date().toISOString()
        };
    });
    return data;
}

// Initialize sample data
weatherData = generateSampleWeatherData();
alertHistory = [
    {
        id: 1,
        timestamp: new Date().toISOString(),
        zone: 'Dadar',
        rainfall: 8.2,
        intensity: 'Heavy',
        message: '🌧️ Heavy rain detected in Dadar: 8.2mm/hr'
    },
    {
        id: 2,
        timestamp: new Date(Date.now() - 30*60*1000).toISOString(),
        zone: 'Colaba',
        rainfall: 2.5,
        intensity: 'Medium',
        message: '🌧️ Medium rain detected in Colaba: 2.5mm/hr'
    }
];

// Serve dashboard on root
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    console.log('🏠 Serving dashboard from:', indexPath);
    
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('❌ Error serving dashboard:', err.message);
            res.json({
                message: '🌧️ Mumbai Rain Monitor API',
                status: 'running',
                dashboard: 'Dashboard file not found',
                timestamp: new Date().toISOString(),
                api: 'Use /api/status for system status'
            });
        } else {
            console.log('✅ Dashboard served successfully');
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    console.log('💓 Health check requested');
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Status
app.get('/api/status', (req, res) => {
    console.log('📊 Status check requested');
    res.json({
        success: true,
        status: {
            monitoring: isMonitoringActive,
            season: true, // Always true for demo
            zonesCount: MUMBAI_ZONES.length,
            lastUpdate: new Date().toISOString(),
            alertCount: alertHistory.length,
            weatherDataAvailable: Object.keys(weatherData).length > 0
        },
        server: 'online',
        timestamp: new Date().toISOString()
    });
});

// Weather data
app.get('/api/weather', (req, res) => {
    console.log('🌧️ Weather data requested');
    
    // Refresh sample data
    weatherData = generateSampleWeatherData();
    
    res.json({
        success: true,
        data: weatherData,
        lastUpdate: new Date().toISOString(),
        zonesCount: Object.keys(weatherData).length
    });
});

// Alerts
app.get('/api/alerts', (req, res) => {
    console.log('🚨 Alerts requested');
    res.json({
        success: true,
        alerts: alertHistory,
        totalAlerts: alertHistory.length
    });
});

// Start monitoring
app.post('/api/start', (req, res) => {
    console.log('🚀 Start monitoring requested');
    isMonitoringActive = true;
    
    // Refresh weather data
    weatherData = generateSampleWeatherData();
    
    res.json({
        success: true,
        message: 'Weather monitoring started successfully',
        zones: MUMBAI_ZONES.length,
        timestamp: new Date().toISOString()
    });
});

// Stop monitoring
app.post('/api/stop', (req, res) => {
    console.log('⏹️ Stop monitoring requested');
    isMonitoringActive = false;
    
    res.json({
        success: true,
        message: 'Weather monitoring stopped',
        timestamp: new Date().toISOString()
    });
});

// System test
app.get('/api/test', (req, res) => {
    console.log('🧪 System test requested');
    res.json({
        success: true,
        tests: {
            server: true,
            openweather: !!process.env.OPENWEATHER_API_KEY,
            telegram: !!process.env.TELEGRAM_BOT_TOKEN,
            email: !!process.env.EMAIL_FROM
        },
        message: 'System test completed',
        timestamp: new Date().toISOString()
    });
});

// Debug endpoint - shows all available routes
app.get('/debug', (req, res) => {
    res.json({
        message: 'Mumbai Rain Monitor - Debug Info',
        availableRoutes: [
            'GET /',
            'GET /health',
            'GET /api/status',
            'GET /api/weather',
            'GET /api/alerts',
            'GET /api/test',
            'POST /api/start',
            'POST /api/stop',
            'GET /debug'
        ],
        staticFiles: 'public/',
        monitoring: isMonitoringActive,
        dataPoints: Object.keys(weatherData).length,
        alerts: alertHistory.length,
        timestamp: new Date().toISOString()
    });
});

// Catch all for missing API routes
app.use('/api/*', (req, res) => {
    console.log('❓ Unknown API route requested:', req.path);
    res.status(404).json({
        error: 'API endpoint not found',
        requestedPath: req.path,
        availableEndpoints: ['/api/status', '/api/weather', '/api/alerts', '/api/start', '/api/stop', '/api/test']
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err.message);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ SUCCESS: Mumbai Rain Monitor running on port', PORT);
    console.log('🌐 Dashboard: http://localhost:' + PORT);
    console.log('🔧 Debug info: http://localhost:' + PORT + '/debug');
    console.log('📊 API Status: http://localhost:' + PORT + '/api/status');
    console.log('🌧️ Weather data ready for', MUMBAI_ZONES.length, 'zones');
});

server.on('error', (err) => {
    console.error('❌ Server startup error:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📤 Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});