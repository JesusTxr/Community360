const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({
                mensaje: 'Debe proporcionar correo electrónico y contraseña.',
                error: 'Campos obligatorios faltantes'
            });
        }

        const emailNormalizado = String(email).trim().toLowerCase();

        const [rows] = await pool.execute(
            'SELECT id_admin, nombre, email, password_hash FROM administradores WHERE email = ? LIMIT 1',
            [emailNormalizado]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                mensaje: 'Credenciales inválidas.',
                error: 'Credenciales inválidas'
            });
        }

        const admin = rows[0];
        const passwordValido = await bcrypt.compare(String(password), admin.password_hash);

        if (!passwordValido) {
            return res.status(401).json({
                mensaje: 'Credenciales inválidas.',
                error: 'Credenciales inválidas'
            });
        }

        const payload = {
            id_admin: admin.id_admin,
            nombre: admin.nombre,
            email: admin.email
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: '4h'
        });

        return res.status(200).json({
            mensaje: 'Inicio de sesión exitoso.',
            token,
            admin: payload
        });
    } catch (error) {
        console.error('[AUTH LOGIN ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al procesar la autenticación.',
            error: 'Error del servidor'
        });
    }
});

// GET /api/auth/verify
router.get('/verify', authMiddleware, (req, res) => {
    return res.status(200).json({
        autenticado: true,
        admin: req.admin
    });
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
    return res.status(200).json({
        autenticado: false,
        mensaje: 'Sesión cerrada correctamente.'
    });
});

module.exports = router;
