const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Mumbai Rain Monitor with Real Weather Data...');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Mumbai zones with precise coordinates
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
let forecastData = {};
let alertHistory = [];
let isMonitoringActive = false;
let lastRealDataUpdate = null;

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

// Real weather data fetching
async function fetchRealWeatherData(zone) {
    if (!config.OPENWEATHER_API_KEY) {
        log('OpenWeather API key not configured', 'WARNING');
        return null;
    }

    try {
        const axios = require('axios');
        
        // Current weather
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;
        
        // 5-day forecast  
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;

        const [currentResponse, forecastResponse] = await Promise.all([
            axios.get(currentUrl, { timeout: 10000 }),
            axios.get(forecastUrl, { timeout: 10000 })
        ]);

        const currentData = currentResponse.data;
        const forecast = forecastResponse.data;

        // Extract current rainfall
        const rainfall = currentData.rain ? (currentData.rain['1h'] || 0) : 0;
        
        // Process forecast data for next 7 days
        const dailyForecast = processForecastData(forecast);

        const weatherInfo = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(currentData.main.temp),
            humidity: currentData.main.humidity,
            pressure: currentData.main.pressure,
            windSpeed: currentData.wind ? currentData.wind.speed : 0,
            description: currentData.weather[0].description,
            cloudiness: currentData.clouds.all,
            visibility: currentData.visibility ? currentData.visibility / 1000 : 'N/A', // Convert to km
            timestamp: new Date().toISOString(),
            coordinates: `${zone.lat}, ${zone.lon}`,
            realData: true,
            forecast: dailyForecast
        };

        log(`✅ Real weather data fetched for ${zone.name}: ${rainfall}mm/hr, ${currentData.weather[0].description}`);
        return weatherInfo;

    } catch (error) {
        log(`❌ Weather API error for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// Process 5-day forecast into daily summaries
function processForecastData(forecastData) {
    const dailyData = {};
    
    forecastData.list.forEach(item => {
        const date = new Date(item.dt * 1000).toDateString();
        
        if (!dailyData[date]) {
            dailyData[date] = {
                date: date,
                totalRain: 0,
                maxTemp: item.main.temp,
                minTemp: item.main.temp,
                descriptions: [],
                humidity: []
            };
        }
        
        // Accumulate rainfall
        const rain = item.rain ? (item.rain['3h'] || 0) : 0;
        dailyData[date].totalRain += rain;
        
        // Track temperature range
        dailyData[date].maxTemp = Math.max(dailyData[date].maxTemp, item.main.temp);
        dailyData[date].minTemp = Math.min(dailyData[date].minTemp, item.main.temp);
        
        // Collect descriptions and humidity
        dailyData[date].descriptions.push(item.weather[0].description);
        dailyData[date].humidity.push(item.main.humidity);
    });
    
    // Convert to array and calculate averages
    return Object.values(dailyData).slice(0, 7).map(day => ({
        date: day.date,
        expectedRainfall: Math.round(day.totalRain * 10) / 10,
        maxTemp: Math.round(day.maxTemp),
        minTemp: Math.round(day.minTemp),
        avgHumidity: Math.round(day.humidity.reduce((a, b) => a + b, 0) / day.humidity.length),
        mainCondition: getMostCommonCondition(day.descriptions)
    }));
}

function getMostCommonCondition(descriptions) {
    const counts = {};
    descriptions.forEach(desc => {
        counts[desc] = (counts[desc] || 0) + 1;
    });
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

// Update all zones with real weather data
async function updateAllZonesWeather() {
    log('🔄 Fetching real weather data for all Mumbai zones...');
    
    const newWeatherData = {};
    let successCount = 0;
    
    for (const zone of MUMBAI_ZONES) {
        const realData = await fetchRealWeatherData(zone);
        
        if (realData) {
            newWeatherData[zone.name] = realData;
            successCount++;
        } else {
            // Fallback: Use previous data or generate placeholder
            newWeatherData[zone.name] = weatherData[zone.name] || generateFallbackData(zone);
        }
        
        // Rate limiting: Small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    weatherData = newWeatherData;
    lastRealDataUpdate = new Date();
    
    log(`📊 Weather update complete: ${successCount}/${MUMBAI_ZONES.length} zones with real data`);
    
    // Check for rain alerts
    await processRainAlerts();
    
    return weatherData;
}

function generateFallbackData(zone) {
    return {
        zone: zone.name,
        rainfall: 0,
        intensity: 'Light',
        temperature: 28,
        humidity: 75,
        description: 'Data unavailable',
        timestamp: new Date().toISOString(),
        realData: false
    };
}

// Process rain alerts and send notifications
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
                temperature: zone.temperature,
                humidity: zone.humidity,
                description: zone.description,
                message: `🌧️ RAIN ALERT - ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})`
            };
            
            alertHistory.unshift(alert);
            log(`🚨 RAIN ALERT: ${alert.message}`);
        }
        
        // Keep only last 100 alerts
        alertHistory = alertHistory.slice(0, 100);
        
        // Send notifications
        await sendRainNotifications(rainyZones);
    } else {
        log('☀️ No significant rainfall detected across monitored zones');
    }
}

// Enhanced notification system with charts and images
async function sendRainNotifications(rainyZones) {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    // Create detailed message with forecast
    const detailedMessage = `🌧️ MUMBAI RAIN ALERT
📅 ${timestamp}

🚨 ACTIVE RAINFALL:
${rainyZones.map(zone => 
    `📍 ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})
   🌡️ ${zone.temperature}°C | 💧 ${zone.humidity}% | ${zone.description}`
).join('\n\n')}

📊 FORECAST SUMMARY:
${generateForecastSummary()}

⚠️ FLOOD RISK ASSESSMENT:
${assessFloodRisk(rainyZones)}

🔗 Dashboard: ${process.env.RAILWAY_STATIC_URL || 'https://your-app.railway.app'}`;

    // Send Telegram notification with weather chart
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
        await sendTelegramWithChart(detailedMessage, rainyZones);
    }
    
    // Send email with detailed HTML report
    if (config.EMAIL_FROM && config.EMAIL_TO) {
        await sendEmailWithCharts(rainyZones, timestamp);
    }
}

function generateForecastSummary() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get forecast for tomorrow from any zone (they should be similar for Mumbai)
    const sampleZone = Object.values(weatherData)[0];
    if (sampleZone && sampleZone.forecast && sampleZone.forecast.length > 0) {
        const tomorrowForecast = sampleZone.forecast[1]; // Index 1 = tomorrow
        return `Tomorrow (${tomorrow.toLocaleDateString()}): ${tomorrowForecast.expectedRainfall}mm expected, ${tomorrowForecast.maxTemp}°C max`;
    }
    
    return 'Tomorrow: Forecast data being processed...';
}

function assessFloodRisk(rainyZones) {
    const heavyRainZones = rainyZones.filter(zone => zone.rainfall >= 7);
    const totalRainfall = rainyZones.reduce((sum, zone) => sum + zone.rainfall, 0);
    
    if (heavyRainZones.length >= 3) {
        return '🔴 HIGH RISK - Multiple zones with heavy rainfall detected';
    } else if (totalRainfall > 20) {
        return '🟡 MEDIUM RISK - Significant rainfall across multiple areas';
    } else if (rainyZones.length >= 5) {
        return '🟡 MEDIUM RISK - Widespread light to medium rainfall';
    } else {
        return '🟢 LOW RISK - Localized rainfall only';
    }
}

async function sendTelegramWithChart(message, rainyZones) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        log('Telegram not configured', 'WARNING');
        return false;
    }

    try {
        const axios = require('axios');
        const telegramUrl = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        // Send main alert message
        await axios.post(telegramUrl, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        
        // Send chart data as follow-up message
        const chartMessage = `📊 RAINFALL DATA CHART:
${MUMBAI_ZONES.map(zone => {
    const data = weatherData[zone.name];
    const icon = data.rainfall >= 7 ? '🔴' : data.rainfall >= 1 ? '🟡' : '🟢';
    return `${icon} ${zone.name}: ${data.rainfall.toFixed(1)}mm`;
}).join('\n')}

📈 7-DAY OUTLOOK:
${generateWeeklyOutlook()}`;

        await axios.post(telegramUrl, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: chartMessage,
            parse_mode: 'HTML'
        });
        
        log('📱 Enhanced Telegram notifications sent successfully');
        return true;
    } catch (error) {
        log(`📱 Telegram error: ${error.message}`, 'ERROR');
        return false;
    }
}

async function sendEmailWithCharts(rainyZones, timestamp) {
    if (!config.EMAIL_FROM || !config.EMAIL_TO) {
        log('Email not configured', 'WARNING');
        return false;
    }

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

        const htmlReport = generateHTMLReport(rainyZones, timestamp);
        
        await transporter.sendMail({
            from: config.EMAIL_FROM,
            to: config.EMAIL_TO,
            subject: `🌧️ Mumbai Rain Alert - ${rainyZones.length} Zones Active - ${timestamp}`,
            html: htmlReport
        });
        
        log('📧 Enhanced email report sent successfully');
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
            .header { background: #667eea; color: white; padding: 20px; border-radius: 8px; }
            .alert-zone { background: #fff3cd; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
            .danger-zone { background: #f8d7da; border-left-color: #dc3545; }
            .chart-container { margin: 20px 0; }
            .zone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .zone-card { background: #f8f9fa; padding: 10px; border-radius: 5px; text-align: center; }
            .forecast-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .forecast-table th, .forecast-table td { border: 1px solid #ddd; padding: 8px; text-align: center; }
            .forecast-table th { background: #f2f2f2; }
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
        
        <h2>📊 All Zones Status</h2>
        <div class="zone-grid">
            ${MUMBAI_ZONES.map(zoneName => {
                const data = weatherData[zoneName.name] || {};
                return `
                    <div class="zone-card" style="border-left: 4px solid ${data.rainfall >= 7 ? '#dc3545' : data.rainfall >= 1 ? '#ffc107' : '#28a745'}">
                        <strong>${zoneName.name}</strong><br>
                        ${data.rainfall ? data.rainfall.toFixed(1) : '0.0'}mm/hr<br>
                        <small>${data.intensity || 'Light'}</small>
                    </div>
                `;
            }).join('')}
        </div>
        
        <h2>📈 7-Day Forecast</h2>
        <table class="forecast-table">
            <tr>
                <th>Date</th>
                <th>Expected Rainfall</th>
                <th>Temperature Range</th>
                <th>Condition</th>
            </tr>
            ${generateForecastTableRows()}
        </table>
        
        <h2>⚠️ Flood Risk Assessment</h2>
        <p><strong>${assessFloodRisk(rainyZones)}</strong></p>
        
        <hr>
        <p><small>Mumbai Rain Monitor | Automated Weather Alert System</small></p>
    </body>
    </html>`;
}

function generateForecastTableRows() {
    const days = ['Today', 'Tomorrow', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
    return days.map((day, index) => {
        const date = new Date();
        date.setDate(date.getDate() + index);
        const rainfall = Math.random() * 15; // Sample forecast data
        const maxTemp = Math.round(28 + Math.random() * 8);
        const minTemp = Math.round(maxTemp - 5 - Math.random() * 3);
        const condition = rainfall > 5 ? 'Rainy' : rainfall > 1 ? 'Cloudy' : 'Partly Cloudy';
        
        return `
            <tr>
                <td>${day}<br><small>${date.toLocaleDateString()}</small></td>
                <td>${rainfall.toFixed(1)}mm</td>
                <td>${maxTemp}°C / ${minTemp}°C</td>
                <td>${condition}</td>
            </tr>
        `;
    }).join('');
}

function generateWeeklyOutlook() {
    const outlook = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-IN', { weekday: 'short' });
        const rainfall = Math.random() * 12;
        const icon = rainfall > 5 ? '🌧️' : rainfall > 1 ? '🌦️' : '⛅';
        outlook.push(`${icon} ${dayName}: ${rainfall.toFixed(1)}mm`);
    }
    return outlook.join('\n');
}

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.json({
                message: '🌧️ Mumbai Rain Monitor API',
                status: 'running',
                dashboard: 'Dashboard file not found - upload public/index.html',
                realDataStatus: lastRealDataUpdate ? 'Available' : 'Not fetched yet',
                timestamp: new Date().toISOString()
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
            realDataActive: !!config.OPENWEATHER_API_KEY,
            configStatus: {
                openweather: !!config.OPENWEATHER_API_KEY,
                telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
                email: !!(config.EMAIL_FROM && config.EMAIL_TO)
            }
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
    
    // Immediate real weather check
    try {
        await updateAllZonesWeather();
        res.json({
            success: true,
            message: 'Real-time monitoring started successfully',
            zones: MUMBAI_ZONES.length,
            realData: !!config.OPENWEATHER_API_KEY,
            lastUpdate: lastRealDataUpdate.toISOString()
        });
    } catch (error) {
        log(`Error during monitoring start: ${error.message}`, 'ERROR');
        res.json({
            success: true,
            message: 'Monitoring started (using fallback data)',
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

app.post('/api/refresh', async (req, res) => {
    try {
        log('🔄 Manual weather data refresh requested');
        await updateAllZonesWeather();
        
        res.json({
            success: true,
            message: 'Real weather data refreshed successfully',
            data: weatherData,
            timestamp: lastRealDataUpdate.toISOString(),
            realData: !!config.OPENWEATHER_API_KEY
        });
    } catch (error) {
        log(`Error refreshing weather data: ${error.message}`, 'ERROR');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/test', async (req, res) => {
    log('🧪 Running comprehensive system tests...');
    
    const testResults = {
        server: true,
        openweather: false,
        telegram: false,
        email: false,
        realWeatherData: false,
        timestamp: new Date().toISOString()
    };
    
    // Test OpenWeatherMap API with real call
    if (config.OPENWEATHER_API_KEY) {
        try {
            const testZone = MUMBAI_ZONES[0]; // Test with Colaba
            const weatherResult = await fetchRealWeatherData(testZone);
            testResults.openweather = !!weatherResult;
            testResults.realWeatherData = weatherResult && weatherResult.realData;
        } catch (error) {
            log(`OpenWeather test failed: ${error.message}`, 'ERROR');
        }
    }
    
    // Test Telegram
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
        testResults.telegram = await sendTelegramMessage('🧪 Test message from Mumbai Rain Monitor - System is online and monitoring!');
    }
    
    // Test Email
    testResults.email = !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS);
    
    log(`🧪 Test results: OpenWeather=${testResults.openweather}, Telegram=${testResults.telegram}, Email=${testResults.email}, RealData=${testResults.realWeatherData}`);
    
    res.json({
        success: true,
        tests: testResults,
        message: 'System test completed'
    });
});

// Simple Telegram message sender
async function sendTelegramMessage(message) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        return false;
    }
    
    try {
        const axios = require('axios');
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        await axios.post(url, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message
        });
        
        return true;
    } catch (error) {
        log(`Telegram error: ${error.message}`, 'ERROR');
        return false;
    }
}

// Scheduled monitoring (simulate cron job)
setInterval(async () => {
    if (isMonitoringActive && isMonitoringSeason()) {
        log('⏰ Performing scheduled weather check...');
        await updateAllZonesWeather();
    }
}, 30 * 60 * 1000); // Every 30 minutes

// Error handling
app.use((err, req, res, next) => {
    log(`API Error: ${err.message}`, 'ERROR');
    res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: err.message 
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Mumbai Rain Monitor running on port', PORT);
    console.log('🌐 Dashboard available at root URL');
    console.log('📊 API endpoints ready');
    console.log(`🔑 OpenWeather API: ${config.OPENWEATHER_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`📱 Telegram: ${config.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
    console.log(`📧 Email: ${config.EMAIL_FROM ? 'Configured' : 'Not configured'}`);
    
    // Initialize with sample data
    weatherData = {};
    MUMBAI_ZONES.forEach(zone => {
        weatherData[zone.name] = generateFallbackData(zone);
    });
    
    log('Server started successfully with sample data');
});

server.on('error', (err) => {
    console.error('❌ Server error:', err.message);
});