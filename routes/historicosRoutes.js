const express = require('express');
const pool = require('../config/db');
const verifyToken = require('../middlewares/authMiddleware');

const router = express.Router();

// Proteger todas las rutas históricas con JWT
router.use(verifyToken);

// 1. GET /api/historicos/resumen
router.get('/resumen', async (req, res) => {
    try {
        const sqlKpis = `
            SELECT
                COUNT(*) AS total_usuarios,
                COALESCE(SUM(CASE WHEN estatus = 'activo' THEN 1 ELSE 0 END), 0) AS activos,
                COALESCE(SUM(CASE WHEN estatus = 'en_riesgo' THEN 1 ELSE 0 END), 0) AS en_riesgo,
                COALESCE(SUM(CASE WHEN estatus = 'inactivo' THEN 1 ELSE 0 END), 0) AS inactivos,
                COALESCE(SUM(CASE WHEN es_artista = 1 THEN 1 ELSE 0 END), 0) AS total_artistas,
                COALESCE(SUM(CASE WHEN consentimiento_datos = 'no' THEN 1 ELSE 0 END), 0) AS usuarios_anonimizados,
                ROUND(COALESCE(AVG(sentimiento_promedio), 0), 4) AS sentimiento_promedio_global,
                COALESCE(SUM(mensajes_30d), 0) AS mensajes_30d_total,
                COALESCE(SUM(reacciones_30d), 0) AS reacciones_30d_total
            FROM usuarios
        `;

        const sqlBitacora = `
            SELECT
                id_ejecucion,
                fecha_ejecucion,
                usuarios_recibidos,
                usuarios_anonimizados,
                interacciones_recibidas,
                interacciones_aceptadas,
                interacciones_rechazadas
            FROM bitacora_etl
            ORDER BY fecha_ejecucion DESC, id_ejecucion DESC
            LIMIT 1
        `;

        const [[kpiRows], [bitacoraRows]] = await Promise.all([
            pool.execute(sqlKpis),
            pool.execute(sqlBitacora)
        ]);

        const kpis = kpiRows[0] || {};

        return res.status(200).json({
            total_usuarios: Number(kpis.total_usuarios || 0),
            activos: Number(kpis.activos || 0),
            en_riesgo: Number(kpis.en_riesgo || 0),
            inactivos: Number(kpis.inactivos || 0),
            total_artistas: Number(kpis.total_artistas || 0),
            usuarios_anonimizados: Number(kpis.usuarios_anonimizados || 0),
            sentimiento_promedio_global: Number(kpis.sentimiento_promedio_global || 0),
            mensajes_30d_total: Number(kpis.mensajes_30d_total || 0),
            reacciones_30d_total: Number(kpis.reacciones_30d_total || 0),
            bitacora_etl: bitacoraRows[0] || null
        });
    } catch (error) {
        console.error('[HISTORICOS RESUMEN ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al obtener el resumen histórico.',
            error: 'Error del servidor'
        });
    }
});

// 2. GET /api/historicos/distribucion
router.get('/distribucion', async (req, res) => {
    try {
        const [
            [estatusRows],
            [plataformaRows],
            [interesRows],
            [rangoEdadRows],
            [especieRows]
        ] = await Promise.all([
            pool.execute(`
                SELECT estatus, COUNT(*) AS total
                FROM usuarios
                GROUP BY estatus
                ORDER BY total DESC
            `),
            pool.execute(`
                SELECT p.nombre AS plataforma, COUNT(u.id_usuario) AS total
                FROM usuarios u
                INNER JOIN cat_plataformas p ON u.id_plataforma = p.id_plataforma
                GROUP BY p.id_plataforma, p.nombre
                ORDER BY total DESC
            `),
            pool.execute(`
                SELECT i.nombre AS interes, COUNT(u.id_usuario) AS total
                FROM usuarios u
                INNER JOIN cat_intereses i ON u.id_interes = i.id_interes
                GROUP BY i.id_interes, i.nombre
                ORDER BY total DESC
            `),
            pool.execute(`
                SELECT rango_edad, COUNT(*) AS total
                FROM usuarios
                GROUP BY rango_edad
                ORDER BY rango_edad ASC
            `),
            pool.execute(`
                SELECT e.nombre AS especie, COUNT(u.id_usuario) AS total
                FROM usuarios u
                INNER JOIN cat_especies e ON u.id_especie = e.id_especie
                GROUP BY e.id_especie, e.nombre
                ORDER BY total DESC
            `)
        ]);

        return res.status(200).json({
            estatus: estatusRows.map((r) => ({ estatus: r.estatus, total: Number(r.total) })),
            plataforma: plataformaRows.map((r) => ({ plataforma: r.plataforma, total: Number(r.total) })),
            interes: interesRows.map((r) => ({ interes: r.interes, total: Number(r.total) })),
            rango_edad: rangoEdadRows.map((r) => ({ rango_edad: r.rango_edad, total: Number(r.total) })),
            especie: especieRows.map((r) => ({ especie: r.especie, total: Number(r.total) }))
        });
    } catch (error) {
        console.error('[HISTORICOS DISTRIBUCION ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al obtener las distribuciones históricas.',
            error: 'Error del servidor'
        });
    }
});

// 3. GET /api/historicos/mapa
router.get('/mapa', async (req, res) => {
    try {
        const sqlMapa = `
            SELECT
                u.latitud,
                u.longitud,
                c.ciudad,
                c.estado,
                c.pais,
                u.estatus
            FROM usuarios u
            INNER JOIN cat_ubicaciones c ON u.id_ubicacion = c.id_ubicacion
            WHERE u.consentimiento_datos = 'si'
              AND u.id_ubicacion IS NOT NULL
              AND u.latitud IS NOT NULL
              AND u.longitud IS NOT NULL
        `;

        const [rows] = await pool.execute(sqlMapa);

        const puntos = rows.map((r) => ({
            latitud: Number(r.latitud),
            longitud: Number(r.longitud),
            ciudad: r.ciudad,
            estado: r.estado,
            pais: r.pais,
            estatus: r.estatus
        }));

        return res.status(200).json({
            total_puntos: puntos.length,
            puntos
        });
    } catch (error) {
        console.error('[HISTORICOS MAPA ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al obtener los puntos geográficos.',
            error: 'Error del servidor'
        });
    }
});

// 4. GET /api/historicos/usuarios
router.get('/usuarios', async (req, res) => {
    try {
        const estatusFiltro = req.query.estatus ? String(req.query.estatus).trim().toLowerCase() : null;
        const limitRaw = parseInt(req.query.limit, 10);
        const limit = !Number.isNaN(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 50;

        const condiciones = [];
        const params = [];

        if (estatusFiltro) {
            condiciones.push('u.estatus = ?');
            params.push(estatusFiltro);
        }

        const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

        const sqlUsuarios = `
            SELECT
                u.id_usuario,
                u.alias,
                u.fecha_ingreso,
                CASE WHEN u.consentimiento_datos = 'si' THEN ub.pais ELSE NULL END AS pais,
                CASE WHEN u.consentimiento_datos = 'si' THEN ub.estado ELSE NULL END AS estado,
                CASE WHEN u.consentimiento_datos = 'si' THEN ub.ciudad ELSE NULL END AS ciudad,
                CASE WHEN u.consentimiento_datos = 'si' THEN ub.zona_horaria ELSE NULL END AS zona_horaria,
                CASE WHEN u.consentimiento_datos = 'si' THEN u.latitud ELSE NULL END AS latitud,
                CASE WHEN u.consentimiento_datos = 'si' THEN u.longitud ELSE NULL END AS longitud,
                u.rango_edad,
                esp.nombre AS especie,
                inter.nombre AS interes,
                plat.nombre AS plataforma,
                u.es_artista,
                u.mensajes_30d,
                u.reacciones_30d,
                u.eventos_asistidos,
                u.comisiones_compradas,
                u.sentimiento_promedio,
                u.ultima_actividad,
                u.estatus,
                u.consentimiento_datos
            FROM usuarios u
            LEFT JOIN cat_ubicaciones ub ON u.id_ubicacion = ub.id_ubicacion
            LEFT JOIN cat_especies esp ON u.id_especie = esp.id_especie
            LEFT JOIN cat_intereses inter ON u.id_interes = inter.id_interes
            LEFT JOIN cat_plataformas plat ON u.id_plataforma = plat.id_plataforma
            ${whereClause}
            ORDER BY u.id_usuario ASC
            LIMIT ${limit}
        `;

        const [rows] = await pool.execute(sqlUsuarios, params);

        // Garantía estricta de privacidad también en capa de aplicación
        const usuarios = rows.map((u) => {
            const conConsentimiento = u.consentimiento_datos === 'si';
            return {
                id_usuario: u.id_usuario,
                alias: u.alias,
                fecha_ingreso: u.fecha_ingreso,
                pais: conConsentimiento ? (u.pais ?? null) : null,
                estado: conConsentimiento ? (u.estado ?? null) : null,
                ciudad: conConsentimiento ? (u.ciudad ?? null) : null,
                zona_horaria: conConsentimiento ? (u.zona_horaria ?? null) : null,
                latitud: conConsentimiento && u.latitud !== null ? Number(u.latitud) : null,
                longitud: conConsentimiento && u.longitud !== null ? Number(u.longitud) : null,
                rango_edad: u.rango_edad,
                especie: u.especie ?? null,
                interes: u.interes ?? null,
                plataforma: u.plataforma ?? null,
                es_artista: Number(u.es_artista),
                mensajes_30d: Number(u.mensajes_30d),
                reacciones_30d: Number(u.reacciones_30d),
                eventos_asistidos: Number(u.eventos_asistidos),
                comisiones_compradas: Number(u.comisiones_compradas),
                sentimiento_promedio: Number(u.sentimiento_promedio),
                ultima_actividad: u.ultima_actividad,
                estatus: u.estatus,
                consentimiento_datos: u.consentimiento_datos
            };
        });

        return res.status(200).json({
            total_devueltos: usuarios.length,
            filtros: {
                estatus: estatusFiltro,
                limit
            },
            usuarios
        });
    } catch (error) {
        console.error('[HISTORICOS USUARIOS ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al consultar el padrón de usuarios.',
            error: 'Error del servidor'
        });
    }
});

module.exports = router;
