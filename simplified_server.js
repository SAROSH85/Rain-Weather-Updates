const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Configuration with safe defaults
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
let monitoringInterval;

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

// Mock weather data generator for testing
function generateMockWeatherData() {
    const data = {};
    MUMBAI_ZONES.forEach(zone => {
        const rainfall = Math.random() * 15; // 0-15mm
        data[zone.name] = {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(25 + Math.random() * 10), // 25-35°C
            humidity: Math.round(60 + Math.random() * 30), // 60-90%
            description: rainfall > 5 ? 'Heavy rain' : rainfall > 1 ? 'Light rain' : 'Partly cloudy',
            timestamp: new Date().toISOString()
        };
    });
    return data;
}

// Weather API functions (with fallback to mock data)
async function getWeatherForZone(zone) {
    if (!config.OPENWEATHER_API_KEY) {
        // Return mock data if no API key
        const rainfall = Math.random() * 10;
        return {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(25 + Math.random() * 10),
            humidity: Math.round(60 + Math.random() * 30),
            description: rainfall > 5 ? 'Heavy rain' : rainfall > 1 ? 'Light rain' : 'Partly cloudy',
            timestamp: new Date().toISOString()
        };
    }

    try {
        const axios = require('axios');
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${zone.lat}&lon=${zone.lon}&appid=${config.OPENWEATHER_API_KEY}&units=metric`;

        const response = await axios.get(currentUrl);
        const currentData = response.data;

        const rainfall = currentData.rain ? (currentData.rain['1h'] || 0) : 0;
        const intensity = getRainfallIntensity(rainfall);

        return {
            zone: zone.name,
            rainfall,
            intensity,
            temperature: Math.round(currentData.main.temp),
            humidity: currentData.main.humidity,
            description: currentData.weather[0].description,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        log(`Error getting weather for ${zone.name}: ${error.message}`, 'ERROR');
        // Return mock data on error
        const rainfall = Math.random() * 5;
        return {
            zone: zone.name,
            rainfall: rainfall,
            intensity: getRainfallIntensity(rainfall),
            temperature: Math.round(25 + Math.random() * 8),
            humidity: Math.round(70 + Math.random() * 20),
            description: 'Data unavailable',
            timestamp: new Date().toISOString()
        };
    }
}

// Notification functions (with error handling)
async function sendTelegramMessage(message) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        log('Telegram not configured - skipping notification', 'WARNING');
        return false;
    }

    try {
        const axios = require('axios');
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
    if (!config.EMAIL_FROM || !config.EMAIL_TO || !config.EMAIL_PASS) {
        log('Email not configured - skipping email notification', 'WARNING');
        return false;
    }

    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransporter({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: false,
            auth: {
                user: config.EMAIL_FROM,
                pass: config.EMAIL_PASS
            }
        });

        await transporter.sendMail({
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