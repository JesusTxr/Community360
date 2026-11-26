const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            autenticado: false,
            mensaje: 'Acceso denegado. No se proporcionó un token de autenticación.',
            error: 'Token requerido'
        });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
        return res.status(401).json({
            autenticado: false,
            mensaje: 'Acceso denegado. Formato de token vacío.',
            error: 'Token requerido'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = {
            id_admin: decoded.id_admin,
            nombre: decoded.nombre,
            email: decoded.email
        };
        return next();
    } catch (error) {
        return res.status(403).json({
            autenticado: false,
            mensaje: 'Token inválido o expirado. Inicie sesión nuevamente.',
            error: error.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido'
        });
    }
}

module.exports = authMiddleware;
