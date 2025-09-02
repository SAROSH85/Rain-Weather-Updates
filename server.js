const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Mumbai Rain Monitor with Notification Testing...');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// Configuration
const config = {
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    EMAIL_FROM: process.env.EMAIL_FROM || '',
    EMAIL_TO: process.env.EMAIL_TO || '',
    EMAIL_PASS: process.env.EMAIL_PASS || ''
};

// Global state
let weatherData = {};
let alertHistory = [];
let isMonitoringActive = false;
let lastRealDataUpdate = null;

// Log configuration status (without exposing secrets)
console.log('🔧 Configuration Status:');
console.log('- OpenWeather API:', config.OPENWEATHER_API_KEY ? '✅ Configured' : '❌ Missing');
console.log('- Telegram Bot:', config.TELEGRAM_BOT_TOKEN ? '✅ Configured' : '❌ Missing');
console.log('- Telegram Chat ID:', config.TELEGRAM_CHAT_ID ? '✅ Configured' : '❌ Missing');
console.log('- Email From:', config.EMAIL_FROM ? '✅ Configured' : '❌ Missing');
console.log('- Email To:', config.EMAIL_TO ? '✅ Configured' : '❌ Missing');
console.log('- Email Password:', config.EMAIL_PASS ? '✅ Configured' : '❌ Missing');

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

// Generate sample weather data for testing
function generateSampleWeatherData() {
    const data = {};
    MUMBAI_ZONES.forEach((zone, index) => {
        const rainfall = Math.random() * 8; // 0-8mm for demo
        data[zone.name] = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(26 + Math.random() * 8),
            humidity: Math.round(70 + Math.random() * 25),
            description: rainfall > 3 ? 'light rain' : rainfall > 1 ? 'drizzle' : 'partly cloudy',
            timestamp: new Date().toISOString(),
            realData: false
        };
    });
    return data;
}

// Real weather data fetching (improved)
async function fetchRealWeatherData(zone) {
    if (!config.OPENWEATHER_API_KEY) {
        return null;
    }

    try {
        const axios = require('axios');
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;
        
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;
        
        const rainfall = data.rain ? (data.rain['1h'] || 0) : 0;
        
        return {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(data.main.temp),
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            description: data.weather[0].description,
            timestamp: new Date().toISOString(),
            realData: true
        };
    } catch (error) {
        log(`Weather API error for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// Update weather data for all zones
async function updateAllZonesWeather() {
    log('🔄 Updating weather data for all zones...');
    
    const newWeatherData = {};
    let successCount = 0;
    
    for (const zone of MUMBAI_ZONES) {
        const realData = await fetchRealWeatherData(zone);
        
        if (realData) {
            newWeatherData[zone.name] = realData;
            successCount++;
        } else {
            // Use sample data as fallback
            const sampleData = generateSampleWeatherData();
            newWeatherData[zone.name] = sampleData[zone.name];
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    weatherData = newWeatherData;
    lastRealDataUpdate = new Date();
    
    log(`📊 Weather update complete: ${successCount}/${MUMBAI_ZONES.length} zones with real data`);
    
    // Check for rain alerts
    await processRainAlerts();
    
    return weatherData;
}

// Process rain alerts
async function processRainAlerts() {
    const rainyZones = Object.values(weatherData).filter(zone => zone.rainfall >= 1);
    
    if (rainyZones.length > 0) {
        log(`🌧️ Rain detected in ${rainyZones.length} zones`);
        
        for (const zone of rainyZones) {
            const alert = {
                id: Date.now() + Math.random(),
                timestamp: new Date().toISOString(),
                zone: zone.zone,
                rainfall: zone.rainfall,
                intensity: zone.intensity,
                message: `🌧️ RAIN ALERT - ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})`
            };
            
            alertHistory.unshift(alert);
            log(`🚨 ALERT: ${alert.message}`);
        }
        
        // Keep only last 100 alerts
        alertHistory = alertHistory.slice(0, 100);
        
        // Send notifications
        await sendRainNotifications(rainyZones);
    } else {
        log('☀️ No significant rainfall detected');
    }
}

// Enhanced notification system
async function sendRainNotifications(rainyZones) {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    const detailedMessage = `🌧️ MUMBAI RAIN ALERT
📅 ${timestamp}

🚨 ACTIVE RAINFALL:
${rainyZones.map(zone => 
    `📍 ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})
   🌡️ ${zone.temperature}°C | 💧 ${zone.humidity}% | ${zone.description}`
).join('\n\n')}

📊 RAINFALL CHART:
${Object.values(weatherData).map(zone => {
    const icon = zone.rainfall >= 7 ? '🔴' : zone.rainfall >= 1 ? '🟡' : '🟢';
    return `${icon} ${zone.zone}: ${zone.rainfall.toFixed(1)}mm`;
}).join('\n')}

⚠️ FLOOD RISK: ${assessFloodRisk(rainyZones)}

🔗 Dashboard: https://rain-weather-updates-production.up.railway.app`;

    // Send Telegram notification
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
        await sendTelegramMessage(detailedMessage);
    }
    
    // Send email notification
    if (config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS) {
        await sendEmailAlert(rainyZones, timestamp);
    }
}

function assessFloodRisk(rainyZones) {
    const heavyRainZones = rainyZones.filter(zone => zone.rainfall >= 7);
    const totalRainfall = rainyZones.reduce((sum, zone) => sum + zone.rainfall, 0);
    
    if (heavyRainZones.length >= 3) {
        return '🔴 HIGH RISK - Multiple zones with heavy rainfall';
    } else if (totalRainfall > 20) {
        return '🟡 MEDIUM RISK - Significant rainfall across areas';
    } else if (rainyZones.length >= 5) {
        return '🟡 MEDIUM RISK - Widespread light rainfall';
    } else {
        return '🟢 LOW RISK - Localized rainfall only';
    }
}

async function sendTelegramMessage(message) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        log('Telegram not configured', 'WARNING');
        return false;
    }

    try {
        const axios = require('axios');
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        await axios.post(url, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message
        });
        
        log('📱 Telegram notification sent successfully');
        return true;
    } catch (error) {
        log(`📱 Telegram error: ${error.message}`, 'ERROR');
        return false;
    }
}

async function sendEmailAlert(rainyZones, timestamp) {
    try {
        const nodemailer = require('nodemailer');
        
        const transporter = nodemailer.createTransporter({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: config.EMAIL_FROM,
                pass: config.EMAIL_PASS
            }
        });

        const htmlContent = generateHTMLReport(rainyZones, timestamp);
        
        await transporter.sendMail({
            from: config.EMAIL_FROM,
            to: config.EMAIL_TO,
            subject: `🌧️ Mumbai Rain Alert - ${rainyZones.length} Zones Active - ${timestamp}`,
            html: htmlContent
        });
        
        log('📧 Email alert sent successfully');
        return true;
    } catch (error) {
        log(`📧 Email error: ${error.message}`, 'ERROR');
        return false;
    }
}

function generateHTMLReport(rainyZones, timestamp) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { background: #667eea; color: white; padding: 20px; border-radius: 8px; text-align: center; }
            .alert-zone { background: #fff3cd; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
            .danger-zone { background: #f8d7da; border-left-color: #dc3545; }
            .chart-container { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .zone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
            .zone-card { background: #e9ecef; padding: 10px; border-radius: 5px; text-align: center; }
            .risk-assessment { background: #d1ecf1; padding: 15px; border-radius: 5px; border-left: 4px solid #bee5eb; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🌧️ Mumbai Rain Alert Report</h1>
            <p>Generated: ${timestamp}</p>
        </div>
        
        <h2>🚨 Active Rain Alerts (${rainyZones.length} zones)</h2>
        ${rainyZones.map(zone => `
            <div class="alert-zone ${zone.rainfall >= 7 ? 'danger-zone' : ''}">
                <h3>📍 ${zone.zone}</h3>
                <p><strong>Rainfall:</strong> ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})</p>
                <p><strong>Temperature:</strong> ${zone.temperature}°C | <strong>Humidity:</strong> ${zone.humidity}%</p>
                <p><strong>Condition:</strong> ${zone.description}</p>
            </div>
        `).join('')}
        
        <div class="chart-container">
            <h2>📊 All Zones Rainfall Chart</h2>
            <div class="zone-grid">
                ${MUMBAI_ZONES.map(zoneName => {
                    const data = weatherData[zoneName.name] || {};
                    const color = data.rainfall >= 7 ? '#dc3545' : data.rainfall >= 1 ? '#ffc107' : '#28a745';
                    return `
                        <div class="zone-card" style="border-left: 4px solid ${color}">
                            <strong>${zoneName.name}</strong><br>
                            ${data.rainfall ? data.rainfall.toFixed(1) : '0.0'}mm/hr<br>
                            <small style="color: ${color}">${data.intensity || 'Light'}</small>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        
        <div class="risk-assessment">
            <h2>⚠️ Flood Risk Assessment</h2>
            <p><strong>${assessFloodRisk(rainyZones)}</strong></p>
        </div>
        
        <hr>
        <p><small>Mumbai Rain Monitor | Automated Weather Alert System</small></p>
    </body>
    </html>`;
}

// TEST ENDPOINTS FOR NOTIFICATIONS

// Test Telegram notification
app.get('/test-telegram', async (req, res) => {
    try {
        const testMessage = `🧪 TEST ALERT - Mumbai Rain Monitor
📅 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

🌧️ This is a test notification with sample data:

📍 Test Zone: 5.2mm/hr (Medium Rain)
🌡️ Temperature: 28°C
💧 Humidity: 82%
☁️ Condition: Light Rain

📊 ZONE STATUS CHART:
🟢 Colaba: 0.8mm
🟡 Dadar: 2.1mm  
🔴 Bandra: 7.5mm

⚠️ FLOOD RISK: 🟡 MEDIUM RISK

✅ This confirms your Telegram notifications are working!`;

        const success = await sendTelegramMessage(testMessage);
        
        res.json({ 
            success: success, 
            message: success ? 'Test Telegram notification sent!' : 'Failed to send Telegram notification',
            config: {
                botToken: config.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Missing',
                chatId: config.TELEGRAM_CHAT_ID ? 'Configured' : 'Missing'
            }
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Test email notification
app.get('/test-email', async (req, res) => {
    try {
        const nodemailer = require('nodemailer');
        
        const transporter = nodemailer.createTransporter({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: config.EMAIL_FROM,
                pass: config.EMAIL_PASS
            }
        });

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { background: #667eea; color: white; padding: 20px; border-radius: 8px; text-align: center; }
                .alert-zone { background: #fff3cd; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
                .chart { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🧪 TEST - Mumbai Rain Alert</h1>
                <p>Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
            </div>
            
            <div class="alert-zone">
                <h3>📍 Test Zone Alert</h3>
                <p><strong>Rainfall:</strong> 5.2mm/hr (Medium)</p>
                <p><strong>Temperature:</strong> 28°C | <strong>Humidity:</strong> 82%</p>
                <p><strong>Condition:</strong> Light Rain</p>
            </div>
            
            <div class="chart">
                <h3>📊 Zone Status Chart</h3>
                <p>🟢 Colaba: 0.8mm/hr (Light)</p>
                <p>🟡 Dadar: 2.1mm/hr (Light)</p>  
                <p>🔴 Bandra: 7.5mm/hr (Heavy)</p>
            </div>
            
            <p><strong>⚠️ Flood Risk:</strong> 🟡 MEDIUM RISK</p>
            <hr>
            <p><small>✅ This confirms your email notifications are working!</small></p>
        </body>
        </html>`;

        await transporter.sendMail({
            from: config.EMAIL_FROM,
            to: config.EMAIL_TO,
            subject: '🧪 TEST - Mumbai Rain Monitor Alert',
            html: htmlContent
        });
        
        res.json({ 
            success: true, 
            message: 'Test email sent successfully!',
            config: {
                emailFrom: config.EMAIL_FROM ? 'Configured' : 'Missing',
                emailTo: config.EMAIL_TO ? 'Configured' : 'Missing',
                emailPass: config.EMAIL_PASS ? 'Configured' : 'Missing'
            }
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message,
            details: 'Check Gmail app password and 2FA settings'
        });
    }
});

// Force rain alert for testing
app.get('/force-alert', async (req, res) => {
    try {
        log('🧪 Forcing rain alert for testing...');
        
        // Simulate heavy rain in multiple zones
        const simulatedRainData = {
            'Dadar': { 
                zone: 'Dadar', 
                rainfall: 8.5, 
                intensity: 'Heavy', 
                temperature: 27, 
                humidity: 88, 
                description: 'heavy rain',
                timestamp: new Date().toISOString()
            },
            'Bandra': { 
                zone: 'Bandra', 
                rainfall: 6.2, 
                intensity: 'Medium', 
                temperature: 28, 
                humidity: 85, 
                description: 'moderate rain',
                timestamp: new Date().toISOString()
            },
            'Colaba': { 
                zone: 'Colaba', 
                rainfall: 12.1, 
                intensity: 'Very Heavy', 
                temperature: 26, 
                humidity: 92, 
                description: 'very heavy rain',
                timestamp: new Date().toISOString()
            }
        };
        
        // Update weather data with simulated rain
        Object.assign(weatherData, simulatedRainData);
        
        // Trigger rain alert processing
        await processRainAlerts();
        
        res.json({ 
            success: true, 
            message: 'Simulated rain alert triggered! Check your Telegram and email.',
            simulatedData: simulatedRainData,
            alertsSent: {
                telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
                email: !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS)
            }
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// STANDARD API ROUTES

// Serve dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.json({
                message: '🌧️ Mumbai Rain Monitor API',
                status: 'running',
                dashboard: '/index.html not found',
                testEndpoints: {
                    testTelegram: '/test-telegram',
                    testEmail: '/test-email', 
                    forceAlert: '/force-alert'
                }
            });
        }
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: {
            monitoring: isMonitoringActive,
            season: isMonitoringSeason(),
            zonesCount: MUMBAI_ZONES.length,
            lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null,
            alertCount: alertHistory.length,
            weatherDataAvailable: Object.keys(weatherData).length > 0,
            configStatus: {
                openweather: !!config.OPENWEATHER_API_KEY,
                telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
                email: !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS)
            }
        },
        testEndpoints: {
            testTelegram: '/test-telegram',
            testEmail: '/test-email',
            forceAlert: '/force-alert'
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/weather', (req, res) => {
    res.json({
        success: true,
        data: weatherData,
        lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null,
        zonesCount: Object.keys(weatherData).length,
        realData: !!config.OPENWEATHER_API_KEY
    });
});

app.get('/api/alerts', (req, res) => {
    res.json({
        success: true,
        alerts: alertHistory.slice(0, 50),
        totalAlerts: alertHistory.length
    });
});

app.post('/api/start', async (req, res) => {
    if (!isMonitoringSeason()) {
        return res.json({
            success: false,
            message: 'Outside monitoring season (July-January)',
            currentMonth: new Date().getMonth() + 1
        });
    }
    
    isMonitoringActive = true;
    log('🚀 Weather monitoring started');
    
    try {
        await updateAllZonesWeather();
        res.json({
            success: true,
            message: 'Real-time monitoring started successfully',
            zones: MUMBAI_ZONES.length,
            realData: !!config.OPENWEATHER_API_KEY,
            lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null
        });
    } catch (error) {
        log(`Error during monitoring start: ${error.message}`, 'ERROR');
        res.json({
            success: true,
            message: 'Monitoring started (using sample data)',
            error: error.message
        });
    }
});

app.post('/api/stop', (req, res) => {
    isMonitoringActive = false;
    log('⏹️ Weather monitoring stopped');
    
    res.json({
        success: true,
        message: 'Weather monitoring stopped'
    });
});

app.get('/api/test', async (req, res) => {
    log('🧪 Running comprehensive system tests...');
    
    const testResults = {
        server: true,
        openweather: false,
        telegram: false,
        email: false,
        timestamp: new Date().toISOString()
    };
    
    // Test OpenWeatherMap API
    if (config.OPENWEATHER_API_KEY) {
        try {
            const testZone = MUMBAI_ZONES[0];
            const weatherResult = await fetchRealWeatherData(testZone);
            testResults.openweather = !!weatherResult;
        } catch (error) {
            log(`OpenWeather test failed: ${error.message}`, 'ERROR');
        }
    }
    
    // Test Telegram
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
        testResults.telegram = await sendTelegramMessage('🧪 Test from Mumbai Rain Monitor - System online!');
    }
    
    // Test Email (just check configuration)
    testResults.email = !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS);
    
    log(`🧪 Tests complete: OpenWeather=${testResults.openweather}, Telegram=${testResults.telegram}, Email=${testResults.email}`);
    
    res.json({
        success: true,
        tests: testResults,
        message: 'System test completed',
        instructions: {
            testTelegram: 'Visit /test-telegram to test Telegram notifications',
            testEmail: 'Visit /test-email to test email notifications', 
            forceAlert: 'Visit /force-alert to simulate rain alerts'
        }
    });
});

// Initialize sample data
function initializeSampleData() {
    weatherData = generateSampleWeatherData();
    log('📊 Sample weather data initialized');
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Mumbai Rain Monitor with Testing running on port', PORT);
    console.log('🌐 Dashboard: Visit root URL');
    console.log('🧪 Test Telegram: /test-telegram');
    console.log('📧 Test Email: /test-email');
    console.log('🌧️ Force Alert: /force-alert');
    console.log(`🔑 Configuration: OpenWeather=${!!config.OPENWEATHER_API_KEY}, Telegram=${!!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID)}, Email=${!!(config.EMAIL_FROM && config.EMAIL_TO)}`);
    
    // Initialize with sample data
    initializeSampleData();
    log('Server started successfully with notification testing endpoints');
});

// Scheduled monitoring every 30 minutes
setInterval(async () => {
    if (isMonitoringActive && isMonitoringSeason()) {
        log('⏰ Performing scheduled weather check...');
        await updateAllZonesWeather();
    }
}, 30 * 60 * 1000);

server.on('error', (err) => {
    console.error('❌ Server error:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('📤 Shutting down gracefully...');
    server.close(() => {
        log('✅ Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (err) => {
    log(`Uncaught Exception: ${err.message}`, 'ERROR');
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`Unhandled Rejection: ${reason}`, 'ERROR');
});