const express = require('express');
const app = express();

// Railway assigns the port - MUST use process.env.PORT
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting server...');
console.log('📍 Port:', PORT);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        port: PORT 
    });
});

// Main endpoint
app.get('/', (req, res) => {
    res.json({
        message: '🌧️ Mumbai Rain Monitor is LIVE!',
        status: 'running',
        timestamp: new Date().toISOString(),
        zones: ['Colaba', 'CST', 'Fort', 'Marine Lines', 'Grant Road', 'Lamington Road', 'Mazgaon', 'Byculla', 'Lalbaug', 'Parel', 'Dadar', 'Sion', 'Kurla', 'Ghatkopar', 'Vikhroli', 'Thane', 'Powai', 'Vashi'],
        port: PORT
    });
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        monitoring: false,
        zones: 18,
        server: 'online',
        timestamp: new Date().toISOString()
    });
});

// Catch all other routes
app.get('*', (req, res) => {
    res.json({
        message: 'Mumbai Rain Monitor API',
        availableEndpoints: ['/', '/health', '/api/status'],
        requestedPath: req.path
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// Start server with proper error handling
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ SUCCESS: Server running on port', PORT);
    console.log('🌐 Access your app at your Railway URL');
    console.log('📡 Ready to receive requests');
});

// Handle server errors
server.on('error', (err) => {
    console.error('❌ Server error:', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error('🔴 Port', PORT, 'is already in use');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📤 Received SIGTERM, shutting down gracefully');
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
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});