// Mumbai Rain Monitor Backend Server
// Deploy this to a cloud service like Heroku, Railway, or DigitalOcean

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files

// Mumbai zones with coordinates
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

// Configuration (use environment variables in production)
let config = {
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_TO: process.env.EMAIL_TO,
    EMAIL_PASS: process.env.EMAIL_PASS,
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: process.env.SMTP_PORT || 587
};

// In-memory storage for weather data and alerts
let weatherData = {};
let alertHistory = [];
let isMonitoringActive = false;

// Email transporter
let emailTransporter;

function initializeEmailTransporter() {
    if (config.EMAIL_FROM && config.EMAIL_PASS) {
        emailTransporter = nodemailer.createTransporter({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: false,
            auth: {
                user: config.EMAIL_FROM,
                pass: config.EMAIL_PASS
            }
        });
    }
}

// Utility functions
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

function getRainfallIntensity(mm) {
    if (mm < 2.5) return 'Light';
    if (mm < 7.5) return 'Medium';
    if (mm < 35) return 'Heavy';
    return 'Very Heavy';
}

function isMonitoringSeason() {
    const month = new Date().getMonth() + 1;
    return month >= 7 || month <= 1; // July to January
}

// Weather API functions
async function getWeatherForZone(zone) {
    try {
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;

        const [currentResponse, forecastResponse] = await Promise.all([
            axios.get(currentUrl),
            axios.get(forecastUrl)
        ]);

        const currentData = currentResponse.data;
        const forecastData = forecastResponse.data;

        const rainfall = currentData.rain ? (currentData.rain['1h'] || 0) : 0;
        const intensity = getRainfallIntensity(rainfall);

        return {
            zone: zone.name,
            rainfall,
            intensity,
            temperature: Math.round(currentData.main.temp),
            humidity: currentData.main.humidity,
            description: currentData.weather[0].description,
            forecast: forecastData,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        log(`Error getting weather for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// Notification functions
async function sendTelegramMessage(message) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        log('Telegram message sent successfully');
        return true;
    } catch (error) {
        log(`Telegram error: ${error.message}`, 'ERROR');
        return false;
    }
}

async function sendEmail(subject, message) {
    if (!emailTransporter || !config.EMAIL_TO) {
        return false;
    }

    try {
        await emailTransporter.sendMail({
            from: config.EMAIL_FROM,
            to: config.EMAIL_TO,
            subject: subject,
            html: message
        });
        log('Email sent successfully');
        return true;
    } catch (error) {
        log(`Email error: ${error.message}`, 'ERROR');
        return false;
    }
}

// Main monitoring function
async function checkAllZones() {
    if (!isMonitoringSeason()) {
        log('Outside monitoring season (July-January)');
        return;
    }

    log('Checking weather for all Mumbai zones...');
    
    for (const zone of MUMBAI_ZONES) {
        const data = await getWeatherForZone(zone);
        
        if (data) {
            weatherData[zone.name] = data;
            
            // Check for rain alert (>= 1mm)
            if (data.rainfall >= 1) {
                const alertMessage = `🌧️ RAIN ALERT - ${data.zone}: ${data.rainfall.toFixed(1)}mm/hr (${data.intensity})
Temperature: ${data.temperature}°C
Condition: ${data.description}
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

                // Add to alert history
                alertHistory.unshift({
                    timestamp: new Date(),
                    zone: data.zone,
                    rainfall: data.rainfall,
                    intensity: data.intensity,
                    message: alertMessage
                });

                // Keep only last 50 alerts
                alertHistory = alertHistory.slice(0, 50);

                // Send notifications
                await sendTelegramMessage(alertMessage);
                await sendEmail(
                    `🌧️ Mumbai Rain Alert - ${data.zone}`,
                    `<h2>Rain Alert for ${data.zone}</h2>
                     <p><strong>Rainfall:</strong> ${data.rainfall.toFixed(1)}mm/hr</p>
                     <p><strong>Intensity:</strong> ${data.intensity}</p>
                     <p><strong>Temperature:</strong> ${data.temperature}°C</p>
                     <p><strong>Condition:</strong> ${data.description}</p>
                     <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>`
                );

                log(`ALERT: ${alertMessage}`);
            }
        }

        // Small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

// API Routes
app.get('/', (req, res) => {
    res.send(`
        <h1>🌧️ Mumbai Rain Monitor API</h1>
        <p>Backend server is running!</p>
        <h3>Available Endpoints:</h3>
        <ul>
            <li>GET /api/weather - Get current weather data</li>
            <li>GET /api/alerts - Get alert history</li>
            <li>POST /api/config - Update configuration</li>
            <li>POST /api/start - Start monitoring</li>
            <li>POST /api/stop - Stop monitoring</li>
            <li>GET /api/status - Get system status</li>
        </ul>
    `);
});

app.get('/api/weather', (req, res) => {
    res.json({
        success: true,
        data: weatherData,
        lastUpdate: new Date().toISOString()
    });
});

app.get('/api/alerts', (req, res) => {
    res.json({
        success: true,
        alerts: alertHistory
    });
});

app.post('/api/config', (req, res) => {
    const newConfig = req.body;
    config = { ...config, ...newConfig };
    initializeEmailTransporter();
    
    log('Configuration updated');
    res.json({ success: true, message: 'Configuration updated' });
});

app.post('/api/start', (req, res) => {
    isMonitoringActive = true;
    log('Monitoring started');
    res.json({ success: true, message: 'Monitoring started' });
});

app.post('/api/stop', (req, res) => {
    isMonitoringActive = false;
    log('Monitoring stopped');
    res.json({ success: true, message: 'Monitoring stopped' });
});

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: {
            monitoring: isMonitoringActive,
            season: isMonitoringSeason(),
            zonesCount: MUMBAI_ZONES.length,
            lastUpdate: Object.keys(weatherData).length > 0 ? 
                Math.max(...Object.values(weatherData).map(d => new Date(d.timestamp))) : null,
            alertCount: alertHistory.length
        }
    });
});

// Test endpoint
app.get('/api/test', async (req, res) => {
    const testResults = {
        openweather: false,
        telegram: false,
        email: false
    };

    // Test OpenWeatherMap
    try {
        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=Mumbai&appid=${config.OPENWEATHER_API_KEY}`);
        testResults.openweather = response.status === 200;
    } catch (error) {
        log(`OpenWeather test failed: ${error.message}`, 'ERROR');
    }

    // Test Telegram
    testResults.telegram = await sendTelegramMessage('🧪 Test from Mumbai Rain Monitor API');

    // Test Email
    testResults.email = await sendEmail('Test Email', 'This is a test email from Mumbai Rain Monitor');

    res.json({
        success: true,
        tests: testResults
    });
});

// Scheduled monitoring (every 30 minutes)
cron.schedule('*/30 * * * *', () => {
    if (isMonitoringActive) {
        checkAllZones();
    }
});

// Immediate check for sudden changes (every 5 minutes during active rain)
cron.schedule('*/5 * * * *', () => {
    if (isMonitoringActive && Object.values(weatherData).some(data => data.rainfall >= 1)) {
        log('Performing immediate check due to active rainfall');
        checkAllZones();
    }
});

// Regular status update (every 30 minutes)
cron.schedule('*/30 * * * *', async () => {
    if (isMonitoringActive && isMonitoringSeason()) {
        const activeRainZones = Object.values(weatherData).filter(data => data.rainfall >= 1);
        
        if (activeRainZones.length === 0) {
            const statusMessage = `☁️ Mumbai Weather Update
No significant rainfall detected across monitored zones.
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
Status: All Clear ✅`;

            await sendTelegramMessage(statusMessage);
        }
    }
});

// Initialize
initializeEmailTransporter();

// Start server
app.listen(PORT, () => {
    log(`Mumbai Rain Monitor API running on port ${PORT}`);
    log('Scheduled monitoring configured for every 30 minutes');
    log(`Monitoring ${MUMBAI_ZONES.length} zones in Mumbai`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('Received SIGINT, shutting down gracefully');
    process.exit(0);
});