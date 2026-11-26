require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Rutas de entrada y salida
const USERS_CSV = path.join(__dirname, 'data', 'comunidad_virtual_usuarios.csv');
const INTER_CSV = path.join(__dirname, 'data', 'comunidad_virtual_1000_interacciones.csv');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Utilidad para leer CSV como promesa
function leerCSV(ruta) {
    return new Promise((resolve, reject) => {
        const filas = [];
        fs.createReadStream(ruta)
            .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }))
            .on('data', (row) => filas.push(row))
            .on('end', () => resolve(filas))
            .on('error', reject);
    });
}

// Utilidad para convertir DD/MM/YYYY -> YYYY-MM-DD
function convertirFechaISO(fechaStr) {
    if (!fechaStr) return null;
    const partes = fechaStr.trim().split('/');
    if (partes.length !== 3) return null;
    const [dd, mm, yyyy] = partes;
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    return isNaN(Date.parse(iso)) ? null : iso;
}

// Utilidad para limpiar cadenas vacías a null
function limpiarTexto(val) {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    return s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' ? null : s;
}

async function ejecutarETL() {
    console.log('==============================================================');
    console.log('  COMMUNITY 360 - PIPELINE ETL (TiDB Cloud + Firebase)');
    console.log('==============================================================\n');

    // Lectura de archivos originales
    const usuariosRaw = await leerCSV(USERS_CSV);
    const interaccionesRaw = await leerCSV(INTER_CSV);
    console.log(`[INICIO] Usuarios leídos: ${usuariosRaw.length} | Interacciones leídas: ${interaccionesRaw.length}`);

    // ------------------------------------------------------------------
    // ETAPAS 1, 2, 3, 4 y 6 SOBRE USUARIOS
    // ------------------------------------------------------------------
    const idsVistos = new Set();
    const aliasVistos = new Set();
    const usuariosLimpios = [];
    const mapaUsuariosValidos = new Map();

    let usuariosDuplicados = 0;
    let usuariosAnonimizados = 0;
    let usuariosInvalidos = 0;

    for (const row of usuariosRaw) {
        const id_usuario = limpiarTexto(row.id_usuario);
        const alias = limpiarTexto(row.alias);

        // Etapa 1: Eliminación de duplicados
        if (!id_usuario || !alias || idsVistos.has(id_usuario) || aliasVistos.has(alias.toLowerCase())) {
            usuariosDuplicados++;
            continue;
        }
        idsVistos.add(id_usuario);
        aliasVistos.add(alias.toLowerCase());

        // Etapa 3 y 4: Estandarización de fechas y validación de tipos
        const fecha_ingreso = convertirFechaISO(row.fecha_ingreso);
        const ultima_actividad = convertirFechaISO(row.ultima_actividad);
        const consentimiento = (limpiarTexto(row.consentimiento_datos) || 'no').toLowerCase();
        const estatus = (limpiarTexto(row.estatus) || 'inactivo').toLowerCase();
        const es_artista = Number(row.es_artista);
        const mensajes_30d = parseInt(row.mensajes_30d, 10);
        const reacciones_30d = parseInt(row.reacciones_30d, 10);
        const eventos_asistidos = parseInt(row.eventos_asistidos, 10);
        const comisiones_compradas = parseInt(row.comisiones_compradas, 10);
        const sentimiento_promedio = parseFloat(row.sentimiento_promedio);

        if (
            !fecha_ingreso || !ultima_actividad ||
            ![0, 1].includes(es_artista) ||
            isNaN(mensajes_30d) || isNaN(reacciones_30d) ||
            isNaN(eventos_asistidos) || isNaN(comisiones_compradas) ||
            isNaN(sentimiento_promedio) || sentimiento_promedio < -1 || sentimiento_promedio > 1
        ) {
            usuariosInvalidos++;
            continue;
        }

        // Etapa 2 y 6: Normalización de nulos y regla obligatoria de privacidad
        let pais = limpiarTexto(row.pais);
        let estado = limpiarTexto(row.estado);
        let ciudad = limpiarTexto(row.ciudad);
        let zona_horaria = limpiarTexto(row.zona_horaria);
        let latitud = limpiarTexto(row.latitud) !== null ? parseFloat(row.latitud) : null;
        let longitud = limpiarTexto(row.longitud) !== null ? parseFloat(row.longitud) : null;

        if (consentimiento === 'no') {
            pais = null;
            estado = null;
            ciudad = null;
            zona_horaria = null;
            latitud = null;
            longitud = null;
            usuariosAnonimizados++;
        }

        const usuario = {
            id_usuario,
            alias,
            fecha_ingreso,
            pais,
            estado,
            ciudad,
            zona_horaria,
            latitud: isNaN(latitud) ? null : latitud,
            longitud: isNaN(longitud) ? null : longitud,
            rango_edad: limpiarTexto(row.rango_edad),
            especie_fursona: limpiarTexto(row.especie_fursona),
            interes_principal: limpiarTexto(row.interes_principal),
            plataforma_principal: limpiarTexto(row.plataforma_principal),
            es_artista,
            mensajes_30d,
            reacciones_30d,
            eventos_asistidos,
            comisiones_compradas,
            sentimiento_promedio,
            ultima_actividad,
            estatus,
            consentimiento_datos: consentimiento
        };

        usuariosLimpios.push(usuario);
        mapaUsuariosValidos.set(id_usuario, usuario);
    }

    console.log(`[ETAPA 1-4 y 6 Usuarios] Válidos: ${usuariosLimpios.length} | Duplicados: ${usuariosDuplicados} | Inválidos: ${usuariosInvalidos} | Anonimizados (sin consentimiento): ${usuariosAnonimizados}`);

    // ------------------------------------------------------------------
    // ETAPAS 1, 2, 3, 4, 5 y 6 SOBRE INTERACCIONES
    // ------------------------------------------------------------------
    const interIdsVistos = new Set();
    const interaccionesValidas = [];
    const interaccionesCuarentena = [];

    let interDuplicadas = 0;
    let longitudesCorregidas = 0;

    for (const row of interaccionesRaw) {
        const id_interaccion = limpiarTexto(row.id_interaccion);
        const id_usuario = limpiarTexto(row.id_usuario);

        // Etapa 1: Eliminación de duplicados
        if (!id_interaccion || interIdsVistos.has(id_interaccion)) {
            interDuplicadas++;
            continue;
        }
        interIdsVistos.add(id_interaccion);

        // Etapa 5: Verificación de integridad referencial (id_usuario)
        if (!id_usuario || !mapaUsuariosValidos.has(id_usuario)) {
            interaccionesCuarentena.push({
                id_interaccion,
                id_usuario_raw: id_usuario,
                payload_original: row,
                auditoria_rechazo: {
                    codigo_error: 'ERR_FK_USUARIO_INEXISTENTE',
                    motivo: 'El id_usuario no existe en el padrón maestro de TiDB Cloud',
                    fecha_rechazo: new Date().toISOString()
                }
            });
            continue;
        }

        const userRef = mapaUsuariosValidos.get(id_usuario);

        // Etapa 2: Normalización de nulos y corrección de longitud_texto
        const texto = limpiarTexto(row.texto);
        let longitud_texto = parseInt(row.longitud_texto, 10) || 0;
        if (texto === null && longitud_texto > 0) {
            longitud_texto = 0;
            longitudesCorregidas++;
        } else if (texto !== null) {
            longitud_texto = texto.length;
        }

        // Etapa 3: Estandarización de timestamps y separación de etiquetas multivaluadas
        const timestamp = limpiarTexto(row.timestamp);
        const etiquetasRaw = limpiarTexto(row.etiquetas);
        const etiquetas = etiquetasRaw
            ? etiquetasRaw.split('|').map((t) => t.trim().toLowerCase()).filter(Boolean)
            : [];

        // Etapa 4: Validación de tipos numéricos
        const sentimiento = parseFloat(row.sentimiento);
        const reacciones_recibidas = parseInt(row.reacciones_recibidas, 10) || 0;

        // Etapa 6: Regla de privacidad en interacciones
        const sinConsentimiento = userRef.consentimiento_datos === 'no';
        const pais = sinConsentimiento ? null : limpiarTexto(row.pais);
        const estado = sinConsentimiento ? null : limpiarTexto(row.estado);
        const ciudad = sinConsentimiento ? null : limpiarTexto(row.ciudad);

        interaccionesValidas.push({
            id_interaccion,
            id_usuario,
            timestamp,
            canal: limpiarTexto(row.canal),
            tipo: limpiarTexto(row.tipo),
            texto,
            tema: limpiarTexto(row.tema),
            sentimiento: isNaN(sentimiento) ? 0 : sentimiento,
            idioma: (limpiarTexto(row.idioma) || 'es').toLowerCase(),
            pais,
            estado,
            ciudad,
            dispositivo: limpiarTexto(row.dispositivo),
            longitud_texto,
            reacciones_recibidas,
            etiquetas,
            usuario_snapshot: {
                alias: userRef.alias,
                estatus: userRef.estatus,
                consentimiento_datos: userRef.consentimiento_datos
            }
        });
    }

    console.log(`[ETAPA 1-6 Interacciones] Válidas: ${interaccionesValidas.length} | Cuarentena (huérfanas): ${interaccionesCuarentena.length} | Duplicadas: ${interDuplicadas} | Longitudes corregidas: ${longitudesCorregidas}`);

    // ------------------------------------------------------------------
    // ETAPA 7: GENERACIÓN DE ARCHIVOS DEPURADOS LOCALES
    // ------------------------------------------------------------------
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Exportar usuarios depurados a CSV
    const headersUsers = Object.keys(usuariosLimpios[0]);
    const csvLines = [
        headersUsers.join(','),
        ...usuariosLimpios.map((u) =>
            headersUsers.map((h) => (u[h] === null ? '' : `"${String(u[h]).replace(/"/g, '""')}"`)).join(',')
        )
    ];
    fs.writeFileSync(path.join(OUTPUT_DIR, 'usuarios_depurados.csv'), csvLines.join('\n'), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'interacciones_validas.json'), JSON.stringify(interaccionesValidas, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'interacciones_cuarentena.json'), JSON.stringify(interaccionesCuarentena, null, 2), 'utf8');
    console.log(`[ETAPA 7] Archivos depurados generados en /output exitosamente.\n`);

    // ------------------------------------------------------------------
    // ETAPA 8A: CARGA EN TiDB CLOUD (SQL)
    // ------------------------------------------------------------------
    console.log('[ETAPA 8A] Conectando a TiDB Cloud (SQL)...');
    const conn = await mysql.createConnection({
        host: process.env.TIDB_HOST,
        port: Number(process.env.TIDB_PORT || 4000),
        user: process.env.TIDB_USER,
        password: process.env.TIDB_PASSWORD,
        database: process.env.TIDB_DATABASE,
        ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    });

    // Poblar catálogos y construir mapas de IDs
    const mapUbicaciones = new Map();
    const mapEspecies = new Map();
    const mapIntereses = new Map();
    const mapPlataformas = new Map();

    for (const u of usuariosLimpios) {
        if (u.pais && u.estado && u.ciudad) {
            const key = `${u.pais}|${u.estado}|${u.ciudad}`;
            if (!mapUbicaciones.has(key)) {
                await conn.execute(
                    `INSERT IGNORE INTO cat_ubicaciones (pais, estado, ciudad, zona_horaria) VALUES (?, ?, ?, ?)`,
                    [u.pais, u.estado, u.ciudad, u.zona_horaria]
                );
                const [rows] = await conn.execute(
                    `SELECT id_ubicacion FROM cat_ubicaciones WHERE pais = ? AND estado = ? AND ciudad = ?`,
                    [u.pais, u.estado, u.ciudad]
                );
                mapUbicaciones.set(key, rows[0].id_ubicacion);
            }
        }

        if (!mapEspecies.has(u.especie_fursona)) {
            await conn.execute(`INSERT IGNORE INTO cat_especies (nombre) VALUES (?)`, [u.especie_fursona]);
            const [rows] = await conn.execute(`SELECT id_especie FROM cat_especies WHERE nombre = ?`, [u.especie_fursona]);
            mapEspecies.set(u.especie_fursona, rows[0].id_especie);
        }

        if (!mapIntereses.has(u.interes_principal)) {
            await conn.execute(`INSERT IGNORE INTO cat_intereses (nombre) VALUES (?)`, [u.interes_principal]);
            const [rows] = await conn.execute(`SELECT id_interes FROM cat_intereses WHERE nombre = ?`, [u.interes_principal]);
            mapIntereses.set(u.interes_principal, rows[0].id_interes);
        }

        if (!mapPlataformas.has(u.plataforma_principal)) {
            await conn.execute(`INSERT IGNORE INTO cat_plataformas (nombre) VALUES (?)`, [u.plataforma_principal]);
            const [rows] = await conn.execute(`SELECT id_plataforma FROM cat_plataformas WHERE nombre = ?`, [u.plataforma_principal]);
            mapPlataformas.set(u.plataforma_principal, rows[0].id_plataforma);
        }
    }

    // Insertar usuarios normalizados
    const sqlInsertUsuario = `
    INSERT INTO usuarios (
      id_usuario, alias, fecha_ingreso, id_ubicacion, latitud, longitud,
      rango_edad, id_especie, id_interes, id_plataforma, es_artista,
      mensajes_30d, reacciones_30d, eventos_asistidos, comisiones_compradas,
      sentimiento_promedio, ultima_actividad, estatus, consentimiento_datos
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      id_ubicacion = VALUES(id_ubicacion),
      latitud = VALUES(latitud),
      longitud = VALUES(longitud),
      estatus = VALUES(estatus),
      consentimiento_datos = VALUES(consentimiento_datos)
  `;

    for (const u of usuariosLimpios) {
        const id_ubicacion = (u.pais && u.estado && u.ciudad)
            ? mapUbicaciones.get(`${u.pais}|${u.estado}|${u.ciudad}`)
            : null;

        await conn.execute(sqlInsertUsuario, [
            u.id_usuario, u.alias, u.fecha_ingreso, id_ubicacion, u.latitud, u.longitud,
            u.rango_edad, mapEspecies.get(u.especie_fursona), mapIntereses.get(u.interes_principal),
            mapPlataformas.get(u.plataforma_principal), u.es_artista, u.mensajes_30d,
            u.reacciones_30d, u.eventos_asistidos, u.comisiones_compradas,
            u.sentimiento_promedio, u.ultima_actividad, u.estatus, u.consentimiento_datos
        ]);
    }

    // Registrar ejecución en bitacora_etl
    await conn.execute(
        `INSERT INTO bitacora_etl (
      usuarios_recibidos, usuarios_anonimizados,
      interacciones_recibidas, interacciones_aceptadas, interacciones_rechazadas
    ) VALUES (?, ?, ?, ?, ?)`,
        [
            usuariosRaw.length,
            usuariosAnonimizados,
            interaccionesRaw.length,
            interaccionesValidas.length,
            interaccionesCuarentena.length
        ]
    );

    await conn.end();
    console.log(`[ETAPA 8A] TiDB Cloud cargado: ${usuariosLimpios.length} usuarios, 4 catálogos y bitácora ETL.\n`);

    // ------------------------------------------------------------------
    // ETAPA 8B: CARGA EN FIREBASE CLOUD FIRESTORE (NoSQL)
    // ------------------------------------------------------------------
    console.log('[ETAPA 8B] Conectando a Firebase Cloud Firestore (NoSQL)...');
    const serviceAccount = require(path.resolve(process.env.FIREBASE_CREDENTIALS_PATH));
    initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

    // Función auxiliar para subir en lotes de máximo 400 docs (límite Firestore = 500)
    async function subirEnLotes(nombreColeccion, documentos) {
        const CHUNK = 400;
        for (let i = 0; i < documentos.length; i += CHUNK) {
            const batch = db.batch();
            const bloque = documentos.slice(i, i + CHUNK);
            for (const doc of bloque) {
                const ref = db.collection(nombreColeccion).doc(doc.id_interaccion);
                batch.set(ref, doc);
            }
            await batch.commit();
        }
    }

    await subirEnLotes('interacciones', interaccionesValidas);
    await subirEnLotes('interacciones_cuarentena', interaccionesCuarentena);

    console.log(`[ETAPA 8B] Firestore cargado: ${interaccionesValidas.length} en 'interacciones' y ${interaccionesCuarentena.length} en 'interacciones_cuarentena'.`);
    console.log('\n==============================================================');
    console.log('  PROCESO ETL FINALIZADO CON ÉXITO');
    console.log('==============================================================');
}

ejecutarETL().catch((err) => {
    console.error('[ERROR ETL]:', err);
    process.exit(1);
});