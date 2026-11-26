const express = require('express');
const db = require('../config/firebase');
const pool = require('../config/db');
const verifyToken = require('../middlewares/authMiddleware');
const { calcularMetricasTiempoReal } = require('../services/realtimeMetrics');

const router = express.Router();
const COLLECTION = 'interacciones';

// Proteger todas las rutas de interacciones con JWT
router.use(verifyToken);

function limpiarTexto(val) {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    return s === '' ? null : s;
}

function validarSentimiento(valor) {
    if (valor === undefined || valor === null || valor === '' || typeof valor === 'boolean') {
        return { valido: false };
    }
    const num = Number(valor);
    if (Number.isNaN(num) || !Number.isFinite(num) || num < -1 || num > 1) {
        return { valido: false };
    }
    return { valido: true, valor: num };
}

async function emitirActualizacionTiempoReal(req, accion, id_interaccion, interaccion = null) {
    const io = req.app.get('io');
    if (!io) return;

    try {
        const metricas = await calcularMetricasTiempoReal();
        io.emit('interacciones:actualizadas', {
            accion,
            id_interaccion,
            interaccion,
            metricas
        });
    } catch (error) {
        console.error('[SOCKET.IO EMIT ERROR]:', error.message);
    }
}

// 1. GET /api/interacciones
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection(COLLECTION).orderBy('timestamp', 'desc').get();

        const filtroCanal = limpiarTexto(req.query.canal)?.toLowerCase() || null;
        const filtroTema = limpiarTexto(req.query.tema)?.toLowerCase() || null;
        const filtroTipo = limpiarTexto(req.query.tipo)?.toLowerCase() || null;

        let interacciones = snapshot.docs.map((doc) => ({
            id_interaccion: doc.id,
            ...doc.data()
        }));

        if (filtroCanal) {
            interacciones = interacciones.filter(
                (i) => String(i.canal || '').trim().toLowerCase() === filtroCanal
            );
        }

        if (filtroTema) {
            interacciones = interacciones.filter(
                (i) => String(i.tema || '').trim().toLowerCase() === filtroTema
            );
        }

        if (filtroTipo) {
            interacciones = interacciones.filter(
                (i) => String(i.tipo || '').trim().toLowerCase() === filtroTipo
            );
        }

        return res.status(200).json({
            total: interacciones.length,
            interacciones
        });
    } catch (error) {
        console.error('[GET INTERACCIONES ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al consultar las interacciones.',
            error: 'Error del servidor'
        });
    }
});

// 2. GET /api/interacciones/:id
router.get('/:id', async (req, res) => {
    try {
        const id = String(req.params.id).trim();
        const docSnap = await db.collection(COLLECTION).doc(id).get();

        if (!docSnap.exists) {
            return res.status(404).json({
                mensaje: `La interacción '${id}' no existe en Firestore.`,
                error: 'Interacción no encontrada'
            });
        }

        return res.status(200).json({
            id_interaccion: docSnap.id,
            ...docSnap.data()
        });
    } catch (error) {
        console.error('[GET INTERACCION BY ID ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al obtener la interacción.',
            error: 'Error del servidor'
        });
    }
});

// 3. POST /api/interacciones
router.post('/', async (req, res) => {
    try {
        const body = req.body || {};

        const id_usuario = limpiarTexto(body.id_usuario);
        const canal = limpiarTexto(body.canal);
        const tipo = limpiarTexto(body.tipo);
        const tema = limpiarTexto(body.tema);
        const dispositivo = limpiarTexto(body.dispositivo);

        const faltantes = [];
        if (!id_usuario) faltantes.push('id_usuario');
        if (!canal) faltantes.push('canal');
        if (!tipo) faltantes.push('tipo');
        if (!tema) faltantes.push('tema');
        if (body.sentimiento === undefined || body.sentimiento === null || body.sentimiento === '') {
            faltantes.push('sentimiento');
        }
        if (!dispositivo) faltantes.push('dispositivo');

        if (faltantes.length > 0) {
            return res.status(400).json({
                mensaje: `Campos obligatorios faltantes: ${faltantes.join(', ')}.`,
                error: 'Datos de entrada incompletos',
                campos_faltantes: faltantes
            });
        }

        const checkSentimiento = validarSentimiento(body.sentimiento);
        if (!checkSentimiento.valido) {
            return res.status(400).json({
                mensaje: "El campo 'sentimiento' debe ser un número válido entre -1 y 1.",
                error: 'Tipo o rango inválido en sentimiento'
            });
        }

        // Normalizar y validar etiquetas (string con '|' o Array<String>)
        let etiquetas = [];
        if (body.etiquetas !== undefined && body.etiquetas !== null) {
            if (Array.isArray(body.etiquetas)) {
                etiquetas = body.etiquetas
                    .map((t) => String(t).trim().toLowerCase())
                    .filter(Boolean);
            } else if (typeof body.etiquetas === 'string') {
                etiquetas = body.etiquetas
                    .split('|')
                    .map((t) => t.trim().toLowerCase())
                    .filter(Boolean);
            } else {
                return res.status(400).json({
                    mensaje: "El campo 'etiquetas' debe ser un arreglo de textos o una cadena separada por '|'.",
                    error: 'Formato inválido en etiquetas'
                });
            }
        }

        // Validar reacciones_recibidas si se envía
        let reacciones_recibidas = 0;
        if (body.reacciones_recibidas !== undefined && body.reacciones_recibidas !== null) {
            const numReacc = Number(body.reacciones_recibidas);
            if (!Number.isInteger(numReacc) || numReacc < 0) {
                return res.status(400).json({
                    mensaje: "El campo 'reacciones_recibidas' debe ser un número entero mayor o igual a 0.",
                    error: 'Tipo inválido en reacciones_recibidas'
                });
            }
            reacciones_recibidas = numReacc;
        }

        // Integridad referencial contra el padrón maestro en TiDB Cloud
        const [userRows] = await pool.execute(
            'SELECT alias, estatus, consentimiento_datos FROM usuarios WHERE id_usuario = ? LIMIT 1',
            [id_usuario]
        );

        if (userRows.length === 0) {
            return res.status(404).json({
                mensaje: `El usuario '${id_usuario}' no está registrado en el padrón maestro de TiDB Cloud.`,
                error: 'ERR_FK_USUARIO_INEXISTENTE'
            });
        }

        const usuario = userRows[0];
        const consentimiento = String(usuario.consentimiento_datos || 'no').toLowerCase();
        const sinConsentimiento = consentimiento === 'no';

        // Regla obligatoria de privacidad
        const pais = sinConsentimiento ? null : limpiarTexto(body.pais);
        const estado = sinConsentimiento ? null : limpiarTexto(body.estado);
        const ciudad = sinConsentimiento ? null : limpiarTexto(body.ciudad);

        // Normalización de texto, longitud, timestamp e ID
        const texto = limpiarTexto(body.texto);
        const longitud_texto = texto ? texto.length : 0;
        const timestamp = limpiarTexto(body.timestamp) || new Date().toISOString();
        const id_interaccion = limpiarTexto(body.id_interaccion) || `I${Date.now()}`;
        const idioma = (limpiarTexto(body.idioma) || 'es').toLowerCase();

        const nuevaInteraccion = {
            id_interaccion,
            id_usuario,
            timestamp,
            canal,
            tipo,
            texto,
            tema,
            sentimiento: checkSentimiento.valor,
            idioma,
            pais,
            estado,
            ciudad,
            dispositivo,
            longitud_texto,
            reacciones_recibidas,
            etiquetas,
            usuario_snapshot: {
                alias: usuario.alias,
                estatus: usuario.estatus,
                consentimiento_datos: consentimiento
            }
        };

        await db.collection(COLLECTION).doc(id_interaccion).set(nuevaInteraccion);

        // Emitir actualización en tiempo real vía Socket.io
        await emitirActualizacionTiempoReal(req, 'POST', id_interaccion, nuevaInteraccion);

        return res.status(201).json(nuevaInteraccion);
    } catch (error) {
        console.error('[POST INTERACCION ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al crear la interacción.',
            error: 'Error del servidor'
        });
    }
});

// 4. PUT /api/interacciones/:id
router.put('/:id', async (req, res) => {
    try {
        const id = String(req.params.id).trim();
        const body = req.body || {};

        const docRef = db.collection(COLLECTION).doc(id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return res.status(404).json({
                mensaje: `La interacción '${id}' no existe en Firestore.`,
                error: 'Interacción no encontrada'
            });
        }

        const actual = docSnap.data();
        const cambios = {};

        // Validar tipos si se envían
        if (body.sentimiento !== undefined) {
            const checkSentimiento = validarSentimiento(body.sentimiento);
            if (!checkSentimiento.valido) {
                return res.status(400).json({
                    mensaje: "El campo 'sentimiento' debe ser un número válido entre -1 y 1.",
                    error: 'Tipo o rango inválido en sentimiento'
                });
            }
            cambios.sentimiento = checkSentimiento.valor;
        }

        if (body.etiquetas !== undefined) {
            if (!Array.isArray(body.etiquetas)) {
                return res.status(400).json({
                    mensaje: "El campo 'etiquetas' debe enviarse como un arreglo (Array<String>).",
                    error: 'Tipo inválido en etiquetas'
                });
            }
            cambios.etiquetas = body.etiquetas
                .map((t) => String(t).trim().toLowerCase())
                .filter(Boolean);
        }

        if (body.texto !== undefined) {
            const nuevoTexto = limpiarTexto(body.texto);
            cambios.texto = nuevoTexto;
            cambios.longitud_texto = nuevoTexto ? nuevoTexto.length : 0;
        }

        if (body.reacciones_recibidas !== undefined) {
            const numReacc = Number(body.reacciones_recibidas);
            if (!Number.isInteger(numReacc) || numReacc < 0) {
                return res.status(400).json({
                    mensaje: "El campo 'reacciones_recibidas' debe ser un número entero mayor o igual a 0.",
                    error: 'Tipo inválido en reacciones_recibidas'
                });
            }
            cambios.reacciones_recibidas = numReacc;
        }

        const camposTextoNoVacios = ['canal', 'tipo', 'tema', 'dispositivo', 'idioma', 'timestamp'];
        for (const campo of camposTextoNoVacios) {
            if (body[campo] !== undefined) {
                const limpio = limpiarTexto(body[campo]);
                if (!limpio) {
                    return res.status(400).json({
                        mensaje: `El campo '${campo}' no puede estar vacío.`,
                        error: `Valor inválido en ${campo}`
                    });
                }
                cambios[campo] = campo === 'idioma' ? limpio.toLowerCase() : limpio;
            }
        }

        // Verificar consentimiento de privacidad del usuario dueño (TiDB Cloud + snapshot)
        let consentimiento = String(
            actual.usuario_snapshot?.consentimiento_datos || 'no'
        ).toLowerCase();

        if (actual.id_usuario) {
            const [userRows] = await pool.execute(
                'SELECT alias, estatus, consentimiento_datos FROM usuarios WHERE id_usuario = ? LIMIT 1',
                [actual.id_usuario]
            );
            if (userRows.length > 0) {
                consentimiento = String(userRows[0].consentimiento_datos || 'no').toLowerCase();
                cambios.usuario_snapshot = {
                    alias: userRows[0].alias,
                    estatus: userRows[0].estatus,
                    consentimiento_datos: consentimiento
                };
            }
        }

        if (consentimiento === 'no') {
            cambios.pais = null;
            cambios.estado = null;
            cambios.ciudad = null;
        } else {
            if (body.pais !== undefined) cambios.pais = limpiarTexto(body.pais);
            if (body.estado !== undefined) cambios.estado = limpiarTexto(body.estado);
            if (body.ciudad !== undefined) cambios.ciudad = limpiarTexto(body.ciudad);
        }

        await docRef.update(cambios);

        const actualizado = {
            id_interaccion: id,
            ...actual,
            ...cambios
        };

        // Emitir actualización en tiempo real vía Socket.io
        await emitirActualizacionTiempoReal(req, 'PUT', id, actualizado);

        return res.status(200).json(actualizado);
    } catch (error) {
        console.error('[PUT INTERACCION ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al actualizar la interacción.',
            error: 'Error del servidor'
        });
    }
});

// 5. DELETE /api/interacciones/:id
router.delete('/:id', async (req, res) => {
    try {
        const id = String(req.params.id).trim();
        const docRef = db.collection(COLLECTION).doc(id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return res.status(404).json({
                mensaje: `La interacción '${id}' no existe en Firestore.`,
                error: 'Interacción no encontrada'
            });
        }

        await docRef.delete();

        // Emitir actualización en tiempo real vía Socket.io
        await emitirActualizacionTiempoReal(req, 'DELETE', id, null);

        return res.status(200).json({
            mensaje: 'Interacción eliminada correctamente.',
            id_interaccion: id
        });
    } catch (error) {
        console.error('[DELETE INTERACCION ERROR]:', error.message);
        return res.status(500).json({
            mensaje: 'Error interno al eliminar la interacción.',
            error: 'Error del servidor'
        });
    }
});

module.exports = router;
