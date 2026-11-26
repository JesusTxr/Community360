require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const authRoutes = require('./routes/authRoutes');
const historicosRoutes = require('./routes/historicosRoutes');
const interaccionesRoutes = require('./routes/interaccionesRoutes');
const authMiddleware = require('./middlewares/authMiddleware');
const { calcularMetricasTiempoReal } = require('./services/realtimeMetrics');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Configuración de Socket.io con CORS
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});

// Middleware de autenticación JWT para conexiones WebSocket
io.use((socket, next) => {
    const rawToken = socket.handshake.auth && socket.handshake.auth.token;

    if (!rawToken || typeof rawToken !== 'string') {
        return next(new Error('Acceso denegado: token JWT requerido en handshake.auth.token'));
    }

    const token = rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : rawToken.trim();

    if (!token) {
        return next(new Error('Acceso denegado: token JWT vacío'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.admin = {
            id_admin: decoded.id_admin,
            nombre: decoded.nombre,
            email: decoded.email
        };
        return next();
    } catch (error) {
        return next(new Error('Acceso denegado: token JWT inválido o expirado'));
    }
});

// Guardar instancia de Socket.io en Express para usar desde rutas REST
app.set('io', io);

// Eventos de conexión WebSocket
io.on('connection', async (socket) => {
    console.log(
        `[SOCKET.IO] Administrador conectado: ${socket.admin.nombre} (${socket.admin.email}) | ID: ${socket.id}`
    );

    try {
        const metricas = await calcularMetricasTiempoReal();
        socket.emit('metricas:iniciales', metricas);
    } catch (error) {
        console.error('[SOCKET.IO METRICAS INICIALES ERROR]:', error.message);
    }

    socket.on('disconnect', () => {
        console.log(
            `[SOCKET.IO] Administrador desconectado: ${socket.admin.email} | ID: ${socket.id}`
        );
    });
});

// Middlewares globales HTTP
app.use(cors());
app.use(express.json());

// Redirección de raíz hacia login.html (servido desde public/)
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Archivos estáticos desde public/
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Rutas de autenticación y API REST
app.use('/api/auth', authRoutes);
app.use('/api/historicos', historicosRoutes);
app.use('/api/interacciones', interaccionesRoutes);

// Endpoint protegido de prueba
app.get('/api/protegido', authMiddleware, (req, res) => {
    res.status(200).json({
        acceso: 'autorizado',
        mensaje: 'Acceso concedido a recurso protegido de COMMUNITY 360.',
        admin: req.admin
    });
});

server.listen(PORT, () => {
    console.log(`[COMMUNITY 360] Servidor HTTP + WebSockets activo en http://localhost:${PORT}`);
});
