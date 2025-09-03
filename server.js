const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Mumbai Rain Monitor with Fixed Notifications...');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuration with detailed logging
const config = {
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    EMAIL_FROM: process.env.EMAIL_FROM || '',
    EMAIL_TO: process.env.EMAIL_TO || '',
    EMAIL_PASS: process.env.EMAIL_PASS || ''
};

// Log configuration with validation
console.log('🔧 Configuration Status:');
console.log('- OpenWeather API:', config.OPENWEATHER_API_KEY ? `✅ ${config.OPENWEATHER_API_KEY.substring(0, 8)}...` : '❌ Missing');
console.log('- Telegram Bot Token:', config.TELEGRAM_BOT_TOKEN ? `✅ ${config.TELEGRAM_BOT_TOKEN.substring(0, 10)}...` : '❌ Missing');
console.log('- Telegram Chat ID:', config.TELEGRAM_CHAT_ID ? `✅ ${config.TELEGRAM_CHAT_ID}` : '❌ Missing');
console.log('- Email From:', config.EMAIL_FROM ? `✅ ${config.EMAIL_FROM}` : '❌ Missing');
console.log('- Email To:', config.EMAIL_TO ? `✅ ${config.EMAIL_TO}` : '❌ Missing');
console.log('- Email Pass:', config.EMAIL_PASS ? `✅ Configured (${config.EMAIL_PASS.length} chars)` : '❌ Missing');

// Mumbai zones
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

// Global state
let weatherData = {};
let alertHistory = [];
let isMonitoringActive = false;
let lastRealDataUpdate = null;

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
    return month >= 7 || month <= 1;
}

function generateSampleWeatherData() {
    const data = {};
    MUMBAI_ZONES.forEach((zone) => {
        const rainfall = Math.random() * 8;
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

// FIXED TELEGRAM FUNCTION
async function sendTelegramMessage(message) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        log('Telegram not configured', 'WARNING');
        return { success: false, error: 'Missing bot token or chat ID' };
    }

    try {
        // Import axios dynamically
        const axios = require('axios');
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        log(`Sending Telegram message to chat ID: ${config.TELEGRAM_CHAT_ID}`);
        log(`Using bot token: ${config.TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
        
        const response = await axios.post(url, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        log('📱 Telegram message sent successfully');
        return { success: true, response: response.data };
    } catch (error) {
        log(`📱 Telegram error: ${error.message}`, 'ERROR');
        
        if (error.response) {
            log(`Telegram API response: ${JSON.stringify(error.response.data)}`, 'ERROR');
            return { 
                success: false, 
                error: error.response.data.description || error.message,
                errorCode: error.response.data.error_code
            };
        }
        
        return { success: false, error: error.message };
    }
}

// FIXED EMAIL FUNCTION
async function sendEmailAlert(subject, htmlContent) {
    if (!config.EMAIL_FROM || !config.EMAIL_TO || !config.EMAIL_PASS) {
        log('Email not fully configured', 'WARNING');
        return { success: false, error: 'Missing email configuration' };
    }

    try {
        // Import nodemailer dynamically
        const nodemailer = require('nodemailer');
        
        log(`Creating email transporter for: ${config.EMAIL_FROM}`);
        
        const transporter = nodemailer.createTransporter({
            service: 'gmail',
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: config.EMAIL_FROM,
                pass: config.EMAIL_PASS
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // Verify transporter
        await transporter.verify();
        log('📧 Email transporter verified successfully');

        const mailOptions = {
            from: config.EMAIL_FROM,
            to: config.EMAIL_TO,
            subject: subject,
            html: htmlContent
        };

        const result = await transporter.sendMail(mailOptions);
        log('📧 Email sent successfully');
        return { success: true, messageId: result.messageId };
        
    } catch (error) {
        log(`📧 Email error: ${error.message}`, 'ERROR');
        return { 
            success: false, 
            error: error.message,
            details: error.code || 'Unknown error'
        };
    }
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
        
        alertHistory = alertHistory.slice(0, 100);
        await sendRainNotifications(rainyZones);
    }
}

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

    // Send notifications
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
        await sendTelegramMessage(detailedMessage);
    }
    
    if (config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS) {
        const htmlContent = generateHTMLReport(rainyZones, timestamp);
        await sendEmailAlert(`🌧️ Mumbai Rain Alert - ${rainyZones.length} Zones Active`, htmlContent);
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

function generateHTMLReport(rainyZones, timestamp) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
            .alert-zone { background: #fff3cd; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 5px solid #ffc107; }
            .danger-zone { background: #f8d7da; border-left-color: #dc3545; }
            .chart-container { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .zone-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 15px 0; }
            .zone-card { background: #e9ecef; padding: 15px; border-radius: 8px; text-align: center; font-weight: bold; }
            .risk-box { background: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 5px solid #bee5eb; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px; color: #6c757d; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🌧️ Mumbai Rain Alert Report</h1>
                <p style="margin: 0; font-size: 1.2em;">Generated: ${timestamp}</p>
            </div>
            
            <h2 style="color: #dc3545;">🚨 Active Rain Alerts (${rainyZones.length} zones)</h2>
            ${rainyZones.map(zone => `
                <div class="alert-zone ${zone.rainfall >= 7 ? 'danger-zone' : ''}">
                    <h3 style="margin-top: 0; color: #721c24;">📍 ${zone.zone}</h3>
                    <p><strong>Rainfall:</strong> ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})</p>
                    <p><strong>Temperature:</strong> ${zone.temperature}°C | <strong>Humidity:</strong> ${zone.humidity}%</p>
                    <p><strong>Condition:</strong> ${zone.description}</p>
                </div>
            `).join('')}
            
            <div class="chart-container">
                <h2 style="margin-top: 0; color: #495057;">📊 All Mumbai Zones Status</h2>
                <div class="zone-grid">
                    ${MUMBAI_ZONES.map(zoneName => {
                        const data = weatherData[zoneName.name] || {};
                        const color = data.rainfall >= 7 ? '#dc3545' : data.rainfall >= 1 ? '#ffc107' : '#28a745';
                        const bgColor = data.rainfall >= 7 ? '#f8d7da' : data.rainfall >= 1 ? '#fff3cd' : '#d4edda';
                        return `
                            <div class="zone-card" style="background: ${bgColor}; border-left: 5px solid ${color};">
                                <div style="color: #212529;">${zoneName.name}</div>
                                <div style="font-size: 1.2em; color: ${color};">${data.rainfall ? data.rainfall.toFixed(1) : '0.0'}mm/hr</div>
                                <div style="font-size: 0.9em; color: #6c757d;">${data.intensity || 'No Rain'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            
            <div class="risk-box">
                <h2 style="margin-top: 0; color: #0c5460;">⚠️ Flood Risk Assessment</h2>
                <p style="font-size: 1.1em; margin: 0;"><strong>${assessFloodRisk(rainyZones)}</strong></p>
            </div>
            
            <div class="footer">
                <p><strong>Mumbai Rain Monitor</strong> | Automated Weather Alert System</p>
                <p>Dashboard: <a href="https://rain-weather-updates-production.up.railway.app">https://rain-weather-updates-production.up.railway.app</a></p>
            </div>
        </div>
    </body>
    </html>`;
}

// TEST ENDPOINTS WITH BETTER ERROR HANDLING

app.get('/test-telegram', async (req, res) => {
    try {
        const testMessage = `🧪 TEST ALERT - Mumbai Rain Monitor
📅 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

🌧️ This is a test notification with sample rain data:

📍 Test Zone: 5.2mm/hr (Medium Rain)
🌡️ Temperature: 28°C
💧 Humidity: 82%
☁️ Condition: Light Rain

📊 ZONE STATUS CHART:
🟢 Colaba: 0.8mm/hr
🟡 Dadar: 2.1mm/hr
🔴 Bandra: 7.5mm/hr

⚠️ FLOOD RISK: 🟡 MEDIUM RISK

✅ This confirms your Telegram notifications are working perfectly!`;

        log('🧪 Testing Telegram notification...');
        const result = await sendTelegramMessage(testMessage);
        
        res.json({ 
            success: result.success, 
            message: result.success ? 'Test Telegram notification sent successfully!' : 'Failed to send Telegram notification',
            error: result.error || null,
            errorCode: result.errorCode || null,
            config: {
                botToken: config.TELEGRAM_BOT_TOKEN ? `${config.TELEGRAM_BOT_TOKEN.substring(0, 10)}...` : 'Missing',
                chatId: config.TELEGRAM_CHAT_ID || 'Missing'
            }
        });
    } catch (error) {
        log(`🧪 Test Telegram error: ${error.message}`, 'ERROR');
        res.json({ 
            success: false, 
            error: error.message,
            message: 'Test failed with exception'
        });
    }
});

app.get('/test-email', async (req, res) => {
    try {
        log('🧪 Testing email notification...');
        
        const testHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
                .test-content { background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 5px solid #ffc107; margin: 20px 0; }
                .chart-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0; }
                .footer { text-align: center; margin-top: 20px; padding: 15px; background: #e9ecef; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🧪 TEST EMAIL - Mumbai Rain Monitor</h1>
                    <p>Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                </div>
                
                <div class="test-content">
                    <h3>📍 Test Rain Alert</h3>
                    <p><strong>Rainfall:</strong> 5.2mm/hr (Medium Intensity)</p>
                    <p><strong>Temperature:</strong> 28°C | <strong>Humidity:</strong> 82%</p>
                    <p><strong>Condition:</strong> Light Rain</p>
                </div>
                
                <div class="chart-box">
                    <h3>📊 Sample Zone Status Chart</h3>
                    <p>🟢 <strong>Colaba:</strong> 0.8mm/hr (No Rain)</p>
                    <p>🟡 <strong>Dadar:</strong> 2.1mm/hr (Light Rain)</p>
                    <p>🔴 <strong>Bandra:</strong> 7.5mm/hr (Heavy Rain)</p>
                </div>
                
                <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 5px solid #bee5eb;">
                    <h3 style="margin-top: 0;">⚠️ Flood Risk Assessment</h3>
                    <p><strong>🟡 MEDIUM RISK - Test scenario</strong></p>
                </div>
                
                <div class="footer">
                    <h3 style="color: #28a745;">✅ Email Notifications Working!</h3>
                    <p>This confirms your email alert system is properly configured.</p>
                    <p><small>Mumbai Rain Monitor | Test Email System</small></p>
                </div>
            </div>
        </body>
        </html>`;

        const result = await sendEmailAlert('🧪 TEST - Mumbai Rain Monitor Email System', testHtml);
        
        res.json({ 
            success: result.success, 
            message: result.success ? 'Test email sent successfully!' : 'Failed to send test email',
            error: result.error || null,
            details: result.details || null,
            config: {
                emailFrom: config.EMAIL_FROM || 'Missing',
                emailTo: config.EMAIL_TO || 'Missing',
                emailPass: config.EMAIL_PASS ? `Configured (${config.EMAIL_PASS.length} chars)` : 'Missing'
            }
        });
    } catch (error) {
        log(`🧪 Test email error: ${error.message}`, 'ERROR');
        res.json({ 
            success: false, 
            error: error.message,
            message: 'Test failed with exception'
        });
    }
});

app.get('/force-alert', async (req, res) => {
    try {
        log('🧪 Forcing rain alert for testing...');
        
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
        
        // Update weather data
        Object.assign(weatherData, simulatedRainData);
        
        // Process alerts
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

// Standard API routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.json({
                message: '🌧️ Mumbai Rain Monitor API',
                status: 'running',
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
        }
    });
});

app.get('/api/weather', (req, res) => {
    res.json({
        success: true,
        data: weatherData,
        lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null,
        zonesCount: Object.keys(weatherData).length
    });
});

app.get('/api/alerts', (req, res) => {
    res.json({
        success: true,
        alerts: alertHistory.slice(0, 50),
        totalAlerts: alertHistory.length
    });
});

app.post('/api/start', (req, res) => {
    isMonitoringActive = true;
    res.json({
        success: true,
        message: 'Weather monitoring started'
    });
});

app.post('/api/stop', (req, res) => {
    isMonitoringActive = false;
    res.json({
        success: true,
        message: 'Weather monitoring stopped'
    });
});

app.get('/api/test', async (req, res) => {
    const testResults = {
        server: true,
        openweather: !!config.OPENWEATHER_API_KEY,
        telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
        email: !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS)
    };
    
    res.json({
        success: true,
        tests: testResults,
        instructions: {
            testTelegram: 'Visit /test-telegram to test Telegram notifications',
            testEmail: 'Visit /test-email to test email notifications', 
            forceAlert: 'Visit /force-alert to simulate rain alerts'
        }
    });
});

// Initialize sample data
weatherData = generateSampleWeatherData();

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Mumbai Rain Monitor with FIXED notifications running on port', PORT);
    console.log('🧪 Test Telegram: /test-telegram');
    console.log('📧 Test Email: /test-email');
    console.log('🌧️ Force Alert: /force-alert');
    log('Server started with fixed notification system');
});

server.on('error', (err) => {
    console.error('❌ Server error:', err.message);
});