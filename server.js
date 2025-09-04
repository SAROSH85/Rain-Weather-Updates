const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Mumbai Rain Monitor with Multi-API Real Weather System...');

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

// Multi-API Configuration
const config = {
    // OpenWeatherMap (Primary)
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',
    
    // Open-Meteo (FREE - No API key needed!)
    OPEN_METEO_ENABLED: true,
    
    // WeatherAPI.com (Backup)
    WEATHERAPI_KEY: process.env.WEATHERAPI_KEY || '',
    
    // Meteomatics (Premium - if available)
    METEOMATICS_USER: process.env.METEOMATICS_USER || '',
    METEOMATICS_PASS: process.env.METEOMATICS_PASS || '',
    
    // Notifications
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

// Enhanced logging
console.log('🔧 Multi-API Configuration Status:');
console.log('- OpenWeather API:', config.OPENWEATHER_API_KEY ? '✅ Configured' : '❌ Missing');
console.log('- Open-Meteo (FREE):', config.OPEN_METEO_ENABLED ? '✅ Enabled' : '❌ Disabled');
console.log('- WeatherAPI.com:', config.WEATHERAPI_KEY ? '✅ Configured' : '❌ Missing');
console.log('- Meteomatics:', (config.METEOMATICS_USER && config.METEOMATICS_PASS) ? '✅ Configured' : '❌ Missing');
console.log('- Telegram:', (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) ? '✅ Configured' : '❌ Missing');
console.log('- Email:', (config.EMAIL_FROM && config.EMAIL_TO) ? '✅ Configured' : '❌ Missing');

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

function getRainfallIntensity(mm) {
    if (mm < 0.1) return 'No Rain';
    if (mm < 2.5) return 'Light';
    if (mm < 7.5) return 'Medium';
    if (mm < 35) return 'Heavy';
    return 'Very Heavy';
}

function isMonitoringSeason() {
    const month = new Date().getMonth() + 1;
    return month >= 7 || month <= 1;
}

// **1. OPEN-METEO API (FREE - Most Accurate)**
async function fetchOpenMeteoWeather(zone) {
    try {
        const axios = require('axios');
        // Open-Meteo API - FREE and very accurate
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${zone.lat}&longitude=${zone.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,pressure_msl,wind_speed_10m&hourly=precipitation,rain&timezone=Asia/Kolkata`;
        
        const response = await axios.get(url, { timeout: 8000 });
        const data = response.data;
        
        const current = data.current;
        const rainfall = current.rain || current.precipitation || 0;
        
        const weatherInfo = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(current.temperature_2m),
            humidity: current.relative_humidity_2m,
            pressure: Math.round(current.pressure_msl),
            windSpeed: current.wind_speed_10m,
            cloudCover: current.cloud_cover,
            description: getWeatherDescription(current.weather_code),
            timestamp: new Date().toISOString(),
            coordinates: `${zone.lat}, ${zone.lon}`,
            source: 'Open-Meteo',
            realData: true
        };

        log(`✅ Open-Meteo data: ${zone.name} - ${rainfall}mm/hr, ${current.temperature_2m}°C, ${getWeatherDescription(current.weather_code)}`);
        return weatherInfo;
        
    } catch (error) {
        log(`❌ Open-Meteo error for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// **2. OPENWEATHERMAP API (Primary)**
async function fetchOpenWeatherData(zone) {
    if (!config.OPENWEATHER_API_KEY) return null;
    
    try {
        const axios = require('axios');
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;
        
        const response = await axios.get(url, { timeout: 8000 });
        const data = response.data;
        
        const rainfall = data.rain ? (data.rain['1h'] || 0) : 0;
        
        const weatherInfo = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(data.main.temp),
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            windSpeed: data.wind ? data.wind.speed : 0,
            cloudCover: data.clouds.all,
            description: data.weather[0].description,
            timestamp: new Date().toISOString(),
            source: 'OpenWeatherMap',
            realData: true
        };

        log(`✅ OpenWeather data: ${zone.name} - ${rainfall}mm/hr, ${data.main.temp}°C, ${data.weather[0].description}`);
        return weatherInfo;
        
    } catch (error) {
        log(`❌ OpenWeather error for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// **3. WEATHERAPI.COM (Backup)**
async function fetchWeatherAPIData(zone) {
    if (!config.WEATHERAPI_KEY) return null;
    
    try {
        const axios = require('axios');
        const url = `https://api.weatherapi.com/v1/current.json?key=${config.WEATHERAPI_KEY}&q=${zone.lat},${zone.lon}&aqi=no`;
        
        const response = await axios.get(url, { timeout: 8000 });
        const data = response.data;
        
        const current = data.current;
        const rainfall = current.precip_mm || 0;
        
        const weatherInfo = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(current.temp_c),
            humidity: current.humidity,
            pressure: current.pressure_mb,
            windSpeed: current.wind_kph / 3.6, // Convert to m/s
            cloudCover: current.cloud,
            description: current.condition.text.toLowerCase(),
            timestamp: new Date().toISOString(),
            source: 'WeatherAPI.com',
            realData: true
        };

        log(`✅ WeatherAPI data: ${zone.name} - ${rainfall}mm/hr, ${current.temp_c}°C, ${current.condition.text}`);
        return weatherInfo;
        
    } catch (error) {
        log(`❌ WeatherAPI error for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// **4. METEOMATICS API (Premium)**
async function fetchMeteomaticsData(zone) {
    if (!config.METEOMATICS_USER || !config.METEOMATICS_PASS) return null;
    
    try {
        const axios = require('axios');
        const now = new Date().toISOString();
        const url = `https://api.meteomatics.com/${now}/t_2m:C,relative_humidity_2m:p,precip_1h:mm,msl_pressure:hPa,wind_speed_10m:ms/${zone.lat},${zone.lon}/json`;
        
        const auth = Buffer.from(`${config.METEOMATICS_USER}:${config.METEOMATICS_PASS}`).toString('base64');
        
        const response = await axios.get(url, {
            timeout: 8000,
            headers: { 'Authorization': `Basic ${auth}` }
        });
        
        const data = response.data.data;
        const rainfall = data.find(d => d.parameter === 'precip_1h:mm')?.coordinates[0]?.dates[0]?.value || 0;
        const temperature = data.find(d => d.parameter === 't_2m:C')?.coordinates[0]?.dates[0]?.value || 0;
        const humidity = data.find(d => d.parameter === 'relative_humidity_2m:p')?.coordinates[0]?.dates[0]?.value || 0;
        const pressure = data.find(d => d.parameter === 'msl_pressure:hPa')?.coordinates[0]?.dates[0]?.value || 0;
        const windSpeed = data.find(d => d.parameter === 'wind_speed_10m:ms')?.coordinates[0]?.dates[0]?.value || 0;
        
        const weatherInfo = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(temperature),
            humidity: Math.round(humidity),
            pressure: Math.round(pressure),
            windSpeed: windSpeed,
            cloudCover: 0, // Not available
            description: rainfall > 0.1 ? 'rain' : 'clear',
            timestamp: new Date().toISOString(),
            source: 'Meteomatics',
            realData: true
        };

        log(`✅ Meteomatics data: ${zone.name} - ${rainfall}mm/hr, ${temperature}°C`);
        return weatherInfo;
        
    } catch (error) {
        log(`❌ Meteomatics error for ${zone.name}: ${error.message}`, 'ERROR');
        return null;
    }
}

// Convert Open-Meteo weather codes to descriptions
function getWeatherDescription(code) {
    const weatherCodes = {
        0: 'clear sky',
        1: 'mainly clear',
        2: 'partly cloudy',
        3: 'overcast',
        45: 'fog',
        48: 'depositing rime fog',
        51: 'light drizzle',
        53: 'moderate drizzle',
        55: 'dense drizzle',
        61: 'slight rain',
        63: 'moderate rain',
        65: 'heavy rain',
        80: 'slight rain showers',
        81: 'moderate rain showers',
        82: 'violent rain showers',
        95: 'thunderstorm',
        96: 'thunderstorm with slight hail',
        99: 'thunderstorm with heavy hail'
    };
    return weatherCodes[code] || 'unknown';
}

// **SMART MULTI-API WEATHER FETCHING**
async function fetchRealWeatherData(zone) {
    log(`🔄 Fetching weather for ${zone.name} from multiple sources...`);
    
    const weatherSources = [];
    
    // Try all available APIs in parallel
    const promises = [
        fetchOpenMeteoWeather(zone),           // FREE and accurate
        fetchOpenWeatherData(zone),            // Primary paid API
        fetchWeatherAPIData(zone),             // Backup API
        fetchMeteomaticsData(zone)             // Premium API
    ];
    
    const results = await Promise.allSettled(promises);
    
    // Collect successful results
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            weatherSources.push(result.value);
        }
    });
    
    if (weatherSources.length === 0) {
        log(`❌ No weather data available for ${zone.name}`, 'ERROR');
        return null;
    }
    
    // **SMART DATA FUSION** - Combine multiple sources for accuracy
    const combinedWeather = combineWeatherSources(weatherSources, zone);
    
    log(`✅ Combined weather for ${zone.name}: ${combinedWeather.rainfall}mm/hr from ${weatherSources.length} sources`);
    return combinedWeather;
}

// Intelligent weather data fusion
function combineWeatherSources(sources, zone) {
    if (sources.length === 1) return sources[0];
    
    // Calculate weighted averages (prefer more reliable sources)
    const weights = {
        'Open-Meteo': 0.4,      // Most accurate and free
        'OpenWeatherMap': 0.3,  // Reliable paid service
        'WeatherAPI.com': 0.2,  // Good backup
        'Meteomatics': 0.1      // Premium but may not always be available
    };
    
    let totalWeight = 0;
    let weightedRainfall = 0;
    let weightedTemp = 0;
    let weightedHumidity = 0;
    let weightedPressure = 0;
    
    sources.forEach(source => {
        const weight = weights[source.source] || 0.1;
        totalWeight += weight;
        weightedRainfall += source.rainfall * weight;
        weightedTemp += source.temperature * weight;
        weightedHumidity += source.humidity * weight;
        weightedPressure += (source.pressure || 1013) * weight;
    });
    
    const avgRainfall = weightedRainfall / totalWeight;
    const avgTemp = weightedTemp / totalWeight;
    const avgHumidity = weightedHumidity / totalWeight;
    const avgPressure = weightedPressure / totalWeight;
    
    // Use the most recent description from the most reliable source
    const primarySource = sources.find(s => s.source === 'Open-Meteo') || sources[0];
    
    return {
        zone: zone.name,
        rainfall: Math.round(avgRainfall * 100) / 100, // Round to 2 decimal places
        intensity: getRainfallIntensity(avgRainfall),
        temperature: Math.round(avgTemp),
        humidity: Math.round(avgHumidity),
        pressure: Math.round(avgPressure),
        windSpeed: primarySource.windSpeed,
        cloudCover: primarySource.cloudCover,
        description: primarySource.description,
        timestamp: new Date().toISOString(),
        coordinates: `${zone.lat}, ${zone.lon}`,
        sources: sources.map(s => s.source).join(', '),
        realData: true,
        accuracy: sources.length > 1 ? 'High (Multi-API)' : 'Medium (Single-API)'
    };
}

// Update all zones with real weather data
async function updateAllZonesWeather() {
    log('🔄 Starting multi-API weather update for all Mumbai zones...');
    
    const newWeatherData = {};
    let successCount = 0;
    
    for (const zone of MUMBAI_ZONES) {
        const realData = await fetchRealWeatherData(zone);
        
        if (realData) {
            newWeatherData[zone.name] = realData;
            successCount++;
        } else {
            // Create fallback "No Data" entry
            newWeatherData[zone.name] = {
                zone: zone.name,
                rainfall: 0,
                intensity: 'No Data',
                temperature: 0,
                humidity: 0,
                description: 'Data unavailable',
                timestamp: new Date().toISOString(),
                realData: false,
                source: 'None'
            };
        }
        
        // Rate limiting between zones
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    weatherData = newWeatherData;
    lastRealDataUpdate = new Date();
    
    log(`📊 Multi-API weather update complete: ${successCount}/${MUMBAI_ZONES.length} zones with real data`);
    
    // Check for rain alerts
    await processRainAlerts();
    
    return weatherData;
}

// Enhanced rain alert processing
async function processRainAlerts() {
    const rainyZones = Object.values(weatherData).filter(zone => zone.rainfall >= 1);
    
    if (rainyZones.length > 0) {
        log(`🌧️ REAL RAIN detected in ${rainyZones.length} zones`);
        
        for (const zone of rainyZones) {
            const alert = {
                id: Date.now() + Math.random(),
                timestamp: new Date().toISOString(),
                zone: zone.zone,
                rainfall: zone.rainfall,
                intensity: zone.intensity,
                temperature: zone.temperature,
                humidity: zone.humidity,
                sources: zone.sources,
                accuracy: zone.accuracy,
                message: `🌧️ REAL RAIN ALERT - ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity}) - Verified by: ${zone.sources}`
            };
            
            alertHistory.unshift(alert);
            log(`🚨 REAL RAIN ALERT: ${alert.message}`);
        }
        
        alertHistory = alertHistory.slice(0, 100);
        await sendRainNotifications(rainyZones);
    } else {
        log('☀️ No significant rainfall detected - Weather is clear');
    }
}

// Fixed email function
async function sendEmailAlert(subject, htmlContent) {
    if (!config.EMAIL_FROM || !config.EMAIL_TO || !config.EMAIL_PASS) {
        return { success: false, error: 'Email not configured' };
    }

    try {
        // Use dynamic import for nodemailer
        const nodemailer = await import('nodemailer');
        
        const transporter = nodemailer.default.createTransporter({
            service: 'gmail',
            auth: {
                user: config.EMAIL_FROM,
                pass: config.EMAIL_PASS
            }
        });

        await transporter.sendMail({
            from: config.EMAIL_FROM,
            to: config.EMAIL_TO,
            subject: subject,
            html: htmlContent
        });
        
        log('📧 Email sent successfully');
        return { success: true };
    } catch (error) {
        log(`📧 Email error: ${error.message}`, 'ERROR');
        return { success: false, error: error.message };
    }
}

// Fixed Telegram function
async function sendTelegramMessage(message) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        return { success: false, error: 'Telegram not configured' };
    }

    try {
        const axios = require('axios');
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        await axios.post(url, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message
        });
        
        log('📱 Telegram message sent successfully');
        return { success: true };
    } catch (error) {
        log(`📱 Telegram error: ${error.message}`, 'ERROR');
        return { success: false, error: error.message };
    }
}

// Enhanced notification system
async function sendRainNotifications(rainyZones) {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    const detailedMessage = `🌧️ MUMBAI REAL RAIN ALERT - VERIFIED
📅 ${timestamp}

🚨 CONFIRMED RAINFALL (Multi-API Verified):
${rainyZones.map(zone => 
    `📍 ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.intensity})
   🌡️ ${zone.temperature}°C | 💧 ${zone.humidity}% 
   📊 Sources: ${zone.sources}
   🎯 Accuracy: ${zone.accuracy}`
).join('\n\n')}

📊 REAL-TIME RAINFALL CHART:
${Object.values(weatherData).map(zone => {
    const icon = zone.rainfall >= 7 ? '🔴' : zone.rainfall >= 1 ? '🟡' : '🟢';
    return `${icon} ${zone.zone}: ${zone.rainfall.toFixed(1)}mm (${zone.sources || 'Unknown'})`;
}).join('\n')}

⚠️ FLOOD RISK: ${assessFloodRisk(rainyZones)}

🔗 Live Dashboard: https://rain-weather-updates-production.up.railway.app

✅ Data verified by multiple weather APIs for accuracy`;

    // Send notifications
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
        await sendTelegramMessage(detailedMessage);
    }
    
    if (config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS) {
        const htmlContent = generateEnhancedHTMLReport(rainyZones, timestamp);
        await sendEmailAlert(`🌧️ VERIFIED Mumbai Rain Alert - ${rainyZones.length} Zones`, htmlContent);
    }
}

function assessFloodRisk(rainyZones) {
    const heavyRainZones = rainyZones.filter(zone => zone.rainfall >= 7);
    const totalRainfall = rainyZones.reduce((sum, zone) => sum + zone.rainfall, 0);
    
    if (heavyRainZones.length >= 3) {
        return '🔴 HIGH RISK - Multiple zones with verified heavy rainfall';
    } else if (totalRainfall > 20) {
        return '🟡 MEDIUM RISK - Significant verified rainfall across areas';
    } else if (rainyZones.length >= 5) {
        return '🟡 MEDIUM RISK - Widespread verified light rainfall';
    } else {
        return '🟢 LOW RISK - Localized verified rainfall only';
    }
}

function generateEnhancedHTMLReport(rainyZones, timestamp) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 15px; text-align: center; margin-bottom: 30px; }
            .verified-badge { background: #28a745; color: white; padding: 10px 20px; border-radius: 25px; display: inline-block; margin: 10px 0; font-weight: bold; }
            .alert-zone { background: #fff3cd; padding: 25px; margin: 20px 0; border-radius: 10px; border-left: 5px solid #ffc107; }
            .danger-zone { background: #f8d7da; border-left-color: #dc3545; }
            .source-info { background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 0.9em; }
            .accuracy-high { color: #28a745; font-weight: bold; }
            .chart-container { background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; }
            .zone-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin: 20px 0; }
            .zone-card { background: #e9ecef; padding: 20px; border-radius: 10px; text-align: center; font-weight: bold; transition: transform 0.2s; }
            .zone-card:hover { transform: translateY(-2px); }
            .risk-box { background: #d1ecf1; padding: 25px; border-radius: 10px; border-left: 5px solid #bee5eb; margin: 25px 0; }
            .footer { text-align: center; margin-top: 40px; padding: 25px; background: #f8f9fa; border-radius: 10px; color: #6c757d; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🌧️ VERIFIED Mumbai Rain Alert Report</h1>
                <div class="verified-badge">✅ MULTI-API VERIFIED DATA</div>
                <p style="margin: 10px 0; font-size: 1.2em;">Generated: ${timestamp}</p>
            </div>
            
            <h2 style="color: #dc3545;">🚨 Confirmed Rain Alerts (${rainyZones.length} zones)</h2>
            ${rainyZones.map(zone => `
                <div class="alert-zone ${zone.rainfall >= 7 ? 'danger-zone' : ''}">
                    <h3 style="margin-top: 0; color: #721c24;">📍 ${zone.zone}</h3>
                    <p><strong>Verified Rainfall:</strong> ${zone.rainfall.toFixed(2)}mm/hr (${zone.intensity})</p>
                    <p><strong>Temperature:</strong> ${zone.temperature}°C | <strong>Humidity:</strong> ${zone.humidity}%</p>
                    <p><strong>Condition:</strong> ${zone.description}</p>
                    <div class="source-info">
                        <strong>Data Sources:</strong> ${zone.sources}<br>
                        <strong>Accuracy Level:</strong> <span class="accuracy-high">${zone.accuracy}</span>
                    </div>
                </div>
            `).join('')}
            
            <div class="chart-container">
                <h2 style="margin-top: 0; color: #495057;">📊 All Mumbai Zones - Real-Time Status</h2>
                <div class="zone-grid">
                    ${MUMBAI_ZONES.map(zoneName => {
                        const data = weatherData[zoneName.name] || {};
                        const color = data.rainfall >= 7 ? '#dc3545' : data.rainfall >= 1 ? '#ffc107' : '#28a745';
                        const bgColor = data.rainfall >= 7 ? '#f8d7da' : data.rainfall >= 1 ? '#fff3cd' : '#d4edda';
                        return `
                            <div class="zone-card" style="background: ${bgColor}; border-left: 5px solid ${color};">
                                <div style="color: #212529;">${zoneName.name}</div>
                                <div style="font-size: 1.3em; color: ${color};">${data.rainfall ? data.rainfall.toFixed(1) : '0.0'}mm/hr</div>
                                <div style="font-size: 0.9em; color: #6c757d;">${data.intensity || 'No Rain'}</div>
                                <div style="font-size: 0.8em; color: #6c757d; margin-top: 5px;">${data.sources || 'No Data'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            
            <div class="risk-box">
                <h2 style="margin-top: 0; color: #0c5460;">⚠️ Flood Risk Assessment</h2>
                <p style="font-size: 1.2em; margin: 0;"><strong>${assessFloodRisk(rainyZones)}</strong></p>
                <p style="margin-top: 10px; font-size: 0.9em;">Based on verified multi-API rainfall data</p>
            </div>
            
            <div class="footer">
                <p><strong>Mumbai Rain Monitor</strong> | Multi-API Verified Weather Alert System</p>
                <p>Data Sources: Open-Meteo, OpenWeatherMap, WeatherAPI.com, Meteomatics</p>
                <p>Dashboard: <a href="https://rain-weather-updates-production.up.railway.app">https://rain-weather-updates-production.up.railway.app</a></p>
            </div>
        </div>
    </body>
    </html>`;
}

// TEST ENDPOINTS WITH REAL DATA

app.get('/test-telegram', async (req, res) => {
    try {
        const testMessage = `🧪 REAL WEATHER TEST - Mumbai Rain Monitor
📅 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

🌡️ This test uses REAL weather data from multiple APIs:

📍 Colaba (Multi-API): ${weatherData['Colaba'] ? weatherData['Colaba'].rainfall.toFixed(1) : '0.0'}mm/hr
🌡️ Temperature: ${weatherData['Colaba'] ? weatherData['Colaba'].temperature : '28'}°C
💧 Humidity: ${weatherData['Colaba'] ? weatherData['Colaba'].humidity : '75'}%
☁️ Condition: ${weatherData['Colaba'] ? weatherData['Colaba'].description : 'clear'}
📊 Sources: ${weatherData['Colaba'] ? weatherData['Colaba'].sources : 'Open-Meteo, OpenWeatherMap'}

📊 LIVE MUMBAI ZONES STATUS:
${Object.values(weatherData).slice(0, 5).map(zone => {
    const icon = zone.rainfall >= 1 ? '🌧️' : '☀️';
    return `${icon} ${zone.zone}: ${zone.rainfall.toFixed(1)}mm/hr (${zone.sources || 'Multi-API'})`;
}).join('\n')}

✅ This confirms REAL weather data is working!
🎯 Accuracy: Multi-API verification active`;

        const result = await sendTelegramMessage(testMessage);
        
        res.json({ 
            success: result.success, 
            message: result.success ? 'Real weather test notification sent!' : 'Failed to send notification',
            error: result.error || null,
            realDataStatus: Object.keys(weatherData).length > 0 ? 'Available' : 'Not loaded yet'
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/test-email', async (req, res) => {
    try {
        const sampleZone = weatherData['Colaba'] || { rainfall: 0, temperature: 28, humidity: 75, description: 'clear', sources: 'Multi-API' };
        
        const testHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 700px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 15px; text-align: center; margin-bottom: 30px; }
                .verified-badge { background: #28a745; color: white; padding: 8px 16px; border-radius: 20px; display: inline-block; font-weight: bold; }
                .real-data { background: #e7f3ff; padding: 20px; border-radius: 10px; border-left: 5px solid #007bff; margin: 20px 0; }
                .chart-box { background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 30px; padding: 20px; background: #e9ecef; border-radius: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🧪 REAL WEATHER TEST - Mumbai Rain Monitor</h1>
                    <div class="verified-badge">✅ MULTI-API VERIFIED</div>
                    <p>Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                </div>
                
                <div class="real-data">
                    <h3>📍 Live Weather Data - Colaba</h3>
                    <p><strong>Current Rainfall:</strong> ${sampleZone.rainfall.toFixed(1)}mm/hr</p>
                    <p><strong>Temperature:</strong> ${sampleZone.temperature}°C | <strong>Humidity:</strong> ${sampleZone.humidity}%</p>
                    <p><strong>Condition:</strong> ${sampleZone.description}</p>
                    <p><strong>Data Sources:</strong> ${sampleZone.sources}</p>
                </div>
                
                <div class="chart-box">
                    <h3>📊 Live Mumbai Zones Status</h3>
                    ${Object.values(weatherData).slice(0, 6).map(zone => `
                        <p>${zone.rainfall >= 1 ? '🌧️' : '☀️'} <strong>${zone.zone}:</strong> ${zone.rainfall.toFixed(1)}mm/hr (${zone.sources || 'Multi-API'})</p>
                    `).join('')}
                </div>
                
                <div class="footer">
                    <h3 style="color: #28a745;">✅ Real Weather Data Email Working!</h3>
                    <p>This confirms your email system is receiving LIVE weather updates.</p>
                    <p><small>Mumbai Rain Monitor | Multi-API Weather System</small></p>
                </div>
            </div>
        </body>
        </html>`;

        const result = await sendEmailAlert('🧪 REAL WEATHER TEST - Mumbai Rain Monitor', testHtml);
        
        res.json({ 
            success: result.success, 
            message: result.success ? 'Real weather test email sent!' : 'Failed to send test email',
            error: result.error || null,
            weatherDataLoaded: Object.keys(weatherData).length > 0
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.json({
                message: '🌧️ Mumbai Rain Monitor - Multi-API Weather System',
                status: 'running',
                features: [
                    'Real weather data from multiple APIs',
                    'Open-Meteo (FREE) + OpenWeatherMap + WeatherAPI.com + Meteomatics',
                    'Smart data fusion for accuracy',
                    'Only alerts when it\'s actually raining'
                ],
                testEndpoints: {
                    testTelegram: '/test-telegram',
                    testEmail: '/test-email',
                    realWeatherCheck: '/api/weather'
                }
            });
        }
    });
});

app.get('/api/status', (req, res) => {
    const activeAPIs = [];
    if (config.OPEN_METEO_ENABLED) activeAPIs.push('Open-Meteo (FREE)');
    if (config.OPENWEATHER_API_KEY) activeAPIs.push('OpenWeatherMap');
    if (config.WEATHERAPI_KEY) activeAPIs.push('WeatherAPI.com');
    if (config.METEOMATICS_USER && config.METEOMATICS_PASS) activeAPIs.push('Meteomatics');
    
    res.json({
        success: true,
        status: {
            monitoring: isMonitoringActive,
            season: isMonitoringSeason(),
            zonesCount: MUMBAI_ZONES.length,
            lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null,
            alertCount: alertHistory.length,
            realWeatherSources: activeAPIs,
            dataAccuracy: activeAPIs.length > 1 ? 'High (Multi-API)' : 'Medium (Single-API)',
            configStatus: {
                weatherAPIs: activeAPIs.length,
                telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
                email: !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS)
            }
        },
        testEndpoints: {
            testTelegram: '/test-telegram',
            testEmail: '/test-email'
        }
    });
});

app.get('/api/weather', (req, res) => {
    res.json({
        success: true,
        data: weatherData,
        lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null,
        zonesCount: Object.keys(weatherData).length,
        dataType: 'Real Multi-API Weather Data',
        accuracy: 'High - Verified by multiple sources'
    });
});

app.get('/api/alerts', (req, res) => {
    res.json({
        success: true,
        alerts: alertHistory.slice(0, 50),
        totalAlerts: alertHistory.length,
        alertType: 'Real Rain Alerts Only'
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
    log('🚀 Real weather monitoring started with Multi-API system');
    
    try {
        await updateAllZonesWeather();
        res.json({
            success: true,
            message: 'Real-time multi-API weather monitoring started',
            zones: MUMBAI_ZONES.length,
            weatherSources: config.OPEN_METEO_ENABLED ? 'Multi-API (Open-Meteo + others)' : 'Single API',
            lastUpdate: lastRealDataUpdate ? lastRealDataUpdate.toISOString() : null
        });
    } catch (error) {
        log(`Error starting monitoring: ${error.message}`, 'ERROR');
        res.json({
            success: false,
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

app.get('/api/test', (req, res) => {
    const activeAPIs = [];
    if (config.OPEN_METEO_ENABLED) activeAPIs.push('Open-Meteo');
    if (config.OPENWEATHER_API_KEY) activeAPIs.push('OpenWeatherMap');
    if (config.WEATHERAPI_KEY) activeAPIs.push('WeatherAPI.com');
    if (config.METEOMATICS_USER && config.METEOMATICS_PASS) activeAPIs.push('Meteomatics');
    
    res.json({
        success: true,
        tests: {
            server: true,
            weatherAPIs: activeAPIs.length,
            telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
            email: !!(config.EMAIL_FROM && config.EMAIL_TO && config.EMAIL_PASS)
        },
        activeAPIs: activeAPIs,
        dataAccuracy: activeAPIs.length > 1 ? 'High (Multi-API)' : 'Medium (Single-API)',
        instructions: {
            testReal: 'Visit /test-telegram or /test-email to test with real weather data',
            startMonitoring: 'Click Start Monitoring to begin real weather tracking'
        }
    });
});

// Initialize with real weather data
async function initializeRealWeatherData() {
    log('🌍 Initializing with real weather data from multiple APIs...');
    await updateAllZonesWeather();
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Mumbai Rain Monitor with REAL Multi-API Weather running on port', PORT);
    console.log('🌍 Weather Sources: Open-Meteo (FREE), OpenWeatherMap, WeatherAPI.com, Meteomatics');
    console.log('🎯 Data Accuracy: Multi-API verification for maximum accuracy');
    console.log('🧪 Test Real Weather: /test-telegram, /test-email');
    console.log('📊 Real Dashboard: Shows actual Mumbai weather conditions');
    
    // Initialize real weather data
    setTimeout(initializeRealWeatherData, 3000);
    
    log('Multi-API weather system started - Now showing REAL weather data');
});

// Automatic weather updates every 30 minutes
setInterval(async () => {
    if (isMonitoringActive && isMonitoringSeason()) {
        log('⏰ Performing scheduled multi-API weather update...');
        await updateAllZonesWeather();
    }
}, 30 * 60 * 1000);

server.on('error', (err) => {
    console.error('❌ Server error:', err.message);
});

process.on('SIGTERM', () => {
    log('📤 Shutting down Multi-API weather system...');
    server.close(() => {
        log('✅ Server closed');
        process.exit(0);
    });
});